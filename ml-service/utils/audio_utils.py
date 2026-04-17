import base64
import io
import os
import threading
import wave
from functools import lru_cache

import numpy as np
import torch
from silero_vad import get_speech_timestamps, load_silero_vad


TARGET_SAMPLE_RATE = 16000
MIN_SUPPORTED_SAMPLE_RATE = 5000
MIN_ANALYSIS_WINDOW_MS = 250
MIN_VOLUME_LEVEL = 0.0012
SILERO_THRESHOLD = float(os.getenv("SILERO_VAD_THRESHOLD", "0.36"))
SILERO_NEG_THRESHOLD = float(os.getenv("SILERO_VAD_NEG_THRESHOLD", "0.22"))
SILERO_MIN_SPEECH_MS = int(os.getenv("SILERO_MIN_SPEECH_MS", "180"))
SILERO_MIN_SILENCE_MS = int(os.getenv("SILERO_MIN_SILENCE_MS", "120"))
SILERO_SPEECH_PAD_MS = int(os.getenv("SILERO_SPEECH_PAD_MS", "40"))
MIN_SPEECH_RATIO = float(os.getenv("SILERO_MIN_SPEECH_RATIO", "0.03"))
MIN_SPEECH_CONFIDENCE = float(os.getenv("SILERO_MIN_CONFIDENCE", "0.16"))
SOFT_SPEECH_MIN_DURATION_MS = int(os.getenv("SILERO_SOFT_SPEECH_MIN_DURATION_MS", "680"))
SOFT_SPEECH_MIN_RUN_MS = int(os.getenv("SILERO_SOFT_SPEECH_MIN_RUN_MS", "420"))
SOFT_SPEECH_MIN_PROBABILITY_RATIO = float(os.getenv("SILERO_SOFT_SPEECH_MIN_RATIO", "0.08"))
SOFT_SPEECH_MIN_MEAN_PROBABILITY = float(os.getenv("SILERO_SOFT_SPEECH_MIN_MEAN", "0.24"))
SOFT_SPEECH_MIN_PEAK_PROBABILITY = float(os.getenv("SILERO_SOFT_SPEECH_MIN_PEAK", "0.5"))
SOFT_SPEECH_MIN_CONFIDENCE = float(os.getenv("SILERO_SOFT_SPEECH_MIN_CONFIDENCE", "0.11"))
CONFIDENCE_DURATION_REFERENCE_MS = 900
CONFIDENCE_RUN_REFERENCE_MS = 650
CONFIDENCE_SPEECH_RATIO_REFERENCE = 0.32
CONFIDENCE_VAD_RATIO_REFERENCE = 0.22
CONFIDENCE_MEAN_PROBABILITY_REFERENCE = 0.48
CONFIDENCE_ACTIVE_PROBABILITY_REFERENCE = 0.72
CONFIDENCE_PEAK_PROBABILITY_REFERENCE = 0.92
CONFIDENCE_VOLUME_REFERENCE = 0.02
_VAD_MODEL_LOCK = threading.Lock()


def decode_wav_base64(audio_payload: str) -> tuple[np.ndarray, int]:
    if not audio_payload or not isinstance(audio_payload, str):
        raise ValueError("Audio payload is required")

    payload = audio_payload
    if "," in audio_payload:
        payload = audio_payload.split(",", 1)[1]

    try:
        audio_bytes = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise ValueError("Audio payload is not valid base64") from exc

    with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        sample_width = wav_file.getsampwidth()
        channels = wav_file.getnchannels()
        raw_frames = wav_file.readframes(wav_file.getnframes())

    if sample_width != 2:
        raise ValueError("Only 16-bit PCM WAV audio is supported")
    if channels < 1:
        raise ValueError("WAV audio must contain at least one channel")
    if sample_rate < MIN_SUPPORTED_SAMPLE_RATE:
        raise ValueError("WAV sample rate must be at least 8000 Hz")

    samples = np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32768.0

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)

    return samples, sample_rate


