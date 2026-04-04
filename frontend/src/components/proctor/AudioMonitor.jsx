import { useEffect, useRef, useState } from "react";
import { postMlJson } from "../../utils/mlClient.js";

const ANALYSIS_INTERVAL_MS = 650;
const MAX_ANALYSIS_WINDOW_MS = 950;
const MAX_BUFFERED_AUDIO_MS = 1400;
const ALERT_COOLDOWN_MS = 1200;
const AUDIO_SMOOTHING_WINDOW = 2;
const MIN_POSITIVE_CHUNKS_FOR_SUSTAINED_STATUS = 2;
const MIN_POSITIVE_CHUNKS_FOR_SUSTAINED_ALERT = 2;
const MIN_SUSTAINED_ALERT_CONFIDENCE = 0.14;
const STRONG_BACKEND_DETECTION_CONFIDENCE = 0.22;
const STRONG_BACKEND_DETECTION_PEAK = 0.78;
const STRONG_BACKEND_DETECTION_DURATION_MS = 260;
const CLIENT_RMS_THRESHOLD = 0.014;
const CLIENT_PEAK_THRESHOLD = 0.07;
const CLIENT_MIN_ZCR = 0.022;
const CLIENT_MAX_ZCR = 0.17;

const encodeWav = (samples, sampleRate) => {
  const buffer = new ArrayBuffer(44 + (samples.length * 2));
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
};

const uint8ToBase64 = (bytes) => {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
};

const getSmoothedAudioDecision = (history) => {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      detected: false,
      positiveCount: 0,
      positiveAverageConfidence: 0,
      rawAverageConfidence: 0,
    };
  }

  const positiveSamples = history.filter((sample) => sample.positiveForAlert);
  const positiveAverageConfidence = positiveSamples.length > 0
    ? positiveSamples.reduce((sum, sample) => sum + sample.rawConfidence, 0) / positiveSamples.length
    : 0;
  const rawAverageConfidence = history.reduce(
    (sum, sample) => sum + sample.confidence,
    0
  ) / Math.max(history.length, 1);

  return {
    detected: positiveSamples.length >= MIN_POSITIVE_CHUNKS_FOR_SUSTAINED_STATUS,
    positiveCount: positiveSamples.length,
    positiveAverageConfidence,
    rawAverageConfidence,
  };
};

const getClientSpeechMetrics = (samples) => {
  if (!samples?.length) {
    return {
      rms: 0,
      peak: 0,
      zcr: 0,
      speechLike: false,
      confidence: 0,
    };
  }

  let peak = 0;
  let squareSum = 0;
  let zeroCrossings = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const current = samples[i];
    const abs = Math.abs(current);
    peak = Math.max(peak, abs);
    squareSum += current * current;

    if (i > 0) {
      const previous = samples[i - 1];
      if (
        (current >= 0 && previous < 0) ||
        (current < 0 && previous >= 0)
      ) {
        zeroCrossings += 1;
      }
    }
  }

  const rms = Math.sqrt(squareSum / samples.length);
  const zcr = zeroCrossings / Math.max(samples.length - 1, 1);
  const speechLike =
    rms >= CLIENT_RMS_THRESHOLD &&
    peak >= CLIENT_PEAK_THRESHOLD &&
    zcr >= CLIENT_MIN_ZCR &&
    zcr <= CLIENT_MAX_ZCR;
  const confidence = Math.min(
    1,
    (Math.min(rms / 0.04, 1) * 0.7) + (Math.min(peak / 0.18, 1) * 0.3)
  );

  return {
    rms,
    peak,
    zcr,
    speechLike,
    confidence,
  };
};

