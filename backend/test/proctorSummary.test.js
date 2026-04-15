import test from "node:test";
import assert from "node:assert/strict";

import ExamSession from "../models/ExamSession.js";
import ProctorEvent from "../models/ProctorEvent.js";
import {
  summarizeProctorEvents,
  syncSessionProctorSummary,
} from "../utils/proctorSummary.js";

const baseTime = Date.parse("2026-03-26T10:00:00.000Z");

const makeEvent = (eventType, offsetMs, severity = "medium") => ({
  eventType,
  severity,
  timestamp: new Date(baseTime + offsetMs).toISOString(),
});

test("keeps raw event counts but collapses bursty object detections into one incident", () => {
  const summary = summarizeProctorEvents([
    makeEvent("object_detected", 0, "high"),
    makeEvent("object_detected", 2_000, "medium"),
  ]);

  assert.equal(summary.eventCounts.object_detected, 2);
  assert.equal(summary.incidentCounts.object_detected, 1);
});

test("scores repeated object incidents higher when they happen in separate windows", () => {
  const burstSummary = summarizeProctorEvents([
    makeEvent("object_detected", 0, "high"),
    makeEvent("object_detected", 2_000, "high"),
  ]);
  const separatedSummary = summarizeProctorEvents([
    makeEvent("object_detected", 0, "high"),
    makeEvent("object_detected", 20_000, "high"),
  ]);

  assert.ok(separatedSummary.suspicionScore > burstSummary.suspicionScore);
});

test("high-severity identity incidents score higher than low-severity ones", () => {
  const lowSummary = summarizeProctorEvents([
    makeEvent("face_mismatch", 0, "low"),
  ]);
  const highSummary = summarizeProctorEvents([
    makeEvent("face_mismatch", 0, "high"),
  ]);

  assert.ok(highSummary.suspicionScore > lowSummary.suspicionScore);
});

test("combining multiple identity signals is riskier than a single identity signal", () => {
  const singleSummary = summarizeProctorEvents([
    makeEvent("face_mismatch", 0, "high"),
  ]);
  const combinedSummary = summarizeProctorEvents([
    makeEvent("face_mismatch", 0, "high"),
    makeEvent("multiple_faces", 3_000, "high"),
  ]);

  assert.ok(combinedSummary.suspicionScore > singleSummary.suspicionScore);
});

test("system availability warnings do not increase suspicion by themselves", () => {
  const summary = summarizeProctorEvents([
    makeEvent("ml_service_unavailable", 0, "medium"),
    makeEvent("ml_service_unavailable", 35_000, "medium"),
  ]);

  assert.equal(summary.suspicionScore, 0);
  assert.equal(summary.eventCounts.ml_service_unavailable, 2);
});

test("events exactly at mergeWindowMs collapse into one incident", () => {
  const summary = summarizeProctorEvents([
    makeEvent("tab_switch", 0, "medium"),
    makeEvent("tab_switch", 2_500, "high"),
  ]);

  assert.equal(summary.eventCounts.tab_switch, 2);
  assert.equal(summary.incidentCounts.tab_switch, 1);
  assert.equal(summary.totalIncidentCount, 1);
});

test("events just over mergeWindowMs create separate incidents", () => {
  const summary = summarizeProctorEvents([
    makeEvent("tab_switch", 0, "medium"),
    makeEvent("tab_switch", 2_501, "medium"),
  ]);

  assert.equal(summary.eventCounts.tab_switch, 2);
  assert.equal(summary.incidentCounts.tab_switch, 2);
  assert.equal(summary.totalIncidentCount, 2);
});

test("merged incidents use the max severity seen within the incident", () => {
  const lowOnlySummary = summarizeProctorEvents([
    makeEvent("object_detected", 0, "low"),
    makeEvent("object_detected", 2_000, "low"),
  ]);
  const mixedSeveritySummary = summarizeProctorEvents([
    makeEvent("object_detected", 0, "low"),
    makeEvent("object_detected", 2_000, "high"),
  ]);

  assert.equal(mixedSeveritySummary.incidentCounts.object_detected, 1);
  assert.ok(mixedSeveritySummary.suspicionScore > lowOnlySummary.suspicionScore);
});

test("coordination bonus increases score for multi-signal windows", () => {
  const separateSignals = summarizeProctorEvents([
    makeEvent("object_detected", 0, "high"),
    makeEvent("audio_detected", 25_000, "high"),
  ]);
  const coordinatedSignals = summarizeProctorEvents([
    makeEvent("object_detected", 0, "high"),
    makeEvent("audio_detected", 3_000, "high"),
  ]);

  assert.ok(coordinatedSignals.suspicionScore > separateSignals.suspicionScore);
});

test("gaze incidents affect scoring and collapse within their merge window", () => {
  const summary = summarizeProctorEvents([
    makeEvent("gaze_away", 0, "medium"),
    makeEvent("gaze_away", 6_500, "high"),
  ]);

  assert.equal(summary.eventCounts.gaze_away, 2);
  assert.equal(summary.incidentCounts.gaze_away, 1);
  assert.ok(summary.suspicionScore > 0);
});

test("unknown events remain counted but do not affect scoring", () => {
  const summary = summarizeProctorEvents([
    makeEvent("unknown_signal", 0, "high"),
    makeEvent("ml_service_unavailable", 1_000, "medium"),
  ]);

  assert.equal(summary.eventCounts.unknown_signal, 1);
  assert.equal(summary.eventCounts.ml_service_unavailable, 1);
  assert.equal(summary.suspicionScore, 0);
  assert.equal(summary.totalIncidentCount, 1);
});

test("syncSessionProctorSummary persists mlUnavailableCount", async (t) => {
  t.mock.method(ProctorEvent, "find", () => ({
    sort: async () => [
      makeEvent("ml_service_unavailable", 0, "medium"),
      makeEvent("face_not_detected", 1_000, "medium"),
    ],
  }));
  const updateMock = t.mock.method(ExamSession, "findByIdAndUpdate", async () => null);

  const summary = await syncSessionProctorSummary("session-123");

  assert.equal(summary.mlUnavailableCount, 1);
  assert.equal(updateMock.mock.callCount(), 1);
  assert.deepEqual(updateMock.mock.calls[0].arguments, [
    "session-123",
    {
      flaggedEventsCount: 2,
      tabSwitchCount: 0,
      faceNotDetectedCount: 1,
      suspicionScore: summary.suspicionScore,
      totalIncidentCount: 2,
      mlUnavailableCount: 1,
    },
  ]);
});
