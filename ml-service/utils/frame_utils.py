import base64
import json
import numpy as np
from fastapi import Request
from starlette.datastructures import UploadFile

_cv2 = None


def get_cv2():
    global _cv2

    if _cv2 is None:
        import cv2

        _cv2 = cv2

    return _cv2


def warmup_frame_runtime():
    get_cv2()


def base64_to_frame(base64_string: str) -> np.ndarray:
    """Convert base64 image string to OpenCV frame"""
    if not base64_string or not isinstance(base64_string, str):
        raise ValueError("Frame payload is required")

    # remove data URL prefix if present
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]

    try:
        img_bytes = base64.b64decode(base64_string, validate=True)
    except Exception as exc:
        raise ValueError("Frame payload is not valid base64") from exc

    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    cv2 = get_cv2()
    frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    if frame is None:
        raise ValueError("Frame payload is not a decodable image")

    return frame


def bytes_to_frame(image_bytes: bytes) -> np.ndarray:
    """Convert raw image bytes to OpenCV frame"""
    if not image_bytes:
        raise ValueError("Frame payload is required")

    img_array = np.frombuffer(image_bytes, dtype=np.uint8)
    cv2 = get_cv2()
    frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    if frame is None:
        raise ValueError("Frame payload is not a decodable image")

    return frame


async def parse_request_payload(request: Request) -> tuple[dict, str]:
    """Parse either multipart/form-data or JSON request payloads."""
    content_type = (request.headers.get("content-type") or "").lower()

    if "multipart/form-data" in content_type:
        form = await request.form()
        return dict(form), "multipart"

    try:
        payload = await request.json()
    except Exception as exc:
        raise ValueError("Request payload must be valid JSON or multipart form data") from exc

    if not isinstance(payload, dict):
        raise ValueError("Request payload must be an object")

    return payload, "json"


async def get_frame_from_payload(payload: dict, field_name: str = "frame") -> np.ndarray:
    value = payload.get(field_name)

    if isinstance(value, UploadFile):
        image_bytes = await value.read()
        await value.close()
        return bytes_to_frame(image_bytes)

    if isinstance(value, (bytes, bytearray)):
        return bytes_to_frame(bytes(value))

    if isinstance(value, str):
        return base64_to_frame(value)

    raise ValueError(f"{field_name} payload is required")


def parse_json_field(value, field_name: str):
    if value is None or value == "":
        return None

    if isinstance(value, (dict, list, bool, int, float)):
        return value

    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{field_name} must be valid JSON") from exc

    raise ValueError(f"{field_name} has an unsupported format")

def frame_to_base64(frame: np.ndarray) -> str:
    """Convert OpenCV frame to base64 string"""
    cv2 = get_cv2()
    _, buffer = cv2.imencode(".jpg", frame)
    return base64.b64encode(buffer).decode("utf-8")
