const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") return value.toString();
  return "";
};

export const examOwnedBy = (exam, userId) => {
  if (!exam?.createdBy || !userId) return false;
  return normalizeId(exam.createdBy) === normalizeId(userId);
};

export const studentCanAccessExam = (exam, user) => {
  if (!exam || !user) return false;

  const allowedStudents = Array.isArray(exam.allowedStudents) ? exam.allowedStudents : [];
  if (allowedStudents.length > 0) {
    return allowedStudents.some((studentId) => normalizeId(studentId) === normalizeId(user._id || user.id));
  }

  return Boolean(user.batch) && exam.batch === user.batch;
};

export const getStudentExamAccessError = (
  exam,
  user,
  { requireWindow = true, requireActive = true } = {}
) => {
  if (!exam) {
    return { status: 404, message: "Exam not found" };
  }

  if (requireActive && !exam.isActive) {
    return { status: 404, message: "Exam not found or inactive" };
  }

  if (!studentCanAccessExam(exam, user)) {
    return { status: 403, message: "This exam is not assigned to you" };
  }

  if (!requireWindow) {
    return null;
  }

  const now = Date.now();

  if (exam.scheduledAt && new Date(exam.scheduledAt).getTime() > now) {
    return { status: 403, message: "Exam is not available yet" };
  }

  if (exam.expiresAt && new Date(exam.expiresAt).getTime() <= now) {
    return { status: 403, message: "Exam availability window has ended" };
  }

  return null;
};

export const validateExamSchedule = (scheduledAt, expiresAt) => {
  const parsedScheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  const parsedExpiresAt = expiresAt ? new Date(expiresAt) : null;

  if (parsedScheduledAt && Number.isNaN(parsedScheduledAt.getTime())) {
    return { valid: false, message: "scheduledAt must be a valid date" };
  }

  if (parsedExpiresAt && Number.isNaN(parsedExpiresAt.getTime())) {
    return { valid: false, message: "expiresAt must be a valid date" };
  }

  if (parsedScheduledAt && parsedExpiresAt && parsedExpiresAt <= parsedScheduledAt) {
    return { valid: false, message: "expiresAt must be after scheduledAt" };
  }

  return {
    valid: true,
    scheduledAt: parsedScheduledAt,
    expiresAt: parsedExpiresAt,
  };
};

const EVENT_PROCTOR_SETTING_MAP = {
  face_not_detected: "faceDetection",
  multiple_faces: "faceDetection",
  face_mismatch: "faceDetection",
  gaze_away: "gazeTracking",
  head_turned: "headPoseDetection",
  audio_detected: "audioMonitoring",
  object_detected: "objectDetection",
  tab_switch: null,
  fullscreen_exit: null,
  ml_service_unavailable: null,
};

export const isProctorEventEnabled = (exam, eventType) => {
  const settingKey = EVENT_PROCTOR_SETTING_MAP[eventType];
  if (!settingKey) return true;

  const settings = exam?.proctorSettings || {};
  if (settings[settingKey] === undefined) return true;
  return Boolean(settings[settingKey]);
};
