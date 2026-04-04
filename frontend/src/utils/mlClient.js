import axios from "axios";
import { getMlServiceResolution } from "./mlService.js";

const ML_REQUEST_TIMEOUT_MS = 15000;
const ML_HEALTH_TIMEOUT_MS = 12000;
const ML_HEALTH_CACHE_MS = 45000;
const ML_HEALTH_FAILURE_CACHE_MS = 5000;
const ML_RETRY_DELAY_MS = 1250;
const ML_LOG_HISTORY_LIMIT = 250;
const HEALTH_CHECK_RETRIES = 1;

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_TYPES = new Set([
  "network_or_cors",
  "service_starting",
  "service_unavailable",
  "timeout",
]);

const healthState = {
  checkedAt: 0,
  detail: null,
  inflight: null,
  ready: false,
  url: "",
};

const debugHistory = [];

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const buildMlUrl = (baseUrl, path) => {
  if (!path.startsWith("/")) {
    return `${baseUrl}/${path}`;
  }

  return `${baseUrl}${path}`;
};

const estimatePayloadSizeBytes = (payload) => {
  try {
    const serialized = JSON.stringify(payload ?? {});
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(serialized).length;
    }

    return serialized.length;
  } catch {
    return 0;
  }
};

const buildMultipartPayload = (fields = {}) => {
  const formData = new FormData();
  let payloadSizeBytes = 0;

  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (value instanceof Blob) {
      const fileName = value instanceof File && value.name
        ? value.name
        : `${key}.jpg`;
      formData.append(key, value, fileName);
      payloadSizeBytes += value.size || 0;
      return;
    }

    if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
      const serialized = JSON.stringify(value);
      formData.append(key, serialized);
      payloadSizeBytes += serialized.length;
      return;
    }

    const stringValue = String(value);
    formData.append(key, stringValue);
    payloadSizeBytes += stringValue.length;
  });

  return { formData, payloadSizeBytes };
};

const readErrorDetail = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }

  const message = error?.response?.data?.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return "";
};

const pushMlDebugLog = (entry, level = "debug") => {
  const nextEntry = {
    ...entry,
    loggedAt: new Date().toISOString(),
  };

  debugHistory.push(nextEntry);
  if (debugHistory.length > ML_LOG_HISTORY_LIMIT) {
    debugHistory.splice(0, debugHistory.length - ML_LOG_HISTORY_LIMIT);
  }

  const logger = console[level] || console.debug || console.log;
  logger("[AIPROCTOR_ML]", nextEntry);

  window.dispatchEvent?.(new CustomEvent("aiproctor:ml-debug", {
    detail: nextEntry,
  }));
};

const createMlClientError = ({
  attempt = 1,
  cause = null,
  detail = "",
  errorType = "unknown",
  path = "",
  requestId = "",
  responseStatus = null,
  resolution = getMlServiceResolution(),
}) => {
  const message = detail || "ML request failed";
  const error = new Error(message, cause ? { cause } : undefined);

  error.mlMeta = {
    attempt,
    detail,
    errorType,
    path,
    requestId,
    resolvedUrl: resolution.url,
    resolvedUrlSource: resolution.source,
    responseStatus,
  };

  if (cause?.response) {
    error.response = cause.response;
  }

  if (cause?.request) {
    error.request = cause.request;
  }

  if (cause?.code) {
    error.code = cause.code;
  }

  return error;
};

const classifyMlError = (error) => {
  const existingType = error?.mlMeta?.errorType;
  if (existingType) {
    return existingType;
  }

  if (!navigator.onLine) {
    return "offline";
  }

  const status = Number(error?.response?.status || 0);
  if (status === 502 || status === 503 || status === 504) {
    return "service_unavailable";
  }

  if (status > 0) {
    return `http_${status}`;
  }

  if (error?.code === "ECONNABORTED") {
    return "timeout";
  }

  if (typeof error?.message === "string" && /Network Error/i.test(error.message)) {
    return "network_or_cors";
  }

  return "unknown";
};

const shouldRetryMlError = (error) => {
  const errorType = classifyMlError(error);
  if (RETRYABLE_ERROR_TYPES.has(errorType)) {
    return true;
  }

  const status = Number(error?.mlMeta?.responseStatus || error?.response?.status || 0);
  return RETRYABLE_STATUS_CODES.has(status);
};

const getHealthCacheTtlMs = (ready) => {
  return ready ? ML_HEALTH_CACHE_MS : ML_HEALTH_FAILURE_CACHE_MS;
};

export const getMlDebugHistory = () => {
  return [...debugHistory];
};

