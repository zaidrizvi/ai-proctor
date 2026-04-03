from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np
import cv2
import sys
import os
import time
import traceback
from threading import Lock

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.frame_utils import base64_to_frame

router = APIRouter()
_image_face_landmarker = None
_mp = None
_vision = None
_BaseOptions = None
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
ABS_DOWNWARD_PITCH_THRESHOLD = 24
ABS_DOWNWARD_NOSE_OFFSET_THRESHOLD = 0.095

DELTA_YAW_THRESHOLD = 12
DELTA_PITCH_THRESHOLD = 16
DELTA_NOSE_OFFSET_THRESHOLD = 0.16
DELTA_ROLL_THRESHOLD = 20
DELTA_DOWNWARD_PITCH_THRESHOLD = 14
DELTA_DOWNWARD_NOSE_OFFSET_THRESHOLD = 0.08
DELTA_YAW_DEADZONE = 4.0
DELTA_PITCH_DEADZONE = 5.5
DELTA_ROLL_DEADZONE = 5.0
DELTA_NOSE_DEADZONE = 0.045
POSE_SMOOTHING_ALPHA = 0.78
LOW_QUALITY_POSE_SMOOTHING_ALPHA = 0.55
HIGH_CHANGE_POSE_SMOOTHING_ALPHA = 0.86
STRONG_SIGNAL_POSE_SMOOTHING_ALPHA = 0.92
TRACKER_STATE_TTL_SECONDS = 4.5
TRACKER_RESET_GAP_SECONDS = 1.8
TRACKER_RESET_MOTION_SCORE = 1.28

POSE_KEYS = (
    "pitch",
    "yaw",
    "roll",
    "nose_offset_x",
    "nose_offset_y",
)

_tracker_states: dict[str, dict] = {}
_tracker_state_lock = Lock()


class HeadPoseBaseline(BaseModel):
    pitch: float
    yaw: float
    roll: float = 0.0
    nose_offset_x: float
    nose_offset_y: float


class FrameRequest(BaseModel):
    frame: str
    baseline: HeadPoseBaseline | None = None
    tracker_id: str | None = None


def get_mediapipe_tasks():
    global _mp, _vision, _BaseOptions

    if _mp is None or _vision is None or _BaseOptions is None:
        import mediapipe as mp
        from mediapipe.tasks.python import vision
        from mediapipe.tasks.python.core.base_options import BaseOptions

        _mp = mp
        _vision = vision
        _BaseOptions = BaseOptions

    return _mp, _vision, _BaseOptions


def get_face_landmarker():
    global _image_face_landmarker
    _, vision, _ = get_mediapipe_tasks()

    if _image_face_landmarker is None:
        _image_face_landmarker = vision.FaceLandmarker.create_from_options(
            _build_landmarker_options(vision.RunningMode.IMAGE)
        )

    return _image_face_landmarker


def _build_landmarker_options(running_mode):
    _, vision, BaseOptions = get_mediapipe_tasks()

    if not os.path.exists(_model_path):
        raise RuntimeError(
            f"MediaPipe face landmarker model not found at '{_model_path}'"
        )

    return vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=_model_path),
        running_mode=running_mode,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=True,
    )


def _create_video_face_landmarker():
    _, vision, _ = get_mediapipe_tasks()

    return vision.FaceLandmarker.create_from_options(
        _build_landmarker_options(vision.RunningMode.VIDEO)
    )


def _extract_pose_from_landmark_transform(result) -> dict | None:
    if not getattr(result, "facial_transformation_matrixes", None):
        return None

    transform = np.asarray(result.facial_transformation_matrixes[0], dtype=np.float64)
    if transform.shape[0] < 3 or transform.shape[1] < 3:
        return None

    rotation_mat = transform[:3, :3].copy()
    scales = np.linalg.norm(rotation_mat, axis=0)
    scales[scales < 1e-6] = 1.0
    rotation_mat = rotation_mat / scales

    if np.linalg.det(rotation_mat) < 0:
        rotation_mat[:, 2] *= -1.0

    pose_mat = cv2.hconcat([rotation_mat, np.zeros((3, 1), dtype=np.float64)])
    _, _, _, _, _, _, euler_angles = cv2.decomposeProjectionMatrix(pose_mat)

    return {
        "pitch": _normalize_angle(float(euler_angles[0][0])),
        "yaw": _normalize_angle(float(euler_angles[1][0])),
        "roll": _normalize_angle(float(euler_angles[2][0])),
    }


