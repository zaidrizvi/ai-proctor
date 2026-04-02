import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiAlertTriangle, FiAward, FiClock, FiFileText, FiHash } from "react-icons/fi";
import api from "../../utils/api.js";
import StatusBadge from "../shared/StatusBadge.jsx";

const Results = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const { data } = await api.get("/reports/my-results");
        const enrichedSessions = await Promise.all(
          data.map(async (session) => {
            if (session.exam?.questions?.length || session.exam?.totalQuestions) {
              return session;
            }

            try {
              const { data: reportData } = await api.get(`/reports/session/${session._id}`);
              const totalQuestions = reportData?.session?.exam?.questions?.length || 0;
              const passingMarks = reportData?.session?.exam?.passingMarks;

              return {
                ...session,
                exam: {
                  ...session.exam,
                  totalQuestions,
                  passingMarks,
                },
              };
            } catch {
              return session;
            }
          })
        );

        setSessions(enrichedSessions);
      } catch {
        setError("Failed to load results.");
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
    <div className="space-y-4">
      <div className="theme-panel relative overflow-hidden rounded-[24px] px-4 py-3.5">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-52 opacity-70"
          style={{ background: "radial-gradient(circle at center, rgba(14, 165, 233, 0.12), transparent 65%)" }}
        />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--accent-strong)]">Result History</p>
            <h1 className="mt-1 text-[1.75rem] font-semibold tracking-tight text-[var(--app-text)]">My Results</h1>
            <p className="mt-1 text-sm text-[var(--app-muted)]">
              Review completed sessions and open full reports when needed.
            </p>
          </div>
          <div className="rounded-2xl border px-3.5 py-2" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--app-subtle)]">Attempts</p>
            <p className="mt-0.5 text-[1.1rem] font-semibold text-[var(--app-text)]">{sessions.length}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <FiAlertTriangle className="flex-shrink-0" />
          {error}
        </div>
      )}

      {sessions.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="theme-panel flex h-64 flex-col items-center justify-center rounded-[28px] text-center"
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
            <ResultCard
              key={session._id}
              session={session}
              index={index}
              onOpenReport={() => navigate(`/student/report/${session._id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ResultCard = ({ session, index, onOpenReport }) => {
  const totalQuestions = session.exam?.totalQuestions || session.exam?.questions?.length || "?";
  const statusTone = session.status === "terminated"
    ? "danger"
    : session.passed
    ? "success"
    : "danger";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group relative overflow-hidden rounded-[24px] border px-4 py-3"
      style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)", boxShadow: "var(--panel-shadow)" }}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
        style={{
          background: session.passed
            ? "linear-gradient(180deg, rgba(34, 197, 94, 0.9), rgba(16, 185, 129, 0.5))"
            : "linear-gradient(180deg, rgba(239, 68, 68, 0.9), rgba(248, 113, 113, 0.5))",
        }}
      />

      <div className="relative flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[1.18rem] font-semibold tracking-tight text-[var(--app-text)]">
              {session.exam?.title || "Exam"}
            </h3>
            <StatusBadge tone={statusTone}>
              {session.status === "terminated" ? "Terminated" : session.passed ? "Passed" : "Failed"}
            </StatusBadge>
          </div>

          <p className="mt-0.5 text-sm font-medium text-[var(--accent-strong)]">{session.exam?.subject}</p>

          <div className="mt-2 flex flex-wrap gap-2">
            <div className="flex min-w-[118px] items-center gap-2 rounded-2xl border px-2.5 py-1.5" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <FiHash className="text-[13px]" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-subtle)]">Score</p>
                <p className="text-sm font-medium text-[var(--app-text)]">{session.score}/{totalQuestions}</p>
              </div>
            </div>
            <div className="flex min-w-[106px] items-center gap-2 rounded-2xl border px-2.5 py-1.5" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <FiAward className="text-[13px]" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-subtle)]">Result</p>
                <p className="text-sm font-medium text-[var(--app-text)]">{session.percentage}%</p>
              </div>
            </div>
            <div className="flex min-w-[132px] items-center gap-2 rounded-2xl border px-2.5 py-1.5" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                <FiClock className="text-[13px]" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-subtle)]">Submitted</p>
                <p className="text-sm font-medium text-[var(--app-text)]">{new Date(session.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          {session.suspicionScore > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <FiAlertTriangle className={session.suspicionScore > 70 ? "text-red-400" : "text-amber-400"} />
              <span className={session.suspicionScore > 70 ? "text-red-400" : "text-amber-400"}>
                Suspicion score: {session.suspicionScore}%
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 xl:self-center">
          <button
            onClick={onOpenReport}
            className="theme-soft-btn flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-medium"
          >
            <FiFileText className="text-xs" />
            Report
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default Results;
