import ExamSession from "../models/ExamSession.js";
import ProctorEvent from "../models/ProctorEvent.js";

const SCORING_VERSION = "v2";
const WINDOW_SIZE_MS = 20_000;

const SEVERITY_FACTORS = {
  low: 0.75,
  medium: 1,
  high: 1.35,
};

const EVENT_SCORING_RULES = {
  face_not_detected: {
    weight: 0.15,
    severityScale: 2.1,
    mergeWindowMs: 6_000,
    group: "identity",
  },
  multiple_faces: {
    weight: 0.3,
    severityScale: 1.2,
    mergeWindowMs: 12_000,
    group: "identity",
  },
  face_mismatch: {
    weight: 0.42,
    severityScale: 0.8,
    mergeWindowMs: 45_000,
    group: "identity",
  },
  object_detected: {
    weight: 0.2,
    severityScale: 1.35,
    mergeWindowMs: 12_000,
    group: "environment",
  },
  fullscreen_exit: {
    weight: 0.15,
    severityScale: 1.4,
    mergeWindowMs: 4_000,
    group: "behavior",
  },
  tab_switch: {
    weight: 0.14,
    severityScale: 2.2,
    mergeWindowMs: 2_500,
    group: "behavior",
  },
  gaze_away: {
    weight: 0.05,
    severityScale: 2.6,
    mergeWindowMs: 8_000,
    group: "attention",
  },
  head_turned: {
    weight: 0.06,
    severityScale: 3.1,
    mergeWindowMs: 8_000,
    group: "attention",
  },
  audio_detected: {
    weight: 0.1,
    severityScale: 2.4,
    mergeWindowMs: 15_000,
    group: "environment",
  },
  ml_service_unavailable: {
    weight: 0,
    severityScale: 1,
    mergeWindowMs: 30_000,
    group: "system",
  },
};

