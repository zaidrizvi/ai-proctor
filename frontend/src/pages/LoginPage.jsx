import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiEye, FiEyeOff, FiLock, FiMail } from "react-icons/fi";
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
      return "Cannot reach the configured backend right now. Check that the API server is running and reachable, then try again.";
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

        <div className="flex min-h-[calc(100vh-4.75rem)] items-center justify-center px-4 py-5">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="w-full max-w-lg"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="theme-panel rounded-[28px] p-6 backdrop-blur-xl"
            >
              <h2 className="mb-1 text-2xl font-semibold">Welcome back</h2>
              <p className="mb-7 text-base text-[var(--app-muted)]">Sign in to your account</p>

              {error && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                >
                  {error}
                </motion.div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
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
                      className="theme-input w-full rounded-2xl py-3.5 pr-4 pl-10 text-base focus:outline-none focus:ring-2"
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
                      className="theme-input w-full rounded-2xl py-3.5 pr-11 pl-10 text-base focus:outline-none focus:ring-2"
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
                  className="theme-primary-btn mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-50"
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

              <p className="mt-5 text-center text-sm text-[var(--app-muted)]">
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
              © 2025 AIProctor 
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
