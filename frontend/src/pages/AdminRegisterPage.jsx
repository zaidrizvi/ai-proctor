import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiEye, FiEyeOff, FiLock, FiMail, FiShield, FiUser } from "react-icons/fi";
import Navbar from "../components/shared/Navbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const AdminRegisterPage = () => {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { registerAdmin } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await registerAdmin(form.name, form.email, form.password);
      navigate("/admin");
    } catch (err) {
      setError(err.response?.data?.message || "Admin registration failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)]">
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--app-gradient)" }} />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "linear-gradient(rgba(14,165,233,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.22) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />
      <div className="pointer-events-none absolute top-[-16%] left-[-8%] h-[420px] w-[420px] rounded-full blur-[110px]" style={{ background: "rgba(14, 165, 233, 0.18)" }} />
      <div className="pointer-events-none absolute right-[-8%] bottom-[-18%] h-[360px] w-[360px] rounded-full blur-[110px]" style={{ background: "rgba(249, 115, 22, 0.12)" }} />

      <div className="relative z-10">
        <Navbar />

        <div className="flex min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="w-full max-w-md"
          >
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-8 flex flex-col items-center"
            >
              <div
                className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-sky-500/20"
                style={{ background: "var(--accent-strong)" }}
              >
                <FiShield className="text-2xl" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">AIProctor</h1>
              <p className="mt-1 text-sm text-[var(--app-muted)]">Create your admin account</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="theme-panel rounded-[32px] p-8 backdrop-blur-xl"
            >
              <div className="mb-6 flex items-start justify-between gap-3 border-b pb-5" style={{ borderColor: "var(--app-border)" }}>
                <div>
                  <h2 className="text-xl font-semibold">Admin signup</h2>
                  <p className="mt-1 text-sm text-[var(--app-muted)]">
                    Register as a teacher/admin to create exams and manage your own students.
                  </p>
                </div>
                <div className="inline-flex rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.2em]" style={{ borderColor: "var(--app-border)", color: "var(--app-muted)" }}>
                  Admin
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                >
                  {error}
                </motion.div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                    Full Name
                  </label>
                  <div className="relative">
                    <FiUser className="absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-[var(--app-subtle)]" />
                    <input
                      type="text"
                      name="name"
                      value={form.name}
                      onChange={handleChange}
                      placeholder="Teacher name"
                      required
                      className="theme-input w-full rounded-2xl py-3 pr-4 pl-10 text-sm focus:outline-none focus:ring-2"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                    Email
                  </label>
                  <div className="relative">
                    <FiMail className="absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-[var(--app-subtle)]" />
                    <input
                      type="email"
                      name="email"
                      value={form.email}
                      onChange={handleChange}
                      placeholder="teacher@example.com"
                      required
                      className="theme-input w-full rounded-2xl py-3 pr-4 pl-10 text-sm focus:outline-none focus:ring-2"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                    Password
                  </label>
                  <div className="relative">
                    <FiLock className="absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-[var(--app-subtle)]" />
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password"
                      value={form.password}
                      onChange={handleChange}
                      placeholder="Minimum 6 characters"
                      required
                      className="theme-input w-full rounded-2xl py-3 pr-11 pl-10 text-sm focus:outline-none focus:ring-2"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--app-subtle)] transition hover:text-[var(--app-text)]"
                    >
                      {showPassword ? <FiEyeOff /> : <FiEye />}
                    </button>
                  </div>
                </div>

                <div className="rounded-3xl border p-4" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                  <p className="text-sm font-semibold text-[var(--app-text)]">Admin access</p>
                  <p className="mt-1 text-sm text-[var(--app-muted)]">
                    This account will access the admin dashboard, create exams, manage batches, and monitor live sessions.
                  </p>
                </div>

                <motion.button
                  type="submit"
                  disabled={loading}
                  whileTap={{ scale: 0.98 }}
                  className="theme-primary-btn mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Creating admin account...
                    </>
                  ) : (
                    "Create Admin Account"
                  )}
                </motion.button>
              </form>

              <div className="mt-6 space-y-2 text-center text-sm text-[var(--app-muted)]">
                <p>
                  Student?{" "}
                  <Link to="/register" className="font-medium text-[var(--accent-strong)] transition hover:opacity-80">
                    Use student signup
                  </Link>
                </p>
                <p>
                  Already have an account?{" "}
                  <Link to="/login" className="font-medium text-[var(--accent-strong)] transition hover:opacity-80">
                    Sign in
                  </Link>
                </p>
              </div>
            </motion.div>

            <p className="mt-6 text-center text-xs text-[var(--app-subtle)]">
              © 2025 AIProctor · Jamia Hamdard
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default AdminRegisterPage;
