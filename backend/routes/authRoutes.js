import express from "express";
import {
  registerStudentUser,
  registerAdminUser,
  loginUser,
  getMe,
  saveFaceReference,
} from "../controllers/authController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register/student", registerStudentUser);
router.post("/register/admin", registerAdminUser);
router.post("/login", loginUser);
router.get("/me", protect, getMe);
router.post("/face-reference", protect, saveFaceReference);

export default router;