def _extract_pose_from_landmarks(landmarks, width: int, height: int) -> dict | None:
    model_points = np.array([
        (0.0, 0.0, 0.0),
        (0.0, -330.0, -65.0),
        (-225.0, 170.0, -135.0),
        (225.0, 170.0, -135.0),
        (-150.0, -150.0, -125.0),
        (150.0, -150.0, -125.0),
    ], dtype=np.float64)

    focal_length = width
    center = (width / 2, height / 2)
    camera_matrix = np.array([
        [focal_length, 0, center[0]],
        [0, focal_length, center[1]],
        [0, 0, 1],
    ], dtype=np.float64)
    dist_coeffs = np.zeros((4, 1), dtype=np.float64)

    image_points = np.array([
        (landmarks[1].x * width, landmarks[1].y * height),
        (landmarks[152].x * width, landmarks[152].y * height),
        (landmarks[263].x * width, landmarks[263].y * height),
        (landmarks[33].x * width, landmarks[33].y * height),
        (landmarks[287].x * width, landmarks[287].y * height),
        (landmarks[57].x * width, landmarks[57].y * height),
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

    return {
        "pitch": _normalize_angle(float(euler_angles[0][0])),
        "yaw": _normalize_angle(float(euler_angles[1][0])),
        "roll": _normalize_angle(float(euler_angles[2][0])),
    }


def _cleanup_tracker_states(now: float):
    expired_ids = [
        tracker_id
        for tracker_id, state in _tracker_states.items()
        if now - state["last_seen"] > TRACKER_STATE_TTL_SECONDS
    ]
    for tracker_id in expired_ids:
        state = _tracker_states.pop(tracker_id, None)
        state_lock = state.get("lock") if state else None
        if state_lock is None:
            continue
        with state_lock:
            state["landmarker"].close()


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
                "last_timestamp_ms": 0,
                "last_pose_seen_at": 0.0,
                "pose": None,
                "landmarker": _create_video_face_landmarker(),
            }
            _tracker_states[tracker_id] = state
        else:
            state["last_seen"] = now
        return state


def _next_video_timestamp_ms(state: dict):
    now_ms = int(time.monotonic() * 1000)
    timestamp_ms = max(int(state["last_timestamp_ms"]) + 1, now_ms)
    state["last_timestamp_ms"] = timestamp_ms
    return timestamp_ms


def _reset_tracker_pose(state: dict | None):
    if state is None:
        return

    with state["lock"]:
        state["pose"] = None
        state["last_pose_seen_at"] = 0.0


def _pose_motion_score(previous_pose: dict, pose: dict) -> float:
    return max(
        abs(pose["yaw"] - previous_pose["yaw"]) / 18.0,
        abs(pose["pitch"] - previous_pose["pitch"]) / 16.0,
        abs(pose["roll"] - previous_pose["roll"]) / 18.0,
        abs(pose["nose_offset_x"] - previous_pose["nose_offset_x"]) / 0.1,
        abs(pose["nose_offset_y"] - previous_pose["nose_offset_y"]) / 0.09,
    )


def _detect_landmarks(frame: np.ndarray, tracker_id: str | None):
    mp, _, _ = get_mediapipe_tasks()
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
    tracker_state = _get_tracker_state(tracker_id)

    if tracker_state is None:
        return get_face_landmarker().detect(mp_image), None

    with tracker_state["lock"]:
        tracker_state["last_seen"] = time.monotonic()
        return (
            tracker_state["landmarker"].detect_for_video(
                mp_image,
                _next_video_timestamp_ms(tracker_state),
            ),
            tracker_state,
        )


def smooth_pose(pose: dict, tracker_state: dict | None):
    if tracker_state is None:
        pose["smoothing_alpha"] = 1.0
        pose["tracker_reused"] = False
        pose["tracker_reset_reason"] = "stateless"
        pose["tracker_frame_gap_ms"] = 0
        pose["pose_motion_score"] = 0.0
        return pose

    with tracker_state["lock"]:
        previous_pose = tracker_state.get("pose")
        now = time.monotonic()
        tracker_state["last_seen"] = now
        frame_gap_ms = 0
        reset_reason = "none"

        if previous_pose is None:
            pose["smoothing_alpha"] = 1.0
            pose["tracker_reused"] = False
            pose["tracker_reset_reason"] = "cold_start"
            pose["tracker_frame_gap_ms"] = 0
            pose["pose_motion_score"] = 0.0
            tracker_state["pose"] = dict(pose)
            tracker_state["last_pose_seen_at"] = now
            return pose

        last_pose_seen_at = float(tracker_state.get("last_pose_seen_at") or 0.0)
        if last_pose_seen_at > 0.0:
            frame_gap_ms = int(round((now - last_pose_seen_at) * 1000))

        motion_score = _pose_motion_score(previous_pose, pose)
        if last_pose_seen_at and (now - last_pose_seen_at) > TRACKER_RESET_GAP_SECONDS:
            previous_pose = None
            reset_reason = "frame_gap"
        elif motion_score >= TRACKER_RESET_MOTION_SCORE:
            previous_pose = None
            reset_reason = "pose_jump"

        if previous_pose is None:
            pose["smoothing_alpha"] = 1.0
            pose["tracker_reused"] = False
            pose["tracker_reset_reason"] = reset_reason
            pose["tracker_frame_gap_ms"] = frame_gap_ms
            pose["pose_motion_score"] = round(motion_score, 4)
            tracker_state["pose"] = dict(pose)
            tracker_state["last_pose_seen_at"] = now
            return pose

        signal_strength = max(
            abs(pose["yaw"]) / 28.0,
            abs(pose["nose_offset_x"]) / 0.19,
            max(0.0, pose["pitch"]) / 22.0,
        )
        alpha = (
            STRONG_SIGNAL_POSE_SMOOTHING_ALPHA
            if signal_strength >= 1.0 and pose["pose_quality"] >= 0.42
            else HIGH_CHANGE_POSE_SMOOTHING_ALPHA
            if motion_score >= 0.72 and pose["pose_quality"] >= 0.45
            else POSE_SMOOTHING_ALPHA
            if pose["pose_quality"] >= 0.45
            else LOW_QUALITY_POSE_SMOOTHING_ALPHA
        )
        smoothed = {**pose}

        for key in POSE_KEYS:
            smoothed[key] = (previous_pose[key] * (1.0 - alpha)) + (pose[key] * alpha)

        smoothed["pose_quality"] = round(
            (previous_pose["pose_quality"] * 0.35) + (pose["pose_quality"] * 0.65),
            4,
        )
        smoothed["smoothing_alpha"] = round(alpha, 4)
        smoothed["tracker_reused"] = True
        smoothed["tracker_reset_reason"] = reset_reason
        smoothed["tracker_frame_gap_ms"] = frame_gap_ms
        smoothed["pose_motion_score"] = round(motion_score, 4)
        tracker_state["pose"] = dict(smoothed)
        tracker_state["last_pose_seen_at"] = now
        return smoothed


def get_head_pose(frame: np.ndarray, tracker_id: str | None = None):
    h, w = frame.shape[:2]
    result, tracker_state = _detect_landmarks(frame, tracker_id)

    if not result.face_landmarks:
        _reset_tracker_pose(tracker_state)
        return None

    landmarks = result.face_landmarks[0]
    nose_tip = landmarks[1]
    pose_angles = _extract_pose_from_landmark_transform(result)
    if pose_angles is None:
        pose_angles = _extract_pose_from_landmarks(landmarks, w, h)
    if pose_angles is None:
        return None

    pose = {
        **pose_angles,
        "nose_offset_x": float(nose_tip.x - 0.5),
        "nose_offset_y": float(nose_tip.y - 0.5),
    }
    pose["pose_quality"] = _estimate_pose_quality(
        pose["pitch"],
        pose["yaw"],
        pose["roll"],
        pose["nose_offset_x"],
        pose["nose_offset_y"],
    )
    return smooth_pose(pose, tracker_state)


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


def _downward_signal(
    pitch_value: float,
    nose_y_value: float,
    pitch_threshold: float,
    nose_threshold: float,
):
    pitch_score = max(0.0, pitch_value) / pitch_threshold
    nose_score = max(0.0, nose_y_value) / nose_threshold
    balanced_signal = (
        (pitch_score >= 1.0 and nose_score >= 0.95) or
        (pitch_score >= 0.9 and nose_score >= 1.05)
    )
    pitch_dominant_signal = pitch_score >= 1.45 and nose_score >= 0.7
    nose_dominant_signal = nose_score >= 1.55 and pitch_score >= 0.55
    signal = balanced_signal or pitch_dominant_signal or nose_dominant_signal
    trigger_reason = (
        "balanced"
        if balanced_signal else
        "pitch_dominant"
        if pitch_dominant_signal else
        "nose_dominant"
        if nose_dominant_signal else
        "none"
    )
    return signal, round(max(pitch_score, nose_score), 4), {
        "pitch_score": round(pitch_score, 4),
        "nose_score": round(nose_score, 4),
        "trigger_reason": trigger_reason,
    }


def classify_looking_away(pose: dict, baseline: HeadPoseBaseline | None):
    deltas = build_pose_deltas(pose, baseline)
    turn_axis = "none"
    threshold_path = "delta" if baseline is not None else "absolute"

    if baseline is None:
        metrics = {
            "yaw": abs(pose["yaw"]) / ABS_YAW_THRESHOLD,
            "roll": abs(pose["roll"]) / ABS_ROLL_THRESHOLD,
            "nose_x": abs(pose["nose_offset_x"]) / ABS_NOSE_OFFSET_THRESHOLD,
        }
        downward_signal, downward_score, downward_debug = _downward_signal(
            pose["pitch"],
            pose["nose_offset_y"],
            ABS_DOWNWARD_PITCH_THRESHOLD,
            ABS_DOWNWARD_NOSE_OFFSET_THRESHOLD,
        )
        clear_yaw_turn = abs(pose["yaw"]) >= 24.0
        obvious_turn = (
            pose["pose_quality"] >= 0.44 and
            (
                abs(pose["yaw"]) >= 30.0 or
                (
                    abs(pose["yaw"]) >= 22.0 and
                    abs(pose["nose_offset_x"]) >= 0.145
                )
            )
        )
        strong_signal = max(metrics.values()) >= 1.24
        multi_signal = sum(value >= 1.0 for value in metrics.values()) >= 2
        lateral_signal = metrics["yaw"] >= 0.92 or metrics["nose_x"] >= 0.86
        combined_score = (
            metrics["yaw"] * 0.72 +
            metrics["nose_x"] * 0.2 +
            metrics["roll"] * 0.08
        )
        looking_away = (
            pose["pose_quality"] >= 0.46 and
            (
                clear_yaw_turn or
                downward_signal or
                (
                    lateral_signal and
                    (strong_signal or multi_signal or combined_score >= 1.12)
                )
            )
        )
        if clear_yaw_turn or lateral_signal:
            turn_axis = "lateral"
        elif downward_signal:
            turn_axis = "downward"
    else:
        metrics = {
            "yaw": abs(deltas["yaw_delta"]) / DELTA_YAW_THRESHOLD,
            "roll": abs(deltas["roll_delta"]) / DELTA_ROLL_THRESHOLD,
            "nose_x": abs(deltas["nose_offset_x_delta"]) / DELTA_NOSE_OFFSET_THRESHOLD,
        }
        downward_signal, downward_score, downward_debug = _downward_signal(
            deltas["pitch_delta"],
            deltas["nose_offset_y_delta"],
            DELTA_DOWNWARD_PITCH_THRESHOLD,
            DELTA_DOWNWARD_NOSE_OFFSET_THRESHOLD,
        )
        clear_yaw_turn = abs(deltas["yaw_delta"]) >= 16.0
        obvious_turn = (
            pose["pose_quality"] >= 0.4 and
            (
                abs(deltas["yaw_delta"]) >= 22.0 or
                (
                    abs(deltas["yaw_delta"]) >= 16.0 and
                    abs(deltas["nose_offset_x_delta"]) >= 0.11
                )
            )
        )
        strong_signal = max(metrics.values()) >= 1.18
        multi_signal = sum(value >= 1.0 for value in metrics.values()) >= 2
        lateral_signal = metrics["yaw"] >= 0.94 or metrics["nose_x"] >= 0.88
        combined_score = (
            metrics["yaw"] * 0.74 +
            metrics["nose_x"] * 0.18 +
            metrics["roll"] * 0.08
        )
        looking_away = (
            pose["pose_quality"] >= 0.43 and
            (
                clear_yaw_turn or
                downward_signal or
                (
                    lateral_signal and
                    (strong_signal or multi_signal or combined_score >= 1.08)
                )
            )
        )
        if clear_yaw_turn or lateral_signal:
            turn_axis = "lateral"
        elif downward_signal:
            turn_axis = "downward"

    signal_reasons = []
    if clear_yaw_turn:
        signal_reasons.append("clear_yaw_turn")
    if downward_signal:
        signal_reasons.append(f"downward:{downward_debug['trigger_reason']}")
    if lateral_signal and (strong_signal or multi_signal or combined_score >= 1.08):
        signal_reasons.append("lateral_combined")

    debug = {
        "threshold_path_used": threshold_path,
        "movement_reason": signal_reasons[0] if signal_reasons else "none",
        "signal_reasons": signal_reasons,
        "clear_yaw_turn": clear_yaw_turn,
        "lateral_signal": lateral_signal,
        "strong_signal": strong_signal,
        "multi_signal": multi_signal,
        "metrics": {key: round(value, 4) for key, value in metrics.items()},
        "downward_pitch_score": downward_debug["pitch_score"],
        "downward_nose_score": downward_debug["nose_score"],
        "downward_trigger_reason": downward_debug["trigger_reason"],
        "downward_score": downward_score,
        "combined_score": round(combined_score, 4),
    }

    return looking_away, obvious_turn, turn_axis, downward_signal, deltas, metrics, round(max(combined_score, downward_score), 4), debug


@router.post("/analyze")
async def analyze_head_pose(req: FrameRequest):
    try:
        frame = base64_to_frame(req.frame)
        pose = get_head_pose(frame, req.tracker_id)

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

        looking_away, obvious_turn, turn_axis, downward_signal, deltas, metrics, combined_score, debug = classify_looking_away(pose, req.baseline)

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
            "obvious_turn": obvious_turn,
            "turn_axis": turn_axis,
            "downward_signal": downward_signal,
            "looking_away": looking_away,
            "event": "head_turned" if looking_away else None,
            "baseline_applied": req.baseline is not None,
            "threshold_path_used": debug["threshold_path_used"],
            "movement_reason": debug["movement_reason"],
            "signal_reasons": debug["signal_reasons"],
            "clear_yaw_turn": debug["clear_yaw_turn"],
            "lateral_signal": debug["lateral_signal"],
            "strong_signal": debug["strong_signal"],
            "multi_signal": debug["multi_signal"],
            "downward_pitch_score": debug["downward_pitch_score"],
            "downward_nose_score": debug["downward_nose_score"],
            "downward_trigger_reason": debug["downward_trigger_reason"],
            "debug_metrics": debug["metrics"],
            "debug_combined_score": debug["combined_score"],
            "smoothing_alpha": pose.get("smoothing_alpha", 1.0),
            "tracker_reused": pose.get("tracker_reused", False),
            "tracker_reset_reason": pose.get("tracker_reset_reason", "none"),
            "tracker_frame_gap_ms": pose.get("tracker_frame_gap_ms", 0),
            "pose_motion_score": pose.get("pose_motion_score", 0.0),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=503,
            detail=f"Head pose tracking unavailable: {exc}",
        ) from exc
