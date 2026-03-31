from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ultralytics import YOLO
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.frame_utils import base64_to_frame

router = APIRouter()

model = None

def get_model():
    global model
    if model is None:
        model_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "yolov8n.pt",
        )
        if not os.path.exists(model_path):
            raise RuntimeError(f"YOLO model not found at '{model_path}'")
        model = YOLO(model_path)
    return model

DETECTION_CONFIDENCE = 0.24
MIN_BOX_AREA_RATIO = 0.008
MIN_PRIMARY_PERSON_BOX_AREA_RATIO = 0.04
MIN_SECONDARY_PERSON_BOX_AREA_RATIO = 0.015
MIN_PRIMARY_PERSON_CONFIDENCE = 0.35
MIN_SECONDARY_PERSON_CONFIDENCE = 0.24

SUSPICIOUS_OBJECTS = {
    "cell phone": {"severity": "high", "min_confidence": 0.62, "min_area_ratio": 0.006},
    "book": {"severity": "medium", "min_confidence": 0.5, "min_area_ratio": 0.03},
    "remote": {"severity": "low", "min_confidence": 0.55, "min_area_ratio": 0.003},
    "tv": {"severity": "medium", "min_confidence": 0.55, "min_area_ratio": 0.08},
}


def _resolve_suspicious_severity(class_name: str, confidence: float, default: str) -> str:
    if class_name == "cell phone" and confidence < 0.76:
        return "medium"
    return default


def _round_detection_item(item: dict) -> dict:
    return {
        **item,
        "confidence": round(float(item["confidence"]), 2),
        "area_ratio": round(float(item["area_ratio"]), 4),
    }


def _build_bbox(x1: float, y1: float, x2: float, y2: float) -> dict:
    return {
        "x1": round(float(x1), 1),
        "y1": round(float(y1), 1),
        "x2": round(float(x2), 1),
        "y2": round(float(y2), 1),
    }


def _build_detection_item(
    *,
    class_name: str,
    confidence: float,
    area_ratio: float,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
) -> dict:
    return _round_detection_item({
        "object": class_name,
        "confidence": confidence,
        "area_ratio": area_ratio,
        "bbox": _build_bbox(x1, y1, x2, y2),
    })


def _build_suspicious_object_entry(detection: dict, config: dict) -> dict:
    return {
        "object": detection["object"],
        "confidence": detection["confidence"],
        "area_ratio": detection["area_ratio"],
        "bbox": detection["bbox"],
        "severity": _resolve_suspicious_severity(
            detection["object"],
            detection["confidence"],
            config["severity"],
        ),
        "threshold_debug": {
            "min_confidence": config["min_confidence"],
            "min_area_ratio": config["min_area_ratio"],
            "passes_confidence": detection["confidence"] >= config["min_confidence"],
            "passes_area_ratio": detection["area_ratio"] >= config["min_area_ratio"],
        },
    }


def _get_counted_person_detections(person_detections: list[dict]) -> list[dict]:
    if not person_detections:
        return []

    ranked_people = sorted(
        person_detections,
        key=lambda item: (item["area_ratio"], item["confidence"]),
        reverse=True,
    )
    counted_people = []

    for index, person in enumerate(ranked_people):
        is_primary_candidate = (
            person["confidence"] >= MIN_PRIMARY_PERSON_CONFIDENCE and
            person["area_ratio"] >= MIN_PRIMARY_PERSON_BOX_AREA_RATIO
        )
        is_secondary_candidate = (
            person["confidence"] >= MIN_SECONDARY_PERSON_CONFIDENCE and
            person["area_ratio"] >= MIN_SECONDARY_PERSON_BOX_AREA_RATIO
        )

        if index == 0:
            if not (is_primary_candidate or is_secondary_candidate):
                continue
            counted_people.append({
                **person,
                "counting_role": "primary",
                "counting_reason": (
                    "meets_primary_thresholds" if is_primary_candidate
                    else "largest_person_meets_secondary_thresholds"
                ),
            })
            continue

        if not is_secondary_candidate:
            continue

        counted_people.append({
            **person,
            "counting_role": "secondary",
            "counting_reason": "meets_secondary_thresholds",
        })

    return counted_people

