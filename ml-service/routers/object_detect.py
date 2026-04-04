from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.frame_utils import get_frame_from_payload, parse_request_payload

router = APIRouter()

model = None
_YOLO = None


def get_yolo_class():
    global _YOLO

    if _YOLO is None:
        from ultralytics import YOLO

        _YOLO = YOLO

    return _YOLO

def get_model():
    global model
    if model is None:
        model_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "yolov8n.pt",
        )
        if not os.path.exists(model_path):
            raise RuntimeError(f"YOLO model not found at '{model_path}'")
        model = get_yolo_class()(model_path)
    return model

MODEL_RETURN_CONFIDENCE = 0.08
DETECTION_CONFIDENCE = 0.24
MIN_BOX_AREA_RATIO = 0.008
OBJECT_DETECTION_IMGSZ = 960
PERSON_FOCUS_OBJECT_DETECTION_IMGSZ = 1280
PERSON_FOCUS_MIN_AREA_RATIO = 0.05
PERSON_FOCUS_EXPAND_X_RATIO = 0.22
PERSON_FOCUS_EXPAND_Y_RATIO = 0.18
MIN_PRIMARY_PERSON_BOX_AREA_RATIO = 0.025
MIN_SECONDARY_PERSON_BOX_AREA_RATIO = 0.018
MIN_PRIMARY_PERSON_CONFIDENCE = 0.28
MIN_SECONDARY_PERSON_CONFIDENCE = 0.34

