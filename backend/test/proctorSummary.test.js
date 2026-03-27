import test from "node:test";
import assert from "node:assert/strict";

import { summarizeProctorEvents } from "../utils/proctorSummary.js";

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
