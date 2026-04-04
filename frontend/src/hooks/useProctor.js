import { useRef, useEffect, useCallback } from "react";
import { createJpegBlobFromSource } from "../utils/imageCapture.js";
import { postMlMultipart } from "../utils/mlClient.js";

const NO_FACE_STREAK_TO_ALERT = 2;
const FACE_RECOVERY_STREAK = 2;
const MULTIPLE_FACES_STREAK_TO_ALERT = 2;
const OBJECT_MULTIPLE_FACES_STREAK_TO_ALERT = 2;
const PRESENCE_MULTIPLE_FACES_CONFIRM_STREAK = 2;
const HEAD_TURN_STREAK_TO_ALERT = 2;
const STRONG_HEAD_TURN_STREAK_TO_ALERT = 1;
const HEAD_TURN_RECOVERY_STREAK = 2;
const NO_FRAME_STREAK_TO_ALERT = 2;
const FACE_MISMATCH_STREAK_TO_ALERT = 2;
const FACE_MATCH_RECOVERY_STREAK = 2;
const HEAD_TURN_ALERT_COOLDOWN_MS = 2000;
const OBJECT_DETECTED_STREAK_TO_ALERT = 2;
const PRIORITY_OBJECT_DETECTED_STREAK_TO_ALERT = 1;
const OBJECT_ALERT_COOLDOWN_MS = 2000;
const OBJECT_ANALYSIS_INTERVAL_MS = 800;
const MULTIPLE_FACES_ALERT_COOLDOWN_MS = 2000;
const MULTIPLE_FACES_FACE_SOURCE_HOLD_MS = 1400;
const MULTIPLE_FACES_OBJECT_SOURCE_HOLD_MS = (OBJECT_ANALYSIS_INTERVAL_MS * 2) + 250;
const MULTIPLE_FACES_FACE_PULSE_INTERVAL_MS = 700;
const MULTIPLE_FACES_OBJECT_PULSE_INTERVAL_MS = 850;
const MULTIPLE_FACES_STALE_DECAY_MS = 2000;
const FACE_MISMATCH_ALERT_COOLDOWN_MS = 2000;
const MIN_HEAD_POSE_QUALITY_FOR_ALERT = 0.46;
const MIN_HEAD_POSE_QUALITY_FOR_NO_FACE_GRACE = 0.42;
const MIN_FACE_CONFIDENCE_FOR_STABLE_ALERTS = 0.54;
const MIN_FACE_AREA_RATIO_FOR_STABLE_ALERTS = 0.024;
const MIN_HEAD_MOVEMENT_SCORE_FOR_ALERT = 1.02;
const MIN_DOWNWARD_HEAD_PITCH_SCORE_FOR_ALERT = 1.28;
const MIN_DOWNWARD_HEAD_NOSE_SCORE_FOR_ALERT = 1.18;
const MIN_DOWNWARD_HEAD_MOVEMENT_SCORE_FOR_ALERT = 1.16;
const DOWNWARD_HEAD_TURN_GRACE_MS = 900;
const MIN_DOWNWARD_HEAD_GRACE_SIGNAL_SCORE = 0.92;
const IDENTITY_CONTINUITY_VERIFY_INTERVAL_MS = 1000;
const IDENTITY_URGENT_VERIFY_INTERVAL_MS = 600;
const IDENTITY_MATCH_FRESHNESS_MS = 4500;
const IDENTITY_COMPROMISE_WINDOW_MS = 2200;
const DETECTOR_NO_FACE_IDENTITY_GRACE_MS = 450;
const DESKTOP_CAPTURE_WIDTH = 768;
const MOBILE_CAPTURE_WIDTH = 720;
const DESKTOP_JPEG_QUALITY = 0.78;
const MOBILE_JPEG_QUALITY = 0.78;
const PRIORITY_SUSPICIOUS_OBJECTS = new Set(["cell phone", "book", "remote"]);

const isLikelyMobileBrowser = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent || ""
  );
};

