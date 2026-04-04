import ProctorEvent from "../models/ProctorEvent.js";
import ExamSession from "../models/ExamSession.js";
import Exam from "../models/Exam.js";
import { examOwnedBy, isProctorEventEnabled } from "../utils/examPolicy.js";
import { syncSessionProctorSummary } from "../utils/proctorSummary.js";

const filterVisibleEvents = (events = []) =>
  events.filter((event) => event?.eventType !== "gaze_away");

// @desc    Log a proctor event (called from frontend during exam)
// @route   POST /api/proctor/event
export const logEvent = async (req, res) => {
  try {
    const { sessionId, examId, eventType, severity, description, snapshotUrl } =
      req.body;

    if (!sessionId || !examId || !eventType) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Only students can log proctor events" });
    }

    const session = await ExamSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized for this session" });
    }

    if (session.exam.toString() !== examId) {
      return res.status(400).json({ message: "Session does not belong to this exam" });
    }

    if (session.status !== "ongoing") {
      return res.status(400).json({ message: "Cannot log proctor events for an inactive session" });
    }

    const exam = await Exam.findById(examId).select("proctorSettings");
    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    if (!isProctorEventEnabled(exam, eventType)) {
      return res.status(400).json({ message: "This proctoring signal is disabled for the exam" });
    }

    const event = await ProctorEvent.create({
      session: sessionId,
      student: req.user._id,
      exam: examId,
      eventType,
      severity: severity || "medium",
      description: description || "",
      snapshotUrl: snapshotUrl || "",
    });

    const summary = await syncSessionProctorSummary(sessionId);

    // emit real time alert to invigilator via socket
    const io = req.app.get("io");
    if (io) {
      io.to(`exam-${examId}`).emit("receive-alert", {
        examId,
        userId: req.user._id,
        studentName: req.user.name,
        event: {
          eventType,
          severity,
          description,
          timestamp: event.timestamp,
        },
      });

      io.to(`exam-${examId}`).emit("receive-suspicion", {
        examId,
        userId: req.user._id,
        studentName: req.user.name,
        score: summary.suspicionScore,
        breakdown: summary.eventCounts,
      });
    }

    res.status(201).json({
      message: "Event logged",
      event,
      summary,
    });
  } catch (error) {
    console.error("Log event error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get all proctor events for a session
// @route   GET /api/proctor/session/:sessionId
export const getSessionEvents = async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.sessionId)
      .populate("exam", "createdBy")
      .populate("student", "_id");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const isAdminOwner =
      req.user.role === "admin" &&
      examOwnedBy(session.exam, req.user._id);

    if (!isAdminOwner) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const events = filterVisibleEvents(await ProctorEvent.find({
      session: req.params.sessionId,
    }).sort({ timestamp: 1 }));

    await syncSessionProctorSummary(session._id);
    res.json(events);
  } catch (error) {
    console.error("Get session events error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get all events for an exam (admin view)
// @route   GET /api/proctor/exam/:examId
export const getExamEvents = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.examId).select("createdBy");
    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    if (!examOwnedBy(exam, req.user._id)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const events = filterVisibleEvents(await ProctorEvent.find({ exam: req.params.examId })
      .populate("student", "name email")
      .sort({ timestamp: 1 }));

    res.json(events);
  } catch (error) {
    console.error("Get exam events error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Terminate a student session (admin kicks student)
// @route   POST /api/proctor/terminate/:sessionId
export const terminateSession = async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.sessionId).populate(
      "student",
      "name"
    );

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const exam = await Exam.findById(session.exam).select("createdBy");
    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    if (!examOwnedBy(exam, req.user._id)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (session.status !== "ongoing") {
      return res.status(400).json({ message: "Only ongoing sessions can be terminated" });
    }

    session.status = "terminated";
    session.submittedAt = new Date();
    await session.save();

    // notify the student their session was terminated
    const io = req.app.get("io");
    if (io) {
      io.to(`exam-${session.exam}`).emit("session-terminated", {
        examId: session.exam.toString(),
        userId: session.student._id,
        message: "Your exam session has been terminated by the invigilator.",
      });
    }

    res.json({ message: `Session terminated for ${session.student.name}` });
  } catch (error) {
    console.error("Terminate session error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const saveVerificationFace = async (req, res) => {
  try {
    const { sessionId, verificationFaceImage } = req.body;

    if (!sessionId || !verificationFaceImage) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (
      typeof verificationFaceImage !== "string" ||
      !verificationFaceImage.startsWith("data:image/")
    ) {
      return res.status(400).json({ message: "Verification face must be a valid image data URL" });
    }

    if (verificationFaceImage.length > 1_500_000) {
      return res.status(400).json({ message: "Verification face image is too large" });
    }

    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Only students can save verification faces" });
    }

    const session = await ExamSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (session.status !== "ongoing") {
      return res.status(400).json({ message: "Verification face can only be saved for an ongoing session" });
    }

    session.verificationFaceImagePath = verificationFaceImage;
    await session.save();

    res.json({
      message: "Verification face saved",
      verificationFaceImagePath: session.verificationFaceImagePath,
    });
  } catch (error) {
    console.error("Save verification face error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
