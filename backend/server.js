import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import connectDB from "./config/db.js";
import User from "./models/User.js";
import Exam from "./models/Exam.js";

import authRoutes from "./routes/authRoutes.js";
import batchRoutes from "./routes/batchRoutes.js";
import examRoutes from "./routes/examRoutes.js";
import proctorRoutes from "./routes/proctorRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import { examOwnedBy, getStudentExamAccessError } from "./utils/examPolicy.js";
import ExamSession from "./models/ExamSession.js";

const app = express();
const server = http.createServer(app);
const examPresence = new Map();
const defaultClientOrigin = "http://localhost:5173";
const allowedOrigins = (process.env.CLIENT_URL || defaultClientOrigin)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isOriginAllowed = (origin) => {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin);
};

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by Socket.IO CORS"));
    },
    methods: ["GET", "POST"],
  },
});

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/proctor", proctorRoutes);
app.use("/api/reports", reportRoutes);

app.get("/", (req, res) => {
  res.json({ message: "AIProctor backend running" });
});

app.set("io", io);

io.use(async (socket, next) => {
  try {
    const rawToken =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

    if (!rawToken) {
      return next(new Error("Unauthorized"));
    }

    const decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("_id name role batch isActive");

    if (!user || user.isActive === false) {
      return next(new Error("Unauthorized"));
    }

    socket.data.userId = user._id.toString();
    socket.data.role = user.role;
    socket.data.name = user.name;
    socket.data.batch = user.batch || "";
    next();
  } catch (error) {
    next(new Error("Unauthorized"));
  }
});

const getPresenceForExam = (examId) => {
  if (!examPresence.has(examId)) {
    examPresence.set(examId, new Map());
  }

  return examPresence.get(examId);
};

const getOnlineStudentIds = (examId) => {
  const presence = examPresence.get(examId);
  if (!presence) return [];

  return Array.from(presence.entries())
    .filter(([, entry]) => entry.role === "student" && entry.sockets.size > 0)
    .map(([userId]) => userId);
};

const removeSocketFromExam = (ioInstance, socket, targetExamId) => {
  const examId = targetExamId || socket.data.examId;
  const userId = socket.data.userId;
  const role = socket.data.role;

  if (!examId || !userId) {
    return;
  }

  socket.leave(`exam-${examId}`);

  const presence = examPresence.get(examId);
  const existing = presence?.get(userId);

  if (existing) {
    existing.sockets.delete(socket.id);

    if (existing.sockets.size === 0) {
      presence.delete(userId);

      if (role === "student") {
        ioInstance.to(`exam-${examId}`).emit("student-left", { examId, userId });
      }
    } else {
      presence.set(userId, existing);
    }

    if (presence.size === 0) {
      examPresence.delete(examId);
    }
  }

  if (socket.data.examId === examId) {
    delete socket.data.examId;
  }
};

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("join-exam", async ({ examId }) => {
    if (!examId) {
      return;
    }

    try {
      const exam = await Exam.findById(examId).select(
        "createdBy batch allowedStudents isActive scheduledAt expiresAt"
      );

      if (!exam) {
        socket.emit("join-exam-denied", { examId, message: "Exam not found" });
        return;
      }

      const socketUser = {
        _id: socket.data.userId,
        batch: socket.data.batch,
      };
      const existingSession = socket.data.role === "student"
        ? await ExamSession.findOne({
            exam: examId,
            student: socket.data.userId,
            status: "ongoing",
          }).select("_id")
        : null;

      if (socket.data.role === "admin") {
        if (!examOwnedBy(exam, socket.data.userId)) {
          socket.emit("join-exam-denied", { examId, message: "Not authorized for this exam" });
          return;
        }
      } else {
        const accessError = getStudentExamAccessError(exam, socketUser, {
          requireWindow: !existingSession,
          requireActive: true,
        });

        if (accessError) {
          socket.emit("join-exam-denied", { examId, message: accessError.message });
          return;
        }
      }

      if (socket.data.examId && socket.data.examId !== examId) {
        removeSocketFromExam(io, socket, socket.data.examId);
      }

      const room = `exam-${examId}`;
      const presence = getPresenceForExam(examId);
      const existing = presence.get(socket.data.userId) || {
        role: socket.data.role,
        sockets: new Set(),
      };
      const wasOffline = socket.data.role === "student" && existing.sockets.size === 0;

      socket.join(room);
      socket.data.examId = examId;

      existing.role = socket.data.role;
      existing.sockets.add(socket.id);
      presence.set(socket.data.userId, existing);

      console.log(`User ${socket.data.userId} (${socket.data.role}) joined room: ${room}`);

      if (socket.data.role === "admin") {
        socket.emit("presence-sync", {
          examId,
          onlineUserIds: getOnlineStudentIds(examId),
        });
      }

      if (socket.data.role === "student" && wasOffline) {
        io.to(room).emit("student-joined", {
          examId,
          userId: socket.data.userId,
          socketId: socket.id,
        });
      }
    } catch (error) {
      console.error("Socket join-exam error:", error);
      socket.emit("join-exam-denied", {
        examId,
        message: "Failed to join exam room",
      });
    }
  });

  socket.on("leave-exam", ({ examId }) => {
    if (!examId) {
      return;
    }

    removeSocketFromExam(io, socket, examId);
  });

  socket.on("disconnect", () => {
    removeSocketFromExam(io, socket);
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Backend startup aborted because MongoDB is unavailable.");
    process.exit(1);
  }
};

startServer();
