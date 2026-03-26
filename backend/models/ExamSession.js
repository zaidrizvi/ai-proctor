import mongoose from "mongoose";

const answerSchema = new mongoose.Schema({
  questionIndex: { type: Number, required: true },
  selectedOption: { type: Number, default: null }, // null = unanswered
  isCorrect: { type: Boolean, default: false },
  answeredAt: { type: Date, default: Date.now },
});

const examSessionSchema = new mongoose.Schema(
  {
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["ongoing", "completed", "terminated", "abandoned"],
      default: "ongoing",
    },
    answers: [answerSchema],
    currentQuestionIndex: {
      type: Number,
      default: 0,
      min: 0,
    },
    score: {
      type: Number,
      default: 0,
    },
    percentage: {
      type: Number,
      default: 0,
    },
    passed: {
      type: Boolean,
      default: false,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    // proctor related
    suspicionScore: {
      type: Number,
      default: 0, // 0-100, calculated at end
    },
    flaggedEventsCount: {
      type: Number,
      default: 0,
    },
    tabSwitchCount: {
      type: Number,
      default: 0,
    },
    faceNotDetectedCount: {
      type: Number,
      default: 0,
    },
    verificationFaceImagePath: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// prevent a student from having 2 ongoing sessions for same exam
examSessionSchema.index({ exam: 1, student: 1 }, { unique: true });

const ExamSession = mongoose.model("ExamSession", examSessionSchema);
export default ExamSession;
