import ExamSession from "../models/ExamSession.js";
import ProctorEvent from "../models/ProctorEvent.js";

const EVENT_SCORING_RULES = {
  face_not_detected: { weight: 14, cap: 2, tailFactor: 0.35, group: "identity" },
  multiple_faces: { weight: 24, cap: 2, tailFactor: 0.55, group: "identity" },
  face_mismatch: { weight: 30, cap: 1, tailFactor: 0.6, group: "identity" },
  object_detected: { weight: 10, cap: 2, tailFactor: 0.3, group: "environment" },
  fullscreen_exit: { weight: 10, cap: 2, tailFactor: 0.4, group: "behavior" },
  tab_switch: { weight: 5, cap: 3, tailFactor: 0.3, group: "behavior" },
  gaze_away: { weight: 4, cap: 3, tailFactor: 0.22, group: "attention" },
  head_turned: { weight: 2, cap: 3, tailFactor: 0.12, group: "attention" },
  audio_detected: { weight: 3, cap: 2, tailFactor: 0.15, group: "environment" },
  ml_service_unavailable: { weight: 0, cap: 0, tailFactor: 0, group: "system" },
};

const DEFAULT_COUNTS = {
  flaggedEventsCount: 0,
  tabSwitchCount: 0,
  faceNotDetectedCount: 0,
  suspicionScore: 0,
  eventCounts: {},
  mlUnavailableCount: 0,
};

export const summarizeProctorEvents = (events = []) => {
  const eventCounts = events.reduce((counts, event) => {
    const key = event?.eventType;
    if (!key) {
      return counts;
    }

    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  const suspicionScore = calculateSuspicionScore(eventCounts);

  return {
    ...DEFAULT_COUNTS,
    flaggedEventsCount: events.length,
    tabSwitchCount: eventCounts.tab_switch || 0,
    faceNotDetectedCount: eventCounts.face_not_detected || 0,
    suspicionScore,
    eventCounts,
    mlUnavailableCount: eventCounts.ml_service_unavailable || 0,
  };
};

const dampCount = (count, cap = 3, tailFactor = 0.35) => {
  if (count <= cap) {
    return count;
  }

  return cap + ((count - cap) * tailFactor);
};

const calculateSuspicionScore = (eventCounts = {}) => {
  const groupedCounts = {
    identity: 0,
    behavior: 0,
    environment: 0,
    attention: 0,
  };

  const baseScore = Object.entries(eventCounts).reduce((total, [eventType, count]) => {
    const rule = EVENT_SCORING_RULES[eventType];
    if (!rule || count <= 0) {
      return total;
    }

    if (groupedCounts[rule.group] !== undefined) {
      groupedCounts[rule.group] += count;
    }

    return total + (dampCount(count, rule.cap, rule.tailFactor) * rule.weight);
  }, 0);

  let adjustedScore = baseScore;
  const severeIdentityIssues =
    (eventCounts.face_mismatch || 0) +
    (eventCounts.multiple_faces || 0);

  if ((eventCounts.face_mismatch || 0) > 0 && (eventCounts.multiple_faces || 0) > 0) {
    adjustedScore += 10;
  } else if (severeIdentityIssues > 0) {
    adjustedScore += 4;
  }

  if ((eventCounts.face_not_detected || 0) >= 3) {
    adjustedScore += 4;
  }

  if (groupedCounts.behavior >= 4) {
    adjustedScore += 3;
  }

  if ((eventCounts.object_detected || 0) > 0 && groupedCounts.environment >= 3) {
    adjustedScore += 2;
  }

  return Math.min(100, Math.round(adjustedScore));
};

export const applyProctorSummaryToSession = (session, summary) => {
  if (!session) {
    return null;
  }

  const nextSession =
    typeof session.toObject === "function" ? session.toObject() : { ...session };

  nextSession.flaggedEventsCount = summary.flaggedEventsCount;
  nextSession.tabSwitchCount = summary.tabSwitchCount;
  nextSession.faceNotDetectedCount = summary.faceNotDetectedCount;
  nextSession.suspicionScore = summary.suspicionScore;
  nextSession.mlUnavailableCount = summary.mlUnavailableCount;

  return nextSession;
};

export const syncSessionProctorSummary = async (sessionId) => {
  const events = await ProctorEvent.find({ session: sessionId }).sort({ timestamp: 1 });
  const summary = summarizeProctorEvents(events);

  await ExamSession.findByIdAndUpdate(sessionId, {
    flaggedEventsCount: summary.flaggedEventsCount,
    tabSwitchCount: summary.tabSwitchCount,
    faceNotDetectedCount: summary.faceNotDetectedCount,
    suspicionScore: summary.suspicionScore,
  });

  return summary;
};
