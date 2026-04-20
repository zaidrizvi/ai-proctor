from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import numpy as np
import os
import sys
import time
import traceback
from threading import Lock

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.frame_utils import get_frame_from_payload, parse_json_field, parse_request_payload
from routers.face import extract_confident_faces, _best_face_from_detections

router = APIRouter()

_torch = None
_nn = None
_transforms = None
_model = None
_model_device = None
_tracker_states: dict[str, dict] = {}
_tracker_state_lock = Lock()

MODEL_PATH = os.getenv(
    "L2CS_WEIGHTS_PATH",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models",
        "l2cs",
        "L2CSNet_gaze360.pkl",
    ),
)
MODEL_ARCH = os.getenv("L2CS_ARCH", "ResNet50")
MODEL_DEVICE = os.getenv("L2CS_DEVICE", "cpu")
NUM_BINS = 90
BIN_WIDTH_DEGREES = 4.0
BIN_START_DEGREES = -180.0
FACE_CONFIDENCE_THRESHOLD = 0.55
MIN_FACE_AREA_RATIO = 0.050
ABS_YAW_THRESHOLD = 26.0
ABS_PITCH_THRESHOLD = 20.0
DELTA_YAW_THRESHOLD = 13.0
DELTA_PITCH_THRESHOLD = 11.0
DELTA_YAW_DEADZONE = 2.0
DELTA_PITCH_DEADZONE = 2.0
TRACKER_STATE_TTL_SECONDS = 4.5
TRACKER_RESET_GAP_SECONDS = 1.8
GAZE_SMOOTHING_ALPHA = 0.56
STRONG_SIGNAL_GAZE_SMOOTHING_ALPHA = 0.74


class GazeBaseline(BaseModel):
    pitch: float
    yaw: float


def get_torch_modules():
    global _torch, _nn, _transforms

    if _torch is None or _nn is None or _transforms is None:
        import torch
        import torch.nn as nn
        from torchvision import transforms

        _torch = torch
        _nn = nn
        _transforms = transforms

    return _torch, _nn, _transforms


def _build_transform():
    _, _, transforms = get_torch_modules()

    return transforms.Compose([
        transforms.ToPILImage(),
        transforms.Resize(448),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225],
        ),
    ])


def _get_transform():
    global _transforms

    if _transforms is None:
        get_torch_modules()

    if not hasattr(_get_transform, "_value"):
        _get_transform._value = _build_transform()

    return _get_transform._value


class L2CSNet:
    @staticmethod
    def build(arch: str, num_bins: int):
        torch, nn, _ = get_torch_modules()
        from torchvision import models

        class L2CS(nn.Module):
            def __init__(self, block, layers, bins):
                super().__init__()
                self.inplanes = 64
                self.conv1 = nn.Conv2d(
                    3,
                    64,
                    kernel_size=7,
                    stride=2,
                    padding=3,
                    bias=False,
                )
                self.bn1 = nn.BatchNorm2d(64)
                self.relu = nn.ReLU(inplace=True)
                self.maxpool = nn.MaxPool2d(kernel_size=3, stride=2, padding=1)
                self.layer1 = self._make_layer(block, 64, layers[0])
                self.layer2 = self._make_layer(block, 128, layers[1], stride=2)
                self.layer3 = self._make_layer(block, 256, layers[2], stride=2)
                self.layer4 = self._make_layer(block, 512, layers[3], stride=2)
                self.avgpool = nn.AdaptiveAvgPool2d((1, 1))
                self.fc_yaw_gaze = nn.Linear(512 * block.expansion, bins)
                self.fc_pitch_gaze = nn.Linear(512 * block.expansion, bins)
                self.fc_finetune = nn.Linear((512 * block.expansion) + 3, 3)

                for module in self.modules():
                    if isinstance(module, nn.Conv2d):
                        kernel_area = module.kernel_size[0] * module.kernel_size[1]
                        module.weight.data.normal_(
                            0,
                            np.sqrt(2.0 / (kernel_area * module.out_channels)),
                        )
                    elif isinstance(module, nn.BatchNorm2d):
                        module.weight.data.fill_(1)
                        module.bias.data.zero_()

            def _make_layer(self, block, planes, blocks, stride=1):
                downsample = None
                if stride != 1 or self.inplanes != planes * block.expansion:
                    downsample = nn.Sequential(
                        nn.Conv2d(
                            self.inplanes,
                            planes * block.expansion,
                            kernel_size=1,
                            stride=stride,
                            bias=False,
                        ),
                        nn.BatchNorm2d(planes * block.expansion),
                    )

                layers = [block(self.inplanes, planes, stride, downsample)]
                self.inplanes = planes * block.expansion
                for _ in range(1, blocks):
                    layers.append(block(self.inplanes, planes))

                return nn.Sequential(*layers)

            def forward(self, x):
                x = self.conv1(x)
                x = self.bn1(x)
                x = self.relu(x)
                x = self.maxpool(x)
                x = self.layer1(x)
                x = self.layer2(x)
                x = self.layer3(x)
                x = self.layer4(x)
                x = self.avgpool(x)
                x = x.view(x.size(0), -1)
                pre_yaw_gaze = self.fc_yaw_gaze(x)
                pre_pitch_gaze = self.fc_pitch_gaze(x)
                return pre_yaw_gaze, pre_pitch_gaze

        if arch == "ResNet18":
            return L2CS(models.resnet.BasicBlock, [2, 2, 2, 2], num_bins)
        if arch == "ResNet34":
            return L2CS(models.resnet.BasicBlock, [3, 4, 6, 3], num_bins)
        if arch == "ResNet101":
            return L2CS(models.resnet.Bottleneck, [3, 4, 23, 3], num_bins)
        if arch == "ResNet152":
            return L2CS(models.resnet.Bottleneck, [3, 8, 36, 3], num_bins)

        return L2CS(models.resnet.Bottleneck, [3, 4, 6, 3], num_bins)