const AudioMonitor = ({ onAudioDetected, enabled = true, showStatus = true }) => {
  const [status, setStatus] = useState("starting");
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const sampleBufferRef = useRef([]);
  const lastSentAtRef = useRef(0);
  const lastAlertAtRef = useRef(0);
  const resetStatusTimerRef = useRef(null);
  const analyzingRef = useRef(false);
  const analysisHistoryRef = useRef([]);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    const cleanup = async () => {
      clearTimeout(resetStatusTimerRef.current);

      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
        processorRef.current = null;
      }

      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      if (audioContextRef.current) {
        try {
          await audioContextRef.current.close();
        } catch {}
        audioContextRef.current = null;
      }

      sampleBufferRef.current = [];
      analyzingRef.current = false;
      analysisHistoryRef.current = [];
    };

    const sendAudioForAnalysis = async (sampleRate) => {
      if (analyzingRef.current || sampleBufferRef.current.length === 0) {
        return;
      }

      analyzingRef.current = true;
      const maxSamples = Math.max(
        1,
        Math.round((sampleRate * MAX_ANALYSIS_WINDOW_MS) / 1000)
      );
      const chunkSamples = sampleBufferRef.current.length > maxSamples
        ? sampleBufferRef.current.slice(-maxSamples)
        : [...sampleBufferRef.current];
      sampleBufferRef.current = [];
      const chunk = new Float32Array(chunkSamples);

      const clientMetrics = getClientSpeechMetrics(chunk);

      try {
        const wavBytes = encodeWav(chunk, sampleRate);
        const audio = `data:audio/wav;base64,${uint8ToBase64(wavBytes)}`;
        const { data } = await postMlJson("/audio/analyze", { audio }, {
          label: "audio.analyze",
          timeoutMs: 12000,
          warmup: true,
        });

        if (cancelled) return;

        const now = Date.now();
        const cooldownElapsed = now - lastAlertAtRef.current >= ALERT_COOLDOWN_MS;
        const backendDetected = Boolean(data.speech_detected);
        const softSpeechSustainedDetected = Boolean(data.soft_speech_sustained_detected);
        const backendConfidence = Number(data.speech_confidence || 0);
        const backendSpeechDurationMs = Number(
          data.speech_duration_ms || data.speech_run_ms || 0
        );
        const backendPeakProbability = Number(data.speech_probability_peak || 0);
        const backendModel = data.vad_model || "audio_vad";
        const detectionPath = data.detection_path || "none";
        const strongBackendDetection = Boolean(
          backendDetected &&
          detectionPath !== "soft_sustained" && (
            backendConfidence >= STRONG_BACKEND_DETECTION_CONFIDENCE ||
            backendPeakProbability >= STRONG_BACKEND_DETECTION_PEAK ||
            backendSpeechDurationMs >= STRONG_BACKEND_DETECTION_DURATION_MS
          )
        );

        analysisHistoryRef.current = [
          ...analysisHistoryRef.current,
          {
            backendDetected,
            positiveForAlert: backendDetected || softSpeechSustainedDetected,
            confidence: backendConfidence,
            rawConfidence: backendConfidence,
          },
        ].slice(-AUDIO_SMOOTHING_WINDOW);

        const smoothedDecision = getSmoothedAudioDecision(analysisHistoryRef.current);
        const sustainedDetection = smoothedDecision.detected;
        const sustainedAlertReady = (
          smoothedDecision.positiveCount >= MIN_POSITIVE_CHUNKS_FOR_SUSTAINED_ALERT &&
          smoothedDecision.positiveAverageConfidence >= MIN_SUSTAINED_ALERT_CONFIDENCE
        );
        const shouldShowDetectedState = backendDetected || sustainedDetection;

        if (shouldShowDetectedState) {
          setStatus("detected");

          if ((strongBackendDetection || sustainedAlertReady) && cooldownElapsed) {
            lastAlertAtRef.current = now;
            onAudioDetected?.({
              ...data,
              speech_detected: backendDetected || sustainedAlertReady,
              speech_confidence: Number(backendConfidence.toFixed(4)),
              raw_backend_speech_confidence: Number(backendConfidence.toFixed(4)),
              frontend_smoothed_confidence: Number(smoothedDecision.positiveAverageConfidence.toFixed(4)),
              frontend_history_average_confidence: Number(smoothedDecision.rawAverageConfidence.toFixed(4)),
              vad_model: backendModel,
              speech_probability_peak: Number(backendPeakProbability.toFixed(4)),
              speech_duration_ms: backendSpeechDurationMs,
              client_rms: Number(clientMetrics.rms.toFixed(4)),
              client_peak: Number(clientMetrics.peak.toFixed(4)),
              client_zcr: Number(clientMetrics.zcr.toFixed(4)),
              client_voice_like: clientMetrics.speechLike,
              temporal_positive_chunks: smoothedDecision.positiveCount,
              temporal_window_size: analysisHistoryRef.current.length,
              temporal_smoothed: sustainedDetection,
              frontend_alert_source: strongBackendDetection
                ? "backend_detected"
                : "sustained_soft_speech",
            });
          }

          clearTimeout(resetStatusTimerRef.current);
          resetStatusTimerRef.current = setTimeout(() => {
            setStatus("listening");
          }, 2000);
        } else {
          setStatus("listening");
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("ML audio check failed:", error?.mlMeta || error);
          setStatus("error");
        }
      } finally {
        analyzingRef.current = false;
      }
    };

    const startMonitoring = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: true,
          },
          video: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
          setStatus("unsupported");
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const audioContext = new AudioContextClass({ sampleRate: 16000 });
        if (audioContext.state === "suspended") {
          await audioContext.resume().catch(() => {});
        }
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (event) => {
          if (cancelled) return;

          const input = event.inputBuffer.getChannelData(0);
          sampleBufferRef.current.push(...input);
          const maxBufferedSamples = Math.max(
            1,
            Math.round((audioContext.sampleRate * MAX_BUFFERED_AUDIO_MS) / 1000)
          );
          if (sampleBufferRef.current.length > maxBufferedSamples) {
            sampleBufferRef.current = sampleBufferRef.current.slice(-maxBufferedSamples);
          }

          const now = Date.now();
          if (now - lastSentAtRef.current >= ANALYSIS_INTERVAL_MS) {
            lastSentAtRef.current = now;
            void sendAudioForAnalysis(audioContext.sampleRate);
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);

        streamRef.current = stream;
        audioContextRef.current = audioContext;
        sourceRef.current = source;
        processorRef.current = processor;
        setStatus("listening");
      } catch (error) {
        if (
          error?.name === "NotAllowedError" ||
          error?.name === "PermissionDeniedError"
        ) {
          setStatus("denied");
          return;
        }

        setStatus("error");
      }
    };

    void startMonitoring();

    return () => {
      cancelled = true;
      void cleanup();
    };
  }, [enabled, onAudioDetected]);

  if (!enabled) return null;
  if (!showStatus) return null;

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5">
          <div
          className={`w-1.5 h-1.5 rounded-full ${
            status === "listening"
              ? "bg-emerald-400 animate-pulse"
              : status === "detected"
              ? "bg-red-400 animate-ping"
              : status === "denied"
              ? "bg-red-400"
              : "bg-[var(--app-subtle)]"
          }`}
        />
        <p className="text-xs text-[var(--app-muted)]">
          Audio:{" "}
          {status === "listening"
            ? "Silero VAD active"
            : status === "detected"
            ? "Voice activity detected"
            : status === "denied"
            ? "Mic denied"
            : status === "unsupported"
            ? "Unavailable"
            : status === "error"
            ? "Monitor error"
            : "Starting..."}
        </p>
      </div>
    </div>
  );
};

export default AudioMonitor;
