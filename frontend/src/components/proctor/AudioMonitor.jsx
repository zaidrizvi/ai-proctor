import { useEffect, useRef, useState } from "react";
import axios from "axios";

const ML_URL = import.meta.env.VITE_ML_URL || "http://localhost:8000";
const ANALYSIS_INTERVAL_MS = 1500;
const ALERT_COOLDOWN_MS = 12000;
const AUDIO_SMOOTHING_WINDOW = 4;
const MIN_POSITIVE_CHUNKS_TO_ALERT = 2;
const MIN_AVERAGE_CONFIDENCE_TO_ALERT = 0.28;
const MIN_BACKEND_CONFIDENCE_TO_COUNT = 0.22;
const MIN_BACKEND_SPEECH_DURATION_MS = 280;
const IMMEDIATE_BACKEND_CONFIDENCE_THRESHOLD = 0.46;
const IMMEDIATE_BACKEND_SPEECH_DURATION_MS = 650;
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
    return { detected: false, positiveCount: 0, averageConfidence: 0 };
  }

  const positiveSamples = history.filter((sample) => sample.detected);
  const averageConfidence = history.reduce(
    (sum, sample) => sum + sample.confidence,
    0
  ) / history.length;

  return {
    detected:
      positiveSamples.length >= MIN_POSITIVE_CHUNKS_TO_ALERT &&
      averageConfidence >= MIN_AVERAGE_CONFIDENCE_TO_ALERT,
    positiveCount: positiveSamples.length,
    averageConfidence,
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

const AudioMonitor = ({ onAudioDetected, enabled = true }) => {
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
      const chunk = new Float32Array(sampleBufferRef.current);
      sampleBufferRef.current = [];

      const clientMetrics = getClientSpeechMetrics(chunk);

      try {
        const wavBytes = encodeWav(chunk, sampleRate);
        const audio = `data:audio/wav;base64,${uint8ToBase64(wavBytes)}`;
        const { data } = await axios.post(`${ML_URL}/audio/analyze`, { audio });

        if (cancelled) return;

        const now = Date.now();
        const cooldownElapsed = now - lastAlertAtRef.current >= ALERT_COOLDOWN_MS;
        const backendDetected = Boolean(data.speech_detected);
        const backendConfidence = Number(data.speech_confidence || 0);
        const backendSpeechDurationMs = Number(
          data.speech_duration_ms || data.speech_run_ms || 0
        );
        const backendPeakProbability = Number(data.speech_probability_peak || 0);
        const backendModel = data.vad_model || "audio_vad";
        const backendStrongEnough =
          backendDetected &&
          (
            backendConfidence >= MIN_BACKEND_CONFIDENCE_TO_COUNT ||
            backendSpeechDurationMs >= MIN_BACKEND_SPEECH_DURATION_MS
          );

        analysisHistoryRef.current = [
          ...analysisHistoryRef.current,
          {
            detected: backendStrongEnough,
            confidence: backendStrongEnough ? backendConfidence : 0,
          },
        ].slice(-AUDIO_SMOOTHING_WINDOW);

        const smoothedDecision = getSmoothedAudioDecision(analysisHistoryRef.current);
        const immediateDetection =
          backendStrongEnough &&
          (
            backendConfidence >= IMMEDIATE_BACKEND_CONFIDENCE_THRESHOLD ||
            backendSpeechDurationMs >= IMMEDIATE_BACKEND_SPEECH_DURATION_MS
          );

        if (smoothedDecision.detected || immediateDetection) {
          setStatus("detected");

          if (cooldownElapsed) {
            lastAlertAtRef.current = now;
            onAudioDetected?.({
              ...data,
              speech_detected: backendStrongEnough,
              speech_confidence: Number(
                Math.max(
                  smoothedDecision.averageConfidence,
                  backendStrongEnough ? backendConfidence : 0
                ).toFixed(4)
              ),
              vad_model: backendModel,
              speech_probability_peak: Number(backendPeakProbability.toFixed(4)),
              speech_duration_ms: backendSpeechDurationMs,
              client_rms: Number(clientMetrics.rms.toFixed(4)),
              client_peak: Number(clientMetrics.peak.toFixed(4)),
              client_zcr: Number(clientMetrics.zcr.toFixed(4)),
              client_voice_like: clientMetrics.speechLike,
              temporal_positive_chunks: smoothedDecision.positiveCount,
              temporal_window_size: analysisHistoryRef.current.length,
              temporal_smoothed: smoothedDecision.detected,
            });
          }

          clearTimeout(resetStatusTimerRef.current);
          resetStatusTimerRef.current = setTimeout(() => {
            setStatus("listening");
          }, 2000);
        } else {
          setStatus("listening");
        }
      } catch {
        if (!cancelled) {
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
            echoCancellation: false,
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

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5">
          <div
          className={`w-1.5 h-1.5 rounded-full ${
            status === "listening"
              ? "bg-green-400 animate-pulse"
              : status === "detected"
              ? "bg-red-400 animate-ping"
              : status === "denied"
              ? "bg-red-400"
              : "bg-gray-500"
          }`}
        />
        <p className="text-gray-500 text-xs">
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