export const describeMlError = (error, { actionLabel = "ML request" } = {}) => {
  const errorType = classifyMlError(error);
  const detail = error?.mlMeta?.detail || readErrorDetail(error);

  if (errorType === "config_missing") {
    return "ML service URL is missing in this frontend build. Set VITE_ML_URL or open the app with ?ml_url=...";
  }

  if (errorType === "offline") {
    return "Internet connection looks offline. Reconnect and try again.";
  }

  if (errorType === "timeout") {
    return `${actionLabel} timed out while waiting for the ML service. Mobile networks and cold starts may need a retry.`;
  }

  if (errorType === "service_starting") {
    return "ML service is still waking up and loading models. Wait a moment, then retry.";
  }

  if (errorType === "service_boot_failed") {
    return detail || "ML service failed while initializing routers or models.";
  }

  if (errorType === "network_or_cors") {
    return `${actionLabel} could not reach the ML service. Check the resolved ML URL, HTTPS reachability, and CORS allowlist.`;
  }

  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }

  const responseStatus = Number(error?.mlMeta?.responseStatus || error?.response?.status || 0);
  if (responseStatus >= 500) {
    return `${actionLabel} failed because the ML service returned ${responseStatus}.`;
  }

  return `${actionLabel} is unavailable right now.`;
};

