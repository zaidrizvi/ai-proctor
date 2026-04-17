from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class AudioRequest(BaseModel):
    audio: str


def warmup_audio_runtime():
    from utils.audio_utils import warmup_audio_runtime as warmup_runtime

    warmup_runtime()


@router.post("/analyze")
async def analyze_audio(req: AudioRequest):
    from utils.audio_utils import analyze_audio_chunk, decode_wav_base64

    try:
        samples, sample_rate = decode_wav_base64(req.audio)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        analysis = analyze_audio_chunk(samples, sample_rate)
        return {
            **analysis,
            "analysis_available": True,
            "sample_rate": sample_rate,
            "event": "audio_detected" if analysis["speech_detected"] else None,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Audio analysis unavailable: {exc}",
        ) from exc
