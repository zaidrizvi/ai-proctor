import base64
import io
import os
import wave

import numpy as np
import webrtcvad


SUPPORTED_VAD_SAMPLE_RATES = {8000, 16000, 32000, 48000}
VAD_FRAME_DURATION_MS = 30
VAD_MODE = int(os.getenv("WEBRTC_VAD_MODE", "2"))
MIN_SPEECH_RUN_FRAMES = 3
TONE_LIKE_FLATNESS_THRESHOLD = 1e-3
TONE_LIKE_RATIO_THRESHOLD = 0.85
TONE_LIKE_FREQ_STD_HZ_THRESHOLD = 60.0
MIN_SPEECH_BAND_RATIO = 0.38
MIN_SPEECH_FLUX = 0.022
MIN_SPEECH_CONFIDENCE = 0.27


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
    if sample_rate < 8000:
        raise ValueError("WAV sample rate must be at least 8000 Hz")
    if sample_rate not in SUPPORTED_VAD_SAMPLE_RATES:
        raise ValueError(
            "WebRTC VAD requires WAV sample rate of 8000, 16000, 32000, or 48000 Hz"
        )

    samples = np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32768.0

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)

    return samples, sample_rate


def analyze_audio_chunk(samples: np.ndarray, sample_rate: int) -> dict:
    if samples.size == 0:
        return {
            "speech_detected": False,
            "volume_level": 0.0,
            "speech_confidence": 0.0,
            "voiced_ratio": 0.0,
            "analysis_window_ms": 0,
        }

    clipped_samples = np.clip(samples, -1.0, 1.0)
    rms = float(np.sqrt(np.mean(np.square(clipped_samples))))
    analysis_window_ms = int((len(clipped_samples) / max(sample_rate, 1)) * 1000)

    if analysis_window_ms < 250:
        return {
            "speech_detected": False,
            "volume_level": round(rms, 4),
            "speech_confidence": 0.0,
            "voiced_ratio": 0.0,
            "analysis_window_ms": analysis_window_ms,
        }

    frame_length = max(int(sample_rate * (VAD_FRAME_DURATION_MS / 1000.0)), 1)
    usable_samples = clipped_samples[: len(clipped_samples) - (len(clipped_samples) % frame_length)]

    if usable_samples.size == 0:
        usable_samples = clipped_samples
        frame_length = len(clipped_samples)

    frames = usable_samples.reshape(-1, frame_length)
    frame_rms = np.sqrt(np.mean(np.square(frames), axis=1))
    zero_crossings = np.mean(np.abs(np.diff(np.sign(frames), axis=1)), axis=1) / 2.0
    pcm_frames = (np.clip(frames, -1.0, 1.0) * 32767.0).astype(np.int16)
    vad = webrtcvad.Vad(VAD_MODE)
    spectral_flatness, dominant_freq_hz, speech_band_ratio, spectral_flux = _spectral_features(
        frames, sample_rate
    )

    vad_mask = np.array(
        [vad.is_speech(frame.tobytes(), sample_rate) for frame in pcm_frames],
        dtype=bool,
    )
    energy_mask = frame_rms > max(0.0045, rms * 0.28)
    zcr_mask = (zero_crossings > 0.01) & (zero_crossings < 0.22)
    speech_band_mask = speech_band_ratio >= MIN_SPEECH_BAND_RATIO
    flux_mask = spectral_flux >= MIN_SPEECH_FLUX
    voiced_mask = vad_mask & energy_mask & zcr_mask & speech_band_mask & flux_mask

    vad_ratio = float(np.mean(vad_mask)) if vad_mask.size else 0.0
    voiced_ratio = float(np.mean(voiced_mask)) if voiced_mask.size else 0.0
    speech_run_frames = _longest_true_run(voiced_mask)
    vad_run_frames = _longest_true_run(vad_mask)
    speech_run_ms = speech_run_frames * VAD_FRAME_DURATION_MS
    vad_run_ms = vad_run_frames * VAD_FRAME_DURATION_MS
    voiced_flatness = spectral_flatness[voiced_mask]
    voiced_freqs = dominant_freq_hz[voiced_mask]
    voiced_band_ratio = speech_band_ratio[voiced_mask]
    voiced_flux = spectral_flux[voiced_mask]
    tone_like_ratio = float(
        np.mean(voiced_flatness < TONE_LIKE_FLATNESS_THRESHOLD)
    ) if voiced_flatness.size else 0.0
    dominant_freq_std_hz = float(np.std(voiced_freqs)) if voiced_freqs.size else 0.0
    avg_speech_band_ratio = float(np.mean(voiced_band_ratio)) if voiced_band_ratio.size else 0.0
    avg_spectral_flux = float(np.mean(voiced_flux)) if voiced_flux.size else 0.0
    likely_tone = (
        voiced_flatness.size > 0 and
        tone_like_ratio >= TONE_LIKE_RATIO_THRESHOLD and
        dominant_freq_std_hz <= TONE_LIKE_FREQ_STD_HZ_THRESHOLD
    )
    speech_confidence = float(
        min(
            1.0,
            (max(voiced_ratio, vad_ratio * 0.9) * 0.58) +
            (min(max(speech_run_ms, vad_run_ms) / 210.0, 1.0) * 0.22) +
            (min(rms / 0.06, 1.0) * 0.12) +
            (min(avg_speech_band_ratio / 0.55, 1.0) * 0.08),
        )
    )

    vad_fallback_detected = (
        vad_ratio >= 0.22 and
        vad_run_frames >= 3 and
        rms >= 0.0045 and
        avg_speech_band_ratio >= 0.34 and
        avg_spectral_flux >= 0.019 and
        not likely_tone and
        speech_confidence >= 0.24
    )
    energy_fallback_detected = (
        rms >= 0.016 and
        vad_ratio >= 0.2 and
        vad_run_frames >= 3 and
        avg_speech_band_ratio >= 0.36 and
        avg_spectral_flux >= 0.025 and
        not likely_tone and
        speech_confidence >= 0.27
    )

    speech_detected = (
        (
            voiced_ratio >= 0.12 and
            speech_run_frames >= MIN_SPEECH_RUN_FRAMES and
            rms >= 0.0045 and
            avg_speech_band_ratio >= MIN_SPEECH_BAND_RATIO and
            avg_spectral_flux >= MIN_SPEECH_FLUX and
            speech_confidence >= MIN_SPEECH_CONFIDENCE
        ) or
        vad_fallback_detected or
        energy_fallback_detected
    )

    return {
        "speech_detected": speech_detected,
        "volume_level": round(rms, 4),
        "speech_confidence": round(speech_confidence, 4),
        "vad_ratio": round(vad_ratio, 4),
        "voiced_ratio": round(voiced_ratio, 4),
        "analysis_window_ms": analysis_window_ms,
        "speech_run_ms": speech_run_ms,
        "vad_run_ms": vad_run_ms,
        "vad_mode": VAD_MODE,
        "tone_like_ratio": round(tone_like_ratio, 4),
        "speech_band_ratio": round(avg_speech_band_ratio, 4),
        "spectral_flux": round(avg_spectral_flux, 4),
        "vad_fallback_detected": vad_fallback_detected,
        "energy_fallback_detected": energy_fallback_detected,
    }


