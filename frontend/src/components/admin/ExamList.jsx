import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { FiAlertCircle, FiBook, FiClock, FiHash, FiMonitor, FiPlus, FiTrash2, FiZap } from "react-icons/fi";
import api from "../../utils/api.js";
import ConfirmationDialog from "../shared/ConfirmationDialog.jsx";
import StatusBadge from "../shared/StatusBadge.jsx";

const ExamList = () => {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [feedback, setFeedback] = useState({ type: "", text: "" });
  const navigate = useNavigate();

  useEffect(() => {
    const fetchExams = async () => {
      try {
        const { data } = await api.get("/exams");
        setExams(data);
      } catch {
        setError("Failed to load exams.");
      } finally {
        setLoading(false);
      }
    };

    fetchExams();
  }, []);

  const handleDelete = async () => {
    if (!pendingDelete) return;

    setDeleting(pendingDelete._id);
    setFeedback({ type: "", text: "" });

    try {
      await api.delete(`/exams/${pendingDelete._id}`);
      setExams((prev) => prev.filter((exam) => exam._id !== pendingDelete._id));
      setFeedback({ type: "success", text: `"${pendingDelete.title}" was deleted.` });
      setPendingDelete(null);
    } catch {
      setFeedback({ type: "error", text: "Failed to delete exam." });
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="theme-panel relative overflow-hidden rounded-[24px] px-4 py-3.5"
      >
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-64 opacity-80"
          style={{
            background:
              "radial-gradient(circle at center, rgba(14, 165, 233, 0.14), transparent 65%)",
          }}
        />
        <div className="relative flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--accent-strong)]">
              Exam Library
            </p>
            <h1 className="mt-1 text-[1.75rem] font-semibold tracking-tight text-[var(--app-text)]">
              My Exams
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--app-muted)]">
              Manage scheduled assessments, launch live monitoring, and keep your exam set organized.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="flex gap-2">
              <div
                className="rounded-2xl border px-3.5 py-2"
                style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
              >
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--app-subtle)]">
                  Total Exams
                </p>
                <p className="mt-0.5 text-[1.1rem] font-semibold text-[var(--app-text)]">{exams.length}</p>
              </div>
            </div>

            <button
              onClick={() => navigate("/admin/create")}
              className="theme-primary-btn flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium"
            >
              <FiPlus />
              New Exam
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <FiAlertCircle />
          {error}
        </div>
      )}

      {feedback.text && (
        <div className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
          feedback.type === "error"
            ? "border-red-500/30 bg-red-500/10 text-red-300"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        }`}>
          {feedback.text}
        </div>
      )}

      {exams.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="theme-panel flex h-72 flex-col items-center justify-center rounded-[30px] text-center"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background: "var(--panel-strong)" }}>
            <FiBook className="text-2xl text-[var(--app-subtle)]" />
          </div>
          <h3 className="mb-1 font-semibold text-[var(--app-text)]">No exams yet</h3>
          <p className="mb-4 text-sm text-[var(--app-muted)]">Create your first exam with Gemini AI</p>
          <button
            onClick={() => navigate("/admin/create")}
            className="theme-primary-btn flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium"
          >
            <FiPlus />
            Create Exam
          </button>
        </motion.div>
      ) : (
        <div className="grid gap-3">
          <AnimatePresence>
            {exams.map((exam, index) => (
              <motion.div
                key={exam._id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: index * 0.05 }}
                className="group relative overflow-hidden rounded-[24px] border px-4 py-3"
                style={{
                  background: "var(--panel-bg)",
                  borderColor: "var(--app-border)",
                  boxShadow: "var(--panel-shadow)",
                }}
              >
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
                  style={{
                    background: exam.isActive
                      ? "linear-gradient(180deg, rgba(14, 165, 233, 0.9), rgba(34, 197, 94, 0.65))"
                      : "linear-gradient(180deg, rgba(100, 116, 139, 0.8), rgba(71, 85, 105, 0.45))",
                  }}
                />
                <div
                  className="pointer-events-none absolute -right-10 top-0 h-28 w-28 rounded-full blur-3xl transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background: "rgba(14, 165, 233, 0.08)",
                    opacity: 0.7,
                  }}
                />

                <div className="relative flex flex-col gap-2.5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-[1.18rem] font-semibold tracking-tight text-[var(--app-text)]">
                        {exam.title}
                      </h3>
                    </div>

                    <p className="mt-0.5 text-sm font-medium text-[var(--accent-strong)]">{exam.subject}</p>
                    {exam.description && (
                      <p className="mt-0.5 max-w-3xl truncate text-sm text-[var(--app-muted)]">{exam.description}</p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-2">
                      <div
                        className="flex min-w-[116px] items-center gap-2 rounded-2xl border px-2.5 py-1.5"
                        style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                          <FiHash className="text-[13px]" />
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-subtle)]">Questions</p>
                          <p className="text-sm font-medium text-[var(--app-text)]">{exam.questions.length}</p>
                        </div>
                      </div>
                      <div
                        className="flex min-w-[116px] items-center gap-2 rounded-2xl border px-2.5 py-1.5"
                        style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                          <FiClock className="text-[13px]" />
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-subtle)]">Duration</p>
                          <p className="text-sm font-medium text-[var(--app-text)]">{exam.duration} mins</p>
                        </div>
                      </div>
                      <div
                        className="flex min-w-[128px] items-center gap-2 rounded-2xl border px-2.5 py-1.5"
                        style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                          <FiBook className="text-[13px]" />
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-subtle)]">Pass Mark</p>
                          <p className="text-sm font-medium text-[var(--app-text)]">
                            {exam.passingMarks} / {exam.questions.length}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 flex-col gap-2 xl:min-w-[190px] xl:items-end">
                    <div
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
                      style={{ borderColor: "var(--nav-active-border)", background: "var(--accent-soft)", color: "var(--accent-strong)" }}
                    >
                      <FiZap className="text-[11px]" />
                      {exam.subject}
                    </div>
                    <div className="flex flex-wrap gap-2 xl:justify-end">
                      <button
                        onClick={() => navigate(`/admin/live?examId=${exam._id}`)}
                        className="theme-soft-btn flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs font-medium"
                      >
                        <FiMonitor className="text-xs" />
                        Monitor
                      </button>
                      <button
                        onClick={() => setPendingDelete(exam)}
                        disabled={deleting === exam._id}
                        className="flex items-center gap-1.5 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 disabled:opacity-50"
                      >
                        {deleting === exam._id ? (
                          <div className="h-3 w-3 animate-spin rounded-full border border-red-400 border-t-transparent" />
                        ) : (
                          <FiTrash2 className="text-xs" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="Delete Exam?"
        description={pendingDelete ? `This will permanently delete "${pendingDelete.title}" and cannot be undone.` : ""}
        confirmLabel="Delete Exam"
        loading={Boolean(pendingDelete && deleting === pendingDelete._id)}
        onCancel={() => !deleting && setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
};

export default ExamList;
