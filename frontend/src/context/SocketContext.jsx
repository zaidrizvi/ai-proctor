import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext.jsx";
import { getActiveRole, getStoredSession } from "../utils/authStorage.js";

const SocketContext = createContext();

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const pendingRoomsRef = useRef(new Map());
  const userId = user?._id || user?.id || null;

  const authSession = useMemo(() => {
    const role = user?.role || getActiveRole();
    if (!role) {
      return { role: null, token: null };
    }

    return {
      role,
      token: getStoredSession(role)?.token || null,
    };
  }, [user?.role]);

  const token = authSession.token;
  const socketRole = authSession.role;

  const emitJoin = useCallback((targetSocket, examId) => {
    if (!targetSocket || !targetSocket.connected || !userId || !examId) {
      return;
    }

    targetSocket.emit("join-exam", {
      examId,
    });
  }, [userId]);

  const emitLeave = useCallback((targetSocket, examId) => {
    if (!targetSocket || !targetSocket.connected || !examId) {
      return;
    }

    targetSocket.emit("leave-exam", {
      examId,
    });
  }, []);

  useEffect(() => {
    if (!userId) {
      setSocket((currentSocket) => {
        if (currentSocket) {
          currentSocket.disconnect();
        }
        return null;
      });
      pendingRoomsRef.current.clear();
      return;
    }

    if (!token) {
      setSocket((currentSocket) => {
        if (currentSocket) {
          currentSocket.disconnect();
        }
        return null;
      });
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
        if (userId && examId) {
          newSocket.emit("join-exam", { examId });
        }
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
  }, [socketRole, token, userId]);

  const joinExamRoom = useCallback((examId) => {
    if (!examId || !userId) {
      return;
    }

    pendingRoomsRef.current.set(examId, true);

    if (socket?.connected) {
      emitJoin(socket, examId);
    }
  }, [emitJoin, socket, userId]);

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
