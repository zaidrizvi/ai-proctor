const DEFAULT_PROCTOR_SETTINGS = {
  faceDetection: true,
  faceVerification: true,
  objectDetection: true,
  audioDetection: true,
  headMovement: true,
  suspicionThreshold: 70,
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

const normalizeSuspicionThreshold = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_PROCTOR_SETTINGS.suspicionThreshold;
  }

  return Math.min(100, Math.max(0, Math.round(numericValue)));
};

export const normalizeExamProctorSettings = (rawSettings = {}) => {
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
    suspicionThreshold: normalizeSuspicionThreshold(source.suspicionThreshold),
  };
};

export const getExamProctorSettings = (exam) =>
  normalizeExamProctorSettings(exam?.proctorSettings);

export const withNormalizedProctorSettings = (exam) => {
  if (!exam) {
    return exam;
  }

  const plainExam = typeof exam.toObject === "function" ? exam.toObject() : { ...exam };
  plainExam.proctorSettings = normalizeExamProctorSettings(plainExam.proctorSettings);
  return plainExam;
};

