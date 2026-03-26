const TOKEN_KEYS = {
  admin: "token_admin",
  student: "token_student",
};

const USER_KEYS = {
  admin: "user_admin",
  student: "user_student",
};

const ACTIVE_ROLE_KEY = "active_role";
const LEGACY_SESSION_KEYS = ["token", "user"];

export const sanitizeStoredAuthData = (data = {}) => {
  const {
    faceImagePath,
    faceEmbedding,
    verificationFaceImagePath,
    ...safeData
  } = data;

  return safeData;
};

const clearLegacySession = () => {
  if (typeof window === "undefined") return;

  LEGACY_SESSION_KEYS.forEach((key) => {
    window.localStorage.removeItem(key);
  });
};

export const getRoleFromPath = (pathname = "") => {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/student")) return "student";
  return null;
};

export const getStoredSession = (role) => {
  if (!role || typeof window === "undefined") return null;

  const token = window.localStorage.getItem(TOKEN_KEYS[role]);
  const rawUser = window.localStorage.getItem(USER_KEYS[role]);

  if (!token || !rawUser) return null;

  try {
    const sanitizedUser = sanitizeStoredAuthData(JSON.parse(rawUser));
    window.localStorage.setItem(USER_KEYS[role], JSON.stringify(sanitizedUser));
    return {
      token,
      user: sanitizedUser,
    };
  } catch {
    window.localStorage.removeItem(TOKEN_KEYS[role]);
    window.localStorage.removeItem(USER_KEYS[role]);
    return null;
  }
};

export const setStoredSession = (role, data) => {
  if (!role || typeof window === "undefined") return;

  clearLegacySession();
  const sanitizedData = sanitizeStoredAuthData(data);
  window.localStorage.setItem(TOKEN_KEYS[role], data.token);
  window.localStorage.setItem(USER_KEYS[role], JSON.stringify(sanitizedData));
  window.localStorage.setItem(ACTIVE_ROLE_KEY, role);
};

export const setActiveRole = (role) => {
  if (!role || typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_ROLE_KEY, role);
};

export const clearStoredSession = (role) => {
  if (!role || typeof window === "undefined") return;

  clearLegacySession();
  window.localStorage.removeItem(TOKEN_KEYS[role]);
  window.localStorage.removeItem(USER_KEYS[role]);

  if (window.localStorage.getItem(ACTIVE_ROLE_KEY) === role) {
    const fallbackRole = getStoredSession("admin")
      ? "admin"
      : getStoredSession("student")
      ? "student"
      : "";
    if (fallbackRole) {
      window.localStorage.setItem(ACTIVE_ROLE_KEY, fallbackRole);
    } else {
      window.localStorage.removeItem(ACTIVE_ROLE_KEY);
    }
  }
};

export const getActiveRole = () => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_ROLE_KEY) || null;
};

export const getSessionForPath = (pathname = "") => {
  const roleFromPath = getRoleFromPath(pathname);

  if (roleFromPath) {
    return {
      role: roleFromPath,
      session: getStoredSession(roleFromPath),
    };
  }

  const activeRole = getActiveRole();
  if (activeRole) {
    return {
      role: activeRole,
      session: getStoredSession(activeRole),
    };
  }

  const adminSession = getStoredSession("admin");
  if (adminSession) return { role: "admin", session: adminSession };

  const studentSession = getStoredSession("student");
  if (studentSession) return { role: "student", session: studentSession };

  return { role: null, session: null };
};

export const getTokenForPath = (pathname = "") => {
  return getSessionForPath(pathname).session?.token || null;
};
