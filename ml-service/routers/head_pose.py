from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np
import cv2
import sys
import os
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.frame_utils import base64_to_frame

router = APIRouter()
_face_landmarker = None
_model_path = os.getenv(
    "MEDIAPIPE_FACE_LANDMARKER_MODEL",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models",
        "face_landmarker.task",
    ),
)

ABS_YAW_THRESHOLD = 24
ABS_PITCH_THRESHOLD = 17
ABS_NOSE_OFFSET_THRESHOLD = 0.18
ABS_ROLL_THRESHOLD = 24

DELTA_YAW_THRESHOLD = 12
DELTA_PITCH_THRESHOLD = 16
DELTA_NOSE_OFFSET_THRESHOLD = 0.16
DELTA_ROLL_THRESHOLD = 20
DELTA_YAW_DEADZONE = 4.0
DELTA_PITCH_DEADZONE = 5.5
DELTA_ROLL_DEADZONE = 5.0
DELTA_NOSE_DEADZONE = 0.045


class HeadPoseBaseline(BaseModel):
    pitch: float
    yaw: float
    roll: float = 0.0
    nose_offset_x: float
    nose_offset_y: float


class FrameRequest(BaseModel):
    frame: str
    baseline: HeadPoseBaseline | None = None


def get_face_landmarker():
    global _face_landmarker

    if _face_landmarker is None:
        if not os.path.exists(_model_path):
            raise RuntimeError(
                f"MediaPipe face landmarker model not found at '{_model_path}'"
            )

        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=_model_path),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
        )
        _face_landmarker = vision.FaceLandmarker.create_from_options(options)

    return _face_landmarker


