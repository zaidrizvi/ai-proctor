import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import api from "../../utils/api.js";
import { getTokenForPath } from "../../utils/authStorage.js";
import { blobToDataUrl } from "../../utils/imageCapture.js";
import { describeMlError, postMlMultipart } from "../../utils/mlClient.js";
import {
  isProctorEventEnabled,
  isVisualProctoringEnabled,
  resolveExamProctorSettings,
} from "../../utils/proctorSettings.js";
import { useSocket } from "../../context/SocketContext.jsx";
import useProctor from "../../hooks/useProctor.js";
import AudioMonitor from "../proctor/AudioMonitor.jsx";
import StatusBadge from "../shared/StatusBadge.jsx";
import {
  FiAlertTriangle,
  FiCameraOff,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
} from "react-icons/fi";

void motion;
const HIGH_QUALITY_VIDEO_CONSTRAINTS = {
  width: { ideal: 1280, min: 960 },
  height: { ideal: 720, min: 540 },
  facingMode: "user",
};
const EXAM_AUDIO_CONSTRAINTS = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
const TAB_SWITCH_COOLDOWN_MS = 1500;
const EVENT_LOG_COOLDOWNS_MS = {
  audio_detected: 1200,
  head_turned: 2000,
  face_not_detected: 2000,
  camera_frame_unavailable: 8000,
  multiple_faces: 3000,
  object_detected: 3000,
  face_mismatch: 3000,
  tab_switch: 1500,
  fullscreen_exit: 3000,
  ml_service_unavailable: 30000,
};
const SHOW_STUDENT_DEBUG_UI = false;
const SHOW_STUDENT_ML_PREVIEW = true;
const LIVE_ALERT_LIMIT = 4;
const BASELINE_MIN_POSE_QUALITY = 0.56;
const BASELINE_RETRY_DELAY_MS = 3500;
const BASELINE_CAPTURE_ATTEMPTS = 18;
const BASELINE_CAPTURE_PAUSE_MS = 220;
const BASELINE_TARGET_HEAD_SAMPLES = 6;
const BASELINE_MIN_HEAD_SAMPLES = 5;
const BASELINE_MAX_MOVEMENT_SCORE = 0.95;
const BASELINE_MAX_COMBINED_MOVEMENT_SCORE = 1.02;
const BASELINE_MAX_HEAD_DELTA = {
  pitch: 8,
  yaw: 7.5,
  roll: 7,
  nose_offset_x: 0.055,
  nose_offset_y: 0.05,
};
const BASELINE_MAX_HEAD_SPREAD = {
  pitch: 6.5,
  yaw: 5.5,
  roll: 6,
  nose_offset_x: 0.042,
  nose_offset_y: 0.04,
};
const BASELINE_SAMPLE_KEYS = [
  "pitch",
  "yaw",
  "roll",
  "nose_offset_x",
  "nose_offset_y",
];
const EVENT_LABELS = {
  face_not_detected: "Face Missing",
  camera_frame_unavailable: "Camera Frame Unavailable",
  multiple_faces: "Multiple Faces",
  head_turned: "Head Turned",
  audio_detected: "Audio Detected",
  object_detected: "Object Detected",
  tab_switch: "Tab Switch",
  fullscreen_exit: "Fullscreen Exit",
  face_mismatch: "Face Mismatch",
  ml_service_unavailable: "ML Unavailable",
};

const getSeverityClassName = (severity) => {
  if (severity === "high") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (severity === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-sky-500/30 bg-sky-500/10 text-sky-200";
};

const getIdentityTone = (status) => {
  if (["verified", "ready"].includes(status)) return "success";
  if (["mismatch", "invalid_reference", "service_unavailable", "microphone_denied", "missing"].includes(status)) return "danger";
  return "warning";
};

const getIdentityLabel = (status) => {
  if (status === "verified") return "Verified";
  if (status === "ready") return "Ready";
  if (status === "mismatch") return "Mismatch";
  if (status === "service_unavailable") return "Service unavailable";
  if (status === "microphone_denied") return "Mic needed";
  if (status === "missing") return "Reference missing";
  if (status === "enrolling") return "Saving reference";
  if (status === "verifying") return "Verifying";
  if (status === "starting") return "Starting exam";
  if (status === "fullscreen_required") return "Fullscreen needed";
  return "Pending";
};

const isStableAgainstPrevious = (previousSample, nextSample, maxDeltas) => {
  if (!previousSample) {
    return true;
  }

  return Object.entries(maxDeltas).every(([key, maxDelta]) => {
    return Math.abs(Number(nextSample[key]) - Number(previousSample[key])) <= maxDelta;
  });
};

const summarizeSamples = (samples, keys) => {
  if (!Array.isArray(samples) || samples.length < 2) {
    return null;
  }

  const median = (values) => {
    const sorted = values.map(Number).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
      return sorted[middle];
    }

    return (sorted[middle - 1] + sorted[middle]) / 2;
  };

  const summarized = {};
  keys.forEach((key) => {
    summarized[key] = median(samples.map((sample) => sample[key]));
  });

  return summarized;
};

const measureSampleSpread = (samples, keys) => {
  if (!Array.isArray(samples) || samples.length === 0) {
    return null;
  }

  const spread = {};
  keys.forEach((key) => {
    const values = samples.map((sample) => Number(sample[key]));
    spread[key] = Math.max(...values) - Math.min(...values);
  });

  return spread;
};

const isSpreadConsistent = (spread, maxSpread) => {
  if (!spread) {
    return false;
  }

  return Object.entries(maxSpread).every(([key, limit]) => {
    return Number(spread[key] || 0) <= limit;
  });
};

const getMissingBaselineParts = (baseline) => {
  const missing = [];

  if (!baseline?.head) {
    missing.push("head");
  }

  return missing;
};

const isValidHeadPoseBaseline = (baseline) => {
  if (!baseline || typeof baseline !== "object") {
    return false;
  }

  return BASELINE_SAMPLE_KEYS.every((key) => Number.isFinite(Number(baseline[key])));
};

const getHeadPoseBaselineStorageKey = (examId, studentId) => {
  if (!examId || !studentId) {
    return "";
  }

  return `exam-head-pose-baseline:${studentId}:${examId}`;
};

// ── Webcam Monitor ────────────────────────────────────────────
const WebcamMonitor = ({
  enabled = true,
  onAlert,
  videoRef: externalVideoRef,
  streamRef: externalStreamRef,
}) => {
  const internalRef = useRef(null);
  const videoRef = externalVideoRef || internalRef;
  const streamRef = useRef(null);
  const [camStatus, setCamStatus] = useState("starting");

  useEffect(() => {
    if (!enabled) {
      setCamStatus("disabled");
      stopCamera();
      return undefined;
    }

    startCamera();
    return () => stopCamera();
  }, [enabled]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: HIGH_QUALITY_VIDEO_CONSTRAINTS,
        audio: false,
      });
      streamRef.current = stream;
      if (externalStreamRef) {
        externalStreamRef.current = stream;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamStatus("active");
    } catch {
      setCamStatus("denied");
      onAlert("camera_frame_unavailable", "high", "Camera access denied");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (externalStreamRef) {
      externalStreamRef.current = null;
    }
  };

  

  return (
    <div className="relative">
      <div className={`overflow-hidden rounded-[22px] border transition-colors ${
        camStatus === "active" ? "border-emerald-500/30" : "border-red-500/30"
      }`}>
        {camStatus === "disabled" ? (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-[var(--panel-strong)]">
            <FiCameraOff className="text-2xl text-[var(--app-subtle)]" />
            <p className="text-xs text-[var(--app-muted)]">Camera disabled</p>
          </div>
        ) : camStatus === "denied" ? (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-[var(--panel-strong)]">
            <FiCameraOff className="text-2xl text-red-300" />
            <p className="text-xs text-red-300">Camera denied</p>
          </div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline
            className="aspect-video w-full bg-[var(--app-bg)] object-contain" />
        )}
      </div>
      <div className={`absolute left-2 top-2 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        camStatus === "active"
          ? "bg-emerald-500/15 text-emerald-300"
          : camStatus === "disabled"
          ? "bg-[var(--panel-bg)] text-[var(--app-muted)]"
          : "bg-red-500/15 text-red-300"
      }`}>
        <div className={`w-1.5 h-1.5 rounded-full ${
          camStatus === "active"
            ? "bg-emerald-400 animate-pulse"
            : camStatus === "disabled"
            ? "bg-[var(--app-subtle)]"
            : "bg-red-400"
        }`} />
        {camStatus === "active" ? "Live" : camStatus === "disabled" ? "Disabled" : "Offline"}
      </div>
      
    </div>
  );
  
};

