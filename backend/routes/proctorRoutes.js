import express from "express";
import {
  logEvent,
  saveVerificationFace,
  getSessionEvents,
  getExamEvents,
  terminateSession,
} from "../controllers/proctorController.js";
import protect from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/event", protect, logEvent);
router.post("/verification-face", protect, saveVerificationFace);

router.get("/session/:sessionId", protect, getSessionEvents);
router.get("/exam/:examId", protect, adminOnly, getExamEvents);
router.post("/terminate/:sessionId", protect, adminOnly, terminateSession);

export default router;
