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

DETECTION_CONFIDENCE = 0.32
MIN_BOX_AREA_RATIO = 0.008
MIN_PERSON_BOX_AREA_RATIO = 0.05

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

        detected = []
        person_detections = []

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

                item = {
                    "object": class_name,
                    "confidence": round(confidence, 2),
                    "area_ratio": round(area_ratio, 4),
                }
                detected.append({
                    **item
                })
                if class_name == "person" and confidence >= 0.45 and area_ratio >= MIN_PERSON_BOX_AREA_RATIO:
                    person_detections.append(item)

        suspicious_map = {}

        for d in detected:
            class_name = d["object"]
            if class_name == "person":
                continue

            config = SUSPICIOUS_OBJECTS.get(class_name)
            if config:
                if d["confidence"] < config["min_confidence"]:
                    continue
                if d["area_ratio"] < config["min_area_ratio"]:
                    continue

                existing = suspicious_map.get(class_name)
                if existing is None or d["confidence"] > existing["confidence"]:
                    suspicious_map[class_name] = {
                        "object": class_name,
                        "confidence": d["confidence"],
                        "area_ratio": d["area_ratio"],
                        "severity": _resolve_suspicious_severity(
                            class_name,
                            d["confidence"],
                            config["severity"],
                        ),
                    }

        if len(person_detections) > 1:
            suspicious_map["extra_person_detected"] = {
                "object": "extra person detected",
                "confidence": 1.0,
                "count": len(person_detections),
                "severity": "high"
            }
        suspicious = list(suspicious_map.values())

        return {
            "analysis_available": True,
            "objects_detected": detected,
            "person_count": len(person_detections),
            "suspicious_objects": suspicious,
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