def _longest_true_run(mask: np.ndarray) -> int:
    longest = 0
    current = 0

    for flag in mask:
        if flag:
            current += 1
            longest = max(longest, current)
        else:
            current = 0

    return longest


def _spectral_features(frames: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    window = np.hanning(frames.shape[1]).astype(np.float32)
    spectrum = np.abs(np.fft.rfft(frames * window, axis=1)) ** 2
    flatness = np.exp(np.mean(np.log(spectrum + 1e-12), axis=1)) / np.mean(spectrum + 1e-12, axis=1)
    freqs = np.fft.rfftfreq(frames.shape[1], d=1.0 / sample_rate)
    dominant_freq = freqs[np.argmax(spectrum, axis=1)]
    speech_band = (freqs >= 85.0) & (freqs <= 4000.0)
    speech_band_energy = np.sum(spectrum[:, speech_band], axis=1)
    total_energy = np.sum(spectrum, axis=1) + 1e-12
    speech_band_ratio = speech_band_energy / total_energy

    normalized_spectrum = spectrum / total_energy[:, np.newaxis]
    previous_spectrum = np.roll(normalized_spectrum, 1, axis=0)
    previous_spectrum[0] = normalized_spectrum[0]
    spectral_flux = np.mean(np.maximum(normalized_spectrum - previous_spectrum, 0.0), axis=1)

    return (
        flatness.astype(np.float32),
        dominant_freq.astype(np.float32),
        speech_band_ratio.astype(np.float32),
        spectral_flux.astype(np.float32),
    )
