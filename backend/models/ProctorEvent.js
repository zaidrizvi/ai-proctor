import mongoose from "mongoose";

const proctorEventSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamSession",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    eventType: {
      type: String,
      enum: [
        "face_not_detected",
        "multiple_faces",
        "head_turned",
        "audio_detected",
        "object_detected",
        "tab_switch",
        "fullscreen_exit",
        "face_mismatch",
        "ml_service_unavailable",
        "camera_frame_unavailable",
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    description: {
      type: String,
      default: "",
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    // optional snapshot at time of event
    snapshotUrl: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const ProctorEvent = mongoose.model("ProctorEvent", proctorEventSchema);
export default ProctorEvent;