def analyze_audio_chunk(samples: np.ndarray, sample_rate: int) -> dict:
    if samples.size == 0:
        return _empty_audio_analysis()

    clipped_samples = np.clip(samples, -1.0, 1.0)
    rms = float(np.sqrt(np.mean(np.square(clipped_samples))))
    analysis_window_ms = int((len(clipped_samples) / max(sample_rate, 1)) * 1000)

    if analysis_window_ms < MIN_ANALYSIS_WINDOW_MS:
        return {
            **_empty_audio_analysis(),
            "volume_level": round(rms, 4),
            "analysis_window_ms": analysis_window_ms,
        }

    if rms < MIN_VOLUME_LEVEL:
        return {
            **_empty_audio_analysis(),
            "volume_level": round(rms, 4),
            "analysis_window_ms": analysis_window_ms,
            "resampled_sample_rate": TARGET_SAMPLE_RATE,
            "vad_model": "silero_vad",
            "volume_gate_passed": False,
            "volume_gate_threshold": round(MIN_VOLUME_LEVEL, 4),
        }

    resampled_samples = _resample_audio(clipped_samples, sample_rate, TARGET_SAMPLE_RATE)
    audio_tensor = torch.from_numpy(resampled_samples).float().contiguous()
    timestamps, speech_probabilities = _run_silero_analysis(audio_tensor)

    mean_probability = float(np.mean(speech_probabilities)) if speech_probabilities.size else 0.0
    peak_probability = float(np.max(speech_probabilities)) if speech_probabilities.size else 0.0
    active_probabilities = speech_probabilities[speech_probabilities >= SILERO_THRESHOLD]
    mean_active_probability = (
        float(np.mean(active_probabilities)) if active_probabilities.size else 0.0
    )
    probability_ratio = float(np.mean(speech_probabilities >= SILERO_THRESHOLD)) if speech_probabilities.size else 0.0

    speech_duration_samples = int(sum(segment["end"] - segment["start"] for segment in timestamps))
    speech_duration_ms = int(round((speech_duration_samples / TARGET_SAMPLE_RATE) * 1000))
    longest_segment_ms = int(
        round(
            max((segment["end"] - segment["start"]) for segment in timestamps) * 1000 / TARGET_SAMPLE_RATE
        )
    ) if timestamps else 0
    speech_ratio = float(
        speech_duration_samples / max(int(audio_tensor.numel()), 1)
    )

    speech_confidence, confidence_breakdown = _compute_speech_confidence(
        rms=rms,
        analysis_window_ms=analysis_window_ms,
        speech_duration_ms=speech_duration_ms,
        longest_segment_ms=longest_segment_ms,
        speech_ratio=speech_ratio,
        probability_ratio=probability_ratio,
        mean_probability=mean_probability,
        mean_active_probability=mean_active_probability,
        peak_probability=peak_probability,
    )
    soft_speech_sustained_detected = bool(
        analysis_window_ms >= SOFT_SPEECH_MIN_DURATION_MS and
        rms >= MIN_VOLUME_LEVEL and
        probability_ratio >= SOFT_SPEECH_MIN_PROBABILITY_RATIO and
        mean_probability >= SOFT_SPEECH_MIN_MEAN_PROBABILITY and
        peak_probability >= SOFT_SPEECH_MIN_PEAK_PROBABILITY and
        speech_confidence >= SOFT_SPEECH_MIN_CONFIDENCE and
        (
            longest_segment_ms >= SOFT_SPEECH_MIN_RUN_MS or
            speech_duration_ms >= int(SOFT_SPEECH_MIN_DURATION_MS * 0.4) or
            (
                probability_ratio >= max(SOFT_SPEECH_MIN_PROBABILITY_RATIO + 0.03, 0.1) and
                mean_probability >= (SOFT_SPEECH_MIN_MEAN_PROBABILITY + 0.03)
            )
        )
    )
    speech_detected = (
        soft_speech_sustained_detected or
        (
            bool(timestamps) and
            speech_ratio >= MIN_SPEECH_RATIO and
            (
                speech_confidence >= MIN_SPEECH_CONFIDENCE or
                (
                    probability_ratio >= 0.18 and
                    speech_duration_ms >= 220 and
                    mean_probability >= 0.34
                )
            )
        )
    )

    return {
        "speech_detected": speech_detected,
        "soft_speech_sustained_detected": soft_speech_sustained_detected,
        "volume_level": round(rms, 4),
        "speech_confidence": round(speech_confidence, 4),
        "vad_ratio": round(probability_ratio, 4),
        "voiced_ratio": round(speech_ratio, 4),
        "analysis_window_ms": analysis_window_ms,
        "speech_duration_ms": speech_duration_ms,
        "speech_run_ms": longest_segment_ms,
        "vad_run_ms": longest_segment_ms,
        "speech_probability_mean": round(mean_probability, 4),
        "speech_probability_active_mean": round(mean_active_probability, 4),
        "speech_probability_peak": round(peak_probability, 4),
        "resampled_sample_rate": TARGET_SAMPLE_RATE,
        "vad_model": "silero_vad",
        "vad_threshold": round(SILERO_THRESHOLD, 3),
        "volume_gate_passed": True,
        "volume_gate_threshold": round(MIN_VOLUME_LEVEL, 4),
        "detection_path": (
            "soft_sustained"
            if soft_speech_sustained_detected and not speech_confidence >= MIN_SPEECH_CONFIDENCE
            else "standard"
            if speech_detected
            else "none"
        ),
        "confidence_breakdown": confidence_breakdown,
    }


