import { useRef, useEffect, useCallback } from "react";
import axios from "axios";

const ML_URL = import.meta.env.VITE_ML_URL || "http://localhost:8000";
const NO_FACE_STREAK_TO_ALERT = 2;
const FACE_RECOVERY_STREAK = 2;
const MULTIPLE_FACES_STREAK_TO_ALERT = 3;
const HEAD_TURN_STREAK_TO_ALERT = 3;
const STRONG_HEAD_TURN_STREAK_TO_ALERT = 2;
const GAZE_AWAY_STREAK_TO_ALERT = 3;
const NO_FRAME_STREAK_TO_ALERT = 2;
const FACE_MISMATCH_STREAK_TO_ALERT = 2;
const HEAD_TURN_ALERT_COOLDOWN_MS = 10000;
const OBJECT_DETECTED_STREAK_TO_ALERT = 2;
const OBJECT_ALERT_COOLDOWN_MS = 10000;
const MULTIPLE_FACES_ALERT_COOLDOWN_MS = 10000;
const FACE_MISMATCH_ALERT_COOLDOWN_MS = 45000;
const MIN_HEAD_POSE_QUALITY_FOR_ALERT = 0.46;

const useProctor = ({
  videoRef,
  streamRef,
  sessionId,
  examId,
  enabled = true,
  referenceFace = "",
  referenceFaceEmbedding = [],
  headPoseBaseline = null,
  gazeBaseline = null,
  onAlert,
  intervalMs = 800,
  verifyIntervalMs = 45000,
}) => {
  const intervalRef = useRef(null);
  const criticalAnalysisInFlightRef = useRef(false);
  const queuedCriticalAnalysisRef = useRef(false);
  const objectAnalysisInFlightRef = useRef(false);
  const verifyAnalysisInFlightRef = useRef(false);
  const lastIdentityCheckRef = useRef(0);
  const noFrameStreakRef = useRef(0);
  const multipleFacesSourcesRef = useRef({
    face: false,
    object: false,
  });
  const activeFlagsRef = useRef({
    faceMissing: false,
    multipleFaces: false,
    gazeAway: false,
    headTurned: false,
    objectDetected: false,
  });
  const lastAlertAtRef = useRef({
    objectDetected: 0,
    faceMismatch: 0,
    headTurned: 0,
    multipleFaces: 0,
    mlUnavailable: 0,
  });
  const streaksRef = useRef({
    noFace: 0,
    facePresent: 0,
    multipleFaces: 0,
    headTurned: 0,
    gazeAway: 0,
    objectDetected: 0,
    faceMismatch: 0,
  });
  const countersRef = useRef({
    face_not_detected: 0,
    multiple_faces: 0,
    face_mismatch: 0,
    gaze_away: 0,
    head_turned: 0,
    tab_switch: 0,
    fullscreen_exit: 0,
    audio_detected: 0,
    object_detected: 0,
    total_checks: 0,
  });

  const triggerMultipleFacesAlert = useCallback((source, description, now) => {
    multipleFacesSourcesRef.current[source] = true;
    streaksRef.current.multipleFaces += 1;

    if (
      streaksRef.current.multipleFaces >= MULTIPLE_FACES_STREAK_TO_ALERT &&
      !activeFlagsRef.current.multipleFaces &&
      now - lastAlertAtRef.current.multipleFaces >= MULTIPLE_FACES_ALERT_COOLDOWN_MS
    ) {
      activeFlagsRef.current.multipleFaces = true;
      lastAlertAtRef.current.multipleFaces = now;
      countersRef.current.multiple_faces += 1;
      onAlert?.("multiple_faces", "high", description);
    }
  }, [onAlert]);

  const clearMultipleFacesSignal = useCallback((source) => {
    multipleFacesSourcesRef.current[source] = false;
    const hasAnyActiveSource = Object.values(multipleFacesSourcesRef.current).some(Boolean);

    if (!hasAnyActiveSource) {
      streaksRef.current.multipleFaces = 0;
      activeFlagsRef.current.multipleFaces = false;
    }
  }, []);

  const captureFrame = useCallback(async () => {
    const videoTrack = streamRef?.current?.getVideoTracks?.()[0];
    if (videoTrack && typeof ImageCapture !== "undefined") {
      try {
        const imageCapture = new ImageCapture(videoTrack);
        const bitmap = await imageCapture.grabFrame();
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width || 1280;
        canvas.height = bitmap.height || 720;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        return canvas.toDataURL("image/jpeg", 0.9);
      } catch {
        // Fall back to the video element path below if ImageCapture is unavailable.
      }
    }

    if (!videoRef.current) return null;
    const video = videoRef.current;
    if (video.readyState < 2) return null;
    if (!video.videoWidth || !video.videoHeight) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  }, [streamRef, videoRef]);

  const processFaceResult = useCallback((faceResult, now) => {
    let faceDetectorAvailable = false;
    let detectorNoFace = false;
    let primaryFaceRecovered = false;
    let faceMultipleFacesCandidate = false;

    if (faceResult?.status === "fulfilled") {
      const face = faceResult.value.data;
      const noFaceFromDetector = face.event === "face_not_detected";
      const multipleFaces =
        face.event === "multiple_faces" || Number(face.face_count || 0) > 1;

      faceDetectorAvailable = true;
      detectorNoFace = noFaceFromDetector;
      primaryFaceRecovered = Boolean(face.face_detected) && !noFaceFromDetector;
      faceMultipleFacesCandidate = multipleFaces;
    }

    const noFace = faceDetectorAvailable && detectorNoFace;
    const faceRecovered = faceDetectorAvailable && primaryFaceRecovered;

    if (noFace) {
      streaksRef.current.noFace += 1;
      streaksRef.current.facePresent = 0;
    } else if (faceRecovered) {
      streaksRef.current.facePresent += 1;
      streaksRef.current.noFace = 0;
    } else {
      streaksRef.current.noFace = 0;
    }

    if (
      streaksRef.current.noFace >= NO_FACE_STREAK_TO_ALERT &&
      !activeFlagsRef.current.faceMissing
    ) {
      activeFlagsRef.current.faceMissing = true;
      countersRef.current.face_not_detected += 1;
      onAlert?.("face_not_detected", "high", "Face not detected in frame");
    } else if (streaksRef.current.facePresent >= FACE_RECOVERY_STREAK) {
      activeFlagsRef.current.faceMissing = false;
      noFrameStreakRef.current = 0;
    }

    if (faceMultipleFacesCandidate) {
      triggerMultipleFacesAlert("face", "Multiple faces detected", now);
    } else {
      clearMultipleFacesSignal("face");
    }

    return {
      faceDetectorAvailable,
      faceDetected: faceRecovered,
      noFace,
      multipleFaces: faceMultipleFacesCandidate,
    };
  }, [clearMultipleFacesSignal, onAlert, triggerMultipleFacesAlert]);

  const processHeadResult = useCallback((headResult, now, faceState = {}) => {
    const shouldSuppressHeadTurn =
      !faceState.faceDetectorAvailable ||
      faceState.noFace;

    if (shouldSuppressHeadTurn) {
      streaksRef.current.headTurned = 0;
      activeFlagsRef.current.headTurned = false;
      return;
    }

    if (headResult?.status !== "fulfilled") {
      return;
    }

    const head = headResult.value.data;
    const headTurned = head.event === "head_turned";
    const obviousTurn = Boolean(head.obvious_turn);
    const poseQuality = Number(head.pose_quality || 0);

    if (poseQuality < MIN_HEAD_POSE_QUALITY_FOR_ALERT) {
      streaksRef.current.headTurned = 0;
      activeFlagsRef.current.headTurned = false;
      return;
    }

    if (headTurned) {
      streaksRef.current.headTurned += 1;
    } else {
      streaksRef.current.headTurned = 0;
    }

    const headTurnThreshold = obviousTurn
      ? STRONG_HEAD_TURN_STREAK_TO_ALERT
      : HEAD_TURN_STREAK_TO_ALERT;

    if (
      streaksRef.current.headTurned >= headTurnThreshold &&
      !activeFlagsRef.current.headTurned &&
      now - lastAlertAtRef.current.headTurned >= HEAD_TURN_ALERT_COOLDOWN_MS
    ) {
      activeFlagsRef.current.headTurned = true;
      lastAlertAtRef.current.headTurned = now;
      countersRef.current.head_turned += 1;
      onAlert?.("head_turned", "medium", "Student turned head away from screen");
    } else if (!headTurned) {
      activeFlagsRef.current.headTurned = false;
    }
  }, [onAlert]);

  const processGazeResult = useCallback((gazeResult) => {
    let gazeLookingAway = false;
    let gazeDirection = "side";

    if (gazeResult?.status === "fulfilled") {
      const gaze = gazeResult.value.data;
      gazeLookingAway = gaze.event === "gaze_away";

      const horizontalValue = gaze.horizontal_angle_delta ?? gaze.horizontal_angle;
      const verticalValue = gaze.vertical_angle_delta ?? gaze.vertical_angle;
      gazeDirection = Math.abs(horizontalValue) >= Math.abs(verticalValue)
        ? (horizontalValue > 0 ? "right" : "left")
        : (verticalValue > 0 ? "down" : "up");
    }

    if (gazeLookingAway) {
      streaksRef.current.gazeAway += 1;
    } else {
      streaksRef.current.gazeAway = 0;
    }

    if (
      streaksRef.current.gazeAway >= GAZE_AWAY_STREAK_TO_ALERT &&
      !activeFlagsRef.current.gazeAway
    ) {
      activeFlagsRef.current.gazeAway = true;
      countersRef.current.gaze_away += 1;
      onAlert?.(
        "gaze_away",
        "medium",
        `Student looked away from screen (${gazeDirection})`
      );
    } else if (!gazeLookingAway) {
      activeFlagsRef.current.gazeAway = false;
    }
  }, [onAlert]);

  const processObjectResult = useCallback((response) => {
    const now = Date.now();
    const objects = response.data;
    const hasExtraPerson = objects.suspicious_objects?.some(
      (obj) => obj.object === "extra person detected"
    );
    const nonPersonSuspicious = (objects.suspicious_objects || []).filter(
      (obj) => obj.object !== "extra person detected"
    );

    if (nonPersonSuspicious.length > 0) {
      streaksRef.current.objectDetected += 1;
      const cooldownElapsed =
        now - lastAlertAtRef.current.objectDetected >= OBJECT_ALERT_COOLDOWN_MS;

      if (
        streaksRef.current.objectDetected >= OBJECT_DETECTED_STREAK_TO_ALERT &&
        (!activeFlagsRef.current.objectDetected || cooldownElapsed)
      ) {
        activeFlagsRef.current.objectDetected = true;
        lastAlertAtRef.current.objectDetected = now;
        countersRef.current.object_detected += 1;

        nonPersonSuspicious.forEach((obj) => {
          onAlert?.(
            "object_detected",
            obj.severity,
            `Suspicious object detected: ${obj.object} (${Math.round(obj.confidence * 100)}% confidence)`
          );
        });
      }
    } else {
      streaksRef.current.objectDetected = 0;
      activeFlagsRef.current.objectDetected = false;
    }

    if (hasExtraPerson) {
      triggerMultipleFacesAlert("object", "Multiple people detected in camera view", now);
    } else {
      clearMultipleFacesSignal("object");
    }
  }, [clearMultipleFacesSignal, onAlert, triggerMultipleFacesAlert]);

  const processVerifyResult = useCallback((response) => {
    const now = Date.now();
    const verification = response.data;
    const mismatchDetected =
      verification.verification_checked &&
      verification.verification_reliable !== false &&
      verification.event === "face_mismatch";

    if (mismatchDetected) {
      streaksRef.current.faceMismatch += 1;
    } else {
      streaksRef.current.faceMismatch = 0;
    }

    if (
      mismatchDetected &&
      streaksRef.current.faceMismatch >= FACE_MISMATCH_STREAK_TO_ALERT &&
      now - lastAlertAtRef.current.faceMismatch >= FACE_MISMATCH_ALERT_COOLDOWN_MS
    ) {
      lastAlertAtRef.current.faceMismatch = now;
      countersRef.current.face_mismatch += 1;
      onAlert?.(
        "face_mismatch",
        "high",
        `Face mismatch detected (${Math.round(verification.distance * 100) / 100} distance)`
      );
    }
  }, [onAlert]);

  const scheduleBackgroundTasks = useCallback((frame) => {
    if (!objectAnalysisInFlightRef.current) {
      objectAnalysisInFlightRef.current = true;

      void axios.post(`${ML_URL}/objects/detect`, { frame })
        .then(processObjectResult)
        .catch((error) => {
          console.warn("ML objects check failed:", error?.message || error);
        })
        .finally(() => {
          objectAnalysisInFlightRef.current = false;
        });
    }

    const shouldVerifyIdentity =
      Boolean(referenceFace) &&
      !verifyAnalysisInFlightRef.current &&
      Date.now() - lastIdentityCheckRef.current >= verifyIntervalMs;

    if (!shouldVerifyIdentity) {
      return;
    }

    verifyAnalysisInFlightRef.current = true;
    lastIdentityCheckRef.current = Date.now();

    void axios.post(`${ML_URL}/face/verify`, {
      frame,
      reference: referenceFace,
      reference_embedding: referenceFaceEmbedding,
    })
      .then(processVerifyResult)
      .catch((error) => {
        console.warn("ML verify check failed:", error?.message || error);
      })
      .finally(() => {
        verifyAnalysisInFlightRef.current = false;
      });
  }, [
    processObjectResult,
    processVerifyResult,
    referenceFace,
    referenceFaceEmbedding,
    verifyIntervalMs,
  ]);

  const analyzeFrame = useCallback(async () => {
    if (!sessionId || !examId || !enabled) {
      return;
    }

    if (criticalAnalysisInFlightRef.current) {
      queuedCriticalAnalysisRef.current = true;
      return;
    }

    criticalAnalysisInFlightRef.current = true;

    try {
      const frame = await captureFrame();
      if (!frame) {
        noFrameStreakRef.current += 1;
        if (
          noFrameStreakRef.current >= NO_FRAME_STREAK_TO_ALERT &&
          !activeFlagsRef.current.faceMissing
        ) {
          activeFlagsRef.current.faceMissing = true;
          countersRef.current.face_not_detected += 1;
          onAlert?.(
            "face_not_detected",
            "high",
            "Camera frame unavailable or webcam feed stalled"
          );
        }
        return;
      }

      noFrameStreakRef.current = 0;

      const criticalRequests = [
        { key: "face", promise: axios.post(`${ML_URL}/face/detect`, { frame }) },
        {
          key: "head",
          promise: axios.post(`${ML_URL}/head/analyze`, {
            frame,
            baseline: headPoseBaseline,
            tracker_id: sessionId || examId || "default",
          }),
        },
        {
          key: "gaze",
          promise: axios.post(`${ML_URL}/gaze/analyze`, {
            frame,
            baseline: gazeBaseline,
          }),
        },
      ];

      const criticalResults = await Promise.allSettled(
        criticalRequests.map((request) => request.promise)
      );
      const criticalResultMap = Object.fromEntries(
        criticalRequests.map((request, index) => [request.key, criticalResults[index]])
      );
      const faceRes = criticalResultMap.face;
      const headRes = criticalResultMap.head;
      const gazeRes = criticalResultMap.gaze;

      criticalResults.forEach((result, index) => {
        if (result.status === "rejected") {
          console.warn(
            `ML ${criticalRequests[index].key} check failed:`,
            result.reason?.message || result.reason
          );
        }
      });

      const criticalCompletedCount = [faceRes, headRes, gazeRes].filter(
        (result) => result?.status === "fulfilled"
      ).length;
      const now = Date.now();

      if (criticalCompletedCount === 0) {
        console.warn("ML analysis failed: no vision checks completed");
        if (now - lastAlertAtRef.current.mlUnavailable >= 30000) {
          lastAlertAtRef.current.mlUnavailable = now;
          onAlert?.(
            "ml_service_unavailable",
            "medium",
            "ML vision checks are currently unavailable; proctoring evidence may be incomplete"
          );
        }
        return;
      }

      countersRef.current.total_checks += 1;
      const faceState = processFaceResult(faceRes, now);
      processHeadResult(headRes, now, faceState);
      processGazeResult(gazeRes);
      scheduleBackgroundTasks(frame);
    } catch (err) {
      console.warn("ML analysis failed:", err.message);
    } finally {
      criticalAnalysisInFlightRef.current = false;

      if (queuedCriticalAnalysisRef.current) {
        queuedCriticalAnalysisRef.current = false;
        setTimeout(() => {
          void analyzeFrame();
        }, 0);
      }
    }
  }, [
    sessionId,
    examId,
    enabled,
    captureFrame,
    onAlert,
    headPoseBaseline,
    gazeBaseline,
    processFaceResult,
    processHeadResult,
    processGazeResult,
    scheduleBackgroundTasks,
  ]);

  const incrementTabSwitch = useCallback(() => {
    countersRef.current.tab_switch += 1;
  }, []);

  const incrementFullscreenExit = useCallback(() => {
    countersRef.current.fullscreen_exit += 1;
  }, []);

  const incrementAudioDetected = useCallback(() => {
    countersRef.current.audio_detected += 1;
  }, []);

  const incrementFaceMismatch = useCallback(() => {
    countersRef.current.face_mismatch += 1;
  }, []);

  const incrementGazeAway = useCallback(() => {
    countersRef.current.gaze_away += 1;
  }, []);

  const getCounters = useCallback(() => {
    return { ...countersRef.current };
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    void analyzeFrame();
    intervalRef.current = setInterval(analyzeFrame, intervalMs);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      criticalAnalysisInFlightRef.current = false;
      queuedCriticalAnalysisRef.current = false;
      objectAnalysisInFlightRef.current = false;
      verifyAnalysisInFlightRef.current = false;
      noFrameStreakRef.current = 0;
      multipleFacesSourcesRef.current = {
        face: false,
        object: false,
      };
      activeFlagsRef.current = {
        faceMissing: false,
        multipleFaces: false,
        gazeAway: false,
        headTurned: false,
        objectDetected: false,
      };
      streaksRef.current = {
        noFace: 0,
        facePresent: 0,
        multipleFaces: 0,
        headTurned: 0,
        gazeAway: 0,
        objectDetected: 0,
        faceMismatch: 0,
      };
    };
  }, [enabled, sessionId, analyzeFrame, intervalMs]);

  return {
    incrementTabSwitch,
    incrementFullscreenExit,
    incrementAudioDetected,
    incrementFaceMismatch,
    incrementGazeAway,
    getCounters,
    captureFrame,
  };
};

export default useProctor;
