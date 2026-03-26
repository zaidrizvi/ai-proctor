import base64
import numpy as np
import cv2

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
    frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    if frame is None:
        raise ValueError("Frame payload is not a decodable image")

    return frame

def frame_to_base64(frame: np.ndarray) -> str:
    """Convert OpenCV frame to base64 string"""
    _, buffer = cv2.imencode(".jpg", frame)
    return base64.b64encode(buffer).decode("utf-8")