export const ensureMlServiceReady = async ({
  force = false,
  timeoutMs = ML_HEALTH_TIMEOUT_MS,
} = {}) => {
  const resolution = getMlServiceResolution();
  const requestId = `health-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const healthUrl = buildMlUrl(resolution.url, "/health");

  if (!resolution.url) {
    const error = createMlClientError({
      detail: "ML service URL is not configured for this build.",
      errorType: "config_missing",
      path: "/health",
      requestId,
      resolution,
    });
    pushMlDebugLog({
      errorType: "config_missing",
      path: "/health",
      phase: "health_error",
      requestId,
      resolvedUrl: resolution.url,
      resolvedUrlSource: resolution.source,
    }, "warn");
    throw error;
  }

  const now = Date.now();
  const cacheFresh = (
    !force &&
    healthState.url === resolution.url &&
    now - healthState.checkedAt < getHealthCacheTtlMs(healthState.ready)
  );

  if (cacheFresh) {
    if (healthState.ready) {
      return healthState.detail;
    }

    throw createMlClientError({
      detail: healthState.detail?.routerRegistrationError ||
        healthState.detail?.detail ||
        "ML service is still starting.",
      errorType: healthState.detail?.errorType ||
        (healthState.detail?.routerRegistrationError
          ? "service_boot_failed"
          : "service_starting"),
      path: "/health",
      requestId,
      resolution,
    });
  }

  if (!force && healthState.inflight && healthState.url === resolution.url) {
    return healthState.inflight;
  }

  const inflight = (async () => {
    for (let attempt = 1; attempt <= HEALTH_CHECK_RETRIES + 1; attempt += 1) {
      const startedAt = Date.now();
      pushMlDebugLog({
        attempt,
        endedAt: null,
        path: "/health",
        phase: "health_start",
        payloadSizeBytes: 0,
        requestId,
        resolvedUrl: resolution.url,
        resolvedUrlSource: resolution.source,
        startedAt: new Date(startedAt).toISOString(),
        url: healthUrl,
      });

      try {
        const response = await axios.get(healthUrl, {
          headers: {
            Accept: "application/json",
          },
          timeout: timeoutMs,
        });
        const endedAt = Date.now();
        const responseData = response.data || {};
        const routersRegistered = responseData.routersRegistered === true;
        const routerRegistrationError = responseData.routerRegistrationError || "";

        healthState.checkedAt = endedAt;
        healthState.detail = responseData;
        healthState.ready = routersRegistered && !routerRegistrationError;
        healthState.url = resolution.url;

        pushMlDebugLog({
          attempt,
          durationMs: endedAt - startedAt,
          endedAt: new Date(endedAt).toISOString(),
          path: "/health",
          phase: healthState.ready ? "health_success" : "health_not_ready",
          requestId,
          resolvedUrl: resolution.url,
          resolvedUrlSource: resolution.source,
          responseStatus: response.status,
          routersRegistered,
          routerRegistrationError: routerRegistrationError || null,
          startedAt: new Date(startedAt).toISOString(),
          url: healthUrl,
        }, healthState.ready ? "debug" : "warn");

        if (healthState.ready) {
          return responseData;
        }

        if (attempt <= HEALTH_CHECK_RETRIES) {
          await wait(ML_RETRY_DELAY_MS * attempt);
          continue;
        }

        throw createMlClientError({
          attempt,
          detail: routerRegistrationError || "ML service health check passed but routers are not ready yet.",
          errorType: routerRegistrationError ? "service_boot_failed" : "service_starting",
          path: "/health",
          requestId,
          resolution,
          responseStatus: response.status,
        });
      } catch (error) {
        const endedAt = Date.now();
        const decoratedError = error?.mlMeta
          ? error
          : createMlClientError({
              attempt,
              cause: error,
              detail: readErrorDetail(error),
              errorType: classifyMlError(error),
              path: "/health",
              requestId,
              resolution,
              responseStatus: Number(error?.response?.status || 0) || null,
            });

        healthState.checkedAt = endedAt;
        healthState.detail = {
          detail: decoratedError.mlMeta.detail,
          errorType: decoratedError.mlMeta.errorType,
        };
        healthState.ready = false;
        healthState.url = resolution.url;

        pushMlDebugLog({
          attempt,
          durationMs: endedAt - startedAt,
          endedAt: new Date(endedAt).toISOString(),
          errorDetail: decoratedError.mlMeta.detail,
          errorType: decoratedError.mlMeta.errorType,
          path: "/health",
          phase: "health_error",
          requestId,
          resolvedUrl: resolution.url,
          resolvedUrlSource: resolution.source,
          responseStatus: decoratedError.mlMeta.responseStatus,
          startedAt: new Date(startedAt).toISOString(),
          url: healthUrl,
        }, "warn");

        if (attempt <= HEALTH_CHECK_RETRIES && shouldRetryMlError(decoratedError)) {
          await wait(ML_RETRY_DELAY_MS * attempt);
          continue;
        }

        throw decoratedError;
      }
    }

    throw createMlClientError({
      detail: "ML health check exhausted retries.",
      errorType: "unknown",
      path: "/health",
      requestId,
      resolution,
    });
  })();

  healthState.inflight = inflight;

  try {
    return await inflight;
  } finally {
    if (healthState.inflight === inflight) {
      healthState.inflight = null;
    }
  }
};

const postMlRequest = async (path, payload, {
  contentType = "application/json",
  healthTimeoutMs = ML_HEALTH_TIMEOUT_MS,
  label = path,
  payloadSizeBytes = estimatePayloadSizeBytes(payload),
  retries = 0,
  retryDelayMs = ML_RETRY_DELAY_MS,
  timeoutMs = ML_REQUEST_TIMEOUT_MS,
  warmup = true,
} = {}) => {
  const resolution = getMlServiceResolution();
  const requestId = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  if (!resolution.url) {
    throw createMlClientError({
      detail: "ML service URL is not configured for this build.",
      errorType: "config_missing",
      path,
      requestId,
      resolution,
    });
  }

  if (warmup) {
    await ensureMlServiceReady({ timeoutMs: healthTimeoutMs });
  }

  const url = buildMlUrl(resolution.url, path);

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const startedAt = Date.now();
    pushMlDebugLog({
      attempt,
      endedAt: null,
      label,
      path,
      payloadSizeBytes,
      phase: "request_start",
      requestId,
      resolvedUrl: resolution.url,
      resolvedUrlSource: resolution.source,
      startedAt: new Date(startedAt).toISOString(),
      timeoutMs,
      url,
    });

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Accept: "application/json",
          ...(contentType ? { "Content-Type": contentType } : {}),
        },
        timeout: timeoutMs,
      });
      const endedAt = Date.now();

      pushMlDebugLog({
        attempt,
        durationMs: endedAt - startedAt,
        endedAt: new Date(endedAt).toISOString(),
        label,
        path,
        payloadSizeBytes,
        phase: "request_success",
        requestId,
        resolvedUrl: resolution.url,
        resolvedUrlSource: resolution.source,
        responseStatus: response.status,
        startedAt: new Date(startedAt).toISOString(),
        url,
      });

      return response;
    } catch (error) {
      const endedAt = Date.now();
      const decoratedError = createMlClientError({
        attempt,
        cause: error,
        detail: readErrorDetail(error),
        errorType: classifyMlError(error),
        path,
        requestId,
        resolution,
        responseStatus: Number(error?.response?.status || 0) || null,
      });

      pushMlDebugLog({
        attempt,
        durationMs: endedAt - startedAt,
        endedAt: new Date(endedAt).toISOString(),
        errorDetail: decoratedError.mlMeta.detail,
        errorType: decoratedError.mlMeta.errorType,
        label,
        path,
        payloadSizeBytes,
        phase: "request_error",
        requestId,
        resolvedUrl: resolution.url,
        resolvedUrlSource: resolution.source,
        responseStatus: decoratedError.mlMeta.responseStatus,
        startedAt: new Date(startedAt).toISOString(),
        timeoutMs,
        url,
      }, "warn");

      if (attempt <= retries && shouldRetryMlError(decoratedError)) {
        pushMlDebugLog({
          attempt,
          errorType: decoratedError.mlMeta.errorType,
          label,
          path,
          phase: "request_retry",
          requestId,
          resolvedUrl: resolution.url,
          resolvedUrlSource: resolution.source,
          retryDelayMs,
          url,
        }, "warn");
        await wait(retryDelayMs * attempt);
        continue;
      }

      throw decoratedError;
    }
  }

  throw createMlClientError({
    detail: "ML request exhausted retries.",
    errorType: "unknown",
    path,
    requestId,
    resolution,
  });
};

export const postMlJson = async (path, payload, options = {}) => {
  return postMlRequest(path, payload, {
    ...options,
    contentType: "application/json",
    payloadSizeBytes: estimatePayloadSizeBytes(payload),
  });
};

export const postMlMultipart = async (path, fields, options = {}) => {
  const { formData, payloadSizeBytes } = buildMultipartPayload(fields);
  return postMlRequest(path, formData, {
    ...options,
    contentType: null,
    payloadSizeBytes,
  });
};
