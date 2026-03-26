import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import api from "../../utils/api.js";
import { useSocket } from "../../../src/context/SocketContext.jsx";
import {
  FiMonitor, FiAlertTriangle, FiUsers, FiActivity,
  FiShield, FiXCircle, FiCheckCircle, FiFileText
} from "react-icons/fi";

const severityColor = (severity) => {
  if (severity === "high") return "border-red-500/30 bg-red-500/10 text-red-400";
  if (severity === "medium") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-400";
  return "border-blue-500/30 bg-blue-500/10 text-blue-400";
};

const LiveDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { socket, joinExamRoom, leaveExamRoom } = useSocket();

  const examId = new URLSearchParams(location.search).get("examId");

  const [exams, setExams] = useState([]);
  const [selectedExam, setSelectedExam] = useState(examId || "");
  const [sessions, setSessions] = useState([]);
  const [students, setStudents] = useState({}); // { userId: { name, score, alerts[], online } }
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(false);

  // fetch admin exams for selector
  useEffect(() => {
    api.get("/exams").then(({ data }) => setExams(data));
  }, []);

  // fetch sessions when exam selected
  useEffect(() => {
    let cancelled = false;

    setRecentAlerts([]);
    setSessions([]);
    setStudents({});

    if (!selectedExam) return () => {
      cancelled = true;
    };
    setLoading(true);
    api.get(`/exams/${selectedExam}/sessions`)
      .then(({ data }) => {
        if (cancelled) return;
        setSessions(data);
        // init student map
        const map = {};
        data.forEach((s) => {
          map[s.student._id] = {
            name: s.student.name,
            email: s.student.email,
            sessionId: s._id,
            score: s.score,
            percentage: s.percentage,
            suspicionScore: s.suspicionScore,
            flaggedEventsCount: s.flaggedEventsCount,
            tabSwitchCount: s.tabSwitchCount,
            status: s.status,
            alerts: [],
            online: false,
          };
        });
        setStudents(map);
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
    if (!selectedExam || !socket) return;
    joinExamRoom(selectedExam);
    return () => {
      leaveExamRoom(selectedExam);
    };
  }, [joinExamRoom, leaveExamRoom, selectedExam, socket]);

  // socket listeners
  useEffect(() => {
    if (!socket) return;

    socket.on("presence-sync", ({ examId: eventExamId, onlineUserIds }) => {
      if (!selectedExam || eventExamId !== selectedExam) {
        return;
      }
      const onlineSet = new Set(onlineUserIds || []);
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
      if (!selectedExam || eventExamId !== selectedExam) {
        return;
      }
      setStudents((prev) => ({
        ...prev,
        [userId]: { ...(prev[userId] || {}), online: true },
      }));
    });

    socket.on("student-left", ({ examId: eventExamId, userId }) => {
      if (!selectedExam || eventExamId !== selectedExam) {
        return;
      }
      setStudents((prev) => ({
        ...prev,
        [userId]: { ...(prev[userId] || {}), online: false },
      }));
    });

    socket.on("receive-alert", ({ examId: eventExamId, userId, studentName, event }) => {
      if (!selectedExam || eventExamId !== selectedExam) {
        return;
      }
      const alert = { userId, studentName, event, time: new Date() };

      // add to recent alerts
      setRecentAlerts((prev) => [alert, ...prev].slice(0, 20));

      // add to student's alert list
      setStudents((prev) => ({
        ...prev,
        [userId]: {
          ...(prev[userId] || { name: studentName }),
          alerts: [event, ...(prev[userId]?.alerts || [])].slice(0, 5),
          flaggedEventsCount: (prev[userId]?.flaggedEventsCount || 0) + 1,
        },
      }));
    });

    socket.on("receive-suspicion", ({ examId: eventExamId, userId, score }) => {
      if (!selectedExam || eventExamId !== selectedExam) {
        return;
      }
      setStudents((prev) => ({
        ...prev,
        [userId]: { ...(prev[userId] || {}), suspicionScore: score },
      }));
    });

    socket.on("session-terminated", ({ examId: eventExamId, userId }) => {
      if (!selectedExam || eventExamId !== selectedExam) {
        return;
      }
      setStudents((prev) => ({
        ...prev,
        [userId]: { ...(prev[userId] || {}), status: "terminated", online: false },
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

  const handleTerminate = async (sessionId, studentName) => {
    if (!confirm(`Terminate ${studentName}'s session?`)) return;
    try {
      await api.post(`/proctor/terminate/${sessionId}`);
      setSessions((prev) =>
        prev.map((s) => s._id === sessionId ? { ...s, status: "terminated" } : s)
      );
    } catch {
      alert("Failed to terminate session");
    }
  };

  const studentList = Object.entries(students);
  const onlineCount = studentList.filter(([, s]) => s.online).length;
  const highAlertCount = studentList.filter(([, s]) => s.suspicionScore > 70).length;

  return (
    <div>
      {/* header */}
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Live Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Monitor students in real time</p>
      </div>

      {/* exam selector */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6">
        <label className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2 block">
          Select Exam to Monitor
        </label>
        <select
          value={selectedExam}
          onChange={(e) => setSelectedExam(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 transition"
        >
          <option value="">-- Select an exam --</option>
          {exams.map((exam) => (
            <option key={exam._id} value={exam._id}>
              {exam.title} — {exam.subject}
            </option>
          ))}
        </select>
      </div>

      {!selectedExam ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <FiMonitor className="text-gray-700 text-4xl mb-3" />
          <p className="text-gray-500 text-sm">Select an exam to start monitoring</p>
        </div>
      ) : (
        <>
          {/* stats row */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: "Total Students", value: studentList.length, icon: FiUsers, color: "text-purple-400" },
              { label: "Online Now", value: onlineCount, icon: FiActivity, color: "text-green-400" },
              { label: "High Suspicion", value: highAlertCount, icon: FiAlertTriangle, color: "text-red-400" },
              { label: "Recent Alerts", value: recentAlerts.length, icon: FiShield, color: "text-yellow-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-500 text-xs">{label}</p>
                  <Icon className={`${color} text-sm`} />
                </div>
                <p className="text-white text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* student cards */}
            <div className="lg:col-span-2">
              <h2 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
                Students ({studentList.length})
              </h2>

              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : studentList.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
                  <FiUsers className="text-gray-600 text-3xl mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">No students have started this exam yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence>
                    {studentList.map(([userId, student]) => (
                      <motion.div
                        key={userId}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`bg-gray-900 border rounded-xl p-4 transition-colors ${
                          student.suspicionScore > 70
                            ? "border-red-500/30"
                            : "border-gray-800"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            {/* avatar */}
                            <div className="relative flex-shrink-0">
                              <div className="w-9 h-9 bg-purple-700 rounded-full flex items-center justify-center text-white text-sm font-bold">
                                {student.name?.charAt(0).toUpperCase()}
                              </div>
                              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-900 ${
                                student.online ? "bg-green-400" : "bg-gray-600"
                              }`} />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm font-medium truncate">{student.name}</p>
                              <p className="text-gray-500 text-xs truncate">{student.email}</p>
                            </div>
                          </div>

                          {/* suspicion score */}
                          <div className="text-center flex-shrink-0">
                            <p className={`text-lg font-bold ${
                              student.suspicionScore > 70 ? "text-red-400"
                              : student.suspicionScore > 40 ? "text-yellow-400"
                              : "text-green-400"
                            }`}>
                              {student.suspicionScore || 0}
                            </p>
                            <p className="text-gray-600 text-xs">suspicion</p>
                          </div>
                        </div>

                        {/* stats row */}
                        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                          <span>🚩 {student.flaggedEventsCount || 0} events</span>
                          <span>🔀 {student.tabSwitchCount || 0} tab switches</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            student.status === "completed" ? "bg-green-500/10 text-green-400"
                            : student.status === "terminated" ? "bg-red-500/10 text-red-400"
                            : student.status === "ongoing" ? "bg-blue-500/10 text-blue-400"
                            : "bg-gray-700 text-gray-400"
                          }`}>
                            {student.status || "not started"}
                          </span>
                        </div>

                        {/* recent alerts for this student */}
                        {student.alerts?.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {student.alerts.slice(0, 2).map((alert, i) => (
                              <div key={i} className={`text-xs px-2 py-1.5 rounded-lg border ${severityColor(alert.severity)}`}>
                                {alert.description || alert.eventType}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* actions */}
{(student.status === "ongoing" || student.status === "completed") && (
  <div className="flex gap-2 mt-3">
    <button
      onClick={() => navigate(`/admin/report/${student.sessionId}`)}
      className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition"
    >
      <FiFileText className="text-xs" /> View Report
    </button>
    {student.status === "ongoing" && (
      <button
        onClick={() => handleTerminate(student.sessionId, student.name)}
        className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition ml-auto"
      >
        <FiXCircle className="text-xs" /> Terminate
      </button>
    )}
  </div>
)}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* recent alerts feed */}
            <div>
              <h2 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
                Live Alert Feed
              </h2>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2 max-h-[600px] overflow-auto">
                {recentAlerts.length === 0 ? (
                  <div className="text-center py-8">
                    <FiCheckCircle className="text-green-400 text-2xl mx-auto mb-2" />
                    <p className="text-gray-500 text-xs">No alerts yet</p>
                  </div>
                ) : (
                  <AnimatePresence>
                    {recentAlerts.map((alert, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`p-3 rounded-xl border text-xs ${severityColor(alert.event?.severity)}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-semibold">{alert.studentName}</p>
                          <p className="opacity-60">
                            {new Date(alert.time).toLocaleTimeString()}
                          </p>
                        </div>
                        <p className="opacity-80">{alert.event?.description || alert.event?.eventType}</p>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default LiveDashboard;
