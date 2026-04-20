import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiActivity,
  FiAlertTriangle,
  FiArrowLeft,
  FiBook,
  FiCheckCircle,
  FiDownload,
  FiShield,
  FiUser,
  FiXCircle,
} from "react-icons/fi";
import Navbar from "../components/shared/Navbar.jsx";
import StatusBadge from "../components/shared/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSocket } from "../context/SocketContext.jsx";
import api from "../utils/api.js";

void motion;
const severityColor = (severity) => {
  if (severity === "high") return "text-red-400 bg-red-500/10 border-red-500/20";
  if (severity === "medium") return "text-amber-500 bg-amber-500/10 border-amber-500/20";
  return "text-sky-500 bg-sky-500/10 border-sky-500/20";
};

const eventLabel = (type) => ({
  face_not_detected: "Face Not Detected",
  multiple_faces: "Multiple Faces",
  gaze_away: "Gaze Away",
  head_turned: "Head Turned",
  audio_detected: "Audio Detected",
  object_detected: "Object Detected",
  tab_switch: "Tab Switch",
  fullscreen_exit: "Fullscreen Exit",
  face_mismatch: "Face Mismatch",
  ml_service_unavailable: "ML Unavailable",
  camera_frame_unavailable: "Camera Frame Unavailable",
}[type] || type);

const getEventKey = (event) => {
  if (event?._id) {
    return `id:${String(event._id)}`;
  }

  return [
    event?.eventType || "",
    event?.severity || "",
    event?.description || "",
    event?.timestamp || "",
  ].join("|");
};

const getSessionOutcome = (session) => {
  if (session.status === "ongoing") {
    return {
      label: "IN PROGRESS",
      accentText: "text-sky-400",
      accentBg: "bg-sky-500/20",
      icon: FiActivity,
    };
  }

  if (session.status === "terminated" || session.status === "abandoned") {
    return {
      label: session.status.toUpperCase(),
      accentText: "text-red-400",
      accentBg: "bg-red-500/20",
      icon: FiXCircle,
    };
  }

  if (session.passed) {
    return {
      label: "PASSED",
      accentText: "text-green-400",
      accentBg: "bg-green-500/20",
      icon: FiCheckCircle,
    };
  }

  return {
    label: "FAILED",
    accentText: "text-red-400",
    accentBg: "bg-red-500/20",
    icon: FiXCircle,
  };
};

