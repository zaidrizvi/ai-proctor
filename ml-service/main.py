from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
from dotenv import load_dotenv

load_dotenv()

from routers import audio, face, gaze, head_pose, object_detect

app = FastAPI(title="AIProctor ML Service", version="1.0.0")


def get_allowed_origins():
    raw_origins = os.getenv("ALLOWED_ORIGINS") or os.getenv("CLIENT_URL") or "http://localhost:5173"
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(face.router, prefix="/face", tags=["Face"])
app.include_router(gaze.router, prefix="/gaze", tags=["Gaze"])
app.include_router(head_pose.router, prefix="/head", tags=["Head Pose"])
app.include_router(object_detect.router, prefix="/objects", tags=["Object Detection"])
app.include_router(audio.router, prefix="/audio", tags=["Audio"])


@app.get("/")
def root():
    return {"message": "AIProctor ML Service running"}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    reload_enabled = os.getenv("UVICORN_RELOAD", "").lower() in {"1", "true", "yes"}
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload_enabled)