def _empty_audio_analysis() -> dict:
    return {
        "speech_detected": False,
        "soft_speech_sustained_detected": False,
        "volume_level": 0.0,
        "speech_confidence": 0.0,
        "vad_ratio": 0.0,
        "voiced_ratio": 0.0,
        "analysis_window_ms": 0,
        "speech_duration_ms": 0,
        "speech_run_ms": 0,
        "vad_run_ms": 0,
        "speech_probability_mean": 0.0,
        "speech_probability_active_mean": 0.0,
        "speech_probability_peak": 0.0,
        "resampled_sample_rate": TARGET_SAMPLE_RATE,
        "vad_model": "silero_vad",
        "vad_threshold": round(SILERO_THRESHOLD, 3),
        "volume_gate_passed": False,
        "volume_gate_threshold": round(MIN_VOLUME_LEVEL, 4),
        "detection_path": "none",
        "confidence_breakdown": {
            "coverage_score": 0.0,
            "vad_coverage_score": 0.0,
            "duration_score": 0.0,
            "run_score": 0.0,
            "mean_probability_score": 0.0,
            "active_probability_score": 0.0,
            "peak_score": 0.0,
            "volume_factor": 0.0,
        },
    }


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def _compute_speech_confidence(
    *,
    rms: float,
    analysis_window_ms: int,
    speech_duration_ms: int,
    longest_segment_ms: int,
    speech_ratio: float,
    probability_ratio: float,
    mean_probability: float,
    mean_active_probability: float,
    peak_probability: float,
) -> tuple[float, dict]:
    duration_reference_ms = max(
        min(int(round(analysis_window_ms * 0.7)), CONFIDENCE_DURATION_REFERENCE_MS),
        320,
    )
    run_reference_ms = max(
        min(int(round(analysis_window_ms * 0.55)), CONFIDENCE_RUN_REFERENCE_MS),
        250,
    )
    coverage_score = clamp(speech_ratio / CONFIDENCE_SPEECH_RATIO_REFERENCE, 0.0, 1.0)
    vad_coverage_score = clamp(probability_ratio / CONFIDENCE_VAD_RATIO_REFERENCE, 0.0, 1.0)
    duration_score = clamp(speech_duration_ms / duration_reference_ms, 0.0, 1.0)
    run_score = clamp(longest_segment_ms / run_reference_ms, 0.0, 1.0)
    mean_probability_score = clamp(mean_probability / CONFIDENCE_MEAN_PROBABILITY_REFERENCE, 0.0, 1.0)
    active_probability_score = clamp(
        mean_active_probability / CONFIDENCE_ACTIVE_PROBABILITY_REFERENCE,
        0.0,
        1.0,
    )
    peak_score = clamp(
        (peak_probability - SILERO_THRESHOLD) /
        max(CONFIDENCE_PEAK_PROBABILITY_REFERENCE - SILERO_THRESHOLD, 1e-6),
        0.0,
        1.0,
    )
    volume_factor = clamp(
        (rms - MIN_VOLUME_LEVEL) / max(CONFIDENCE_VOLUME_REFERENCE - MIN_VOLUME_LEVEL, 1e-6),
        0.0,
        1.0,
    )

    base_confidence = (
        (coverage_score * 0.29) +
        (vad_coverage_score * 0.26) +
        (duration_score * 0.19) +
        (run_score * 0.14) +
        (mean_probability_score * 0.07) +
        (active_probability_score * 0.03) +
        (peak_score * 0.02)
    )
    speech_confidence = clamp(
        base_confidence * (0.72 + (volume_factor * 0.28)),
        0.0,
        1.0,
    )

    return speech_confidence, {
        "coverage_score": round(coverage_score, 4),
        "vad_coverage_score": round(vad_coverage_score, 4),
        "duration_score": round(duration_score, 4),
        "run_score": round(run_score, 4),
        "mean_probability_score": round(mean_probability_score, 4),
        "active_probability_score": round(active_probability_score, 4),
        "peak_score": round(peak_score, 4),
        "volume_factor": round(volume_factor, 4),
    }