def _normalize_state_dict(raw_state):
    if not isinstance(raw_state, dict):
        raise RuntimeError("Unsupported L2CS checkpoint format")

    state_dict = raw_state.get("state_dict") or raw_state.get("model_state_dict") or raw_state
    if not isinstance(state_dict, dict):
        raise RuntimeError("Unsupported L2CS checkpoint state_dict")

    normalized = {}
    for key, value in state_dict.items():
        normalized[key.removeprefix("module.")] = value

    return normalized


def get_model():
    global _model, _model_device

    if _model is not None and _model_device is not None:
        return _model, _model_device

    torch, _, _ = get_torch_modules()

    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(
            f"L2CS-Net weights not found at '{MODEL_PATH}'. "
            "Download the pretrained gaze360 checkpoint and place it there."
        )

    device = torch.device(
        MODEL_DEVICE if MODEL_DEVICE != "auto"
        else "cuda:0" if torch.cuda.is_available() else "cpu"
    )
    model = L2CSNet.build(MODEL_ARCH, NUM_BINS)
    checkpoint = torch.load(MODEL_PATH, map_location=device)
    state_dict = _normalize_state_dict(checkpoint)
    missing_keys, unexpected_keys = model.load_state_dict(state_dict, strict=False)

    required_keys = {"fc_yaw_gaze.weight", "fc_pitch_gaze.weight"}
    if required_keys.intersection(set(missing_keys)):
        raise RuntimeError(
            f"L2CS-Net weights are incompatible with arch '{MODEL_ARCH}'. Missing keys: {missing_keys}"
        )

    if unexpected_keys:
        print(f"L2CS-Net loaded with unexpected keys ignored: {unexpected_keys}")

    model.to(device)
    model.eval()
    _model = model
    _model_device = device
    return _model, _model_device


def warmup_gaze_runtime():
    torch, _, _ = get_torch_modules()
    model, device = get_model()
    _get_transform()

    if os.getenv("ML_WARM_GAZE_FORWARD", "0").lower() not in {"1", "true", "yes"}:
        return

    with torch.no_grad():
        model(torch.zeros((1, 3, 448, 448), dtype=torch.float32, device=device))


def _to_uint8_rgb(face_image: np.ndarray) -> np.ndarray:
    if face_image is None or face_image.size == 0:
        raise ValueError("Face crop is empty")

    image = np.asarray(face_image)
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("Face crop must be an RGB image")

    if image.dtype == np.uint8:
        return image

    if float(image.max()) <= 1.5:
        image = image * 255.0

    return np.clip(image, 0, 255).astype(np.uint8)


def _apply_delta_deadzone(value: float, deadzone: float) -> float:
    return 0.0 if abs(value) < deadzone else value


def _angle_delta(current: float, baseline: float) -> float:
    return ((current - baseline + 180.0) % 360.0) - 180.0


