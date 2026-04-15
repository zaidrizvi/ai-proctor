import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  FiAlertCircle,
  FiBook,
  FiCheckCircle,
  FiCheck,
  FiClipboard,
  FiClock,
  FiHash,
  FiLayers,
  FiPlus,
  FiZap,
} from "react-icons/fi";
import api from "../../utils/api.js";
import StatusBadge from "../shared/StatusBadge.jsx";

const defaultProctorSettings = {
  faceDetection: true,
  faceVerification: true,
  gazeTracking: true,
  objectDetection: true,
  audioDetection: true,
  headMovement: true,
  suspicionThreshold: 70,
};

const createEmptyQuestion = () => ({
  question: "",
  options: ["", "", "", ""],
  correctAnswer: 0,
  explanation: "",
});

const proctorSettingFields = [
  {
    key: "faceVerification",
    label: "Face verification",
    description: "Require reference-face verification before identity checks run.",
  },
  {
    key: "gazeTracking",
    label: "Gaze tracking",
    description: "Use L2CS-Net to flag sustained gaze drift away from the screen.",
  },
  {
    key: "headMovement",
    label: "Head movement",
    description: "Track head-turn events during the exam.",
  },
  {
    key: "objectDetection",
    label: "Object detection",
    description: "Check for suspicious objects and extra people in frame.",
  },
  {
    key: "audioDetection",
    label: "Audio detection",
    description: "Request microphone access and flag background speech.",
  },
];

