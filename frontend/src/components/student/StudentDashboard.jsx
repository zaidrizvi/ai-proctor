import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiClock, FiPlay, FiShield, FiAlertTriangle } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext.jsx";
import api from "../../utils/api.js";

const StudentDashboard = () => {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { user } = useAuth();
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

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent-strong)] border-t-transparent" />
      </div>
    );
  }

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-full">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <p
            className="mb-1 text-xs font-medium uppercase tracking-[0.22em]"
            style={{ color: "var(--accent-strong)" }}
          >
            {greeting}
          </p>
          <h1 className="text-[1.8rem] font-bold tracking-tight text-[var(--app-text)]">
            {user?.name?.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-[var(--app-muted)]">
            {exams.length > 0
              ? `You have ${exams.length} exam${exams.length > 1 ? "s" : ""} waiting`
              : "No exams scheduled right now"}
          </p>
        </div>

        <div className="theme-panel rounded-[22px] px-3 py-2.5">
          <div className="rounded-2xl border px-3.5 py-2" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--app-subtle)]">Available Exams</p>
            <p className="mt-0.5 text-[1.2rem] font-semibold text-[var(--app-text)]">{exams.length}</p>
          </div>
        </div>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
        >
          <FiAlertTriangle className="flex-shrink-0" />
          {error}
        </motion.div>
      )}

      {exams.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex h-64 flex-col items-center justify-center text-center"
        >
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border"
            style={{ background: "var(--panel-soft)", borderColor: "var(--app-border)" }}
          >
            <FiShield className="text-2xl text-[var(--app-subtle)]" />
          </div>
          <p className="mb-1 font-semibold text-[var(--app-text)]">All clear</p>
          <p className="text-sm text-[var(--app-muted)]">
            No exams available right now. Check back later.
          </p>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {exams.map((exam, i) => (
            <motion.div
              key={exam._id}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, ease: "easeOut" }}
              className="group relative overflow-hidden rounded-[24px] border px-4 py-3 transition-all duration-300"
              style={{
                background: "var(--panel-bg)",
                borderColor: "var(--app-border)",
                boxShadow: "var(--panel-shadow)",
              }}
            >
              <div
                className="pointer-events-none absolute inset-0 rounded-[26px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(14, 165, 233, 0.05) 0%, rgba(14, 165, 233, 0) 100%)",
                }}
              />
              <div
                className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
                style={{
                  background: "linear-gradient(180deg, rgba(14, 165, 233, 0.9), rgba(56, 189, 248, 0.45))",
                }}
              />

              <div className="relative flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <span
                    className="mb-1.5 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium"
                    style={{
                      color: "var(--accent-strong)",
                      background: "var(--accent-soft)",
                      borderColor: "rgba(14, 165, 233, 0.18)",
                    }}
                  >
                    {exam.subject}
                  </span>

                  <h2 className="mb-1.5 text-[1.28rem] font-semibold leading-snug tracking-tight text-[var(--app-text)]">
                    {exam.title}
                  </h2>

                  {exam.description && (
                    <p className="mb-2.5 text-sm text-[var(--app-muted)] line-clamp-1">
                      {exam.description}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <div
                      className="flex min-w-[112px] items-center gap-2 rounded-2xl border px-2.5 py-1.5"
                      style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
                    >
                      <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                        <span className="text-[10px] font-bold">Q</span>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-subtle)]">Questions</p>
                        <p className="text-sm font-medium text-[var(--app-text)]">{exam.questions.length}</p>
                      </div>
                    </div>
                    <div
                      className="flex min-w-[112px] items-center gap-2 rounded-2xl border px-2.5 py-1.5"
                      style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
                    >
                      <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                        <FiClock className="text-[13px]" />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-subtle)]">Duration</p>
                        <p className="text-sm font-medium text-[var(--app-text)]">{exam.duration} min</p>
                      </div>
                    </div>
                    <div
                      className="flex min-w-[124px] items-center gap-2 rounded-2xl border px-2.5 py-1.5"
                      style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}
                    >
                      <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-300">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-subtle)]">Pass Mark</p>
                        <p className="text-sm font-medium text-[var(--app-text)]">
                          {exam.passingMarks}/{exam.questions.length}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center gap-2">
                    <FiShield className="flex-shrink-0 text-xs text-amber-500/80" />
                    <p className="text-xs text-amber-500/90">
                      AI proctoring active - webcam + object detection enabled
                    </p>
                  </div>
                </div>

                <div className="flex h-full flex-shrink-0 flex-col items-start justify-between gap-3 xl:items-end">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => navigate(`/student/exam/${exam._id}`)}
                    className="theme-primary-btn flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition-colors duration-200"
                    style={{
                      boxShadow: "0 14px 30px rgba(14, 165, 233, 0.22)",
                    }}
                  >
                    <FiPlay className="text-xs" />
                    Start Exam
                  </motion.button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StudentDashboard;