const ReportPage = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket, joinExamRoom, leaveExamRoom } = useSocket();
  const isAdmin = user?.role === "admin";
  const fallbackReportRoute = isAdmin ? "/admin/live" : "/student/results";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const reportSessionId = data?.session?._id ? String(data.session._id) : "";
  const reportExamId = data?.session?.exam?._id ? String(data.session.exam._id) : "";
  const reportStudentId = data?.session?.student?._id ? String(data.session.student._id) : "";
  const reportBackRoute = isAdmin && reportExamId
    ? `/admin/live?examId=${encodeURIComponent(reportExamId)}`
    : fallbackReportRoute;

  useEffect(() => {
    const fetchReport = async () => {
      try {
        const res = await api.get(`/reports/session/${sessionId}`);
        setData(res.data);
      } catch {
        navigate(fallbackReportRoute, { replace: true });
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [fallbackReportRoute, navigate, sessionId]);

  useEffect(() => {
    if (!isAdmin || !socket || !reportExamId) {
      return undefined;
    }

    joinExamRoom(reportExamId);

    return () => {
      leaveExamRoom(reportExamId);
    };
  }, [isAdmin, joinExamRoom, leaveExamRoom, reportExamId, socket]);

  useEffect(() => {
    if (!isAdmin || !socket || !reportSessionId) {
      return undefined;
    }

    const isCurrentReportEvent = ({ examId: eventExamId, sessionId: eventSessionId, userId }) => {
      if (reportExamId && String(eventExamId || "") !== reportExamId) {
        return false;
      }

      if (eventSessionId) {
        return String(eventSessionId) === reportSessionId;
      }

      return Boolean(reportStudentId) && String(userId || "") === reportStudentId;
    };

    const handleReceiveAlert = (payload = {}) => {
      if (!isCurrentReportEvent(payload) || !payload.event) {
        return;
      }

      const nextEvent = {
        ...payload.event,
        sessionId: payload.event.sessionId || payload.sessionId || reportSessionId,
        student: payload.userId || reportStudentId,
        timestamp: payload.event.timestamp || new Date().toISOString(),
      };
      const nextEventKey = getEventKey(nextEvent);

      setData((prev) => {
        if (!prev) {
          return prev;
        }

        const currentEvents = Array.isArray(prev.events) ? prev.events : [];
        if (currentEvents.some((event) => getEventKey(event) === nextEventKey)) {
          return prev;
        }

        const nextEvents = [...currentEvents, nextEvent].sort(
          (first, second) => new Date(first.timestamp) - new Date(second.timestamp)
        );

        return {
          ...prev,
          events: nextEvents,
          session: {
            ...prev.session,
            flaggedEventsCount: Number(prev.session?.flaggedEventsCount || currentEvents.length) + 1,
            tabSwitchCount: nextEvent.eventType === "tab_switch"
              ? Number(prev.session?.tabSwitchCount || 0) + 1
              : prev.session?.tabSwitchCount,
            faceNotDetectedCount: nextEvent.eventType === "face_not_detected"
              ? Number(prev.session?.faceNotDetectedCount || 0) + 1
              : prev.session?.faceNotDetectedCount,
          },
        };
      });
    };

    const handleReceiveSuspicion = (payload = {}) => {
      if (!isCurrentReportEvent(payload)) {
        return;
      }

      setData((prev) => {
        if (!prev) {
          return prev;
        }

        const summary = payload.summary || {};

        return {
          ...prev,
          session: {
            ...prev.session,
            suspicionScore: Number(summary.suspicionScore ?? payload.score ?? prev.session?.suspicionScore ?? 0),
            flaggedEventsCount: summary.flaggedEventsCount ?? prev.session?.flaggedEventsCount,
            tabSwitchCount: summary.tabSwitchCount ?? prev.session?.tabSwitchCount,
            faceNotDetectedCount: summary.faceNotDetectedCount ?? prev.session?.faceNotDetectedCount,
          },
        };
      });
    };

    const handleSessionTerminated = (payload = {}) => {
      if (!isCurrentReportEvent(payload)) {
        return;
      }

      setData((prev) => prev
        ? {
            ...prev,
            session: {
              ...prev.session,
              status: "terminated",
              submittedAt: prev.session?.submittedAt || new Date().toISOString(),
            },
          }
        : prev);
    };

    socket.on("receive-alert", handleReceiveAlert);
    socket.on("receive-suspicion", handleReceiveSuspicion);
    socket.on("session-terminated", handleSessionTerminated);

    return () => {
      socket.off("receive-alert", handleReceiveAlert);
      socket.off("receive-suspicion", handleReceiveSuspicion);
      socket.off("session-terminated", handleSessionTerminated);
    };
  }, [isAdmin, reportExamId, reportSessionId, reportStudentId, socket]);

  const handleDownloadPDF = async () => {
    setDownloading(true);
    setDownloadError("");

    try {
      const res = await api.get(`/reports/pdf/${sessionId}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `report-${sessionId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setDownloadError("Failed to download PDF.");
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </div>
    );
  }

  const { session, events } = data;
  const exam = session.exam;
  const student = session.student;
  const totalQuestions = exam?.totalQuestions || exam?.questions?.length || 0;
  const sessionOutcome = getSessionOutcome(session);
  const OutcomeIcon = sessionOutcome.icon;
  const scoreSummary = session.status === "ongoing"
    ? {
        value: "--",
        meta: `${totalQuestions || "-"} questions total`,
      }
    : {
        value: `${session.score}/${totalQuestions}`,
        meta: "Final score",
      };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)]">
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--app-gradient)" }} />

      <div className="relative z-10">
        <Navbar />

        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="theme-panel rounded-[32px] p-6 sm:p-8">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate(reportBackRoute)}
                  className="rounded-2xl p-2"
                  style={{ background: "var(--panel-soft)", color: "var(--app-muted)" }}
                >
                  <FiArrowLeft />
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--app-text)]">Exam Report</h1>
                  <p className="text-sm text-[var(--app-muted)]">{exam?.title}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                <StatusBadge tone={session.status === "completed" && session.passed ? "success" : session.status === "ongoing" ? "info" : "danger"}>
                  {sessionOutcome.label}
                </StatusBadge>

                {isAdmin && (
                  <button
                    onClick={handleDownloadPDF}
                    disabled={downloading}
                    className="theme-primary-btn flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    {downloading ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : (
                      <FiDownload />
                    )}
                    Download PDF
                  </button>
                )}
              </div>
            </div>

            {downloadError && (
              <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {downloadError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-[24px] border p-4"
                  style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)" }}
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${sessionOutcome.accentBg}`}>
                      <OutcomeIcon className={`text-xl ${sessionOutcome.accentText}`} />
                    </div>
                    <div>
                      <p className={`text-base font-bold ${sessionOutcome.accentText}`}>
                        {sessionOutcome.label}
                      </p>
                      <p className="text-sm text-[var(--app-muted)]">{exam?.subject}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        label: "Score",
                        value: scoreSummary.value,
                        meta: scoreSummary.meta,
                      },
                      {
                        label: "Percentage",
                        value: session.status === "ongoing" ? "-" : `${session.percentage}%`,
                        meta: session.status === "ongoing" ? "Available after submission" : "Final percentage",
                      },
                      {
                        label: "Passing Marks",
                        value: exam?.passingMarks,
                        meta: "Required to pass",
                      },
                    ].map(({ label, value, meta }) => (
                      <div key={label} className="rounded-2xl px-3 py-2.5 text-center" style={{ background: "var(--panel-strong)" }}>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]">{label}</p>
                        <p className="mt-1.5 text-[1.45rem] font-bold leading-none text-[var(--app-text)]">{value}</p>
                        <p className="mt-0.5 text-[10px] text-[var(--app-subtle)]">{meta}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {isAdmin ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="rounded-[24px] border p-5"
                    style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)" }}
                  >
                    <h2 className="mb-4 flex items-center gap-2 font-semibold text-[var(--app-text)]">
                      <FiActivity className="text-[var(--accent-strong)]" />
                      Flagged Events Timeline
                    </h2>

                    {events.length === 0 ? (
                      <div className="py-8 text-center">
                        <FiCheckCircle className="mx-auto mb-2 text-3xl text-green-400" />
                        <p className="text-sm text-[var(--app-muted)]">No flagged events. Clean exam.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {events.map((event, index) => (
                          <div key={index} className={`flex items-start gap-3 rounded-xl border p-3 ${severityColor(event.severity)}`}>
                            <FiAlertTriangle className="mt-0.5 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium">{eventLabel(event.eventType)}</p>
                                <p className="flex-shrink-0 text-xs opacity-70">
                                  {new Date(event.timestamp).toLocaleTimeString()}
                                </p>
                              </div>
                              {event.description && (
                                <p className="mt-0.5 text-xs opacity-70">{event.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="rounded-[24px] border p-5 text-center"
                    style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)" }}
                  >
                    <FiShield className="mx-auto mb-3 text-3xl text-[var(--accent-strong)]" />
                    <p className="mb-1 font-semibold text-[var(--app-text)]">Proctoring details are private</p>
                    <p className="text-sm text-[var(--app-muted)]">
                      Only your invigilator can view the detailed proctoring report.
                    </p>
                  </motion.div>
                )}

              </div>

              <div className="space-y-4">
                {isAdmin && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="rounded-[24px] border p-5"
                    style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)" }}
                  >
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
                      <FiUser className="text-[var(--accent-strong)]" />
                      Student
                    </h2>
                    <div className="space-y-1.5">
                      <p className="font-medium text-[var(--app-text)]">{student?.name}</p>
                      <p className="text-sm text-[var(--app-muted)]">{student?.email}</p>
                    </div>
                  </motion.div>
                )}

                {isAdmin && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 }}
                    className="rounded-[24px] border p-5"
                    style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)" }}
                  >
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
                      <FiShield className="text-[var(--accent-strong)]" />
                      Identity Check
                    </h2>
                    <div className="space-y-3">
                      <div>
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                          Registered Face
                        </p>
                        {student?.faceImagePath ? (
                          <img
                            src={student.faceImagePath}
                            alt="Registered student face"
                            className="h-36 w-full rounded-2xl border object-cover"
                            style={{ borderColor: "var(--app-border)" }}
                          />
                        ) : (
                          <div className="flex h-36 items-center justify-center rounded-2xl border text-sm text-[var(--app-muted)]" style={{ borderColor: "var(--app-border)" }}>
                            No registered face saved
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                          Exam Verification Face
                        </p>
                        {session?.verificationFaceImagePath ? (
                          <img
                            src={session.verificationFaceImagePath}
                            alt="Exam verification face"
                            className="h-36 w-full rounded-2xl border object-cover"
                            style={{ borderColor: "var(--app-border)" }}
                          />
                        ) : (
                          <div className="flex h-36 items-center justify-center rounded-2xl border text-sm text-[var(--app-muted)]" style={{ borderColor: "var(--app-border)" }}>
                            No exam verification image saved
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="rounded-[24px] border p-5"
                  style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)" }}
                >
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
                    <FiBook className="text-[var(--accent-strong)]" />
                    Exam Info
                  </h2>
                  <div className="space-y-2.5 text-sm">
                    {[
                      { label: "Duration", value: `${exam?.duration} mins` },
                      { label: "Started", value: new Date(session.startedAt).toLocaleString() },
                      { label: "Submitted", value: session.submittedAt ? new Date(session.submittedAt).toLocaleString() : "-" },
                      { label: "Status", value: session.status.toUpperCase() },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between gap-4">
                        <span className="text-[var(--app-muted)]">{label}</span>
                        <span className="text-right text-[var(--app-text)]">{value}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {isAdmin && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="rounded-[24px] border p-5"
                    style={{ background: "var(--panel-bg)", borderColor: "var(--app-border)" }}
                  >
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--app-text)]">
                      <FiShield className="text-[var(--accent-strong)]" />
                      Proctor Summary
                    </h2>
                    <div className="space-y-2.5 text-sm">
                      {[
                        { label: "Suspicion Score", value: `${session.suspicionScore}/100`, highlight: session.suspicionScore > 70 },
                        { label: "Flagged Events", value: session.flaggedEventsCount },
                        { label: "Tab Switches", value: session.tabSwitchCount },
                        { label: "Face Not Detected", value: `${session.faceNotDetectedCount}x` },
                      ].map(({ label, value, highlight }) => (
                        <div key={label} className="flex justify-between gap-4">
                          <span className="text-[var(--app-muted)]">{label}</span>
                          <span className={highlight ? "font-semibold text-red-400" : "text-[var(--app-text)]"}>
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportPage;
