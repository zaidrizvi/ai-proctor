from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from deepface import DeepFace
import sys
import os
from typing import List, Optional
import numpy as np

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.frame_utils import base64_to_frame

router = APIRouter()

FACE_CONFIDENCE_THRESHOLD = 0.5
FACE_PRESENCE_CONFIDENCE_THRESHOLD = 0.38
MIN_FACE_PRESENCE_AREA_RATIO = 0.02
MIN_REFERENCE_FACE_AREA_RATIO = 0.05
MIN_CURRENT_FACE_AREA_RATIO = 0.04
MIN_VERIFICATION_FACE_AREA_RATIO = 0.05
MIN_VERIFICATION_FACE_CONFIDENCE = 0.6
SECONDARY_FACE_MIN_AREA_RATIO = 0.018
SECONDARY_FACE_MIN_RELATIVE_SIZE = 0.28
VERIFICATION_MODEL = "Facenet512"
DETECTION_BACKENDS = ("yunet", "opencv")
VERIFY_DETECTOR_BACKENDS = ("yunet", "opencv")
COSINE_DISTANCE_THRESHOLD = 0.4
MAX_COSINE_DISTANCE_THRESHOLD = 0.46
class FrameRequest(BaseModel):
    frame: str  # base64 image


class VerifyRequest(BaseModel):
    frame: str  # current webcam frame
    reference: Optional[str] = None  # registered face image (base64)
    reference_embedding: Optional[List[float]] = None


def extract_confident_faces(frame, backends=DETECTION_BACKENDS, min_confidence=FACE_CONFIDENCE_THRESHOLD):
    best_faces = []
    best_backend = None
    best_score = -1.0
    backend_errors = []
    frame_h, frame_w = frame.shape[:2]
    frame_area = max(float(frame_h * frame_w), 1.0)

    for backend in backends:
        try:
            faces = DeepFace.extract_faces(
                img_path=frame,
                detector_backend=backend,
                enforce_detection=False,
            )
            confident = [
                face for face in faces if face.get("confidence", 0) >= min_confidence
            ]
            confident.sort(
                key=lambda face: (
                    float(face.get("confidence", 0.0)),
                    _face_area_ratio(face.get("facial_area"), frame_area),
                ),
                reverse=True,
            )

            top_confidence = float(confident[0].get("confidence", 0.0)) if confident else 0.0
            top_area_ratio = _face_area_ratio(
                confident[0].get("facial_area"), frame_area
            ) if confident else 0.0
            backend_score = (len(confident) * 10.0) + (top_confidence * 3.0) + top_area_ratio

            if backend_score > best_score:
                best_faces = confident
                best_backend = backend
                best_score = backend_score
        except Exception as exc:
            backend_errors.append(f"{backend}: {exc}")

    if not best_faces and len(backend_errors) == len(backends):
        raise RuntimeError("; ".join(backend_errors))

    return best_faces, best_backend


def build_face_embedding(face):
    # DeepFace.extract_faces returns RGB; convert back to BGR for represent().
    face_bgr = face[:, :, ::-1]
    embedding_obj = DeepFace.represent(
        img_path=face_bgr,
        model_name=VERIFICATION_MODEL,
        detector_backend="skip",
        enforce_detection=False,
    )
    return embedding_obj[0]["embedding"]


def _face_area_ratio(facial_area, frame_area: float) -> float:
    if not facial_area or frame_area <= 0:
        return 0.0

    width = max(0.0, float(facial_area.get("w", 0.0)))
    height = max(0.0, float(facial_area.get("h", 0.0)))
    return (width * height) / frame_area


def _rank_face_candidates(frame, faces):
    frame_h, frame_w = frame.shape[:2]
    frame_area = max(float(frame_h * frame_w), 1.0)
    candidates = []

    for face in faces:
        confidence = float(face.get("confidence", 0.0))
        facial_area = face.get("facial_area") or {}
        area_ratio = _face_area_ratio(facial_area, frame_area)
        candidates.append({
            "face": face,
            "confidence": confidence,
            "area_ratio": area_ratio,
        })

    candidates.sort(
        key=lambda item: (item["area_ratio"], item["confidence"]),
        reverse=True,
    )

    return candidates


