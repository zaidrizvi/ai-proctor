import ExamSession from "../models/ExamSession.js";
import ProctorEvent from "../models/ProctorEvent.js";
import Exam from "../models/Exam.js";
import generatePDFReport from "../utils/generateReport.js";
import { examOwnedBy } from "../utils/examPolicy.js";
import {
  applyProctorSummaryToSession,
  summarizeProctorEvents,
} from "../utils/proctorSummary.js";
import { withNormalizedProctorSettings } from "../utils/proctorSettings.js";

const filterReportEvents = (events = []) => events;

const buildStudentSafeSession = (session) => {
  const nextSession = typeof session.toObject === "function" ? session.toObject() : { ...session };
  const exam = nextSession.exam || null;
  const totalQuestions = exam?.questions?.length || Number(exam?.totalMarks || 0);

  nextSession.exam = exam
    ? {
        _id: exam._id,
        title: exam.title,
        subject: exam.subject,
        duration: exam.duration,
        passingMarks: exam.passingMarks,
        totalQuestions,
        proctorSettings: withNormalizedProctorSettings(exam).proctorSettings,
      }
    : null;

  if (nextSession.student) {
    nextSession.student = {
      _id: nextSession.student._id,
      name: nextSession.student.name,
    };
  }

  delete nextSession.answers;
  delete nextSession.verificationFaceImagePath;

  return nextSession;
};

// @desc    Get full report for a session
// @route   GET /api/reports/session/:sessionId
export const getSessionReport = async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.sessionId)
      .populate("student", "name email faceImagePath")
      .populate("exam");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // students can only see their own report
    if (
      req.user.role === "student" &&
      session.student._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (req.user.role === "admin" && !examOwnedBy(session.exam, req.user._id)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const events = filterReportEvents(await ProctorEvent.find({
      session: session._id,
    }).sort({ timestamp: 1 }));

    const summary = summarizeProctorEvents(events);
    const summarizedSession = applyProctorSummaryToSession(session, summary);

    if (req.user.role === "student") {
      return res.json({
        session: buildStudentSafeSession(summarizedSession),
        events: [],
      });
    }

    res.json({
      session: summarizedSession,
      events,
    });
  } catch (error) {
    console.error("Get report error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get all session reports for an exam (admin)
// @route   GET /api/reports/exam/:examId
export const getExamReport = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.examId);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    if (!examOwnedBy(exam, req.user._id)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const sessions = await ExamSession.find({ exam: req.params.examId })
      .populate("student", "name email faceImagePath")
      .sort({ createdAt: -1 });

    const events = await ProctorEvent.find({ exam: req.params.examId }).select(
      "session eventType severity timestamp"
    );
    const eventsBySessionId = events.reduce((acc, event) => {
      const key = event.session.toString();
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(event);
      return acc;
    }, {});

    const hydratedSessions = sessions.map((session) => {
      const summary = summarizeProctorEvents(
        filterReportEvents(eventsBySessionId[session._id.toString()] || [])
      );
      return applyProctorSummaryToSession(session, summary);
    });

    // summary stats
    const totalStudents = hydratedSessions.length;
    const passed = hydratedSessions.filter((s) => s.passed).length;
    const avgScore =
      totalStudents > 0
        ? Math.round(
            hydratedSessions.reduce((sum, s) => sum + s.percentage, 0) / totalStudents
          )
        : 0;
    const avgSuspicion =
      totalStudents > 0
        ? Math.round(
            hydratedSessions.reduce((sum, s) => sum + s.suspicionScore, 0) /
              totalStudents
          )
        : 0;

    res.json({
      exam,
      sessions: hydratedSessions,
      summary: { totalStudents, passed, failed: totalStudents - passed, avgScore, avgSuspicion },
    });
  } catch (error) {
    console.error("Get exam report error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get student's own exam history
// @route   GET /api/reports/my-results
export const getMyResults = async (req, res) => {
  try {
    const sessions = await ExamSession.find({
      student: req.user._id,
      status: { $in: ["completed", "terminated"] },
    })
      .populate("exam", "title subject duration passingMarks totalMarks")
      .sort({ createdAt: -1 });

    res.json(
      sessions.map((session) => {
        const plainSession = typeof session.toObject === "function" ? session.toObject() : { ...session };
        plainSession.exam = plainSession.exam
          ? {
              ...plainSession.exam,
              totalQuestions: Number(plainSession.exam.totalMarks || 0),
            }
          : null;
        return plainSession;
      })
    );
  } catch (error) {
    console.error("Get my results error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Download PDF report for a session
// @route   GET /api/reports/pdf/:sessionId
export const downloadPDFReport = async (req, res) => {
  try {
    const session = await ExamSession.findById(req.params.sessionId)
      .populate("student", "name email faceImagePath")
      .populate("exam");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (req.user.role === "student") {
      return res.status(403).json({ message: "Detailed PDF reports are only available to admins" });
    }

    if (req.user.role === "admin" && !examOwnedBy(session.exam, req.user._id)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const events = filterReportEvents(await ProctorEvent.find({ session: session._id }).sort({
      timestamp: 1,
    }));
    const summary = summarizeProctorEvents(events);

    const pdfBuffer = await generatePDFReport({
      student: session.student,
      exam: session.exam,
      session: applyProctorSummaryToSession(session, summary),
      events,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=report-${session._id}.pdf`
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error("PDF report error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
