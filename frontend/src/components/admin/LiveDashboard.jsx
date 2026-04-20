import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import api from "../../utils/api.js";
import { useSocket } from "../../context/SocketContext.jsx";
import ConfirmationDialog from "../shared/ConfirmationDialog.jsx";
import StatusBadge from "../shared/StatusBadge.jsx";
import {
  FiActivity,
  FiAlertTriangle,
  FiCheckCircle,
  FiFileText,
  FiMonitor,
  FiShield,
  FiUsers,
  FiXCircle,
} from "react-icons/fi";

const normalizeOnlineUserIds = (onlineUserIds = []) =>
  new Set((onlineUserIds || []).map((userId) => String(userId)));

const buildStudentMap = (sessions = [], onlineUserIds = []) => {
  const onlineSet = normalizeOnlineUserIds(onlineUserIds);
  const map = {};

  sessions.forEach((session) => {
    const studentId = String(session.student._id);
    map[studentId] = {
      name: session.student.name,
      email: session.student.email,
      sessionId: session._id,
      score: session.score,
      percentage: session.percentage,
      suspicionScore: session.suspicionScore,
      flaggedEventsCount: session.flaggedEventsCount,
      tabSwitchCount: session.tabSwitchCount,
      status: session.status,
      alerts: [],
      online: onlineSet.has(studentId),
    };
  });

  return map;
};

const severityStyles = {
  high: "border-red-500/25 bg-red-500/10 text-red-300",
  medium: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  low: "border-sky-500/25 bg-sky-500/10 text-sky-200",
};

const statusToneMap = {
  completed: "success",
  terminated: "danger",
  ongoing: "info",
};

const getSuspicionTone = (score = 0) => {
  if (score > 70) return "danger";
  if (score > 40) return "warning";
  return "success";
};

const getSuspicionLabel = (score = 0) => {
  if (score > 70) return "High";
  if (score > 40) return "Moderate";
  return "Normal";
};

const LiveDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { socket, joinExamRoom, leaveExamRoom } = useSocket();

  const examId = new URLSearchParams(location.search).get("examId");

  const [exams, setExams] = useState([]);
  const [selectedExam, setSelectedExam] = useState(examId || "");
  const [sessions, setSessions] = useState([]);
  const [students, setStudents] = useState({});
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [panelMessage, setPanelMessage] = useState({ type: "", text: "" });
  const [pendingTermination, setPendingTermination] = useState(null);
  const [terminating, setTerminating] = useState(false);

  useEffect(() => {
    api.get("/exams").then(({ data }) => setExams(data));
  }, []);

  useEffect(() => {
    let cancelled = false;

    setRecentAlerts([]);
    setSessions([]);
    setStudents({});
    setPanelMessage({ type: "", text: "" });

    if (!selectedExam) {
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    api.get(`/exams/${selectedExam}/sessions`)
      .then(({ data }) => {
        if (cancelled) return;

        setSessions(data);
        setStudents(buildStudentMap(data, onlineUserIds));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedExam]);

  useEffect(() => {
    setStudents((prev) => {
      const next = buildStudentMap(sessions, onlineUserIds);

      Object.entries(prev).forEach(([userId, student]) => {
        if (!next[userId]) {
          return;
        }

        next[userId] = {
          ...next[userId],
          alerts: student.alerts || [],
        };
      });

      return next;
    });
  }, [onlineUserIds, sessions]);

  useEffect(() => {
    if (!selectedExam || !socket) return;

    joinExamRoom(selectedExam);
    return () => {
      leaveExamRoom(selectedExam);
    };
  }, [joinExamRoom, leaveExamRoom, selectedExam, socket]);

  useEffect(() => {
    if (!socket) return;

    socket.on("presence-sync", ({ examId: eventExamId, onlineUserIds }) => {
      if (!selectedExam || eventExamId !== selectedExam) return;

      setOnlineUserIds(onlineUserIds || []);

      const onlineSet = normalizeOnlineUserIds(onlineUserIds);
      setStudents((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((userId) => {
          next[userId] = {
            ...next[userId],
            online: onlineSet.has(userId),
          };
        });
        return next;
      });
    });

    socket.on("student-joined", ({ examId: eventExamId, userId }) => {
      if (!selectedExam || eventExamId !== selectedExam) return;

      const normalizedUserId = String(userId);
      setStudents((prev) => ({
        ...prev,
        [normalizedUserId]: { ...(prev[normalizedUserId] || {}), online: true },
      }));
    });

    socket.on("student-left", ({ examId: eventExamId, userId }) => {
      if (!selectedExam || eventExamId !== selectedExam) return;

      const normalizedUserId = String(userId);
      setStudents((prev) => ({
        ...prev,
        [normalizedUserId]: { ...(prev[normalizedUserId] || {}), online: false },
      }));
    });

    socket.on("receive-alert", ({ examId: eventExamId, userId, studentName, event }) => {
      if (!selectedExam || eventExamId !== selectedExam) return;

      const normalizedUserId = String(userId);
      const alert = { userId: normalizedUserId, studentName, event, time: new Date() };
      setRecentAlerts((prev) => [alert, ...prev].slice(0, 20));

      setStudents((prev) => ({
        ...prev,
        [normalizedUserId]: {
          ...(prev[normalizedUserId] || { name: studentName }),
          alerts: [event, ...(prev[normalizedUserId]?.alerts || [])].slice(0, 5),
          flaggedEventsCount: (prev[normalizedUserId]?.flaggedEventsCount || 0) + 1,
        },
      }));
    });

    socket.on("receive-suspicion", ({ examId: eventExamId, userId, score }) => {
      if (!selectedExam || eventExamId !== selectedExam) return;

      const normalizedUserId = String(userId);
      setStudents((prev) => ({
        ...prev,
        [normalizedUserId]: { ...(prev[normalizedUserId] || {}), suspicionScore: score },
      }));
    });

    socket.on("session-terminated", ({ examId: eventExamId, userId }) => {
      if (!selectedExam || eventExamId !== selectedExam) return;

      const normalizedUserId = String(userId);
      setStudents((prev) => ({
        ...prev,
        [normalizedUserId]: { ...(prev[normalizedUserId] || {}), status: "terminated", online: false },
      }));
    });

    return () => {
      socket.off("presence-sync");
      socket.off("student-joined");
      socket.off("student-left");
      socket.off("receive-alert");
      socket.off("receive-suspicion");
      socket.off("session-terminated");
    };
  }, [selectedExam, socket]);

  const handleTerminate = async () => {
    if (!pendingTermination?.sessionId) return;

    setTerminating(true);
    try {
      await api.post(`/proctor/terminate/${pendingTermination.sessionId}`);
      setSessions((prev) =>
        prev.map((session) =>
          session._id === pendingTermination.sessionId
            ? { ...session, status: "terminated" }
            : session
        )
      );
      setStudents((prev) => ({
        ...prev,
        [pendingTermination.userId]: {
          ...(prev[pendingTermination.userId] || {}),
          status: "terminated",
          online: false,
        },
      }));
      setPanelMessage({
        type: "success",
        text: `${pendingTermination.studentName}'s session has been terminated.`,
      });
      setPendingTermination(null);
    } catch {
      setPanelMessage({
        type: "error",
        text: "Failed to terminate the session. Please try again.",
      });
    } finally {
      setTerminating(false);
    }
  };

  const studentList = Object.entries(students);
  const onlineCount = studentList.filter(([, student]) => student.online).length;
  const highAlertCount = studentList.filter(([, student]) => student.suspicionScore > 70).length;
  const selectedExamMeta = exams.find((exam) => exam._id === selectedExam);

  const statCards = [
    { label: "Tracked Sessions", value: studentList.length, meta: `${sessions.length} loaded`, icon: FiUsers, tone: "info" },
    { label: "Online Now", value: onlineCount, meta: "students online", icon: FiActivity, tone: "success" },
    { label: "High Suspicion", value: highAlertCount, meta: "flagged now", icon: FiAlertTriangle, tone: "danger" },
    { label: "Live Alerts", value: recentAlerts.length, meta: "recent feed", icon: FiShield, tone: "warning" },
  ];

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--accent-strong)]">
              Live Proctoring
            </p>
            <h1 className="theme-page-title mt-1.5 text-[2.1rem]">Live Dashboard</h1>
            <p className="theme-page-subtitle mt-1.5 text-[0.98rem]">
              Monitor active sessions, watch suspicion patterns, and review alerts in real time.
            </p>
          </div>

          <div className="theme-panel flex flex-col gap-2.5 rounded-[24px] p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--app-muted)]">
                Exam To Monitor
              </label>
              <select
                value={selectedExam}
                onChange={(event) => setSelectedExam(event.target.value)}
                className="theme-input theme-select w-full rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              >
                <option value="">Select an exam</option>
                {exams.map((exam) => (
                  <option key={exam._id} value={exam._id}>
                    {exam.title} - {exam.subject}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl border px-4 py-2.5 text-sm" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-subtle)]">
                Current Scope
              </p>
              <p className="mt-0.5 text-[var(--app-text)]">
                {selectedExamMeta ? selectedExamMeta.title : "No exam selected"}
              </p>
            </div>
          </div>
        </div>

        {panelMessage.text && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              panelMessage.type === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {panelMessage.text}
          </div>
        )}

        {!selectedExam ? (
          <div className="theme-panel flex min-h-[280px] flex-col items-center justify-center rounded-[28px] px-6 py-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <FiMonitor className="text-2xl" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--app-text)]">Choose an exam to begin monitoring</h2>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--app-muted)]">
              Once an exam is selected, this dashboard will show live presence, suspicion signals,
              recent alerts, and direct access to student reports.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {statCards.map(({ label, value, meta, icon: Icon, tone }) => (
                <div key={label} className="theme-stat-card rounded-[22px] px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--app-muted)]">{label}</p>
                      <div className="mt-1 flex items-end gap-2">
                        <p className="text-[1.85rem] font-semibold leading-none tracking-tight text-[var(--app-text)]">{value}</p>
                        <p className="pb-0.5 text-[11px] text-[var(--app-subtle)]">
                          {meta}
                        </p>
                      </div>
                    </div>
                    <div
                      className={`flex h-8.5 w-8.5 items-center justify-center rounded-2xl ${
                        tone === "danger"
                          ? "bg-red-500/12 text-red-300"
                          : tone === "success"
                          ? "bg-emerald-500/12 text-emerald-300"
                          : tone === "warning"
                          ? "bg-amber-500/12 text-amber-200"
                          : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                      }`}
                    >
                      <Icon className="text-[15px]" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.95fr)]">
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--app-text)]">
                      Student Sessions
                    </h2>
                    <p className="mt-0.5 text-sm text-[var(--app-muted)]">
                      Live presence, suspicion score, and recent alerts for each student.
                    </p>
                  </div>
                  <StatusBadge tone="info">{studentList.length} active records</StatusBadge>
                </div>

                {loading ? (
                  <div className="theme-panel flex h-40 items-center justify-center rounded-[28px]">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent-strong)] border-t-transparent" />
                  </div>
                ) : studentList.length === 0 ? (
                  <div className="theme-panel flex min-h-[240px] flex-col items-center justify-center rounded-[24px] px-6 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-[var(--panel-strong)] text-[var(--app-subtle)]">
                      <FiUsers className="text-2xl" />
                    </div>
                    <p className="font-semibold text-[var(--app-text)]">No students have started this exam yet</p>
                    <p className="mt-2 max-w-md text-sm text-[var(--app-muted)]">
                      Keep this page open and the dashboard will populate as soon as students join.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <AnimatePresence>
                      {studentList.map(([userId, student]) => (
                        <motion.div
                          key={userId}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="theme-panel rounded-[24px] p-4"
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-3">
                                <div className="relative flex-shrink-0">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent-strong)]">
                                    {student.name?.charAt(0).toUpperCase()}
                                  </div>
                                  <span
                                    className={`absolute -right-1 -bottom-1 h-3 w-3 rounded-full border-2 ${
                                      student.online ? "bg-emerald-400" : "bg-slate-500"
                                    }`}
                                    style={{ borderColor: "var(--panel-bg)" }}
                                  />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-[1.05rem] font-semibold text-[var(--app-text)]">{student.name}</p>
                                    <StatusBadge tone={student.online ? "success" : "warning"}>
                                      {student.online ? "Online" : "Offline"}
                                    </StatusBadge>
                                    <StatusBadge tone={statusToneMap[student.status] || "warning"}>
                                      {student.status || "Not started"}
                                    </StatusBadge>
                                  </div>
                                  <p className="mt-0.5 truncate text-sm text-[var(--app-muted)]">{student.email}</p>
                                </div>
                              </div>

                              <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
                                <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                                  <p className="text-[10px] font-medium uppercase tracking-[0.17em] text-[var(--app-subtle)]">Suspicion</p>
                                  <div className="mt-1 flex items-center gap-1.5">
                                    <p className="text-[1.6rem] font-semibold leading-none text-[var(--app-text)]">{student.suspicionScore || 0}</p>
                                    <StatusBadge tone={getSuspicionTone(student.suspicionScore)}>
                                      {getSuspicionLabel(student.suspicionScore)}
                                    </StatusBadge>
                                  </div>
                                </div>
                                <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                                  <p className="text-[10px] font-medium uppercase tracking-[0.17em] text-[var(--app-subtle)]">Flagged Events</p>
                                  <p className="mt-1 text-[1.6rem] font-semibold leading-none text-[var(--app-text)]">
                                    {student.flaggedEventsCount || 0}
                                  </p>
                                </div>
                                <div className="rounded-2xl border px-3 py-2" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                                  <p className="text-[10px] font-medium uppercase tracking-[0.17em] text-[var(--app-subtle)]">Tab Switches</p>
                                  <p className="mt-1 text-[1.6rem] font-semibold leading-none text-[var(--app-text)]">
                                    {student.tabSwitchCount || 0}
                                  </p>
                                </div>
                              </div>

                              {student.alerts?.length > 0 && (
                                <div className="mt-3 space-y-2">
                                  {student.alerts.slice(0, 2).map((alert, index) => (
                                    <div
                                      key={`${student.sessionId}-${index}`}
                                      className={`rounded-2xl border px-3 py-2 text-xs ${severityStyles[alert.severity] || severityStyles.low}`}
                                    >
                                      {alert.description || alert.eventType}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {(student.status === "ongoing" || student.status === "completed") && (
                              <div className="flex flex-col gap-2 lg:w-44">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/admin/report/${student.sessionId}`)}
                                  className="theme-soft-btn flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium"
                                >
                                  <FiFileText className="text-sm" />
                                  View Report
                                </button>
                                {student.status === "ongoing" && (
                                  <button
                                    type="button"
                                    onClick={() => setPendingTermination({
                                      sessionId: student.sessionId,
                                      studentName: student.name,
                                      userId,
                                    })}
                                    className="theme-danger-btn flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium"
                                  >
                                    <FiXCircle className="text-sm" />
                                    Terminate
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--app-text)]">
                    Live Alert Feed
                  </h2>
                  <p className="mt-0.5 text-sm text-[var(--app-muted)]">
                    The newest proctoring alerts appear here first for quick triage.
                  </p>
                </div>

                <div className="theme-panel theme-scrollbar max-h-[680px] overflow-auto rounded-[24px] p-3.5">
                  {recentAlerts.length === 0 ? (
                    <div className="flex min-h-[200px] flex-col items-center justify-center text-center">
                      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-300">
                        <FiCheckCircle className="text-xl" />
                      </div>
                      <p className="font-semibold text-[var(--app-text)]">No alerts yet</p>
                      <p className="mt-1.5 text-sm text-[var(--app-muted)]">
                        This feed will update as soon as the exam produces proctoring events.
                      </p>
                    </div>
                  ) : (
                    <AnimatePresence>
                      <div className="space-y-2.5">
                        {recentAlerts.map((alert, index) => (
                          <motion.div
                            key={`${alert.userId}-${alert.time}-${index}`}
                            initial={{ opacity: 0, x: 18 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`rounded-2xl border p-3 text-sm ${severityStyles[alert.event?.severity] || severityStyles.low}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold">{alert.studentName}</p>
                                <p className="mt-1 text-xs opacity-80">
                                  {alert.event?.description || alert.event?.eventType}
                                </p>
                              </div>
                              <p className="shrink-0 text-[11px] opacity-70">
                                {new Date(alert.time).toLocaleTimeString()}
                              </p>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </AnimatePresence>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </div>

      <ConfirmationDialog
        open={Boolean(pendingTermination)}
        title="Terminate Student Session?"
        description={
          pendingTermination
            ? `This will immediately end ${pendingTermination.studentName}'s active exam session and cannot be undone from the dashboard.`
            : ""
        }
        confirmLabel="Terminate Session"
        loading={terminating}
        onCancel={() => !terminating && setPendingTermination(null)}
        onConfirm={handleTerminate}
      />
    </>
  );
};

export default LiveDashboard;
