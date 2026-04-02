from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np
import cv2
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.frame_utils import base64_to_frame

router = APIRouter()

MODEL_ROOT = os.getenv(
    "OPENVINO_MODEL_ROOT",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models",
        "openvino",
        "intel",
    ),
)
PRECISION = os.getenv("OPENVINO_MODEL_PRECISION", "FP16")
FACE_DETECTION_THRESHOLD = 0.52
MIN_FACE_CONFIDENCE_FOR_GAZE = 0.52
MIN_GAZE_FACE_AREA_RATIO = 0.028
ABS_HORIZONTAL_ANGLE_THRESHOLD = 20.0
ABS_VERTICAL_ANGLE_THRESHOLD = 13.0
DELTA_HORIZONTAL_ANGLE_THRESHOLD = 12.0
DELTA_VERTICAL_ANGLE_THRESHOLD = 7.5
HEAD_YAW_ALLOWANCE_FACTOR = 0.45
HEAD_PITCH_ALLOWANCE_FACTOR = 0.2
DOWNWARD_HEAD_PITCH_ALLOWANCE_FACTOR = 0.08
DELTA_HORIZONTAL_DEADZONE = 2.5
DELTA_VERTICAL_DEADZONE = 2.0
ABS_DOWNWARD_ANGLE_THRESHOLD = 10.5
DELTA_DOWNWARD_ANGLE_THRESHOLD = 6.5
DOWNWARD_PITCH_SUPPORT_THRESHOLD = 7.0

_pipelines = None
_Core = None


class GazeBaseline(BaseModel):
    horizontal_angle: float
    vertical_angle: float


class FrameRequest(BaseModel):
    frame: str
    baseline: GazeBaseline | None = None


def get_openvino_core():
    global _Core

    if _Core is None:
        from openvino.runtime import Core

        _Core = Core

    return _Core


def _model_path(model_name: str) -> str:
    return os.path.join(MODEL_ROOT, model_name, PRECISION, f"{model_name}.xml")


