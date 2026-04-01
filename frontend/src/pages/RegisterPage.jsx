import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import axios from "axios";
import { FiEye, FiEyeOff, FiLock, FiMail, FiShield, FiUser } from "react-icons/fi";
import Navbar from "../components/shared/Navbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import api from "../utils/api.js";

void motion;
const ML_URL = import.meta.env.VITE_ML_URL || "http://localhost:8000";
const HIGH_QUALITY_VIDEO_CONSTRAINTS = {
  width: { ideal: 1280, min: 640 },
  height: { ideal: 720, min: 480 },
  facingMode: "user",
};

const RegisterPage = () => {
  const [form, setForm] = useState({ name: "", email: "", password: "", batchCode: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [faceImage, setFaceImage] = useState("");
  const [cameraStatus, setCameraStatus] = useState("idle");

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const { registerStudent } = useAuth();
  const navigate = useNavigate();
  const isStudent = true;

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextValue =
      name === "batchCode"
        ? value.replace(/\D/g, "").slice(0, 6)
        : value;

    setForm((prev) => ({ ...prev, [name]: nextValue }));
  };

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: HIGH_QUALITY_VIDEO_CONSTRAINTS,
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraStatus("ready");
      } catch {
        setCameraStatus("denied");
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const captureCurrentFrame = () => {
    const video = videoRef.current;
    if (!video || video.readyState !== 4) {
      setError("Camera is not ready yet. Wait a moment and try again.");
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.95);
  };

  const handleCaptureFace = async () => {
    setError("");
    const frame = captureCurrentFrame();
    if (!frame) return;

    try {
      const { data } = await axios.post(`${ML_URL}/face/detect`, { frame });
      if (!data.face_detected || data.face_count !== 1 || data.multiple_faces) {
        setError("Capture a clear image with exactly one visible face.");
        return;
      }

      setFaceImage(frame);
    } catch {
      setError("Face detection is unavailable right now. Try again.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!faceImage) {
        setError("Capture your face before creating a student account.");
        setLoading(false);
        return;
      }

      if (!/^\d{6}$/.test(form.batchCode.trim())) {
        setError("Enter a valid 6-digit batch code");
        setLoading(false);
        return;
      }

      await registerStudent(form.name, form.email, form.password, form.batchCode);

      if (faceImage) {
        try {
          const { data: embeddingData } = await axios.post(`${ML_URL}/face/reference-embedding`, {
            frame: faceImage,
          });

          await api.post("/auth/face-reference", {
            faceImage,
            faceEmbedding: Array.isArray(embeddingData.embedding) ? embeddingData.embedding : undefined,
          });
        } catch {
          console.warn("Face reference save skipped during registration.");
        }
      }

      navigate("/student");
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed. Try again.");
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
      <div className="pointer-events-none absolute top-[-16%] right-[-8%] h-[420px] w-[420px] rounded-full blur-[110px]" style={{ background: "rgba(14, 165, 233, 0.18)" }} />
      <div className="pointer-events-none absolute bottom-[-18%] left-[-8%] h-[360px] w-[360px] rounded-full blur-[110px]" style={{ background: "rgba(249, 115, 22, 0.12)" }} />

      <div className="relative z-10">
        <Navbar />

        <div className="flex min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="w-full max-w-6xl"
          >
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-6 flex flex-col items-center"
            >
              <div
                className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-sky-500/20"
                style={{ background: "var(--accent-strong)" }}
              >
                <FiShield className="text-2xl" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">AIProctor</h1>
              <p className="mt-1 text-sm text-[var(--app-muted)]">Create your student account</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="theme-panel rounded-[32px] p-5 md:p-7 backdrop-blur-xl"
            >
              <div className="mb-6 flex flex-col gap-2 border-b pb-5 md:flex-row md:items-end md:justify-between" style={{ borderColor: "var(--app-border)" }}>
                <div>
                  <h2 className="text-xl font-semibold">Student signup</h2>
                  <p className="mt-1 text-sm text-[var(--app-muted)]">
                    Create your student account and capture one verification photo.
                  </p>
                </div>
                <div className="inline-flex rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.2em]" style={{ borderColor: "var(--app-border)", color: "var(--app-muted)" }}>
                  Student
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

              <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
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
                          placeholder="Zaid Khan"
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
                          placeholder="you@example.com"
                          required
                          className="theme-input w-full rounded-2xl py-3 pr-4 pl-10 text-sm focus:outline-none focus:ring-2"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
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

                    <div className="rounded-2xl border px-4 py-3 text-sm"
                      style={{ background: "var(--panel-strong)", borderColor: "var(--app-border)", color: "var(--app-muted)" }}>
                      This page creates student accounts only
                    </div>
                  </div>

                  {isStudent && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--app-muted)]">
                        Batch Code
                      </label>
                      <input
                        type="text"
                        name="batchCode"
                        value={form.batchCode}
                        onChange={handleChange}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="483291"
                        required={isStudent}
                        className="theme-input w-full rounded-2xl py-3 px-4 text-sm tracking-[0.24em] focus:outline-none focus:ring-2"
                      />
                      <p className="mt-2 text-xs text-[var(--app-muted)]">
                        Enter the 6-digit batch code shared by your teacher/admin
                      </p>
                    </div>
                  )}

                  <div className="rounded-3xl border p-4 md:p-5" style={{ borderColor: "var(--app-border)", background: "var(--panel-strong)" }}>
                    <p className="text-sm font-semibold text-[var(--app-text)]">
                      {isStudent ? "Before you continue" : "Admin account access"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--app-muted)]">
                      {isStudent
                        ? "You will join only the exams assigned to your batch, and your face photo is used only for identity checks."
                        : "Admin accounts can create exams, manage batches, and review live proctoring activity."}
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
                        Creating account...
                      </>
                    ) : (
                      "Create Account"
                    )}
                  </motion.button>
                </div>

                <div className="space-y-4">
                  {isStudent ? (
                    <div className="rounded-[28px] border p-4 md:p-5" style={{ borderColor: "var(--app-border)", background: "linear-gradient(180deg, var(--panel-soft) 0%, var(--panel-strong) 100%)" }}>
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--app-text)]">Face Setup</p>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--app-muted)]">
                            Capture one clear reference photo now so exam verification does not interrupt you later.
                          </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          faceImage
                            ? "bg-green-500/15 text-green-400"
                            : cameraStatus === "ready"
                            ? "bg-sky-500/15 text-sky-400"
                            : "bg-yellow-500/15 text-yellow-400"
                        }`}>
                          {faceImage
                            ? "Face captured"
                            : cameraStatus === "ready"
                            ? "Camera ready"
                            : cameraStatus === "denied"
                            ? "Camera denied"
                            : "Starting"}
                        </span>
                      </div>

                      <div className="overflow-hidden rounded-[24px] border border-[var(--app-border)] bg-[var(--app-bg)]">
                        {faceImage ? (
                          <img src={faceImage} alt="Captured reference face" className="h-64 w-full object-cover" />
                        ) : cameraStatus === "denied" ? (
                          <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-red-400">
                            Camera access is required to capture the student face.
                          </div>
                        ) : (
                          <video
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                            className="h-64 w-full object-cover"
                          />
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                        <button
                          type="button"
                          onClick={handleCaptureFace}
                          disabled={loading || cameraStatus !== "ready"}
                          className="rounded-2xl border border-[var(--app-border)] bg-[var(--panel-bg)] py-3 text-sm font-medium text-[var(--app-text)] transition hover:bg-[var(--panel-soft)] disabled:opacity-50"
                        >
                          {faceImage ? "Retake Face" : "Capture Face"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setFaceImage("")}
                          disabled={loading || !faceImage}
                          className="rounded-2xl border border-[var(--app-border)] px-4 py-3 text-sm font-medium text-[var(--app-muted)] transition hover:bg-[var(--panel-soft)] disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[28px] border p-5" style={{ borderColor: "var(--app-border)", background: "linear-gradient(180deg, rgba(14,165,233,0.08) 0%, var(--panel-strong) 100%)" }}>
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
                        Admin tools
                      </p>
                      <h3 className="mt-3 text-2xl font-semibold text-[var(--app-text)]">
                        Create exams, manage batches, and monitor students.
                      </h3>
                      <div className="mt-6 space-y-3">
                        {[
                          "Create AI-generated or manual MCQ exams",
                          "Assign exams to specific student batches",
                          "Monitor live sessions and proctoring alerts",
                        ].map((item) => (
                          <div key={item} className="rounded-2xl border px-4 py-3 text-sm text-[var(--app-muted)]" style={{ borderColor: "var(--app-border)", background: "var(--panel-bg)" }}>
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </form>

              <p className="mt-6 text-center text-sm text-[var(--app-muted)]">
                Already have an account?{" "}
                <Link to="/login" className="font-medium text-[var(--accent-strong)] transition hover:opacity-80">
                  Sign in
                </Link>
              </p>
              <p className="mt-2 text-center text-sm text-[var(--app-muted)]">
                Teacher/Admin?{" "}
                <Link to="/register/admin" className="font-medium text-[var(--accent-strong)] transition hover:opacity-80">
                  Use admin signup
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

export default RegisterPage;
