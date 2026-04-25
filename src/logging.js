"use strict";

import { MAX_LOG_RECORDS } from "./constants.js";
import { appLogs, setAppLogs, liveLogFileState, globals } from "./state.js";
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
  appendLiveLogEntryToFile(payload);
  return payload;
}

export function isLiveLogFileSupported() {
  return (
    window.isSecureContext === true &&
    typeof window.showSaveFilePicker === "function"
  );
}

function normalizeLogSegment(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "/")
    .trim();
}

function formatLogLineForLiveFile(entry) {
  const localTime = new Date(entry.timestamp).toLocaleString();
  const contextString = normalizeLogSegment(
    JSON.stringify(entry.context || {}),
  );
  const chunks = [
    entry.timestamp,
    `local=${normalizeLogSegment(localTime)}`,
    `level=${normalizeLogSegment(String(entry.level || "").toUpperCase())}`,
    `component=${normalizeLogSegment(entry.component)}`,
    `operation=${normalizeLogSegment(entry.operation)}`,
    `session=${normalizeLogSegment(liveLogFileState.sessionId || "-")}`,
    `runId=${normalizeLogSegment(entry.runId || "-")}`,
    `msg=${normalizeLogSegment(entry.message)}`,
  ];

  if (entry.errorMessage) {
    chunks.push(
      `error=${normalizeLogSegment(entry.errorName)}:${normalizeLogSegment(entry.errorMessage)}`,
    );
  }
  if (contextString) {
    chunks.push(`context=${contextString.slice(0, 4000)}`);
  }
  return chunks.join(" | ");
}

export function updateLiveLogFileStatus() {
  const statusEl = document.getElementById("logsLiveFileStatus");
  const selectBtn = document.getElementById("logsLiveFileSelectBtn");
  const stopBtn = document.getElementById("logsLiveFileStopBtn");
  if (!statusEl) return;

  if (!isLiveLogFileSupported()) {
    statusEl.textContent =
      "Live .log file is not supported in this browser/context.";
    statusEl.classList.remove("active");
    statusEl.classList.add("inactive");
    if (selectBtn) selectBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    return;
  }

  if (liveLogFileState.enabled && liveLogFileState.handle) {
    statusEl.textContent = `Live file logging: ON (${liveLogFileState.writeCount} lines written this session).`;
    statusEl.classList.add("active");
    statusEl.classList.remove("inactive");
    if (selectBtn) selectBtn.textContent = "Switch .log File";
    if (stopBtn) stopBtn.disabled = false;
    return;
  }

  const suffix = liveLogFileState.lastError
    ? ` Last issue: ${liveLogFileState.lastError}`
    : "";
  statusEl.textContent = `Live file logging: OFF.${suffix}`;
  statusEl.classList.remove("active");
  statusEl.classList.add("inactive");
  if (selectBtn) selectBtn.textContent = "Enable Live .log File";
  if (stopBtn) stopBtn.disabled = true;
}

async function appendLineToLiveLogFile(line) {
  if (!liveLogFileState.enabled || !liveLogFileState.handle) return;

  const job = async () => {
    const handle = liveLogFileState.handle;
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      const granted = await handle.requestPermission({ mode: "readwrite" });
      if (granted !== "granted") {
        throw new Error("Write permission denied for live log file.");
      }
    }

    const file = await handle.getFile();
    const currentSize = Number.isFinite(Number(file.size))
      ? Number(file.size)
      : 0;
    if (currentSize > 10 * 1024 * 1024) {
      throw new Error(
        "Live log file reached 10MB safety limit. Switch to a new .log file.",
      );
    }

    const writer = await handle.createWritable({ keepExistingData: true });
    await writer.seek(currentSize);
    await writer.write(`${line}\n`);
    await writer.close();
    liveLogFileState.writeCount += 1;
  };

  liveLogFileState.writeQueue = liveLogFileState.writeQueue
    .then(job)
    .catch((error) => {
      liveLogFileState.enabled = false;
      liveLogFileState.lastError = String(
        error && error.message ? error.message : error,
      );
      updateLiveLogFileStatus();
    });
  await liveLogFileState.writeQueue;
}