def get_head_pose(frame: np.ndarray):
    h, w = frame.shape[:2]

    model_points = np.array([
        (0.0, 0.0, 0.0),
        (0.0, -330.0, -65.0),
        (-225.0, 170.0, -135.0),
        (225.0, 170.0, -135.0),
        (-150.0, -150.0, -125.0),
        (150.0, -150.0, -125.0),
    ], dtype=np.float64)

    focal_length = w
    center = (w / 2, h / 2)
    camera_matrix = np.array([
        [focal_length, 0, center[0]],
        [0, focal_length, center[1]],
        [0, 0, 1],
    ], dtype=np.float64)
    dist_coeffs = np.zeros((4, 1), dtype=np.float64)

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
    result = get_face_landmarker().detect(mp_image)

    if not result.face_landmarks:
        return None

    landmarks = result.face_landmarks[0]
    nose_tip = landmarks[1]
    image_points = np.array([
        (landmarks[1].x * w, landmarks[1].y * h),
        (landmarks[152].x * w, landmarks[152].y * h),
        (landmarks[263].x * w, landmarks[263].y * h),
        (landmarks[33].x * w, landmarks[33].y * h),
        (landmarks[287].x * w, landmarks[287].y * h),
        (landmarks[57].x * w, landmarks[57].y * h),
    ], dtype=np.float64)

    success, rotation_vec, translation_vec = cv2.solvePnP(
        model_points,
        image_points,
        camera_matrix,
        dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not success:
        return None

    rotation_mat, _ = cv2.Rodrigues(rotation_vec)
    pose_mat = cv2.hconcat([rotation_mat, translation_vec])
    _, _, _, _, _, _, euler_angles = cv2.decomposeProjectionMatrix(pose_mat)

    pitch = _normalize_angle(float(euler_angles[0][0]))
    yaw = _normalize_angle(float(euler_angles[1][0]))
    roll = _normalize_angle(float(euler_angles[2][0]))
    nose_offset_x = float(nose_tip.x - 0.5)
    nose_offset_y = float(nose_tip.y - 0.5)

    return {
        "pitch": pitch,
        "yaw": yaw,
        "roll": roll,
        "nose_offset_x": nose_offset_x,
        "nose_offset_y": nose_offset_y,
        "pose_quality": _estimate_pose_quality(pitch, yaw, roll, nose_offset_x, nose_offset_y),
    }


def _normalize_angle(angle: float) -> float:
    normalized = ((angle + 180.0) % 360.0) - 180.0
    if normalized > 90.0:
        normalized -= 180.0
    if normalized < -90.0:
        normalized += 180.0
    return normalized


def _estimate_pose_quality(
    pitch: float,
    yaw: float,
    roll: float,
    nose_offset_x: float,
    nose_offset_y: float,
) -> float:
    penalties = (
        min(abs(yaw) / 65.0, 1.0) * 0.35 +
        min(abs(pitch) / 55.0, 1.0) * 0.25 +
        min(abs(roll) / 45.0, 1.0) * 0.15 +
        min(abs(nose_offset_x) / 0.32, 1.0) * 0.15 +
        min(abs(nose_offset_y) / 0.28, 1.0) * 0.10
    )
    return round(max(0.0, 1.0 - penalties), 4)


def build_pose_deltas(pose: dict, baseline: HeadPoseBaseline | None):
    if baseline is None:
        return {
            "pitch_delta": pose["pitch"],
            "yaw_delta": pose["yaw"],
            "roll_delta": pose["roll"],
            "nose_offset_x_delta": pose["nose_offset_x"],
            "nose_offset_y_delta": pose["nose_offset_y"],
        }

    return {
        "pitch_delta": _apply_delta_deadzone(pose["pitch"] - baseline.pitch, DELTA_PITCH_DEADZONE),
        "yaw_delta": _apply_delta_deadzone(pose["yaw"] - baseline.yaw, DELTA_YAW_DEADZONE),
        "roll_delta": _apply_delta_deadzone(pose["roll"] - baseline.roll, DELTA_ROLL_DEADZONE),
        "nose_offset_x_delta": _apply_delta_deadzone(
            pose["nose_offset_x"] - baseline.nose_offset_x,
            DELTA_NOSE_DEADZONE,
        ),
        "nose_offset_y_delta": _apply_delta_deadzone(
            pose["nose_offset_y"] - baseline.nose_offset_y,
            DELTA_NOSE_DEADZONE,
        ),
    }


def _apply_delta_deadzone(value: float, deadzone: float) -> float:
    return 0.0 if abs(value) < deadzone else value


def classify_looking_away(pose: dict, baseline: HeadPoseBaseline | None):
    deltas = build_pose_deltas(pose, baseline)

    if baseline is None:
        metrics = {
            "yaw": abs(pose["yaw"]) / ABS_YAW_THRESHOLD,
            "pitch": abs(pose["pitch"]) / ABS_PITCH_THRESHOLD,
            "roll": abs(pose["roll"]) / ABS_ROLL_THRESHOLD,
            "nose_x": abs(pose["nose_offset_x"]) / ABS_NOSE_OFFSET_THRESHOLD,
            "nose_y": abs(pose["nose_offset_y"]) / ABS_NOSE_OFFSET_THRESHOLD,
        }
        clear_yaw_turn = abs(pose["yaw"]) >= 22.0
        strong_signal = max(metrics.values()) >= 1.24
        multi_signal = sum(value >= 1.02 for value in metrics.values()) >= 2
        lateral_signal = metrics["yaw"] >= 0.88 or metrics["nose_x"] >= 0.82
        combined_score = (
            metrics["yaw"] * 0.62 +
            metrics["pitch"] * 0.08 +
            metrics["nose_x"] * 0.20 +
            metrics["nose_y"] * 0.05 +
            metrics["roll"] * 0.05
        )
        looking_away = (
            pose["pose_quality"] >= 0.5 and
            (
                clear_yaw_turn or
                (
                    lateral_signal and
                    (strong_signal or multi_signal or combined_score >= 1.08)
                )
            )
        )
    else:
        metrics = {
            "yaw": abs(deltas["yaw_delta"]) / DELTA_YAW_THRESHOLD,
            "pitch": abs(deltas["pitch_delta"]) / DELTA_PITCH_THRESHOLD,
            "roll": abs(deltas["roll_delta"]) / DELTA_ROLL_THRESHOLD,
            "nose_x": abs(deltas["nose_offset_x_delta"]) / DELTA_NOSE_OFFSET_THRESHOLD,
            "nose_y": abs(deltas["nose_offset_y_delta"]) / DELTA_NOSE_OFFSET_THRESHOLD,
        }
        clear_yaw_turn = abs(deltas["yaw_delta"]) >= 15.0
        strong_signal = max(metrics.values()) >= 1.18
        multi_signal = sum(value >= 1.02 for value in metrics.values()) >= 2
        lateral_signal = metrics["yaw"] >= 0.9 or metrics["nose_x"] >= 0.84
        combined_score = (
            metrics["yaw"] * 0.66 +
            metrics["pitch"] * 0.08 +
            metrics["nose_x"] * 0.18 +
            metrics["nose_y"] * 0.04 +
            metrics["roll"] * 0.04
        )
        looking_away = (
            pose["pose_quality"] >= 0.47 and
            (
                clear_yaw_turn or
                (
                    lateral_signal and
                    (strong_signal or multi_signal or combined_score >= 1.04)
                )
            )
        )

    return looking_away, deltas, metrics, round(combined_score, 4)


@router.post("/analyze")
async def analyze_head_pose(req: FrameRequest):
    try:
        frame = base64_to_frame(req.frame)
        pose = get_head_pose(frame)

        if pose is None:
            return {
                "tracking_available": True,
                "head_detected": False,
                "pitch": 0,
                "yaw": 0,
                "roll": 0,
                "nose_offset_x": 0,
                "nose_offset_y": 0,
                "pitch_delta": 0,
                "yaw_delta": 0,
                "roll_delta": 0,
                "nose_offset_x_delta": 0,
                "nose_offset_y_delta": 0,
                "looking_away": False,
                "event": None,
                "baseline_applied": req.baseline is not None,
            }

        looking_away, deltas, metrics, combined_score = classify_looking_away(pose, req.baseline)

        return {
            "tracking_available": True,
            "head_detected": True,
            "pitch": pose["pitch"],
            "yaw": pose["yaw"],
            "roll": pose["roll"],
            "nose_offset_x": pose["nose_offset_x"],
            "nose_offset_y": pose["nose_offset_y"],
            "pose_quality": pose["pose_quality"],
            **deltas,
            "movement_score": round(max(metrics.values()), 4),
            "combined_movement_score": combined_score,
            "looking_away": looking_away,
            "event": "head_turned" if looking_away else None,
            "baseline_applied": req.baseline is not None,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Head pose tracking unavailable: {exc}",
        ) from exc
