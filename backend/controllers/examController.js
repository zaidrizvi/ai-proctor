import Exam from "../models/Exam.js";
import ExamSession from "../models/ExamSession.js";
import generateMCQ, { MCQGenerationError } from "../utils/generateMCQ.js";
import {
  examOwnedBy,
  getStudentExamAccessError,
  studentCanAccessExam,
  validateExamSchedule,
} from "../utils/examPolicy.js";
import { syncSessionProctorSummary } from "../utils/proctorSummary.js";

const EXAM_UPDATE_FIELDS = [
  "title",
  "subject",
  "description",
  "topic",
  "creationMode",
  "batch",
  "questions",
  "duration",
  "scheduledAt",
  "expiresAt",
  "isActive",
  "allowedStudents",
  "proctorSettings",
];

const findStudentExamSession = (examId, studentId) =>
  ExamSession.findOne({
    exam: examId,
    student: studentId,
  });

// ─── ADMIN CONTROLLERS ────────────────────────────────────────

// @desc    Create exam with AI generated MCQs
// @route   POST /api/exams/create
export const createExam = async (req, res) => {
  try {
    const {
      title,
      subject,
      topic,
      creationMode,
      batch,
      description,
      duration,
      questionCount,
      questions,
      scheduledAt,
      expiresAt,
      proctorSettings,
    } = req.body;

    if (!title || !subject || !duration || !batch) {
      return res.status(400).json({ message: "Please fill all required fields" });
    }

    const scheduleValidation = validateExamSchedule(scheduledAt, expiresAt);
    if (!scheduleValidation.valid) {
      return res.status(400).json({ message: scheduleValidation.message });
    }

    let normalizedQuestions = [];

    if ((creationMode || "ai") === "ai") {
      if (!topic) {
        return res.status(400).json({ message: "Topic is required for AI exams" });
      }
      normalizedQuestions = await generateMCQ(subject, topic, questionCount || 10);
    } else {
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "Add at least one manual question" });
      }

      normalizedQuestions = questions.map((question, index) => {
        const normalizedOptions = Array.isArray(question.options)
          ? question.options.map((option) => option?.trim?.() || "")
          : [];

        if (!question.question?.trim()) {
          throw new Error(`Question ${index + 1} is missing its prompt`);
        }

        if (normalizedOptions.length !== 4 || normalizedOptions.some((option) => !option)) {
          throw new Error(`Question ${index + 1} must have exactly 4 filled options`);
        }

        if (![0, 1, 2, 3].includes(Number(question.correctAnswer))) {
          throw new Error(`Question ${index + 1} must have one correct answer selected`);
        }

        return {
          question: question.question.trim(),
          options: normalizedOptions,
          correctAnswer: Number(question.correctAnswer),
          explanation: question.explanation?.trim?.() || "",
        };
      });
    }

    const exam = await Exam.create({
      title,
      subject,
      topic: topic || "",
      creationMode: creationMode || "ai",
      batch: batch.trim(),
      description,
      duration,
      questions: normalizedQuestions,
      createdBy: req.user._id,
      scheduledAt: scheduleValidation.scheduledAt,
      expiresAt: scheduleValidation.expiresAt,
      proctorSettings: proctorSettings || {},
    });

    res.status(201).json(exam);
  } catch (error) {
    console.error("Create exam error:", error);
    if (error instanceof MCQGenerationError) {
      return res.status(error.statusCode || 503).json({
        message: error.message,
      });
    }

    res.status(500).json({ message: error.message || "Server error" });
  }
};

