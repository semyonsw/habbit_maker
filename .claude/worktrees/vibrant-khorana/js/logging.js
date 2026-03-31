(function () {
  "use strict";

  H.loadLogs = function () {
    try {
      var raw = localStorage.getItem(H.LOGS_STORAGE_KEY);
      if (!raw) {
        H.appLogs = [];
        return;
      }
      var parsed = JSON.parse(raw);
      H.appLogs = Array.isArray(parsed) ? parsed.slice(-H.MAX_LOG_RECORDS) : [];
    } catch (_) {
      H.appLogs = [];
    }
  };

  H.persistLogs = function () {
    localStorage.setItem(H.LOGS_STORAGE_KEY, JSON.stringify(H.appLogs));
  };

  H.appendLogEntry = function ({
    level = "info",
    component = "app",
    operation = "unknown",
    message = "",
    error = null,
    context = null,
    runId = null,
  }) {
    var cleanError = error ? H.sanitizeErrorForLog(error) : null;
    var payload = {
      id: H.uid("log"),
      timestamp: H.nowIso(),
      level: ["debug", "info", "warn", "error"].includes(String(level))
        ? String(level)
        : "info",
      component: String(component || "app"),
      operation: String(operation || "unknown"),
      message: String(message || ""),
      errorName: cleanError ? cleanError.errorName : "",
      errorMessage: cleanError ? cleanError.errorMessage : "",
      stack: cleanError ? cleanError.stack : "",
      context: H.redactForLogs(context || {}),
      runId: runId ? String(runId) : "",
    };
    H.appLogs.push(payload);
    if (H.appLogs.length > H.MAX_LOG_RECORDS) {
      H.appLogs = H.appLogs.slice(H.appLogs.length - H.MAX_LOG_RECORDS);
    }
    H.persistLogs();
    H.appendLiveLogEntryToFile(payload);
    return payload;
  };

  H.isLiveLogFileSupported = function () {
    return (
      window.isSecureContext === true &&
      typeof window.showSaveFilePicker === "function"
    );
  };

  H.normalizeLogSegment = function (value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\|/g, "/")
      .trim();
  };

  H.formatLogLineForLiveFile = function (entry) {
    var localTime = new Date(entry.timestamp).toLocaleString();
    var contextString = H.normalizeLogSegment(
      JSON.stringify(entry.context || {}),
    );
    var chunks = [
      entry.timestamp,
      "local=" + H.normalizeLogSegment(localTime),
      "level=" + H.normalizeLogSegment(String(entry.level || "").toUpperCase()),
      "component=" + H.normalizeLogSegment(entry.component),
      "operation=" + H.normalizeLogSegment(entry.operation),
      "session=" + H.normalizeLogSegment(H.liveLogFileState.sessionId || "-"),
      "runId=" + H.normalizeLogSegment(entry.runId || "-"),
      "msg=" + H.normalizeLogSegment(entry.message),
    ];

    if (entry.errorMessage) {
      chunks.push(
        "error=" + H.normalizeLogSegment(entry.errorName) + ":" + H.normalizeLogSegment(entry.errorMessage),
      );
    }
    if (contextString) {
      chunks.push("context=" + contextString.slice(0, 4000));
    }
    return chunks.join(" | ");
  };

  H.updateLiveLogFileStatus = function () {
    var statusEl = document.getElementById("logsLiveFileStatus");
    var selectBtn = document.getElementById("logsLiveFileSelectBtn");
    var stopBtn = document.getElementById("logsLiveFileStopBtn");
    if (!statusEl) return;

    if (!H.isLiveLogFileSupported()) {
      statusEl.textContent =
        "Live .log file is not supported in this browser/context.";
      statusEl.classList.remove("active");
      statusEl.classList.add("inactive");
      if (selectBtn) selectBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = true;
      return;
    }

    if (H.liveLogFileState.enabled && H.liveLogFileState.handle) {
      statusEl.textContent = "Live file logging: ON (" + H.liveLogFileState.writeCount + " lines written this session).";
      statusEl.classList.add("active");
      statusEl.classList.remove("inactive");
      if (selectBtn) selectBtn.textContent = "Switch .log File";
      if (stopBtn) stopBtn.disabled = false;
      return;
    }

    var suffix = H.liveLogFileState.lastError
      ? " Last issue: " + H.liveLogFileState.lastError
      : "";
    statusEl.textContent = "Live file logging: OFF." + suffix;
    statusEl.classList.remove("active");
    statusEl.classList.add("inactive");
    if (selectBtn) selectBtn.textContent = "Enable Live .log File";
    if (stopBtn) stopBtn.disabled = true;
  };

  H.appendLineToLiveLogFile = async function (line) {
    if (!H.liveLogFileState.enabled || !H.liveLogFileState.handle) return;

    var job = async function () {
      var handle = H.liveLogFileState.handle;
      var permission = await handle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        var granted = await handle.requestPermission({ mode: "readwrite" });
        if (granted !== "granted") {
          throw new Error("Write permission denied for live log file.");
        }
      }

      var file = await handle.getFile();
      var currentSize = Number.isFinite(Number(file.size))
        ? Number(file.size)
        : 0;
      if (currentSize > 10 * 1024 * 1024) {
        throw new Error(
          "Live log file reached 10MB safety limit. Switch to a new .log file.",
        );
      }

      var writer = await handle.createWritable({ keepExistingData: true });
      await writer.seek(currentSize);
      await writer.write(line + "\n");
      await writer.close();
      H.liveLogFileState.writeCount += 1;
    };

    H.liveLogFileState.writeQueue = H.liveLogFileState.writeQueue
      .then(job)
      .catch(function (error) {
        H.liveLogFileState.enabled = false;
        H.liveLogFileState.lastError = String(
          error && error.message ? error.message : error,
        );
        H.updateLiveLogFileStatus();
      });
    await H.liveLogFileState.writeQueue;
  };

  H.appendLiveLogEntryToFile = function (entry) {
    if (!H.liveLogFileState.enabled || !H.liveLogFileState.handle) return;
    var line = H.formatLogLineForLiveFile(entry);
    H.appendLineToLiveLogFile(line).catch(function () {});
  };

  H.enableLiveLogFile = async function () {
    if (!H.isLiveLogFileSupported()) {
      alert(
        "Live .log writing requires a secure context and File System Access API support.",
      );
      H.updateLiveLogFileStatus();
      return;
    }

    try {
      var handle = await window.showSaveFilePicker({
        suggestedName: "habit-live-" + new Date().toISOString().slice(0, 10) + ".log",
        types: [
          {
            description: "Log files",
            accept: {
              "text/plain": [".log", ".txt"],
            },
          },
        ],
      });

      var granted = await handle.requestPermission({ mode: "readwrite" });
      if (granted !== "granted") {
        alert("Permission to write the .log file was denied.");
        return;
      }

      H.liveLogFileState.handle = handle;
      H.liveLogFileState.enabled = true;
      H.liveLogFileState.lastError = "";
      H.liveLogFileState.writeCount = 0;
      H.liveLogFileState.sessionId = H.uid("logsession");
      H.updateLiveLogFileStatus();

      await H.appendLineToLiveLogFile(
        "# ---- Live log session started at " + H.nowIso() + " | session=" + H.liveLogFileState.sessionId + " ----",
      );

      H.appLogs.slice(-25).forEach(function (entry) {
        H.appendLiveLogEntryToFile(entry);
      });

      H.updateLiveLogFileStatus();
      alert("Live .log file enabled. New logs will append in real time.");
    } catch (error) {
      var isAbort =
        error && (error.name === "AbortError" || error.code === 20);
      if (!isAbort) {
        H.liveLogFileState.lastError = String(
          error && error.message ? error.message : error,
        );
        H.updateLiveLogFileStatus();
        alert("Failed to enable live .log file.");
      }
    }
  };

  H.disableLiveLogFile = async function () {
    if (H.liveLogFileState.enabled && H.liveLogFileState.handle) {
      await H.appendLineToLiveLogFile(
        "# ---- Live log session stopped at " + H.nowIso() + " | session=" + (H.liveLogFileState.sessionId || "-") + " ----",
      ).catch(function () {});
    }
    H.liveLogFileState.enabled = false;
    H.liveLogFileState.handle = null;
    H.liveLogFileState.writeCount = 0;
    H.liveLogFileState.sessionId = "";
    H.updateLiveLogFileStatus();
  };

  H.formatLogsCsv = function (logs) {
    var headers = [
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
    var rows = logs.map(function (entry) {
      return headers
        .map(function (key) {
          var rawValue =
            key === "context"
              ? JSON.stringify(entry.context || {})
              : String(entry[key] || "");
          var escaped = rawValue.replace(/"/g, '""');
          return '"' + escaped + '"';
        })
        .join(",");
    });
    return [headers.join(",")].concat(rows).join("\n");
  };

  H.exportLogsAsJson = function () {
    var fileName = "habit-logs-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    H.downloadTextFile(
      fileName,
      "application/json;charset=utf-8",
      JSON.stringify(H.appLogs, null, 2),
    );
  };

  H.exportLogsAsCsv = function () {
    var fileName = "habit-logs-" + new Date().toISOString().replace(/[:.]/g, "-") + ".csv";
    H.downloadTextFile(
      fileName,
      "text/csv;charset=utf-8",
      H.formatLogsCsv(H.appLogs),
    );
  };

  H.maybeAutoDownloadLogs = function (reason) {
    var now = Date.now();
    if (now < H.logAutoDownloadBlockedUntil) return;
    H.logAutoDownloadBlockedUntil = now + 15000;
    var fileName = "habit-error-log-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    var payload = {
      reason: String(reason || "error"),
      exportedAt: H.nowIso(),
      logs: H.appLogs.slice(-200),
    };
    H.downloadTextFile(
      fileName,
      "application/json;charset=utf-8",
      JSON.stringify(payload, null, 2),
    );
  };
})();