function appendLiveLogEntryToFile(entry) {
  if (!liveLogFileState.enabled || !liveLogFileState.handle) return;
  const line = formatLogLineForLiveFile(entry);
  appendLineToLiveLogFile(line).catch(() => {});
}

export async function enableLiveLogFile() {
  if (!isLiveLogFileSupported()) {
    alert(
      "Live .log writing requires a secure context and File System Access API support.",
    );
    updateLiveLogFileStatus();
    return;
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: `habit-live-${new Date().toISOString().slice(0, 10)}.log`,
      types: [
        {
          description: "Log files",
          accept: {
            "text/plain": [".log", ".txt"],
          },
        },
      ],
    });

    const granted = await handle.requestPermission({ mode: "readwrite" });
    if (granted !== "granted") {
      alert("Permission to write the .log file was denied.");
      return;
    }

    liveLogFileState.handle = handle;
    liveLogFileState.enabled = true;
    liveLogFileState.lastError = "";
    liveLogFileState.writeCount = 0;
    liveLogFileState.sessionId = uid("logsession");
    updateLiveLogFileStatus();

    await appendLineToLiveLogFile(
      `# ---- Live log session started at ${nowIso()} | session=${liveLogFileState.sessionId} ----`,
    );

    appLogs.slice(-25).forEach((entry) => {
      appendLiveLogEntryToFile(entry);
    });

    updateLiveLogFileStatus();
    alert("Live .log file enabled. New logs will append in real time.");
  } catch (error) {
    const isAbort =
      error && (error.name === "AbortError" || error.code === 20);
    if (!isAbort) {
      liveLogFileState.lastError = String(
        error && error.message ? error.message : error,
      );
      updateLiveLogFileStatus();
      alert("Failed to enable live .log file.");
    }
  }
}

export async function disableLiveLogFile() {
  if (liveLogFileState.enabled && liveLogFileState.handle) {
    await appendLineToLiveLogFile(
      `# ---- Live log session stopped at ${nowIso()} | session=${liveLogFileState.sessionId || "-"} ----`,
    ).catch(() => {});
  }
  liveLogFileState.enabled = false;
  liveLogFileState.handle = null;
  liveLogFileState.writeCount = 0;
  liveLogFileState.sessionId = "";
  updateLiveLogFileStatus();
}

export function formatLogsCsv(logs) {
  const headers = [
    "id",
    "timestamp",
    "level",
    "component",
    "operation",
    "message",
    "errorName",
    "errorMessage",
    "runId",
    "context",
  ];
  const rows = logs.map((entry) =>
    headers
      .map((key) => {
        const rawValue =
          key === "context"
            ? JSON.stringify(entry.context || {})
            : String(entry[key] || "");
        const escaped = rawValue.replace(/"/g, '""');
        return `"${escaped}"`;
      })
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

export function downloadTextFile(fileName, mimeType, text) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function exportLogsAsJson() {
  const fileName = `habit-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  downloadTextFile(
    fileName,
    "application/json;charset=utf-8",
    JSON.stringify(appLogs, null, 2),
  );
}

export function exportLogsAsCsv() {
  const fileName = `habit-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  downloadTextFile(
    fileName,
    "text/csv;charset=utf-8",
    formatLogsCsv(appLogs),
  );
}

export function maybeAutoDownloadLogs(reason) {
  const now = Date.now();
  if (now < globals.logAutoDownloadBlockedUntil) return;
  globals.logAutoDownloadBlockedUntil = now + 15000;
  const fileName = `habit-error-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const payload = {
    reason: String(reason || "error"),
    exportedAt: nowIso(),
    logs: appLogs.slice(-200),
  };
  downloadTextFile(
    fileName,
    "application/json;charset=utf-8",
    JSON.stringify(payload, null, 2),
  );
}
