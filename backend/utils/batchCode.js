import { randomInt } from "node:crypto";

export const BATCH_CODE_PATTERN = /^\d{6}$/;

export const normalizeBatchCode = (value) => String(value ?? "").trim();

export const isValidBatchCode = (value) => BATCH_CODE_PATTERN.test(normalizeBatchCode(value));

export const createBatchCodeCandidate = () => randomInt(0, 1_000_000).toString().padStart(6, "0");
