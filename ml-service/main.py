from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import time
from threading import Lock, Thread
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AIProctor ML Service", version="1.0.0")
_routers_registered = False
_router_registration_started = False
_router_registration_error = ""
_runtime_warmup_completed = False
_runtime_warmup_error = ""
_runtime_warmup_results = {}
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


def should_eager_warmup():
    return os.getenv("ML_EAGER_WARMUP", "1").lower() in {"1", "true", "yes"}


def get_warmup_components():
    raw_components = os.getenv(
        "ML_EAGER_WARMUP_COMPONENTS",
        "frames,face,head,gaze,objects,audio",
    )
    components = {
        component.strip().lower()
        for component in raw_components.split(",")
        if component.strip()
    }

    if "all" in components:
        return {"frames", "face", "head", "gaze", "objects", "audio"}

    return components


def warmup_runtime():
    global _runtime_warmup_completed, _runtime_warmup_error, _runtime_warmup_results

    if not should_eager_warmup():
        _runtime_warmup_completed = False
        _runtime_warmup_error = ""
        _runtime_warmup_results = {}
        return

    started_at = time.perf_counter()
    components = get_warmup_components()
    warmups = []

    if "frames" in components:
        from utils.frame_utils import warmup_frame_runtime

        warmups.append(("frames", warmup_frame_runtime))

    if "face" in components:
        from routers.face import warmup_face_runtime

        warmups.append(("face", warmup_face_runtime))

    if "head" in components:
        from routers.head_pose import warmup_head_pose_runtime

        warmups.append(("head", warmup_head_pose_runtime))

    if "gaze" in components:
        from routers.gaze import warmup_gaze_runtime

        warmups.append(("gaze", warmup_gaze_runtime))

    if "objects" in components:
        from routers.object_detect import warmup_object_runtime

        warmups.append(("objects", warmup_object_runtime))

    if "audio" in components:
        from routers.audio import warmup_audio_runtime

        warmups.append(("audio", warmup_audio_runtime))

    results = {}
    errors = {}

    for name, warmup in warmups:
        component_started_at = time.perf_counter()
        try:
            warmup()
            results[name] = {
                "ok": True,
                "durationSeconds": round(time.perf_counter() - component_started_at, 2),
                "error": None,
            }
        except Exception as exc:
            results[name] = {
                "ok": False,
                "durationSeconds": round(time.perf_counter() - component_started_at, 2),
                "error": str(exc),
            }
            errors[name] = str(exc)
            print(f"ML runtime warmup failed for {name}: {exc}")

    _runtime_warmup_results = results
    _runtime_warmup_completed = not errors
    _runtime_warmup_error = "; ".join(
        f"{name}: {message}" for name, message in errors.items()
    )
    print(f"ML runtime warmup finished in {time.perf_counter() - started_at:.2f}s")


@app.get("/")
def root():
    return {
        "message": "AIProctor ML Service running",
        "routersRegistered": _routers_registered,
        "routerRegistrationError": _router_registration_error or None,
        "runtimeWarmupCompleted": _runtime_warmup_completed,
        "runtimeWarmupError": _runtime_warmup_error or None,
        "runtimeWarmupResults": _runtime_warmup_results,
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "routersRegistered": _routers_registered,
        "routerRegistrationError": _router_registration_error or None,
        "runtimeWarmupCompleted": _runtime_warmup_completed,
        "runtimeWarmupError": _runtime_warmup_error or None,
        "runtimeWarmupResults": _runtime_warmup_results,
    }


@app.on_event("startup")
async def on_startup():
    global _router_registration_started

    _router_registration_started = True
    register_ml_routers()
    warmup_runtime()


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    reload_enabled = os.getenv("UVICORN_RELOAD", "").lower() in {"1", "true", "yes"}
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload_enabled)
