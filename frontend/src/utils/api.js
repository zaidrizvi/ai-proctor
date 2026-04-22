import axios from "axios";
import { clearStoredSession, getSessionForPath, getTokenForPath } from "./authStorage.js";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL + "/api",
});

const shouldSkipAuthHeader = (config) => {
  const url = config?.url || "";
  return url.startsWith("/auth/login") || url.startsWith("/auth/register");
};

// attach token to every request automatically
api.interceptors.request.use((config) => {
  if (shouldSkipAuthHeader(config)) {
    return config;
  }

  const { role } = getSessionForPath(window.location.pathname);
  const token = getTokenForPath(window.location.pathname);

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    config.__authRole = role;
  }
  return config;
});

// handle 401 globally — token expired etc
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !shouldSkipAuthHeader(error.config)) {
      const failedRole = error.config?.__authRole;
      if (failedRole) {
        clearStoredSession(failedRole);
      }
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;