const useProctor = ({
  videoRef,
  streamRef,
  sessionId,
  examId,
  enabled = true,
  referenceFace = "",
  referenceFaceEmbedding = [],
  headPoseBaseline = null,
  suppressHeadTurnAlerts = false,
  faceDetectionEnabled = true,
  faceVerificationEnabled = true,
  headMovementEnabled = true,
  objectDetectionEnabled = true,
  onAlert,
  onMlFrame,
  intervalMs = 700,
  verifyIntervalMs = 30000,
}) => {
  const intervalRef = useRef(null);
  const criticalAnalysisInFlightRef = useRef(false);
  const objectAnalysisInFlightRef = useRef(false);
  const verifyAnalysisInFlightRef = useRef(false);
  const captureCanvasRef = useRef(null);
  const lastIdentityCheckRef = useRef(0);
  const lastObjectCheckAtRef = useRef(0);
  const lastExplicitFaceDetectedAtRef = useRef(0);
  const lastExplicitNoFaceAtRef = useRef(0);
  const lastValidHeadPoseAtRef = useRef(0);
  const lastDownwardHeadPoseSignalAtRef = useRef(0);
  const lastIdentityCompromisedAtRef = useRef(0);
  const lastExtraPersonDetectedAtRef = useRef(0);
  const lifecycleTokenRef = useRef(0);
  const analysisCycleRef = useRef(0);
  const lastMultipleFacesDecayAtRef = useRef(0);
  const identityStateRef = useRef({
    lastVerifiedMatchAt: 0,
    lastMismatchAt: 0,
    lastCheckAt: 0,
    status: "unknown",
    reason: "",
  });
  const multipleFacesSourcesRef = useRef({
    face: {
      lastPositiveAt: 0,
      lastPulseAt: 0,
    },
    object: {
      lastPositiveAt: 0,
      lastPulseAt: 0,
    },
  });
  const noFrameStreakRef = useRef(0);
  const activeFlagsRef = useRef({
    faceMissing: false,
    multipleFaces: false,
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
    presenceMultipleFaces: 0,
    headTurned: 0,
    headTurnRecovery: 0,
    objectDetected: 0,
    faceMismatch: 0,
    faceVerified: 0,
  });
  const countersRef = useRef({
    face_not_detected: 0,
    multiple_faces: 0,
    face_mismatch: 0,
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

  const hasReferenceIdentity = Boolean(referenceFace) || referenceFaceEmbedding.length > 0;
  const visualMonitoringEnabled =
    faceDetectionEnabled ||
    faceVerificationEnabled ||
    headMovementEnabled ||
    objectDetectionEnabled;

  const hasFreshVerifiedIdentity = useCallback((now) => {
    if (!hasReferenceIdentity) {
      return false;
    }

    return now - identityStateRef.current.lastVerifiedMatchAt <= IDENTITY_MATCH_FRESHNESS_MS;
  }, [hasReferenceIdentity]);

  const hasRecentIdentityMismatch = useCallback((now) => {
    if (!hasReferenceIdentity) {
      return false;
    }

    return now - identityStateRef.current.lastMismatchAt <= IDENTITY_MATCH_FRESHNESS_MS;
  }, [hasReferenceIdentity]);

  const getMultipleFacesSourceHoldMs = useCallback((source) => {
    return source === "object"
      ? MULTIPLE_FACES_OBJECT_SOURCE_HOLD_MS
      : MULTIPLE_FACES_FACE_SOURCE_HOLD_MS;
  }, []);

  const getMultipleFacesSourcePulseIntervalMs = useCallback((source) => {
    return source === "object"
      ? MULTIPLE_FACES_OBJECT_PULSE_INTERVAL_MS
      : MULTIPLE_FACES_FACE_PULSE_INTERVAL_MS;
  }, []);

  const hasFreshMultipleFacesSignal = useCallback((now) => {
    return Object.entries(multipleFacesSourcesRef.current).some(([source, state]) => {
      return now - state.lastPositiveAt <= getMultipleFacesSourceHoldMs(source);
    });
  }, [getMultipleFacesSourceHoldMs]);

  const refreshMultipleFacesState = useCallback((now) => {
    const hasFreshSignal = hasFreshMultipleFacesSignal(now);

    if (hasFreshSignal) {
      activeFlagsRef.current.multipleFaces = true;
      return true;
    }

    activeFlagsRef.current.multipleFaces = false;

    if (now - lastMultipleFacesDecayAtRef.current >= MULTIPLE_FACES_STALE_DECAY_MS) {
      decayStreak("multipleFaces");
      lastMultipleFacesDecayAtRef.current = now;
    }

    return false;
  }, [decayStreak, hasFreshMultipleFacesSignal]);

  const triggerMultipleFacesAlert = useCallback((source, description, now, token) => {
    const sourceState = multipleFacesSourcesRef.current[source];
    const pulseIntervalMs = getMultipleFacesSourcePulseIntervalMs(source);
    const isNewPulse = now - sourceState.lastPulseAt >= pulseIntervalMs;
    const alertThreshold = source === "object"
      ? OBJECT_MULTIPLE_FACES_STREAK_TO_ALERT
      : MULTIPLE_FACES_STREAK_TO_ALERT;

    sourceState.lastPositiveAt = now;

    if (isNewPulse) {
      sourceState.lastPulseAt = now;
      streaksRef.current.multipleFaces = Math.min(
        streaksRef.current.multipleFaces + 1,
        alertThreshold + 2
      );
    }

    activeFlagsRef.current.multipleFaces = true;

    if (
      streaksRef.current.multipleFaces >= alertThreshold &&
      now - lastAlertAtRef.current.multipleFaces >= MULTIPLE_FACES_ALERT_COOLDOWN_MS
    ) {
      lastAlertAtRef.current.multipleFaces = now;
      countersRef.current.multiple_faces += 1;
      emitAlert(token, "multiple_faces", "high", description);
    }
  }, [emitAlert, getMultipleFacesSourcePulseIntervalMs]);

  const clearMultipleFacesSignal = useCallback((source, now) => {
    const sourceState = multipleFacesSourcesRef.current[source];
    sourceState.lastPulseAt = 0;
    refreshMultipleFacesState(now);
  }, [refreshMultipleFacesState]);

  const captureFrame = useCallback(async () => {
    const captureWidth = isLikelyMobileBrowser()
      ? MOBILE_CAPTURE_WIDTH
      : DESKTOP_CAPTURE_WIDTH;
    const captureQuality = isLikelyMobileBrowser()
      ? MOBILE_JPEG_QUALITY
      : DESKTOP_JPEG_QUALITY;

    const drawToBlob = (source, sourceWidth, sourceHeight) => {
      const canvas = captureCanvasRef.current || document.createElement("canvas");
      captureCanvasRef.current = canvas;
      return createJpegBlobFromSource(source, sourceWidth, sourceHeight, {
        canvas,
        maxWidth: captureWidth,
        quality: captureQuality,
      });
    };

    const videoTrack = streamRef?.current?.getVideoTracks?.()[0];
    if (videoTrack && typeof ImageCapture !== "undefined") {
      try {
        const imageCapture = new ImageCapture(videoTrack);
        const bitmap = await imageCapture.grabFrame();
        const frame = await drawToBlob(
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

    return drawToBlob(
      video,
      video.videoWidth || 1280,
      video.videoHeight || 720
    );
  }, [streamRef, videoRef]);

  const hasRecentDownwardHeadPoseGrace = useCallback((now) => {
    return (
      now - lastValidHeadPoseAtRef.current <= DOWNWARD_HEAD_TURN_GRACE_MS &&
      now - lastDownwardHeadPoseSignalAtRef.current <= DOWNWARD_HEAD_TURN_GRACE_MS
    );
  }, []);

  const refreshRecentHeadPoseState = useCallback((headResult, now) => {
    if (headResult?.status !== "fulfilled") {
      return;
    }

    const head = headResult.value.data;
    if (!head?.head_detected) {
      return;
    }

    lastValidHeadPoseAtRef.current = now;

    const poseQuality = Number(head.pose_quality || 0);
    const movementScore = Number(head.combined_movement_score || head.movement_score || 0);
    const downwardPitchScore = Number(head.downward_pitch_score || 0);
    const downwardNoseScore = Number(head.downward_nose_score || 0);
    const strongDownwardSignal = (
      poseQuality >= MIN_HEAD_POSE_QUALITY_FOR_NO_FACE_GRACE &&
      (
        head.downward_signal === true ||
        (
          head.turn_axis === "downward" &&
          (
            movementScore >= MIN_DOWNWARD_HEAD_GRACE_SIGNAL_SCORE ||
            downwardPitchScore >= 0.95 ||
            downwardNoseScore >= 0.95
          )
        )
      )
    );

    if (strongDownwardSignal) {
      lastDownwardHeadPoseSignalAtRef.current = now;
    }
  }, []);

  const processFaceResult = useCallback((faceResult, now, trackerPresence, token) => {
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
      const strictFaceCount = Number(
        face.strict_face_count ?? face.reliable_face_count ?? face.face_count ?? 0
      );
      const presenceFaceCount = Number(
        face.presence_face_count ?? face.raw_face_count ?? strictFaceCount ?? 0
      );
      const strictMultipleFaces = Boolean(
        face.multiple_faces_strict ||
        strictFaceCount > 1
      );
      const promotedPresenceOnlyMultipleFaces = Boolean(
        !strictMultipleFaces &&
        face.multiple_faces_presence_promoted === true
      );
      faceConfidence = Number(face.primary_face_confidence || 0);
      faceAreaRatio = Number(face.primary_face_area_ratio || 0);

      faceDetectorAvailable = true;
      detectorNoFace = noFaceFromDetector;
      primaryFaceRecovered = Boolean(face.face_detected) && !noFaceFromDetector;
      faceMultipleFacesCandidate = strictMultipleFaces;
      weakFace = primaryFaceRecovered && (
        faceConfidence < MIN_FACE_CONFIDENCE_FOR_STABLE_ALERTS ||
        faceAreaRatio < MIN_FACE_AREA_RATIO_FOR_STABLE_ALERTS
      );

      if (detectorNoFace) {
        lastExplicitNoFaceAtRef.current = now;
      }

      if (primaryFaceRecovered) {
        lastExplicitFaceDetectedAtRef.current = now;
      }

      if (strictMultipleFaces) {
        lastIdentityCompromisedAtRef.current = now;
      }

      if (promotedPresenceOnlyMultipleFaces) {
        streaksRef.current.presenceMultipleFaces += 1;
      } else {
        streaksRef.current.presenceMultipleFaces = 0;
      }

      if (
        promotedPresenceOnlyMultipleFaces &&
        streaksRef.current.presenceMultipleFaces >= PRESENCE_MULTIPLE_FACES_CONFIRM_STREAK
      ) {
        faceMultipleFacesCandidate = true;
        lastIdentityCompromisedAtRef.current = now;
      }
    } else {
      streaksRef.current.presenceMultipleFaces = 0;
    }

    const trackerFallbackAllowed = (
      !hasReferenceIdentity ||
      (
        hasFreshVerifiedIdentity(now) &&
        !hasRecentIdentityMismatch(now)
      )
    );
    const fallbackGraceActive = (
      now - lastExplicitFaceDetectedAtRef.current <= DETECTOR_NO_FACE_IDENTITY_GRACE_MS
    );
    const fallbackFacePresent = Boolean(
      trackerPresence?.facePresent &&
      trackerPresence?.stable &&
      (
        (!faceDetectorAvailable && trackerFallbackAllowed) ||
        (
          detectorNoFace &&
          trackerFallbackAllowed &&
          (
            !hasReferenceIdentity ||
            fallbackGraceActive
          )
        )
      )
    );
    const downwardHeadPoseGraceActive = hasRecentDownwardHeadPoseGrace(now);
    const noFace = (
      faceDetectorAvailable &&
      detectorNoFace &&
      !fallbackFacePresent &&
      !downwardHeadPoseGraceActive
    );
    const faceRecovered = (
      (faceDetectorAvailable && primaryFaceRecovered) ||
      fallbackFacePresent
    );
    const stableFace = faceRecovered && !weakFace && !trackerPresence?.weak;
    const identityMismatchVisible = Boolean(
      hasReferenceIdentity &&
      !faceMultipleFacesCandidate &&
      (faceRecovered || trackerPresence?.facePresent) &&
      hasRecentIdentityMismatch(now)
    );
    const shouldTreatAsNoFace = noFace && !identityMismatchVisible;

    if (shouldTreatAsNoFace) {
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
      const description = streaksRef.current.presenceMultipleFaces >= PRESENCE_MULTIPLE_FACES_CONFIRM_STREAK
        ? "Multiple faces detected (confirmed across face checks)"
        : "Multiple faces detected";
      triggerMultipleFacesAlert("face", description, now, token);
    } else {
      clearMultipleFacesSignal("face", now);
    }

    return {
      faceDetectorAvailable,
      faceDetected: stableFace,
      facePresent: faceRecovered,
      noFace: shouldTreatAsNoFace,
      weakFace: Boolean(weakFace || trackerPresence?.weak),
      fallbackFacePresent,
      detectorNoFace,
      identityMismatchVisible,
      faceConfidence,
      faceAreaRatio,
      multipleFaces: faceMultipleFacesCandidate,
    };
  }, [
    clearMultipleFacesSignal,
    decayStreak,
    emitAlert,
    hasRecentDownwardHeadPoseGrace,
    hasFreshVerifiedIdentity,
    hasRecentIdentityMismatch,
    hasReferenceIdentity,
    triggerMultipleFacesAlert,
  ]);

  const processHeadResult = useCallback((headResult, now, faceState = {}, token) => {
    const recentDownwardHeadPoseGraceActive = hasRecentDownwardHeadPoseGrace(now);
    const shouldSuppressHeadTurn =
      !headMovementEnabled ||
      suppressHeadTurnAlerts ||
      faceState.identityMismatchVisible ||
      (faceState.noFace && !recentDownwardHeadPoseGraceActive);

    const recoverHeadTurnSignal = (clearImmediately = false) => {
      decayStreak("headTurned");
      streaksRef.current.headTurnRecovery += 1;

      if (clearImmediately || streaksRef.current.headTurnRecovery >= HEAD_TURN_RECOVERY_STREAK) {
        activeFlagsRef.current.headTurned = false;
      }
    };

    const commitHeadTurnSignal = (isStrong = false) => {
      streaksRef.current.headTurned += 1;
      streaksRef.current.headTurnRecovery = 0;

      const headTurnThreshold = isStrong
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
      }
    };

    if (shouldSuppressHeadTurn) {
      streaksRef.current.headTurnRecovery = 0;
      decayStreak("headTurned");
      activeFlagsRef.current.headTurned = false;
      return;
    }

    if (headResult?.status !== "fulfilled") {
      if (faceState.noFace && recentDownwardHeadPoseGraceActive) {
        commitHeadTurnSignal();
      }
      return;
    }

    const head = headResult.value.data;
    if (!head?.head_detected) {
      if (faceState.noFace && recentDownwardHeadPoseGraceActive) {
        commitHeadTurnSignal();
      } else {
        recoverHeadTurnSignal();
      }
      return;
    }

    const rawHeadTurned = head.event === "head_turned";
    const obviousTurn = Boolean(head.obvious_turn);
    const poseQuality = Number(head.pose_quality || 0);
    const movementScore = Number(head.combined_movement_score || head.movement_score || 0);
    const turnAxis = head.turn_axis || "none";
    const downwardPitchScore = Number(head.downward_pitch_score || 0);
    const downwardNoseScore = Number(head.downward_nose_score || 0);
    const movementReason = String(head.movement_reason || "none");
    const headTurned = rawHeadTurned && !(
      turnAxis === "downward" &&
      movementScore < 1.2
    );

    if (poseQuality < MIN_HEAD_POSE_QUALITY_FOR_ALERT) {
      if (faceState.noFace && recentDownwardHeadPoseGraceActive) {
        commitHeadTurnSignal();
        return;
      }
      recoverHeadTurnSignal();
      return;
    }

    const borderlineDownwardTurn = (
      headTurned &&
      turnAxis === "downward" &&
      movementReason.startsWith("downward") &&
      downwardPitchScore < MIN_DOWNWARD_HEAD_PITCH_SCORE_FOR_ALERT &&
      downwardNoseScore < MIN_DOWNWARD_HEAD_NOSE_SCORE_FOR_ALERT &&
      movementScore < MIN_DOWNWARD_HEAD_MOVEMENT_SCORE_FOR_ALERT
    );

    if (
      headTurned &&
      movementScore >= MIN_HEAD_MOVEMENT_SCORE_FOR_ALERT &&
      !borderlineDownwardTurn
    ) {
      commitHeadTurnSignal(obviousTurn);
      return;
    } else {
      recoverHeadTurnSignal();
    }
  }, [decayStreak, emitAlert, hasRecentDownwardHeadPoseGrace, headMovementEnabled, suppressHeadTurnAlerts]);

  const processObjectResult = useCallback((response, token) => {
    if (!isTokenActive(token)) {
      return;
    }

    const now = Date.now();
    const objects = response.data;
    const hasExtraPerson = Boolean(
      objects.extra_person_detected?.detected ||
      Number(objects.extra_person_detected?.counted_person_count || 0) > 1 ||
      Number(objects.person_count || 0) > 1 ||
      objects.suspicious_objects?.some((obj) => obj.object === "extra person detected")
    );
    const nonPersonSuspicious = (objects.suspicious_objects || []).filter(
      (obj) => obj.object !== "extra person detected"
    );
    const hasPrioritySuspiciousObject = nonPersonSuspicious.some((obj) => (
      PRIORITY_SUSPICIOUS_OBJECTS.has(obj.object)
    ));

    if (nonPersonSuspicious.length > 0) {
      streaksRef.current.objectDetected += 1;
      const cooldownElapsed =
        now - lastAlertAtRef.current.objectDetected >= OBJECT_ALERT_COOLDOWN_MS;
      const requiredObjectStreak = hasPrioritySuspiciousObject
        ? PRIORITY_OBJECT_DETECTED_STREAK_TO_ALERT
        : OBJECT_DETECTED_STREAK_TO_ALERT;

      if (
        streaksRef.current.objectDetected >= requiredObjectStreak &&
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
      lastExtraPersonDetectedAtRef.current = now;
      lastIdentityCompromisedAtRef.current = now;
      triggerMultipleFacesAlert("object", "Multiple people detected in camera view", now, token);
    } else {
      clearMultipleFacesSignal("object", now);
    }
  }, [clearMultipleFacesSignal, emitAlert, isTokenActive, triggerMultipleFacesAlert]);

  const processVerifyResult = useCallback((response, token) => {
    if (!isTokenActive(token)) {
      return;
    }

    const now = Date.now();
    const verification = response.data;
    identityStateRef.current.lastCheckAt = now;
    identityStateRef.current.reason = verification.reason || "";
    const identityCompromised = Boolean(
      verification.identity_compromised ||
      verification.multiple_faces_strict === true ||
      verification.reason === "multiple_current_faces" ||
      verification.multiple_faces
    );
    const presenceMultipleFacesPendingConfirmation = Boolean(
      verification.reason === "presence_multiple_faces_pending_confirmation" ||
      (
        verification.multiple_faces_presence_promoted === true &&
        verification.identity_compromised !== true &&
        verification.multiple_faces !== true
      )
    );
    const mismatchDetected =
      verification.verification_checked &&
      verification.verification_reliable !== false &&
      verification.event === "face_mismatch";
    const verifiedMatch =
      verification.verification_checked &&
      verification.verification_reliable !== false &&
      verification.verified === true;

    if (presenceMultipleFacesPendingConfirmation) {
      streaksRef.current.faceVerified = 0;
      identityStateRef.current.status = verification.reason || "presence_pending_confirmation";

      if (streaksRef.current.presenceMultipleFaces >= PRESENCE_MULTIPLE_FACES_CONFIRM_STREAK) {
        lastIdentityCompromisedAtRef.current = now;
        streaksRef.current.faceMismatch = FACE_MISMATCH_STREAK_TO_ALERT;
        identityStateRef.current.lastMismatchAt = now;
        identityStateRef.current.status = "compromised";
        triggerMultipleFacesAlert(
          "face",
          "Multiple faces detected in the ongoing exam camera view (confirmed across checks)",
          now,
          token
        );

        if (now - lastAlertAtRef.current.faceMismatch >= FACE_MISMATCH_ALERT_COOLDOWN_MS) {
          lastAlertAtRef.current.faceMismatch = now;
          countersRef.current.face_mismatch += 1;
          emitAlert(
            token,
            "face_mismatch",
            "high",
            "Identity continuity check failed because another person kept appearing in the ongoing exam camera view"
          );
        }
      }

      return;
    }

    if (identityCompromised) {
      lastIdentityCompromisedAtRef.current = now;
      streaksRef.current.faceMismatch = FACE_MISMATCH_STREAK_TO_ALERT;
      streaksRef.current.faceVerified = 0;
      identityStateRef.current.lastMismatchAt = now;
      identityStateRef.current.status = "compromised";
      triggerMultipleFacesAlert(
        "face",
        "Multiple faces detected in the ongoing exam camera view",
        now,
        token
      );

      if (now - lastAlertAtRef.current.faceMismatch >= FACE_MISMATCH_ALERT_COOLDOWN_MS) {
        lastAlertAtRef.current.faceMismatch = now;
        countersRef.current.face_mismatch += 1;
        emitAlert(
          token,
          "face_mismatch",
          "high",
          "Identity continuity check failed because another person was visible in the ongoing exam camera view"
        );
      }

      return;
    }

    if (mismatchDetected) {
      streaksRef.current.faceMismatch += 1;
      streaksRef.current.faceVerified = 0;
      identityStateRef.current.lastMismatchAt = now;
      identityStateRef.current.status = "mismatch";
    } else if (verifiedMatch) {
      streaksRef.current.faceVerified += 1;
      streaksRef.current.faceMismatch = 0;
      identityStateRef.current.lastVerifiedMatchAt = now;
      identityStateRef.current.status = "match";
    } else {
      decayStreak("faceMismatch");
      identityStateRef.current.status = verification.reason || "uncertain";
    }

    if (
      mismatchDetected &&
      streaksRef.current.faceMismatch >= FACE_MISMATCH_STREAK_TO_ALERT &&
      now - lastAlertAtRef.current.faceMismatch >= FACE_MISMATCH_ALERT_COOLDOWN_MS
    ) {
      lastAlertAtRef.current.faceMismatch = now;
      countersRef.current.face_mismatch += 1;
      lastIdentityCompromisedAtRef.current = now;
      emitAlert(
        token,
        "face_mismatch",
        "high",
        `Visible face does not match enrolled student (${Math.round(verification.distance * 100) / 100} distance)`
      );
    } else if (streaksRef.current.faceVerified >= FACE_MATCH_RECOVERY_STREAK) {
      streaksRef.current.faceMismatch = 0;
    }
  }, [decayStreak, emitAlert, isTokenActive, triggerMultipleFacesAlert]);

  const scheduleBackgroundTasks = useCallback((frame, token, faceState = {}, trackerPresence = {}) => {
    const now = Date.now();
    if (
      objectDetectionEnabled &&
      !objectAnalysisInFlightRef.current &&
      now - lastObjectCheckAtRef.current >= OBJECT_ANALYSIS_INTERVAL_MS
    ) {
      objectAnalysisInFlightRef.current = true;
      lastObjectCheckAtRef.current = now;

      void postMlMultipart("/objects/detect", { frame }, {
        label: "proctor.objects.detect",
        timeoutMs: 10000,
        warmup: true,
      })
        .then((response) => {
          processObjectResult(response, token);
        })
        .catch((error) => {
          if (isTokenActive(token)) {
            console.warn("ML objects check failed:", error?.mlMeta || error);
          }
        })
        .finally(() => {
          if (token === lifecycleTokenRef.current) {
            objectAnalysisInFlightRef.current = false;
          }
        });
    }

    const recentCompromiseSignal = (
      now - lastIdentityCompromisedAtRef.current <= IDENTITY_COMPROMISE_WINDOW_MS ||
      now - lastExtraPersonDetectedAtRef.current <= IDENTITY_COMPROMISE_WINDOW_MS ||
      now - lastExplicitNoFaceAtRef.current <= IDENTITY_COMPROMISE_WINDOW_MS
    );
    const effectiveVerifyIntervalMs = recentCompromiseSignal
      ? Math.min(verifyIntervalMs, IDENTITY_URGENT_VERIFY_INTERVAL_MS)
      : Math.max(verifyIntervalMs, IDENTITY_CONTINUITY_VERIFY_INTERVAL_MS);
    const shouldAttemptIdentityCheck = (
      faceVerificationEnabled &&
      hasReferenceIdentity &&
      (
        faceState.multipleFaces ||
        faceState.facePresent ||
        faceState.fallbackFacePresent ||
        trackerPresence?.facePresent ||
        recentCompromiseSignal
      )
    );
    const shouldVerifyIdentity =
      shouldAttemptIdentityCheck &&
      !verifyAnalysisInFlightRef.current &&
      Date.now() - lastIdentityCheckRef.current >= effectiveVerifyIntervalMs;

    if (!shouldVerifyIdentity) {
      return;
    }

    verifyAnalysisInFlightRef.current = true;
    lastIdentityCheckRef.current = Date.now();

    void postMlMultipart("/face/verify", {
      frame,
      ...(referenceFaceEmbedding.length > 0
        ? { reference_embedding: referenceFaceEmbedding }
        : referenceFace
        ? { reference: referenceFace }
        : {}),
    }, {
      label: "proctor.face.verify",
      timeoutMs: 12000,
      warmup: true,
    })
      .then((response) => {
        processVerifyResult(response, token);
      })
      .catch((error) => {
        if (isTokenActive(token)) {
          console.warn("ML verify check failed:", error?.mlMeta || error);
        }
      })
      .finally(() => {
        if (token === lifecycleTokenRef.current) {
          verifyAnalysisInFlightRef.current = false;
        }
      });
  }, [
    faceVerificationEnabled,
    hasReferenceIdentity,
    isTokenActive,
    objectDetectionEnabled,
    processObjectResult,
    processVerifyResult,
    referenceFace,
    referenceFaceEmbedding,
    verifyIntervalMs,
  ]);

  const deriveTrackerFacePresence = useCallback((headResult) => {
    const headData = headResult?.status === "fulfilled" ? headResult.value.data : null;
    const headStable = Boolean(
      headData?.head_detected &&
      Number(headData?.pose_quality || 0) >= 0.5
    );

    return {
      facePresent: Boolean(headStable),
      stable: Boolean(headStable),
      weak: Boolean(headData?.head_detected && !headStable),
    };
  }, []);

  const analyzeFrame = useCallback(async () => {
    const token = lifecycleTokenRef.current;
    if (!isTokenActive(token) || !examId || !visualMonitoringEnabled) {
      return;
    }

    if (criticalAnalysisInFlightRef.current) {
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

      const criticalRequests = [
        ...(faceDetectionEnabled
          ? [{
              key: "face",
              promise: postMlMultipart("/face/detect", { frame }, {
                label: "proctor.face.detect",
                timeoutMs: 10000,
                warmup: true,
              }),
            }]
          : []),
        ...(headMovementEnabled
          ? [{
              key: "head",
              promise: postMlMultipart("/head/analyze", {
                frame,
                baseline: headPoseBaseline,
                tracker_id: sessionId || examId || "default",
              }, {
                label: "proctor.head.analyze",
                timeoutMs: 10000,
                warmup: true,
              }),
            }]
          : []),
      ];

      const criticalResults = await Promise.allSettled(
        criticalRequests.map((request) => request.promise)
      );
      const criticalResultMap = Object.fromEntries(
        criticalRequests.map((request, index) => [request.key, criticalResults[index]])
      );
      const faceRes = criticalResultMap.face ?? null;
      const headRes = criticalResultMap.head ?? null;

      criticalResults.forEach((result, index) => {
        if (result.status === "rejected") {
          if (isTokenActive(token)) {
            console.warn(
              `ML ${criticalRequests[index].key} check failed:`,
              result.reason?.mlMeta || result.reason?.message || result.reason
            );
          }
        }
      });

      const criticalCompletedCount = [faceRes, headRes].filter(
        (result) => result?.status === "fulfilled"
      ).length;
      const now = Date.now();

      if (criticalRequests.length > 0 && criticalCompletedCount === 0) {
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
      refreshMultipleFacesState(now);
      const trackerPresence = deriveTrackerFacePresence(headRes);
      refreshRecentHeadPoseState(headRes, now);
      const faceState = faceDetectionEnabled
        ? processFaceResult(faceRes, now, trackerPresence, token)
        : {
            faceDetectorAvailable: false,
            faceDetected: false,
            facePresent: trackerPresence.facePresent,
            noFace: false,
            weakFace: trackerPresence.weak,
            fallbackFacePresent: false,
            detectorNoFace: false,
            identityMismatchVisible: false,
            faceConfidence: 0,
            faceAreaRatio: 0,
            multipleFaces: false,
          };
      processHeadResult(headRes, now, faceState, token);
      scheduleBackgroundTasks(frame, token, faceState, trackerPresence);
    } catch (err) {
      if (isTokenActive(token)) {
        console.warn("ML analysis failed:", err?.mlMeta || err?.message || err);
      }
    } finally {
      if (token === lifecycleTokenRef.current) {
        criticalAnalysisInFlightRef.current = false;
      }
    }
  }, [
    examId,
    captureFrame,
    deriveTrackerFacePresence,
    emitAlert,
    faceDetectionEnabled,
    headMovementEnabled,
    headPoseBaseline,
    isTokenActive,
    onMlFrame,
    processFaceResult,
    processHeadResult,
    refreshRecentHeadPoseState,
    refreshMultipleFacesState,
    scheduleBackgroundTasks,
    visualMonitoringEnabled,
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

  const getCounters = useCallback(() => {
    return { ...countersRef.current };
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || !visualMonitoringEnabled) return;
    lifecycleTokenRef.current += 1;
    identityStateRef.current = {
      lastVerifiedMatchAt: hasReferenceIdentity ? Date.now() : 0,
      lastMismatchAt: 0,
      lastCheckAt: 0,
      status: hasReferenceIdentity ? "startup_grace" : "unknown",
      reason: "",
    };

    void analyzeFrame();
    intervalRef.current = setInterval(analyzeFrame, intervalMs);

    return () => {
      lifecycleTokenRef.current += 1;
      if (intervalRef.current) clearInterval(intervalRef.current);
      criticalAnalysisInFlightRef.current = false;
      objectAnalysisInFlightRef.current = false;
      verifyAnalysisInFlightRef.current = false;
      lastObjectCheckAtRef.current = 0;
      lastIdentityCheckRef.current = 0;
      lastExplicitFaceDetectedAtRef.current = 0;
      lastExplicitNoFaceAtRef.current = 0;
      lastValidHeadPoseAtRef.current = 0;
      lastDownwardHeadPoseSignalAtRef.current = 0;
      lastIdentityCompromisedAtRef.current = 0;
      lastExtraPersonDetectedAtRef.current = 0;
      analysisCycleRef.current = 0;
      lastMultipleFacesDecayAtRef.current = 0;
      identityStateRef.current = {
        lastVerifiedMatchAt: 0,
        lastMismatchAt: 0,
        lastCheckAt: 0,
        status: "unknown",
        reason: "",
      };
      noFrameStreakRef.current = 0;
      multipleFacesSourcesRef.current = {
        face: {
          lastPositiveAt: 0,
          lastPulseAt: 0,
        },
        object: {
          lastPositiveAt: 0,
          lastPulseAt: 0,
        },
      };
      activeFlagsRef.current = {
        faceMissing: false,
        multipleFaces: false,
        headTurned: false,
        objectDetected: false,
        cameraFrameUnavailable: false,
      };
      streaksRef.current = {
        noFace: 0,
        facePresent: 0,
        multipleFaces: 0,
        presenceMultipleFaces: 0,
        headTurned: 0,
        headTurnRecovery: 0,
        objectDetected: 0,
        faceMismatch: 0,
        faceVerified: 0,
      };
    };
  }, [enabled, sessionId, analyzeFrame, hasReferenceIdentity, intervalMs, visualMonitoringEnabled]);

  return {
    incrementTabSwitch,
    incrementFullscreenExit,
    incrementAudioDetected,
    incrementFaceMismatch,
    getCounters,
    captureFrame,
  };
};

export default useProctor;
