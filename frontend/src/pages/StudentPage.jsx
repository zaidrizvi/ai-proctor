import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { FiAward, FiList } from "react-icons/fi";
import AppShell from "../components/shared/AppShell.jsx";

import StudentDashboard from "../components/student/StudentDashboard.jsx";
import ExamInterface from "../components/student/ExamInterface.jsx";
import Results from "../components/student/Results.jsx";

const StudentPage = () => {
  const location = useLocation();

  const navItems = [
    { path: "dashboard", label: "Available Exams", icon: FiList, caption: "Browse upcoming tests" },
    { path: "results", label: "My Results", icon: FiAward, caption: "Review completed sessions" },
  ];

  const isExamRoute = location.pathname.includes("/student/exam/");

  if (isExamRoute) {
    return (
      <Routes>
        <Route path="exam/:examId" element={<ExamInterface />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    );
  }

  return (
    <AppShell sectionLabel="Student Hub" navItems={navItems} basePath="/student">
      <div className="overflow-hidden">
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<StudentDashboard />} />
            <Route path="results" element={<Results />} />
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Routes>
      </div>
    </AppShell>
  );
};

export default StudentPage;
