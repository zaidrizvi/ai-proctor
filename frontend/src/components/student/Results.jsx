import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiAlertTriangle, FiAward, FiCheckCircle, FiClock, FiFileText, FiHash, FiXCircle } from "react-icons/fi";
import api from "../../utils/api.js";

const Results = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const { data } = await api.get("/reports/my-results");
        setSessions(data);
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--app-text)]">My Results</h1>
        <p className="mt-1 text-sm text-[var(--app-muted)]">
          {sessions.length} exam{sessions.length !== 1 ? "s" : ""} attempted
        </p>
      </div>

      {sessions.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex h-64 flex-col items-center justify-center text-center"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background: "var(--panel-strong)" }}>
            <FiAward className="text-2xl text-[var(--app-subtle)]" />
          </div>
          <h3 className="mb-1 font-semibold text-[var(--app-text)]">No results yet</h3>
          <p className="mb-4 text-sm text-[var(--app-muted)]">Take an exam to see your results here</p>
          <button
            onClick={() => navigate("/student/dashboard")}
            className="theme-primary-btn rounded-2xl px-4 py-2.5 text-sm font-medium"
          >
            View Exams
          </button>
        </motion.div>
      ) : (
        <div className="grid gap-4">
          {sessions.map((session, index) => (
            <motion.div
              key={session._id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="rounded-[28px] border p-5"
              style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)", boxShadow: "var(--panel-shadow)" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="font-semibold text-[var(--app-text)]">{session.exam?.title || "Exam"}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      session.passed
                        ? "border border-green-500/20 bg-green-500/10 text-green-400"
                        : "border border-red-500/20 bg-red-500/10 text-red-400"
                    }`}>
                      {session.passed ? "PASSED" : "FAILED"}
                    </span>
                    {session.status === "terminated" && (
                      <span className="rounded-full border border-red-500/30 bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                        Terminated
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-[var(--app-muted)]">{session.exam?.subject}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <span className="flex items-center gap-1.5 text-xs text-[var(--app-muted)]">
                      <FiHash className="text-[var(--accent-strong)]" />
                      Score: {session.score}/{session.exam?.questions?.length || "?"}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-[var(--app-muted)]">
                      <FiAward className="text-[var(--accent-strong)]" />
                      {session.percentage}%
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-[var(--app-muted)]">
                      <FiClock className="text-[var(--accent-strong)]" />
                      {new Date(session.createdAt).toLocaleDateString()}
                    </span>
                    {session.suspicionScore > 0 && (
                      <span className={`flex items-center gap-1.5 text-xs ${session.suspicionScore > 70 ? "text-red-400" : "text-amber-500"}`}>
                        <FiAlertTriangle />
                        Suspicion: {session.suspicionScore}%
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-shrink-0 flex-col items-center gap-2">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-full border-2 ${
                    session.passed
                      ? "border-green-500/50 bg-green-500/10"
                      : "border-red-500/50 bg-red-500/10"
                  }`}>
                    {session.passed ? (
                      <FiCheckCircle className="text-xl text-green-400" />
                    ) : (
                      <FiXCircle className="text-xl text-red-400" />
                    )}
                  </div>
                  <button
                    onClick={() => navigate(`/student/report/${session._id}`)}
                    className="flex items-center gap-1 text-xs text-[var(--accent-strong)] transition hover:opacity-80"
                  >
                    <FiFileText className="text-xs" />
                    Report
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Results;
