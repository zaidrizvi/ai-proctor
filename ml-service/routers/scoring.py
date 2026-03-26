from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

def damp_count(count: int, cap: int = 3, tail_factor: float = 0.35) -> float:
    if count <= cap:
        return float(count)
    return float(cap) + ((count - cap) * tail_factor)

class SuspicionInput(BaseModel):
    face_not_detected_count: int = 0
    multiple_faces_count: int = 0
    face_mismatch_count: int = 0
    gaze_away_count: int = 0
    head_turned_count: int = 0
    tab_switch_count: int = 0
    fullscreen_exit_count: int = 0
    audio_detected_count: int = 0
    object_detected_count: int = 0
    total_checks: int = 1

@router.post("/calculate")
async def calculate_suspicion(data: SuspicionInput):
    """Calculate overall suspicion score 0-100"""

    # weights for each event type
    weights = {
        "face_not_detected": 3,
        "multiple_faces": 8,
        "face_mismatch": 10,
        "gaze_away": 3,
        "head_turned": 1,
        "tab_switch": 5,
        "fullscreen_exit": 4,
        "audio_detected": 2,
        "object_detected": 5,
    }

    sustained_movement = max(0.0, (data.gaze_away_count * 0.75) + (data.head_turned_count * 0.35))
    identity_issues = data.face_not_detected_count + data.multiple_faces_count + data.face_mismatch_count
    behavior_issues = data.tab_switch_count + data.fullscreen_exit_count

    raw_score = (
        damp_count(data.face_not_detected_count, cap=4, tail_factor=0.3) * weights["face_not_detected"] +
        damp_count(data.multiple_faces_count, cap=2, tail_factor=0.5) * weights["multiple_faces"] +
        damp_count(data.face_mismatch_count, cap=2, tail_factor=0.4) * weights["face_mismatch"] +
        damp_count(int(round(sustained_movement)), cap=4, tail_factor=0.3) * weights["gaze_away"] +
        damp_count(data.head_turned_count, cap=3, tail_factor=0.2) * weights["head_turned"] +
        damp_count(data.tab_switch_count, cap=3, tail_factor=0.5) * weights["tab_switch"] +
        damp_count(data.fullscreen_exit_count, cap=2, tail_factor=0.6) * weights["fullscreen_exit"] +
        damp_count(data.audio_detected_count, cap=2, tail_factor=0.15) * weights["audio_detected"] +
        damp_count(data.object_detected_count, cap=2, tail_factor=0.25) * weights["object_detected"]
    )

    if identity_issues >= 3:
        raw_score += 4.0
    if behavior_issues >= 3:
        raw_score += 3.0

    total_checks = max(1, data.total_checks)
    normalized_score = (raw_score / total_checks) * 5.2
    score = min(100, normalized_score)

    risk_level = (
        "high" if score >= 65 else
        "medium" if score >= 30 else
        "low"
    )

    return {
        "suspicion_score": round(score),
        "risk_level": risk_level,
        "raw_score": round(raw_score, 2),
        "normalized_per_check": round(raw_score / total_checks, 2),
        "breakdown": {
            "face_issues": data.face_not_detected_count + data.multiple_faces_count + data.face_mismatch_count,
            "movement_issues": data.gaze_away_count + data.head_turned_count,
            "behavior_issues": data.tab_switch_count + data.fullscreen_exit_count,
            "environment_issues": data.audio_detected_count + data.object_detected_count,
        }
    }
