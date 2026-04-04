const ML_URL_OVERRIDE_KEY = "aiproctor.ml_url_override";

const normalizeMlUrl = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\/+$/, "");
};

const DEFAULT_ML_URL = normalizeMlUrl(import.meta.env.VITE_ML_URL);

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

export const getMlServiceResolution = () => {
  const urlFromLocation = syncMlServiceUrlOverrideFromLocation();
  if (urlFromLocation) {
    return {
      url: urlFromLocation,
      source: "query_param",
      hasOverride: true,
      defaultUrl: DEFAULT_ML_URL,
    };
  }

  const storedOverride = normalizeMlUrl(
    window.localStorage.getItem(ML_URL_OVERRIDE_KEY)
  );

  if (storedOverride) {
    return {
      url: storedOverride,
      source: "local_storage",
      hasOverride: true,
      defaultUrl: DEFAULT_ML_URL,
    };
  }

  if (DEFAULT_ML_URL) {
    return {
      url: DEFAULT_ML_URL,
      source: "env",
      hasOverride: false,
      defaultUrl: DEFAULT_ML_URL,
    };
  }

  return {
    url: "",
    source: "missing",
    hasOverride: false,
    defaultUrl: DEFAULT_ML_URL,
  };
};

export const getMlServiceUrl = () => {
  return getMlServiceResolution().url;
};
