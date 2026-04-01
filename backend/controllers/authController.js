import User from "../models/User.js";
import Batch from "../models/Batch.js";
import generateToken from "../utils/generateToken.js";
import { isValidBatchCode, normalizeBatchCode } from "../utils/batchCode.js";

const buildAuthResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  batch: user.batch,
  hasFaceReference: Boolean(user.faceImagePath),
  token: generateToken(user._id, user.role),
});

const registerAccount = async (req, res, enforcedRole) => {
  const { name, email, password } = req.body;
  const role = enforcedRole;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Please fill all fields" });
  }

  const userExists = await User.findOne({ email });
  if (userExists) {
    return res.status(400).json({ message: "Email already registered" });
  }

  let resolvedBatchName = "";

  if (role === "student") {
    const batchCode = normalizeBatchCode(req.body.batchCode ?? req.body.batch_code);

    if (!isValidBatchCode(batchCode)) {
      return res.status(400).json({ message: "Enter a valid 6-digit batch code" });
    }

    const batch = await Batch.findOne({
      batchCode,
      isActive: true,
    }).select("name");

    if (!batch) {
      return res.status(400).json({ message: "Invalid batch code" });
    }

    resolvedBatchName = batch.name;
  }

  const user = await User.create({
    name,
    email,
    password,
    role,
    batch: role === "student" ? resolvedBatchName : "",
  });

  res.status(201).json(buildAuthResponse(user));
};

// @desc    Register new user
// @route   POST /api/auth/register/student
export const registerStudentUser = async (req, res) => {
  try {
    await registerAccount(req, res, "student");
  } catch (error) {
    console.error("Student register error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Register new admin user
// @route   POST /api/auth/register/admin
export const registerAdminUser = async (req, res) => {
  try {
    await registerAccount(req, res, "admin");
  } catch (error) {
    console.error("Admin register error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Please fill all fields" });
    }

    // need +password because we set select:false on the model
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json(buildAuthResponse(user));
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get logged in user profile
// @route   GET /api/auth/me
export const getMe = async (req, res) => {
  try {
    // req.user is set by auth middleware
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      batch: user.batch,
      faceImagePath: user.faceImagePath,
      faceEmbedding: user.faceEmbedding || [],
      hasFaceReference: Boolean(user.faceImagePath),
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error("GetMe error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Save or replace the logged-in user's reference face image
// @route   POST /api/auth/face-reference
export const saveFaceReference = async (req, res) => {
  try {
    const { faceImage, faceEmbedding } = req.body;

    if (typeof faceImage !== "string" || !faceImage.trim()) {
      return res.status(400).json({ message: "Reference face image is required" });
    }

    if (!faceImage.startsWith("data:image/")) {
      return res.status(400).json({ message: "Reference face must be a valid image data URL" });
    }

    if (faceImage.length > 1_500_000) {
      return res.status(400).json({ message: "Reference face image is too large" });
    }

    if (
      faceEmbedding !== undefined &&
      (
        !Array.isArray(faceEmbedding) ||
        faceEmbedding.length === 0 ||
        !faceEmbedding.every((value) => Number.isFinite(value))
      )
    ) {
      return res.status(400).json({ message: "Reference face embedding must be a numeric array" });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        faceImagePath: faceImage,
        faceEmbedding:
          Array.isArray(faceEmbedding) && faceEmbedding.length > 0 ? faceEmbedding : undefined,
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Reference face saved",
      faceImagePath: user.faceImagePath,
      faceEmbedding: user.faceEmbedding || [],
      hasFaceReference: Boolean(user.faceImagePath),
    });
  } catch (error) {
    console.error("Save face reference error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
