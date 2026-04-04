import { createContext, useContext, useState, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import api from "../utils/api.js";
import {
  clearStoredSession,
  getSessionForPath,
  getRoleFromPath,
  sanitizeStoredAuthData,
  setActiveRole,
  setStoredSession,
} from "../utils/authStorage.js";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true on first load

  useLayoutEffect(() => {
    const pathname = location.pathname;
    const roleFromPath = getRoleFromPath(pathname);
    const isPublicAuthPage =
      pathname === "/login" ||
      pathname === "/register" ||
      pathname === "/register/admin";
    const { session } = getSessionForPath(pathname);

    if (roleFromPath) {
      setActiveRole(roleFromPath);
    }

    if (isPublicAuthPage) {
      setUser(null);
    } else if (session?.user) {
      setUser(session.user);
    } else {
      setUser(null);
    }
    setLoading(false);
  }, [location.pathname]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setStoredSession(data.role, data);
    const safeData = sanitizeStoredAuthData(data);
    setUser(safeData);
    return safeData;
  };

  const registerStudent = async ({
    name,
    email,
    password,
    batchCode = "",
    faceImage,
    faceEmbedding,
  }) => {
    const { data } = await api.post("/auth/register/student", {
      name,
      email,
      password,
      batchCode,
      faceImage,
      faceEmbedding,
    });
    setStoredSession(data.role, data);
    const safeData = sanitizeStoredAuthData(data);
    setUser(safeData);
    return safeData;
  };

  const registerAdmin = async (name, email, password) => {
    const { data } = await api.post("/auth/register/admin", {
      name,
      email,
      password,
    });
    setStoredSession(data.role, data);
    const safeData = sanitizeStoredAuthData(data);
    setUser(safeData);
    return safeData;
  };

  const logout = () => {
    const activeRole = getRoleFromPath(location.pathname) || user?.role;
    if (activeRole) {
      clearStoredSession(activeRole);
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, registerStudent, registerAdmin, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
