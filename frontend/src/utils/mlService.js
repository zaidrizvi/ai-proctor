const ML_URL_OVERRIDE_KEY = "aiproctor.ml_url_override";
const DEFAULT_ML_URL = import.meta.env.VITE_ML_URL || "http://localhost:8000";

const normalizeMlUrl = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\/+$/, "");
};

export const setMlServiceUrlOverride = (value) => {
  const normalized = normalizeMlUrl(value);

  if (!normalized) {
    window.localStorage.removeItem(ML_URL_OVERRIDE_KEY);
    return "";
  }

  window.localStorage.setItem(ML_URL_OVERRIDE_KEY, normalized);
  return normalized;
};

export const clearMlServiceUrlOverride = () => {
  window.localStorage.removeItem(ML_URL_OVERRIDE_KEY);
};

export const syncMlServiceUrlOverrideFromLocation = (search = window.location.search) => {
  const params = new URLSearchParams(search);
  const nextMlUrl = params.get("ml_url");

  if (!nextMlUrl) {
    return "";
  }

  if (nextMlUrl.toLowerCase() === "clear") {
    clearMlServiceUrlOverride();
    return "";
  }

  return setMlServiceUrlOverride(nextMlUrl);
};

export const getMlServiceUrl = () => {
  const urlFromLocation = syncMlServiceUrlOverrideFromLocation();
  if (urlFromLocation) {
    return urlFromLocation;
  }

  const storedOverride = normalizeMlUrl(
    window.localStorage.getItem(ML_URL_OVERRIDE_KEY)
  );

  return storedOverride || DEFAULT_ML_URL;
};