def _cleanup_tracker_states(now: float):
    expired_ids = [
        tracker_id
        for tracker_id, state in _tracker_states.items()
        if now - state["last_seen"] > TRACKER_STATE_TTL_SECONDS
    ]
    for tracker_id in expired_ids:
        _tracker_states.pop(tracker_id, None)


def _get_tracker_state(tracker_id: str | None):
    if not tracker_id:
        return None

    now = time.monotonic()
    with _tracker_state_lock:
        _cleanup_tracker_states(now)
        state = _tracker_states.get(tracker_id)
        if state is None:
            state = {
                "lock": Lock(),
                "last_seen": now,
                "last_prediction_at": 0.0,
                "angles": None,
            }
            _tracker_states[tracker_id] = state
        else:
            state["last_seen"] = now
        return state


def _smooth_gaze_angles(angles: dict, tracker_state: dict | None):
    if tracker_state is None:
        return {
            **angles,
            "smoothing_alpha": 1.0,
            "tracker_reused": False,
            "tracker_reset_reason": "stateless",
            "tracker_frame_gap_ms": 0,
        }

    with tracker_state["lock"]:
        previous_angles = tracker_state.get("angles")
        now = time.monotonic()
        tracker_state["last_seen"] = now
        frame_gap_ms = 0
        reset_reason = "none"

        if previous_angles is None:
            tracker_state["angles"] = dict(angles)
            tracker_state["last_prediction_at"] = now
            return {
                **angles,
                "smoothing_alpha": 1.0,
                "tracker_reused": False,
                "tracker_reset_reason": "cold_start",
                "tracker_frame_gap_ms": 0,
            }

        last_prediction_at = float(tracker_state.get("last_prediction_at") or 0.0)
        if last_prediction_at > 0.0:
            frame_gap_ms = int(round((now - last_prediction_at) * 1000))

        if last_prediction_at and (now - last_prediction_at) > TRACKER_RESET_GAP_SECONDS:
            previous_angles = None
            reset_reason = "frame_gap"

        if previous_angles is None:
            tracker_state["angles"] = dict(angles)
            tracker_state["last_prediction_at"] = now
            return {
                **angles,
                "smoothing_alpha": 1.0,
                "tracker_reused": False,
                "tracker_reset_reason": reset_reason,
                "tracker_frame_gap_ms": frame_gap_ms,
            }

        signal_strength = max(abs(angles["yaw"]) / 24.0, abs(angles["pitch"]) / 18.0)
        alpha = (
            STRONG_SIGNAL_GAZE_SMOOTHING_ALPHA
            if signal_strength >= 1.0
            else GAZE_SMOOTHING_ALPHA
        )

        smoothed = {
            "yaw": (previous_angles["yaw"] * (1.0 - alpha)) + (angles["yaw"] * alpha),
            "pitch": (previous_angles["pitch"] * (1.0 - alpha)) + (angles["pitch"] * alpha),
        }
        tracker_state["angles"] = dict(smoothed)
        tracker_state["last_prediction_at"] = now

        return {
            **smoothed,
            "smoothing_alpha": round(alpha, 4),
            "tracker_reused": True,
            "tracker_reset_reason": reset_reason,
            "tracker_frame_gap_ms": frame_gap_ms,
        }


def predict_gaze(face_rgb: np.ndarray):
    torch, _, _ = get_torch_modules()
    model, device = get_model()
    transform = _get_transform()
    idx_tensor = torch.arange(NUM_BINS, dtype=torch.float32, device=device)
    face_tensor = transform(_to_uint8_rgb(face_rgb)).unsqueeze(0).to(device)
    softmax = torch.nn.Softmax(dim=1)

    with torch.no_grad():
        gaze_yaw_logits, gaze_pitch_logits = model(face_tensor)
        yaw_predicted = softmax(gaze_yaw_logits)
        pitch_predicted = softmax(gaze_pitch_logits)
        pitch = torch.sum(pitch_predicted * idx_tensor, dim=1) * BIN_WIDTH_DEGREES + BIN_START_DEGREES
        yaw = torch.sum(yaw_predicted * idx_tensor, dim=1) * BIN_WIDTH_DEGREES + BIN_START_DEGREES

    return {
        "pitch": float(pitch.cpu().item()),
        "yaw": float(yaw.cpu().item()),
    }