class FrameRequest(BaseModel):
    frame: str

@router.post("/detect")
async def detect_objects(req: FrameRequest):
    try:
        frame = base64_to_frame(req.frame)
        frame_h, frame_w = frame.shape[:2]
        frame_area = max(float(frame_h * frame_w), 1.0)
        yolo = get_model()
        results = yolo(frame, conf=DETECTION_CONFIDENCE, verbose=False)

        detected_objects = []
        all_person_detections = []

        for result in results:
            for box in result.boxes:
                class_name = result.names[int(box.cls[0])]
                confidence = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                width = max(0.0, float(x2 - x1))
                height = max(0.0, float(y2 - y1))
                area_ratio = (width * height) / frame_area

                if area_ratio < MIN_BOX_AREA_RATIO:
                    continue

                detection = _build_detection_item(
                    class_name=class_name,
                    confidence=confidence,
                    area_ratio=area_ratio,
                    x1=x1,
                    y1=y1,
                    x2=x2,
                    y2=y2,
                )
                detected_objects.append(detection)

                if class_name == "person":
                    all_person_detections.append(detection)

        suspicious_map = {}
        counted_person_detections = _get_counted_person_detections(all_person_detections)

        for detection in detected_objects:
            class_name = detection["object"]
            if class_name == "person":
                continue

            config = SUSPICIOUS_OBJECTS.get(class_name)
            if config:
                if detection["confidence"] < config["min_confidence"]:
                    continue
                if detection["area_ratio"] < config["min_area_ratio"]:
                    continue

                existing = suspicious_map.get(class_name)
                if existing is None or detection["confidence"] > existing["confidence"]:
                    suspicious_map[class_name] = _build_suspicious_object_entry(
                        detection,
                        config,
                    )

        extra_person_detected = len(counted_person_detections) > 1
        if extra_person_detected:
            suspicious_map["extra_person_detected"] = {
                "object": "extra person detected",
                "confidence": 1.0,
                "count": len(counted_person_detections),
                "all_person_count": len(all_person_detections),
                "severity": "high",
                "counted_persons": counted_person_detections,
            }
        suspicious = list(suspicious_map.values())

        return {
            "analysis_available": True,
            "objects_detected": detected_objects,
            "person_count": len(counted_person_detections),
            "person_count_semantics": "counted_persons_for_extra_person_detection",
            "counted_person_count": len(counted_person_detections),
            "all_person_count": len(all_person_detections),
            "all_person_detections": all_person_detections,
            "counted_person_detections": counted_person_detections,
            "detection_summary": {
                "total_detected_objects": len(detected_objects),
                "all_person_count": len(all_person_detections),
                "counted_person_count": len(counted_person_detections),
                "suspicious_object_count": len(suspicious),
            },
            "object_thresholds": {
                "detection_confidence": DETECTION_CONFIDENCE,
                "min_box_area_ratio": MIN_BOX_AREA_RATIO,
                "suspicious_objects": SUSPICIOUS_OBJECTS,
            },
            "extra_person_detected": {
                "detected": extra_person_detected,
                "all_person_count": len(all_person_detections),
                "counted_person_count": len(counted_person_detections),
                "counted_persons": counted_person_detections,
                "thresholds": {
                    "detection_confidence": DETECTION_CONFIDENCE,
                    "min_box_area_ratio": MIN_BOX_AREA_RATIO,
                    "min_primary_person_confidence": MIN_PRIMARY_PERSON_CONFIDENCE,
                    "min_primary_person_box_area_ratio": MIN_PRIMARY_PERSON_BOX_AREA_RATIO,
                    "min_secondary_person_confidence": MIN_SECONDARY_PERSON_CONFIDENCE,
                    "min_secondary_person_box_area_ratio": MIN_SECONDARY_PERSON_BOX_AREA_RATIO,
                },
            },
            "suspicious_objects": suspicious,
            "suspicious_object_count": len(suspicious),
            "suspicious_count": len(suspicious),
            "has_suspicious": len(suspicious) > 0,
            "event": "object_detected" if suspicious else None,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Object detection unavailable: {exc}",
        ) from exc
