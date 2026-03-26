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
    <div className="min-h-full p-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <p
          className="mb-1 text-sm font-medium uppercase tracking-widest"
          style={{ color: "var(--accent-strong)" }}
        >
          {greeting}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--app-text)]">
          {user?.name?.split(" ")[0]}
        </h1>
        <p className="mt-2 text-sm text-[var(--app-muted)]">
          {exams.length > 0
            ? `You have ${exams.length} exam${exams.length > 1 ? "s" : ""} waiting`
            : "No exams scheduled right now"}
        </p>
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
              className="group relative overflow-hidden rounded-2xl border p-6 transition-all duration-300"
              style={{
                background: "var(--panel-bg)",
                borderColor: "var(--app-border)",
                boxShadow: "var(--panel-shadow)",
              }}
            >
              <div
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(14, 165, 233, 0.04) 0%, rgba(14, 165, 233, 0) 100%)",
                }}
              />

              <div className="relative flex items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <span
                    className="mb-3 inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium"
                    style={{
                      color: "var(--accent-strong)",
                      background: "var(--accent-soft)",
                      borderColor: "rgba(14, 165, 233, 0.18)",
                    }}
                  >
                    {exam.subject}
                  </span>

                  <h2 className="mb-3 text-lg font-semibold leading-snug text-[var(--app-text)]">
                    {exam.title}
                  </h2>

                  {exam.description && (
                    <p className="mb-4 text-sm text-[var(--app-muted)] line-clamp-1">
                      {exam.description}
                    </p>
                  )}

                  <div className="flex items-center gap-5">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="flex h-4 w-4 items-center justify-center rounded"
                        style={{ background: "var(--panel-strong)" }}
                      >
                        <span
                          className="text-[9px] font-bold"
                          style={{ color: "var(--accent-strong)" }}
                        >
                          Q
                        </span>
                      </div>
                      <span className="text-xs text-[var(--app-muted)]">
                        {exam.questions.length} questions
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <FiClock
                        className="text-xs"
                        style={{ color: "var(--accent-strong)" }}
                      />
                      <span className="text-xs text-[var(--app-muted)]">
                        {exam.duration} min
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
                      <span className="text-xs text-[var(--app-muted)]">
                        Pass {exam.passingMarks}/{exam.questions.length}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <FiShield className="flex-shrink-0 text-xs text-amber-500/80" />
                    <p className="text-xs text-amber-500/90">
                      AI proctoring active - webcam + object detection enabled
                    </p>
                  </div>
                </div>

                <div className="flex h-full flex-shrink-0 flex-col items-end justify-between gap-4">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => navigate(`/student/exam/${exam._id}`)}
                    className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200"
                    style={{
                      background: "linear-gradient(135deg, #7c3aed 0%, #a21caf 100%)",
                      boxShadow: "0 14px 30px rgba(124, 58, 237, 0.28)",
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