// ── Timer ─────────────────────────────────────────────────────
const Timer = ({ duration, onExpire }) => {
  const [seconds, setSeconds] = useState(duration);

  useEffect(() => {
    setSeconds(duration);
  }, [duration]);

  useEffect(() => {
    if (duration <= 0) {
      onExpire();
      return undefined;
    }

    const interval = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) { clearInterval(interval); onExpire(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [duration, onExpire]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const isWarning = seconds < 300;
  const isCritical = seconds < 60;

  return (
    <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-mono font-semibold ${
      isCritical ? "border-red-500/30 bg-red-500/12 text-red-300"
      : isWarning ? "border-amber-500/30 bg-amber-500/12 text-amber-200"
      : "border-[var(--app-border)] bg-[var(--panel-soft)] text-[var(--app-text)]"
    }`}>
      <FiClock className={isCritical ? "animate-pulse" : ""} />
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </div>
  );
};

// ── Main ExamInterface ────────────────────────────────────────
const ExamInterface = () => {
  const { examId } = useParams();
  const navigate = useNavigate();
  const { joinExamRoom } = useSocket();

  // refs
  const fullscreenReadyRef = useRef(false);
  const initStartedRef = useRef(false);
  const tabSwitchRef = useRef(0);
  const faceNotDetectedRef = useRef(0);
  const lastTabSwitchAtRef = useRef(0);
  const lastLoggedEventRef = useRef({});
  const sessionRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const pendingVerificationImageRef = useRef("");
  const baselineCalibrationRef = useRef(null);
  const progressSaveInFlightRef = useRef(false);
  const pendingProgressRef = useRef(null);
  const answersRef = useRef({});
  const currentQRef = useRef(0);
  const lastMlFramePreviewAtRef = useRef(0);
  const mlFramePreviewUrlRef = useRef("");
  const baselineRetryTimeoutRef = useRef(null);

  // state
  const [exam, setExam] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [examReady, setExamReady] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [submissionError, setSubmissionError] = useState("");
  const [referenceFace, setReferenceFace] = useState("");
  const [referenceFaceEmbedding, setReferenceFaceEmbedding] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [headPoseBaseline, setHeadPoseBaseline] = useState(null);
  const [baselineCalibrationInfo, setBaselineCalibrationInfo] = useState({
    status: "idle",
    missing: [],
    debug: null,
  });
  const [identityStatus, setIdentityStatus] = useState("loading");
  const [identityMessage, setIdentityMessage] = useState("Checking face verification status...");
  const [identityBusy, setIdentityBusy] = useState(false);
  const [startReady, setStartReady] = useState(false);
  const [microphonePrepared, setMicrophonePrepared] = useState(false);
  const [liveAlerts, setLiveAlerts] = useState([]);
  const [mlFramePreview, setMlFramePreview] = useState("");
  const [fullscreenLocked, setFullscreenLocked] = useState(false);

  const getRemainingSeconds = useCallback((activeSession, loadedExam) => {
    const totalSeconds = Number(loadedExam?.duration || 0) * 60;
    if (!activeSession?.startedAt || totalSeconds <= 0) {
      return totalSeconds;
    }

    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(activeSession.startedAt).getTime()) / 1000)
    );

    return Math.max(totalSeconds - elapsedSeconds, 0);
  }, []);

  const getHydratedProgress = useCallback((activeSession, loadedExam) => {
    const hydratedAnswers = {};

    (activeSession?.answers || []).forEach((answer) => {
      const questionIndex = Number(answer?.questionIndex);
      const selectedOption = Number(answer?.selectedOption);

      if (
        Number.isInteger(questionIndex) &&
        Number.isInteger(selectedOption) &&
        selectedOption >= 0 &&
        questionIndex >= 0
      ) {
        hydratedAnswers[questionIndex] = selectedOption;
      }
    });

    const totalQuestions = loadedExam?.questions?.length || 0;
    const savedIndex = Number(activeSession?.currentQuestionIndex);
    let restoredQuestionIndex = 0;

    if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < totalQuestions) {
      restoredQuestionIndex = savedIndex;
    } else if (totalQuestions > 0) {
      const firstUnanswered = loadedExam.questions.findIndex(
        (_, index) => hydratedAnswers[index] === undefined
      );
      restoredQuestionIndex = firstUnanswered >= 0 ? firstUnanswered : totalQuestions - 1;
    }

    return {
      hydratedAnswers,
      restoredQuestionIndex,
    };
  }, []);

  const pushLiveAlert = useCallback((eventType, severity, description) => {
    if (!SHOW_STUDENT_DEBUG_UI) {
      return;
    }

    setLiveAlerts((prev) => [
      {
        id: `${eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        eventType,
        severity,
        description,
        timestamp: Date.now(),
      },
      ...prev,
    ].slice(0, LIVE_ALERT_LIMIT));
  }, []);

  // ── logProctorEvent ─────────────────────────────────────────

  const logProctorEvent = useCallback(async (eventType, severity, description) => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    if (!isProctorEventEnabled(exam?.proctorSettings, eventType)) {
      return;
    }

    const cooldown = EVENT_LOG_COOLDOWNS_MS[eventType] ?? 5000;
    const dedupeKey =
      eventType === "audio_detected"
        ? eventType
        : `${eventType}:${description || ""}`;
    const now = Date.now();
    const lastLoggedAt = lastLoggedEventRef.current[dedupeKey] || 0;

    if (now - lastLoggedAt < cooldown) {
      return;
    }

    lastLoggedEventRef.current[dedupeKey] = now;
    pushLiveAlert(eventType, severity, description);

    try {
      await api.post("/proctor/event", {
        sessionId: currentSession._id,
        examId, eventType, severity, description,
      });
    } catch { /* silent fail */ }
  }, [exam?.proctorSettings, examId, pushLiveAlert]);

  // ── handleWebcamAlert ───────────────────────────────────────
  const handleWebcamAlert = useCallback((eventType, severity, description) => {
    if (eventType === "face_not_detected") faceNotDetectedRef.current += 1;
    logProctorEvent(eventType, severity, description);
  }, [logProctorEvent]);

  const handleMlFramePreview = useCallback((frame) => {
    if (!SHOW_STUDENT_ML_PREVIEW) {
      return;
    }

    const now = Date.now();
    if (now - lastMlFramePreviewAtRef.current < 800) {
      return;
    }

    lastMlFramePreviewAtRef.current = now;
    if (mlFramePreviewUrlRef.current) {
      URL.revokeObjectURL(mlFramePreviewUrlRef.current);
    }
    const previewUrl = URL.createObjectURL(frame);
    mlFramePreviewUrlRef.current = previewUrl;
    setMlFramePreview(previewUrl);
  }, []);

  const persistHeadPoseBaseline = useCallback((baseline, debug = null) => {
    const storageKey = getHeadPoseBaselineStorageKey(examId, studentId);
    if (!storageKey || !isValidHeadPoseBaseline(baseline)) {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        head: baseline,
        debug,
        savedAt: Date.now(),
      }));
    } catch {
      // Baseline persistence is a convenience for refresh/re-entry and should stay non-blocking.
    }
  }, [examId, studentId]);

  const restoreHeadPoseBaseline = useCallback(() => {
    const storageKey = getHeadPoseBaselineStorageKey(examId, studentId);
    if (!storageKey) {
      return false;
    }

    try {
      const rawValue = window.localStorage.getItem(storageKey);
      if (!rawValue) {
        return false;
      }

      const parsedValue = JSON.parse(rawValue);
      const restoredBaseline = parsedValue?.head || null;
      if (!isValidHeadPoseBaseline(restoredBaseline)) {
        return false;
      }

      setHeadPoseBaseline(restoredBaseline);
      setBaselineCalibrationInfo({
        status: "ready",
        missing: [],
        debug: parsedValue?.debug || null,
      });
      return true;
    } catch {
      return false;
    }
  }, [examId, studentId]);

  const clearHeadPoseBaseline = useCallback(() => {
    const storageKey = getHeadPoseBaselineStorageKey(examId, studentId);
    if (!storageKey) {
      return;
    }

    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Baseline cleanup should stay non-blocking.
    }
  }, [examId, studentId]);

  const proctorSettings = resolveExamProctorSettings(exam?.proctorSettings);
  const faceDetectionEnabled = proctorSettings.faceDetection;
  const faceVerificationEnabled = proctorSettings.faceVerification;
  const headMovementEnabled = proctorSettings.headMovement;
  const objectDetectionEnabled = proctorSettings.objectDetection;
  const audioDetectionEnabled = proctorSettings.audioDetection;
  const visualMonitoringEnabled = isVisualProctoringEnabled(proctorSettings);

  // ── useProctor hook ─────────────────────────────────────────
  const {
    incrementTabSwitch,
    incrementFullscreenExit,
    incrementAudioDetected,
    incrementFaceMismatch,
    captureFrame,
  } = useProctor({
    videoRef: webcamVideoRef,
    streamRef: webcamStreamRef,
    sessionId: session?._id,
    examId,
    enabled: examReady && !submitted && visualMonitoringEnabled,
    referenceFace,
    referenceFaceEmbedding,
    headPoseBaseline,
    suppressHeadTurnAlerts: baselineCalibrationInfo.status !== "ready",
    faceDetectionEnabled,
    faceVerificationEnabled,
    headMovementEnabled,
    objectDetectionEnabled,
    onAlert: handleWebcamAlert,
    onMlFrame: handleMlFramePreview,
    intervalMs: 800,
    verifyIntervalMs: 30000,
  });

  useEffect(() => {
    if (!headMovementEnabled || headPoseBaseline || !studentId) {
      return;
    }

    void restoreHeadPoseBaseline();
  }, [headMovementEnabled, headPoseBaseline, restoreHeadPoseBaseline, studentId]);

  useEffect(() => {
    if (
      baselineCalibrationInfo.status !== "ready" ||
      !isValidHeadPoseBaseline(headPoseBaseline)
    ) {
      return;
    }

    persistHeadPoseBaseline(headPoseBaseline, baselineCalibrationInfo.debug || null);
  }, [
    baselineCalibrationInfo.debug,
    baselineCalibrationInfo.status,
    headPoseBaseline,
    persistHeadPoseBaseline,
  ]);

  // ── init exam ───────────────────────────────────────────────
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    void initExam();
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    currentQRef.current = currentQ;
  }, [currentQ]);

  useEffect(() => {
    if (examReady && !submitted) return;
    if (mlFramePreviewUrlRef.current) {
      URL.revokeObjectURL(mlFramePreviewUrlRef.current);
      mlFramePreviewUrlRef.current = "";
    }
    setMlFramePreview("");
    lastMlFramePreviewAtRef.current = 0;
  }, [examReady, submitted]);

  useEffect(() => {
    return () => {
      if (mlFramePreviewUrlRef.current) {
        URL.revokeObjectURL(mlFramePreviewUrlRef.current);
        mlFramePreviewUrlRef.current = "";
      }
    };
  }, []);

  const loadFaceReference = async (settingsOverride = null) => {
    const effectiveSettings = resolveExamProctorSettings(
      settingsOverride || exam?.proctorSettings
    );
    const effectiveFaceVerificationEnabled = effectiveSettings.faceVerification;
    const effectiveHeadMovementEnabled = effectiveSettings.headMovement;

    try {
      const { data } = await api.get("/auth/me");
      setStudentId(data._id || "");
      const savedReference = data.faceImagePath || "";
      const savedReferenceEmbedding = Array.isArray(data.faceEmbedding) ? data.faceEmbedding : [];
      setReferenceFace(savedReference);
      setReferenceFaceEmbedding(savedReferenceEmbedding);
      if (!effectiveFaceVerificationEnabled && !effectiveHeadMovementEnabled) {
        setIdentityStatus("ready");
        setIdentityMessage("This exam can start without face verification or head baseline setup.");
      } else if (!effectiveFaceVerificationEnabled) {
        setIdentityStatus("ready");
        setIdentityMessage("Face verification is disabled for this exam. Only head baseline setup is required before starting.");
      } else if (savedReference) {
        setIdentityStatus(effectiveHeadMovementEnabled ? "ready" : "verified");
        setIdentityMessage(
          effectiveHeadMovementEnabled
            ? "Reference face is available for verification."
            : "Reference face is available and face verification is the only required check."
        );
      } else {
        setIdentityStatus("missing");
        setIdentityMessage("No reference face saved yet. Capture one before the exam for identity checks.");
      }
    } catch {
      setStudentId("");
      if (!effectiveFaceVerificationEnabled && !effectiveHeadMovementEnabled) {
        setIdentityStatus("ready");
        setIdentityMessage("Exam setup can continue without loading a stored face reference.");
      } else {
        setIdentityStatus("unavailable");
        setIdentityMessage("Profile lookup failed. Face verification will run only if a reference is available.");
      }
    }
  };

  const captureIdentityFrame = useCallback(async () => {
    const frame = await captureFrame();
    if (!frame) {
      setIdentityStatus("camera_not_ready");
      setIdentityMessage("Camera frame is not ready yet. Wait a moment and try again.");
      return null;
    }
    return frame;
  }, [captureFrame]);

  const saveReferenceFace = useCallback(async () => {
    if (!faceVerificationEnabled) {
      return { saved: false, reference: "" };
    }

    setStartReady(false);
    pendingVerificationImageRef.current = "";
    const frame = await captureIdentityFrame();
    if (!frame) return { saved: false, reference: "" };

    setIdentityBusy(true);
    setIdentityStatus("enrolling");
    setIdentityMessage("Checking the captured frame before saving it as the reference face...");

    try {
      const { data: embeddingResult } = await postMlMultipart("/face/reference-embedding", {
        frame,
      }, {
        label: "exam.face.reference_embedding",
        retries: 1,
        timeoutMs: 20000,
        warmup: true,
      });

      if (!embeddingResult.embedding_created || !Array.isArray(embeddingResult.embedding)) {
        setIdentityStatus("invalid_reference");
        setIdentityMessage("Capture a clear frame with exactly one visible face before starting the exam.");
        return { saved: false, reference: "" };
      }

      const frameDataUrl = await blobToDataUrl(frame);
      const { data } = await api.post("/auth/face-reference", {
        faceImage: frameDataUrl,
        faceEmbedding: embeddingResult.embedding,
      });
      const savedReference = data.faceImagePath || frameDataUrl;
      const savedReferenceEmbedding = Array.isArray(data.faceEmbedding)
        ? data.faceEmbedding
        : embeddingResult.embedding;

      setReferenceFace(savedReference);
      setReferenceFaceEmbedding(savedReferenceEmbedding);
      setIdentityStatus("ready");
      setIdentityMessage("Reference face saved. Identity verification is ready.");
      return { saved: true, reference: savedReference };
    } catch (err) {
      const message = err?.mlMeta
        ? describeMlError(err, { actionLabel: "Reference face setup" })
        : err.response?.data?.message ||
          "Reference face could not be saved right now. Retry after the verification service is available.";

      setIdentityStatus("save_failed");
      setIdentityMessage(message);
      return { saved: false, reference: "" };
    } finally {
      setIdentityBusy(false);
    }
  }, [captureIdentityFrame, faceVerificationEnabled]);

  const saveVerificationFaceImage = useCallback(async (image, sessionIdOverride = "") => {
    const activeSessionId = sessionIdOverride || session?._id;
    if (!activeSessionId || !image) return;

    try {
      await api.post("/proctor/verification-face", {
        sessionId: activeSessionId,
        verificationFaceImage: image,
      });
    } catch {
      // Verification image is useful for reports but should not block the exam.
    }
  }, [session?._id]);

  const prepareMicrophoneForExam = useCallback(async () => {
    if (!audioDetectionEnabled) {
      return true;
    }

    if (microphonePrepared) {
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setIdentityStatus("service_unavailable");
      setIdentityMessage("This browser cannot request microphone access for proctoring.");
      return false;
    }

    setIdentityStatus("verifying");
      setIdentityMessage("Allow microphone access to continue with audio proctoring.");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: EXAM_AUDIO_CONSTRAINTS,
        video: false,
      });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophonePrepared(true);
      return true;
    } catch {
      setIdentityStatus("microphone_denied");
      setIdentityMessage("Microphone access is required because audio detection is enabled for this exam.");
      return false;
    }
  }, [audioDetectionEnabled, microphonePrepared]);

  const verifyCurrentFace = useCallback(async (referenceOverride = "") => {
    if (!faceVerificationEnabled) {
      return { status: "skipped" };
    }

    setStartReady(false);
    pendingVerificationImageRef.current = "";
    const activeReference = referenceOverride || referenceFace;

    if (!activeReference) {
      setIdentityStatus("missing");
      setIdentityMessage("No reference face saved yet. Identity verification is skipped.");
      return { status: "skipped" };
    }

    const frame = await captureIdentityFrame();
    if (!frame) return { status: "camera_not_ready" };

    setIdentityBusy(true);
    setIdentityStatus("verifying");
    setIdentityMessage("Verifying your face against the saved reference...");

    try {
      const { data } = await postMlMultipart("/face/verify", {
        frame,
        ...(referenceFaceEmbedding.length > 0
          ? { reference_embedding: referenceFaceEmbedding }
          : activeReference
          ? { reference: activeReference }
          : {}),
      }, {
        label: "exam.face.verify",
        retries: 1,
        timeoutMs: 20000,
        warmup: true,
      });

      if (!data.verification_checked) {
        setIdentityStatus("camera_not_ready");
        setIdentityMessage("Face verification needs one clear face in the frame. Adjust your position and try again.");
        return { status: "retry", data };
      }

      if (data.verified) {
        setIdentityStatus("verified");
        setIdentityMessage("Face verified. You can begin the exam.");
        return {
          status: "verified",
          verificationImage: await blobToDataUrl(frame),
        };
      }

      setIdentityStatus("mismatch");
      setIdentityMessage("Saved reference does not match the current webcam frame. Retry before starting.");
      return { status: "mismatch", data };
    } catch (error) {
      setIdentityStatus("service_unavailable");
      setIdentityMessage(describeMlError(error, { actionLabel: "Face verification" }));
      return { status: "unavailable" };
    } finally {
      setIdentityBusy(false);
    }
  }, [captureIdentityFrame, faceVerificationEnabled, referenceFace, referenceFaceEmbedding, saveVerificationFaceImage]);

  const activateSession = useCallback((activeSession, loadedExam = exam) => {
    if (!activeSession) return;

    setSession(activeSession);
    sessionRef.current = activeSession;

    const { hydratedAnswers, restoredQuestionIndex } = getHydratedProgress(
      activeSession,
      loadedExam
    );
    setAnswers(hydratedAnswers);
    setCurrentQ(restoredQuestionIndex);

    if (activeSession.status === "ongoing") {
      joinExamRoom(examId);
      setExamReady(true);
    }

    if (activeSession.status === "completed" && loadedExam) {
      clearHeadPoseBaseline();
      setResult({
        score: activeSession.score || 0,
        percentage: activeSession.percentage || 0,
        passed: Boolean(activeSession.passed),
        totalQuestions: loadedExam.questions?.length || 0,
      });
      setSubmitted(true);
      setExamReady(true);
      return;
    }

    if (activeSession.status === "terminated" || activeSession.status === "abandoned") {
      clearHeadPoseBaseline();
      setError(`This exam session is already ${activeSession.status}.`);
    }
  }, [clearHeadPoseBaseline, exam, examId, getHydratedProgress, joinExamRoom]);

  const ensureExamSession = useCallback(async () => {
    if (sessionRef.current?._id) {
      return sessionRef.current;
    }

    const { data } = await api.post(`/exams/${examId}/start`);
    const activeSession = data.session;
    activateSession(activeSession);
    return activeSession;
  }, [activateSession, examId]);

  const calibrateAttentionBaseline = useCallback(async () => {
    if (!headMovementEnabled) {
      return { head: null, debug: null };
    }

    const headSamples = [];
    let lastAcceptedHeadSample = null;
    let poseQualityTotal = 0;
    let attemptsUsed = 0;

    for (let attempt = 0; attempt < BASELINE_CAPTURE_ATTEMPTS; attempt += 1) {
      attemptsUsed = attempt + 1;
      const frame = await captureIdentityFrame();
      if (!frame) {
        await new Promise((resolve) => window.setTimeout(resolve, BASELINE_CAPTURE_PAUSE_MS));
        continue;
      }

      try {
        const { data: headData } = await postMlMultipart("/head/analyze", {
          frame,
          tracker_id: session?._id || examId || "default",
        }, {
          label: "exam.head.baseline",
          retries: 1,
          timeoutMs: 16000,
          warmup: true,
        });

        if (
          headData.head_detected &&
          Number(headData.pose_quality || 0) >= BASELINE_MIN_POSE_QUALITY &&
          !headData.obvious_turn &&
          !headData.clear_yaw_turn &&
          Number(headData.movement_score || 0) <= BASELINE_MAX_MOVEMENT_SCORE &&
          Number(headData.combined_movement_score || 0) <= BASELINE_MAX_COMBINED_MOVEMENT_SCORE &&
          !(
            headData.downward_signal &&
            (headData.turn_axis || "none") === "downward" &&
            Number(headData.combined_movement_score || 0) >= 0.9
          )
        ) {
          const headSample = {
            pitch: headData.pitch,
            yaw: headData.yaw,
            roll: headData.roll,
            nose_offset_x: headData.nose_offset_x,
            nose_offset_y: headData.nose_offset_y,
          };

          if (isStableAgainstPrevious(lastAcceptedHeadSample, headSample, BASELINE_MAX_HEAD_DELTA)) {
            headSamples.push(headSample);
            lastAcceptedHeadSample = headSample;
            poseQualityTotal += Number(headData.pose_quality || 0);

            if (headSamples.length >= BASELINE_MIN_HEAD_SAMPLES) {
              const spread = measureSampleSpread(headSamples, BASELINE_SAMPLE_KEYS);
              if (
                isSpreadConsistent(spread, BASELINE_MAX_HEAD_SPREAD) &&
                headSamples.length >= BASELINE_TARGET_HEAD_SAMPLES
              ) {
                break;
              }
            }
          }
        }
      } catch (error) {
        console.warn("Baseline head-pose sample failed:", error?.mlMeta || error);
      }

      await new Promise((resolve) => window.setTimeout(resolve, BASELINE_CAPTURE_PAUSE_MS));
    }

    const spread = measureSampleSpread(headSamples, BASELINE_SAMPLE_KEYS);
    const consistencyPassed = (
      headSamples.length >= BASELINE_MIN_HEAD_SAMPLES &&
      isSpreadConsistent(spread, BASELINE_MAX_HEAD_SPREAD)
    );
    const headBaseline = consistencyPassed
      ? summarizeSamples(headSamples, BASELINE_SAMPLE_KEYS)
      : null;

    return {
      head: headBaseline,
      debug: {
        acceptedSamples: headSamples.length,
        attemptsUsed,
        averagePoseQuality: headSamples.length > 0
          ? Number((poseQualityTotal / headSamples.length).toFixed(3))
          : 0,
        spread: spread
          ? Object.fromEntries(
            Object.entries(spread).map(([key, value]) => [key, Number(value.toFixed(4))])
          )
          : null,
        consistencyPassed,
      },
    };
  }, [captureIdentityFrame, examId, headMovementEnabled, session?._id]);

  const queueBaselineCalibration = useCallback(async () => {
    if (!headMovementEnabled) {
      setHeadPoseBaseline(null);
      setBaselineCalibrationInfo({
        status: "ready",
        missing: [],
        debug: null,
      });
      return {
        head: null,
        ready: true,
        debug: null,
      };
    }

    if (isValidHeadPoseBaseline(headPoseBaseline)) {
      setBaselineCalibrationInfo((prev) => ({
        status: "ready",
        missing: [],
        debug: prev.debug,
      }));
      return {
        head: headPoseBaseline,
        ready: true,
        debug: baselineCalibrationInfo.debug || null,
      };
    }

    if (baselineCalibrationRef.current) {
      return baselineCalibrationRef.current;
    }

    setBaselineCalibrationInfo((prev) => ({
      status: prev.status === "ready" ? "ready" : "calibrating",
      missing: prev.status === "ready" ? [] : prev.missing,
      debug: prev.status === "ready" ? prev.debug : null,
    }));
    baselineCalibrationRef.current = calibrateAttentionBaseline()
      .then((baseline) => {
        const nextHeadBaseline = baseline?.head || null;
        const missing = getMissingBaselineParts({
          head: nextHeadBaseline,
        });

        setHeadPoseBaseline(nextHeadBaseline);
        setBaselineCalibrationInfo({
          status: missing.length === 0 ? "ready" : "retrying",
          missing,
          debug: baseline?.debug || null,
        });
        return {
          ...baseline,
          ready: missing.length === 0,
        };
      })
      .catch(() => {
        setHeadPoseBaseline(null);
        setBaselineCalibrationInfo({
          status: "retrying",
          missing: ["head"],
          debug: null,
        });
        return { head: null, ready: false, debug: null };
      })
      .finally(() => {
        baselineCalibrationRef.current = null;
      });

    return baselineCalibrationRef.current;
  }, [baselineCalibrationInfo.debug, calibrateAttentionBaseline, headMovementEnabled, headPoseBaseline]);

  useEffect(() => {
    if (baselineRetryTimeoutRef.current) {
      window.clearTimeout(baselineRetryTimeoutRef.current);
      baselineRetryTimeoutRef.current = null;
    }

    if (!examReady || submitted || !headMovementEnabled) {
      return undefined;
    }

    const missing = getMissingBaselineParts({
      head: headPoseBaseline,
    });

    if (missing.length === 0) {
      setBaselineCalibrationInfo((prev) => ({
        status: "ready",
        missing: [],
        debug: prev.debug,
      }));
      return undefined;
    }

    setBaselineCalibrationInfo((prev) => ({
      status: prev.status === "calibrating" ? prev.status : "retrying",
      missing,
      debug: prev.debug,
    }));

    baselineRetryTimeoutRef.current = window.setTimeout(() => {
      void queueBaselineCalibration();
    }, BASELINE_RETRY_DELAY_MS);

    return () => {
      if (baselineRetryTimeoutRef.current) {
        window.clearTimeout(baselineRetryTimeoutRef.current);
        baselineRetryTimeoutRef.current = null;
      }
    };
  }, [examReady, submitted, headMovementEnabled, headPoseBaseline, queueBaselineCalibration]);

  const exitFullscreenSafely = useCallback(async () => {
    fullscreenReadyRef.current = false;
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore browser fullscreen exit issues during setup recovery.
      }
    }
  }, []);

  const beginFullscreenAttempt = useCallback(() => {
    if (document.fullscreenElement) {
      setTimeout(() => { fullscreenReadyRef.current = true; }, 3000);
      return Promise.resolve(true);
    }

    return document.documentElement.requestFullscreen()
      .then(() => {
        setTimeout(() => { fullscreenReadyRef.current = true; }, 3000);
        return true;
      })
      .catch(() => false);
  }, []);

  const restoreFullscreenFromKeyboard = useCallback(async () => {
    if (document.fullscreenElement) {
      setFullscreenLocked(false);
      return true;
    }

    try {
      await document.documentElement.requestFullscreen();
      setFullscreenLocked(false);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleBeginExam = async () => {
    if (identityBusy) return;

    if (startReady) {
      setIdentityBusy(true);
      setIdentityStatus("starting");
      setIdentityMessage("Entering fullscreen and starting your exam...");

      try {
        const fullscreenEntered = await beginFullscreenAttempt();
        if (!fullscreenEntered) {
          setIdentityStatus("fullscreen_required");
          setIdentityMessage("Fullscreen was blocked by the browser. Please click the button again and allow fullscreen.");
          return;
        }

        const activeSession = await ensureExamSession();
        if (!activeSession) {
          await exitFullscreenSafely();
          return;
        }

        if (pendingVerificationImageRef.current) {
          void saveVerificationFaceImage(
            pendingVerificationImageRef.current,
            activeSession._id
          );
          pendingVerificationImageRef.current = "";
        }

        if (activeSession.status === "completed" || activeSession.status === "terminated" || activeSession.status === "abandoned") {
          activateSession(activeSession);
          await exitFullscreenSafely();
          return;
        }

        setExamReady(true);
      } catch (err) {
        await exitFullscreenSafely();
        setError(err.response?.data?.message || "Failed to start exam.");
      } finally {
        setIdentityBusy(false);
      }

      return;
    }

    if (document.fullscreenElement) {
      await exitFullscreenSafely();
    }

    const verificationAlreadyReady = !faceVerificationEnabled || identityStatus === "verified";
    const microphoneReady = await prepareMicrophoneForExam();
    if (!microphoneReady) {
      return;
    }

    let hasReference = Boolean(referenceFace);
    let activeReference = referenceFace;
    let verificationResult = { status: "skipped", verificationImage: "" };

    if (faceVerificationEnabled && !verificationAlreadyReady && !hasReference) {
      const enrollment = await saveReferenceFace();
      hasReference = enrollment.saved;
      activeReference = enrollment.reference;
      if (!hasReference) {
        return;
      }
    }

    if (faceVerificationEnabled && !verificationAlreadyReady && hasReference) {
      verificationResult = await verifyCurrentFace(activeReference);
      if (verificationResult.status !== "verified" && verificationResult.status !== "skipped") {
        if (verificationResult.status === "mismatch") {
          incrementFaceMismatch();
          logProctorEvent("face_mismatch", "high", "Pre-exam face verification failed");
        }
        return;
      }
    }

    if (faceVerificationEnabled && !verificationAlreadyReady) {
      pendingVerificationImageRef.current = verificationResult.verificationImage || "";
    }

    if (!headMovementEnabled) {
      setStartReady(true);
      setIdentityStatus(faceVerificationEnabled ? "verified" : "ready");
      setIdentityMessage(
        faceVerificationEnabled
          ? "Face verified. Click once more to enter fullscreen and start the exam."
          : "Pre-exam checks are complete. Click once more to enter fullscreen and start the exam."
      );
      return;
    }

    setIdentityBusy(true);
    setIdentityStatus(faceVerificationEnabled ? "verified" : "ready");
    setIdentityMessage(
      faceVerificationEnabled
        ? "Face verified. Capturing a short head pose baseline before the exam starts..."
        : "Capturing a short head pose baseline before the exam starts..."
    );

    try {
      const baselineResult = await queueBaselineCalibration();
      if (!baselineResult?.ready) {
        setStartReady(false);
        setIdentityStatus(faceVerificationEnabled ? "verified" : "ready");
        setIdentityMessage(
          faceVerificationEnabled
            ? "Face verified, but head pose baseline needs cleaner centered samples. Stay still and click again."
            : "Head pose baseline needs cleaner centered samples. Stay still and click again."
        );
        return;
      }

      setStartReady(true);
      setIdentityStatus(faceVerificationEnabled ? "verified" : "ready");
      setIdentityMessage(
        faceVerificationEnabled
          ? "Face verified and head pose baseline is ready. Click once more to enter fullscreen and start the exam."
          : "Head pose baseline is ready. Click once more to enter fullscreen and start the exam."
      );
    } finally {
      setIdentityBusy(false);
    }
  };

  const initExam = async () => {
    try {
      const [examRes, sessionRes] = await Promise.all([
        api.get(`/exams/${examId}`),
        api.get(`/exams/${examId}/session`),
      ]);
      const loadedExam = examRes.data;
      const loadedSession = sessionRes.data.session || null;

      setExam(loadedExam);
      await loadFaceReference(loadedExam.proctorSettings);
      if (loadedSession) {
        activateSession(loadedSession, loadedExam);
      }

      if (loadedSession?.status === "completed") {
        return;
      }

      if (loadedSession?.status === "terminated" || loadedSession?.status === "abandoned") {
        setError(`This exam session is already ${loadedSession.status}.`);
        return;
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load exam.");
    } finally {
      setLoading(false);
    }
  };

  // ── proctoring setup ────────────────────────────────────────
  const setupProctoring = () => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
  };

  const cleanupProctoring = () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("blur", handleWindowBlur);
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
  };

  const registerTabSwitch = useCallback((severity, description) => {
    const now = Date.now();
    if (now - lastTabSwitchAtRef.current < TAB_SWITCH_COOLDOWN_MS) {
      return;
    }

    lastTabSwitchAtRef.current = now;
    tabSwitchRef.current += 1;
    incrementTabSwitch();
    logProctorEvent("tab_switch", severity, description);
  }, [incrementTabSwitch]);

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      registerTabSwitch("high", "Student switched tabs or minimized window");
    }
  }, [registerTabSwitch]);

  const handleWindowBlur = useCallback(() => {
    if (!document.hidden) {
      registerTabSwitch("medium", "Window lost focus");
    }
  }, [registerTabSwitch]);

  const handleFullscreenChange = useCallback(() => {
    const inFullscreen = !!document.fullscreenElement;

    if (examReady && !submitted && !submitting) {
      setFullscreenLocked(!inFullscreen);
    }

    if (!fullscreenReadyRef.current || submitting) return;
    setTimeout(() => {
      const stillInFullscreen = !!document.fullscreenElement;
      if (!stillInFullscreen) {
        incrementFullscreenExit();
        logProctorEvent("fullscreen_exit", "high", "Student exited fullscreen");
      }
    }, 100);
  }, [examReady, incrementFullscreenExit, logProctorEvent, submitted, submitting]);

  useEffect(() => {
    if (!examReady || submitted) return undefined;

    setupProctoring();
    return () => cleanupProctoring();
  }, [examReady, submitted, handleVisibilityChange, handleWindowBlur, handleFullscreenChange]);

  useEffect(() => {
    if (!examReady || submitted || submitting) {
      setFullscreenLocked(false);
      return undefined;
    }

    setFullscreenLocked(!document.fullscreenElement);

    return undefined;
  }, [examReady, submitted, submitting]);

  useEffect(() => {
    if (!examReady || submitted || !fullscreenLocked) {
      return undefined;
    }

    const handleFullscreenRestoreKey = (event) => {
      const targetTag = event.target?.tagName || "";
      const isTypingTarget = ["INPUT", "TEXTAREA", "SELECT"].includes(targetTag);

      if (isTypingTarget) {
        return;
      }

      if (event.key?.toLowerCase() !== "f") {
        return;
      }

      event.preventDefault();
      void restoreFullscreenFromKeyboard();
    };

    window.addEventListener("keydown", handleFullscreenRestoreKey);
    return () => {
      window.removeEventListener("keydown", handleFullscreenRestoreKey);
    };
  }, [examReady, fullscreenLocked, restoreFullscreenFromKeyboard, submitted]);

  // ── answer + submit ─────────────────────────────────────────
  const persistExamProgress = useCallback(async (
    nextAnswers,
    nextQuestionIndex
  ) => {
    const activeSession = sessionRef.current;
    if (
      !activeSession?._id ||
      activeSession.status !== "ongoing" ||
      submitted ||
      progressSaveInFlightRef.current
    ) {
      if (progressSaveInFlightRef.current) {
        pendingProgressRef.current = {
          answers: nextAnswers,
          currentQuestionIndex: nextQuestionIndex,
        };
      }
      return;
    }

    progressSaveInFlightRef.current = true;

    try {
      const formattedAnswers = Object.entries(nextAnswers).map(([questionIndex, selectedOption]) => ({
        questionIndex: Number(questionIndex),
        selectedOption,
      }));

      const { data } = await api.post(`/exams/${examId}/progress`, {
        answers: formattedAnswers,
        currentQuestionIndex: nextQuestionIndex,
      });

      if (data?.session) {
        setSession(data.session);
        sessionRef.current = data.session;
      }
    } catch {
      // Progress persistence should not interrupt the exam flow.
    } finally {
      progressSaveInFlightRef.current = false;

      if (pendingProgressRef.current) {
        const pendingProgress = pendingProgressRef.current;
        pendingProgressRef.current = null;
        void persistExamProgress(
          pendingProgress.answers,
          pendingProgress.currentQuestionIndex
        );
      }
    }
  }, [examId, submitted]);

  useEffect(() => {
    if (!examId || !session?._id || session.status !== "ongoing" || submitted) {
      return undefined;
    }

    const flushProgressOnPageHide = () => {
      const latestAnswers = answersRef.current;
      const latestQuestionIndex = currentQRef.current;

      if (progressSaveInFlightRef.current || !sessionRef.current?._id) {
        return;
      }

      const formattedAnswers = Object.entries(latestAnswers).map(([questionIndex, selectedOption]) => ({
        questionIndex: Number(questionIndex),
        selectedOption,
      }));

      const payload = JSON.stringify({
        answers: formattedAnswers,
        currentQuestionIndex: latestQuestionIndex,
      });

      const token = getTokenForPath(window.location.pathname);
      if (!token) {
        return;
      }

      void fetch(`${api.defaults.baseURL}/exams/${examId}/progress`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: payload,
      });
    };

    window.addEventListener("pagehide", flushProgressOnPageHide);
    return () => {
      window.removeEventListener("pagehide", flushProgressOnPageHide);
    };
  }, [examId, session?._id, session?.status, submitted]);

  const updateCurrentQuestion = useCallback((nextQuestionIndex) => {
    if (fullscreenLocked) {
      return;
    }

    setCurrentQ(nextQuestionIndex);
    void persistExamProgress(answers, nextQuestionIndex);
  }, [answers, fullscreenLocked, persistExamProgress]);

  const handleAnswerSelection = useCallback((questionIndex, optionIndex) => {
    if (fullscreenLocked) {
      return;
    }

    const nextAnswers = {
      ...answers,
      [questionIndex]: optionIndex,
    };
    setAnswers(nextAnswers);
    void persistExamProgress(nextAnswers, currentQ);
  }, [answers, currentQ, fullscreenLocked, persistExamProgress]);

  const handleSubmit = () => {
    if (fullscreenLocked) {
      return;
    }

    submitExam();
  };

  const startActionLabel = identityBusy
    ? "Working..."
    : startReady
    ? "Enter Fullscreen & Start"
    : headMovementEnabled && identityStatus === "verified"
    ? "Finish Baseline"
    : faceVerificationEnabled
    ? "Verify Face & Continue"
    : "Continue to Exam Setup";

  const setupPanelTitle = faceVerificationEnabled && headMovementEnabled
    ? "Identity & Baseline Check"
    : faceVerificationEnabled
    ? "Identity Check"
    : headMovementEnabled
    ? "Baseline Check"
    : audioDetectionEnabled
    ? "Pre-Exam Check"
    : "Ready to Start";
  const showReferenceSetupButton = faceVerificationEnabled && !referenceFace;

  const submitExam = async () => {
    setSubmitting(true);
    setSubmissionError("");
    fullscreenReadyRef.current = false;
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore fullscreen exit issues during normal submission.
      }
    }
    try {
      const formattedAnswers = Object.entries(answers).map(([qi, opt]) => ({
        questionIndex: parseInt(qi),
        selectedOption: opt,
      }));
      const { data } = await api.post(`/exams/${examId}/submit`, {
        answers: formattedAnswers,
        tabSwitchCount: tabSwitchRef.current,
        faceNotDetectedCount: faceNotDetectedRef.current,
      });
      clearHeadPoseBaseline();
      setResult(data);
      setSubmitted(true);
    } catch (err) {
      setSubmissionError(err.response?.data?.message || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── loading / error ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-6" style={{ backgroundImage: "var(--app-gradient)" }}>
        <div className="theme-panel rounded-[32px] px-8 py-10 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent-strong)] border-t-transparent" />
          <p className="text-sm text-[var(--app-muted)]">Setting up exam...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-6" style={{ backgroundImage: "var(--app-gradient)" }}>
        <div className="theme-panel max-w-md rounded-[32px] px-8 py-10 text-center">
          <FiAlertTriangle className="mx-auto mb-4 text-4xl text-red-300" />
          <p className="mb-2 text-lg font-semibold text-[var(--app-text)]">Failed to load exam</p>
          <p className="mb-5 text-sm text-[var(--app-muted)]">{error}</p>
          <button onClick={() => navigate("/student/dashboard")} className="text-purple-400 text-sm">
            ← Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── ready screen (before exam starts) ──────────────────────
  if (!examReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4 py-5 sm:px-6 lg:px-8" style={{ backgroundImage: "var(--app-gradient)" }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="theme-panel mx-auto w-full max-w-5xl rounded-[30px] p-4 sm:p-5"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,540px)_minmax(360px,460px)] lg:justify-center lg:items-center">
            <div className="mx-auto w-full max-w-[540px] space-y-3">
              {visualMonitoringEnabled ? (
                <>
                  <div
                    className="rounded-[26px] border p-2.5"
                    style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
                  >
                    <WebcamMonitor
                      enabled={visualMonitoringEnabled}
                      onAlert={handleWebcamAlert}
                      videoRef={webcamVideoRef}
                      streamRef={webcamStreamRef}
                    />
                  </div>
                  <div className="rounded-[20px] border border-amber-500/20 bg-amber-500/8 px-4 py-2.5 text-xs text-amber-200">
                    Keep your face centered and stay still for a few seconds during setup.
                  </div>
                </>
              ) : (
                <div
                  className="rounded-[26px] border px-5 py-6 text-sm text-[var(--app-muted)]"
                  style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
                >
                  This exam does not use camera-based proctoring.
                </div>
              )}
            </div>

            <div className="mx-auto w-full max-w-[460px] space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent-strong)]">Secure Exam Check</p>
                <h2 className="mt-1 text-[1.75rem] font-semibold tracking-tight text-[var(--app-text)]">{exam?.title}</h2>
                <p className="mt-0.5 text-sm text-[var(--app-muted)]">{exam?.subject}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[22px] border px-4 py-3" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--app-subtle)]">Questions</p>
                  <p className="mt-1 text-[1.55rem] font-semibold text-[var(--app-text)]">{exam?.questions.length}</p>
                </div>
                <div className="rounded-[22px] border px-4 py-3" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--app-subtle)]">Duration</p>
                  <p className="mt-1 text-[1.55rem] font-semibold text-[var(--app-text)]">{exam?.duration}m</p>
                </div>
              </div>

              <div className="rounded-[24px] border p-4 text-left" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--app-text)]">{setupPanelTitle}</p>
                  <StatusBadge tone={getIdentityTone(identityStatus)}>{getIdentityLabel(identityStatus)}</StatusBadge>
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-[var(--app-muted)]">{identityMessage}</p>
                {showReferenceSetupButton && (
                  <button
                    type="button"
                    onClick={() => { void saveReferenceFace(); }}
                    disabled={identityBusy}
                    className="theme-secondary-btn mt-3 w-full rounded-2xl py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    Set Up Face Verification
                  </button>
                )}
              </div>

              <p className="text-xs text-amber-200">
                Do not switch tabs or exit fullscreen during the exam.
              </p>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleBeginExam}
                disabled={identityBusy}
                className="theme-primary-btn flex w-full items-center justify-center gap-2 rounded-2xl py-3 font-semibold disabled:opacity-50"
              >
                {identityBusy
                  ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  : <FiCheckCircle />}
                {startActionLabel}
              </motion.button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── result screen ───────────────────────────────────────────
  if (submitted && result) {
    return (
      <div className="min-h-screen bg-[var(--app-bg)] px-4 py-6 sm:px-6 lg:px-8" style={{ backgroundImage: "var(--app-gradient)" }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="theme-panel mx-auto w-full max-w-xl rounded-[32px] p-8 text-center"
        >
          <div className={`mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full ${
            result.passed ? "bg-emerald-500/12" : "bg-red-500/12"
          }`}>
            {result.passed
              ? <FiCheckCircle className="text-4xl text-emerald-300" />
              : <FiAlertTriangle className="text-4xl text-red-300" />}
          </div>
          <h2 className="mb-1 text-2xl font-bold text-[var(--app-text)]">
            {result.passed ? "Congratulations! 🎉" : "Better luck next time"}
          </h2>
          <p className={`mb-6 text-lg font-semibold ${result.passed ? "text-emerald-300" : "text-red-300"}`}>
            {result.passed ? "PASSED" : "FAILED"}
          </p>
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: "Score", value: result.score },
              { label: "Percentage", value: `${result.percentage}%` },
              { label: "Total Qs", value: result.totalQuestions },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-[24px] p-4" style={{ background: "var(--panel-strong)" }}>
                <p className="text-2xl font-bold text-[var(--app-text)]">{value}</p>
                <p className="mt-1 text-xs text-[var(--app-muted)]">{label}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate("/student/results")}
              className="theme-primary-btn flex-1 rounded-2xl py-3 text-sm font-medium">
              View Results
            </button>
            <button onClick={() => navigate("/student/dashboard")}
              className="theme-secondary-btn flex-1 rounded-2xl py-3 text-sm font-medium">
              Dashboard
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const question = exam?.questions[currentQ];
  const totalAnswered = Object.keys(answers).length;
  const totalQuestions = exam?.questions.length || 0;
  const progressPercentage = totalQuestions > 0 ? ((currentQ + 1) / totalQuestions) * 100 : 0;
  const examInteractionLocked = examReady && !submitted && fullscreenLocked;

  // ── main exam UI ────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-[var(--app-bg)]" style={{ backgroundImage: "var(--app-gradient)" }}>
      {examInteractionLocked && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/72 px-6 backdrop-blur-sm">
          <div className="theme-panel w-full max-w-lg rounded-[28px] border border-red-500/25 px-6 py-7 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-red-500/12 text-red-300">
              <FiAlertTriangle className="text-2xl" />
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-red-300/80">Fullscreen Required</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--app-text)]">Exam interaction is locked</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--app-muted)]">
              You exited fullscreen, so answering questions and navigation are paused.
              Press <span className="mx-1 rounded-lg bg-[var(--panel-strong)] px-2 py-1 font-mono text-[var(--app-text)]">F</span>
              to re-enter fullscreen and continue the exam.
            </p>
            <p className="mt-3 text-xs text-amber-200">
              The timer will keep running while fullscreen is off.
            </p>
          </div>
        </div>
      )}

      {/* topbar */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-6"
        style={{
          background: "rgba(8, 18, 33, 0.86)",
          borderColor: "var(--app-border)",
          backdropFilter: "blur(24px)",
        }}
      >
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--app-subtle)]">Exam in Progress</p>
          <h1 className="mt-1 text-sm font-semibold text-[var(--app-text)]">{exam?.title}</h1>
          <p className="text-xs text-[var(--app-muted)]">{exam?.subject}</p>
        </div>
        <div className="flex items-center gap-3">
          {exam && (
            <Timer
              duration={session?.status === "ongoing"
                ? getRemainingSeconds(session, exam)
                : exam.duration * 60}
              onExpire={submitExam}
            />
          )}
        </div>
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-73px)] max-w-[1600px] flex-col gap-4 p-4 sm:p-6 lg:flex-row">
        {/* left - questions */}
        <div className="theme-panel theme-scrollbar flex-1 overflow-auto rounded-[32px] p-5 sm:p-6">
          <div className="mb-6">
            <div className="mb-2 flex justify-between text-xs text-[var(--app-muted)]">
              <span>Question {currentQ + 1} of {totalQuestions}</span>
              <span>{totalAnswered}/{totalQuestions} answered</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--panel-strong)]">
              <div
                className="h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%`, background: "var(--accent-strong)" }}
              />
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={currentQ}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="mb-6 rounded-[28px] border p-6"
              style={{ background: "var(--panel-strong)", borderColor: "var(--app-border)" }}
            >
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--app-muted)]">
                Question {currentQ + 1}
              </p>
              <p className="mb-6 text-base font-medium leading-relaxed text-[var(--app-text)] sm:text-lg">
                {question?.question}
              </p>
              <div className="space-y-3">
                {question?.options.map((option, i) => (
                  <button key={i} onClick={() => handleAnswerSelection(currentQ, i)}
                    disabled={examInteractionLocked}
                    className={`w-full rounded-[22px] border px-4 py-3.5 text-left text-sm transition-all duration-200 ${
                      answers[currentQ] === i
                        ? "border-sky-400/40 bg-sky-500/12 text-[var(--app-text)]"
                        : "text-[var(--app-muted)] hover:text-[var(--app-text)]"
                    } ${examInteractionLocked ? "cursor-not-allowed opacity-55" : ""}`}
                    style={answers[currentQ] === i
                      ? undefined
                      : { background: "var(--panel-bg)", borderColor: "var(--app-border)" }}
                  >
                    <span className={`mr-3 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      answers[currentQ] === i ? "bg-sky-500 text-white" : "bg-[var(--panel-strong)] text-[var(--app-subtle)]"
                    }`}>
                      {String.fromCharCode(65 + i)}
                    </span>
                    {option}
                  </button>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>

          {submissionError && (
            <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {submissionError}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button onClick={() => updateCurrentQuestion(Math.max(0, currentQ - 1))}
              disabled={currentQ === 0 || examInteractionLocked}
              className="theme-secondary-btn flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-30">
              <FiChevronLeft /> Previous
            </button>
            {currentQ < totalQuestions - 1 ? (
              <button onClick={() => updateCurrentQuestion(Math.min(totalQuestions - 1, currentQ + 1))}
                disabled={examInteractionLocked}
                className="theme-primary-btn flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm disabled:opacity-50">
                Next <FiChevronRight />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting || examInteractionLocked}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-50">
                {submitting
                  ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950" />
                  : <FiCheckCircle />}
                Submit Exam
              </button>
            )}
          </div>
        </div>

        {/* right sidebar */}
        <div className="theme-panel theme-scrollbar flex w-full flex-col gap-3 overflow-hidden rounded-[32px] p-4 lg:w-[340px] lg:sticky lg:top-[89px] lg:max-h-[calc(100vh-105px)]">
          {(visualMonitoringEnabled || audioDetectionEnabled || (SHOW_STUDENT_ML_PREVIEW && mlFramePreview)) && (
            <div className="rounded-[28px] border p-3" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--app-muted)]">
                Proctor Monitor
              </p>
              {visualMonitoringEnabled ? (
                <WebcamMonitor
                  enabled={visualMonitoringEnabled}
                  onAlert={handleWebcamAlert}
                  videoRef={webcamVideoRef}
                  streamRef={webcamStreamRef}
                />
              ) : (
                <div className="rounded-[22px] border px-3 py-3 text-xs text-[var(--app-muted)]" style={{ borderColor: "var(--app-border)", background: "var(--panel-bg)" }}>
                  Camera monitoring is disabled for this exam.
                </div>
              )}
              {audioDetectionEnabled && (
                <AudioMonitor
                  enabled={examReady && !submitted}
                  showStatus={SHOW_STUDENT_DEBUG_UI}
                  onAudioDetected={(analysis) => {
                    incrementAudioDetected();
                    const rawConfidence = typeof analysis?.raw_backend_speech_confidence === "number"
                      ? Math.round(analysis.raw_backend_speech_confidence * 100)
                      : null;
                    const smoothedConfidence = typeof analysis?.frontend_smoothed_confidence === "number"
                      ? Math.round(analysis.frontend_smoothed_confidence * 100)
                      : null;
                    const confidenceParts = [];

                    if (rawConfidence !== null) {
                      confidenceParts.push(`raw ${rawConfidence}%`);
                    }

                    if (smoothedConfidence !== null) {
                      confidenceParts.push(`smoothed ${smoothedConfidence}%`);
                    }

                    const confidenceSuffix = confidenceParts.length > 0
                      ? ` (${confidenceParts.join(", ")})`
                      : "";

                    logProctorEvent(
                      "audio_detected",
                      "medium",
                      `Speech detected in background${confidenceSuffix}`
                    );
                  }}
                />
              )}
              {SHOW_STUDENT_ML_PREVIEW && mlFramePreview && (
              <div className="mt-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
                    ML Frame Preview
                  </p>
                  <span className="text-[10px] text-cyan-200/70">
                    Sent to ML
                  </span>
                </div>
                <img
                  src={mlFramePreview}
                  alt="Frame sent to ML"
                  className="aspect-video w-full rounded-xl border border-cyan-500/20 object-cover"
                  style={{ background: "var(--panel-bg)" }}
                />
                <p className="mt-2 text-[10px] leading-relaxed text-cyan-100/70">
                  This is the compressed frame payload currently being posted to the ML endpoints.
                </p>
              </div>
              )}
              {SHOW_STUDENT_DEBUG_UI && liveAlerts.length > 0 && (
                <div className="mt-3 space-y-2">
                  {liveAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`rounded-2xl border px-3 py-3 text-[11px] ${getSeverityClassName(alert.severity)}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold tracking-wide">
                          {EVENT_LABELS[alert.eventType] || alert.eventType}
                        </span>
                        <span className="text-[10px] opacity-70">
                          {new Date(alert.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="mt-1 leading-relaxed opacity-85">{alert.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-[28px] border p-4" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--app-muted)]">Questions</p>
            <div className="grid grid-cols-5 gap-1.5">
              {exam?.questions.map((_, i) => (
                <button
                  key={i}
                  onClick={() => updateCurrentQuestion(i)}
                  type="button"
                  aria-label={`Question ${i + 1}`}
                  disabled={examInteractionLocked}
                  className={`h-9 rounded-xl text-xs font-medium transition-colors ${
                    i === currentQ ? "bg-sky-500 text-white"
                    : answers[i] !== undefined ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "text-[var(--app-muted)] hover:bg-[var(--panel-bg)]"
                  } ${examInteractionLocked ? "cursor-not-allowed opacity-50" : ""}`}
                  style={i === currentQ || answers[i] !== undefined ? undefined : { background: "var(--panel-soft)" }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto pt-2">
            <button onClick={handleSubmit} disabled={submitting || examInteractionLocked}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-50">
              <FiCheckCircle /> Submit Exam
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExamInterface;
