const DEFAULT_PROCTOR_SETTINGS = {
  faceDetection: true,
  faceVerification: true,
  gazeTracking: false,
  objectDetection: true,
  audioDetection: true,
  headMovement: true,
};

const isBoolean = (value) => typeof value === "boolean";

const firstBoolean = (...values) => {
  for (const value of values) {
    if (isBoolean(value)) {
      return value;
    }
  }

  return undefined;
};

export const resolveExamProctorSettings = (rawSettings = {}) => {
  const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const faceDetection = firstBoolean(
    source.faceDetection,
    DEFAULT_PROCTOR_SETTINGS.faceDetection
  );

  return {
    faceDetection,
    faceVerification: firstBoolean(
      source.faceVerification,
      source.faceDetection,
      DEFAULT_PROCTOR_SETTINGS.faceVerification
    ),
    gazeTracking: firstBoolean(
      source.gazeTracking,
      DEFAULT_PROCTOR_SETTINGS.gazeTracking
    ),
    objectDetection: firstBoolean(
      source.objectDetection,
      DEFAULT_PROCTOR_SETTINGS.objectDetection
    ),
    audioDetection: firstBoolean(
      source.audioDetection,
      source.audioMonitoring,
      DEFAULT_PROCTOR_SETTINGS.audioDetection
    ),
    headMovement: firstBoolean(
      source.headMovement,
      source.headPoseDetection,
      DEFAULT_PROCTOR_SETTINGS.headMovement
    ),
  };
};

export const isProctorEventEnabled = (settings, eventType) => {
  const normalized = resolveExamProctorSettings(settings);
  const eventMap = {
    face_not_detected: normalized.faceDetection,
    multiple_faces: normalized.faceDetection,
    face_mismatch: normalized.faceVerification,
    gaze_away: normalized.gazeTracking,
    head_turned: normalized.headMovement,
    audio_detected: normalized.audioDetection,
    object_detected: normalized.objectDetection,
    camera_frame_unavailable:
      normalized.faceDetection ||
      normalized.faceVerification ||
      normalized.gazeTracking ||
      normalized.headMovement ||
      normalized.objectDetection,
  };

  if (!Object.prototype.hasOwnProperty.call(eventMap, eventType)) {
    return true;
  }

  return Boolean(eventMap[eventType]);
};

export const isVisualProctoringEnabled = (settings) => {
  const normalized = resolveExamProctorSettings(settings);
  return Boolean(
    normalized.faceDetection ||
      normalized.faceVerification ||
      normalized.gazeTracking ||
      normalized.headMovement ||
      normalized.objectDetection
  );
};
