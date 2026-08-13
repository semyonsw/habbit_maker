"use strict";

import { MAX_LOG_RECORDS } from "./constants.js";
import { appLogs, setAppLogs } from "./state.js";
import { uid, nowIso, sanitizeErrorForLog, redactForLogs } from "./utils.js?v=2";
import * as db from "./db.js";

export async function loadLogs() {
  try {
    const remote = await db.getLogs();
    setAppLogs(
      Array.isArray(remote) ? remote.slice(-MAX_LOG_RECORDS) : [],
    );
  } catch (_) {
    setAppLogs([]);
  }
}

// Fire-and-forget single-row append. The .catch() must NOT call
// appendLogEntry, or a backend outage would create an infinite loop.
function persistLogEntry(entry) {
  db.appendLog(entry).catch((err) => {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("Failed to persist log entry to backend:", err);
    }
  });
}

export function clearAllLogs() {
  db.clearLogs().catch((err) => {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("Failed to clear logs on backend:", err);
    }
  });
}

export function appendLogEntry({
  level = "info",
  component = "app",
  operation = "unknown",
  message = "",
  error = null,
  context = null,
  runId = null,
}) {
  const cleanError = error ? sanitizeErrorForLog(error) : null;
  const payload = {
    id: uid("log"),
    timestamp: nowIso(),
    level: ["debug", "info", "warn", "error"].includes(String(level))
      ? String(level)
      : "info",
    component: String(component || "app"),
    operation: String(operation || "unknown"),
    message: String(message || ""),
    errorName: cleanError ? cleanError.errorName : "",
    errorMessage: cleanError ? cleanError.errorMessage : "",
    stack: cleanError ? cleanError.stack : "",
    context: redactForLogs(context || {}),
    runId: runId ? String(runId) : "",
  };
  appLogs.push(payload);
  if (appLogs.length > MAX_LOG_RECORDS) {
    setAppLogs(appLogs.slice(appLogs.length - MAX_LOG_RECORDS));
  }
  persistLogEntry(payload);
  return payload;
}