const DEFAULT_COUNTS = {
  flaggedEventsCount: 0,
  tabSwitchCount: 0,
  faceNotDetectedCount: 0,
  suspicionScore: 0,
  eventCounts: {},
  incidentCounts: {},
  mlUnavailableCount: 0,
  scoringVersion: SCORING_VERSION,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getSeverityFactor = (severity) => SEVERITY_FACTORS[severity] || SEVERITY_FACTORS.medium;

const getTimestampMs = (value) => {
  const resolved = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(resolved) ? resolved : 0;
};

const countByEventType = (events = []) =>
  events.reduce((counts, event) => {
    const key = event?.eventType;
    if (!key) {
      return counts;
    }

    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

const collapseEventsIntoIncidents = (events = []) => {
  const incidentsByType = {};

  events
    .filter((event) => event?.eventType)
    .sort((left, right) => getTimestampMs(left?.timestamp) - getTimestampMs(right?.timestamp))
    .forEach((event) => {
      const eventType = event.eventType;
      const rule = EVENT_SCORING_RULES[eventType];
      if (!rule) {
        return;
      }

      const timestampMs = getTimestampMs(event.timestamp);
      const severityFactor = getSeverityFactor(event.severity);
      const typedIncidents = incidentsByType[eventType] || [];
      const lastIncident = typedIncidents[typedIncidents.length - 1];

      if (
        lastIncident &&
        timestampMs - lastIncident.endTimestampMs <= rule.mergeWindowMs
      ) {
        lastIncident.endTimestampMs = timestampMs;
        lastIncident.rawCount += 1;
        lastIncident.maxSeverityFactor = Math.max(lastIncident.maxSeverityFactor, severityFactor);
        return;
      }

      typedIncidents.push({
        eventType,
        group: rule.group,
        startTimestampMs: timestampMs,
        endTimestampMs: timestampMs,
        rawCount: 1,
        maxSeverityFactor: severityFactor,
      });

      incidentsByType[eventType] = typedIncidents;
    });

  return incidentsByType;
};

const countIncidents = (incidentsByType = {}) =>
  Object.fromEntries(
    Object.entries(incidentsByType).map(([eventType, incidents]) => [eventType, incidents.length])
  );

const flattenIncidents = (incidentsByType = {}) =>
  Object.values(incidentsByType)
    .flat()
    .sort((left, right) => left.startTimestampMs - right.startTimestampMs);

const calculateSignalStrength = (incidents = [], rule, { includePersistenceBoost = true } = {}) => {
  if (!rule || !incidents.length || rule.weight <= 0) {
    return 0;
  }

  const weightedCount = incidents.reduce(
    (sum, incident) =>
      sum +
      incident.maxSeverityFactor +
      Math.min(0.8, Math.max(0, incident.rawCount - 1) * 0.15),
    0
  );
  const baseStrength = 1 - Math.exp(-weightedCount / rule.severityScale);
  const persistenceBoost = includePersistenceBoost
    ? Math.min(0.18, Math.max(0, incidents.length - 1) * 0.06)
    : 0;

  return clamp(baseStrength + persistenceBoost, 0, 1.35);
};

const calculateRiskFromIncidents = (
  incidentsByType = {},
  { includePersistenceBoost = true } = {}
) => {
  const signalStrengths = {};
  let remainingSafeProbability = 1;

  Object.entries(EVENT_SCORING_RULES).forEach(([eventType, rule]) => {
    if (rule.weight <= 0) {
      return;
    }

    const strength = calculateSignalStrength(
      incidentsByType[eventType] || [],
      rule,
      { includePersistenceBoost }
    );

    signalStrengths[eventType] = strength;
    const weightedContribution = clamp(rule.weight * strength, 0, 0.98);
    remainingSafeProbability *= 1 - weightedContribution;
  });

  return {
    score: clamp((1 - remainingSafeProbability) * 100, 0, 100),
    signalStrengths,
  };
};

const groupIncidentsIntoWindows = (incidents = []) => {
  if (!incidents.length) {
    return [];
  }

  const startTime = incidents[0].startTimestampMs;
  const windows = new Map();

  incidents.forEach((incident) => {
    const windowIndex = Math.floor((incident.startTimestampMs - startTime) / WINDOW_SIZE_MS);
    const typedIncidents = windows.get(windowIndex) || {};

    if (!typedIncidents[incident.eventType]) {
      typedIncidents[incident.eventType] = [];
    }

    typedIncidents[incident.eventType].push(incident);
    windows.set(windowIndex, typedIncidents);
  });

  return Array.from(windows.values());
};

const calculatePeakWindowScore = (incidents = []) => {
  const windows = groupIncidentsIntoWindows(incidents);
  if (!windows.length) {
    return 0;
  }

  const windowScores = windows
    .map((windowIncidents) =>
      calculateRiskFromIncidents(windowIncidents, { includePersistenceBoost: false }).score
    )
    .sort((left, right) => left - right);

  const percentileIndex = Math.max(0, Math.ceil(windowScores.length * 0.9) - 1);
  return windowScores[percentileIndex];
};

const calculateCoordinationBonus = (incidents = []) => {
  const windows = groupIncidentsIntoWindows(incidents);
  let bestBonus = 0;

  windows.forEach((windowIncidents) => {
    const eventTypes = Object.keys(windowIncidents);
    if (!eventTypes.length) {
      return;
    }

    let bonus = 0;

    if (eventTypes.length >= 3) {
      bonus += 8;
    } else if (eventTypes.length >= 2) {
      bonus += 4;
    }

    if (
      eventTypes.includes("face_mismatch") &&
      eventTypes.includes("multiple_faces")
    ) {
      bonus += 6;
    }

    if (
      eventTypes.includes("object_detected") &&
      eventTypes.includes("audio_detected")
    ) {
      bonus += 3;
    }

    bestBonus = Math.max(bestBonus, bonus);
  });

  return Math.min(12, bestBonus);
};

const calculateSuspicionScore = (events = []) => {
  const incidentsByType = collapseEventsIntoIncidents(events);
  const incidents = flattenIncidents(incidentsByType);

  if (!incidents.length) {
    return {
      score: 0,
      incidentCounts: countIncidents(incidentsByType),
      signalStrengths: {},
    };
  }

  const overallRisk = calculateRiskFromIncidents(incidentsByType, {
    includePersistenceBoost: true,
  });
  const peakWindowScore = calculatePeakWindowScore(incidents);
  const coordinationBonus = calculateCoordinationBonus(incidents);

  const score = clamp(
    Math.round((overallRisk.score * 0.72) + (peakWindowScore * 0.28) + coordinationBonus),
    0,
    100
  );

  return {
    score,
    incidentCounts: countIncidents(incidentsByType),
    signalStrengths: overallRisk.signalStrengths,
  };
};

export const summarizeProctorEvents = (events = []) => {
  const eventCounts = countByEventType(events);
  const suspicion = calculateSuspicionScore(events);

  return {
    ...DEFAULT_COUNTS,
    flaggedEventsCount: events.length,
    tabSwitchCount: eventCounts.tab_switch || 0,
    faceNotDetectedCount: eventCounts.face_not_detected || 0,
    suspicionScore: suspicion.score,
    eventCounts,
    incidentCounts: suspicion.incidentCounts,
    mlUnavailableCount: eventCounts.ml_service_unavailable || 0,
  };
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
