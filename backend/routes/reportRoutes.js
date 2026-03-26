import express from "express";
import {
  getSessionReport,
  getExamReport,
  getMyResults,
  downloadPDFReport,
} from "../controllers/reportController.js";
import protect from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/my-results", protect, getMyResults);
router.get("/session/:sessionId", protect, getSessionReport);
router.get("/exam/:examId", protect, adminOnly, getExamReport);
router.get("/pdf/:sessionId", protect, downloadPDFReport);

export default router;