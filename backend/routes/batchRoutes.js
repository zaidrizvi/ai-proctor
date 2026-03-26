import express from "express";
import { createBatch, getBatches } from "../controllers/batchController.js";
import protect, { adminOnly } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", getBatches);
router.post("/", protect, adminOnly, createBatch);

export default router;