@lru_cache(maxsize=1)
def _get_vad_model():
    torch.set_num_threads(1)
    return load_silero_vad(onnx=False)


def warmup_audio_runtime():
    _get_vad_model()


def _resample_audio(
    samples: np.ndarray,
    source_rate: int,
    target_rate: int,
) -> np.ndarray:
    if source_rate == target_rate or samples.size == 0:
        return samples.astype(np.float32, copy=False)

    source_positions = np.arange(samples.size, dtype=np.float32)
    target_size = max(int(round(samples.size * (target_rate / source_rate))), 1)
    target_positions = np.linspace(0, samples.size - 1, num=target_size, dtype=np.float32)
    return np.interp(target_positions, source_positions, samples).astype(np.float32)


@torch.inference_mode()
def _collect_speech_probabilities(audio_tensor: torch.Tensor, model) -> np.ndarray:
    window_size = 512
    model.reset_states()
    probabilities = []

    for start in range(0, int(audio_tensor.numel()), window_size):
        chunk = audio_tensor[start:start + window_size]
        if int(chunk.numel()) < window_size:
            chunk = torch.nn.functional.pad(chunk, (0, window_size - int(chunk.numel())))
        probabilities.append(float(model(chunk, TARGET_SAMPLE_RATE).item()))

    model.reset_states()
    return np.asarray(probabilities, dtype=np.float32)


def _run_silero_analysis(audio_tensor: torch.Tensor) -> tuple[list[dict], np.ndarray]:
    model = _get_vad_model()

    with _VAD_MODEL_LOCK:
        timestamps = get_speech_timestamps(
            audio_tensor,
            model,
            threshold=SILERO_THRESHOLD,
            neg_threshold=SILERO_NEG_THRESHOLD,
            sampling_rate=TARGET_SAMPLE_RATE,
            min_speech_duration_ms=SILERO_MIN_SPEECH_MS,
            min_silence_duration_ms=SILERO_MIN_SILENCE_MS,
            speech_pad_ms=SILERO_SPEECH_PAD_MS,
            return_seconds=False,
        )
        speech_probabilities = _collect_speech_probabilities(audio_tensor, model)

    return timestamps, speech_probabilities