def _best_face_from_detections(frame, faces, min_area_ratio: float):
    candidates = _rank_face_candidates(frame, faces)

    if not candidates:
        return None

    best = candidates[0]
    if best["area_ratio"] < min_area_ratio:
        return None

    return best


def _count_reliable_faces(frame, faces):
    candidates = _rank_face_candidates(frame, faces)

    if not candidates:
        return 0, candidates

    reliable_count = 1
    primary_area_ratio = max(float(candidates[0]["area_ratio"]), 1e-6)

    for candidate in candidates[1:]:
        if (
            candidate["area_ratio"] >= SECONDARY_FACE_MIN_AREA_RATIO and
            candidate["area_ratio"] >= (primary_area_ratio * SECONDARY_FACE_MIN_RELATIVE_SIZE)
        ):
            reliable_count += 1

    return reliable_count, candidates


def _cosine_distance(embedding_a, embedding_b) -> float:
    vector_a = np.asarray(embedding_a, dtype=np.float32)
    vector_b = np.asarray(embedding_b, dtype=np.float32)

    norm_a = float(np.linalg.norm(vector_a))
    norm_b = float(np.linalg.norm(vector_b))
    if norm_a == 0.0 or norm_b == 0.0:
        raise ValueError("Face embedding norm is zero")

    similarity = float(np.dot(vector_a, vector_b) / (norm_a * norm_b))
    similarity = max(-1.0, min(1.0, similarity))
    return 1.0 - similarity


def _verification_threshold_for_face(face_candidate):
    if face_candidate is None:
        return None

    area_ratio = float(face_candidate["area_ratio"])
    confidence = float(face_candidate["confidence"])

    if (
        area_ratio < MIN_VERIFICATION_FACE_AREA_RATIO or
        confidence < MIN_VERIFICATION_FACE_CONFIDENCE
    ):
        return None

    area_bonus = min(max((0.085 - area_ratio) / 0.04, 0.0), 1.0) * 0.04
    confidence_bonus = min(max((0.78 - confidence) / 0.18, 0.0), 1.0) * 0.02
    return round(
        min(MAX_COSINE_DISTANCE_THRESHOLD, COSINE_DISTANCE_THRESHOLD + area_bonus + confidence_bonus),
        4,
    )


def extract_embedding(frame, backends=VERIFY_DETECTOR_BACKENDS):
    faces, backend = extract_confident_faces(frame, backends=backends)

    if len(faces) != 1 or backend is None:
        return {
            "embedding": None,
            "face_count": len(faces),
            "backend": backend,
        }

    return {
        "embedding": build_face_embedding(faces[0]["face"]),
        "face_count": 1,
        "backend": backend,
    }


@router.post("/detect")
async def detect_face(req: FrameRequest):
    """Detect if face is present and count faces"""
    try:
        frame = base64_to_frame(req.frame)
        reliable_faces, backend = extract_confident_faces(frame)
        presence_faces = reliable_faces
        presence_backend = backend

        if not presence_faces:
            presence_faces, presence_backend = extract_confident_faces(
                frame,
                min_confidence=FACE_PRESENCE_CONFIDENCE_THRESHOLD,
            )

        reliable_face_count, ranked_reliable_faces = _count_reliable_faces(frame, reliable_faces)
        ranked_presence_faces = _rank_face_candidates(frame, presence_faces)
        best_face = ranked_presence_faces[0] if ranked_presence_faces else None
        face_detected = bool(
            best_face and
            best_face["area_ratio"] >= MIN_FACE_PRESENCE_AREA_RATIO
        )
        raw_face_count = len(ranked_presence_faces) if face_detected else 0

        return {
            "analysis_available": True,
            "face_detected": face_detected,
            "face_count": reliable_face_count,
            "raw_face_count": raw_face_count,
            "multiple_faces": reliable_face_count > 1,
            "backend": backend or presence_backend,
            "primary_face_confidence": round(best_face["confidence"], 4) if best_face else 0.0,
            "primary_face_area_ratio": round(best_face["area_ratio"], 4) if best_face else 0.0,
            "event": "multiple_faces" if reliable_face_count > 1 else
                     "face_not_detected" if not face_detected else None,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Face detection unavailable: {exc}",
        ) from exc


