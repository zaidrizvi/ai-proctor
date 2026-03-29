import { useRef, useEffect, useCallback } from "react";
import axios from "axios";

const ML_URL = import.meta.env.VITE_ML_URL || "http://localhost:8000";
const NO_FACE_STREAK_TO_ALERT = 2;
const FACE_RECOVERY_STREAK = 2;
const MULTIPLE_FACES_STREAK_TO_ALERT = 3;
const HEAD_TURN_STREAK_TO_ALERT = 2;
const STRONG_HEAD_TURN_STREAK_TO_ALERT = 1;
const GAZE_AWAY_STREAK_TO_ALERT = 3;
const NO_FRAME_STREAK_TO_ALERT = 2;
const FACE_MISMATCH_STREAK_TO_ALERT = 2;
const HEAD_TURN_ALERT_COOLDOWN_MS = 10000;
const OBJECT_DETECTED_STREAK_TO_ALERT = 2;
const OBJECT_ALERT_COOLDOWN_MS = 10000;
const OBJECT_ANALYSIS_INTERVAL_MS = 3500;
const MULTIPLE_FACES_ALERT_COOLDOWN_MS = 10000;
const FACE_MISMATCH_ALERT_COOLDOWN_MS = 45000;
const MIN_HEAD_POSE_QUALITY_FOR_ALERT = 0.46;
const MIN_FACE_CONFIDENCE_FOR_STABLE_ALERTS = 0.54;
const MIN_FACE_AREA_RATIO_FOR_STABLE_ALERTS = 0.024;
const MIN_FACE_AREA_RATIO_FOR_FALLBACK = 0.02;
const MIN_HEAD_MOVEMENT_SCORE_FOR_ALERT = 1.02;
const MAX_CAPTURE_WIDTH = 1024;
const JPEG_QUALITY = 0.9;

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
  onMlFrame,
  intervalMs = 800,
  verifyIntervalMs = 45000,
}) => {
  const intervalRef = useRef(null);
  const criticalAnalysisInFlightRef = useRef(false);
  const queuedCriticalAnalysisRef = useRef(false);
  const objectAnalysisInFlightRef = useRef(false);
  const verifyAnalysisInFlightRef = useRef(false);
  const lastIdentityCheckRef = useRef(0);
  const lastObjectCheckAtRef = useRef(0);
  const lifecycleTokenRef = useRef(0);
  const analysisCycleRef = useRef(0);
  const countedMultipleFacesCyclesRef = useRef(new Set());
  const multipleFacesCycleBySourceRef = useRef({
    face: 0,
    object: 0,
  });
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
    cameraFrameUnavailable: false,
  });
  const lastAlertAtRef = useRef({
    objectDetected: 0,
    faceMismatch: 0,
    headTurned: 0,
    multipleFaces: 0,
    mlUnavailable: 0,
    cameraFrameUnavailable: 0,
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
    camera_frame_unavailable: 0,
    total_checks: 0,
  });

  const isTokenActive = useCallback((token) => {
    return token === lifecycleTokenRef.current && Boolean(enabled) && Boolean(sessionId);
  }, [enabled, sessionId]);

  const emitAlert = useCallback((token, eventType, severity, description) => {
    if (!isTokenActive(token)) {
      return;
    }

    onAlert?.(eventType, severity, description);
  }, [isTokenActive, onAlert]);

  const decayStreak = useCallback((key, amount = 1) => {
    streaksRef.current[key] = Math.max(0, streaksRef.current[key] - amount);
  }, []);

  const triggerMultipleFacesAlert = useCallback((source, description, now, cycleId, token) => {
    multipleFacesSourcesRef.current[source] = true;
    const sourceCycle = multipleFacesCycleBySourceRef.current[source];

    if (
      sourceCycle !== cycleId &&
      !countedMultipleFacesCyclesRef.current.has(cycleId)
    ) {
      streaksRef.current.multipleFaces += 1;
      countedMultipleFacesCyclesRef.current.add(cycleId);
      if (countedMultipleFacesCyclesRef.current.size > 12) {
        const oldestCycleId = countedMultipleFacesCyclesRef.current.values().next().value;
        countedMultipleFacesCyclesRef.current.delete(oldestCycleId);
      }
    }
    multipleFacesCycleBySourceRef.current[source] = cycleId;

    if (
      streaksRef.current.multipleFaces >= MULTIPLE_FACES_STREAK_TO_ALERT &&
      !activeFlagsRef.current.multipleFaces &&
      now - lastAlertAtRef.current.multipleFaces >= MULTIPLE_FACES_ALERT_COOLDOWN_MS
    ) {
      activeFlagsRef.current.multipleFaces = true;
      lastAlertAtRef.current.multipleFaces = now;
      countersRef.current.multiple_faces += 1;
      emitAlert(token, "multiple_faces", "high", description);
    }
  }, [emitAlert]);

  const clearMultipleFacesSignal = useCallback((source) => {
    multipleFacesSourcesRef.current[source] = false;
    const hasAnyActiveSource = Object.values(multipleFacesSourcesRef.current).some(Boolean);

    if (!hasAnyActiveSource) {
      streaksRef.current.multipleFaces = 0;
      activeFlagsRef.current.multipleFaces = false;
    }
  }, []);

  const captureFrame = useCallback(async () => {
    const drawToDataUrl = (source, sourceWidth, sourceHeight) => {
      const scale = sourceWidth > MAX_CAPTURE_WIDTH
        ? MAX_CAPTURE_WIDTH / sourceWidth
        : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    };

    const videoTrack = streamRef?.current?.getVideoTracks?.()[0];
    if (videoTrack && typeof ImageCapture !== "undefined") {
      try {
        const imageCapture = new ImageCapture(videoTrack);
        const bitmap = await imageCapture.grabFrame();
        const frame = drawToDataUrl(
          bitmap,
          bitmap.width || 1280,
          bitmap.height || 720
        );
        bitmap.close?.();
        return frame;
      } catch {
        // Fall back to the video element path below if ImageCapture is unavailable.
      }
    }

    if (!videoRef.current) return null;
    const video = videoRef.current;
    if (video.readyState < 2) return null;
    if (!video.videoWidth || !video.videoHeight) return null;

    return drawToDataUrl(
      video,
      video.videoWidth || 1280,
      video.videoHeight || 720
    );
  }, [streamRef, videoRef]);

  const processFaceResult = useCallback((faceResult, now, trackerPresence, cycleId, token) => {
    let faceDetectorAvailable = false;
    let detectorNoFace = false;
    let primaryFaceRecovered = false;
    let faceMultipleFacesCandidate = false;
    let weakFace = false;
    let faceConfidence = 0;
    let faceAreaRatio = 0;

    if (faceResult?.status === "fulfilled") {
      const face = faceResult.value.data;
      const noFaceFromDetector = face.event === "face_not_detected";
      const multipleFaces =
        face.event === "multiple_faces" || Number(face.face_count || 0) > 1;
      faceConfidence = Number(face.primary_face_confidence || 0);
      faceAreaRatio = Number(face.primary_face_area_ratio || 0);

      faceDetectorAvailable = true;
      detectorNoFace = noFaceFromDetector;
      primaryFaceRecovered = Boolean(face.face_detected) && !noFaceFromDetector;
      faceMultipleFacesCandidate = multipleFaces;
      weakFace = primaryFaceRecovered && (
        faceConfidence < MIN_FACE_CONFIDENCE_FOR_STABLE_ALERTS ||
        faceAreaRatio < MIN_FACE_AREA_RATIO_FOR_STABLE_ALERTS
      );
    }

    const fallbackFacePresent = Boolean(
      (detectorNoFace || !faceDetectorAvailable) &&
      trackerPresence?.facePresent &&
      trackerPresence?.stable
    );
    const noFace = faceDetectorAvailable && detectorNoFace && !fallbackFacePresent;
    const faceRecovered = (
      (faceDetectorAvailable && primaryFaceRecovered) ||
      fallbackFacePresent
    );
    const stableFace = faceRecovered && !weakFace && !trackerPresence?.weak;

    if (noFace) {
      streaksRef.current.noFace += 1;
      streaksRef.current.facePresent = 0;
    } else if (stableFace) {
      streaksRef.current.facePresent += 1;
      streaksRef.current.noFace = 0;
    } else if (faceRecovered || weakFace || trackerPresence?.facePresent) {
      decayStreak("noFace");
      streaksRef.current.facePresent = 0;
    } else {
      decayStreak("noFace");
      streaksRef.current.facePresent = 0;
    }

    if (
      streaksRef.current.noFace >= NO_FACE_STREAK_TO_ALERT &&
      !activeFlagsRef.current.faceMissing
    ) {
      activeFlagsRef.current.faceMissing = true;
      countersRef.current.face_not_detected += 1;
      emitAlert(token, "face_not_detected", "high", "Face not detected in frame");
    } else if (streaksRef.current.facePresent >= FACE_RECOVERY_STREAK) {
      activeFlagsRef.current.faceMissing = false;
      noFrameStreakRef.current = 0;
    }

    if (faceMultipleFacesCandidate) {
      triggerMultipleFacesAlert("face", "Multiple faces detected", now, cycleId, token);
    } else {
      clearMultipleFacesSignal("face");
    }

    return {
      faceDetectorAvailable,
      faceDetected: stableFace,
      facePresent: faceRecovered,
      noFace,
      weakFace: Boolean(weakFace || trackerPresence?.weak),
      fallbackFacePresent,
      faceConfidence,
      faceAreaRatio,
      multipleFaces: faceMultipleFacesCandidate,
    };
  }, [clearMultipleFacesSignal, decayStreak, emitAlert, triggerMultipleFacesAlert]);

  const processHeadResult = useCallback((headResult, gazeResult, now, faceState = {}, token) => {
    const shouldSuppressHeadTurn =
      faceState.noFace ||
      faceState.weakFace;

    if (shouldSuppressHeadTurn) {
      decayStreak("headTurned");
      activeFlagsRef.current.headTurned = false;
      return;
    }

    if (headResult?.status !== "fulfilled") {
      return;
    }

    const head = headResult.value.data;
    const gazeCurrentlyAway = gazeResult?.status === "fulfilled"
      ? gazeResult.value.data?.event === "gaze_away"
      : activeFlagsRef.current.gazeAway;
    const rawHeadTurned = head.event === "head_turned";
    const obviousTurn = Boolean(head.obvious_turn);
    const poseQuality = Number(head.pose_quality || 0);
    const movementScore = Number(head.combined_movement_score || head.movement_score || 0);
    const turnAxis = head.turn_axis || "none";
    const headTurned = rawHeadTurned && !(
      turnAxis === "downward" &&
      !gazeCurrentlyAway &&
      movementScore < 1.2
    );

    if (poseQuality < MIN_HEAD_POSE_QUALITY_FOR_ALERT) {
      decayStreak("headTurned");
      activeFlagsRef.current.headTurned = false;
      return;
    }

    if (headTurned && movementScore >= MIN_HEAD_MOVEMENT_SCORE_FOR_ALERT) {
      streaksRef.current.headTurned += 1;
    } else {
      decayStreak("headTurned");
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
      emitAlert(token, "head_turned", "medium", "Student turned head away from screen");
    } else if (!headTurned) {
      activeFlagsRef.current.headTurned = false;
    }
  }, [decayStreak, emitAlert]);

  const processGazeResult = useCallback((gazeResult, faceState = {}, token) => {
    let gazeLookingAway = false;
    let gazeDirection = "side";

    if (faceState.noFace || faceState.weakFace) {
      decayStreak("gazeAway");
      activeFlagsRef.current.gazeAway = false;
      return;
    }

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
      decayStreak("gazeAway");
    }

    if (
      streaksRef.current.gazeAway >= GAZE_AWAY_STREAK_TO_ALERT &&
      !activeFlagsRef.current.gazeAway
    ) {
      activeFlagsRef.current.gazeAway = true;
      countersRef.current.gaze_away += 1;
      emitAlert(
        token,
        "gaze_away",
        "medium",
        `Student looked away from screen (${gazeDirection})`
      );
    } else if (!gazeLookingAway) {
      activeFlagsRef.current.gazeAway = false;
    }
  }, [decayStreak, emitAlert]);

  const processObjectResult = useCallback((response, cycleId, token) => {
    if (!isTokenActive(token)) {
      return;
    }

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
          emitAlert(
            token,
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
      triggerMultipleFacesAlert("object", "Multiple people detected in camera view", now, cycleId, token);
    } else {
      clearMultipleFacesSignal("object");
    }
  }, [clearMultipleFacesSignal, emitAlert, isTokenActive, triggerMultipleFacesAlert]);

  const processVerifyResult = useCallback((response, token) => {
    if (!isTokenActive(token)) {
      return;
    }

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
      emitAlert(
        token,
        "face_mismatch",
        "high",
        `Face mismatch detected (${Math.round(verification.distance * 100) / 100} distance)`
      );
    }
  }, [emitAlert, isTokenActive]);

  const scheduleBackgroundTasks = useCallback((frame, cycleId, token) => {
    const now = Date.now();
    if (
      !objectAnalysisInFlightRef.current &&
      now - lastObjectCheckAtRef.current >= OBJECT_ANALYSIS_INTERVAL_MS
    ) {
      objectAnalysisInFlightRef.current = true;
      lastObjectCheckAtRef.current = now;

      void axios.post(`${ML_URL}/objects/detect`, { frame })
        .then((response) => {
          processObjectResult(response, cycleId, token);
        })
        .catch((error) => {
          if (isTokenActive(token)) {
            console.warn("ML objects check failed:", error?.message || error);
          }
        })
        .finally(() => {
          if (token === lifecycleTokenRef.current) {
            objectAnalysisInFlightRef.current = false;
          }
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
      .then((response) => {
        processVerifyResult(response, token);
      })
      .catch((error) => {
        if (isTokenActive(token)) {
          console.warn("ML verify check failed:", error?.message || error);
        }
      })
      .finally(() => {
        if (token === lifecycleTokenRef.current) {
          verifyAnalysisInFlightRef.current = false;
        }
      });
  }, [
    isTokenActive,
    processObjectResult,
    processVerifyResult,
    referenceFace,
    referenceFaceEmbedding,
    verifyIntervalMs,
  ]);

  const deriveTrackerFacePresence = useCallback((headResult, gazeResult) => {
    const headData = headResult?.status === "fulfilled" ? headResult.value.data : null;
    const gazeData = gazeResult?.status === "fulfilled" ? gazeResult.value.data : null;
    const headStable = Boolean(
      headData?.head_detected &&
      Number(headData?.pose_quality || 0) >= 0.5
    );
    const gazeStable = Boolean(
      gazeData?.face_detected &&
      Number(gazeData?.face_area_ratio || 0) >= MIN_FACE_AREA_RATIO_FOR_FALLBACK &&
      !gazeData?.looking_away
    );

    return {
      facePresent: Boolean(headStable || gazeStable),
      stable: Boolean(headStable || gazeStable),
      weak: Boolean(
        (headData?.head_detected && !headStable) ||
        (gazeData?.face_detected && !gazeStable)
      ),
    };
  }, []);

  const analyzeFrame = useCallback(async () => {
    const token = lifecycleTokenRef.current;
    if (!isTokenActive(token) || !examId) {
      return;
    }

    if (criticalAnalysisInFlightRef.current) {
      queuedCriticalAnalysisRef.current = true;
      return;
    }

    criticalAnalysisInFlightRef.current = true;

    try {
      const frame = await captureFrame();
      if (!isTokenActive(token)) {
        return;
      }

      if (!frame) {
        noFrameStreakRef.current += 1;
        if (
          noFrameStreakRef.current >= NO_FRAME_STREAK_TO_ALERT &&
          !activeFlagsRef.current.cameraFrameUnavailable &&
          Date.now() - lastAlertAtRef.current.cameraFrameUnavailable >= HEAD_TURN_ALERT_COOLDOWN_MS
        ) {
          activeFlagsRef.current.cameraFrameUnavailable = true;
          lastAlertAtRef.current.cameraFrameUnavailable = Date.now();
          countersRef.current.camera_frame_unavailable += 1;
          emitAlert(
            token,
            "camera_frame_unavailable",
            "high",
            "Camera frame unavailable or webcam feed stalled"
          );
        }
        return;
      }

      noFrameStreakRef.current = 0;
      activeFlagsRef.current.cameraFrameUnavailable = false;
      onMlFrame?.(frame);
      analysisCycleRef.current += 1;
      const cycleId = analysisCycleRef.current;

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
          if (isTokenActive(token)) {
            console.warn(
              `ML ${criticalRequests[index].key} check failed:`,
              result.reason?.message || result.reason
            );
          }
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
          emitAlert(
            token,
            "ml_service_unavailable",
            "medium",
            "ML vision checks are currently unavailable; proctoring evidence may be incomplete"
          );
        }
        return;
      }

      countersRef.current.total_checks += 1;
      const trackerPresence = deriveTrackerFacePresence(headRes, gazeRes);
      const faceState = processFaceResult(faceRes, now, trackerPresence, cycleId, token);
       processHeadResult(headRes, gazeRes, now, faceState, token);
      processGazeResult(gazeRes, faceState, token);
      scheduleBackgroundTasks(frame, cycleId, token);
    } catch (err) {
      if (isTokenActive(token)) {
        console.warn("ML analysis failed:", err.message);
      }
    } finally {
      if (token === lifecycleTokenRef.current) {
        criticalAnalysisInFlightRef.current = false;
      }

      if (token === lifecycleTokenRef.current && queuedCriticalAnalysisRef.current) {
        queuedCriticalAnalysisRef.current = false;
        setTimeout(() => {
          void analyzeFrame();
        }, 0);
      }
    }
  }, [
    examId,
    captureFrame,
    deriveTrackerFacePresence,
    emitAlert,
    headPoseBaseline,
    gazeBaseline,
    isTokenActive,
    onMlFrame,
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
    lifecycleTokenRef.current += 1;

    void analyzeFrame();
    intervalRef.current = setInterval(analyzeFrame, intervalMs);

    return () => {
      lifecycleTokenRef.current += 1;
      if (intervalRef.current) clearInterval(intervalRef.current);
      criticalAnalysisInFlightRef.current = false;
      queuedCriticalAnalysisRef.current = false;
      objectAnalysisInFlightRef.current = false;
      verifyAnalysisInFlightRef.current = false;
      lastObjectCheckAtRef.current = 0;
      analysisCycleRef.current = 0;
      noFrameStreakRef.current = 0;
      multipleFacesSourcesRef.current = {
        face: false,
        object: false,
      };
      multipleFacesCycleBySourceRef.current = {
        face: 0,
        object: 0,
      };
      countedMultipleFacesCyclesRef.current = new Set();
      activeFlagsRef.current = {
        faceMissing: false,
        multipleFaces: false,
        gazeAway: false,
        headTurned: false,
        objectDetected: false,
        cameraFrameUnavailable: false,
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
