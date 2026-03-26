import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import api from "../../utils/api.js";
import { getTokenForPath } from "../../utils/authStorage.js";
import { useSocket } from "../../context/SocketContext.jsx";
import useProctor from "../../hooks/useProctor.js";
import AudioMonitor from "../proctor/AudioMonitor.jsx";
import {
  FiCamera, FiCameraOff, FiClock, FiAlertTriangle,
  FiCheckCircle, FiChevronLeft, FiChevronRight, FiShield,
} from "react-icons/fi";

void motion;
const ML_URL = import.meta.env.VITE_ML_URL || "http://localhost:8000";
const HIGH_QUALITY_VIDEO_CONSTRAINTS = {
  width: { ideal: 1280, min: 640 },
  height: { ideal: 720, min: 480 },
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
  audio_detected: 8000,
  head_turned: 7000,
  gaze_away: 7000,
  face_not_detected: 4000,
  multiple_faces: 6000,
  object_detected: 8000,
  face_mismatch: 30000,
  tab_switch: 1500,
  fullscreen_exit: 3000,
  ml_service_unavailable: 30000,
};
const LIVE_ALERT_LIMIT = 4;
const EVENT_LABELS = {
  face_not_detected: "Face Missing",
  multiple_faces: "Multiple Faces",
  gaze_away: "Gaze Away",
  head_turned: "Head Turned",
  audio_detected: "Audio Detected",
  object_detected: "Object Detected",
  tab_switch: "Tab Switch",
  fullscreen_exit: "Fullscreen Exit",
  face_mismatch: "Face Mismatch",
  ml_service_unavailable: "ML Unavailable",
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

// ── Webcam Monitor ────────────────────────────────────────────
const WebcamMonitor = ({ onAlert, videoRef: externalVideoRef, streamRef: externalStreamRef }) => {
  const internalRef = useRef(null);
  const videoRef = externalVideoRef || internalRef;
  const streamRef = useRef(null);
  const [camStatus, setCamStatus] = useState("starting");

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

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
      onAlert("face_not_detected", "high", "Camera access denied");
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
      <div className={`rounded-xl overflow-hidden border-2 transition-colors ${
        camStatus === "active" ? "border-green-500/30" : "border-red-500/30"
      }`}>
        {camStatus === "denied" ? (
          <div className="w-full h-36 bg-gray-800 flex flex-col items-center justify-center gap-2">
            <FiCameraOff className="text-red-400 text-2xl" />
            <p className="text-red-400 text-xs">Camera denied</p>
          </div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline
            className="w-full h-36 object-cover bg-gray-800" />
        )}
      </div>
      <div className={`absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
        camStatus === "active" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
      }`}>
        <div className={`w-1.5 h-1.5 rounded-full ${
          camStatus === "active" ? "bg-green-400 animate-pulse" : "bg-red-400"
        }`} />
        {camStatus === "active" ? "Live" : "Offline"}
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
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-mono font-semibold ${
      isCritical ? "bg-red-500/20 text-red-400 border border-red-500/30"
      : isWarning ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
      : "bg-gray-800 text-white border border-gray-700"
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
  const [referenceFace, setReferenceFace] = useState("");
  const [referenceFaceEmbedding, setReferenceFaceEmbedding] = useState([]);
  const [headPoseBaseline, setHeadPoseBaseline] = useState(null);
  const [gazeBaseline, setGazeBaseline] = useState(null);
  const [identityStatus, setIdentityStatus] = useState("loading");
  const [identityMessage, setIdentityMessage] = useState("Checking face verification status...");
  const [identityBusy, setIdentityBusy] = useState(false);
  const [startReady, setStartReady] = useState(false);
  const [microphonePrepared, setMicrophonePrepared] = useState(false);
  const [liveAlerts, setLiveAlerts] = useState([]);

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
  const logProctorEvent = async (eventType, severity, description) => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;

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
  };

  // ── handleWebcamAlert ───────────────────────────────────────
  const handleWebcamAlert = useCallback((eventType, severity, description) => {
    if (eventType === "face_not_detected") faceNotDetectedRef.current += 1;
    logProctorEvent(eventType, severity, description);
  }, []);

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
    enabled: examReady && !submitted,
    referenceFace,
    referenceFaceEmbedding,
    headPoseBaseline,
    gazeBaseline,
    onAlert: handleWebcamAlert,
    intervalMs: 1200,
    verifyIntervalMs: 30000,
  });

  // ── init exam ───────────────────────────────────────────────
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    initExam();
    loadFaceReference();
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

  const loadFaceReference = async () => {
    try {
      const { data } = await api.get("/auth/me");
      const savedReference = data.faceImagePath || "";
      const savedReferenceEmbedding = Array.isArray(data.faceEmbedding) ? data.faceEmbedding : [];
      setReferenceFace(savedReference);
      setReferenceFaceEmbedding(savedReferenceEmbedding);
      if (savedReference) {
        setIdentityStatus("ready");
        setIdentityMessage("Reference face is available for verification.");
      } else {
        setIdentityStatus("missing");
        setIdentityMessage("No reference face saved yet. Capture one before the exam for identity checks.");
      }
    } catch {
      setIdentityStatus("unavailable");
      setIdentityMessage("Profile lookup failed. Face verification will run only if a reference is available.");
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
    setStartReady(false);
    pendingVerificationImageRef.current = "";
    const frame = await captureIdentityFrame();
    if (!frame) return { saved: false, reference: "" };

    setIdentityBusy(true);
    setIdentityStatus("enrolling");
    setIdentityMessage("Checking the captured frame before saving it as the reference face...");

    try {
      const { data: embeddingResult } = await axios.post(`${ML_URL}/face/reference-embedding`, {
        frame,
      });

      if (!embeddingResult.embedding_created || !Array.isArray(embeddingResult.embedding)) {
        setIdentityStatus("invalid_reference");
        setIdentityMessage("Capture a clear frame with exactly one visible face before starting the exam.");
        return { saved: false, reference: "" };
      }

      const { data } = await api.post("/auth/face-reference", {
        faceImage: frame,
        faceEmbedding: embeddingResult.embedding,
      });
      const savedReference = data.faceImagePath || frame;
      const savedReferenceEmbedding = Array.isArray(data.faceEmbedding)
        ? data.faceEmbedding
        : embeddingResult.embedding;

      setReferenceFace(savedReference);
      setReferenceFaceEmbedding(savedReferenceEmbedding);
      setIdentityStatus("ready");
      setIdentityMessage("Reference face saved. Identity verification is ready.");
      return { saved: true, reference: savedReference };
    } catch (err) {
      const message =
        err.response?.data?.message ||
        "Reference face could not be saved right now. Retry after the verification service is available.";

      setIdentityStatus("save_failed");
      setIdentityMessage(message);
      return { saved: false, reference: "" };
    } finally {
      setIdentityBusy(false);
    }
  }, [captureIdentityFrame]);

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
    if (microphonePrepared) {
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setIdentityStatus("service_unavailable");
      setIdentityMessage("This browser cannot request microphone access for proctoring.");
      return false;
    }

    setIdentityStatus("verifying");
    setIdentityMessage("Allow microphone access to continue with face verification.");

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
      setIdentityMessage("Microphone access is required before the exam can start. Allow it, then verify again.");
      return false;
    }
  }, [microphonePrepared]);

  const verifyCurrentFace = useCallback(async (referenceOverride = "") => {
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
      const { data } = await axios.post(`${ML_URL}/face/verify`, {
        frame,
        reference: activeReference,
        reference_embedding: referenceFaceEmbedding,
      });

      if (!data.verification_checked) {
        setIdentityStatus("camera_not_ready");
        setIdentityMessage("Face verification needs one clear face in the frame. Adjust your position and try again.");
        return { status: "retry", data };
      }

      if (data.verified) {
        setIdentityStatus("verified");
        setIdentityMessage("Face verified. You can begin the exam.");
        return { status: "verified", verificationImage: frame };
      }

      setIdentityStatus("mismatch");
      setIdentityMessage("Saved reference does not match the current webcam frame. Retry before starting.");
      return { status: "mismatch", data };
    } catch {
      setIdentityStatus("service_unavailable");
      setIdentityMessage("ML verification service is unavailable. Retry verification before starting the exam.");
      return { status: "unavailable" };
    } finally {
      setIdentityBusy(false);
    }
  }, [captureIdentityFrame, referenceFace, referenceFaceEmbedding, saveVerificationFaceImage]);

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
      setError(`This exam session is already ${activeSession.status}.`);
    }
  }, [exam, examId, getHydratedProgress, joinExamRoom]);

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
    const headSamples = [];
    const gazeSamples = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const frame = await captureIdentityFrame();
      if (!frame) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        continue;
      }

      try {
        const [headRes, gazeRes] = await Promise.all([
          axios.post(`${ML_URL}/head/analyze`, { frame }),
          axios.post(`${ML_URL}/gaze/analyze`, { frame }),
        ]);

        if (headRes.data.head_detected) {
          headSamples.push({
            pitch: headRes.data.pitch,
            yaw: headRes.data.yaw,
            roll: headRes.data.roll,
            nose_offset_x: headRes.data.nose_offset_x,
            nose_offset_y: headRes.data.nose_offset_y,
          });
        }

        if (gazeRes.data.tracking_available && gazeRes.data.face_detected) {
          gazeSamples.push({
            horizontal_angle: gazeRes.data.horizontal_angle,
            vertical_angle: gazeRes.data.vertical_angle,
          });
        }
      } catch {}

      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    const headBaseline = summarizeSamples(headSamples, [
      "pitch",
      "yaw",
      "roll",
      "nose_offset_x",
      "nose_offset_y",
    ]);

    const gazeBaselineValue = summarizeSamples(gazeSamples, [
      "horizontal_angle",
      "vertical_angle",
    ]);

    return {
      head: headBaseline,
      gaze: gazeBaselineValue,
    };
  }, [captureIdentityFrame]);

  const queueBaselineCalibration = useCallback(async () => {
    if (baselineCalibrationRef.current) {
      return baselineCalibrationRef.current;
    }

    baselineCalibrationRef.current = calibrateAttentionBaseline()
      .then((baseline) => {
        setHeadPoseBaseline(baseline?.head || null);
        setGazeBaseline(baseline?.gaze || null);
        return baseline;
      })
      .finally(() => {
        baselineCalibrationRef.current = null;
      });

    return baselineCalibrationRef.current;
  }, [calibrateAttentionBaseline]);

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

    const microphoneReady = await prepareMicrophoneForExam();
    if (!microphoneReady) {
      return;
    }

    let hasReference = Boolean(referenceFace);
    let activeReference = referenceFace;
    let verificationResult = { status: "skipped", verificationImage: "" };

    if (!hasReference) {
      const enrollment = await saveReferenceFace();
      hasReference = enrollment.saved;
      activeReference = enrollment.reference;
      if (!hasReference) {
        return;
      }
    }

    if (hasReference) {
      verificationResult = await verifyCurrentFace(activeReference);
      if (verificationResult.status !== "verified" && verificationResult.status !== "skipped") {
        if (verificationResult.status === "mismatch") {
          incrementFaceMismatch();
          logProctorEvent("face_mismatch", "high", "Pre-exam face verification failed");
        }
        return;
      }
    }

    pendingVerificationImageRef.current = verificationResult.verificationImage || "";
    void queueBaselineCalibration();

    setStartReady(true);
    setIdentityStatus("verified");
    setIdentityMessage("Face verified. Click Begin Exam once more to enter fullscreen and start while calibration finishes in the background.");
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
    if (!fullscreenReadyRef.current) return;
    setTimeout(() => {
      const inFullscreen = !!document.fullscreenElement;
      if (!inFullscreen) {
        incrementFullscreenExit();
        logProctorEvent("fullscreen_exit", "high", "Student exited fullscreen");
        setTimeout(() => {
          document.documentElement.requestFullscreen().catch(() => {});
        }, 1500);
      }
    }, 100);
  }, [incrementFullscreenExit]);

  useEffect(() => {
    if (!examReady || submitted) return undefined;

    setupProctoring();
    return () => cleanupProctoring();
  }, [examReady, submitted, handleVisibilityChange, handleWindowBlur, handleFullscreenChange]);

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
    setCurrentQ(nextQuestionIndex);
    void persistExamProgress(answers, nextQuestionIndex);
  }, [answers, persistExamProgress]);

  const handleAnswerSelection = useCallback((questionIndex, optionIndex) => {
    const nextAnswers = {
      ...answers,
      [questionIndex]: optionIndex,
    };
    setAnswers(nextAnswers);
    void persistExamProgress(nextAnswers, currentQ);
  }, [answers, currentQ, persistExamProgress]);

  const handleSubmit = () => submitExam();

  const submitExam = async () => {
    setSubmitting(true);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
      setResult(data);
      setSubmitted(true);
    } catch (err) {
      alert(err.response?.data?.message || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── loading / error ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Setting up exam...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-center">
          <FiAlertTriangle className="text-red-400 text-4xl mx-auto mb-4" />
          <p className="text-white font-semibold mb-2">Failed to load exam</p>
          <p className="text-gray-500 text-sm mb-4">{error}</p>
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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-purple-600/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <FiShield className="text-purple-400 text-3xl" />
          </div>
          <h2 className="text-white text-xl font-bold mb-2">{exam?.title}</h2>
          <p className="text-gray-500 text-sm mb-6">{exam?.subject}</p>

          <div className="bg-gray-800 rounded-xl p-4 mb-6 text-left space-y-2">
            <p className="text-gray-400 text-sm">Questions: {exam?.questions.length}</p>
            <p className="text-gray-400 text-sm">Duration: {exam?.duration} minutes</p>
            <p className="text-gray-400 text-sm">Webcam monitoring enabled</p>
            <p className="text-gray-400 text-sm">Fullscreen mode required</p>
            <p className="text-gray-400 text-sm">AI monitoring active</p>
          </div>

          <div className="mb-5">
            <WebcamMonitor
              onAlert={handleWebcamAlert}
              videoRef={webcamVideoRef}
              streamRef={webcamStreamRef}
            />
          </div>

          <div className="bg-gray-800 rounded-xl p-4 mb-6 text-left space-y-3 border border-gray-700">
            <div className="flex items-center justify-between gap-3">
              <p className="text-white text-sm font-semibold">Face Verification</p>
              <span className={`text-[11px] px-2 py-1 rounded-full ${
                identityStatus === "verified" || identityStatus === "ready"
                  ? "bg-green-500/15 text-green-400"
                  : identityStatus === "mismatch" || identityStatus === "invalid_reference"
                  ? "bg-red-500/15 text-red-400"
                  : "bg-yellow-500/15 text-yellow-400"
              }`}>
                {identityStatus === "verified"
                  ? "Verified"
                  : identityStatus === "ready"
                  ? "Ready"
                  : identityStatus === "mismatch"
                  ? "Mismatch"
                  : identityStatus === "service_unavailable"
                  ? "Service unavailable"
                  : identityStatus === "microphone_denied"
                  ? "Mic needed"
                  : identityStatus === "missing"
                  ? "Reference missing"
                  : identityStatus === "enrolling"
                  ? "Saving reference"
                  : identityStatus === "verifying"
                  ? "Verifying"
                  : identityStatus === "starting"
                  ? "Starting exam"
                  : identityStatus === "fullscreen_required"
                  ? "Fullscreen needed"
                  : "Pending"}
              </span>
            </div>
            <p className="text-gray-400 text-xs leading-relaxed">{identityMessage}</p>
            {!referenceFace && (
              <button
                type="button"
                onClick={() => { void saveReferenceFace(); }}
                disabled={identityBusy}
                className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Set Up Face Verification
              </button>
            )}
          </div>
          <p className="text-yellow-400 text-xs mb-6">
            Do not switch tabs or exit fullscreen during the exam
          </p>

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleBeginExam}
            disabled={identityBusy}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {identityBusy
              ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <FiCheckCircle />}
            {identityBusy
              ? "Working..."
              : startReady
              ? "Enter Fullscreen & Start"
              : "Verify Face & Continue"}
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // ── result screen ───────────────────────────────────────────
  if (submitted && result) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-md w-full text-center"
        >
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
            result.passed ? "bg-green-500/20" : "bg-red-500/20"
          }`}>
            {result.passed
              ? <FiCheckCircle className="text-green-400 text-4xl" />
              : <FiAlertTriangle className="text-red-400 text-4xl" />}
          </div>
          <h2 className="text-white text-2xl font-bold mb-1">
            {result.passed ? "Congratulations! 🎉" : "Better luck next time"}
          </h2>
          <p className={`text-lg font-semibold mb-6 ${result.passed ? "text-green-400" : "text-red-400"}`}>
            {result.passed ? "PASSED" : "FAILED"}
          </p>
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: "Score", value: result.score },
              { label: "Percentage", value: `${result.percentage}%` },
              { label: "Total Qs", value: result.totalQuestions },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-800 rounded-xl p-4">
                <p className="text-white text-2xl font-bold">{value}</p>
                <p className="text-gray-500 text-xs mt-1">{label}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate("/student/results")}
              className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-medium py-3 rounded-lg transition-colors text-sm">
              View Results
            </button>
            <button onClick={() => navigate("/student/dashboard")}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-medium py-3 rounded-lg transition-colors text-sm">
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

  // ── main exam UI ────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950">
      {/* topbar */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-white font-semibold text-sm">{exam?.title}</h1>
          <p className="text-gray-500 text-xs">{exam?.subject}</p>
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

      <div className="flex h-[calc(100vh-57px)]">
        {/* left - questions */}
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>Question {currentQ + 1} of {totalQuestions}</span>
              <span>{totalAnswered}/{totalQuestions} answered</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div className="bg-purple-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${((currentQ + 1) / totalQuestions) * 100}%` }} />
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={currentQ}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6"
            >
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">
                Question {currentQ + 1}
              </p>
              <p className="text-white text-base font-medium leading-relaxed mb-6">
                {question?.question}
              </p>
              <div className="space-y-3">
                {question?.options.map((option, i) => (
                  <button key={i} onClick={() => handleAnswerSelection(currentQ, i)}
                    className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-all duration-200 ${
                      answers[currentQ] === i
                        ? "bg-purple-600/20 border-purple-500 text-white"
                        : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white"
                    }`}
                  >
                    <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-xs font-bold mr-3 ${
                      answers[currentQ] === i ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400"
                    }`}>
                      {String.fromCharCode(65 + i)}
                    </span>
                    {option}
                  </button>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="flex items-center justify-between">
            <button onClick={() => updateCurrentQuestion(Math.max(0, currentQ - 1))}
              disabled={currentQ === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors">
              <FiChevronLeft /> Previous
            </button>
            {currentQ < totalQuestions - 1 ? (
              <button onClick={() => updateCurrentQuestion(Math.min(totalQuestions - 1, currentQ + 1))}
                className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors">
                Next <FiChevronRight />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting}
                className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
                {submitting
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <FiCheckCircle />}
                Submit Exam
              </button>
            )}
          </div>
        </div>

        {/* right sidebar */}
        <div className="w-72 border-l border-gray-800 p-4 flex flex-col gap-3 overflow-hidden"
          style={{ height: "calc(100vh - 57px)" }}>
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-3">
            <p className="text-gray-500 text-[11px] font-medium uppercase tracking-wider mb-2">
              Proctor Monitor
            </p>
            <WebcamMonitor
              onAlert={handleWebcamAlert}
              videoRef={webcamVideoRef}
              streamRef={webcamStreamRef}
            />
            <AudioMonitor
              enabled={examReady && !submitted}
              onAudioDetected={(analysis) => {
                incrementAudioDetected();
                const confidence = typeof analysis?.speech_confidence === "number"
                  ? ` (${Math.round(analysis.speech_confidence * 100)}% confidence)`
                  : "";
                logProctorEvent("audio_detected", "medium", `Speech detected in background${confidence}`);
              }}
            />
            {liveAlerts.length > 0 && (
              <div className="mt-3 space-y-2">
                {liveAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`rounded-xl border px-2.5 py-2 text-[11px] ${
                      alert.severity === "high"
                        ? "border-red-500/30 bg-red-500/10 text-red-300"
                        : alert.severity === "medium"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                        : "border-sky-500/30 bg-sky-500/10 text-sky-200"
                    }`}
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

          <div>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-2">Questions</p>
            <div className="grid grid-cols-5 gap-1.5">
              {exam?.questions.map((_, i) => (
                <button key={i} onClick={() => updateCurrentQuestion(i)}
                  className={`h-8 rounded-lg text-xs font-medium transition-colors ${
                    i === currentQ ? "bg-purple-600 text-white"
                    : answers[i] !== undefined ? "bg-green-500/20 text-green-400 border border-green-500/30"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto pt-4">
            <button onClick={handleSubmit} disabled={submitting}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
              <FiCheckCircle /> Submit Exam
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExamInterface;
