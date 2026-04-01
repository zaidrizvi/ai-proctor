import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  FiAlertCircle,
  FiBook,
  FiCheckCircle,
  FiCheck,
  FiClipboard,
  FiChevronDown,
  FiChevronUp,
  FiClock,
  FiHash,
  FiLayers,
  FiPlus,
  FiZap,
} from "react-icons/fi";
import api from "../../utils/api.js";

const defaultProctorSettings = {
  faceDetection: true,
  objectDetection: true,
  gazeTracking: true,
  audioMonitoring: true,
  headPoseDetection: true,
  suspicionThreshold: 70,
};

const createEmptyQuestion = () => ({
  question: "",
  options: ["", "", "", ""],
  correctAnswer: 0,
  explanation: "",
});

const CreateExam = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [batchSuccess, setBatchSuccess] = useState("");
  const [showProctor, setShowProctor] = useState(false);
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

  const handleProctorToggle = (key) => {
    setForm((prev) => ({
      ...prev,
      proctorSettings: {
        ...prev.proctorSettings,
        [key]: !prev.proctorSettings[key],
      },
    }));
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

  const settings = [
    { key: "faceDetection", label: "Face Detection", desc: "Detect if face is visible" },
    { key: "objectDetection", label: "Object Detection", desc: "Detect phones and extra objects in frame" },
    { key: "gazeTracking", label: "Gaze Tracking", desc: "Track where student is looking" },
    { key: "audioMonitoring", label: "Audio Monitoring", desc: "Detect background voices" },
    { key: "headPoseDetection", label: "Head Pose Detection", desc: "Detect head turning" },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--app-text)]">Create Exam</h1>
        <p className="mt-1 text-sm text-[var(--app-muted)]">
          Build an exam for one batch, either with Gemini AI or your own MCQs
        </p>
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

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="theme-panel rounded-[28px] p-6 space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
            <FiBook className="text-[var(--accent-strong)]" />
            Basic Information
          </h2>

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
              className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
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
                className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                Create New Batch
              </label>
              <input
                type="text"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                placeholder="e.g. BSCS 6th Semester"
                className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleCreateBatch}
                disabled={creatingBatch || !batchName.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--panel-strong)] px-4 py-3 text-sm font-medium text-[var(--app-text)] transition hover:bg-[var(--panel-soft)] disabled:opacity-50"
              >
                <FiPlus />
                {creatingBatch ? "Creating..." : "Add Batch"}
              </button>
            </div>
          </div>

          {batchSuccess && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {batchSuccess}
            </div>
          )}

          {batches.length > 0 && (
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                Batch Join Codes
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {batches.map((batch) => (
                  <div
                    key={batch._id}
                    className="flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--app-border)", background: "var(--panel-bg)" }}
                  >
                    <span className="text-[var(--app-text)]">{batch.name}</span>
                    <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-xs text-[var(--accent-strong)]">
                      {getBatchCodeValue(batch) || "Needs update"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
              Description
            </label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={3}
              placeholder="Brief description of the exam..."
              className="theme-input w-full resize-none rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
            />
          </div>
        </div>

        <div className="theme-panel rounded-[28px] p-6 space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
            <FiZap className="text-[var(--accent-strong)]" />
            Exam Settings
          </h2>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
              Question Source
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "ai", label: "AI Generated", icon: FiZap },
                { key: "manual", label: "Manual MCQs", icon: FiClipboard },
              ].map(({ key, label, icon: Icon }) => {
                const active = form.creationMode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleModeChange(key)}
                    className="flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors"
                    style={active
                      ? { background: "var(--accent-strong)", borderColor: "var(--accent-strong)", color: "white" }
                      : { background: "var(--panel-strong)", borderColor: "var(--app-border)", color: "var(--app-muted)" }}
                  >
                    <Icon />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
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
                className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
              />
            </div>
          </div>

          {form.creationMode === "ai" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                Topic
              </label>
              <input
                type="text"
                name="topic"
                value={form.topic}
                onChange={handleChange}
                placeholder="e.g. Binary Trees"
                className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
              />
            </div>
          )}
        </div>

        {form.creationMode === "manual" && (
          <div className="theme-panel rounded-[28px] p-6 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
                <FiLayers className="text-[var(--accent-strong)]" />
                Manual Questions
              </h2>
              <button
                type="button"
                onClick={addQuestion}
                className="flex items-center gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--panel-strong)] px-4 py-2 text-sm font-medium text-[var(--app-text)] transition hover:bg-[var(--panel-soft)]"
              >
                <FiPlus />
                Add Question
              </button>
            </div>

            <div className="space-y-5">
              {form.questions.map((question, index) => (
                <div key={index} className="rounded-[24px] border border-[var(--app-border)] bg-[var(--panel-strong)] p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--app-text)]">Question {index + 1}</p>
                    {form.questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeQuestion(index)}
                        className="text-xs font-medium text-red-400 transition hover:text-red-300"
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
                      rows={3}
                      className="theme-input w-full resize-none rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {question.options.map((option, optionIndex) => (
                      <div key={optionIndex}>
                        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                          Option {optionIndex + 1}
                        </label>
                        <input
                          type="text"
                          value={option}
                          onChange={(e) => handleOptionChange(index, optionIndex, e.target.value)}
                          className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                        Correct Option
                      </label>
                      <select
                        value={question.correctAnswer}
                        onChange={(e) => handleQuestionChange(index, "correctAnswer", Number(e.target.value))}
                        className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
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
                        className="theme-input w-full rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="theme-panel overflow-hidden rounded-[28px]">
          <button
            type="button"
            onClick={() => setShowProctor((current) => !current)}
            className="flex w-full items-center justify-between p-6 text-left"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
              <FiAlertCircle className="text-[var(--accent-strong)]" />
              Proctor Settings
            </h2>
            {showProctor ? <FiChevronUp className="text-[var(--app-muted)]" /> : <FiChevronDown className="text-[var(--app-muted)]" />}
          </button>

          <AnimatePresence>
            {showProctor && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="space-y-4 border-t px-6 pt-4 pb-6" style={{ borderColor: "var(--app-border)" }}>
                  {settings.map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-[var(--app-text)]">{label}</p>
                        <p className="text-xs text-[var(--app-muted)]">{desc}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleProctorToggle(key)}
                        className="relative h-6 w-11 rounded-full transition-colors"
                        style={{ background: form.proctorSettings[key] ? "var(--accent-strong)" : "var(--panel-strong)" }}
                      >
                        <span
                          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                            form.proctorSettings[key] ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  ))}

                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                      Suspicion Threshold: {form.proctorSettings.suspicionThreshold}
                    </label>
                    <input
                      type="range"
                      min={30}
                      max={100}
                      value={form.proctorSettings.suspicionThreshold}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          proctorSettings: {
                            ...prev.proctorSettings,
                            suspicionThreshold: Number(e.target.value),
                          },
                        }))
                      }
                      className="w-full accent-sky-500"
                    />
                    <div className="mt-1 flex justify-between text-xs text-[var(--app-subtle)]">
                      <span>Lenient (30)</span>
                      <span>Strict (100)</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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
