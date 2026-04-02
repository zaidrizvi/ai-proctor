import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiEye, FiEyeOff, FiLock, FiMail, FiShield } from "react-icons/fi";
import Navbar from "../components/shared/Navbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { login } = useAuth();
  const navigate = useNavigate();

  const getLoginErrorMessage = (err) => {
    if (!err.response) {
      return "Cannot reach the backend at http://localhost:5000. The server likely crashed during startup because MongoDB is unavailable.";
    }

    return err.response?.data?.message || "Login failed. Try again.";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await login(email, password);
      navigate(data.role === "admin" ? "/admin" : "/student");
    } catch (err) {
      setError(getLoginErrorMessage(err));
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
              <p className="mt-1 text-sm text-[var(--app-muted)]">Secure online examination platform</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="theme-panel rounded-[32px] p-8 backdrop-blur-xl"
            >
              <h2 className="mb-1 text-xl font-semibold">Welcome back</h2>
              <p className="mb-6 text-sm text-[var(--app-muted)]">Sign in to your account</p>

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
                    Email
                  </label>
                  <div className="relative">
                    <FiMail className="absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-[var(--app-subtle)]" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
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
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="........"
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

                <motion.button
                  type="submit"
                  disabled={loading}
                  whileTap={{ scale: 0.98 }}
                  className="theme-primary-btn mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </motion.button>
              </form>

              <p className="mt-6 text-center text-sm text-[var(--app-muted)]">
                Student?{" "}
                <Link to="/register" className="font-medium text-[var(--accent-strong)] transition hover:opacity-80">
                  Student signup
                </Link>
              </p>
              <p className="mt-2 text-center text-sm text-[var(--app-muted)]">
                Teacher/Admin?{" "}
                <Link to="/register/admin" className="font-medium text-[var(--accent-strong)] transition hover:opacity-80">
                  Admin signup
                </Link>
              </p>
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

export default LoginPage;
