import express from "express";
import {
  createExam,
  getExams,
  getExamById,
  getMyExamSession,
  updateExam,
  deleteExam,
  startExam,
  saveExamProgress,
  submitExam,
  getExamSessions,
} from "../controllers/examController.js";
import protect from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/create", protect, adminOnly, createExam);
router.get("/", protect, getExams);
router.get("/:id/session", protect, getMyExamSession);
router.get("/:id", protect, getExamById);
router.put("/:id", protect, adminOnly, updateExam);
router.delete("/:id", protect, adminOnly, deleteExam);

router.post("/:id/start", protect, startExam);
router.post("/:id/progress", protect, saveExamProgress);
router.post("/:id/submit", protect, submitExam);
router.get("/:id/sessions", protect, adminOnly, getExamSessions);

export default router;