def _preprocess(image: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    resized = cv2.resize(image, size)
    chw = resized.transpose(2, 0, 1)[np.newaxis, ...]
    return chw.astype(np.float32)


def _clip_box(x1: float, y1: float, x2: float, y2: float, width: int, height: int):
    left = max(0, int(round(x1)))
    top = max(0, int(round(y1)))
    right = min(width, int(round(x2)))
    bottom = min(height, int(round(y2)))
    return left, top, right, bottom


def _crop_square(image: np.ndarray, center: tuple[float, float], side: float) -> np.ndarray | None:
    height, width = image.shape[:2]
    half = side / 2.0
    left, top, right, bottom = _clip_box(
        center[0] - half,
        center[1] - half,
        center[0] + half,
        center[1] + half,
        width,
        height,
    )
    if right - left < 8 or bottom - top < 8:
        return None
    return image[top:bottom, left:right]


def _normalize_vector(vector: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vector)
    if norm == 0:
        return vector
    return vector / norm


def _compute_direction_scores(
    horizontal_angle: float,
    vertical_angle: float,
    yaw: float,
    pitch: float,
    baseline_applied: bool,
):
    horizontal_threshold = DELTA_HORIZONTAL_ANGLE_THRESHOLD if baseline_applied else ABS_HORIZONTAL_ANGLE_THRESHOLD
    vertical_threshold = DELTA_VERTICAL_ANGLE_THRESHOLD if baseline_applied else ABS_VERTICAL_ANGLE_THRESHOLD
    vertical_is_downward = vertical_angle > 0.0 and pitch > 0.0
    pitch_allowance_factor = (
        DOWNWARD_HEAD_PITCH_ALLOWANCE_FACTOR
        if vertical_is_downward
        else HEAD_PITCH_ALLOWANCE_FACTOR
    )

    adjusted_horizontal = max(0.0, abs(horizontal_angle) - (abs(yaw) * HEAD_YAW_ALLOWANCE_FACTOR))
    adjusted_vertical = max(0.0, abs(vertical_angle) - (abs(pitch) * pitch_allowance_factor))

    scores = {
        "horizontal": adjusted_horizontal / horizontal_threshold,
        "vertical": adjusted_vertical / vertical_threshold,
    }
    return scores, adjusted_horizontal, adjusted_vertical


def _apply_delta_deadzone(value: float | None, deadzone: float) -> float | None:
    if value is None:
        return None
    return 0.0 if abs(value) < deadzone else value


def get_pipelines():
    global _pipelines

    if _pipelines is None:
        required = {
            "face": _model_path("face-detection-adas-0001"),
            "landmarks": _model_path("facial-landmarks-35-adas-0002"),
            "head_pose": _model_path("head-pose-estimation-adas-0001"),
            "gaze": _model_path("gaze-estimation-adas-0002"),
        }

        missing = [path for path in required.values() if not os.path.exists(path)]
        if missing:
            raise RuntimeError(f"OpenVINO gaze model files not found: {missing}")

        core = get_openvino_core()()
        _pipelines = {
            "face": core.compile_model(required["face"], "CPU"),
            "landmarks": core.compile_model(required["landmarks"], "CPU"),
            "head_pose": core.compile_model(required["head_pose"], "CPU"),
            "gaze": core.compile_model(required["gaze"], "CPU"),
        }

    return _pipelines


def detect_gaze(frame: np.ndarray, baseline: GazeBaseline | None = None):
    pipelines = get_pipelines()

    face_model = pipelines["face"]
    landmarks_model = pipelines["landmarks"]
    head_pose_model = pipelines["head_pose"]
    gaze_model = pipelines["gaze"]

    height, width = frame.shape[:2]
    frame_area = max(float(height * width), 1.0)

    face_result = face_model([_preprocess(frame, (672, 384))])
    detections = face_result[face_model.output("detection_out")][0, 0]

    best_face = None
    best_area = -1.0
    best_confidence = 0.0

    for detection in detections:
        confidence = float(detection[2])
        if confidence < FACE_DETECTION_THRESHOLD:
            continue

        x1 = float(detection[3]) * width
        y1 = float(detection[4]) * height
        x2 = float(detection[5]) * width
        y2 = float(detection[6]) * height
        left, top, right, bottom = _clip_box(x1, y1, x2, y2, width, height)
        area = max(0, right - left) * max(0, bottom - top)

        if area > best_area:
            best_area = area
            best_confidence = confidence
            best_face = (left, top, right, bottom)

    if best_face is None:
        return None

    left, top, right, bottom = best_face
    if best_confidence < MIN_FACE_CONFIDENCE_FOR_GAZE:
        return None
    if ((right - left) * (bottom - top)) / frame_area < MIN_GAZE_FACE_AREA_RATIO:
        return None

    face_crop = frame[top:bottom, left:right]
    if face_crop.size == 0:
        return None

    landmarks_result = landmarks_model([_preprocess(face_crop, (60, 60))])
    raw_landmarks = landmarks_result[landmarks_model.output("align_fc3")][0]
    landmarks = raw_landmarks.reshape(-1, 2)

    face_h, face_w = face_crop.shape[:2]

    left_eye_center = (
        float((landmarks[0][0] + landmarks[1][0]) * 0.5 * face_w),
        float((landmarks[0][1] + landmarks[1][1]) * 0.5 * face_h),
    )
    right_eye_center = (
        float((landmarks[2][0] + landmarks[3][0]) * 0.5 * face_w),
        float((landmarks[2][1] + landmarks[3][1]) * 0.5 * face_h),
    )

    left_eye_width = max(8.0, abs(float(landmarks[1][0] - landmarks[0][0])) * face_w)
    right_eye_width = max(8.0, abs(float(landmarks[3][0] - landmarks[2][0])) * face_w)

    left_eye_crop = _crop_square(face_crop, left_eye_center, left_eye_width * 2.0)
    right_eye_crop = _crop_square(face_crop, right_eye_center, right_eye_width * 2.0)
    if left_eye_crop is None or right_eye_crop is None:
        return None

    head_pose_result = head_pose_model([_preprocess(face_crop, (60, 60))])
    yaw = float(head_pose_result[head_pose_model.output("angle_y_fc")][0][0])
    pitch = float(head_pose_result[head_pose_model.output("angle_p_fc")][0][0])
    roll = float(head_pose_result[head_pose_model.output("angle_r_fc")][0][0])

    gaze_result = gaze_model({
        "left_eye_image": _preprocess(left_eye_crop, (60, 60)),
        "right_eye_image": _preprocess(right_eye_crop, (60, 60)),
        "head_pose_angles": np.array([[yaw, pitch, roll]], dtype=np.float32),
    })
    gaze_vector = _normalize_vector(gaze_result[gaze_model.output("gaze_vector")][0])
    if gaze_vector.shape[0] < 3 or float(gaze_vector[2]) <= 0.05:
        return None

    horizontal_angle = float(np.degrees(np.arctan2(gaze_vector[0], gaze_vector[2])))
    vertical_angle = float(np.degrees(np.arctan2(-gaze_vector[1], gaze_vector[2])))

    horizontal_delta = None
    vertical_delta = None
    baseline_applied = False

    if baseline is not None:
        horizontal_delta = _apply_delta_deadzone(
            horizontal_angle - baseline.horizontal_angle,
            DELTA_HORIZONTAL_DEADZONE,
        )
        vertical_delta = _apply_delta_deadzone(
            vertical_angle - baseline.vertical_angle,
            DELTA_VERTICAL_DEADZONE,
        )
        baseline_applied = True

    horizontal_measure = horizontal_delta if baseline_applied else horizontal_angle
    vertical_measure = vertical_delta if baseline_applied else vertical_angle
    direction_scores, adjusted_horizontal, adjusted_vertical = _compute_direction_scores(
        horizontal_measure,
        vertical_measure,
        yaw,
        pitch,
        baseline_applied,
    )
    max_score = max(direction_scores.values())
    combined_score = (direction_scores["horizontal"] * 0.48) + (direction_scores["vertical"] * 0.52)
    strong_horizontal_signal = direction_scores["horizontal"] >= 1.16
    strong_vertical_signal = direction_scores["vertical"] >= 1.08
    combined_signal = direction_scores["horizontal"] >= 0.98 and direction_scores["vertical"] >= 0.78
    downward_threshold = (
        DELTA_DOWNWARD_ANGLE_THRESHOLD
        if baseline_applied
        else ABS_DOWNWARD_ANGLE_THRESHOLD
    )
    downward_signal = (
        vertical_measure is not None and
        vertical_measure > 0 and
        adjusted_vertical >= downward_threshold and
        (pitch >= DOWNWARD_PITCH_SUPPORT_THRESHOLD or direction_scores["vertical"] >= 1.0)
    )
    looking_away = (
        strong_horizontal_signal or
        strong_vertical_signal or
        combined_signal or
        downward_signal or
        combined_score >= 1.02
    )

    return {
        "face_confidence": best_confidence,
        "face_area_ratio": round(((right - left) * (bottom - top)) / frame_area, 4),
        "horizontal_angle": horizontal_angle,
        "vertical_angle": vertical_angle,
        "horizontal_angle_delta": horizontal_delta,
        "vertical_angle_delta": vertical_delta,
        "yaw": yaw,
        "pitch": pitch,
        "roll": roll,
        "gaze_vector": [float(component) for component in gaze_vector],
        "baseline_applied": baseline_applied,
        "adjusted_horizontal_angle": adjusted_horizontal,
        "adjusted_vertical_angle": adjusted_vertical,
        "gaze_score": round(max_score, 4),
        "combined_gaze_score": round(combined_score, 4),
        "looking_away": looking_away,
    }


@router.post("/analyze")
async def analyze_gaze(req: FrameRequest):
    try:
        frame = base64_to_frame(req.frame)
        gaze = detect_gaze(frame, req.baseline)
        if gaze is None:
            return {
                "tracking_available": True,
                "face_detected": False,
                "face_area_ratio": 0,
                "horizontal_angle": 0,
                "vertical_angle": 0,
                "horizontal_angle_delta": None,
                "vertical_angle_delta": None,
                "yaw": 0,
                "pitch": 0,
                "roll": 0,
                "gaze_vector": [0, 0, 0],
                "baseline_applied": req.baseline is not None,
                "adjusted_horizontal_angle": 0,
                "adjusted_vertical_angle": 0,
                "gaze_score": 0,
                "combined_gaze_score": 0,
                "looking_away": False,
                "event": None,
                "reason": "face_or_eyes_not_detected",
            }

        return {
            "tracking_available": True,
            "face_detected": True,
            "face_confidence": gaze["face_confidence"],
            "face_area_ratio": gaze["face_area_ratio"],
            "horizontal_angle": gaze["horizontal_angle"],
            "vertical_angle": gaze["vertical_angle"],
            "horizontal_angle_delta": gaze["horizontal_angle_delta"],
            "vertical_angle_delta": gaze["vertical_angle_delta"],
            "yaw": gaze["yaw"],
            "pitch": gaze["pitch"],
            "roll": gaze["roll"],
            "gaze_vector": gaze["gaze_vector"],
            "baseline_applied": gaze["baseline_applied"],
            "adjusted_horizontal_angle": gaze["adjusted_horizontal_angle"],
            "adjusted_vertical_angle": gaze["adjusted_vertical_angle"],
            "gaze_score": gaze["gaze_score"],
            "combined_gaze_score": gaze["combined_gaze_score"],
            "looking_away": gaze["looking_away"],
            "event": "gaze_away" if gaze["looking_away"] else None,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Gaze tracking unavailable: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Gaze tracking unavailable: {exc}",
        ) from exc
