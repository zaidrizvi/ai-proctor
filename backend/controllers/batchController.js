import Batch from "../models/Batch.js";
import { createBatchCodeCandidate } from "../utils/batchCode.js";

const MAX_BATCH_CODE_ATTEMPTS = 25;

const isDuplicateKeyErrorForField = (error, field) =>
  error?.code === 11000 &&
  (
    error?.keyPattern?.[field] ||
    error?.message?.includes(`${field}_1`)
  );

const serializeBatch = (batch, includeCode = false) => {
  const payload = {
    _id: batch._id,
    name: batch.name,
    isActive: batch.isActive,
    createdBy: batch.createdBy,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };

  if (includeCode) {
    payload.batchCode = batch.batchCode;
    payload.batch_code = batch.batchCode;
  }

  return payload;
};

export const getBatches = async (req, res) => {
  try {
    const includeCode = req.user?.role === "admin";
    const batches = await Batch.find({ isActive: true })
      .select(includeCode ? "name batchCode isActive createdBy createdAt updatedAt" : "name isActive createdAt updatedAt")
      .sort({ name: 1 });

    res.json(batches.map((batch) => serializeBatch(batch, includeCode)));
  } catch (error) {
    console.error("Get batches error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const createBatch = async (req, res) => {
  try {
    const name = req.body.name?.trim();

    if (!name) {
      return res.status(400).json({ message: "Batch name is required" });
    }

    const duplicate = await Batch.findOne({ name }).collation({ locale: "en", strength: 2 });
    if (duplicate) {
      return res.status(400).json({ message: "Batch already exists" });
    }

    for (let attempt = 0; attempt < MAX_BATCH_CODE_ATTEMPTS; attempt += 1) {
      try {
        const batch = await Batch.create({
          name,
          batchCode: createBatchCodeCandidate(),
          createdBy: req.user?._id || null,
        });

        return res.status(201).json(serializeBatch(batch, true));
      } catch (error) {
        if (isDuplicateKeyErrorForField(error, "batchCode")) {
          continue;
        }

        if (isDuplicateKeyErrorForField(error, "name")) {
          return res.status(400).json({ message: "Batch already exists" });
        }

        throw error;
      }
    }

    return res.status(500).json({ message: "Could not generate a unique batch code. Please try again." });
  } catch (error) {
    console.error("Create batch error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
