import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";
import { getRoleFromPath, getTokenForPath } from "../utils/authStorage.js";

const SocketContext = createContext();

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const [socket, setSocket] = useState(null);
  const pendingRoomsRef = useRef(new Map());
  const pathname = location.pathname;
  const token = getTokenForPath(pathname);
  const pathRole = getRoleFromPath(pathname);
  const socketRole = pathRole || user?.role || null;

  const emitJoin = useCallback((targetSocket, examId) => {
    if (!targetSocket || !targetSocket.connected || !user || !examId) {
      return;
    }

    targetSocket.emit("join-exam", {
      examId,
    });
  }, [user]);

  const emitLeave = useCallback((targetSocket, examId) => {
    if (!targetSocket || !targetSocket.connected || !examId) {
      return;
    }

    targetSocket.emit("leave-exam", {
      examId,
    });
  }, []);

  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      pendingRoomsRef.current.clear();
      return;
    }

    if (!token) {
      if (socket) {
        socket.disconnect();
      }
      setSocket(null);
      pendingRoomsRef.current.clear();
      return;
    }

    const newSocket = io(import.meta.env.VITE_SOCKET_URL, {
      transports: ["websocket"],
      auth: { token },
    });

    newSocket.on("connect", () => {
      console.log("Socket connected:", newSocket.id);
      pendingRoomsRef.current.forEach((_, examId) => {
        emitJoin(newSocket, examId);
      });
    });

    newSocket.on("disconnect", () => {
      console.log("Socket disconnected");
    });

    newSocket.on("connect_error", (error) => {
      console.warn("Socket connect error:", error?.message || error);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [emitJoin, socketRole, token, user]);

  const joinExamRoom = useCallback((examId) => {
    if (!examId || !user) {
      return;
    }

    pendingRoomsRef.current.set(examId, true);

    if (socket?.connected) {
      emitJoin(socket, examId);
    }
  }, [emitJoin, socket, user]);

  const leaveExamRoom = useCallback((examId) => {
    if (!examId) {
      return;
    }

    pendingRoomsRef.current.delete(examId);

    if (socket?.connected) {
      emitLeave(socket, examId);
    }
  }, [emitLeave, socket]);

  return (
    <SocketContext.Provider value={{ socket, joinExamRoom, leaveExamRoom }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