def detect_gaze(frame: np.ndarray, baseline: GazeBaseline | None = None, tracker_id: str | None = None):
    faces, _ = extract_confident_faces(
        frame,
        min_confidence=FACE_CONFIDENCE_THRESHOLD,
    )
    best_face = _best_face_from_detections(frame, faces, MIN_FACE_AREA_RATIO)
    if best_face is None:
        return None

    tracker_state = _get_tracker_state(tracker_id)
    face_rgb = best_face["face"]["face"]
    raw_angles = predict_gaze(face_rgb)
    smoothed_angles = _smooth_gaze_angles(raw_angles, tracker_state)

    yaw = float(smoothed_angles["yaw"])
    pitch = float(smoothed_angles["pitch"])
    yaw_delta = None
    pitch_delta = None
    baseline_applied = baseline is not None

    if baseline is not None:
        yaw_delta = _apply_delta_deadzone(
            _angle_delta(yaw, baseline.yaw),
            DELTA_YAW_DEADZONE,
        )
        pitch_delta = _apply_delta_deadzone(
            _angle_delta(pitch, baseline.pitch),
            DELTA_PITCH_DEADZONE,
        )

    yaw_measure = yaw_delta if baseline_applied else yaw
    pitch_measure = pitch_delta if baseline_applied else pitch
    yaw_score = abs(yaw_measure) / (DELTA_YAW_THRESHOLD if baseline_applied else ABS_YAW_THRESHOLD)
    pitch_score = abs(pitch_measure) / (DELTA_PITCH_THRESHOLD if baseline_applied else ABS_PITCH_THRESHOLD)
    combined_score = (yaw_score * 0.58) + (pitch_score * 0.42)
    looking_away = (
        yaw_score >= 1.08 or
        pitch_score >= 1.12 or
        (yaw_score >= 0.90 and pitch_score >= 0.90) or
        combined_score >= 1.06
    )

    return {
        "face_confidence": round(float(best_face["confidence"]), 4),
        "face_area_ratio": round(float(best_face["area_ratio"]), 4),
        "raw_pitch": round(float(raw_angles["pitch"]), 4),
        "raw_yaw": round(float(raw_angles["yaw"]), 4),
        "pitch": round(pitch, 4),
        "yaw": round(yaw, 4),
        "pitch_delta": round(float(pitch_delta), 4) if pitch_delta is not None else None,
        "yaw_delta": round(float(yaw_delta), 4) if yaw_delta is not None else None,
        "baseline_applied": baseline_applied,
        "pitch_score": round(float(pitch_score), 4),
        "yaw_score": round(float(yaw_score), 4),
        "gaze_score": round(float(max(yaw_score, pitch_score)), 4),
        "combined_gaze_score": round(float(combined_score), 4),
        "turn_axis": "lateral" if abs(yaw_measure) >= abs(pitch_measure) else "vertical",
        "looking_away": looking_away,
        "smoothing_alpha": smoothed_angles["smoothing_alpha"],
        "tracker_reused": smoothed_angles["tracker_reused"],
        "tracker_reset_reason": smoothed_angles["tracker_reset_reason"],
        "tracker_frame_gap_ms": smoothed_angles["tracker_frame_gap_ms"],
    }


@router.post("/analyze")
async def analyze_gaze(request: Request):
    try:
        payload, _ = await parse_request_payload(request)
        frame = await get_frame_from_payload(payload, "frame")
        baseline_payload = parse_json_field(payload.get("baseline"), "baseline")
        baseline = GazeBaseline(**baseline_payload) if baseline_payload else None
        tracker_id = payload.get("tracker_id")
        gaze = detect_gaze(frame, baseline, tracker_id)

        if gaze is None:
            return {
                "tracking_available": True,
                "face_detected": False,
                "face_confidence": 0,
                "face_area_ratio": 0,
                "raw_pitch": 0,
                "raw_yaw": 0,
                "pitch": 0,
                "yaw": 0,
                "pitch_delta": None,
                "yaw_delta": None,
                "baseline_applied": baseline is not None,
                "pitch_score": 0,
                "yaw_score": 0,
                "gaze_score": 0,
                "combined_gaze_score": 0,
                "turn_axis": "none",
                "looking_away": False,
                "smoothing_alpha": 1.0,
                "tracker_reused": False,
                "tracker_reset_reason": "no_face",
                "tracker_frame_gap_ms": 0,
                "event": None,
                "reason": "face_not_detected_for_gaze",
            }

        return {
            "tracking_available": True,
            "face_detected": True,
            **gaze,
            "event": "gaze_away" if gaze["looking_away"] else None,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=503,
            detail=f"Gaze tracking unavailable: {exc}",
        ) from exc
