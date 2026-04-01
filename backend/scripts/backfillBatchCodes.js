import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Batch from "../models/Batch.js";
import { createBatchCodeCandidate, isValidBatchCode } from "../utils/batchCode.js";

const MAX_BATCH_CODE_ATTEMPTS = 50;

const isDuplicateKeyErrorForField = (error, field) =>
  error?.code === 11000 &&
  (
    error?.keyPattern?.[field] ||
    error?.message?.includes(`${field}_1`)
  );

const assignBatchCode = async (batch) => {
  for (let attempt = 0; attempt < MAX_BATCH_CODE_ATTEMPTS; attempt += 1) {
    try {
      batch.batchCode = createBatchCodeCandidate();
      await batch.save();
      return batch.batchCode;
    } catch (error) {
      if (isDuplicateKeyErrorForField(error, "batchCode")) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Could not generate a unique batch code for batch "${batch.name}"`);
};

const run = async () => {
  try {
    await connectDB();

    const batches = await Batch.find({}).sort({ createdAt: 1 });
    const targets = batches.filter((batch) => !isValidBatchCode(batch.batchCode));

    if (targets.length === 0) {
      console.log("All batches already have valid 6-digit codes.");
      return;
    }

    for (const batch of targets) {
      const batchCode = await assignBatchCode(batch);
      console.log(`Assigned ${batchCode} to "${batch.name}"`);
    }

    console.log(`Updated ${targets.length} batch(es).`);
  } catch (error) {
    console.error("Batch code backfill failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

run();
