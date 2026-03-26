import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { FiAlertCircle, FiBook, FiClock, FiHash, FiMonitor, FiPlus, FiTrash2 } from "react-icons/fi";
import api from "../../utils/api.js";

const ExamList = () => {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
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

  const handleDelete = async (id) => {
    if (!confirm("Delete this exam? This cannot be undone.")) return;

    setDeleting(id);

    try {
      await api.delete(`/exams/${id}`);
      setExams((prev) => prev.filter((exam) => exam._id !== id));
    } catch {
      alert("Failed to delete exam.");
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
    <div>
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--app-text)]">My Exams</h1>
          <p className="mt-1 text-sm text-[var(--app-muted)]">
            {exams.length} exam{exams.length !== 1 ? "s" : ""} created
          </p>
        </div>
        <button
          onClick={() => navigate("/admin/create")}
          className="theme-primary-btn flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium"
        >
          <FiPlus />
          New Exam
        </button>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <FiAlertCircle />
          {error}
        </div>
      )}

      {exams.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex h-64 flex-col items-center justify-center text-center"
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
        <div className="grid gap-4">
          <AnimatePresence>
            {exams.map((exam, index) => (
              <motion.div
                key={exam._id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: index * 0.05 }}
                className="rounded-[28px] border p-5"
                style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)", boxShadow: "var(--panel-shadow)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h3 className="truncate font-semibold text-[var(--app-text)]">{exam.title}</h3>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs"
                        style={exam.isActive
                          ? { background: "rgba(34, 197, 94, 0.12)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.2)" }
                          : { background: "var(--panel-strong)", color: "var(--app-muted)", border: "1px solid var(--app-border)" }}
                      >
                        {exam.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <p className="text-sm text-[var(--app-muted)]">{exam.subject}</p>
                    {exam.description && (
                      <p className="mt-1 truncate text-xs text-[var(--app-subtle)]">{exam.description}</p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <span className="flex items-center gap-1.5 text-xs text-[var(--app-muted)]">
                        <FiHash className="text-[var(--accent-strong)]" />
                        {exam.questions.length} questions
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-[var(--app-muted)]">
                        <FiClock className="text-[var(--accent-strong)]" />
                        {exam.duration} mins
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-[var(--app-muted)]">
                        <FiBook className="text-[var(--accent-strong)]" />
                        Pass: {exam.passingMarks} / {exam.questions.length}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      onClick={() => navigate(`/admin/live?examId=${exam._id}`)}
                      className="theme-soft-btn flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-medium"
                    >
                      <FiMonitor className="text-xs" />
                      Monitor
                    </button>
                    <button
                      onClick={() => handleDelete(exam._id)}
                      disabled={deleting === exam._id}
                      className="flex items-center gap-1.5 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 disabled:opacity-50"
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
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default ExamList;