// @desc    Get all exams (admin sees all, student sees active only)
// @route   GET /api/exams
export const getExams = async (req, res) => {
  try {
    const now = new Date();
    let query = {};

    if (req.user.role === "student") {
      query.isActive = true;
      query.$and = [
        { $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }] },
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      ];
    } else {
      query.createdBy = req.user._id;
    }

    const exams = await Exam.find(query)
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    const visibleExams =
      req.user.role === "student"
        ? exams.filter((exam) => studentCanAccessExam(exam, req.user))
        : exams;

    res.json(visibleExams);
  } catch (error) {
    console.error("Get exams error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get single exam by id
// @route   GET /api/exams/:id
export const getExamById = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id).populate(
      "createdBy",
      "name email"
    );

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    if (req.user.role === "admin") {
      if (!examOwnedBy(exam, req.user._id)) {
        return res.status(403).json({ message: "Not authorized" });
      }
      return res.json(exam);
    }

    const existingSession = await findStudentExamSession(exam._id, req.user._id);
    const canResumeExistingSession = existingSession?.status === "ongoing";

    const accessError = canResumeExistingSession
      ? getStudentExamAccessError(exam, req.user, {
          requireWindow: false,
          requireActive: true,
        })
      : getStudentExamAccessError(exam, req.user, {
          requireWindow: true,
          requireActive: true,
        });
    if (accessError) {
      return res.status(accessError.status).json({ message: accessError.message });
    }

    // students should NOT see correct answers
    if (req.user.role === "student") {
      const safeExam = exam.toObject();
      safeExam.questions = safeExam.questions.map((q) => ({
        _id: q._id,
        question: q.question,
        options: q.options,
        // correctAnswer and explanation stripped out
      }));
      return res.json(safeExam);
    }
  } catch (error) {
    console.error("Get exam error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Update exam
// @route   PUT /api/exams/:id
export const updateExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    if (!examOwnedBy(exam, req.user._id)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const updates = Object.fromEntries(
      EXAM_UPDATE_FIELDS
        .filter((field) => Object.prototype.hasOwnProperty.call(req.body, field))
        .map((field) => [field, req.body[field]])
    );

    const scheduleValidation = validateExamSchedule(
      updates.scheduledAt ?? exam.scheduledAt,
      updates.expiresAt ?? exam.expiresAt
    );
    if (!scheduleValidation.valid) {
      return res.status(400).json({ message: scheduleValidation.message });
    }

    if (Object.prototype.hasOwnProperty.call(updates, "scheduledAt")) {
      updates.scheduledAt = scheduleValidation.scheduledAt;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "expiresAt")) {
      updates.expiresAt = scheduleValidation.expiresAt;
    }

    const updated = await Exam.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    res.json(updated);
  } catch (error) {
    console.error("Update exam error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Delete exam
// @route   DELETE /api/exams/:id
export const deleteExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    if (!examOwnedBy(exam, req.user._id)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await exam.deleteOne();
    res.json({ message: "Exam deleted" });
  } catch (error) {
    console.error("Delete exam error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── STUDENT CONTROLLERS ──────────────────────────────────────

// @desc    Start exam session
// @route   POST /api/exams/:id/start
export const startExam = async (req, res) => {
  try {
    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Only students can start exams" });
    }

    const exam = await Exam.findById(req.params.id);
    const existing = exam
      ? await findStudentExamSession(exam._id, req.user._id)
      : null;

    const accessError = existing?.status === "ongoing"
      ? getStudentExamAccessError(exam, req.user, {
          requireWindow: false,
          requireActive: true,
        })
      : getStudentExamAccessError(exam, req.user, {
          requireWindow: true,
          requireActive: true,
        });
    if (accessError) {
      return res.status(accessError.status).json({ message: accessError.message });
    }

    if (existing) {
      if (existing.status === "ongoing") {
        // resume
        return res.json({ session: existing, resumed: true });
      }
      // already completed — just return the existing session
      // don't block them, let frontend handle it
      return res.json({ session: existing, resumed: true });
    }

    const session = await ExamSession.create({
      exam: exam._id,
      student: req.user._id,
      status: "ongoing",
    });

    res.status(201).json({ session, resumed: false });
  } catch (error) {
    if (error?.code === 11000) {
      try {
        const existingSession = await ExamSession.findOne({
          exam: req.params.id,
          student: req.user._id,
        });

        if (existingSession) {
          return res.json({ session: existingSession, resumed: true });
        }
      } catch (lookupError) {
        console.error("Start exam duplicate lookup error:", lookupError);
      }
    }

    console.error("Start exam error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get the current student's session for an exam without starting one
// @route   GET /api/exams/:id/session
export const getMyExamSession = async (req, res) => {
  try {
    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Only students can access exam sessions" });
    }

    const exam = await Exam.findById(req.params.id);
    const session = exam
      ? await findStudentExamSession(exam._id, req.user._id)
      : null;

    const accessError = session?.status === "ongoing"
      ? getStudentExamAccessError(exam, req.user, {
          requireWindow: false,
          requireActive: true,
        })
      : getStudentExamAccessError(exam, req.user, {
          requireWindow: true,
          requireActive: true,
        });
    if (accessError) {
      return res.status(accessError.status).json({ message: accessError.message });
    }

    res.json({ session });
  } catch (error) {
    console.error("Get my exam session error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Save in-progress exam state
// @route   POST /api/exams/:id/progress
export const saveExamProgress = async (req, res) => {
  try {
    const { answers = [], currentQuestionIndex = 0 } = req.body;

    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Only students can save exam progress" });
    }

    const exam = await Exam.findById(req.params.id);
    const accessError = getStudentExamAccessError(exam, req.user, {
      requireWindow: false,
      requireActive: true,
    });
    if (accessError) {
      return res.status(accessError.status).json({ message: accessError.message });
    }

    const session = await ExamSession.findOne({
      exam: exam._id,
      student: req.user._id,
      status: "ongoing",
    });

    if (!session) {
      return res.status(404).json({ message: "No active session found" });
    }

    if (!Array.isArray(answers)) {
      return res.status(400).json({ message: "Answers must be an array" });
    }

    const seenQuestions = new Set();
    const normalizedAnswers = [];

    for (const answer of answers) {
      const questionIndex = Number(answer?.questionIndex);
      const selectedOption = Number(answer?.selectedOption);

      if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= exam.questions.length) {
        return res.status(400).json({ message: "One or more answers reference an invalid question" });
      }

      if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption > 3) {
        return res.status(400).json({ message: "One or more answers reference an invalid option" });
      }

      if (seenQuestions.has(questionIndex)) {
        return res.status(400).json({ message: "Duplicate answers for the same question are not allowed" });
      }

      seenQuestions.add(questionIndex);
      normalizedAnswers.push({
        questionIndex,
        selectedOption,
        isCorrect: false,
      });
    }

    const normalizedCurrentQuestionIndex = Number(currentQuestionIndex);
    if (
      !Number.isInteger(normalizedCurrentQuestionIndex) ||
      normalizedCurrentQuestionIndex < 0 ||
      normalizedCurrentQuestionIndex >= exam.questions.length
    ) {
      return res.status(400).json({ message: "currentQuestionIndex is invalid" });
    }

    session.answers = normalizedAnswers;
    session.currentQuestionIndex = normalizedCurrentQuestionIndex;
    await session.save();

    res.json({
      message: "Progress saved",
      session,
    });
  } catch (error) {
    console.error("Save exam progress error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Submit exam answers
// @route   POST /api/exams/:id/submit
export const submitExam = async (req, res) => {
  try {
    const { answers } = req.body;

    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Only students can submit exams" });
    }

    const exam = await Exam.findById(req.params.id);
    const accessError = getStudentExamAccessError(exam, req.user, {
      requireWindow: false,
      requireActive: true,
    });
    if (accessError) {
      return res.status(accessError.status).json({ message: accessError.message });
    }

    const session = await ExamSession.findOne({
      exam: exam._id,
      student: req.user._id,
      status: "ongoing",
    });

    if (!session) {
      return res.status(404).json({ message: "No active session found" });
    }

    if (!Array.isArray(answers)) {
      return res.status(400).json({ message: "Answers must be an array" });
    }

    const seenQuestions = new Set();
    const normalizedAnswers = [];

    for (const answer of answers) {
      const questionIndex = Number(answer?.questionIndex);
      const selectedOption = Number(answer?.selectedOption);

      if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= exam.questions.length) {
        return res.status(400).json({ message: "One or more answers reference an invalid question" });
      }

      if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption > 3) {
        return res.status(400).json({ message: "One or more answers reference an invalid option" });
      }

      if (seenQuestions.has(questionIndex)) {
        return res.status(400).json({ message: "Duplicate answers for the same question are not allowed" });
      }

      seenQuestions.add(questionIndex);
      normalizedAnswers.push({ questionIndex, selectedOption });
    }

    // calculate score
    let score = 0;
    const gradedAnswers = normalizedAnswers.map((ans) => {
      const question = exam.questions[ans.questionIndex];
      const isCorrect = question.correctAnswer === ans.selectedOption;
      if (isCorrect) score++;
      return {
        questionIndex: ans.questionIndex,
        selectedOption: ans.selectedOption,
        isCorrect,
      };
    });

    const percentage = Math.round((score / exam.questions.length) * 100);
    const passed = score >= exam.passingMarks;

    session.answers = gradedAnswers;
    session.score = score;
    session.percentage = percentage;
    session.passed = passed;
    session.status = "completed";
    session.currentQuestionIndex = normalizedAnswers.length
      ? normalizedAnswers[normalizedAnswers.length - 1].questionIndex
      : session.currentQuestionIndex;
    session.submittedAt = new Date();

    const proctorSummary = await syncSessionProctorSummary(session._id);
    session.flaggedEventsCount = proctorSummary.flaggedEventsCount;
    session.tabSwitchCount = proctorSummary.tabSwitchCount;
    session.faceNotDetectedCount = proctorSummary.faceNotDetectedCount;
    session.suspicionScore = proctorSummary.suspicionScore;

    await session.save();

    res.json({
      score,
      percentage,
      passed,
      totalQuestions: exam.questions.length,
      passingMarks: exam.passingMarks,
    });
  } catch (error) {
    console.error("Submit exam error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get all sessions for an exam (admin)
// @route   GET /api/exams/:id/sessions
export const getExamSessions = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    if (!examOwnedBy(exam, req.user._id)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const sessions = await ExamSession.find({ exam: req.params.id })
      .populate("student", "name email")
      .sort({ createdAt: -1 });

    res.json(sessions);
  } catch (error) {
    console.error("Get sessions error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
