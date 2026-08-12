"use strict";

// Slim logger. The previous build shipped a full logs subsystem with a viewer,
// file handles and auto-download; that view is gone, so this keeps only what
// db-idb.js / db-rest.js call: a ring buffer plus console output.

import { MAX_LOG_RECORDS } from "./constants.js";
import { appLogs, setAppLogs } from "./state.js";
import { nowIso, sanitizeErrorForLog } from "./utils.js";

export function appendLogEntry(entry) {
  const e = entry && typeof entry === "object" ? entry : {};
  const record = {
    at: nowIso(),
    level: String(e.level || "info"),
    component: String(e.component || "app"),
    operation: String(e.operation || ""),
    message: String(e.message || ""),
    context: e.context && typeof e.context === "object" ? e.context : undefined,
    error: e.error ? sanitizeErrorForLog(e.error) : undefined,
  };
  const next = appLogs.concat([record]);
  setAppLogs(next.slice(-MAX_LOG_RECORDS));
  const line = `[${record.component}/${record.operation}] ${record.message}`;
  if (record.level === "error") console.error(line, record.error || "");
  else if (record.level === "warn") console.warn(line, record.error || "");
}

export async function loadLogs() {
  setAppLogs([]);
}

// Kept because db-* modules import it; auto-download of logs was removed.
export function maybeAutoDownloadLogs() {}

export function getLogs() {
  return appLogs.slice();
}
