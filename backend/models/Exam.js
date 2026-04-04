import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: {
    type: [String],
    validate: [arr => arr.length === 4, "Exactly 4 options required"],
  },
  correctAnswer: { type: Number, required: true }, // index 0-3
  explanation: { type: String, default: "" },
});

const examSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Exam title is required"],
      trim: true,
    },
    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    topic: {
      type: String,
      default: "",
      trim: true,
    },
    creationMode: {
      type: String,
      enum: ["ai", "manual"],
      default: "ai",
    },
    batch: {
      type: String,
      required: [true, "Batch is required"],
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    questions: [questionSchema],
    duration: {
      type: Number, // in minutes
      required: [true, "Duration is required"],
      min: 1,
    },
    totalMarks: {
      type: Number,
      default: function () {
        return this.questions.length; // 1 mark per question
      },
    },
    passingMarks: {
      type: Number,
      default: function () {
        return Math.ceil(this.questions.length * 0.4); // 40% passing
      },
    },
    scheduledAt: {
      type: Date,
      default: null, // null = available immediately
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    allowedStudents: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ], // empty = open to all students
    proctorSettings: {
      faceDetection: { type: Boolean, default: true },
      faceVerification: { type: Boolean, default: true },
      objectDetection: { type: Boolean, default: true },
      audioDetection: { type: Boolean, default: true },
      headMovement: { type: Boolean, default: true },
      // Legacy aliases kept only so older documents can still be read safely.
      gazeTracking: { type: Boolean, default: undefined },
      audioMonitoring: { type: Boolean, default: undefined },
      headPoseDetection: { type: Boolean, default: undefined },
      suspicionThreshold: { type: Number, default: 70 }, // 0-100
    },
  },
  { timestamps: true }
);

const Exam = mongoose.model("Exam", examSchema);
export default Exam;