const CreateExam = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [batchSuccess, setBatchSuccess] = useState("");
  const [batches, setBatches] = useState([]);
  const [batchName, setBatchName] = useState("");
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [form, setForm] = useState({
    title: "",
    subject: "",
    topic: "",
    creationMode: "ai",
    batch: "",
    description: "",
    duration: 30,
    questionCount: 10,
    questions: [createEmptyQuestion()],
    proctorSettings: defaultProctorSettings,
  });

  useEffect(() => {
    api.get("/batches")
      .then(({ data }) => setBatches(data))
      .catch(() => setBatches([]));
  }, []);

  const getBatchCodeValue = (batch) => batch?.batchCode || batch?.batch_code || "";

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleModeChange = (creationMode) => {
    setForm((prev) => ({
      ...prev,
      creationMode,
    }));
  };

  const handleProctorToggle = (settingKey) => {
    setForm((prev) => ({
      ...prev,
      proctorSettings: {
        ...prev.proctorSettings,
        [settingKey]: !prev.proctorSettings[settingKey],
      },
    }));
  };

  const handleQuestionChange = (index, key, value) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((question, questionIndex) =>
        questionIndex === index
          ? { ...question, [key]: value }
          : question
      ),
    }));
  };

  const handleOptionChange = (questionIndex, optionIndex, value) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((question, currentQuestionIndex) => {
        if (currentQuestionIndex !== questionIndex) return question;
        const nextOptions = [...question.options];
        nextOptions[optionIndex] = value;
        return { ...question, options: nextOptions };
      }),
    }));
  };

  const addQuestion = () => {
    setForm((prev) => ({
      ...prev,
      questions: [...prev.questions, createEmptyQuestion()],
    }));
  };

  const removeQuestion = (index) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, questionIndex) => questionIndex !== index),
    }));
  };

  const handleCreateBatch = async () => {
    const trimmedName = batchName.trim();
    if (!trimmedName) return;

    setCreatingBatch(true);
    setError("");
    setBatchSuccess("");

    try {
      const { data } = await api.post("/batches", { name: trimmedName });
      setBatches((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((prev) => ({ ...prev, batch: data.name }));
      setBatchName("");
      setBatchSuccess(`Batch "${data.name}" created. Join code: ${getBatchCodeValue(data)}`);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create batch.");
    } finally {
      setCreatingBatch(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.title || !form.subject || !form.batch) {
      setError("Title, subject and batch are required.");
      return;
    }

    if (form.creationMode === "ai" && !form.topic) {
      setError("Topic is required for AI-generated exams.");
      return;
    }

    if (form.creationMode === "manual" && form.questions.length === 0) {
      setError("Add at least one manual question.");
      return;
    }

    setLoading(true);

    try {
      const { data } = await api.post("/exams/create", {
        ...form,
        duration: Number(form.duration),
        questionCount: Number(form.questionCount),
        questions: form.questions.map((question) => ({
          ...question,
          correctAnswer: Number(question.correctAnswer),
        })),
      });

      setSuccess(
        form.creationMode === "ai"
          ? `Exam created with ${data.questions.length} AI-generated questions!`
          : `Manual exam created with ${data.questions.length} questions!`
      );
      setTimeout(() => navigate("/admin/exams"), 2000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create exam.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--accent-strong)]">
            Exam Builder
          </p>
          <h1 className="theme-page-title mt-1.5">Create Exam</h1>
          <p className="theme-page-subtitle mt-1.5 max-w-2xl">
            Build an exam for batch, either with AI or your own MCQs
          </p>
        </div>

        <div className="theme-panel flex flex-wrap gap-2 rounded-[24px] px-3 py-2.5">
          <StatusBadge tone={form.creationMode === "ai" ? "info" : "success"}>
            {form.creationMode === "ai" ? "AI Generated" : "Manual MCQs"}
          </StatusBadge>
          <StatusBadge tone={form.batch ? "success" : "warning"}>
            {form.batch || "Batch not selected"}
          </StatusBadge>
          <StatusBadge tone="info">{Number(form.duration)} min</StatusBadge>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-6 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
          >
            <FiAlertCircle className="flex-shrink-0" />
            {error}
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-6 flex items-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400"
          >
            <FiCheck className="flex-shrink-0" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="theme-panel rounded-[28px] p-5 md:p-6">
          <div className="mb-4 border-b pb-4" style={{ borderColor: "var(--app-border)" }}>
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
                <FiBook className="text-[var(--accent-strong)]" />
                Basic Information
              </h2>
              <p className="mt-1.5 text-sm text-[var(--app-muted)]">
                Define the exam identity, assigned batch, and context students will see before they begin.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                Exam Title
              </label>
              <input
                type="text"
                name="title"
                value={form.title}
                onChange={handleChange}
                placeholder="e.g. Data Structures Midterm"
                className="theme-input w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                Subject
              </label>
              <input
                type="text"
                name="subject"
                value={form.subject}
                onChange={handleChange}
                placeholder="e.g. Computer Science"
                className="theme-input w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                Batch
              </label>
              <select
                name="batch"
                value={form.batch}
                onChange={handleChange}
                className="theme-input theme-select w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              >
                <option value="">Select batch</option>
                {batches.map((batch) => (
                  <option key={batch._id} value={batch.name}>
                    {batch.name}
                  </option>
                ))}
              </select>
            </div>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(250px,0.9fr)]">
              <div className="rounded-[24px] border p-4" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                      Create New Batch
                    </label>
                    <input
                      type="text"
                      value={batchName}
                      onChange={(e) => setBatchName(e.target.value)}
                      placeholder="e.g. BSCS 6th Semester"
                      className="theme-input w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateBatch}
                    disabled={creatingBatch || !batchName.trim()}
                    className="theme-secondary-btn flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium sm:w-auto sm:min-w-[160px] disabled:opacity-50"
                  >
                    <FiPlus />
                    {creatingBatch ? "Creating..." : "Add Batch"}
                  </button>
                </div>
                {batchSuccess && (
                  <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
                    {batchSuccess}
                  </div>
                )}
              </div>

              <div className="rounded-[24px] border p-4" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                  Batch Join Codes
                </p>
                {batches.length === 0 ? (
                  <p className="mt-2.5 text-sm text-[var(--app-muted)]">
                    Add a batch first to generate its join code here.
                  </p>
                ) : (
                  <div className="theme-scrollbar mt-2.5 max-h-32 space-y-2 overflow-auto pr-1">
                    {batches.map((batch) => (
                      <div
                        key={batch._id}
                        className="flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-sm"
                        style={{ borderColor: "var(--app-border)", background: "var(--panel-bg)" }}
                      >
                        <span className="min-w-0 truncate text-[var(--app-text)]">{batch.name}</span>
                        <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 font-mono text-xs text-[var(--accent-strong)]">
                          {getBatchCodeValue(batch) || "Needs update"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                Description
              </label>
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows={2}
                placeholder="Brief description of the exam..."
                className="theme-input w-full resize-none rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              />
            </div>
          </div>
        </div>

        <div className="theme-panel rounded-[28px] p-5 md:p-6">
          <div className="mb-4 border-b pb-4" style={{ borderColor: "var(--app-border)" }}>
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
                <FiZap className="text-[var(--accent-strong)]" />
                Exam Settings
              </h2>
              <p className="mt-1.5 text-sm text-[var(--app-muted)]">
                Choose how questions are created, how long the exam lasts, and how many items will be asked.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
              Question Source
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { key: "ai", label: "AI Generated", icon: FiZap, caption: "Generate questions from a topic" },
                { key: "manual", label: "Manual MCQs", icon: FiClipboard, caption: "Write each question yourself" },
              ].map(({ key, label, icon: Icon, caption }) => {
                const active = form.creationMode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleModeChange(key)}
                    className="rounded-[22px] border px-4 py-3 text-left transition-colors"
                    style={active
                      ? { background: "var(--accent-soft)", borderColor: "var(--nav-active-border)", color: "var(--app-text)" }
                      : { background: "var(--panel-strong)", borderColor: "var(--app-border)", color: "var(--app-muted)" }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-2xl"
                        style={{
                          background: active ? "rgba(14, 165, 233, 0.16)" : "var(--panel-bg)",
                          color: active ? "var(--accent-strong)" : "var(--app-subtle)",
                        }}
                      >
                        <Icon />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--app-text)]">{label}</p>
                        <p className="mt-1 text-xs text-[var(--app-muted)]">{caption}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                <FiClock className="text-xs" />
                Duration (minutes)
              </label>
              <input
                type="number"
                name="duration"
                value={form.duration}
                onChange={handleChange}
                min={5}
                max={180}
                className="theme-input w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                <FiHash className="text-xs" />
                No. of Questions
              </label>
              <input
                type="number"
                name="questionCount"
                value={form.questionCount}
                onChange={handleChange}
                min={5}
                max={30}
                disabled={form.creationMode !== "ai"}
                className="theme-input w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              />
            </div>
            </div>

            {form.creationMode === "ai" && (
              <div className="rounded-[24px] border p-4" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                Topic
              </label>
              <input
                type="text"
                name="topic"
                value={form.topic}
                onChange={handleChange}
                placeholder="e.g. Binary Trees"
                className="theme-input w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              />
                <p className="mt-1.5 text-xs text-[var(--app-muted)]">
                  Use a narrow topic to get a tighter and more consistent AI-generated paper.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="theme-panel rounded-[28px] p-5 md:p-6">
          <div className="mb-4 border-b pb-4" style={{ borderColor: "var(--app-border)" }}>
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
                <FiCheckCircle className="text-[var(--accent-strong)]" />
                Proctor Settings
              </h2>
              <p className="mt-1.5 text-sm text-[var(--app-muted)]">
                Turn individual monitoring modules on or off for this exam.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {proctorSettingFields.map((setting) => (
              <label
                key={setting.key}
                className="flex cursor-pointer items-start gap-3 rounded-[22px] border px-4 py-3"
                style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(form.proctorSettings[setting.key])}
                  onChange={() => handleProctorToggle(setting.key)}
                  className="mt-1 h-4 w-4 rounded border-[var(--app-border)]"
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--app-text)]">{setting.label}</p>
                  <p className="mt-1 text-xs text-[var(--app-muted)]">{setting.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {form.creationMode === "manual" && (
          <div className="theme-panel rounded-[28px] p-5 md:p-6">
            <div className="mb-4 flex flex-col gap-2.5 border-b pb-4 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: "var(--app-border)" }}>
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
                  <FiLayers className="text-[var(--accent-strong)]" />
                  Manual Questions
                </h2>
                <p className="mt-1.5 text-sm text-[var(--app-muted)]">
                  Author each MCQ carefully, then choose the correct option and any explanation you want stored.
                </p>
              </div>
              <button
                type="button"
                onClick={addQuestion}
                className="theme-secondary-btn flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium"
              >
                <FiPlus />
                Add Question
              </button>
            </div>

            <div className="space-y-4">
              {form.questions.map((question, index) => (
                <div key={index} className="rounded-[24px] border border-[var(--app-border)] bg-[var(--panel-strong)] p-4 space-y-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]">
                        {index + 1}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--app-text)]">Question {index + 1}</p>
                        <p className="text-xs text-[var(--app-muted)]">Four options with one correct answer</p>
                      </div>
                    </div>
                    {form.questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeQuestion(index)}
                      className="theme-danger-btn rounded-2xl px-3 py-1.5 text-xs font-medium sm:self-start"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                      Prompt
                    </label>
                    <textarea
                      value={question.question}
                      onChange={(e) => handleQuestionChange(index, "question", e.target.value)}
                      rows={2}
                      className="theme-input w-full resize-none rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                    {question.options.map((option, optionIndex) => (
                      <div key={optionIndex}>
                        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                          Option {optionIndex + 1}
                        </label>
                        <input
                          type="text"
                          value={option}
                          onChange={(e) => handleOptionChange(index, optionIndex, e.target.value)}
                          className="theme-input w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                        Correct Option
                      </label>
                      <select
                        value={question.correctAnswer}
                        onChange={(e) => handleQuestionChange(index, "correctAnswer", Number(e.target.value))}
                        className="theme-input theme-select w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                      >
                        {[0, 1, 2, 3].map((optionIndex) => (
                          <option key={optionIndex} value={optionIndex}>
                            Option {optionIndex + 1}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                        Explanation
                      </label>
                      <input
                        type="text"
                        value={question.explanation}
                        onChange={(e) => handleQuestionChange(index, "explanation", e.target.value)}
                        className="theme-input w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <motion.button
          type="submit"
          disabled={loading}
          whileTap={{ scale: 0.98 }}
          className="theme-primary-btn flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Generating with Gemini AI...
                </>
              ) : (
                <>
                  {form.creationMode === "ai" ? <FiZap /> : <FiCheckCircle />}
                  {form.creationMode === "ai" ? "Generate & Create Exam" : "Create Manual Exam"}
                </>
              )}
        </motion.button>
      </form>
    </div>
  );
};

export default CreateExam;