@router.post("/reference-embedding")
async def create_reference_embedding(req: FrameRequest):
    """Create a cached Facenet512 embedding for a reference image"""
    try:
        frame = base64_to_frame(req.frame)
        faces, backend = extract_confident_faces(frame, backends=VERIFY_DETECTOR_BACKENDS)
        face_count = len(faces)
        best_face = _best_face_from_detections(frame, faces, MIN_REFERENCE_FACE_AREA_RATIO)

        if face_count != 1 or backend is None or best_face is None:
            return {
                "analysis_available": True,
                "embedding_created": False,
                "embedding": None,
                "face_detected": face_count > 0,
                "face_count": face_count,
                "multiple_faces": face_count > 1,
                "backend": backend,
                "primary_face_area_ratio": round(best_face["area_ratio"], 4) if best_face else 0.0,
                "reason": "reference_frame_requires_exactly_one_face",
            }

        embedding = build_face_embedding(best_face["face"]["face"])
        return {
            "analysis_available": True,
            "embedding_created": True,
            "embedding": embedding,
            "face_detected": True,
            "face_count": 1,
            "multiple_faces": False,
            "backend": backend,
            "primary_face_confidence": round(best_face["confidence"], 4),
            "primary_face_area_ratio": round(best_face["area_ratio"], 4),
            "model": VERIFICATION_MODEL,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Reference embedding unavailable: {exc}",
        ) from exc


@router.post("/verify")
async def verify_face(req: VerifyRequest):
    """Verify if current face matches registered face"""
    try:
        current_frame = base64_to_frame(req.frame)
        current_faces, current_backend = extract_confident_faces(
            current_frame,
            backends=VERIFY_DETECTOR_BACKENDS,
        )
        current_face_count = len(current_faces)
        current_best_face = _best_face_from_detections(
            current_frame,
            current_faces,
            0.0,
        )
        applied_threshold = _verification_threshold_for_face(current_best_face)

        if current_face_count != 1 or current_backend is None or current_best_face is None:
            return {
                "analysis_available": True,
                "verified": False,
                "verification_checked": False,
                "verification_reliable": False,
                "distance": None,
                "threshold": COSINE_DISTANCE_THRESHOLD,
                "event": None,
                "reason": "current_frame_requires_exactly_one_face",
                "face_count": current_face_count,
                "backend": current_backend,
            }

        if applied_threshold is None:
            return {
                "analysis_available": True,
                "verified": False,
                "verification_checked": False,
                "verification_reliable": False,
                "distance": None,
                "threshold": COSINE_DISTANCE_THRESHOLD,
                "event": None,
                "reason": "current_face_quality_too_low",
                "face_count": current_face_count,
                "backend": current_backend,
                "primary_face_confidence": round(current_best_face["confidence"], 4),
                "primary_face_area_ratio": round(current_best_face["area_ratio"], 4),
            }

        current_embedding = build_face_embedding(current_best_face["face"]["face"])

        reference_embedding = req.reference_embedding
        if not reference_embedding:
            if not req.reference:
                raise ValueError("Reference image or reference embedding is required")

            reference_frame = base64_to_frame(req.reference)
            reference_faces, reference_backend = extract_confident_faces(
                reference_frame,
                backends=VERIFY_DETECTOR_BACKENDS,
            )
            reference_face_count = len(reference_faces)
            reference_best_face = _best_face_from_detections(
                reference_frame,
                reference_faces,
                MIN_REFERENCE_FACE_AREA_RATIO,
            )

            if reference_face_count != 1 or reference_backend is None or reference_best_face is None:
                return {
                    "analysis_available": True,
                    "verified": False,
                    "verification_checked": False,
                    "verification_reliable": False,
                    "distance": None,
                    "threshold": COSINE_DISTANCE_THRESHOLD,
                    "event": None,
                    "reason": "reference_frame_requires_exactly_one_face",
                }

            reference_embedding = build_face_embedding(reference_best_face["face"]["face"])

        distance = _cosine_distance(current_embedding, reference_embedding)
        verified = distance <= applied_threshold

        return {
            "analysis_available": True,
            "verified": verified,
            "verification_checked": True,
            "verification_reliable": True,
            "distance": round(distance, 4),
            "threshold": applied_threshold,
            "backend": current_backend,
            "primary_face_confidence": round(current_best_face["confidence"], 4),
            "primary_face_area_ratio": round(current_best_face["area_ratio"], 4),
            "event": None if verified else "face_mismatch",
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Face verification unavailable: {exc}",
        ) from exc
