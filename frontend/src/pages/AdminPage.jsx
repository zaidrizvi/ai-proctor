import { Routes, Route, Navigate } from "react-router-dom";
import { FiList, FiMonitor, FiPlusCircle } from "react-icons/fi";
import AppShell from "../components/shared/AppShell.jsx";

import ExamList from "../components/admin/ExamList.jsx";
import CreateExam from "../components/admin/CreateExam.jsx";
import LiveDashboard from "../components/admin/LiveDashboard.jsx";

const navItems = [
  { path: "exams", label: "My Exams", icon: FiList, caption: "Track scheduled assessments" },
  { path: "create", label: "Create Exam", icon: FiPlusCircle, caption: "Generate AI-based papers" },
  { path: "live", label: "Live Dashboard", icon: FiMonitor, caption: "Watch proctor events live" },
];

const AdminPage = () => {
  return (
    <AppShell sectionLabel="Admin Control" navItems={navItems} basePath="/admin">
      <div className="overflow-auto">
          <Routes>
            <Route index element={<Navigate to="exams" replace />} />
            <Route path="exams" element={<ExamList />} />
            <Route path="create" element={<CreateExam />} />
            <Route path="live" element={<LiveDashboard />} />
            <Route path="*" element={<Navigate to="exams" replace />} />
          </Routes>
      </div>
    </AppShell>
  );
};

export default AdminPage;