SUSPICIOUS_OBJECTS = {
    "cell phone": {
        "severity": "high",
        "min_detection_confidence": 0.12,
        "min_detection_area_ratio": 0.0032,
        "min_confidence": 0.38,
        "min_area_ratio": 0.004,
    },
    "book": {
        "severity": "medium",
        "min_detection_confidence": 0.12,
        "min_detection_area_ratio": 0.008,
        "min_confidence": 0.28,
        "min_area_ratio": 0.01,
    },
    "remote": {
        "severity": "low",
        "min_detection_confidence": 0.1,
        "min_detection_area_ratio": 0.0025,
        "min_confidence": 0.42,
        "min_area_ratio": 0.003,
    },
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


def _person_focus_bounds(person_detection: dict, frame_w: int, frame_h: int) -> tuple[int, int, int, int] | None:
    bbox = person_detection.get("bbox") or {}
    x1 = float(bbox.get("x1", 0.0))
    y1 = float(bbox.get("y1", 0.0))
    x2 = float(bbox.get("x2", 0.0))
    y2 = float(bbox.get("y2", 0.0))
    width = max(0.0, x2 - x1)
    height = max(0.0, y2 - y1)

    if width <= 0.0 or height <= 0.0:
        return None

    expand_x = width * PERSON_FOCUS_EXPAND_X_RATIO
    expand_y = height * PERSON_FOCUS_EXPAND_Y_RATIO
    crop_x1 = max(0, int(round(x1 - expand_x)))
    crop_y1 = max(0, int(round(y1 - expand_y)))
    crop_x2 = min(frame_w, int(round(x2 + expand_x)))
    crop_y2 = min(frame_h, int(round(y2 + expand_y)))

    if crop_x2 <= crop_x1 or crop_y2 <= crop_y1:
        return None

    return crop_x1, crop_y1, crop_x2, crop_y2


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


def _get_detection_confidence_threshold(class_name: str) -> float:
    config = SUSPICIOUS_OBJECTS.get(class_name)
    if config and "min_detection_confidence" in config:
        return float(config["min_detection_confidence"])
    return DETECTION_CONFIDENCE


def _get_detection_area_threshold(class_name: str) -> float:
    config = SUSPICIOUS_OBJECTS.get(class_name)
    if config and "min_detection_area_ratio" in config:
        return float(config["min_detection_area_ratio"])
    return MIN_BOX_AREA_RATIO


def _build_rejection_entry(
    *,
    stage: str,
    class_name: str,
    confidence: float,
    area_ratio: float,
    bbox: dict,
    rejection_reason: str,
    threshold_debug: dict,
) -> dict:
    return {
        "stage": stage,
        "object": class_name,
        "confidence": round(float(confidence), 2),
        "area_ratio": round(float(area_ratio), 4),
        "bbox": bbox,
        "rejection_reason": rejection_reason,
        "threshold_debug": threshold_debug,
    }


def _run_person_focus_detection(
    *,
    frame,
    yolo,
    person_detection: dict,
    frame_area: float,
) -> list[dict]:
    frame_h, frame_w = frame.shape[:2]
    crop_bounds = _person_focus_bounds(person_detection, frame_w, frame_h)
    if crop_bounds is None:
        return []

    crop_x1, crop_y1, crop_x2, crop_y2 = crop_bounds
    cropped_frame = frame[crop_y1:crop_y2, crop_x1:crop_x2]
    if cropped_frame.size == 0:
        return []

    focus_results = yolo(
        cropped_frame,
        conf=MODEL_RETURN_CONFIDENCE,
        imgsz=PERSON_FOCUS_OBJECT_DETECTION_IMGSZ,
        verbose=False,
    )
    focused_detections = []

    for result in focus_results:
        for box in result.boxes:
            class_name = result.names[int(box.cls[0])]
            if class_name not in SUSPICIOUS_OBJECTS or class_name == "tv":
                continue

            confidence = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            mapped_x1 = crop_x1 + float(x1)
            mapped_y1 = crop_y1 + float(y1)
            mapped_x2 = crop_x1 + float(x2)
            mapped_y2 = crop_y1 + float(y2)
            width = max(0.0, mapped_x2 - mapped_x1)
            height = max(0.0, mapped_y2 - mapped_y1)
            area_ratio = (width * height) / frame_area

            focused_detections.append({
                **_build_detection_item(
                    class_name=class_name,
                    confidence=confidence,
                    area_ratio=area_ratio,
                    x1=mapped_x1,
                    y1=mapped_y1,
                    x2=mapped_x2,
                    y2=mapped_y2,
                ),
                "source": "person_focus",
            })

    return focused_detections


def _get_counted_person_detections(person_detections: list[dict]) -> tuple[list[dict], list[dict]]:
    if not person_detections:
        return [], []

    ranked_people = sorted(
        person_detections,
        key=lambda item: (item["area_ratio"], item["confidence"]),
        reverse=True,
    )
    counted_people = []
    count_debug = []

    for index, person in enumerate(ranked_people):
        is_primary_candidate = (
            person["confidence"] >= MIN_PRIMARY_PERSON_CONFIDENCE and
            person["area_ratio"] >= MIN_PRIMARY_PERSON_BOX_AREA_RATIO
        )
        is_secondary_candidate = (
            person["confidence"] >= MIN_SECONDARY_PERSON_CONFIDENCE and
            person["area_ratio"] >= MIN_SECONDARY_PERSON_BOX_AREA_RATIO
        )
        threshold_debug = {
            "min_primary_person_confidence": MIN_PRIMARY_PERSON_CONFIDENCE,
            "min_primary_person_box_area_ratio": MIN_PRIMARY_PERSON_BOX_AREA_RATIO,
            "min_secondary_person_confidence": MIN_SECONDARY_PERSON_CONFIDENCE,
            "min_secondary_person_box_area_ratio": MIN_SECONDARY_PERSON_BOX_AREA_RATIO,
            "passes_primary_confidence": person["confidence"] >= MIN_PRIMARY_PERSON_CONFIDENCE,
            "passes_primary_area_ratio": person["area_ratio"] >= MIN_PRIMARY_PERSON_BOX_AREA_RATIO,
            "passes_secondary_confidence": person["confidence"] >= MIN_SECONDARY_PERSON_CONFIDENCE,
            "passes_secondary_area_ratio": person["area_ratio"] >= MIN_SECONDARY_PERSON_BOX_AREA_RATIO,
        }

        if index == 0:
            if not (is_primary_candidate or is_secondary_candidate):
                count_debug.append({
                    "rank": index + 1,
                    "counted": False,
                    "counting_role": "primary",
                    "counting_reason": "largest_person_below_thresholds",
                    "person": person,
                    "threshold_debug": threshold_debug,
                })
                continue
            counted_person = {
                **person,
                "counting_role": "primary",
                "counting_reason": (
                    "meets_primary_thresholds" if is_primary_candidate
                    else "largest_person_meets_secondary_thresholds"
                ),
            }
            counted_people.append(counted_person)
            count_debug.append({
                "rank": index + 1,
                "counted": True,
                "counting_role": counted_person["counting_role"],
                "counting_reason": counted_person["counting_reason"],
                "person": counted_person,
                "threshold_debug": threshold_debug,
            })
            continue

        if not is_secondary_candidate:
            count_debug.append({
                "rank": index + 1,
                "counted": False,
                "counting_role": "secondary",
                "counting_reason": "secondary_person_below_thresholds",
                "person": person,
                "threshold_debug": threshold_debug,
            })
            continue

        counted_person = {
            **person,
            "counting_role": "secondary",
            "counting_reason": "meets_secondary_thresholds",
        }
        counted_people.append(counted_person)
        count_debug.append({
            "rank": index + 1,
            "counted": True,
            "counting_role": counted_person["counting_role"],
            "counting_reason": counted_person["counting_reason"],
            "person": counted_person,
            "threshold_debug": threshold_debug,
        })

    return counted_people, count_debug

@router.post("/detect")
async def detect_objects(request: Request):
    try:
        payload, _ = await parse_request_payload(request)
        frame = await get_frame_from_payload(payload, "frame")
        frame_h, frame_w = frame.shape[:2]
        frame_area = max(float(frame_h * frame_w), 1.0)
        yolo = get_model()
        results = yolo(
            frame,
            conf=MODEL_RETURN_CONFIDENCE,
            imgsz=OBJECT_DETECTION_IMGSZ,
            verbose=False,
        )

        detected_objects = []
        all_person_detections = []
        suspicious_rejection_debug = []

        for result in results:
            for box in result.boxes:
                class_name = result.names[int(box.cls[0])]
                confidence = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                width = max(0.0, float(x2 - x1))
                height = max(0.0, float(y2 - y1))
                area_ratio = (width * height) / frame_area
                bbox = _build_bbox(x1, y1, x2, y2)
                min_detection_confidence = _get_detection_confidence_threshold(class_name)
                min_detection_area_ratio = _get_detection_area_threshold(class_name)
                passes_detection_confidence = confidence >= min_detection_confidence
                passes_detection_area_ratio = area_ratio >= min_detection_area_ratio

                if not passes_detection_confidence or not passes_detection_area_ratio:
                    if class_name in SUSPICIOUS_OBJECTS:
                        suspicious_rejection_debug.append(_build_rejection_entry(
                            stage="detection_gate",
                            class_name=class_name,
                            confidence=confidence,
                            area_ratio=area_ratio,
                            bbox=bbox,
                            rejection_reason=(
                                "below_detection_confidence_and_area_ratio"
                                if not passes_detection_confidence and not passes_detection_area_ratio
                                else "below_detection_confidence"
                                if not passes_detection_confidence
                                else "below_detection_area_ratio"
                            ),
                            threshold_debug={
                                "model_return_confidence": MODEL_RETURN_CONFIDENCE,
                                "global_detection_confidence": DETECTION_CONFIDENCE,
                                "global_min_box_area_ratio": MIN_BOX_AREA_RATIO,
                                "min_detection_confidence": min_detection_confidence,
                                "min_detection_area_ratio": min_detection_area_ratio,
                                "passes_detection_confidence": passes_detection_confidence,
                                "passes_detection_area_ratio": passes_detection_area_ratio,
                            },
                        ))
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

        counted_person_detections, counted_person_debug = _get_counted_person_detections(
            all_person_detections
        )
        if counted_person_detections:
            primary_person = counted_person_detections[0]
            if primary_person["area_ratio"] >= PERSON_FOCUS_MIN_AREA_RATIO:
                detected_objects.extend(_run_person_focus_detection(
                    frame=frame,
                    yolo=yolo,
                    person_detection=primary_person,
                    frame_area=frame_area,
                ))

        suspicious_map = {}

        for detection in detected_objects:
            class_name = detection["object"]
            if class_name == "person":
                continue

            config = SUSPICIOUS_OBJECTS.get(class_name)
            if config:
                passes_confidence = detection["confidence"] >= config["min_confidence"]
                passes_area_ratio = detection["area_ratio"] >= config["min_area_ratio"]

                if not passes_confidence or not passes_area_ratio:
                    suspicious_rejection_debug.append(_build_rejection_entry(
                        stage="suspicious_gate",
                        class_name=class_name,
                        confidence=detection["confidence"],
                        area_ratio=detection["area_ratio"],
                        bbox=detection["bbox"],
                        rejection_reason=(
                            "below_confidence_and_area_ratio"
                            if not passes_confidence and not passes_area_ratio
                            else "below_confidence"
                            if not passes_confidence
                            else "below_area_ratio"
                        ),
                        threshold_debug={
                            "min_confidence": config["min_confidence"],
                            "min_area_ratio": config["min_area_ratio"],
                            "passes_confidence": passes_confidence,
                            "passes_area_ratio": passes_area_ratio,
                        },
                    ))
                if not passes_confidence:
                    continue
                if not passes_area_ratio:
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
                "count_debug": counted_person_debug,
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
            "person_count_debug": counted_person_debug,
            "suspicious_object_rejections": suspicious_rejection_debug,
            "detection_summary": {
                "total_detected_objects": len(detected_objects),
                "all_person_count": len(all_person_detections),
                "counted_person_count": len(counted_person_detections),
                "suspicious_object_count": len(suspicious),
                "suspicious_rejection_count": len(suspicious_rejection_debug),
            },
            "object_thresholds": {
                "model_return_confidence": MODEL_RETURN_CONFIDENCE,
                "object_detection_imgsz": OBJECT_DETECTION_IMGSZ,
                "person_focus_object_detection_imgsz": PERSON_FOCUS_OBJECT_DETECTION_IMGSZ,
                "detection_confidence": DETECTION_CONFIDENCE,
                "min_box_area_ratio": MIN_BOX_AREA_RATIO,
                "suspicious_objects": SUSPICIOUS_OBJECTS,
            },
            "extra_person_detected": {
                "detected": extra_person_detected,
                "all_person_count": len(all_person_detections),
                "counted_person_count": len(counted_person_detections),
                "counted_persons": counted_person_detections,
                "count_debug": counted_person_debug,
                "thresholds": {
                    "model_return_confidence": MODEL_RETURN_CONFIDENCE,
                    "object_detection_imgsz": OBJECT_DETECTION_IMGSZ,
                    "person_focus_object_detection_imgsz": PERSON_FOCUS_OBJECT_DETECTION_IMGSZ,
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
