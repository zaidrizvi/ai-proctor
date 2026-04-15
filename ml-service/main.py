from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
from threading import Lock, Thread
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AIProctor ML Service", version="1.0.0")
_routers_registered = False
_router_registration_started = False
_router_registration_error = ""
_router_registration_lock = Lock()


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


def register_ml_routers():
    global _routers_registered, _router_registration_error

    with _router_registration_lock:
        if _routers_registered:
            return

        try:
            from routers import audio, face, gaze, head_pose, object_detect

            app.include_router(face.router, prefix="/face", tags=["Face"])
            app.include_router(head_pose.router, prefix="/head", tags=["Head Pose"])
            app.include_router(gaze.router, prefix="/gaze", tags=["Gaze"])
            app.include_router(object_detect.router, prefix="/objects", tags=["Object Detection"])
            app.include_router(audio.router, prefix="/audio", tags=["Audio"])
            _routers_registered = True
        except Exception as exc:
            _router_registration_error = str(exc)
            raise


def start_router_registration():
    global _router_registration_started

    if _router_registration_started:
        return

    _router_registration_started = True

    def _target():
        try:
            register_ml_routers()
        except Exception as exc:
            print(f"Router registration failed: {exc}")

    Thread(target=_target, daemon=True).start()


@app.get("/")
def root():
    return {
        "message": "AIProctor ML Service running",
        "routersRegistered": _routers_registered,
        "routerRegistrationError": _router_registration_error or None,
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "routersRegistered": _routers_registered,
        "routerRegistrationError": _router_registration_error or None,
    }


@app.on_event("startup")
async def on_startup():
    start_router_registration()


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    reload_enabled = os.getenv("UVICORN_RELOAD", "").lower() in {"1", "true", "yes"}
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload_enabled)
