(function () {
  "use strict";

  const STORAGE_KEY = "habitTracker_v1";
  const SECURE_SETTINGS_KEY = "habitTracker_secure_settings_v1";
  const API_KEY_CACHE_KEY = "habitTracker_summary_api_key_cache_v1";
  const LOGS_STORAGE_KEY = "habitTracker_logs_v1";
  const SIDEBAR_COLLAPSE_KEY = "habitTracker_sidebarCollapsed_v1";
  const SCHEMA_VERSION = 4;
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const MAX_PDF_FILE_SIZE_MB = 70;
  const MAX_PDF_FILE_SIZE_BYTES = MAX_PDF_FILE_SIZE_MB * 1024 * 1024;
  const EMBEDDED_EXPORT_SIZE_WARN_BYTES = 50 * 1024 * 1024;
  const MAX_BOOKMARK_HISTORY = 200;
  const PDF_DB_NAME = "habitTracker_books_pdf_v1";
  const PDF_DB_VERSION = 1;
  const PDF_STORE_NAME = "pdfFiles";
  const PDFJS_SCRIPT_URLS = [
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
  ];
  const PDFJS_WORKER_URL =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const READER_DARK_ENABLED_KEY = "habitTracker_readerDarkEnabled_v1";
  const READER_DARK_MODE_KEY = "habitTracker_readerDarkMode_v1";
  const ANALYTICS_DISPLAY_MODE_KEY = "habitTracker_analyticsDisplayMode_v1";
  const BOOKS_ANALYTICS_RANGE_KEY = "habitTracker_booksAnalyticsRange_v1";
  const GEMINI_API_BASE_URL =
    "https://generativelanguage.googleapis.com/v1beta";
  const GEMINI_MODELS = [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
    "gemini-2.5-pro-preview-tts",
    "gemini-2.5-flash-preview-tts",
    "gemini-flash-latest",
  ];
  const SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT = 12000;
  const SUMMARY_MAX_PAGES_PER_RUN_DEFAULT = 120;
  const MAX_LOG_RECORDS = 1000;

  const DEFAULT_CATEGORIES = [
    { id: "cat_health", name: "Health", emoji: "❤️", color: "#3E85B5" },
    {
      id: "cat_productivity",
      name: "Productivity",
      emoji: "🧠",
      color: "#4F6BD8",
    },
    { id: "cat_fitness", name: "Fitness", emoji: "💪", color: "#2F9E7A" },
    { id: "cat_family", name: "Family", emoji: "👨‍👩‍👧‍👦", color: "#D97706" },
    { id: "cat_sleep", name: "Sleep", emoji: "😴", color: "#7C8CFF" },
    { id: "cat_study", name: "Study", emoji: "📚", color: "#B56BE3" },
    { id: "cat_diet", name: "Diet", emoji: "🥗", color: "#22C55E" },
    { id: "cat_career", name: "Career", emoji: "💼", color: "#F59E0B" },
    { id: "cat_music", name: "Music", emoji: "🎵", color: "#F97316" },
  ];

  const DEFAULT_DAILY_HABITS = [
    {
      id: "dh_1",
      name: "Morning Bible reading",
      categoryId: "cat_health",
      monthGoal: 30,
      type: "fixed",
      scheduleMode: "fixed",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      activeMonthDays: [],
      excludedWeekdays: [],
      emoji: "📖",
      order: 0,
    },
    {
      id: "dh_2",
      name: "Complete work tasks",
      categoryId: "cat_productivity",
      monthGoal: 28,
      type: "fixed",
      scheduleMode: "fixed",
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
      activeMonthDays: [],
      excludedWeekdays: [],
      emoji: "💼",
      order: 1,
    },
  ];

  let state = null;
  let chartInstances = {};
  let sidebarCollapsed = false;
  let noteModalState = { habitId: null, day: null };
  let bookModalState = { editingBookId: null };
  let bookmarkModalState = { editingBookId: null, editingBookmarkId: null };
  let historyEventModalState = {
    editingBookId: null,
    editingBookmarkId: null,
    editingEventId: null,
  };
  let summaryModalState = {
    bookId: null,
    bookmarkId: null,
    selectedSummaryId: null,
    statusText: "",
    detectionText: "",
    externalSummary: null,
    isRunning: false,
  };
  let confirmCallback = null;
  let editingHabitId = null;
  let editingCategoryId = null;
  let idbPromise = null;
  let booksBlobStatus = {};
  let topClockTimer = null;
  let lastAutoScrolledMonthKey = null;
  let linkedHoverState = {
    day: null,
    week: null,
    scope: null,
    source: null,
  };
  let secureSettings = {
    keyCiphertext: null,
    saltBase64: null,
    ivBase64: null,
    kdfIterations: 200000,
    keyUpdatedAt: null,
  };
  let runtimeSecrets = {
    apiKey: "",
    unlockedAt: null,
  };
  let appLogs = [];
  let logAutoDownloadBlockedUntil = 0;
  let legacyPlaintextApiKeyForMigration = "";
  let summaryModelPickerState = {
    isOpen: false,
    activeIndex: -1,
    filtered: [],
  };
  let liveLogFileState = {
    enabled: false,
    handle: null,
    writeQueue: Promise.resolve(),
    sessionId: "",
    writeCount: 0,
    lastError: "",
  };
  const analyticsState = {
    displayMode: "percent",
    booksRangeDays: 30,
  };
  const finisherState = {
    loadingBookId: null,
    lastError: "",
  };

  const readerState = {
    pdfDoc: null,
    book: null,
    currentPage: 1,
    totalPages: 0,
    renderTask: null,
    resizeHandlerBound: false,
    resizeTimer: null,
    darkEnabled: false,
    darkMode: "full",
    sourceBookmarkId: null,
    sourcePage: null,
  };

  function formatRealBookPage(value) {
    const page = parseInt(value, 10);
    return Number.isFinite(page) && page > 0 ? String(page) : "-";
  }

  function loadReaderThemePreferences() {
    readerState.darkEnabled =
      localStorage.getItem(READER_DARK_ENABLED_KEY) === "1";
    const savedMode = localStorage.getItem(READER_DARK_MODE_KEY);
    readerState.darkMode = savedMode === "text" ? "text" : "full";
  }

  function persistReaderThemePreferences() {
    localStorage.setItem(
      READER_DARK_ENABLED_KEY,
      readerState.darkEnabled ? "1" : "0",
    );
    localStorage.setItem(READER_DARK_MODE_KEY, readerState.darkMode);
  }

  function applyReaderThemeClasses() {
    const root = document.getElementById("readerMode");
    const canvas = document.getElementById("readerCanvas");
    if (!root || !canvas) return;

    root.classList.toggle("reader-dark-enabled", readerState.darkEnabled);
    canvas.classList.toggle("reader-dark-full", false);
    canvas.classList.toggle("reader-dark-text", false);

    if (readerState.darkEnabled) {
      canvas.classList.add(
        readerState.darkMode === "text"
          ? "reader-dark-text"
          : "reader-dark-full",
      );
    }
  }

  function updateReaderThemeControls() {
    const toggle = document.getElementById("readerDarkToggle");
    const mode = document.getElementById("readerDarkMode");
    if (!toggle || !mode) return;

    toggle.setAttribute("aria-pressed", String(readerState.darkEnabled));
    toggle.textContent = readerState.darkEnabled
      ? "Read in dark theme: ON"
      : "Read in dark theme: OFF";

    mode.value = readerState.darkMode;
    mode.disabled = !readerState.darkEnabled;
  }

  function toggleReaderDarkTheme() {
    readerState.darkEnabled = !readerState.darkEnabled;
    persistReaderThemePreferences();
    applyReaderThemeClasses();
    updateReaderThemeControls();
  }

  function setReaderDarkMode(mode) {
    readerState.darkMode = mode === "text" ? "text" : "full";
    persistReaderThemePreferences();
    applyReaderThemeClasses();
    updateReaderThemeControls();
  }

  function loadAnalyticsPreferences() {
    const savedMode = localStorage.getItem(ANALYTICS_DISPLAY_MODE_KEY);
    analyticsState.displayMode = savedMode === "raw" ? "raw" : "percent";
    const savedBooksRange = localStorage.getItem(BOOKS_ANALYTICS_RANGE_KEY);
    analyticsState.booksRangeDays = normalizeBooksRange(savedBooksRange);
  }

  function persistAnalyticsPreferences() {
    localStorage.setItem(
      ANALYTICS_DISPLAY_MODE_KEY,
      analyticsState.displayMode,
    );
    localStorage.setItem(
      BOOKS_ANALYTICS_RANGE_KEY,
      analyticsState.booksRangeDays === 0
        ? "all"
        : String(analyticsState.booksRangeDays),
    );
  }

  function normalizeBooksRange(value) {
    const asString = String(value || "30").toLowerCase();
    if (asString === "all") return 0;
    const parsed = parseInt(asString, 10);
    if ([7, 30, 90].includes(parsed)) return parsed;
    return 30;
  }

  function getBooksAnalyticsRangeDays() {
    return normalizeBooksRange(analyticsState.booksRangeDays);
  }

  function getAnalyticsDisplayMode() {
    return analyticsState.displayMode === "raw" ? "raw" : "percent";
  }

  function getMetricValue(done, possible) {
    if (getAnalyticsDisplayMode() === "raw") {
      return Number(done || 0);
    }
    if (!possible) return 0;
    return Math.round((Number(done || 0) / Number(possible || 1)) * 100);
  }

  function getMetricLabel(value) {
    if (getAnalyticsDisplayMode() === "raw") {
      return String(Math.round(value || 0));
    }
    return `${Math.round(value || 0)}%`;
  }

  function getMetricAxisLabel() {
    return getAnalyticsDisplayMode() === "raw"
      ? "Completed habits"
      : "Completion rate (%)";
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function getValueColor(value, maxValue, alpha = 1) {
    const safeMax = Math.max(1, Number(maxValue) || 1);
    const ratio = clampNumber((Number(value) || 0) / safeMax, 0, 1);
    const hue = ratio * 120;
    return `hsla(${hue.toFixed(1)}, 72%, 46%, ${clampNumber(alpha, 0, 1).toFixed(3)})`;
  }

  function getWeekShadeColor(isoWeek) {
    const normalized = (((Number(isoWeek) || 0) % 8) + 8) % 8;
    const lightness = 72 - normalized * 4;
    return `hsl(207, 78%, ${lightness}%)`;
  }

  function syncAnalyticsModeControls() {
    ["analyticsDisplayModeAnalytics"]
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .forEach((control) => {
        control.value = getAnalyticsDisplayMode();
      });
  }

  function setAnalyticsDisplayMode(mode) {
    analyticsState.displayMode = mode === "raw" ? "raw" : "percent";
    persistAnalyticsPreferences();
    syncAnalyticsModeControls();
    renderAnalyticsView();
  }

  function syncBooksRangeControls() {
    const current = getBooksAnalyticsRangeDays();
    document.querySelectorAll("[data-books-range]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const range = normalizeBooksRange(btn.dataset.booksRange);
      btn.classList.toggle("active", range === current);
      btn.setAttribute("aria-pressed", range === current ? "true" : "false");
    });
  }

  function setBooksAnalyticsRange(value) {
    const next = normalizeBooksRange(value);
    if (next === analyticsState.booksRangeDays) return;
    analyticsState.booksRangeDays = next;
    persistAnalyticsPreferences();
    syncBooksRangeControls();
    if (document.getElementById("view-books")?.classList.contains("active")) {
      renderBooksView();
    } else {
      renderBooksStatsOverview(buildBooksAnalytics());
    }
    if (
      document.getElementById("view-analytics")?.classList.contains("active")
    ) {
      renderAnalyticsView();
    }
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
  }

  function formatDateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function sanitize(str) {
    const div = document.createElement("div");
    div.textContent = String(str || "");
    return div.innerHTML;
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function toBase64(bytes) {
    const chars = [];
    for (let i = 0; i < bytes.length; i += 1) {
      chars.push(String.fromCharCode(bytes[i]));
    }
    return btoa(chars.join(""));
  }

  function fromBase64(str) {
    const raw = atob(str);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      out[i] = raw.charCodeAt(i);
    }
    return out;
  }

  function formatByteSize(bytes) {
    const normalized = Number.isFinite(Number(bytes)) ? Number(bytes) : 0;
    if (normalized < 1024) return `${Math.max(0, Math.round(normalized))} B`;
    if (normalized < 1024 * 1024) {
      return `${(normalized / 1024).toFixed(1)} KB`;
    }
    return `${(normalized / (1024 * 1024)).toFixed(1)} MB`;
  }

  function bytesFromString(input) {
    return new TextEncoder().encode(String(input || ""));
  }

  function stringFromBytes(input) {
    return new TextDecoder().decode(input);
  }

  function sanitizeErrorForLog(error) {
    const message = String(
      error && error.message ? error.message : error || "",
    );
    return {
      errorName: error && error.name ? String(error.name) : "Error",
      errorMessage: message,
      stack:
        error && typeof error.stack === "string"
          ? String(error.stack).slice(0, 3000)
          : "",
    };
  }

  function redactForLogs(value) {
    const serialized = JSON.stringify(value || {});
    return JSON.parse(
      serialized
        .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[REDACTED_API_KEY]")
        .replace(/(apiKey\"\s*:\s*\")[^\"]*(\")/gi, "$1[REDACTED]$2")
        .replace(/(passphrase\"\s*:\s*\")[^\"]*(\")/gi, "$1[REDACTED]$2"),
    );
  }

  function loadLogs() {
    try {
      const raw = localStorage.getItem(LOGS_STORAGE_KEY);
      if (!raw) {
        appLogs = [];
        return;
      }
      const parsed = JSON.parse(raw);
      appLogs = Array.isArray(parsed) ? parsed.slice(-MAX_LOG_RECORDS) : [];
    } catch (_) {
      appLogs = [];
    }
  }

  function persistLogs() {
    localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(appLogs));
  }

  function appendLogEntry({
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
      appLogs = appLogs.slice(appLogs.length - MAX_LOG_RECORDS);
    }
    persistLogs();
    appendLiveLogEntryToFile(payload);
    return payload;
  }

  function isLiveLogFileSupported() {
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

  function updateLiveLogFileStatus() {
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

  async function enableLiveLogFile() {
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

  async function disableLiveLogFile() {
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

  function formatLogsCsv(logs) {
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

  function downloadTextFile(fileName, mimeType, text) {
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

  function exportLogsAsJson() {
    const fileName = `habit-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    downloadTextFile(
      fileName,
      "application/json;charset=utf-8",
      JSON.stringify(appLogs, null, 2),
    );
  }

  function exportLogsAsCsv() {
    const fileName = `habit-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    downloadTextFile(
      fileName,
      "text/csv;charset=utf-8",
      formatLogsCsv(appLogs),
    );
  }

  function maybeAutoDownloadLogs(reason) {
    const now = Date.now();
    if (now < logAutoDownloadBlockedUntil) return;
    logAutoDownloadBlockedUntil = now + 15000;
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

  function loadSecureSettings() {
    try {
      const raw = localStorage.getItem(SECURE_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) return;
      secureSettings = {
        keyCiphertext:
          typeof parsed.keyCiphertext === "string"
            ? parsed.keyCiphertext
            : null,
        saltBase64:
          typeof parsed.saltBase64 === "string" ? parsed.saltBase64 : null,
        ivBase64: typeof parsed.ivBase64 === "string" ? parsed.ivBase64 : null,
        kdfIterations: Number.isFinite(Number(parsed.kdfIterations))
          ? Math.max(120000, Number(parsed.kdfIterations))
          : 200000,
        keyUpdatedAt:
          typeof parsed.keyUpdatedAt === "string" ? parsed.keyUpdatedAt : null,
      };
    } catch (error) {
      appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "loadSecureSettings",
        message: "Failed to load secure settings; using empty defaults.",
        error,
      });
    }
  }

  function persistSecureSettings() {
    localStorage.setItem(SECURE_SETTINGS_KEY, JSON.stringify(secureSettings));
  }

  function hasStoredEncryptedApiKey() {
    return !!(
      secureSettings &&
      secureSettings.keyCiphertext &&
      secureSettings.saltBase64 &&
      secureSettings.ivBase64
    );
  }

  function clearRuntimeApiKey() {
    runtimeSecrets.apiKey = "";
    runtimeSecrets.unlockedAt = null;
  }

  function isApiKeyDeviceCacheEnabled() {
    if (!state || !state.books || !state.books.ai) return false;
    return state.books.ai.rememberOnDevice === true;
  }

  function persistRuntimeApiKeyCache(apiKey) {
    const value = String(apiKey || "").trim();
    if (!value || !isApiKeyDeviceCacheEnabled()) {
      localStorage.removeItem(API_KEY_CACHE_KEY);
      return;
    }
    localStorage.setItem(API_KEY_CACHE_KEY, value);
  }

  function loadRuntimeApiKeyCache() {
    const cached = String(localStorage.getItem(API_KEY_CACHE_KEY) || "").trim();
    if (!cached) return false;
    runtimeSecrets.apiKey = cached;
    runtimeSecrets.unlockedAt = nowIso();
    return true;
  }

  async function derivePassphraseKey(passphrase, salt, iterations) {
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      bytesFromString(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async function encryptApiKeyWithPassphrase(apiKey, passphrase) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Secure crypto APIs are unavailable in this browser.");
    }
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const iterations = 200000;
    const key = await derivePassphraseKey(passphrase, salt, iterations);
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      bytesFromString(apiKey),
    );

    secureSettings.keyCiphertext = toBase64(new Uint8Array(encrypted));
    secureSettings.saltBase64 = toBase64(salt);
    secureSettings.ivBase64 = toBase64(iv);
    secureSettings.kdfIterations = iterations;
    secureSettings.keyUpdatedAt = nowIso();
    persistSecureSettings();
  }

  async function decryptApiKeyWithPassphrase(passphrase) {
    if (!hasStoredEncryptedApiKey()) {
      throw new Error("No encrypted API key is stored yet.");
    }
    const salt = fromBase64(secureSettings.saltBase64);
    const iv = fromBase64(secureSettings.ivBase64);
    const ciphertext = fromBase64(secureSettings.keyCiphertext);
    const key = await derivePassphraseKey(
      passphrase,
      salt,
      secureSettings.kdfIterations || 200000,
    );
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return stringFromBytes(new Uint8Array(decrypted));
  }

  function getApiKeyForSummary() {
    return String(runtimeSecrets.apiKey || "").trim();
  }

  function applySummaryApiKeyUiState() {
    const keyInput = document.getElementById("summaryApiKeyInput");
    const savedLabel = document.getElementById("summaryApiKeySavedLabel");
    const unlockBtn = document.getElementById("summaryApiKeyUnlockBtn");
    const clearBtn = document.getElementById("summaryApiKeyClearBtn");
    const saveBtn = document.getElementById("btnSaveSummarySettings");

    if (!keyInput || !savedLabel || !unlockBtn || !clearBtn || !saveBtn) return;

    const hasEncrypted = hasStoredEncryptedApiKey();
    const isUnlocked = !!getApiKeyForSummary();
    const hasCachedRuntimeKey = !!String(
      localStorage.getItem(API_KEY_CACHE_KEY) || "",
    ).trim();
    const cacheEnabled = isApiKeyDeviceCacheEnabled();
    if (hasEncrypted && isUnlocked) {
      savedLabel.textContent =
        "API key is saved (encrypted) and unlocked for this session.";
    } else if (hasEncrypted) {
      savedLabel.textContent =
        "API key is saved (encrypted). Unlock with passphrase to run summaries.";
    } else if (cacheEnabled && hasCachedRuntimeKey && isUnlocked) {
      savedLabel.textContent =
        "API key is cached locally and ready to use on this device.";
    } else {
      savedLabel.textContent = "No API key saved yet.";
    }

    keyInput.placeholder = hasEncrypted
      ? "Leave empty to keep saved key, or paste a new key to rotate"
      : "Paste your Gemini API key";
    unlockBtn.disabled = !hasEncrypted;
    clearBtn.disabled = !hasEncrypted;
    saveBtn.textContent = hasEncrypted
      ? "Save Summary Settings"
      : "Save Summary Settings + Encrypted API Key";
  }

  async function unlockStoredApiKeyInteractive() {
    if (!hasStoredEncryptedApiKey()) {
      alert("No encrypted API key is saved yet.");
      return false;
    }
    const passphrase = window.prompt(
      "Enter passphrase to unlock saved API key:",
      "",
    );
    if (!passphrase) return false;
    try {
      const decrypted = await decryptApiKeyWithPassphrase(passphrase);
      runtimeSecrets.apiKey = String(decrypted || "").trim();
      runtimeSecrets.unlockedAt = nowIso();
      persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
      applySummaryApiKeyUiState();
      appendLogEntry({
        level: "info",
        component: "secure-settings",
        operation: "unlockStoredApiKeyInteractive",
        message: "Encrypted API key unlocked for current session.",
      });
      return true;
    } catch (error) {
      clearRuntimeApiKey();
      applySummaryApiKeyUiState();
      appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "unlockStoredApiKeyInteractive",
        message: "Failed to unlock encrypted API key.",
        error,
      });
      alert("Passphrase is incorrect or key is corrupted.");
      return false;
    }
  }

  async function tryUnlockOnStartup() {
    if (isApiKeyDeviceCacheEnabled() && loadRuntimeApiKeyCache()) {
      applySummaryApiKeyUiState();
      return;
    }
    if (!hasStoredEncryptedApiKey()) {
      applySummaryApiKeyUiState();
      return;
    }
    const passphrase = window.prompt(
      "Enter passphrase to unlock your saved Gemini API key for this session:",
      "",
    );
    if (!passphrase) {
      clearRuntimeApiKey();
      applySummaryApiKeyUiState();
      return;
    }
    try {
      const decrypted = await decryptApiKeyWithPassphrase(passphrase);
      runtimeSecrets.apiKey = String(decrypted || "").trim();
      runtimeSecrets.unlockedAt = nowIso();
      persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
      appendLogEntry({
        level: "info",
        component: "secure-settings",
        operation: "tryUnlockOnStartup",
        message: "Encrypted API key unlocked on app startup.",
      });
    } catch (error) {
      clearRuntimeApiKey();
      appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "tryUnlockOnStartup",
        message: "Startup unlock failed.",
        error,
      });
      alert(
        "Could not unlock saved API key. You can retry from Summary AI settings.",
      );
    } finally {
      applySummaryApiKeyUiState();
    }
  }

  async function maybeMigrateLegacyApiKey() {
    const legacyKey = String(legacyPlaintextApiKeyForMigration || "").trim();
    if (!legacyKey) return;

    legacyPlaintextApiKeyForMigration = "";
    const passphrase = window.prompt(
      "A legacy plaintext API key was detected. Create a passphrase to encrypt and migrate it now:",
      "",
    );

    if (!passphrase) {
      appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "maybeMigrateLegacyApiKey",
        message: "Legacy API key migration skipped by user.",
      });
      return;
    }

    const confirmPassphrase = window.prompt(
      "Confirm migration passphrase:",
      "",
    );
    if (passphrase !== confirmPassphrase) {
      appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "maybeMigrateLegacyApiKey",
        message: "Legacy API key migration passphrase mismatch.",
      });
      alert(
        "Passphrase confirmation did not match. Legacy key was not migrated.",
      );
      return;
    }

    try {
      await encryptApiKeyWithPassphrase(legacyKey, passphrase);
      runtimeSecrets.apiKey = legacyKey;
      runtimeSecrets.unlockedAt = nowIso();
      persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
      const settings = getBookAiSettings();
      settings.apiKeySaved = true;
      settings.apiKeyLastUpdated = secureSettings.keyUpdatedAt || nowIso();
      saveState();
      applySummaryApiKeyUiState();
      appendLogEntry({
        level: "info",
        component: "secure-settings",
        operation: "maybeMigrateLegacyApiKey",
        message: "Legacy API key migrated to encrypted storage.",
      });
      alert(
        "Legacy API key migrated successfully and unlocked for this session.",
      );
    } catch (error) {
      appendLogEntry({
        level: "error",
        component: "secure-settings",
        operation: "maybeMigrateLegacyApiKey",
        message: "Failed to migrate legacy API key.",
        error,
      });
      alert("Failed to migrate legacy API key.");
    }
  }

  function wipeStoredApiKey() {
    secureSettings.keyCiphertext = null;
    secureSettings.saltBase64 = null;
    secureSettings.ivBase64 = null;
    secureSettings.keyUpdatedAt = null;
    persistSecureSettings();
    clearRuntimeApiKey();
    persistRuntimeApiKeyCache("");
    const settings = getBookAiSettings();
    settings.apiKeySaved = false;
    settings.apiKeyLastUpdated = "";
    saveState();
    applySummaryApiKeyUiState();
    appendLogEntry({
      level: "info",
      component: "secure-settings",
      operation: "wipeStoredApiKey",
      message: "Encrypted API key removed.",
    });
  }

  function ensureModelAllowed(value) {
    const candidate = String(value || "").trim();
    if (!candidate) return "gemini-2.5-flash";
    if (GEMINI_MODELS.includes(candidate)) return candidate;
    return "gemini-2.5-flash";
  }

  function closeSummaryModelDropdown() {
    const picker = document.getElementById("summaryModelPicker");
    const input = document.getElementById("summaryModelInput");
    if (!picker || !input) return;
    summaryModelPickerState.isOpen = false;
    picker.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
  }

  function setSummaryModelValue(modelName, closeAfterSelect = true) {
    const input = document.getElementById("summaryModelInput");
    if (!input) return;
    input.value = ensureModelAllowed(modelName);
    if (closeAfterSelect) {
      closeSummaryModelDropdown();
    }
  }

  function renderSummaryModelOptions() {
    const dropdown = document.getElementById("summaryModelDropdown");
    if (!dropdown) return;

    if (!summaryModelPickerState.filtered.length) {
      dropdown.innerHTML =
        '<div class="model-picker-empty">No matching model. Keep typing...</div>';
      return;
    }

    dropdown.innerHTML = summaryModelPickerState.filtered
      .map((modelName, idx) => {
        const activeClass =
          idx === summaryModelPickerState.activeIndex ? " active" : "";
        return `<button class="model-picker-option${activeClass}" type="button" role="option" data-model="${sanitize(modelName)}" aria-selected="${idx === summaryModelPickerState.activeIndex}">${sanitize(modelName)}</button>`;
      })
      .join("");

    dropdown.querySelectorAll(".model-picker-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        setSummaryModelValue(btn.dataset.model || "gemini-2.5-flash", true);
      });
    });
  }

  function updateSummaryModelFilter(query) {
    const needle = String(query || "")
      .trim()
      .toLowerCase();
    const sorted = [...GEMINI_MODELS].sort((a, b) => a.localeCompare(b));
    if (!needle) {
      summaryModelPickerState.filtered = sorted;
    } else {
      summaryModelPickerState.filtered = sorted.filter((name) =>
        name.toLowerCase().includes(needle),
      );
    }
    summaryModelPickerState.activeIndex = summaryModelPickerState.filtered
      .length
      ? 0
      : -1;
    renderSummaryModelOptions();
  }

  function openSummaryModelDropdown() {
    const picker = document.getElementById("summaryModelPicker");
    const input = document.getElementById("summaryModelInput");
    if (!picker || !input) return;

    summaryModelPickerState.isOpen = true;
    picker.classList.add("open");
    input.setAttribute("aria-expanded", "true");
    updateSummaryModelFilter(input.value);
  }

  function moveSummaryModelActive(delta) {
    if (!summaryModelPickerState.filtered.length) return;
    const next = summaryModelPickerState.activeIndex + delta;
    if (next < 0) {
      summaryModelPickerState.activeIndex =
        summaryModelPickerState.filtered.length - 1;
    } else if (next >= summaryModelPickerState.filtered.length) {
      summaryModelPickerState.activeIndex = 0;
    } else {
      summaryModelPickerState.activeIndex = next;
    }
    renderSummaryModelOptions();

    const dropdown = document.getElementById("summaryModelDropdown");
    if (!dropdown) return;
    const activeOption = dropdown.querySelector(".model-picker-option.active");
    if (activeOption) {
      activeOption.scrollIntoView({ block: "nearest" });
    }
  }

  function confirmSummaryModelSelection() {
    if (!summaryModelPickerState.filtered.length) {
      setSummaryModelValue("gemini-2.5-flash", true);
      return;
    }

    const selected =
      summaryModelPickerState.filtered[summaryModelPickerState.activeIndex] ||
      summaryModelPickerState.filtered[0] ||
      "gemini-2.5-flash";
    setSummaryModelValue(selected, true);
  }

  function bindSummaryModelPicker() {
    const input = document.getElementById("summaryModelInput");
    const toggle = document.getElementById("summaryModelToggle");
    const picker = document.getElementById("summaryModelPicker");
    if (!input || !toggle || !picker) return;

    updateSummaryModelFilter(input.value);

    input.addEventListener("focus", () => {
      openSummaryModelDropdown();
    });

    input.addEventListener("input", () => {
      if (!summaryModelPickerState.isOpen) {
        openSummaryModelDropdown();
      }
      updateSummaryModelFilter(input.value);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!summaryModelPickerState.isOpen) {
          openSummaryModelDropdown();
        } else {
          moveSummaryModelActive(1);
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!summaryModelPickerState.isOpen) {
          openSummaryModelDropdown();
        } else {
          moveSummaryModelActive(-1);
        }
      } else if (event.key === "Enter") {
        if (!summaryModelPickerState.isOpen) return;
        event.preventDefault();
        confirmSummaryModelSelection();
      } else if (event.key === "Escape") {
        closeSummaryModelDropdown();
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(() => {
        const activeEl = document.activeElement;
        if (picker.contains(activeEl)) return;
        closeSummaryModelDropdown();
      }, 100);
    });

    toggle.addEventListener("click", () => {
      if (summaryModelPickerState.isOpen) {
        closeSummaryModelDropdown();
        return;
      }
      openSummaryModelDropdown();
      input.focus();
    });

    document.addEventListener("click", (event) => {
      if (!picker.contains(event.target)) {
        closeSummaryModelDropdown();
      }
    });
  }

  function formatIsoForDisplay(iso) {
    if (!iso) return "-";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return String(iso);
    return dt.toLocaleString();
  }

  function formatTopClockDateTime(date) {
    return date.toLocaleString(undefined, {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function updateTopClock() {
    const topDateTime = document.getElementById("topDateTime");
    if (!topDateTime) return;
    topDateTime.textContent = formatTopClockDateTime(new Date());
  }

  function initTopClock() {
    updateTopClock();
    if (topClockTimer) {
      clearInterval(topClockTimer);
    }
    topClockTimer = setInterval(updateTopClock, 1000);
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function normalizeWeekdayArray(values) {
    return [
      ...new Set(
        (Array.isArray(values) ? values : [])
          .map((d) => parseInt(d, 10))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      ),
    ].sort((a, b) => a - b);
  }

  function normalizeMonthDayArray(values) {
    return [
      ...new Set(
        (Array.isArray(values) ? values : [])
          .map((d) => parseInt(d, 10))
          .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31),
      ),
    ].sort((a, b) => a - b);
  }

  function getHabitScheduleMode(habit) {
    const mode = String(
      (habit && (habit.scheduleMode || habit.type)) || "fixed",
    );
    if (mode === "specific_weekdays" || mode === "specific_month_days") {
      return mode;
    }
    return "fixed";
  }

  function getPossibleActiveDaysInMonth(habit, year, month) {
    const totalDays = daysInMonth(year, month);
    let activeDays = 0;
    for (let day = 1; day <= totalDays; day += 1) {
      if (isHabitTrackedOnDate(habit, year, month, day)) {
        activeDays += 1;
      }
    }
    return activeDays;
  }

  function buildScheduleCheckboxes(
    containerId,
    values,
    labelBuilder,
    selectedValues,
  ) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const selected = new Set(
      Array.isArray(selectedValues) ? selectedValues : [],
    );
    container.innerHTML = values
      .map((value) => {
        const checked = selected.has(value) ? "checked" : "";
        const inputId = `${containerId}_${value}`;
        return `<label class='schedule-day-option' for='${inputId}'><input id='${inputId}' type='checkbox' value='${value}' ${checked}><span>${sanitize(labelBuilder(value))}</span></label>`;
      })
      .join("");
  }

  function getCheckedValuesFromContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(
      container.querySelectorAll("input[type='checkbox']:checked"),
    )
      .map((input) => parseInt(input.value, 10))
      .filter((value) => Number.isInteger(value));
  }

  function renderHabitScheduleSelectors(habit) {
    const mode = getHabitScheduleMode(habit || {});
    const weekdays = normalizeWeekdayArray(
      habit && Array.isArray(habit.activeWeekdays)
        ? habit.activeWeekdays
        : ALL_WEEKDAYS,
    );
    const monthDays = normalizeMonthDayArray(
      habit && Array.isArray(habit.activeMonthDays)
        ? habit.activeMonthDays
        : [1],
    );

    buildScheduleCheckboxes(
      "habitActiveWeekdays",
      ALL_WEEKDAYS,
      (value) => WEEKDAY_LABELS[value],
      weekdays,
    );
    buildScheduleCheckboxes(
      "habitActiveMonthDays",
      Array.from({ length: 31 }, (_, idx) => idx + 1),
      (value) => String(value),
      monthDays,
    );

    updateHabitScheduleTypeUI(mode);
  }

  function updateHabitScheduleTypeUI(scheduleMode) {
    const mode =
      scheduleMode === "specific_month_days"
        ? "specific_month_days"
        : scheduleMode === "specific_weekdays"
          ? "specific_weekdays"
          : "fixed";
    const weekdaysGroup = document.getElementById("habitWeekdaysGroup");
    const monthDaysGroup = document.getElementById("habitMonthDaysGroup");
    if (weekdaysGroup) {
      weekdaysGroup.style.display =
        mode === "specific_weekdays" ? "block" : "none";
    }
    if (monthDaysGroup) {
      monthDaysGroup.style.display =
        mode === "specific_month_days" ? "block" : "none";
    }
  }

  function getIsoWeekNumber(year, month, day) {
    const date = new Date(Date.UTC(year, month, day));
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  }

  function getDefaultMonthData() {
    return {
      dailyCompletions: {},
      dailyNotes: {},
      monthlyReview: { wins: "", blockers: "", focus: "" },
    };
  }

  function ensureMonthDataShape(monthData) {
    if (!isPlainObject(monthData.dailyCompletions)) {
      monthData.dailyCompletions = {};
    }
    if (!isPlainObject(monthData.dailyNotes)) {
      monthData.dailyNotes = {};
    }
    if (!isPlainObject(monthData.monthlyReview)) {
      monthData.monthlyReview = {};
    }
    monthData.monthlyReview.wins = String(monthData.monthlyReview.wins || "");
    monthData.monthlyReview.blockers = String(
      monthData.monthlyReview.blockers || "",
    );
    monthData.monthlyReview.focus = String(monthData.monthlyReview.focus || "");
    return monthData;
  }

  function ensureBooksShape(input) {
    if (!isPlainObject(input.books)) {
      input.books = { items: [], activeBookId: null };
    }
    if (!Array.isArray(input.books.items)) {
      input.books.items = [];
    }
    if (typeof input.books.activeBookId !== "string") {
      input.books.activeBookId = null;
    }
    if (!isPlainObject(input.books.ai)) {
      input.books.ai = {};
    }
    input.books.ai.apiKey = "";
    input.books.ai.apiKeyMode = "encrypted";
    input.books.ai.apiKeySaved = hasStoredEncryptedApiKey();
    input.books.ai.apiKeyLastUpdated = String(
      input.books.ai.apiKeyLastUpdated || "",
    );
    input.books.ai.model = ensureModelAllowed(input.books.ai.model);
    const normalizedChunkChars = parseInt(input.books.ai.chunkChars, 10);
    input.books.ai.chunkChars = Number.isFinite(normalizedChunkChars)
      ? Math.min(30000, Math.max(4000, normalizedChunkChars))
      : SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT;
    const normalizedMaxPages = parseInt(input.books.ai.maxPagesPerRun, 10);
    input.books.ai.maxPagesPerRun = Number.isFinite(normalizedMaxPages)
      ? Math.min(1000, Math.max(20, normalizedMaxPages))
      : SUMMARY_MAX_PAGES_PER_RUN_DEFAULT;
    input.books.ai.consolidateMode =
      input.books.ai.consolidateMode === false ? false : true;

    input.books.items = input.books.items
      .filter((book) => isPlainObject(book) && typeof book.bookId === "string")
      .map((book) => {
        const createdAt = String(book.createdAt || nowIso());
        const updatedAt = String(book.updatedAt || createdAt);
        const cleanBook = {
          bookId: String(book.bookId),
          title:
            String(book.title || "Untitled Book").trim() || "Untitled Book",
          author: book.author ? String(book.author) : "",
          fileId: String(book.fileId || uid("file")),
          fileName: String(book.fileName || "unknown.pdf"),
          fileSize: Number.isFinite(book.fileSize)
            ? Math.max(0, book.fileSize)
            : 0,
          totalPagesDetected: Number.isFinite(
            parseInt(book.totalPagesDetected, 10),
          )
            ? Math.max(1, parseInt(book.totalPagesDetected, 10))
            : null,
          totalPagesDetectedAt: String(book.totalPagesDetectedAt || ""),
          totalPagesOverride: Number.isFinite(
            parseInt(book.totalPagesOverride, 10),
          )
            ? Math.max(1, parseInt(book.totalPagesOverride, 10))
            : null,
          createdAt,
          updatedAt,
          bookmarks: [],
        };

        const rawBookmarks = Array.isArray(book.bookmarks)
          ? book.bookmarks
          : [];
        cleanBook.bookmarks = rawBookmarks
          .filter(
            (bm) =>
              isPlainObject(bm) &&
              typeof bm.bookmarkId === "string" &&
              Number.isFinite(Number(bm.pdfPage)),
          )
          .map((bm) => {
            const bmCreatedAt = String(bm.createdAt || nowIso());
            const bmUpdatedAt = String(bm.updatedAt || bmCreatedAt);
            const history = Array.isArray(bm.history) ? bm.history : [];
            const bookmarkPage = Math.max(1, parseInt(bm.pdfPage, 10) || 1);
            const summaries = Array.isArray(bm.summaries) ? bm.summaries : [];
            return {
              bookmarkId: String(bm.bookmarkId),
              label: String(bm.label || "Bookmark").trim() || "Bookmark",
              pdfPage: bookmarkPage,
              realPage: (() => {
                const parsed = parseInt(bm.realPage, 10);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
              })(),
              note: String(bm.note || ""),
              createdAt: bmCreatedAt,
              updatedAt: bmUpdatedAt,
              history: history
                .filter((h) => isPlainObject(h))
                .map((h) => ({
                  eventId: String(h.eventId || uid("hist")),
                  type: String(h.type || "updated"),
                  at: String(h.at || bmUpdatedAt),
                  note: String(h.note || ""),
                }))
                .sort((a, b) => (a.at < b.at ? 1 : -1))
                .slice(0, MAX_BOOKMARK_HISTORY),
              summaries: summaries
                .filter((s) => isPlainObject(s))
                .map((s) => {
                  const createdAt = String(s.createdAt || nowIso());
                  const updatedAt = String(s.updatedAt || createdAt);
                  const fallbackStart =
                    s.isIncremental === true
                      ? Math.max(1, parseInt(s.startPage, 10) || 1)
                      : 1;
                  const startPage = Math.max(
                    1,
                    parseInt(s.startPage, 10) || fallbackStart,
                  );
                  const endPage = Math.max(
                    startPage,
                    parseInt(s.endPage, 10) || bookmarkPage,
                  );
                  const status = ["ready", "failed", "running"].includes(
                    String(s.status || ""),
                  )
                    ? String(s.status)
                    : String(s.content || "").trim().length
                      ? "ready"
                      : "failed";
                  const basedOnSummaryId =
                    typeof s.basedOnSummaryId === "string" &&
                    s.basedOnSummaryId.trim()
                      ? s.basedOnSummaryId
                      : null;
                  const durationMs = Number.isFinite(Number(s.durationMs))
                    ? Math.max(0, Number(s.durationMs))
                    : null;
                  return {
                    summaryId: String(s.summaryId || uid("sum")),
                    model: String(s.model || ""),
                    startPage,
                    endPage,
                    isIncremental: s.isIncremental === true,
                    basedOnSummaryId,
                    createdAt,
                    updatedAt,
                    status,
                    content: String(s.content || ""),
                    chunkMeta: isPlainObject(s.chunkMeta) ? s.chunkMeta : {},
                    durationMs,
                    error: String(s.error || ""),
                  };
                })
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
            };
          })
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

        return cleanBook;
      });

    if (!isPlainObject(input.books.helper)) {
      input.books.helper = {};
    }
    input.books.helper.selectedBookId =
      typeof input.books.helper.selectedBookId === "string"
        ? input.books.helper.selectedBookId
        : "";
    input.books.helper.targetDate =
      typeof input.books.helper.targetDate === "string"
        ? input.books.helper.targetDate
        : "";
    input.books.helper.startPage = Number.isFinite(
      parseInt(input.books.helper.startPage, 10),
    )
      ? Math.max(1, parseInt(input.books.helper.startPage, 10))
      : null;
    const rawWeekdays = Array.isArray(input.books.helper.weekdays)
      ? input.books.helper.weekdays
      : [...ALL_WEEKDAYS];
    input.books.helper.weekdays = [...new Set(rawWeekdays)]
      .map((value) => parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
      .sort((a, b) => a - b);
  }

  function getDefaultState() {
    const now = new Date();
    const key = monthKey(now.getFullYear(), now.getMonth());
    return {
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth(),
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      habits: {
        daily: DEFAULT_DAILY_HABITS.map((h, idx) => ({ ...h, order: idx })),
      },
      months: {
        [key]: getDefaultMonthData(),
      },
      books: {
        items: [],
        activeBookId: null,
        helper: {
          selectedBookId: "",
          targetDate: "",
          startPage: null,
          weekdays: [...ALL_WEEKDAYS],
        },
        ai: {
          apiKey: "",
          apiKeyMode: "encrypted",
          apiKeySaved: false,
          apiKeyLastUpdated: "",
          model: "gemini-2.5-flash",
          chunkChars: SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT,
          maxPagesPerRun: SUMMARY_MAX_PAGES_PER_RUN_DEFAULT,
          consolidateMode: true,
        },
      },
      meta: {
        schemaVersion: SCHEMA_VERSION,
      },
    };
  }

  function migrateState() {
    if (!isPlainObject(state)) {
      state = getDefaultState();
      return;
    }

    if (!Array.isArray(state.categories)) {
      state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }

    if (!isPlainObject(state.habits)) {
      state.habits = { daily: [] };
    }
    if (!Array.isArray(state.habits.daily)) {
      state.habits.daily = [];
    }
    delete state.habits.weekly;

    if (!isPlainObject(state.months)) {
      state.months = {};
    }
    Object.keys(state.months).forEach((key) => {
      if (!isPlainObject(state.months[key])) {
        state.months[key] = getDefaultMonthData();
      }
      delete state.months[key].weeklyCompletions;
      ensureMonthDataShape(state.months[key]);
    });

    state.habits.daily.forEach((habit, idx) => {
      habit.id = String(habit.id || uid("dh"));
      habit.name = String(habit.name || "Habit");
      habit.categoryId = String(habit.categoryId || "");
      habit.monthGoal = Math.max(1, parseInt(habit.monthGoal, 10) || 20);

      if (!Array.isArray(habit.excludedWeekdays)) {
        const legacy = Array.isArray(habit.excludedDays)
          ? habit.excludedDays
          : [];
        habit.excludedWeekdays = legacy
          .map((d) => parseInt(d, 10))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      }
      habit.excludedWeekdays = [...new Set(habit.excludedWeekdays)]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b);

      let mode = String(habit.scheduleMode || habit.type || "fixed");
      if (mode === "dynamic") {
        const activeWeekdays = ALL_WEEKDAYS.filter(
          (weekday) => !habit.excludedWeekdays.includes(weekday),
        );
        habit.activeWeekdays = activeWeekdays.length
          ? activeWeekdays
          : [...ALL_WEEKDAYS];
        mode =
          habit.activeWeekdays.length === 7 ? "fixed" : "specific_weekdays";
      }

      if (mode !== "specific_weekdays" && mode !== "specific_month_days") {
        mode = "fixed";
      }

      habit.activeWeekdays = normalizeWeekdayArray(
        Array.isArray(habit.activeWeekdays)
          ? habit.activeWeekdays
          : mode === "specific_weekdays"
            ? ALL_WEEKDAYS.filter(
                (weekday) => !habit.excludedWeekdays.includes(weekday),
              )
            : ALL_WEEKDAYS,
      );
      if (!habit.activeWeekdays.length) {
        habit.activeWeekdays = [...ALL_WEEKDAYS];
      }

      habit.activeMonthDays = normalizeMonthDayArray(
        Array.isArray(habit.activeMonthDays) ? habit.activeMonthDays : [],
      );
      if (mode === "specific_month_days" && !habit.activeMonthDays.length) {
        habit.activeMonthDays = [1];
      }

      if (mode === "fixed") {
        habit.activeWeekdays = [...ALL_WEEKDAYS];
      }

      habit.scheduleMode = mode;
      habit.type = mode;
      delete habit.excludedDays;
      habit.emoji = String(habit.emoji || "📌");
      habit.order = Number.isInteger(habit.order) ? habit.order : idx;
    });
    state.habits.daily.sort((a, b) => a.order - b.order);
    state.habits.daily.forEach((h, idx) => {
      h.order = idx;
    });

    ensureBooksShape(state);

    if (!isPlainObject(state.meta)) {
      state.meta = {};
    }
    state.meta.schemaVersion = SCHEMA_VERSION;

    if (!Number.isInteger(state.currentYear)) {
      state.currentYear = new Date().getFullYear();
    }
    if (
      !Number.isInteger(state.currentMonth) ||
      state.currentMonth < 0 ||
      state.currentMonth > 11
    ) {
      state.currentMonth = new Date().getMonth();
    }
  }

  function ensureMonthData() {
    const key = monthKey(state.currentYear, state.currentMonth);
    if (!state.months[key]) {
      state.months[key] = getDefaultMonthData();
    }
    ensureMonthDataShape(state.months[key]);
  }

  function getCurrentMonthData() {
    ensureMonthData();
    return state.months[monthKey(state.currentYear, state.currentMonth)];
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        migrateState();
        ensureMonthData();
        if (
          isPlainObject(state.books) &&
          isPlainObject(state.books.ai) &&
          typeof state.books.ai.apiKey === "string" &&
          state.books.ai.apiKey.trim().length
        ) {
          legacyPlaintextApiKeyForMigration = state.books.ai.apiKey.trim();
          appendLogEntry({
            level: "warn",
            component: "secure-settings",
            operation: "loadState",
            message: "Legacy plaintext API key detected; scrubbing from state.",
          });
          state.books.ai.apiKey = "";
        }
        saveState();
        return;
      }
    } catch (error) {
      appendLogEntry({
        level: "error",
        component: "state",
        operation: "loadState",
        message: "Failed to load state, using defaults.",
        error,
      });
    }

    state = getDefaultState();
    saveState();
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getCategoryById(categoryId) {
    return state.categories.find((c) => c.id === categoryId) || null;
  }

  function getHabitEmoji(habit) {
    if (habit.emoji) return habit.emoji;
    const cat = getCategoryById(habit.categoryId);
    return cat ? cat.emoji : "📌";
  }

  function isHabitTrackedOnDate(habit, year, month, day) {
    if (!habit) return true;
    const mode = getHabitScheduleMode(habit);
    if (mode === "fixed") return true;

    if (mode === "specific_weekdays") {
      const weekday = new Date(year, month, day).getDay();
      const activeWeekdays = normalizeWeekdayArray(
        Array.isArray(habit.activeWeekdays)
          ? habit.activeWeekdays
          : ALL_WEEKDAYS,
      );
      return activeWeekdays.includes(weekday);
    }

    if (mode === "specific_month_days") {
      const activeMonthDays = normalizeMonthDayArray(
        Array.isArray(habit.activeMonthDays) ? habit.activeMonthDays : [],
      );
      return activeMonthDays.includes(day);
    }

    return true;
  }

  function getSortedDailyHabits() {
    return [...state.habits.daily].sort(
      (a, b) => (a.order || 0) - (b.order || 0),
    );
  }

  function updateHabitOrder() {
    state.habits.daily = getSortedDailyHabits();
    state.habits.daily.forEach((h, idx) => {
      h.order = idx;
    });
  }

  function moveDailyHabit(habitId, direction) {
    const habits = getSortedDailyHabits();
    const fromIndex = habits.findIndex((h) => h.id === habitId);
    if (fromIndex < 0) return;

    const offset = direction === "up" ? -1 : 1;
    const targetIndex = fromIndex + offset;
    if (targetIndex < 0 || targetIndex >= habits.length) return;

    const moved = habits.splice(fromIndex, 1)[0];
    habits.splice(targetIndex, 0, moved);
    habits.forEach((habit, idx) => {
      habit.order = idx;
    });

    state.habits.daily = habits;
    saveState();
    renderAll();
  }

  function navigateMonth(delta) {
    state.currentMonth += delta;
    if (state.currentMonth > 11) {
      state.currentMonth = 0;
      state.currentYear += 1;
    } else if (state.currentMonth < 0) {
      state.currentMonth = 11;
      state.currentYear -= 1;
    }
    ensureMonthData();
    saveState();
    renderAll();
  }

  function switchView(viewId) {
    document
      .querySelectorAll(".view")
      .forEach((view) => view.classList.remove("active"));
    document
      .querySelectorAll(".nav-tab")
      .forEach((tab) => tab.classList.remove("active"));

    const viewEl = document.getElementById(`view-${viewId}`);
    if (viewEl) viewEl.classList.add("active");

    const tabEl = document.querySelector(`.nav-tab[data-view="${viewId}"]`);
    if (tabEl) tabEl.classList.add("active");

    document.querySelector(".sidebar").classList.remove("open");

    if (viewId === "books") {
      renderBooksView();
      return;
    }

    if (viewId === "analytics") {
      renderAnalyticsView();
      return;
    }

    if (viewId === "logs") {
      renderLogsView();
      return;
    }

    if (viewId === "dashboard") {
      renderAll();
    }
  }

  function renderMonthHeader() {
    const name = `${MONTH_NAMES[state.currentMonth]} ${state.currentYear}`;
    const monthName = document.getElementById("monthName");
    if (monthName) monthName.textContent = name;
  }

  function renderSummary() {
    const monthData = getCurrentMonthData();
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);

    let completed = 0;
    let goal = 0;

    habits.forEach((habit) => {
      let activeDays = 0;
      for (let d = 1; d <= totalDays; d++) {
        if (
          !isHabitTrackedOnDate(habit, state.currentYear, state.currentMonth, d)
        ) {
          continue;
        }
        activeDays += 1;
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][d]
        ) {
          completed += 1;
        }
      }
      goal += Math.min(habit.monthGoal || totalDays, activeDays);
    });

    const totalCompleted = document.getElementById("totalCompleted");
    const totalGoal = document.getElementById("totalGoal");
    if (totalCompleted) totalCompleted.textContent = String(completed);
    if (totalGoal) totalGoal.textContent = String(goal);

    const pct = goal > 0 ? Math.round((completed / goal) * 100) : 0;
    renderDonut("summaryDonut", pct);
  }

  function renderDonut(canvasId, pct) {
    if (typeof Chart === "undefined") return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
    }

    const ctx = canvas.getContext("2d");
    chartInstances[canvasId] = new Chart(ctx, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: [pct, 100 - pct],
            backgroundColor: [getValueColor(pct, 100, 0.9), "#1a2840"],
            borderWidth: 0,
          },
        ],
      },
      options: {
        cutout: "72%",
        responsive: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
      plugins: [
        {
          id: "centerText",
          afterDraw(chart) {
            const { ctx: c, width, height } = chart;
            c.save();
            c.font = "bold 20px Inter, sans-serif";
            c.fillStyle = "#d5e2f5";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillText(`${pct}%`, width / 2, height / 2);
            c.restore();
          },
        },
      ],
    });
  }

  function clearLinkedHoverHighlights() {
    document
      .querySelectorAll(
        ".week-card.linked-week-active, .week-mini-bar.linked-capsule-active, th.day-col.linked-day-active, th.day-col.linked-week-active, td.day-cell.linked-day-active, td.day-cell.linked-week-active",
      )
      .forEach((element) => {
        element.classList.remove(
          "linked-week-active",
          "linked-capsule-active",
          "linked-day-active",
        );
      });
  }

  function ensureLinkedHoverTooltip() {
    let tooltip = document.getElementById("linkedHoverTooltip");
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.id = "linkedHoverTooltip";
    tooltip.className = "linked-hover-tooltip";
    tooltip.setAttribute("role", "status");
    tooltip.setAttribute("aria-live", "polite");
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function hideLinkedHoverTooltip() {
    const tooltip = document.getElementById("linkedHoverTooltip");
    if (!tooltip) return;
    tooltip.classList.remove("visible");
  }

  function showLinkedHoverTooltip(text, point) {
    if (!text || !point) return;
    const tooltip = ensureLinkedHoverTooltip();
    tooltip.textContent = text;
    tooltip.style.left = `${Math.round(point.x)}px`;
    tooltip.style.top = `${Math.round(point.y)}px`;
    tooltip.classList.add("visible");
  }

  function updateLinkedHoverTooltipPositionFromMouse(event) {
    const tooltip = document.getElementById("linkedHoverTooltip");
    if (!tooltip || !tooltip.classList.contains("visible")) return;
    tooltip.style.left = `${Math.round(event.clientX + 16)}px`;
    tooltip.style.top = `${Math.round(event.clientY - 28)}px`;
  }

  function weekRangeFromIndex(week, totalDays) {
    const maxWeek = Math.max(1, Math.min(5, Math.ceil(totalDays / 7)));
    const normalizedWeek = Math.min(maxWeek, Math.max(1, week));
    const start = (normalizedWeek - 1) * 7 + 1;
    const end = Math.min(normalizedWeek * 7, totalDays);
    return { week: normalizedWeek, start, end };
  }

  function weekFromDay(day, totalDays) {
    if (!Number.isFinite(day) || day < 1 || day > totalDays) return null;
    return weekRangeFromIndex(Math.ceil(day / 7), totalDays).week;
  }

  function activateLinkedDay(day, options = {}) {
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const normalizedDay = parseInt(day, 10);
    if (!Number.isFinite(normalizedDay) || normalizedDay < 1) return;
    if (normalizedDay > totalDays) return;

    const week = weekFromDay(normalizedDay, totalDays);
    if (!week) return;

    clearLinkedHoverHighlights();

    const weekCard = document.querySelector(`.week-card[data-week='${week}']`);
    if (weekCard) {
      weekCard.classList.add("linked-week-active");
    }

    const weekCapsule = document.querySelector(
      `.week-mini-bar[data-day='${normalizedDay}']`,
    );
    if (weekCapsule) {
      weekCapsule.classList.add("linked-capsule-active");
    }

    document
      .querySelectorAll(`th.day-col[data-day='${normalizedDay}']`)
      .forEach((header) => header.classList.add("linked-day-active"));

    document
      .querySelectorAll(`td.day-cell[data-day='${normalizedDay}']`)
      .forEach((cell) => cell.classList.add("linked-day-active"));

    linkedHoverState = {
      day: normalizedDay,
      week,
      scope: "day",
      source: options.source || "unknown",
    };

    if (options.event && options.event.clientX && options.event.clientY) {
      showLinkedHoverTooltip(`Week ${week} • Day ${normalizedDay}`, {
        x: options.event.clientX + 16,
        y: options.event.clientY - 28,
      });
    } else if (options.anchorElement) {
      const rect = options.anchorElement.getBoundingClientRect();
      showLinkedHoverTooltip(`Week ${week} • Day ${normalizedDay}`, {
        x: rect.left + rect.width / 2,
        y: rect.top - 12,
      });
    }
  }

  function activateLinkedWeek(week, options = {}) {
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const parsedWeek = parseInt(week, 10);
    if (!Number.isFinite(parsedWeek) || parsedWeek < 1) return;

    const range = weekRangeFromIndex(parsedWeek, totalDays);
    clearLinkedHoverHighlights();

    const weekCard = document.querySelector(
      `.week-card[data-week='${range.week}']`,
    );
    if (weekCard) {
      weekCard.classList.add("linked-week-active");
    }

    for (let day = range.start; day <= range.end; day++) {
      document
        .querySelectorAll(`th.day-col[data-day='${day}']`)
        .forEach((header) => header.classList.add("linked-week-active"));

      document
        .querySelectorAll(`td.day-cell[data-day='${day}']`)
        .forEach((cell) => cell.classList.add("linked-week-active"));
    }

    linkedHoverState = {
      day: null,
      week: range.week,
      scope: "week",
      source: options.source || "unknown",
    };

    if (options.event && options.event.clientX && options.event.clientY) {
      showLinkedHoverTooltip(
        `Week ${range.week} • Days ${range.start}-${range.end}`,
        { x: options.event.clientX + 16, y: options.event.clientY - 28 },
      );
    } else if (options.anchorElement) {
      const rect = options.anchorElement.getBoundingClientRect();
      showLinkedHoverTooltip(
        `Week ${range.week} • Days ${range.start}-${range.end}`,
        { x: rect.left + rect.width / 2, y: rect.top - 12 },
      );
    }
  }

  function clearLinkedHoverState() {
    linkedHoverState = {
      day: null,
      week: null,
      scope: null,
      source: null,
    };
    clearLinkedHoverHighlights();
    hideLinkedHoverTooltip();
  }

  function bindWeeklySummaryHoverInteractions(container) {
    if (!container || container.dataset.linkedHoverBound === "true") return;

    container.addEventListener("mouseover", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const capsule = target.closest(".week-mini-bar[data-day]");
      if (capsule) {
        activateLinkedDay(parseInt(capsule.dataset.day, 10), {
          source: "weekly",
          event,
        });
        return;
      }

      const card = target.closest(".week-card[data-week]");
      if (!card) return;
      activateLinkedWeek(parseInt(card.dataset.week, 10), {
        source: "weekly",
        event,
      });
    });

    container.addEventListener("mousemove", (event) => {
      updateLinkedHoverTooltipPositionFromMouse(event);
    });

    container.addEventListener("mouseleave", () => {
      if (linkedHoverState.source !== "weekly") return;
      clearLinkedHoverState();
    });

    container.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const capsule = target.closest(".week-mini-bar[data-day]");
      if (capsule) {
        activateLinkedDay(parseInt(capsule.dataset.day, 10), {
          source: "weekly",
          anchorElement: capsule,
        });
        return;
      }

      const card = target.closest(".week-card[data-week]");
      if (!card) return;
      activateLinkedWeek(parseInt(card.dataset.week, 10), {
        source: "weekly",
        anchorElement: card,
      });
    });

    container.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && container.contains(next)) return;
      if (linkedHoverState.source !== "weekly") return;
      clearLinkedHoverState();
    });

    container.dataset.linkedHoverBound = "true";
  }

  function bindDailyGridHoverInteractions(grid) {
    if (!grid || grid.dataset.linkedHoverBound === "true") return;

    grid.addEventListener("mouseover", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const dayHost = target.closest(
        "th.day-col[data-day], td.day-cell[data-day]",
      );
      if (!dayHost) return;
      activateLinkedDay(parseInt(dayHost.dataset.day, 10), {
        source: "grid",
        event,
      });
    });

    grid.addEventListener("mousemove", (event) => {
      updateLinkedHoverTooltipPositionFromMouse(event);
    });

    grid.addEventListener("mouseleave", () => {
      if (linkedHoverState.source !== "grid") return;
      clearLinkedHoverState();
    });

    grid.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const dayHost = target.closest(
        "th.day-col[data-day], td.day-cell[data-day]",
      );
      if (!dayHost) return;
      activateLinkedDay(parseInt(dayHost.dataset.day, 10), {
        source: "grid",
        anchorElement: dayHost,
      });
    });

    grid.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && grid.contains(next)) return;
      if (linkedHoverState.source !== "grid") return;
      clearLinkedHoverState();
    });

    grid.dataset.linkedHoverBound = "true";
  }

  function renderWeeklySummaryCards() {
    const container = document.getElementById("weeklySummaryCards");
    if (!container) return;

    const monthData = getCurrentMonthData();
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const maxWeek = Math.min(5, Math.ceil(totalDays / 7));

    let html = "";
    for (let week = 1; week <= maxWeek; week++) {
      const start = (week - 1) * 7 + 1;
      const end = Math.min(week * 7, totalDays);
      const weekAccent = getWeekShadeColor(week);
      let done = 0;
      let possible = 0;
      const dayCompletionRates = [];

      for (let day = start; day <= end; day++) {
        let dayDone = 0;
        let dayPossible = 0;

        habits.forEach((habit) => {
          if (
            !isHabitTrackedOnDate(
              habit,
              state.currentYear,
              state.currentMonth,
              day,
            )
          ) {
            return;
          }

          dayPossible += 1;
          if (
            monthData.dailyCompletions[habit.id] &&
            monthData.dailyCompletions[habit.id][day]
          ) {
            dayDone += 1;
          }
        });

        done += dayDone;
        possible += dayPossible;
        dayCompletionRates.push(
          dayPossible > 0 ? Math.round((dayDone / dayPossible) * 100) : 0,
        );
      }

      const pct = possible > 0 ? Math.round((done / possible) * 100) : 0;
      const weekColor = getValueColor(pct, 100, 0.92);
      const weekShadowColor = getValueColor(pct, 100, 0.25);
      const bars = dayCompletionRates
        .map(
          (value, idx) =>
            `<span class="week-mini-bar" style="--bar-pct:${value};--bar-fill-color:${getValueColor(value, 100, 0.9)};--bar-border-color:${getValueColor(value, 100, 0.42)}" title="Day ${start + idx}: ${value}%" data-day="${start + idx}" data-week="${week}" tabindex="0" aria-label="Week ${week} day ${start + idx} completion ${value}%"></span>`,
        )
        .join("");

      html += `<div class="week-card" style="--week-accent:${weekAccent}" data-week="${week}" tabindex="0"><div class="week-card-top"><span class="week-card-title">Week ${week}</span><span class="week-range">${start}-${end}</span></div><div class="week-ring" style="--week-pct:${pct};--week-color:${weekColor};--week-shadow:${weekShadowColor}" aria-label="Week ${week} completion ${pct}%"><span class="week-pct">${pct}%</span></div><div class="week-meta">${done}/${possible} tasks</div><div class="week-mini-bars">${bars}</div></div>`;
    }

    container.innerHTML = html;
    bindWeeklySummaryHoverInteractions(container);
  }

  function renderDailyBarChart() {
    if (typeof Chart === "undefined") return;
    const canvas = document.getElementById("dailyBarChart");
    if (!canvas) return;

    const monthData = getCurrentMonthData();
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);

    const labels = [];
    const values = [];
    for (let day = 1; day <= totalDays; day++) {
      labels.push(day);
      let count = 0;
      habits.forEach((habit) => {
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          return;
        }
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        ) {
          count += 1;
        }
      });
      values.push(count);
    }

    if (chartInstances.dailyBarChart) {
      chartInstances.dailyBarChart.destroy();
    }

    chartInstances.dailyBarChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: values.map((value) =>
              getValueColor(value, Math.max(1, ...values), 0.86),
            ),
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    });
  }

  function renderCategoryBarChart() {
    if (typeof Chart === "undefined") return;
    const canvas = document.getElementById("categoryBarChart");
    if (!canvas) return;

    const monthData = getCurrentMonthData();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const habits = getSortedDailyHabits();

    const map = {};
    state.categories.forEach((c) => {
      map[c.id] = { name: c.name, emoji: c.emoji, completed: 0 };
    });

    habits.forEach((habit) => {
      const bucket = map[habit.categoryId];
      if (!bucket) return;
      for (let day = 1; day <= totalDays; day++) {
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          continue;
        }
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        ) {
          bucket.completed += 1;
        }
      }
    });

    const entries = Object.values(map).filter((x) => x.completed > 0);
    if (entries.length === 0) {
      if (chartInstances.categoryBarChart) {
        chartInstances.categoryBarChart.destroy();
      }
      return;
    }

    if (chartInstances.categoryBarChart) {
      chartInstances.categoryBarChart.destroy();
    }

    chartInstances.categoryBarChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: entries.map((e) => `${e.emoji} ${e.name}`),
        datasets: [
          {
            data: entries.map((e) => e.completed),
            backgroundColor: entries.map((e) =>
              getValueColor(
                e.completed,
                Math.max(1, ...entries.map((item) => item.completed)),
                0.86,
              ),
            ),
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    });
  }

  function safeMonthData(year, month) {
    const key = monthKey(year, month);
    const monthData = state.months[key];
    if (!isPlainObject(monthData)) {
      return getDefaultMonthData();
    }
    return ensureMonthDataShape(monthData);
  }

  function buildMonthTotals(year, month) {
    const monthData = safeMonthData(year, month);
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(year, month);
    let done = 0;
    let possible = 0;

    for (let day = 1; day <= totalDays; day++) {
      habits.forEach((habit) => {
        if (!isHabitTrackedOnDate(habit, year, month, day)) return;
        possible += 1;
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        ) {
          done += 1;
        }
      });
    }

    return { done, possible, totalDays, monthData, habits };
  }

  function buildWeeklyAnalytics(year, month) {
    const totals = buildMonthTotals(year, month);
    const maxWeek = Math.max(1, Math.min(5, Math.ceil(totals.totalDays / 7)));

    const weekBuckets = Array.from({ length: maxWeek }, (_, index) => ({
      label: `Week ${index + 1}`,
      done: 0,
      possible: 0,
      weekdays: Array.from({ length: 7 }, () => ({ done: 0, possible: 0 })),
    }));

    const categoryWeek = {};
    state.categories.forEach((category) => {
      categoryWeek[category.id] = Array.from({ length: maxWeek }, () => ({
        done: 0,
        possible: 0,
      }));
    });

    for (let day = 1; day <= totals.totalDays; day++) {
      const weekIndex = Math.min(maxWeek - 1, Math.floor((day - 1) / 7));
      const weekday = new Date(year, month, day).getDay();

      totals.habits.forEach((habit) => {
        if (!isHabitTrackedOnDate(habit, year, month, day)) return;

        weekBuckets[weekIndex].possible += 1;
        weekBuckets[weekIndex].weekdays[weekday].possible += 1;

        if (!categoryWeek[habit.categoryId]) {
          categoryWeek[habit.categoryId] = Array.from(
            { length: maxWeek },
            () => ({
              done: 0,
              possible: 0,
            }),
          );
        }
        categoryWeek[habit.categoryId][weekIndex].possible += 1;

        const done = !!(
          totals.monthData.dailyCompletions[habit.id] &&
          totals.monthData.dailyCompletions[habit.id][day]
        );

        if (done) {
          weekBuckets[weekIndex].done += 1;
          weekBuckets[weekIndex].weekdays[weekday].done += 1;
          categoryWeek[habit.categoryId][weekIndex].done += 1;
        }
      });
    }

    return { weekBuckets, categoryWeek };
  }

  function buildMonthlyTimeline(monthCount = 12) {
    const timeline = [];
    for (let offset = monthCount - 1; offset >= 0; offset--) {
      const dt = new Date(state.currentYear, state.currentMonth - offset, 1);
      const year = dt.getFullYear();
      const month = dt.getMonth();
      const totals = buildMonthTotals(year, month);

      const byCategory = {};
      state.categories.forEach((category) => {
        byCategory[category.id] = { done: 0, possible: 0 };
      });

      for (let day = 1; day <= totals.totalDays; day++) {
        totals.habits.forEach((habit) => {
          if (!isHabitTrackedOnDate(habit, year, month, day)) return;
          if (!byCategory[habit.categoryId]) {
            byCategory[habit.categoryId] = { done: 0, possible: 0 };
          }
          byCategory[habit.categoryId].possible += 1;
          if (
            totals.monthData.dailyCompletions[habit.id] &&
            totals.monthData.dailyCompletions[habit.id][day]
          ) {
            byCategory[habit.categoryId].done += 1;
          }
        });
      }

      timeline.push({
        label: `${MONTH_NAMES[month].slice(0, 3)} ${String(year).slice(-2)}`,
        done: totals.done,
        possible: totals.possible,
        byCategory,
      });
    }
    return timeline;
  }

  function getMonthStreakLeaderboard(limit = 10) {
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const monthData = getCurrentMonthData();
    const now = new Date();
    const isCurrentMonth =
      now.getFullYear() === state.currentYear &&
      now.getMonth() === state.currentMonth;
    const endDay = isCurrentMonth ? now.getDate() : totalDays;

    const rows = getSortedDailyHabits().map((habit) => {
      let streak = 0;
      let trackedDays = 0;
      for (let day = 1; day <= endDay; day++) {
        if (
          isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          trackedDays += 1;
        }
      }

      for (let day = endDay; day >= 1; day--) {
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          continue;
        }
        const done = !!(
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        );
        if (!done) break;
        streak += 1;
      }

      const cat = getCategoryById(habit.categoryId);
      return {
        label: `${getHabitEmoji(habit)} ${habit.name}`,
        done: streak,
        possible: Math.max(1, trackedDays),
        color: cat ? cat.color : "#58a5d1",
      };
    });

    return rows
      .sort((a, b) => b.done - a.done)
      .slice(0, limit)
      .filter((row) => row.possible > 0);
  }

  function destroyChart(chartKey) {
    if (!chartInstances[chartKey]) return;
    chartInstances[chartKey].destroy();
    delete chartInstances[chartKey];
  }

  function renderChart(chartKey, canvasId, config) {
    if (typeof Chart === "undefined") return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      destroyChart(chartKey);
      return;
    }
    destroyChart(chartKey);
    chartInstances[chartKey] = new Chart(canvas.getContext("2d"), config);
  }

  function renderWeeklyTrendChart(canvasId, chartKey, weeklyData) {
    const values = weeklyData.weekBuckets.map((bucket) =>
      getMetricValue(bucket.done, bucket.possible),
    );
    const maxScale =
      getAnalyticsDisplayMode() === "percent" ? 100 : Math.max(1, ...values);
    const avgValue = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;

    renderChart(chartKey, canvasId, {
      type: "line",
      data: {
        labels: weeklyData.weekBuckets.map((bucket) => bucket.label),
        datasets: [
          {
            label: getMetricAxisLabel(),
            data: values,
            borderColor: getValueColor(avgValue, maxScale, 0.95),
            backgroundColor: getValueColor(avgValue, maxScale, 0.2),
            borderWidth: 3,
            fill: true,
            tension: 0.34,
            pointRadius: 4,
            pointBackgroundColor: values.map((value) =>
              getValueColor(value, maxScale, 0.95),
            ),
            pointBorderColor: values.map((value) =>
              getValueColor(value, maxScale, 1),
            ),
            segment: {
              borderColor(context) {
                const midpoint =
                  ((context.p0?.parsed?.y || 0) +
                    (context.p1?.parsed?.y || 0)) /
                  2;
                return getValueColor(midpoint, maxScale, 0.95);
              },
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return `${getMetricAxisLabel()}: ${getMetricLabel(context.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function renderWeeklyCategoryStackedChart(canvasId, chartKey, weeklyData) {
    const labels = weeklyData.weekBuckets.map((bucket) => bucket.label);
    const datasets = state.categories
      .map((category) => {
        const points = labels.map((_, index) => {
          const slot = weeklyData.categoryWeek[category.id]
            ? weeklyData.categoryWeek[category.id][index]
            : { done: 0, possible: 0 };
          return getMetricValue(slot.done, slot.possible);
        });
        const visible = points.some((point) => point > 0);
        if (!visible) return null;
        return {
          label: `${category.emoji} ${category.name}`,
          data: points,
          backgroundColor(context) {
            const value =
              context.parsed && Number(context.parsed.y)
                ? Number(context.parsed.y)
                : 0;
            const scaleMax =
              getAnalyticsDisplayMode() === "percent"
                ? 100
                : Math.max(1, ...points);
            return getValueColor(value, scaleMax, 0.86);
          },
          borderRadius: 4,
          borderColor(context) {
            const value =
              context.parsed && Number(context.parsed.y)
                ? Number(context.parsed.y)
                : 0;
            const scaleMax =
              getAnalyticsDisplayMode() === "percent"
                ? 100
                : Math.max(1, ...points);
            return getValueColor(value, scaleMax, 1);
          },
          borderWidth: 1,
        };
      })
      .filter(Boolean);

    renderChart(chartKey, canvasId, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${getMetricLabel(context.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          x: { stacked: true },
          y: {
            stacked: true,
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function renderMonthlyTrendChart(canvasId, chartKey, timeline) {
    const values = timeline.map((item) =>
      getMetricValue(item.done, item.possible),
    );
    const maxScale =
      getAnalyticsDisplayMode() === "percent" ? 100 : Math.max(1, ...values);
    const avgValue = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    renderChart(chartKey, canvasId, {
      type: "line",
      data: {
        labels: timeline.map((item) => item.label),
        datasets: [
          {
            data: values,
            borderColor: getValueColor(avgValue, maxScale, 0.95),
            backgroundColor: getValueColor(avgValue, maxScale, 0.18),
            borderWidth: 3,
            fill: true,
            tension: 0.26,
            pointRadius: 3,
            pointBackgroundColor: values.map((value) =>
              getValueColor(value, maxScale, 0.95),
            ),
            pointBorderColor: values.map((value) =>
              getValueColor(value, maxScale, 1),
            ),
            segment: {
              borderColor(context) {
                const midpoint =
                  ((context.p0?.parsed?.y || 0) +
                    (context.p1?.parsed?.y || 0)) /
                  2;
                return getValueColor(midpoint, maxScale, 0.95);
              },
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return getMetricLabel(context.parsed.y);
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function renderMonthlyStreakChart(canvasId, chartKey, rows) {
    const values = rows.map((row) => getMetricValue(row.done, row.possible));
    const maxScale =
      getAnalyticsDisplayMode() === "percent" ? 100 : Math.max(1, ...values);

    renderChart(chartKey, canvasId, {
      type: "bar",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            data: values,
            backgroundColor: values.map((value) =>
              getValueColor(value, maxScale, 0.88),
            ),
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return getMetricLabel(context.parsed.x);
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function renderMonthlyCategoryTrendChart(canvasId, chartKey, timeline) {
    const topCategories = state.categories
      .map((category) => {
        const sum = timeline.reduce((acc, item) => {
          const slot = item.byCategory[category.id] || { done: 0 };
          return acc + slot.done;
        }, 0);
        return { category, sum };
      })
      .filter((item) => item.sum > 0)
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 6);

    const datasets = topCategories.map((item) => {
      const points = timeline.map((point) => {
        const slot = point.byCategory[item.category.id] || {
          done: 0,
          possible: 0,
        };
        return getMetricValue(slot.done, slot.possible);
      });
      const maxScale =
        getAnalyticsDisplayMode() === "percent" ? 100 : Math.max(1, ...points);
      const avgValue = points.length
        ? points.reduce((sum, value) => sum + value, 0) / points.length
        : 0;
      return {
        label: `${item.category.emoji} ${item.category.name}`,
        data: points,
        borderColor: getValueColor(avgValue, maxScale, 0.95),
        backgroundColor: getValueColor(avgValue, maxScale, 0.2),
        pointBackgroundColor: points.map((value) =>
          getValueColor(value, maxScale, 0.92),
        ),
        pointBorderColor: points.map((value) =>
          getValueColor(value, maxScale, 1),
        ),
        segment: {
          borderColor(context) {
            const midpoint =
              ((context.p0?.parsed?.y || 0) + (context.p1?.parsed?.y || 0)) / 2;
            return getValueColor(midpoint, maxScale, 0.95);
          },
        },
        fill: false,
        tension: 0.25,
      };
    });

    renderChart(chartKey, canvasId, {
      type: "line",
      data: {
        labels: timeline.map((item) => item.label),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.dataset.label}: ${getMetricLabel(context.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: getAnalyticsDisplayMode() === "percent" ? 100 : undefined,
            ticks: {
              callback(value) {
                return getAnalyticsDisplayMode() === "percent"
                  ? `${Math.round(value)}%`
                  : value;
              },
            },
          },
        },
      },
    });
  }

  function getHeatColor(strength) {
    return getValueColor((Number(strength) || 0) * 100, 100, 0.82);
  }

  function renderWeeklyHeatmap(containerId, weeklyData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const cells = [];
    weeklyData.weekBuckets.forEach((week) => {
      week.weekdays.forEach((entry) => {
        cells.push(getMetricValue(entry.done, entry.possible));
      });
    });
    const maxValue = Math.max(1, ...cells);

    let html = "<div></div>";
    dayLabels.forEach((label) => {
      html += `<div class='heatmap-head'>${label}</div>`;
    });

    weeklyData.weekBuckets.forEach((week, weekIndex) => {
      html += `<div class='heatmap-week-label'>W${weekIndex + 1}</div>`;
      week.weekdays.forEach((entry) => {
        const value = getMetricValue(entry.done, entry.possible);
        const scaleMax =
          getAnalyticsDisplayMode() === "percent" ? 100 : maxValue;
        const ratio = scaleMax > 0 ? value / scaleMax : 0;
        html += `<div class='heatmap-cell' style='background:${getHeatColor(ratio)}' title='Done ${entry.done} / ${entry.possible}'>${getMetricLabel(value)}</div>`;
      });
    });

    container.innerHTML = html;
  }

  function formatShortDateLabel(dateValue) {
    const dt = new Date(dateValue);
    return `${MONTH_NAMES[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
  }

  function floorToDayTime(ms) {
    const dt = new Date(ms);
    dt.setHours(0, 0, 0, 0);
    return dt.getTime();
  }

  function toLocalDayKey(ms) {
    const dt = new Date(ms);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseIsoMs(value) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parsePageFromHistoryNote(note) {
    const match = String(note || "").match(/page\s+(\d+)/i);
    const parsed = match ? parseInt(match[1], 10) : NaN;
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return parsed;
  }

  function daysInclusiveFromTimes(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
    const diff = floorToDayTime(endMs) - floorToDayTime(startMs);
    return Math.max(1, Math.round(diff / 86400000) + 1);
  }

  function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  function formatDateInputValue(dateLike) {
    const dt = new Date(dateLike);
    if (Number.isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getBookMaxBookmarkPage(book) {
    const bookmarks = Array.isArray(book && book.bookmarks)
      ? book.bookmarks
      : [];
    if (!bookmarks.length) return 1;
    return Math.max(
      1,
      ...bookmarks.map((bm) => Math.max(1, parseInt(bm.pdfPage, 10) || 1)),
    );
  }

  function getEffectiveBookTotalPages(book) {
    if (!book) return null;
    const override = parseInt(book.totalPagesOverride, 10);
    if (Number.isFinite(override) && override >= 1) return override;
    const detected = parseInt(book.totalPagesDetected, 10);
    if (Number.isFinite(detected) && detected >= 1) return detected;
    return null;
  }

  function getOrInitBooksHelperState() {
    if (!isPlainObject(state.books)) {
      state.books = { items: [], activeBookId: null, helper: {} };
    }
    if (!isPlainObject(state.books.helper)) {
      state.books.helper = {};
    }
    if (typeof state.books.helper.selectedBookId !== "string") {
      state.books.helper.selectedBookId = "";
    }
    if (typeof state.books.helper.targetDate !== "string") {
      state.books.helper.targetDate = "";
    }
    if (!Number.isFinite(parseInt(state.books.helper.startPage, 10))) {
      state.books.helper.startPage = null;
    } else {
      state.books.helper.startPage = Math.max(
        1,
        parseInt(state.books.helper.startPage, 10),
      );
    }
    if (!Array.isArray(state.books.helper.weekdays)) {
      state.books.helper.weekdays = [...ALL_WEEKDAYS];
    }
    state.books.helper.weekdays = [...new Set(state.books.helper.weekdays)]
      .map((value) => parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
      .sort((a, b) => a - b);
    return state.books.helper;
  }

  function getSelectedFinisherBook() {
    const helper = getOrInitBooksHelperState();
    const books = Array.isArray(state.books && state.books.items)
      ? state.books.items
      : [];
    if (!books.length) return null;
    if (helper.selectedBookId) {
      const matched = books.find(
        (book) => book.bookId === helper.selectedBookId,
      );
      if (matched) return matched;
    }
    if (state.books.activeBookId) {
      const active = books.find(
        (book) => book.bookId === state.books.activeBookId,
      );
      if (active) return active;
    }
    return books[0] || null;
  }

  async function detectBookTotalPages(book) {
    if (!book || !book.fileId) return null;
    if (
      Number.isFinite(parseInt(book.totalPagesDetected, 10)) &&
      parseInt(book.totalPagesDetected, 10) > 0
    ) {
      return Math.max(1, parseInt(book.totalPagesDetected, 10));
    }

    if (finisherState.loadingBookId === book.bookId) {
      return null;
    }

    finisherState.loadingBookId = book.bookId;
    finisherState.lastError = "";
    try {
      const blob = await idbGetPdfBlob(book.fileId);
      if (!blob) {
        finisherState.lastError = "PDF blob missing in local storage.";
        return null;
      }
      const pdfjsLib = await ensurePdfJsLibLoaded();
      if (!pdfjsLib) {
        finisherState.lastError = "PDF.js failed to load.";
        return null;
      }
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      const pdfData = await blob.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      const pdfDoc = await loadingTask.promise;
      const pages = Math.max(1, parseInt(pdfDoc.numPages, 10) || 1);
      book.totalPagesDetected = pages;
      book.totalPagesDetectedAt = nowIso();
      saveState();
      return pages;
    } catch (error) {
      finisherState.lastError = "Could not detect total pages from PDF.";
      appendLogEntry({
        level: "warn",
        component: "books-finisher",
        operation: "detectBookTotalPages",
        message: "Failed to detect total pages.",
        error,
        context: { bookId: book.bookId, fileId: book.fileId },
      });
      return null;
    } finally {
      finisherState.loadingBookId = null;
    }
  }

  function computeBookFinisherPlan(book) {
    const helper = getOrInitBooksHelperState();
    if (!book) {
      return {
        ok: false,
        message: "Add a book first to use Book Finisher Helper.",
      };
    }

    const totalPages = getEffectiveBookTotalPages(book);
    const startPage = Math.max(
      1,
      parseInt(helper.startPage, 10) || getBookMaxBookmarkPage(book),
    );
    if (!totalPages) {
      return {
        ok: false,
        message: "Total pages unknown. Detect pages or enter an override.",
        startPage,
      };
    }

    if (startPage >= totalPages) {
      return {
        ok: true,
        totalPages,
        startPage,
        remainingPages: 0,
        readingDays: [],
        pagesPerDay: 0,
        pagesPerDayExact: 0,
        projectedDate: "Done",
        message: "This book is already at or beyond the final page.",
      };
    }

    const targetMs = parseIsoMs(`${String(helper.targetDate || "")}T00:00:00`);
    if (!Number.isFinite(targetMs)) {
      return {
        ok: false,
        totalPages,
        startPage,
        message: "Choose a finish date.",
      };
    }

    const todayMs = floorToDayTime(Date.now());
    if (targetMs < todayMs) {
      return {
        ok: false,
        totalPages,
        startPage,
        message: "Finish date is in the past.",
      };
    }

    const weekdaySet = new Set(helper.weekdays || []);
    if (!weekdaySet.size) {
      return {
        ok: false,
        totalPages,
        startPage,
        message: "Select at least one reading weekday.",
      };
    }

    const readingDays = [];
    for (let at = todayMs; at <= targetMs; at += 86400000) {
      const weekday = new Date(at).getDay();
      if (!weekdaySet.has(weekday)) continue;
      readingDays.push(at);
    }

    if (!readingDays.length) {
      return {
        ok: false,
        totalPages,
        startPage,
        message: "No reading days found before the finish date.",
      };
    }

    const remainingPages = Math.max(0, totalPages - startPage);
    const pagesPerDayExact = remainingPages / readingDays.length;
    const pagesPerDay = Math.max(1, Math.ceil(pagesPerDayExact));

    let remaining = remainingPages;
    let projectedAt = readingDays[readingDays.length - 1];
    const weeklyLoads = {};
    readingDays.forEach((dayMs) => {
      const weekStart = new Date(dayMs);
      const weekday = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - weekday);
      weekStart.setHours(0, 0, 0, 0);
      const weekKey = toLocalDayKey(weekStart.getTime());

      const amount = Math.min(remaining, pagesPerDay);
      weeklyLoads[weekKey] = (weeklyLoads[weekKey] || 0) + amount;
      remaining -= amount;
      if (remaining <= 0) {
        projectedAt = dayMs;
      }
    });

    const weekEntries = Object.keys(weeklyLoads)
      .sort((a, b) => (a < b ? -1 : 1))
      .map((weekKey, index) => ({
        label: `W${index + 1}`,
        pages: Math.round(weeklyLoads[weekKey]),
      }));

    return {
      ok: true,
      totalPages,
      startPage,
      targetMs,
      remainingPages,
      readingDays,
      pagesPerDay,
      pagesPerDayExact,
      projectedDate: formatDateInputValue(projectedAt),
      canFinishByTarget: remaining <= 0 && projectedAt <= targetMs,
      weekEntries,
      message: "",
    };
  }

  function buildBookReadingEvents(book) {
    const events = [];
    const bookmarks = Array.isArray(book.bookmarks) ? book.bookmarks : [];

    bookmarks.forEach((bookmark) => {
      const page = Math.max(1, parseInt(bookmark.pdfPage, 10) || 1);
      const createdAt = parseIsoMs(bookmark.createdAt);
      const updatedAt = parseIsoMs(bookmark.updatedAt);

      if (Number.isFinite(createdAt)) {
        events.push({
          at: createdAt,
          page,
          type: "bookmark-created",
        });
      }

      if (Number.isFinite(updatedAt) && updatedAt !== createdAt) {
        events.push({
          at: updatedAt,
          page,
          type: "bookmark-updated",
        });
      }

      (Array.isArray(bookmark.history) ? bookmark.history : []).forEach((h) => {
        const at = parseIsoMs(h && h.at);
        if (!Number.isFinite(at)) return;
        const historyPage =
          (h && h.type === "reader-note"
            ? parsePageFromHistoryNote(h.note)
            : null) || null;
        if (!historyPage) return;
        events.push({
          at,
          page: historyPage,
          type: "reader-note",
        });
      });
    });

    const seen = new Set();
    return events
      .sort((a, b) => a.at - b.at)
      .filter((event) => {
        const key = `${event.at}:${event.page}:${event.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function computePerBookStats(book, events) {
    if (!events.length) {
      return {
        bookId: book.bookId,
        title: book.title,
        author: book.author || "Unknown author",
        totalBookmarks: Array.isArray(book.bookmarks)
          ? book.bookmarks.length
          : 0,
        eventCount: 0,
        firstAt: null,
        lastAt: null,
        calendarDays: 0,
        activeDays: 0,
        pagesNet: 0,
        avgPerDay: 0,
        avgPerWeek: 0,
        current7dPages: 0,
        bestWeekPages: 0,
        consistencyPct: 0,
        insufficientData: true,
        dayPages: {},
      };
    }

    const dayPages = {};
    let pagesNet = 0;
    for (let i = 1; i < events.length; i += 1) {
      const delta = events[i].page - events[i - 1].page;
      if (delta <= 0) continue;
      pagesNet += delta;
      const key = toLocalDayKey(events[i].at);
      dayPages[key] = (dayPages[key] || 0) + delta;
    }

    const firstAt = events[0].at;
    const lastAt = events[events.length - 1].at;
    const calendarDays = daysInclusiveFromTimes(firstAt, lastAt);
    const activeDays = Object.keys(dayPages).filter(
      (key) => dayPages[key] > 0,
    ).length;
    const avgPerDay = calendarDays > 0 ? pagesNet / calendarDays : 0;
    const avgPerWeek = avgPerDay * 7;

    const nowDay = floorToDayTime(Date.now());
    let current7dPages = 0;
    Object.keys(dayPages).forEach((key) => {
      const at = parseIsoMs(`${key}T00:00:00`);
      if (!Number.isFinite(at)) return;
      if (nowDay - at <= 6 * 86400000) {
        current7dPages += dayPages[key];
      }
    });

    const weekPages = {};
    Object.keys(dayPages).forEach((key) => {
      const dt = new Date(`${key}T00:00:00`);
      const weekAnchor = new Date(dt);
      const day = weekAnchor.getDay();
      const shift = day === 0 ? -6 : 1 - day;
      weekAnchor.setDate(weekAnchor.getDate() + shift);
      const weekKey = toLocalDayKey(weekAnchor.getTime());
      weekPages[weekKey] = (weekPages[weekKey] || 0) + dayPages[key];
    });
    const bestWeekPages = Object.keys(weekPages).length
      ? Math.max(...Object.values(weekPages))
      : 0;

    const consistencyPct =
      calendarDays > 0 ? Math.round((activeDays / calendarDays) * 100) : 0;

    return {
      bookId: book.bookId,
      title: book.title,
      author: book.author || "Unknown author",
      totalBookmarks: Array.isArray(book.bookmarks) ? book.bookmarks.length : 0,
      eventCount: events.length,
      firstAt,
      lastAt,
      calendarDays,
      activeDays,
      pagesNet,
      avgPerDay,
      avgPerWeek,
      current7dPages,
      bestWeekPages,
      consistencyPct,
      insufficientData: events.length < 2 || pagesNet <= 0,
      dayPages,
    };
  }

  function buildBooksAnalytics() {
    const rangeDays = getBooksAnalyticsRangeDays();
    const allBooks =
      isPlainObject(state.books) && Array.isArray(state.books.items)
        ? state.books.items
        : [];

    const now = Date.now();
    const rangeStart =
      rangeDays > 0 ? floorToDayTime(now) - (rangeDays - 1) * 86400000 : null;

    const perBook = allBooks.map((book) => {
      const allEvents = buildBookReadingEvents(book);
      const events = rangeStart
        ? allEvents.filter((event) => event.at >= rangeStart)
        : allEvents;
      return computePerBookStats(book, events);
    });

    const withProgress = perBook.filter((book) => book.pagesNet > 0);
    const allDayPages = {};
    const activityCounts = {};
    let totalBookmarks = 0;
    let totalEvents = 0;

    perBook.forEach((book) => {
      totalBookmarks += book.totalBookmarks;
      totalEvents += book.eventCount;
      Object.keys(book.dayPages).forEach((dayKey) => {
        allDayPages[dayKey] =
          (allDayPages[dayKey] || 0) + book.dayPages[dayKey];
      });
    });

    const allBooksRaw =
      isPlainObject(state.books) && Array.isArray(state.books.items)
        ? state.books.items
        : [];
    allBooksRaw.forEach((book) => {
      const events = buildBookReadingEvents(book);
      events
        .filter((event) => (rangeStart ? event.at >= rangeStart : true))
        .forEach((event) => {
          const key = toLocalDayKey(event.at);
          activityCounts[key] = (activityCounts[key] || 0) + 1;
        });
    });

    const totalPages = withProgress.reduce(
      (sum, book) => sum + book.pagesNet,
      0,
    );
    const firstAt = withProgress.length
      ? Math.min(...withProgress.map((book) => book.firstAt))
      : null;
    const lastAt = withProgress.length
      ? Math.max(...withProgress.map((book) => book.lastAt))
      : null;
    const overallDays =
      Number.isFinite(firstAt) && Number.isFinite(lastAt)
        ? daysInclusiveFromTimes(firstAt, lastAt)
        : 0;

    const overall = {
      booksTracked: allBooks.length,
      booksWithProgress: withProgress.length,
      totalBookmarks,
      totalEvents,
      totalPages,
      avgPerDay: overallDays > 0 ? totalPages / overallDays : 0,
      avgPerWeek: overallDays > 0 ? (totalPages / overallDays) * 7 : 0,
      activeDays: Object.keys(allDayPages).length,
      calendarDays: overallDays,
      topBook:
        withProgress.length > 0
          ? [...withProgress].sort((a, b) => b.avgPerDay - a.avgPerDay)[0]
          : null,
      mostConsistent:
        withProgress.length > 0
          ? [...withProgress].sort(
              (a, b) => b.consistencyPct - a.consistencyPct,
            )[0]
          : null,
    };

    const trendWindowDays = rangeDays > 0 ? rangeDays : 90;
    const trendStart = floorToDayTime(now) - (trendWindowDays - 1) * 86400000;
    const trendLabels = [];
    const trendValues = [];
    const trendActivity = [];

    for (let i = 0; i < trendWindowDays; i += 1) {
      const at = trendStart + i * 86400000;
      const key = toLocalDayKey(at);
      trendLabels.push(formatShortDateLabel(at));
      trendValues.push(round1(allDayPages[key] || 0));
      trendActivity.push(activityCounts[key] || 0);
    }

    const heatWindowDays = Math.min(84, trendWindowDays);
    const heatStart = floorToDayTime(now) - (heatWindowDays - 1) * 86400000;
    const weekCount = Math.max(1, Math.ceil(heatWindowDays / 7));
    const heatWeeks = Array.from({ length: weekCount }, (_, idx) => ({
      label: `W${idx + 1}`,
      weekdays: Array.from({ length: 7 }, () => 0),
    }));
    for (let i = 0; i < heatWindowDays; i += 1) {
      const at = heatStart + i * 86400000;
      const dt = new Date(at);
      const weekday = dt.getDay();
      const weekIndex = Math.floor(i / 7);
      const key = toLocalDayKey(at);
      heatWeeks[weekIndex].weekdays[weekday] += allDayPages[key] || 0;
    }

    const comparisonRows = [...withProgress]
      .sort((a, b) => b.avgPerWeek - a.avgPerWeek)
      .slice(0, 12);

    return {
      rangeDays,
      rangeLabel: rangeDays === 0 ? "All time" : `Last ${rangeDays} days`,
      perBook: [...perBook].sort((a, b) => b.avgPerDay - a.avgPerDay),
      overall,
      trendLabels,
      trendValues,
      trendActivity,
      heatWeeks,
      comparisonRows,
    };
  }

  function renderBooksStatsOverview(analytics) {
    const kpisEl = document.getElementById("booksStatsOverview");
    const topEl = document.getElementById("booksStatsTopBook");
    const byBookEl = document.getElementById("booksStatsByBook");
    if (!kpisEl || !topEl || !byBookEl) return;

    if (!analytics.perBook.length) {
      kpisEl.innerHTML =
        "<p class='books-stats-empty'>No books yet. Add a book and bookmark reading pages to unlock statistics.</p>";
      topEl.innerHTML = "";
      byBookEl.innerHTML = "";
      return;
    }

    const overall = analytics.overall;
    kpisEl.innerHTML = [
      { label: "Range", value: analytics.rangeLabel },
      {
        label: "Books with progress",
        value: `${overall.booksWithProgress}/${overall.booksTracked}`,
      },
      { label: "Avg pages/day", value: round1(overall.avgPerDay).toFixed(1) },
      { label: "Avg pages/week", value: round1(overall.avgPerWeek).toFixed(1) },
      {
        label: "Total pages advanced",
        value: String(Math.round(overall.totalPages)),
      },
      { label: "Bookmark events", value: String(overall.totalEvents) },
    ]
      .map(
        (item) =>
          `<article class='books-kpi-card'><p>${sanitize(item.label)}</p><h4>${sanitize(item.value)}</h4></article>`,
      )
      .join("");

    if (overall.topBook) {
      topEl.innerHTML = `<article class='books-top-book-card'><h4>Top Performing Book</h4><p class='books-top-book-title'>${sanitize(overall.topBook.title)}</p><p>${sanitize(overall.topBook.author)}</p><div class='books-top-book-meta'><span>${round1(overall.topBook.avgPerDay).toFixed(1)} pages/day</span><span>${round1(overall.topBook.avgPerWeek).toFixed(1)} pages/week</span><span>${Math.round(overall.topBook.pagesNet)} pages advanced</span></div></article>`;
    } else {
      topEl.innerHTML =
        "<p class='books-stats-empty'>Need at least two bookmark events to estimate reading pace.</p>";
    }

    byBookEl.innerHTML = analytics.perBook
      .map((book) => {
        const confidence =
          book.insufficientData || book.eventCount < 3 || book.calendarDays < 7
            ? "<span class='books-low-confidence'>Low confidence</span>"
            : "";
        return `<article class='books-book-stat-card'><div class='books-book-stat-head'><h4>${sanitize(book.title)}</h4>${confidence}</div><p>${sanitize(book.author)}</p><div class='books-book-stat-grid'><span>Pages advanced: <strong>${Math.round(book.pagesNet)}</strong></span><span>Avg/day: <strong>${round1(book.avgPerDay).toFixed(1)}</strong></span><span>Avg/week: <strong>${round1(book.avgPerWeek).toFixed(1)}</strong></span><span>7d pages: <strong>${Math.round(book.current7dPages)}</strong></span><span>Best week: <strong>${Math.round(book.bestWeekPages)}</strong></span><span>Consistency: <strong>${book.consistencyPct}%</strong></span></div></article>`;
      })
      .join("");
  }

  function renderBooksAnalyticsKpis(analytics) {
    const el = document.getElementById("booksAnalyticsKpis");
    if (!el) return;
    const overall = analytics.overall;
    if (!analytics.perBook.length) {
      el.innerHTML =
        "<p class='books-stats-empty'>No book data available yet.</p>";
      return;
    }
    el.innerHTML = [
      { label: "Range", value: analytics.rangeLabel },
      { label: "Pages/day", value: round1(overall.avgPerDay).toFixed(1) },
      { label: "Pages/week", value: round1(overall.avgPerWeek).toFixed(1) },
      {
        label: "Most consistent",
        value: overall.mostConsistent ? overall.mostConsistent.title : "-",
      },
    ]
      .map(
        (item) =>
          `<article class='books-kpi-card'><p>${sanitize(item.label)}</p><h4>${sanitize(item.value)}</h4></article>`,
      )
      .join("");
  }

  function renderBooksMiniTrendChart(analytics) {
    renderChart("booksMiniTrendChart", "booksMiniTrendChart", {
      type: "line",
      data: {
        labels: analytics.trendLabels,
        datasets: [
          {
            label: "Pages/day",
            data: analytics.trendValues,
            borderColor: "rgba(56, 189, 248, 0.92)",
            backgroundColor: "rgba(56, 189, 248, 0.16)",
            borderWidth: 2,
            tension: 0.34,
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } },
          x: { ticks: { maxTicksLimit: 7 } },
        },
      },
    });
  }

  function renderBooksMiniShareChart(analytics) {
    const rows = [...analytics.perBook]
      .filter((book) => book.pagesNet > 0)
      .sort((a, b) => b.pagesNet - a.pagesNet)
      .slice(0, 6);
    const labels = rows.map((row) => row.title);
    const values = rows.map((row) => Math.round(row.pagesNet));

    renderChart("booksMiniBookShareChart", "booksMiniBookShareChart", {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["No data"],
        datasets: [
          {
            data: labels.length ? values : [0],
            backgroundColor: labels.length
              ? values.map((value) =>
                  getValueColor(value, Math.max(1, ...values), 0.86),
                )
              : ["rgba(148, 163, 184, 0.5)"],
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { maxTicksLimit: 5 } },
        },
      },
    });
  }

  function renderBooksVelocityTrendChart(analytics) {
    renderChart("booksVelocityTrendChart", "booksVelocityTrendChart", {
      type: "line",
      data: {
        labels: analytics.trendLabels,
        datasets: [
          {
            label: "Pages advanced",
            data: analytics.trendValues,
            borderColor: "rgba(56, 189, 248, 0.95)",
            backgroundColor: "rgba(56, 189, 248, 0.2)",
            borderWidth: 2,
            tension: 0.28,
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Pages/day" } },
          x: { ticks: { maxTicksLimit: 10 } },
        },
      },
    });
  }

  function renderBooksComparisonChart(analytics) {
    const labels = analytics.comparisonRows.map((row) => row.title);
    const avgDay = analytics.comparisonRows.map((row) => round1(row.avgPerDay));
    const avgWeek = analytics.comparisonRows.map((row) =>
      round1(row.avgPerWeek),
    );

    renderChart("booksPerBookComparisonChart", "booksPerBookComparisonChart", {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["No data"],
        datasets: [
          {
            label: "Avg pages/day",
            data: labels.length ? avgDay : [0],
            backgroundColor: "rgba(34, 197, 94, 0.82)",
            borderRadius: 6,
          },
          {
            label: "Avg pages/week",
            data: labels.length ? avgWeek : [0],
            backgroundColor: "rgba(249, 115, 22, 0.78)",
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: {
          y: { beginAtZero: true },
        },
      },
    });
  }

  function renderBooksBookmarkActivityChart(analytics) {
    renderChart("booksBookmarkActivityChart", "booksBookmarkActivityChart", {
      type: "bar",
      data: {
        labels: analytics.trendLabels,
        datasets: [
          {
            label: "Bookmark events",
            data: analytics.trendActivity,
            backgroundColor: "rgba(99, 102, 241, 0.78)",
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Events/day" },
          },
          x: { ticks: { maxTicksLimit: 10 } },
        },
      },
    });
  }

  function renderBooksWeeklyHeatmap(analytics) {
    const container = document.getElementById("booksWeeklyHeatmap");
    if (!container) return;
    if (!analytics.heatWeeks.length) {
      container.innerHTML =
        "<div class='heatmap-empty'>No reading data yet.</div>";
      return;
    }

    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const allCells = analytics.heatWeeks.flatMap((week) => week.weekdays);
    const maxValue = Math.max(1, ...allCells);

    let html = "<div></div>";
    labels.forEach((label) => {
      html += `<div class='heatmap-head'>${label}</div>`;
    });

    analytics.heatWeeks.forEach((week) => {
      html += `<div class='heatmap-week-label'>${week.label}</div>`;
      week.weekdays.forEach((value) => {
        const ratio = value / maxValue;
        html += `<div class='heatmap-cell' style='background:${getHeatColor(ratio)}' title='${Math.round(value)} pages'>${Math.round(value)}</div>`;
      });
    });

    container.innerHTML = html;
  }

  function renderBooksAnalyticsDashboard(options = {}) {
    const includeCharts = options.includeCharts !== false;
    syncBooksRangeControls();
    const analytics = buildBooksAnalytics();
    renderBooksStatsOverview(analytics);
    renderBooksAnalyticsKpis(analytics);
    renderBooksMiniTrendChart(analytics);
    renderBooksMiniShareChart(analytics);
    if (!includeCharts) {
      return;
    }
    renderBooksVelocityTrendChart(analytics);
    renderBooksComparisonChart(analytics);
    renderBooksBookmarkActivityChart(analytics);
    renderBooksWeeklyHeatmap(analytics);
  }

  function renderBookFinisherPlanChart(plan) {
    const labels =
      plan && plan.ok ? plan.weekEntries.map((entry) => entry.label) : [];
    const values =
      plan && plan.ok ? plan.weekEntries.map((entry) => entry.pages) : [];
    renderChart("booksFinisherPlanChart", "booksFinisherPlanChart", {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["No plan"],
        datasets: [
          {
            label: "Pages",
            data: values.length ? values : [0],
            backgroundColor: values.length
              ? values.map((value) =>
                  getValueColor(value, Math.max(1, ...values), 0.84),
                )
              : ["rgba(148, 163, 184, 0.5)"],
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return `${Math.round(context.parsed.y || 0)} pages`;
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } },
        },
      },
    });
  }

  async function renderBookFinisherHelper() {
    const panel = document.getElementById("booksFinisherCard");
    const bookSelect = document.getElementById("finisherBookSelect");
    const targetInput = document.getElementById("finisherTargetDate");
    const startInput = document.getElementById("finisherStartPage");
    const totalInput = document.getElementById("finisherTotalPages");
    const statusEl = document.getElementById("finisherStatusText");
    const resultsEl = document.getElementById("finisherResultsPanel");
    const autoBtn = document.getElementById("finisherUseAutoPagesBtn");
    if (
      !panel ||
      !bookSelect ||
      !targetInput ||
      !startInput ||
      !totalInput ||
      !statusEl ||
      !resultsEl ||
      !autoBtn
    ) {
      return;
    }

    const helper = getOrInitBooksHelperState();
    const books = Array.isArray(state.books && state.books.items)
      ? state.books.items
      : [];

    if (!books.length) {
      bookSelect.innerHTML = "<option value=''>No books yet</option>";
      targetInput.value = "";
      startInput.value = "";
      totalInput.value = "";
      statusEl.textContent = "Add at least one book to build a finish plan.";
      resultsEl.innerHTML = "";
      renderBookFinisherPlanChart(null);
      return;
    }

    if (
      !helper.selectedBookId ||
      !books.some((book) => book.bookId === helper.selectedBookId)
    ) {
      const fallback = getSelectedFinisherBook();
      helper.selectedBookId = fallback ? fallback.bookId : "";
    }
    const selectedBook = getSelectedFinisherBook();
    if (!selectedBook) return;

    if (!helper.targetDate) {
      helper.targetDate = formatDateInputValue(
        floorToDayTime(Date.now()) + 20 * 86400000,
      );
    }

    if (!Number.isFinite(parseInt(helper.startPage, 10))) {
      helper.startPage = getBookMaxBookmarkPage(selectedBook);
    }

    if (finisherState.loadingBookId === selectedBook.bookId) {
      statusEl.textContent = "Detecting total pages from PDF...";
    }

    await detectBookTotalPages(selectedBook);

    bookSelect.innerHTML = books
      .map(
        (book) =>
          `<option value="${book.bookId}">${sanitize(book.title)}</option>`,
      )
      .join("");
    bookSelect.value = selectedBook.bookId;

    targetInput.value = helper.targetDate;
    startInput.value = String(Math.max(1, parseInt(helper.startPage, 10) || 1));

    const effectiveTotal = getEffectiveBookTotalPages(selectedBook);
    totalInput.placeholder = effectiveTotal
      ? `Auto: ${effectiveTotal}`
      : "Auto not detected";
    totalInput.value = Number.isFinite(
      parseInt(selectedBook.totalPagesOverride, 10),
    )
      ? String(Math.max(1, parseInt(selectedBook.totalPagesOverride, 10)))
      : "";
    autoBtn.disabled = !Number.isFinite(
      parseInt(selectedBook.totalPagesOverride, 10),
    );

    const weekdaySet = new Set(helper.weekdays || []);
    document.querySelectorAll("[data-finisher-weekday]").forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      const value = parseInt(input.dataset.finisherWeekday, 10);
      input.checked = weekdaySet.has(value);
    });

    const plan = computeBookFinisherPlan(selectedBook);
    if (!plan.ok) {
      statusEl.textContent =
        finisherState.lastError || plan.message || "No plan available yet.";
      resultsEl.innerHTML = "";
      renderBookFinisherPlanChart(null);
      return;
    }

    statusEl.textContent = plan.canFinishByTarget
      ? "Plan ready. Stay on this pace to finish on time."
      : "Plan is tight. Increase reading days or move the finish date.";

    resultsEl.innerHTML = [
      { label: "Start page", value: String(plan.startPage) },
      { label: "Total pages", value: String(plan.totalPages) },
      { label: "Remaining pages", value: String(plan.remainingPages) },
      { label: "Reading days", value: String(plan.readingDays.length) },
      {
        label: "Needed per reading day",
        value: `${Math.ceil(plan.pagesPerDay)} pages`,
      },
      {
        label: "Average exact",
        value: `${round1(plan.pagesPerDayExact).toFixed(1)} pages`,
      },
      {
        label: "Projected finish",
        value:
          plan.projectedDate === "Done"
            ? "Already done"
            : String(plan.projectedDate),
      },
      {
        label: "Target",
        value: String(helper.targetDate),
      },
    ]
      .map(
        (item) =>
          `<article class='books-finisher-result-card${plan.canFinishByTarget ? "" : " warning"}'><p>${sanitize(item.label)}</p><h4>${sanitize(item.value)}</h4></article>`,
      )
      .join("");

    renderBookFinisherPlanChart(plan);
  }

  function renderAnalyticsView() {
    syncAnalyticsModeControls();
    const weeklyData = buildWeeklyAnalytics(
      state.currentYear,
      state.currentMonth,
    );
    const timeline = buildMonthlyTimeline(12);
    const streakRows = getMonthStreakLeaderboard(14);

    renderDailyBarChart();
    renderCategoryBarChart();
    renderWeeklyTrendChart(
      "analyticsWeeklyTrendChart",
      "analyticsWeeklyTrendChart",
      weeklyData,
    );
    renderWeeklyCategoryStackedChart(
      "analyticsWeeklyCategoryStackedChart",
      "analyticsWeeklyCategoryStackedChart",
      weeklyData,
    );
    renderMonthlyTrendChart(
      "analyticsMonthlyTrendChart",
      "analyticsMonthlyTrendChart",
      timeline,
    );
    renderMonthlyStreakChart(
      "analyticsMonthlyStreakChart",
      "analyticsMonthlyStreakChart",
      streakRows,
    );
    renderMonthlyCategoryTrendChart(
      "analyticsMonthlyCategoryTrendChart",
      "analyticsMonthlyCategoryTrendChart",
      timeline,
    );
    renderWeeklyHeatmap("analyticsWeeklyHeatmap", weeklyData);
    renderBooksAnalyticsDashboard({ includeCharts: true });
    renderMonthlyReview();
  }

  function updateHabitStreak(habitId) {
    const badge = document.querySelector(
      `.streak-badge[data-streak-habit="${habitId}"]`,
    );
    if (!badge) return;

    const months = Object.keys(state.months).sort();
    let current = 0;
    let best = 0;
    let chain = 0;

    months.forEach((mKey) => {
      const parts = mKey.split("-");
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const totalDays = daysInMonth(year, month);
      const habit = state.habits.daily.find((h) => h.id === habitId);
      if (!habit) return;
      for (let day = 1; day <= totalDays; day++) {
        if (!isHabitTrackedOnDate(habit, year, month, day)) continue;
        const md = state.months[mKey];
        const done = !!(
          md.dailyCompletions[habitId] && md.dailyCompletions[habitId][day]
        );
        if (done) {
          chain += 1;
          best = Math.max(best, chain);
        } else {
          chain = 0;
        }
      }
    });

    const habit = state.habits.daily.find((h) => h.id === habitId);
    if (habit) {
      const totalDays = daysInMonth(state.currentYear, state.currentMonth);
      const md = getCurrentMonthData();
      for (let day = totalDays; day >= 1; day--) {
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          continue;
        }
        const done = !!(
          md.dailyCompletions[habitId] && md.dailyCompletions[habitId][day]
        );
        if (!done) break;
        current += 1;
      }
    }

    badge.textContent = `Current ${current}d | Best ${best}d`;
  }

  function renderDailyHabitsGrid() {
    const grid = document.getElementById("dailyHabitsGrid");
    if (!grid) return;

    const monthData = getCurrentMonthData();
    const habits = getSortedDailyHabits();
    const totalDays = daysInMonth(state.currentYear, state.currentMonth);
    const today = new Date();
    const isCurrentMonthView =
      today.getFullYear() === state.currentYear &&
      today.getMonth() === state.currentMonth;
    const todayDay = isCurrentMonthView ? today.getDate() : -1;
    const currentViewMonthKey = monthKey(state.currentYear, state.currentMonth);

    function isDayFullyCompleted(day) {
      let requiredCount = 0;
      let checkedCount = 0;

      habits.forEach((habit) => {
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          return;
        }

        requiredCount += 1;
        if (
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
        ) {
          checkedCount += 1;
        }
      });

      return requiredCount > 0 && checkedCount === requiredCount;
    }

    const completedDays = {};
    for (let day = 1; day <= totalDays; day++) {
      completedDays[day] = isDayFullyCompleted(day);
    }

    function syncDayCompletionClass(day, isComplete) {
      const dayHeader = grid.querySelector(`th.day-col[data-day='${day}']`);
      if (dayHeader) {
        dayHeader.classList.toggle("day-complete", !!isComplete);
      }

      grid
        .querySelectorAll(`td.day-cell[data-day='${day}']`)
        .forEach((cell) => cell.classList.toggle("day-complete", !!isComplete));
    }

    let html =
      "<thead><tr><th class='habit-name-col'>Habits</th><th class='category-col'>Category</th><th class='goal-col'>Goal</th>";
    for (let day = 1; day <= totalDays; day++) {
      const isToday = day === todayDay;
      const isComplete = completedDays[day];
      const isoWeek = getIsoWeekNumber(
        state.currentYear,
        state.currentMonth,
        day,
      );
      const weekShadeColor = getWeekShadeColor(isoWeek);
      html += `<th class='day-col ${isToday ? "today" : ""} ${isComplete ? "day-complete" : ""}' style='--week-accent:${weekShadeColor}' data-day='${day}' tabindex='0'><span class='day-col-week'>W${isoWeek}</span><span class='day-col-day'>${day}</span></th>`;
    }
    html += "</tr></thead><tbody>";

    habits.forEach((habit, idx) => {
      const cat = getCategoryById(habit.categoryId);
      const catName = cat ? `${cat.emoji} ${sanitize(cat.name)}` : "-";
      const emoji = sanitize(getHabitEmoji(habit));
      html += `<tr><td class='habit-name-cell'>${emoji} ${sanitize(habit.name)} <span class='streak-badge' data-streak-habit='${habit.id}'>Current 0d | Best 0d</span><span class='habit-actions'><button class='habit-action-btn' onclick="HabitApp.moveHabit('${habit.id}', 'up')" ${idx === 0 ? "disabled" : ""} title='Move up'>Up</button><button class='habit-action-btn' onclick="HabitApp.moveHabit('${habit.id}', 'down')" ${idx === habits.length - 1 ? "disabled" : ""} title='Move down'>Down</button><button class='habit-action-btn' onclick="HabitApp.editHabit('${habit.id}')">Edit</button><button class='habit-action-btn delete' onclick="HabitApp.deleteHabit('${habit.id}')">Delete</button></span></td><td class='category-cell'>${catName}</td><td class='goal-cell'>${habit.monthGoal}</td>`;
      for (let day = 1; day <= totalDays; day++) {
        const isToday = day === todayDay;
        const isComplete = completedDays[day];
        if (
          !isHabitTrackedOnDate(
            habit,
            state.currentYear,
            state.currentMonth,
            day,
          )
        ) {
          html += `<td class='day-cell day-cell-off ${isToday ? "today-col" : ""} ${isComplete ? "day-complete" : ""}' data-day='${day}'><span class='off-day-mark'>OFF</span></td>`;
          continue;
        }
        const checked =
          monthData.dailyCompletions[habit.id] &&
          monthData.dailyCompletions[habit.id][day]
            ? "checked"
            : "";
        const hasNote = !!(
          monthData.dailyNotes[habit.id] &&
          typeof monthData.dailyNotes[habit.id][day] === "string" &&
          monthData.dailyNotes[habit.id][day].trim().length
        );
        html += `<td class='day-cell ${isToday ? "today-col" : ""} ${isComplete ? "day-complete" : ""}' data-day='${day}'><div class='day-cell-content'><input type='checkbox' class='habit-check ${isToday ? "today-check" : ""}' data-habit='${habit.id}' data-day='${day}' ${checked}><button type='button' class='note-btn ${hasNote ? "has-note" : ""}' data-habit='${habit.id}' data-day='${day}'>📝</button></div></td>`;
      }
      html += "</tr>";
    });

    html += "</tbody>";
    grid.innerHTML = html;

    if (!isCurrentMonthView) {
      lastAutoScrolledMonthKey = null;
    } else if (lastAutoScrolledMonthKey !== currentViewMonthKey) {
      lastAutoScrolledMonthKey = currentViewMonthKey;
      requestAnimationFrame(() => {
        const todayHeader = grid.querySelector("th.day-col.today");
        const wrapper = grid.closest(".habits-grid-wrapper");
        if (!todayHeader || !wrapper) return;

        const maxScrollLeft = wrapper.scrollWidth - wrapper.clientWidth;
        if (maxScrollLeft <= 0) return;

        const targetLeft = Math.max(
          0,
          Math.min(
            maxScrollLeft,
            todayHeader.offsetLeft -
              wrapper.clientWidth / 2 +
              todayHeader.offsetWidth / 2,
          ),
        );

        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        wrapper.scrollTo({
          left: targetLeft,
          behavior: reduceMotion ? "auto" : "smooth",
        });
      });
    }

    grid.querySelectorAll(".habit-check").forEach((cb) => {
      cb.addEventListener("change", function () {
        const habitId = this.dataset.habit;
        const day = parseInt(this.dataset.day, 10);
        if (!monthData.dailyCompletions[habitId])
          monthData.dailyCompletions[habitId] = {};
        monthData.dailyCompletions[habitId][day] = this.checked;
        saveState();
        renderSummary();
        renderWeeklySummaryCards();
        renderAnalyticsView();
        updateHabitStreak(habitId);

        syncDayCompletionClass(day, isDayFullyCompleted(day));
      });
    });

    grid.querySelectorAll(".note-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        openNoteModal(this.dataset.habit, parseInt(this.dataset.day, 10));
      });
    });

    bindDailyGridHoverInteractions(grid);

    habits.forEach((h) => updateHabitStreak(h.id));
  }

  function renderMonthlyReview() {
    const review = getCurrentMonthData().monthlyReview;
    document.getElementById("monthlyWins").value = review.wins || "";
    document.getElementById("monthlyBlockers").value = review.blockers || "";
    document.getElementById("monthlyFocus").value = review.focus || "";
  }

  function saveMonthlyReview() {
    const monthData = getCurrentMonthData();
    monthData.monthlyReview = {
      wins: document.getElementById("monthlyWins").value.trim(),
      blockers: document.getElementById("monthlyBlockers").value.trim(),
      focus: document.getElementById("monthlyFocus").value.trim(),
    };
    saveState();
  }

  function renderCategoriesList() {
    const list = document.getElementById("categoriesList");
    if (!list) return;
    if (state.categories.length === 0) {
      list.innerHTML =
        "<div class='empty-state'><p>No categories yet.</p></div>";
      return;
    }

    list.innerHTML = state.categories
      .map(
        (c) =>
          `<div class='manage-item'><div class='manage-item-info'><span class='manage-item-emoji' style='background:${c.color}18'>${sanitize(c.emoji)}</span><div><div class='manage-item-name'>${sanitize(c.name)}</div><div class='manage-item-meta'>${sanitize(c.color)}</div></div></div><div class='manage-item-actions'><button class='manage-btn' onclick="HabitApp.editCategory('${c.id}')">Edit</button><button class='manage-btn delete' onclick="HabitApp.deleteCategory('${c.id}')">Delete</button></div></div>`,
      )
      .join("");
  }

  function renderDailyHabitsList() {
    const list = document.getElementById("dailyHabitsList");
    if (!list) return;

    const habits = getSortedDailyHabits();
    if (habits.length === 0) {
      list.innerHTML =
        "<div class='empty-state'><p>No daily habits yet.</p></div>";
      return;
    }

    list.innerHTML = habits
      .map((h, idx) => {
        const cat = getCategoryById(h.categoryId);
        const mode = getHabitScheduleMode(h)
          .replace("specific_weekdays", "specific weekdays")
          .replace("specific_month_days", "specific month days");
        return `<div class='manage-item'><div class='manage-item-info'><span class='manage-item-emoji'>${sanitize(getHabitEmoji(h))}</span><div><div class='manage-item-name'>${sanitize(h.name)}</div><div class='manage-item-meta'>${cat ? sanitize(cat.name) : "No category"} · ${sanitize(mode)}</div></div></div><div class='manage-item-actions'><button class='manage-btn' onclick="HabitApp.moveHabit('${h.id}', 'up')" ${idx === 0 ? "disabled" : ""} title='Move up'>↑</button><button class='manage-btn' onclick="HabitApp.moveHabit('${h.id}', 'down')" ${idx === habits.length - 1 ? "disabled" : ""} title='Move down'>↓</button><button class='manage-btn' onclick="HabitApp.editHabit('${h.id}')">Edit</button><button class='manage-btn delete' onclick="HabitApp.deleteHabit('${h.id}')">Delete</button></div></div>`;
      })
      .join("");
  }

  function renderManageView() {
    renderCategoriesList();
    renderDailyHabitsList();
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("open");
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
  }

  function openConfirm(title, message, callback) {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    confirmCallback = callback;
    openModal("confirmModal");
  }

  function openHabitModal(habitId) {
    editingHabitId = habitId || null;

    const title = document.getElementById("habitModalTitle");
    const name = document.getElementById("habitName");
    const category = document.getElementById("habitCategory");
    const type = document.getElementById("habitScheduleType");
    const goal = document.getElementById("habitGoal");
    const emoji = document.getElementById("habitEmoji");

    category.innerHTML = state.categories
      .map(
        (c) =>
          `<option value='${c.id}'>${sanitize(c.emoji)} ${sanitize(c.name)}</option>`,
      )
      .join("");

    if (editingHabitId) {
      const habit = state.habits.daily.find((h) => h.id === editingHabitId);
      if (!habit) return;
      title.textContent = "Edit Habit";
      name.value = habit.name;
      category.value = habit.categoryId;
      type.value = getHabitScheduleMode(habit);
      goal.value = habit.monthGoal || 20;
      emoji.value = getHabitEmoji(habit);
      renderHabitScheduleSelectors(habit);
    } else {
      title.textContent = "Add Habit";
      name.value = "";
      goal.value = 20;
      type.value = "fixed";
      emoji.value = "📌";
      renderHabitScheduleSelectors({
        scheduleMode: "fixed",
        activeWeekdays: [...ALL_WEEKDAYS],
        activeMonthDays: [1],
      });
    }

    document.getElementById("habitTypeGroup").style.display = "none";
    document.getElementById("habitScheduleTypeGroup").style.display = "block";
    document.getElementById("habitGoalGroup").style.display = "block";
    document.getElementById("habitEmojiGroup").style.display = "block";
    updateHabitScheduleTypeUI(type.value);

    openModal("habitModal");
  }

  function saveHabitModal() {
    const name = document.getElementById("habitName").value.trim();
    if (!name) return;

    const categoryId = document.getElementById("habitCategory").value;
    const scheduleMode = getHabitScheduleMode({
      scheduleMode: document.getElementById("habitScheduleType").value,
    });
    const emoji = document.getElementById("habitEmoji").value || "📌";
    const activeWeekdays = normalizeWeekdayArray(
      getCheckedValuesFromContainer("habitActiveWeekdays"),
    );
    const activeMonthDays = normalizeMonthDayArray(
      getCheckedValuesFromContainer("habitActiveMonthDays"),
    );
    if (scheduleMode === "specific_weekdays" && !activeWeekdays.length) {
      alert("Select at least one active weekday.");
      return;
    }
    if (scheduleMode === "specific_month_days" && !activeMonthDays.length) {
      alert("Select at least one active month day.");
      return;
    }

    const monthGoal = Math.max(
      1,
      Math.min(
        31,
        parseInt(document.getElementById("habitGoal").value, 10) || 20,
      ),
    );

    const possibleActiveDays = getPossibleActiveDaysInMonth(
      {
        scheduleMode,
        activeWeekdays,
        activeMonthDays,
      },
      state.currentYear,
      state.currentMonth,
    );
    if (monthGoal > possibleActiveDays) {
      alert(
        `Warning: monthly goal ${monthGoal} is higher than possible active days (${possibleActiveDays}) in ${MONTH_NAMES[state.currentMonth]}. Your goal will be saved as entered.`,
      );
    }

    if (editingHabitId) {
      const habit = state.habits.daily.find((h) => h.id === editingHabitId);
      if (habit) {
        habit.name = name;
        habit.categoryId = categoryId;
        habit.type = scheduleMode;
        habit.scheduleMode = scheduleMode;
        habit.activeWeekdays =
          scheduleMode === "fixed" ? [...ALL_WEEKDAYS] : activeWeekdays;
        habit.activeMonthDays =
          scheduleMode === "specific_month_days" ? activeMonthDays : [];
        habit.excludedWeekdays =
          scheduleMode === "specific_weekdays"
            ? ALL_WEEKDAYS.filter(
                (weekday) => !habit.activeWeekdays.includes(weekday),
              )
            : [];
        habit.emoji = emoji;
        habit.monthGoal = monthGoal;
      }
    } else {
      state.habits.daily.push({
        id: uid("dh"),
        name,
        categoryId,
        monthGoal,
        type: scheduleMode,
        scheduleMode,
        activeWeekdays:
          scheduleMode === "fixed" ? [...ALL_WEEKDAYS] : activeWeekdays,
        activeMonthDays:
          scheduleMode === "specific_month_days" ? activeMonthDays : [],
        excludedWeekdays:
          scheduleMode === "specific_weekdays"
            ? ALL_WEEKDAYS.filter(
                (weekday) => !activeWeekdays.includes(weekday),
              )
            : [],
        emoji,
        order: state.habits.daily.length,
      });
    }

    updateHabitOrder();
    saveState();
    closeModal("habitModal");
    renderAll();
  }

  function openCategoryModal(catId) {
    editingCategoryId = catId || null;
    const title = document.getElementById("categoryModalTitle");
    const name = document.getElementById("categoryName");
    const emoji = document.getElementById("categoryEmoji");
    const color = document.getElementById("categoryColor");

    if (editingCategoryId) {
      const cat = state.categories.find((c) => c.id === editingCategoryId);
      if (!cat) return;
      title.textContent = "Edit Category";
      name.value = cat.name;
      emoji.value = cat.emoji;
      color.value = cat.color;
    } else {
      title.textContent = "Add Category";
      name.value = "";
      emoji.value = "⭐";
      color.value = "#3e85b5";
    }

    openModal("categoryModal");
  }

  function saveCategoryModal() {
    const name = document.getElementById("categoryName").value.trim();
    if (!name) return;

    const emoji = document.getElementById("categoryEmoji").value || "⭐";
    const color = document.getElementById("categoryColor").value || "#3e85b5";

    if (editingCategoryId) {
      const cat = state.categories.find((c) => c.id === editingCategoryId);
      if (cat) {
        cat.name = name;
        cat.emoji = emoji;
        cat.color = color;
      }
    } else {
      state.categories.push({ id: uid("cat"), name, emoji, color });
    }

    saveState();
    closeModal("categoryModal");
    renderAll();
  }

  function openNoteModal(habitId, day) {
    const monthData = getCurrentMonthData();
    if (!monthData.dailyNotes[habitId]) {
      monthData.dailyNotes[habitId] = {};
    }

    noteModalState = { habitId, day };
    const habit = state.habits.daily.find((h) => h.id === habitId);
    document.getElementById("noteModalTitle").textContent = habit
      ? `${habit.name} - ${formatDateKey(state.currentYear, state.currentMonth, day)}`
      : "Daily Note";
    document.getElementById("noteText").value =
      monthData.dailyNotes[habitId][day] || "";
    openModal("noteModal");
  }

  function saveNoteModal() {
    if (!noteModalState.habitId || !noteModalState.day) return;
    const monthData = getCurrentMonthData();
    const value = document.getElementById("noteText").value.trim();

    if (!monthData.dailyNotes[noteModalState.habitId]) {
      monthData.dailyNotes[noteModalState.habitId] = {};
    }

    if (value) {
      monthData.dailyNotes[noteModalState.habitId][noteModalState.day] = value;
    } else {
      delete monthData.dailyNotes[noteModalState.habitId][noteModalState.day];
      if (
        Object.keys(monthData.dailyNotes[noteModalState.habitId]).length === 0
      ) {
        delete monthData.dailyNotes[noteModalState.habitId];
      }
    }

    saveState();
    closeModal("noteModal");
    noteModalState = { habitId: null, day: null };
    renderDailyHabitsGrid();
  }

  function deleteHabit(id) {
    const habit = state.habits.daily.find((h) => h.id === id);
    if (!habit) return;

    openConfirm("Delete Habit", `Delete \"${habit.name}\"?`, () => {
      state.habits.daily = state.habits.daily.filter((h) => h.id !== id);
      updateHabitOrder();
      Object.values(state.months).forEach((monthData) => {
        delete monthData.dailyCompletions[id];
        if (monthData.dailyNotes) {
          delete monthData.dailyNotes[id];
        }
      });
      saveState();
      renderAll();
    });
  }

  function deleteCategory(id) {
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) return;

    openConfirm("Delete Category", `Delete \"${cat.name}\"?`, () => {
      state.categories = state.categories.filter((c) => c.id !== id);
      state.habits.daily.forEach((h) => {
        if (h.categoryId === id) h.categoryId = "";
      });
      saveState();
      renderAll();
    });
  }

  function openPdfDatabase() {
    if (idbPromise) return idbPromise;

    idbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PDF_STORE_NAME)) {
          db.createObjectStore(PDF_STORE_NAME, { keyPath: "fileId" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        const error = request.error || new Error("IndexedDB open failed");
        appendLogEntry({
          level: "error",
          component: "idb",
          operation: "openPdfDatabase",
          message: "IndexedDB open failed.",
          error,
        });
        reject(error);
      };
    });

    return idbPromise;
  }

  async function idbSavePdfBlob(fileId, blob) {
    const db = await openPdfDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE_NAME, "readwrite");
      tx.objectStore(PDF_STORE_NAME).put({ fileId, blob, updatedAt: nowIso() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        const error = tx.error || new Error("PDF save failed");
        appendLogEntry({
          level: "error",
          component: "idb",
          operation: "idbSavePdfBlob",
          message: "Saving PDF blob failed.",
          error,
          context: {
            fileId,
            sizeBytes: Number.isFinite(Number(blob && blob.size))
              ? Number(blob.size)
              : 0,
          },
        });
        reject(error);
      };
    });
  }

  async function idbGetPdfBlob(fileId) {
    const db = await openPdfDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE_NAME, "readonly");
      const req = tx.objectStore(PDF_STORE_NAME).get(fileId);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => {
        const error = req.error || new Error("PDF read failed");
        appendLogEntry({
          level: "error",
          component: "idb",
          operation: "idbGetPdfBlob",
          message: "Reading PDF blob failed.",
          error,
          context: { fileId },
        });
        reject(error);
      };
    });
  }

  async function idbDeletePdfBlob(fileId) {
    const db = await openPdfDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE_NAME, "readwrite");
      tx.objectStore(PDF_STORE_NAME).delete(fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        const error = tx.error || new Error("PDF delete failed");
        appendLogEntry({
          level: "error",
          component: "idb",
          operation: "idbDeletePdfBlob",
          message: "Deleting PDF blob failed.",
          error,
          context: { fileId },
        });
        reject(error);
      };
    });
  }

  function getBookById(bookId) {
    return state.books.items.find((b) => b.bookId === bookId) || null;
  }

  function getActiveBook() {
    return getBookById(state.books.activeBookId);
  }

  function getBookAiSettings() {
    if (!isPlainObject(state.books.ai)) {
      state.books.ai = {
        apiKey: "",
        apiKeyMode: "encrypted",
        apiKeySaved: false,
        apiKeyLastUpdated: "",
        rememberOnDevice: false,
        model: "gemini-2.5-flash",
        chunkChars: SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT,
        maxPagesPerRun: SUMMARY_MAX_PAGES_PER_RUN_DEFAULT,
        consolidateMode: true,
      };
    }
    state.books.ai.apiKey = "";
    state.books.ai.apiKeyMode = "encrypted";
    state.books.ai.apiKeySaved = hasStoredEncryptedApiKey();
    state.books.ai.rememberOnDevice = state.books.ai.rememberOnDevice === true;
    state.books.ai.model = ensureModelAllowed(state.books.ai.model);
    return state.books.ai;
  }

  function applyBookSummarySettingsToInputs() {
    const settings = getBookAiSettings();
    const keyInput = document.getElementById("summaryApiKeyInput");
    const modelInput = document.getElementById("summaryModelInput");
    const chunkCharsInput = document.getElementById("summaryChunkCharsInput");
    const maxPagesInput = document.getElementById("summaryMaxPagesInput");
    const rememberToggle = document.getElementById(
      "summaryRememberApiKeyToggle",
    );
    const consolidateToggle = document.getElementById(
      "summaryConsolidateToggle",
    );

    if (keyInput) keyInput.value = "";
    if (modelInput) {
      modelInput.value = ensureModelAllowed(settings.model);
      updateSummaryModelFilter(modelInput.value);
    }
    if (chunkCharsInput) {
      chunkCharsInput.value = String(
        settings.chunkChars || SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT,
      );
    }
    if (maxPagesInput) {
      maxPagesInput.value = String(
        settings.maxPagesPerRun || SUMMARY_MAX_PAGES_PER_RUN_DEFAULT,
      );
    }
    if (rememberToggle) {
      rememberToggle.checked = settings.rememberOnDevice === true;
    }
    if (consolidateToggle) {
      consolidateToggle.checked = settings.consolidateMode !== false;
    }
    applySummaryApiKeyUiState();
  }

  async function saveBookSummarySettingsFromInputs() {
    const settings = getBookAiSettings();
    const keyInput = document.getElementById("summaryApiKeyInput");
    const modelInput = document.getElementById("summaryModelInput");
    const chunkCharsInput = document.getElementById("summaryChunkCharsInput");
    const maxPagesInput = document.getElementById("summaryMaxPagesInput");
    const rememberToggle = document.getElementById(
      "summaryRememberApiKeyToggle",
    );
    const consolidateToggle = document.getElementById(
      "summaryConsolidateToggle",
    );

    const enteredKey = keyInput ? String(keyInput.value || "").trim() : "";
    settings.model = ensureModelAllowed(
      modelInput ? String(modelInput.value || "") : "",
    );

    const chunkChars = parseInt(
      chunkCharsInput ? chunkCharsInput.value : "",
      10,
    );
    settings.chunkChars = Number.isFinite(chunkChars)
      ? Math.min(30000, Math.max(4000, chunkChars))
      : SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT;

    const maxPagesPerRun = parseInt(
      maxPagesInput ? maxPagesInput.value : "",
      10,
    );
    settings.maxPagesPerRun = Number.isFinite(maxPagesPerRun)
      ? Math.min(1000, Math.max(20, maxPagesPerRun))
      : SUMMARY_MAX_PAGES_PER_RUN_DEFAULT;

    settings.rememberOnDevice = rememberToggle ? rememberToggle.checked : false;

    settings.consolidateMode = consolidateToggle
      ? consolidateToggle.checked
      : true;

    try {
      if (enteredKey) {
        const passphrase = window.prompt(
          "Create a passphrase to encrypt your Gemini API key on this device:",
          "",
        );
        if (!passphrase) {
          alert("Passphrase is required to save the API key securely.");
          return;
        }
        const confirmPassphrase = window.prompt("Confirm the passphrase:", "");
        if (passphrase !== confirmPassphrase) {
          alert("Passphrase confirmation did not match.");
          return;
        }
        await encryptApiKeyWithPassphrase(enteredKey, passphrase);
        runtimeSecrets.apiKey = enteredKey;
        runtimeSecrets.unlockedAt = nowIso();
        persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
        settings.apiKeySaved = true;
        settings.apiKeyLastUpdated = secureSettings.keyUpdatedAt || nowIso();
      } else {
        settings.apiKeySaved = hasStoredEncryptedApiKey();
      }
    } catch (error) {
      appendLogEntry({
        level: "error",
        component: "secure-settings",
        operation: "saveBookSummarySettingsFromInputs",
        message: "Failed to encrypt API key.",
        error,
      });
      alert("Failed to save encrypted API key.");
      return;
    }

    settings.apiKey = "";
    settings.apiKeyMode = "encrypted";

    if (settings.rememberOnDevice) {
      persistRuntimeApiKeyCache(getApiKeyForSummary());
    } else {
      persistRuntimeApiKeyCache("");
    }

    saveState();
    applyBookSummarySettingsToInputs();
    if (enteredKey) {
      alert(
        "Summary AI settings saved. API key is encrypted and stored safely.",
      );
    } else {
      alert("Summary AI settings saved.");
    }
  }

  function getFilteredLogs() {
    const levelFilter = document.getElementById("logsLevelFilter");
    const componentFilter = document.getElementById("logsComponentFilter");
    const textFilter = document.getElementById("logsTextFilter");
    const level = levelFilter ? String(levelFilter.value || "").trim() : "";
    const component = componentFilter
      ? String(componentFilter.value || "")
          .trim()
          .toLowerCase()
      : "";
    const needle = textFilter
      ? String(textFilter.value || "")
          .trim()
          .toLowerCase()
      : "";

    return appLogs
      .filter((entry) => (level ? entry.level === level : true))
      .filter((entry) =>
        component
          ? String(entry.component || "")
              .toLowerCase()
              .includes(component)
          : true,
      )
      .filter((entry) => {
        if (!needle) return true;
        const haystack = [
          entry.message,
          entry.operation,
          entry.errorMessage,
          JSON.stringify(entry.context || {}),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  function renderLogsView() {
    const table = document.getElementById("logsTable");
    if (!table) return;
    const logs = getFilteredLogs();
    if (!logs.length) {
      table.innerHTML = '<p class="logs-empty">No matching logs yet.</p>';
      return;
    }

    table.innerHTML = logs
      .map((entry) => {
        const contextText = sanitize(
          JSON.stringify(entry.context || {}, null, 2),
        );
        const errText = entry.errorMessage
          ? `<div class=\"logs-error\">${sanitize(entry.errorName)}: ${sanitize(entry.errorMessage)}</div>`
          : "";
        return `<article class=\"logs-entry logs-${sanitize(entry.level)}\">
          <div class=\"logs-entry-top\">
            <span class=\"logs-pill\">${sanitize(entry.level.toUpperCase())}</span>
            <span class=\"logs-time\">${sanitize(formatIsoForDisplay(entry.timestamp))}</span>
            <span class=\"logs-component\">${sanitize(entry.component)}</span>
            <span class=\"logs-operation\">${sanitize(entry.operation)}</span>
          </div>
          <div class=\"logs-message\">${sanitize(entry.message)}</div>
          ${errText}
          <pre class=\"logs-context\">${contextText}</pre>
        </article>`;
      })
      .join("");
  }

  function bindLogsControls() {
    const exportJsonBtn = document.getElementById("logsExportJsonBtn");
    const exportCsvBtn = document.getElementById("logsExportCsvBtn");
    const clearBtn = document.getElementById("logsClearBtn");
    const levelFilter = document.getElementById("logsLevelFilter");
    const componentFilter = document.getElementById("logsComponentFilter");
    const textFilter = document.getElementById("logsTextFilter");
    const liveFileSelectBtn = document.getElementById("logsLiveFileSelectBtn");
    const liveFileStopBtn = document.getElementById("logsLiveFileStopBtn");

    if (exportJsonBtn) {
      exportJsonBtn.addEventListener("click", () => {
        exportLogsAsJson();
      });
    }
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", () => {
        exportLogsAsCsv();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        const ok = window.confirm("Clear all debug logs?");
        if (!ok) return;
        appLogs = [];
        persistLogs();
        renderLogsView();
      });
    }

    [levelFilter, componentFilter, textFilter]
      .filter(Boolean)
      .forEach((control) => {
        control.addEventListener("input", renderLogsView);
        control.addEventListener("change", renderLogsView);
      });

    if (liveFileSelectBtn) {
      liveFileSelectBtn.addEventListener("click", () => {
        enableLiveLogFile().catch(() => {});
      });
    }

    if (liveFileStopBtn) {
      liveFileStopBtn.addEventListener("click", () => {
        disableLiveLogFile().catch(() => {});
      });
    }

    updateLiveLogFileStatus();
  }

  function getBookmarkById(book, bookmarkId) {
    if (!book || !Array.isArray(book.bookmarks)) return null;
    return book.bookmarks.find((bm) => bm.bookmarkId === bookmarkId) || null;
  }

  function getReadySummariesFromBookmark(bookmark) {
    const summaries = Array.isArray(bookmark && bookmark.summaries)
      ? bookmark.summaries
      : [];
    return summaries.filter(
      (s) =>
        isPlainObject(s) &&
        s.status === "ready" &&
        typeof s.content === "string" &&
        s.content.trim().length,
    );
  }

  function getBookmarkLastSummarizedPage(bookmark) {
    const ready = getReadySummariesFromBookmark(bookmark);
    if (!ready.length) return 0;
    return ready.reduce(
      (maxPage, s) => Math.max(maxPage, parseInt(s.endPage, 10) || 0),
      0,
    );
  }

  function getReadySummariesFromBook(book) {
    if (!book || !Array.isArray(book.bookmarks)) return [];
    return book.bookmarks
      .flatMap((bookmark) =>
        getReadySummariesFromBookmark(bookmark).map((summary) => ({
          ...summary,
          bookmarkId: bookmark.bookmarkId,
        })),
      )
      .sort((a, b) => {
        const endDelta =
          (parseInt(b.endPage, 10) || 0) - (parseInt(a.endPage, 10) || 0);
        if (endDelta !== 0) return endDelta;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
  }

  function getLatestSummaryUpToPageFromBook(book, page) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const byCoverage = getReadySummariesFromBook(book).filter(
      (s) => (parseInt(s.endPage, 10) || 0) <= safePage,
    );
    if (byCoverage.length) return byCoverage[0];

    const all = getReadySummariesFromBook(book);
    if (!all.length) return null;
    return [...all].sort((a, b) => {
      const aDiff = Math.abs((parseInt(a.endPage, 10) || 0) - safePage);
      const bDiff = Math.abs((parseInt(b.endPage, 10) || 0) - safePage);
      if (aDiff !== bDiff) return aDiff - bDiff;
      return a.createdAt < b.createdAt ? 1 : -1;
    })[0];
  }

  function getBookLastSummarizedPage(book) {
    const summaries = getReadySummariesFromBook(book);
    if (!summaries.length) return 0;
    return summaries.reduce(
      (maxPage, s) => Math.max(maxPage, parseInt(s.endPage, 10) || 0),
      0,
    );
  }

  function resolveIncrementalRange(book, currentBookmarkPage) {
    const safeCurrentPage = Math.max(1, parseInt(currentBookmarkPage, 10) || 1);
    const lastSummarizedPage = getBookLastSummarizedPage(book);
    const relevantSummary = getLatestSummaryUpToPageFromBook(
      book,
      safeCurrentPage,
    );

    if (safeCurrentPage <= lastSummarizedPage) {
      return {
        mode: "reuse",
        startPage: null,
        endPage: safeCurrentPage,
        lastSummarizedPage,
        relevantSummary,
      };
    }

    if (!relevantSummary) {
      return {
        mode: "full",
        startPage: 1,
        endPage: safeCurrentPage,
        lastSummarizedPage: 0,
        relevantSummary: null,
      };
    }

    return {
      mode: "incremental",
      startPage: Math.max(1, (parseInt(relevantSummary.endPage, 10) || 0) + 1),
      endPage: safeCurrentPage,
      lastSummarizedPage,
      relevantSummary,
    };
  }

  function chunkTextForSummary(text, maxChars) {
    const clean = String(text || "")
      .replace(/\r/g, "")
      .trim();
    if (!clean) return [];
    const targetSize = Math.max(4000, parseInt(maxChars, 10) || 12000);
    const paragraphs = clean
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (!paragraphs.length) return [clean];

    const chunks = [];
    let current = "";

    paragraphs.forEach((paragraph) => {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (candidate.length <= targetSize) {
        current = candidate;
        return;
      }

      if (current) {
        chunks.push(current);
      }

      if (paragraph.length <= targetSize) {
        current = paragraph;
        return;
      }

      let offset = 0;
      while (offset < paragraph.length) {
        chunks.push(paragraph.slice(offset, offset + targetSize));
        offset += targetSize;
      }
      current = "";
    });

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }

  async function extractTextRangeFromBookPdf(
    book,
    startPage,
    endPage,
    onProgress,
  ) {
    if (!book || !book.fileId) {
      throw new Error("Book PDF reference is missing.");
    }

    const blob = await idbGetPdfBlob(book.fileId);
    if (!blob) {
      throw new Error("PDF file is missing in this browser storage.");
    }

    const pdfjsLib = await ensurePdfJsLibLoaded();
    if (!pdfjsLib) {
      throw new Error("PDF.js failed to load.");
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

    const pdfData = await blob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    let pdfDoc = null;

    try {
      pdfDoc = await loadingTask.promise;
      const totalPages = Math.max(1, parseInt(pdfDoc.numPages, 10) || 1);
      const safeStart = Math.max(
        1,
        Math.min(parseInt(startPage, 10) || 1, totalPages),
      );
      const safeEnd = Math.max(
        safeStart,
        Math.min(parseInt(endPage, 10) || safeStart, totalPages),
      );

      const extracted = [];
      const rangeTotal = safeEnd - safeStart + 1;

      for (let pageNum = safeStart; pageNum <= safeEnd; pageNum += 1) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = (
          Array.isArray(textContent.items) ? textContent.items : []
        )
          .map((item) => (typeof item.str === "string" ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        extracted.push(`[Page ${pageNum}]\n${pageText}`);

        if (typeof onProgress === "function") {
          onProgress({
            current: pageNum - safeStart + 1,
            total: rangeTotal,
            absolutePage: pageNum,
          });
        }
      }

      const text = extracted.join("\n\n").trim();
      if (!text.replace(/\[Page \d+\]/g, "").trim()) {
        throw new Error(
          "No extractable text found in this page range. The PDF may be image-based.",
        );
      }

      return {
        text,
        startPage: safeStart,
        endPage: safeEnd,
        totalPages,
      };
    } catch (error) {
      appendLogEntry({
        level: "error",
        component: "pdf-extract",
        operation: "extractTextRangeFromBookPdf",
        message: "PDF text extraction failed.",
        error,
        context: {
          bookId: book.bookId,
          fileId: book.fileId,
          startPage,
          endPage,
        },
      });
      maybeAutoDownloadLogs("pdf-extract-failed");
      throw error;
    } finally {
      try {
        if (pdfDoc && typeof pdfDoc.destroy === "function") {
          await pdfDoc.destroy();
        }
      } catch (_) {}
    }
  }

  function buildIncrementalChunkPrompt({
    text,
    startPage,
    endPage,
    chunkIndex,
    totalChunks,
  }) {
    return [
      "You are a concise reading assistant.",
      `Summarize only pages ${startPage}-${endPage} from the provided text chunk ${chunkIndex}/${totalChunks}.`,
      "Keep it factual and avoid speculation.",
      "Return markdown with these sections:",
      "## Key Concepts",
      "## Important Events or Arguments",
      "## Notable Insights or Takeaways",
      "Use short bullet points.",
      "Text to summarize:",
      text,
    ].join("\n\n");
  }

  function buildChunkMergePrompt({ chunkSummaries, startPage, endPage }) {
    return [
      "You are consolidating partial summaries of one continuous reading segment.",
      `Create one clean summary for pages ${startPage}-${endPage}.`,
      "Remove overlap and duplication while preserving key details.",
      "Return markdown with these exact sections:",
      "## Key Concepts",
      "## Important Events or Arguments",
      "## Notable Insights or Takeaways",
      "Partial summaries:",
      chunkSummaries
        .map((chunk, idx) => `Chunk ${idx + 1}:\n${chunk}`)
        .join("\n\n"),
    ].join("\n\n");
  }

  function buildFinalMergePrompt({
    previousSummary,
    incrementalSummary,
    currentBookmarkPage,
  }) {
    return [
      "You are updating a running book summary.",
      `The unified summary should represent reading progress up to page ${currentBookmarkPage}.`,
      "Merge previous and new summaries without redundancy and keep chronology clear.",
      "Return markdown with these exact sections:",
      "## Key Concepts",
      "## Important Events or Arguments",
      "## Notable Insights or Takeaways",
      "Previous summary context:",
      previousSummary,
      "New incremental summary:",
      incrementalSummary,
    ].join("\n\n");
  }

  function parseGeminiResponseText(payload) {
    if (!isPlainObject(payload) || !Array.isArray(payload.candidates)) {
      return "";
    }
    return payload.candidates
      .map((candidate) => {
        const parts =
          candidate &&
          isPlainObject(candidate.content) &&
          Array.isArray(candidate.content.parts)
            ? candidate.content.parts
            : [];
        return parts
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("");
      })
      .join("\n")
      .trim();
  }

  async function callGeminiGenerateText({ apiKey, model, prompt }) {
    if (!apiKey) {
      throw new Error("Gemini API key is missing.");
    }
    if (!model) {
      throw new Error("Gemini model is missing.");
    }

    const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const retries = 1;
    const startedAt = performance.now();

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), 90000);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
            },
          }),
          signal: controller.signal,
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          const maybeMessage =
            body &&
            isPlainObject(body.error) &&
            typeof body.error.message === "string"
              ? body.error.message
              : `Gemini request failed (${response.status}).`;
          const retriable = response.status === 429 || response.status >= 500;
          if (retriable && attempt < retries) {
            continue;
          }
          throw new Error(maybeMessage);
        }

        const text = parseGeminiResponseText(body);
        if (!text) {
          throw new Error("Gemini returned an empty response.");
        }

        return text;
      } catch (error) {
        const isAbort = error && error.name === "AbortError";
        appendLogEntry({
          level: "warn",
          component: "ai-summary",
          operation: "callGeminiGenerateText",
          message: "Gemini call attempt failed.",
          error,
          context: {
            model,
            attempt,
            retries,
            promptLength: String(prompt || "").length,
            elapsedMs: Math.round(performance.now() - startedAt),
          },
        });
        if ((isAbort || /network/i.test(String(error))) && attempt < retries) {
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    throw new Error("Gemini request failed after retry.");
  }

  async function summarizeSegmentWithChunking({
    text,
    startPage,
    endPage,
    apiKey,
    model,
    chunkChars,
    onChunkProgress,
  }) {
    const chunks = chunkTextForSummary(text, chunkChars);
    const totalChunks = chunks.length || 1;
    const chunkSummaries = [];

    for (let idx = 0; idx < chunks.length; idx += 1) {
      if (typeof onChunkProgress === "function") {
        onChunkProgress({ current: idx + 1, total: totalChunks });
      }

      const prompt = buildIncrementalChunkPrompt({
        text: chunks[idx],
        startPage,
        endPage,
        chunkIndex: idx + 1,
        totalChunks,
      });

      const chunkSummary = await callGeminiGenerateText({
        apiKey,
        model,
        prompt,
      });
      chunkSummaries.push(chunkSummary);
    }

    if (chunkSummaries.length <= 1) {
      return {
        summary: chunkSummaries[0] || "",
        chunkCount: totalChunks,
      };
    }

    const mergedPrompt = buildChunkMergePrompt({
      chunkSummaries,
      startPage,
      endPage,
    });
    const merged = await callGeminiGenerateText({
      apiKey,
      model,
      prompt: mergedPrompt,
    });
    return {
      summary: merged,
      chunkCount: totalChunks,
    };
  }

  async function mergeWithPreviousSummary({
    previousSummary,
    incrementalSummary,
    currentBookmarkPage,
    apiKey,
    model,
    consolidateMode,
  }) {
    const prev = String(previousSummary || "").trim();
    const inc = String(incrementalSummary || "").trim();

    if (!prev) return inc;
    if (!consolidateMode) {
      return `${prev}\n\n---\n\n${inc}`;
    }

    const prompt = buildFinalMergePrompt({
      previousSummary: prev.slice(0, 14000),
      incrementalSummary: inc,
      currentBookmarkPage,
    });

    return callGeminiGenerateText({ apiKey, model, prompt });
  }

  function appendBookmarkSummaryRecord(book, bookmark, recordInput) {
    const timestamp = nowIso();
    const record = {
      summaryId: uid("sum"),
      model: String(recordInput.model || ""),
      startPage: Math.max(1, parseInt(recordInput.startPage, 10) || 1),
      endPage: Math.max(1, parseInt(recordInput.endPage, 10) || 1),
      isIncremental: recordInput.isIncremental === true,
      basedOnSummaryId:
        typeof recordInput.basedOnSummaryId === "string" &&
        recordInput.basedOnSummaryId.trim()
          ? recordInput.basedOnSummaryId
          : null,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: recordInput.status === "failed" ? "failed" : "ready",
      content: String(recordInput.content || ""),
      chunkMeta: isPlainObject(recordInput.chunkMeta)
        ? recordInput.chunkMeta
        : {},
      durationMs: Number.isFinite(Number(recordInput.durationMs))
        ? Math.max(0, Number(recordInput.durationMs))
        : null,
      error: String(recordInput.error || ""),
    };

    record.endPage = Math.max(record.startPage, record.endPage);

    if (!Array.isArray(bookmark.summaries)) {
      bookmark.summaries = [];
    }
    bookmark.summaries.unshift(record);
    bookmark.updatedAt = timestamp;
    book.updatedAt = timestamp;
    book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    saveState();
    return record;
  }

  function getSummaryById(bookmark, summaryId) {
    if (!bookmark || !Array.isArray(bookmark.summaries)) return null;
    return (
      bookmark.summaries.find((summary) => summary.summaryId === summaryId) ||
      null
    );
  }

  function getLatestBookmarkSummary(bookmark) {
    const summaries = getReadySummariesFromBookmark(bookmark);
    return summaries.length ? summaries[0] : null;
  }

  function formatDuration(durationMs) {
    const ms = Number(durationMs);
    if (!Number.isFinite(ms) || ms <= 0) return "-";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }

  function formatSummaryInlineMarkdown(input) {
    const escaped = sanitize(String(input || "")).replace(/\r/g, "");
    const withCode = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
    const withBold = withCode.replace(
      /\*\*([^*]+)\*\*/g,
      "<strong>$1</strong>",
    );
    return withBold
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  }

  function renderSummaryContentHtmlFallback(content) {
    const source = String(content || "")
      .replace(/\r\n?/g, "\n")
      .trim();
    if (!source) return "";

    const lines = source.split("\n");
    const html = [];
    let listDepth = 0;
    let inParagraph = false;

    function closeParagraph() {
      if (!inParagraph) return;
      html.push("</p>");
      inParagraph = false;
    }

    function closeLists(targetDepth = 0) {
      while (listDepth > targetDepth) {
        html.push("</ul>");
        listDepth -= 1;
      }
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        closeParagraph();
        closeLists(0);
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        closeParagraph();
        closeLists(0);
        const level = Math.min(4, headingMatch[1].length + 1);
        html.push(
          `<h${level}>${formatSummaryInlineMarkdown(headingMatch[2])}</h${level}>`,
        );
        continue;
      }

      const bulletMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
      if (bulletMatch) {
        closeParagraph();
        const indent = (bulletMatch[1] || "").replace(/\t/g, "  ").length;
        const depth = Math.floor(indent / 2) + 1;
        if (depth > listDepth) {
          while (listDepth < depth) {
            html.push("<ul>");
            listDepth += 1;
          }
        } else if (depth < listDepth) {
          closeLists(depth);
        }
        html.push(`<li>${formatSummaryInlineMarkdown(bulletMatch[2])}</li>`);
        continue;
      }

      closeLists(0);
      if (!inParagraph) {
        html.push("<p>");
        inParagraph = true;
      } else {
        html.push("<br>");
      }
      html.push(formatSummaryInlineMarkdown(trimmed));
    }

    closeParagraph();
    closeLists(0);
    return html.join("");
  }

  function normalizeSummaryMarkdown(content) {
    let source = String(content || "").trim();
    if (!source) return "";

    const fencedBlock = source.match(
      /^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i,
    );
    if (fencedBlock) {
      source = String(fencedBlock[1] || "").trim();
    }

    source = source
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "  ")
      .replace(/\\([*_`#>[\]\-])/g, "$1")
      .replace(/\r\n?/g, "\n")
      .trim();

    return source;
  }

  function renderSummaryContentHtml(content) {
    const source = normalizeSummaryMarkdown(content);
    if (!source) return "";

    if (window.marked && typeof window.marked.parse === "function") {
      const safeMarkdown = sanitize(source);
      return window.marked.parse(safeMarkdown, {
        gfm: true,
        breaks: true,
      });
    }

    return renderSummaryContentHtmlFallback(source);
  }

  function renderSummaryModal() {
    const titleEl = document.getElementById("summaryModalTitle");
    const detectionEl = document.getElementById("summaryDetectionText");
    const statusEl = document.getElementById("summaryRunStatus");
    const bodyEl = document.getElementById("summaryBody");
    const historyEl = document.getElementById("summaryHistoryList");
    const regenBtn = document.getElementById("summaryRegenerateBtn");
    const rebuildBtn = document.getElementById("summaryRebuildBtn");
    const copyBtn = document.getElementById("summaryCopyBtn");

    if (
      !titleEl ||
      !detectionEl ||
      !statusEl ||
      !bodyEl ||
      !historyEl ||
      !regenBtn ||
      !rebuildBtn ||
      !copyBtn
    ) {
      return;
    }

    const book = getBookById(summaryModalState.bookId);
    const bookmark = book
      ? getBookmarkById(book, summaryModalState.bookmarkId)
      : null;

    if (!book || !bookmark) {
      titleEl.textContent = "Summary";
      detectionEl.textContent = "No bookmark selected.";
      statusEl.textContent = "";
      bodyEl.textContent = "";
      historyEl.innerHTML = "";
      regenBtn.disabled = true;
      rebuildBtn.disabled = true;
      copyBtn.disabled = true;
      return;
    }

    titleEl.textContent = `Summary: ${bookmark.label}`;
    detectionEl.textContent =
      summaryModalState.detectionText || `Bookmark page ${bookmark.pdfPage}.`;
    statusEl.textContent = summaryModalState.statusText || "Ready.";

    const selectedSummary =
      getSummaryById(bookmark, summaryModalState.selectedSummaryId) ||
      summaryModalState.externalSummary ||
      getLatestBookmarkSummary(bookmark) ||
      getLatestSummaryUpToPageFromBook(book, bookmark.pdfPage);

    if (selectedSummary && selectedSummary.content) {
      bodyEl.innerHTML = renderSummaryContentHtml(selectedSummary.content);
      copyBtn.disabled = false;
    } else {
      bodyEl.innerHTML =
        "<p>No summary yet. Use Summarize up to Bookmark to generate one.</p>";
      copyBtn.disabled = true;
    }

    const entries = Array.isArray(bookmark.summaries) ? bookmark.summaries : [];
    historyEl.innerHTML = entries.length
      ? entries
          .map((entry) => {
            const stateLabel =
              entry.status === "failed"
                ? "Failed"
                : entry.isIncremental
                  ? "Incremental"
                  : "Full";
            const activeClass =
              entry.summaryId === summaryModalState.selectedSummaryId
                ? " active"
                : "";
            return `<li class='summary-history-item${activeClass}'><button class='summary-history-btn' type='button' onclick="HabitApp.selectSummary('${book.bookId}', '${bookmark.bookmarkId}', '${entry.summaryId}')">${sanitize(stateLabel)} · p${entry.startPage}-${entry.endPage} · ${sanitize(formatIsoForDisplay(entry.createdAt))}</button></li>`;
          })
          .join("")
      : "<li class='summary-history-item'>No saved summaries for this bookmark.</li>";

    const hasAnySummary = !!getLatestBookmarkSummary(bookmark);
    regenBtn.disabled = summaryModalState.isRunning || !hasAnySummary;
    rebuildBtn.disabled = summaryModalState.isRunning;
  }

  function openSummaryModal(bookId, bookmarkId) {
    summaryModalState.bookId = bookId;
    summaryModalState.bookmarkId = bookmarkId;
    summaryModalState.selectedSummaryId = null;
    summaryModalState.statusText = "Ready.";
    summaryModalState.detectionText = "";
    summaryModalState.externalSummary = null;
    summaryModalState.isRunning = false;
    renderSummaryModal();
    openModal("summaryModal");
  }

  function closeSummaryModal() {
    summaryModalState = {
      bookId: null,
      bookmarkId: null,
      selectedSummaryId: null,
      statusText: "",
      detectionText: "",
      externalSummary: null,
      isRunning: false,
    };
    closeModal("summaryModal");
  }

  function selectSummaryForModal(bookId, bookmarkId, summaryId) {
    if (
      summaryModalState.bookId !== bookId ||
      summaryModalState.bookmarkId !== bookmarkId
    ) {
      summaryModalState.bookId = bookId;
      summaryModalState.bookmarkId = bookmarkId;
    }
    summaryModalState.selectedSummaryId = summaryId;
    summaryModalState.externalSummary = null;
    renderSummaryModal();
  }

  async function copySelectedSummaryToClipboard() {
    const book = getBookById(summaryModalState.bookId);
    const bookmark = book
      ? getBookmarkById(book, summaryModalState.bookmarkId)
      : null;
    if (!book || !bookmark) return;

    const summary =
      getSummaryById(bookmark, summaryModalState.selectedSummaryId) ||
      summaryModalState.externalSummary ||
      getLatestBookmarkSummary(bookmark);
    if (!summary || !summary.content) {
      alert("No summary available to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(summary.content);
      summaryModalState.statusText = "Summary copied to clipboard.";
      renderSummaryModal();
    } catch (_) {
      appendLogEntry({
        level: "warn",
        component: "clipboard",
        operation: "copySelectedSummaryToClipboard",
        message: "Clipboard write failed.",
      });
      alert("Clipboard write failed. Please copy manually.");
    }
  }

  async function runBookmarkSummary(bookId, bookmarkId, runMode) {
    const book = getBookById(bookId);
    const bookmark = book ? getBookmarkById(book, bookmarkId) : null;
    if (!book || !bookmark) {
      alert("Bookmark not found.");
      return;
    }

    const settings = getBookAiSettings();
    const runtimeApiKey = getApiKeyForSummary();
    if (!runtimeApiKey) {
      alert(
        "Unlock your saved Gemini API key in Books > Summary AI Settings first.",
      );
      return;
    }
    if (!String(settings.model || "").trim()) {
      alert("Select a Gemini model in Summary AI Settings.");
      return;
    }

    openSummaryModal(bookId, bookmarkId);
    summaryModalState.isRunning = true;

    const currentBookmarkPage = Math.max(
      1,
      parseInt(bookmark.pdfPage, 10) || 1,
    );
    const startedAt = performance.now();
    const runId = uid("sumrun");

    let startPage = 1;
    let endPage = currentBookmarkPage;
    let isIncremental = false;
    let basedOnSummaryId = null;
    let previousSummaryContent = "";
    let attemptDescriptor = "full";

    const latestBookmarkSummary = getLatestBookmarkSummary(bookmark);

    if (runMode === "regenerate-latest") {
      if (!latestBookmarkSummary) {
        summaryModalState.isRunning = false;
        summaryModalState.statusText =
          "No summary available to regenerate yet.";
        renderSummaryModal();
        return;
      }
      startPage = Math.max(
        1,
        parseInt(latestBookmarkSummary.startPage, 10) || 1,
      );
      endPage = Math.max(
        startPage,
        parseInt(latestBookmarkSummary.endPage, 10) || startPage,
      );
      isIncremental = latestBookmarkSummary.isIncremental === true;
      basedOnSummaryId = latestBookmarkSummary.basedOnSummaryId;
      attemptDescriptor = "regenerate-latest-segment";
      summaryModalState.detectionText = `Regenerating pages ${startPage}-${endPage}.`;
    } else if (runMode === "rebuild-full") {
      startPage = 1;
      endPage = currentBookmarkPage;
      isIncremental = false;
      basedOnSummaryId = null;
      attemptDescriptor = "rebuild-full";
      summaryModalState.detectionText = `Full rebuild for pages 1-${endPage}.`;
    } else {
      const detection = resolveIncrementalRange(book, currentBookmarkPage);
      if (detection.mode === "reuse") {
        summaryModalState.isRunning = false;
        summaryModalState.externalSummary = detection.relevantSummary;
        summaryModalState.detectionText = `Already summarized through page ${detection.lastSummarizedPage}. No new pages to process.`;
        summaryModalState.statusText = detection.relevantSummary
          ? "Showing the most relevant existing summary."
          : "No relevant prior summary found for this exact page.";
        if (
          detection.relevantSummary &&
          detection.relevantSummary.bookmarkId === bookmark.bookmarkId
        ) {
          summaryModalState.selectedSummaryId =
            detection.relevantSummary.summaryId;
        }
        renderSummaryModal();
        return;
      }

      startPage = detection.startPage;
      endPage = detection.endPage;
      basedOnSummaryId = detection.relevantSummary
        ? detection.relevantSummary.summaryId
        : null;
      previousSummaryContent = detection.relevantSummary
        ? String(detection.relevantSummary.content || "")
        : "";
      isIncremental = detection.mode === "incremental";
      attemptDescriptor = detection.mode;
      summaryModalState.detectionText =
        detection.mode === "incremental"
          ? `Incremental run: pages ${startPage}-${endPage} (previously summarized through ${detection.lastSummarizedPage}).`
          : `No previous summary found. Running full summary pages 1-${endPage}.`;
    }

    const plannedPages = endPage - startPage + 1;
    if (plannedPages > settings.maxPagesPerRun) {
      const proceed = window.confirm(
        `This run will process ${plannedPages} pages (limit is ${settings.maxPagesPerRun}). Continue?`,
      );
      if (!proceed) {
        summaryModalState.isRunning = false;
        summaryModalState.statusText = "Summary run canceled.";
        renderSummaryModal();
        return;
      }
    }

    renderSummaryModal();
    appendLogEntry({
      level: "info",
      component: "ai-summary",
      operation: "runBookmarkSummary",
      message: "Summary run started.",
      runId,
      context: {
        runMode,
        attemptDescriptor,
        bookId,
        bookmarkId,
        startPage,
        endPage,
        model: settings.model,
      },
    });

    try {
      summaryModalState.statusText = `Extracting pages ${startPage}-${endPage}...`;
      renderSummaryModal();

      const extracted = await extractTextRangeFromBookPdf(
        book,
        startPage,
        endPage,
        ({ current, total, absolutePage }) => {
          summaryModalState.statusText = `Extracting page ${absolutePage} (${current}/${total})...`;
          renderSummaryModal();
        },
      );

      startPage = extracted.startPage;
      endPage = extracted.endPage;

      summaryModalState.statusText = "Generating incremental summary...";
      renderSummaryModal();

      const segmentSummary = await summarizeSegmentWithChunking({
        text: extracted.text,
        startPage,
        endPage,
        apiKey: runtimeApiKey,
        model: settings.model,
        chunkChars: settings.chunkChars,
        onChunkProgress: ({ current, total }) => {
          summaryModalState.statusText = `Summarizing chunk ${current}/${total}...`;
          renderSummaryModal();
        },
      });

      summaryModalState.statusText = previousSummaryContent
        ? "Merging with previous summary context..."
        : "Finalizing summary...";
      renderSummaryModal();

      const mergedSummary = await mergeWithPreviousSummary({
        previousSummary: previousSummaryContent,
        incrementalSummary: segmentSummary.summary,
        currentBookmarkPage: endPage,
        apiKey: runtimeApiKey,
        model: settings.model,
        consolidateMode: settings.consolidateMode,
      });

      const durationMs = performance.now() - startedAt;
      const saved = appendBookmarkSummaryRecord(book, bookmark, {
        model: settings.model,
        startPage,
        endPage,
        isIncremental,
        basedOnSummaryId,
        status: "ready",
        content: mergedSummary,
        chunkMeta: {
          chunkCount: segmentSummary.chunkCount,
          mode: attemptDescriptor,
          incrementalOnlySummary: segmentSummary.summary,
        },
        durationMs,
      });

      summaryModalState.selectedSummaryId = saved.summaryId;
      summaryModalState.externalSummary = null;
      summaryModalState.statusText = `Summary saved for pages ${startPage}-${endPage} in ${formatDuration(durationMs)}.`;
      renderBooksView();
      renderSummaryModal();
      appendLogEntry({
        level: "info",
        component: "ai-summary",
        operation: "runBookmarkSummary",
        message: "Summary run completed successfully.",
        runId,
        context: {
          bookId,
          bookmarkId,
          startPage,
          endPage,
          durationMs: Math.round(durationMs),
          chunkCount: segmentSummary.chunkCount,
          model: settings.model,
        },
      });
    } catch (error) {
      const failedDurationMs = performance.now() - startedAt;
      appendBookmarkSummaryRecord(book, bookmark, {
        model: settings.model,
        startPage,
        endPage,
        isIncremental,
        basedOnSummaryId,
        status: "failed",
        content: "",
        chunkMeta: {
          mode: attemptDescriptor,
        },
        durationMs: failedDurationMs,
        error: String(error && error.message ? error.message : error),
      });

      summaryModalState.statusText = `Summary failed: ${String(error && error.message ? error.message : error)}`;
      renderBooksView();
      renderSummaryModal();
      appendLogEntry({
        level: "error",
        component: "ai-summary",
        operation: "runBookmarkSummary",
        message: "Summary run failed.",
        error,
        runId,
        context: {
          runMode,
          attemptDescriptor,
          bookId,
          bookmarkId,
          startPage,
          endPage,
          model: settings.model,
          durationMs: Math.round(failedDurationMs),
        },
      });
      maybeAutoDownloadLogs("summary-run-failed");
    } finally {
      summaryModalState.isRunning = false;
      renderSummaryModal();
    }
  }

  function summarizeBookmark(bookId, bookmarkId) {
    runBookmarkSummary(bookId, bookmarkId, "auto");
  }

  function viewBookmarkSummary(bookId, bookmarkId) {
    openSummaryModal(bookId, bookmarkId);
  }

  function regenerateLatestSummarySegment() {
    if (!summaryModalState.bookId || !summaryModalState.bookmarkId) return;
    runBookmarkSummary(
      summaryModalState.bookId,
      summaryModalState.bookmarkId,
      "regenerate-latest",
    );
  }

  function rebuildFullSummary() {
    if (!summaryModalState.bookId || !summaryModalState.bookmarkId) return;
    runBookmarkSummary(
      summaryModalState.bookId,
      summaryModalState.bookmarkId,
      "rebuild-full",
    );
  }

  async function refreshBookBlobStatus() {
    const entries = await Promise.all(
      state.books.items.map(async (book) => {
        try {
          const blob = await idbGetPdfBlob(book.fileId);
          return [book.bookId, !!blob];
        } catch (_) {
          return [book.bookId, false];
        }
      }),
    );
    booksBlobStatus = Object.fromEntries(entries);
  }

  function setActiveBook(bookId) {
    state.books.activeBookId = bookId;
    saveState();
    renderBooksView();
  }

  function setBookUploadStatus(text, tone) {
    const statusEl = document.getElementById("bookUploadStatus");
    if (!statusEl) return;
    statusEl.textContent = String(text || "");
    statusEl.classList.remove("pending", "success", "error");
    if (["pending", "success", "error"].includes(tone)) {
      statusEl.classList.add(tone);
    }
  }

  function handleBookFileInputChange() {
    const fileInput = document.getElementById("bookPdfInput");
    if (!fileInput) return;
    const file =
      fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (!file) {
      setBookUploadStatus("No file uploaded yet.", "");
      return;
    }
    setBookUploadStatus(`Selected: ${file.name}. Ready to upload.`, "pending");
  }

  async function saveBookFromUpload() {
    const titleInput = document.getElementById("bookTitleInput");
    const authorInput = document.getElementById("bookAuthorInput");
    const fileInput = document.getElementById("bookPdfInput");

    const title = titleInput.value.trim();
    const author = authorInput.value.trim();
    const file =
      fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

    if (!title) {
      setBookUploadStatus("Book title is required before upload.", "error");
      alert("Please enter a book title.");
      return;
    }
    if (!file) {
      setBookUploadStatus("Select a PDF file before upload.", "error");
      alert("Please choose a PDF file.");
      return;
    }
    if (!/\.pdf$/i.test(file.name) || file.type !== "application/pdf") {
      setBookUploadStatus("Only PDF files are supported.", "error");
      alert("Only PDF files are supported.");
      return;
    }
    if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
      setBookUploadStatus(
        `File is too large. Maximum size is ${MAX_PDF_FILE_SIZE_MB}MB.`,
        "error",
      );
      alert(
        `PDF file is too large. Maximum size is ${MAX_PDF_FILE_SIZE_MB}MB.`,
      );
      return;
    }

    setBookUploadStatus(`Uploading ${file.name}...`, "pending");

    const fileId = uid("file");
    const bookId = uid("book");
    const createdAt = nowIso();

    await idbSavePdfBlob(fileId, file);

    state.books.items.push({
      bookId,
      title,
      author,
      fileId,
      fileName: file.name,
      fileSize: file.size,
      totalPagesDetected: null,
      totalPagesDetectedAt: "",
      totalPagesOverride: null,
      createdAt,
      updatedAt: createdAt,
      bookmarks: [],
    });
    state.books.activeBookId = bookId;
    saveState();

    titleInput.value = "";
    authorInput.value = "";
    fileInput.value = "";

    setBookUploadStatus(
      `File uploaded: ${file.name} at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
      "success",
    );

    await refreshBookBlobStatus();
    renderBooksView();
  }

  function openBookModal(bookId) {
    bookModalState.editingBookId = bookId || null;
    const titleEl = document.getElementById("bookModalTitle");
    const titleInput = document.getElementById("bookModalTitleInput");
    const authorInput = document.getElementById("bookModalAuthorInput");

    if (bookId) {
      const book = getBookById(bookId);
      if (!book) return;
      titleEl.textContent = "Edit Book Metadata";
      titleInput.value = book.title;
      authorInput.value = book.author || "";
    } else {
      titleEl.textContent = "Add Book Metadata";
      titleInput.value = "";
      authorInput.value = "";
    }

    openModal("bookModal");
  }

  function saveBookModal() {
    const title = document.getElementById("bookModalTitleInput").value.trim();
    const author = document.getElementById("bookModalAuthorInput").value.trim();
    if (!title) {
      alert("Book title is required.");
      return;
    }

    if (bookModalState.editingBookId) {
      const book = getBookById(bookModalState.editingBookId);
      if (book) {
        book.title = title;
        book.author = author;
        book.updatedAt = nowIso();
      }
    } else {
      state.books.items.push({
        bookId: uid("book"),
        title,
        author,
        fileId: uid("file"),
        fileName: "missing.pdf",
        fileSize: 0,
        totalPagesDetected: null,
        totalPagesDetectedAt: "",
        totalPagesOverride: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        bookmarks: [],
      });
    }

    saveState();
    closeModal("bookModal");
    renderBooksView();
  }

  async function deleteBook(bookId) {
    const book = getBookById(bookId);
    if (!book) return;

    openConfirm(
      "Delete Book",
      `Delete \"${book.title}\" and all its bookmarks?`,
      async () => {
        state.books.items = state.books.items.filter(
          (b) => b.bookId !== bookId,
        );
        if (state.books.activeBookId === bookId) {
          state.books.activeBookId = state.books.items[0]
            ? state.books.items[0].bookId
            : null;
        }
        saveState();
        try {
          await idbDeletePdfBlob(book.fileId);
        } catch (_) {}
        await refreshBookBlobStatus();
        renderBooksView();
      },
    );
  }

  function addBookmarkHistoryEvent(bookmark, type, note) {
    const event = {
      eventId: uid("hist"),
      type,
      at: nowIso(),
      note: String(note || ""),
    };
    bookmark.history = [
      event,
      ...(Array.isArray(bookmark.history) ? bookmark.history : []),
    ].slice(0, MAX_BOOKMARK_HISTORY);
    return event;
  }

  function openBookmarkModal(bookId, bookmarkId, options = {}) {
    const book = getBookById(bookId);
    if (!book) {
      alert("Please select a book first.");
      return;
    }

    bookmarkModalState = {
      editingBookId: bookId,
      editingBookmarkId: bookmarkId || null,
    };

    const title = document.getElementById("bookmarkModalTitle");
    const labelInput = document.getElementById("bookmarkLabel");
    const pdfPageInput = document.getElementById("bookmarkPdfPage");
    const realPageInput = document.getElementById("bookmarkRealPage");
    const noteInput = document.getElementById("bookmarkNote");

    if (bookmarkId) {
      const bm = book.bookmarks.find((b) => b.bookmarkId === bookmarkId);
      if (!bm) return;
      title.textContent = "Edit Bookmark";
      labelInput.value = bm.label;
      pdfPageInput.value = String(bm.pdfPage);
      realPageInput.value =
        bm.realPage === null || bm.realPage === undefined
          ? ""
          : String(bm.realPage);
      noteInput.value = bm.note || "";
    } else {
      title.textContent = "Add Bookmark";
      const prefillPdfPage = parseInt(options.prefillPdfPage, 10);
      const safePrefillPdfPage =
        Number.isFinite(prefillPdfPage) && prefillPdfPage >= 1
          ? prefillPdfPage
          : 1;
      labelInput.value = String(options.label || "");
      pdfPageInput.value = "";
      pdfPageInput.valueAsNumber = safePrefillPdfPage;
      pdfPageInput.defaultValue = String(safePrefillPdfPage);
      pdfPageInput.setAttribute("value", String(safePrefillPdfPage));
      realPageInput.value =
        options.prefillRealPage === null ||
        options.prefillRealPage === undefined ||
        options.prefillRealPage === ""
          ? ""
          : String(options.prefillRealPage);
      noteInput.value = String(options.note || "");
    }

    openModal("bookmarkModal");

    if (!bookmarkId) {
      const prefillPdfPage = parseInt(options.prefillPdfPage, 10);
      const safePrefillPdfPage =
        Number.isFinite(prefillPdfPage) && prefillPdfPage >= 1
          ? prefillPdfPage
          : 1;
      requestAnimationFrame(() => {
        pdfPageInput.valueAsNumber = safePrefillPdfPage;
      });
    }
  }

  function saveBookmark() {
    const book = getBookById(bookmarkModalState.editingBookId);
    if (!book) return;

    const label =
      document.getElementById("bookmarkLabel").value.trim() || "Bookmark";
    const pdfPageRaw = document.getElementById("bookmarkPdfPage").value.trim();
    const pdfPage = parseInt(pdfPageRaw, 10);
    if (!Number.isFinite(pdfPage) || pdfPage < 1) {
      alert("PDF page is required and must be 1 or greater.");
      return;
    }
    const realPageRaw = document
      .getElementById("bookmarkRealPage")
      .value.trim();
    let realPage = null;
    if (realPageRaw) {
      const parsedRealPage = parseInt(realPageRaw, 10);
      if (!Number.isFinite(parsedRealPage) || parsedRealPage < 1) {
        alert("Real book page must be empty or 1 or greater.");
        return;
      }
      realPage = parsedRealPage;
    }
    const note = document.getElementById("bookmarkNote").value.trim();

    if (bookmarkModalState.editingBookmarkId) {
      const bm = book.bookmarks.find(
        (b) => b.bookmarkId === bookmarkModalState.editingBookmarkId,
      );
      if (!bm) return;
      bm.label = label;
      bm.pdfPage = pdfPage;
      bm.realPage = realPage;
      bm.note = note;
      bm.updatedAt = nowIso();
      addBookmarkHistoryEvent(bm, "updated", "Bookmark updated");
    } else {
      const ts = nowIso();
      const bookmark = {
        bookmarkId: uid("bm"),
        label,
        pdfPage,
        realPage,
        note,
        createdAt: ts,
        updatedAt: ts,
        history: [],
        summaries: [],
      };
      addBookmarkHistoryEvent(bookmark, "created", "Bookmark created");
      book.bookmarks.unshift(bookmark);
    }

    book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    book.updatedAt = nowIso();
    saveState();
    closeModal("bookmarkModal");
    renderBooksView();
  }

  function deleteBookmark(bookId, bookmarkId) {
    const book = getBookById(bookId);
    if (!book) return;
    const bm = book.bookmarks.find((b) => b.bookmarkId === bookmarkId);
    if (!bm) return;

    openConfirm("Delete Bookmark", `Delete bookmark \"${bm.label}\"?`, () => {
      book.bookmarks = book.bookmarks.filter(
        (b) => b.bookmarkId !== bookmarkId,
      );
      book.updatedAt = nowIso();
      saveState();
      renderBooksView();
    });
  }

  function openHistoryEventModal(bookId, bookmarkId, eventId) {
    const book = getBookById(bookId);
    if (!book) return;
    const bookmark = Array.isArray(book.bookmarks)
      ? book.bookmarks.find((b) => b.bookmarkId === bookmarkId)
      : null;
    if (!bookmark) return;
    const event = Array.isArray(bookmark.history)
      ? bookmark.history.find((h) => h.eventId === eventId)
      : null;
    if (!event) return;

    historyEventModalState = {
      editingBookId: bookId,
      editingBookmarkId: bookmarkId,
      editingEventId: eventId,
    };

    document.getElementById("historyEventType").value = String(
      event.type || "updated",
    );
    document.getElementById("historyEventNote").value = String(
      event.note || "",
    );
    openModal("historyEventModal");
  }

  function saveHistoryEventModal() {
    const { editingBookId, editingBookmarkId, editingEventId } =
      historyEventModalState;
    if (!editingBookId || !editingBookmarkId || !editingEventId) return;

    const book = getBookById(editingBookId);
    if (!book) return;
    const bookmark = Array.isArray(book.bookmarks)
      ? book.bookmarks.find((b) => b.bookmarkId === editingBookmarkId)
      : null;
    if (!bookmark) return;
    const event = Array.isArray(bookmark.history)
      ? bookmark.history.find((h) => h.eventId === editingEventId)
      : null;
    if (!event) return;

    const nextType = document.getElementById("historyEventType").value.trim();
    if (!nextType) {
      alert("History title is required.");
      return;
    }

    event.type = nextType;
    event.note = document.getElementById("historyEventNote").value.trim();
    bookmark.updatedAt = nowIso();
    book.updatedAt = bookmark.updatedAt;
    book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    saveState();
    closeModal("historyEventModal");
    renderBooksView();
  }

  function deleteHistoryEvent(bookId, bookmarkId, eventId) {
    const book = getBookById(bookId);
    if (!book) return;
    const bookmark = Array.isArray(book.bookmarks)
      ? book.bookmarks.find((b) => b.bookmarkId === bookmarkId)
      : null;
    if (!bookmark || !Array.isArray(bookmark.history)) return;
    const event = bookmark.history.find((h) => h.eventId === eventId);
    if (!event) return;

    openConfirm(
      "Delete History Event",
      `Delete history event \"${event.type}\"?`,
      () => {
        bookmark.history = bookmark.history.filter(
          (h) => h.eventId !== eventId,
        );
        bookmark.updatedAt = nowIso();
        book.updatedAt = bookmark.updatedAt;
        book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        saveState();
        renderBooksView();
      },
    );
  }

  function addReaderHistoryToBookmark(book, bookmark, page) {
    if (!book || !bookmark) return;
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    bookmark.pdfPage = safePage;
    bookmark.updatedAt = nowIso();
    addBookmarkHistoryEvent(
      bookmark,
      "reader-note",
      `Reader action on PDF page ${safePage}`,
    );
    book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    book.updatedAt = nowIso();
    saveState();
  }

  function addBookmarkOnCurrentReaderPage() {
    const book = readerState.book;
    if (!book) return;

    const page = Math.max(1, parseInt(readerState.currentPage, 10) || 1);
    const sourceBookmark = readerState.sourceBookmarkId
      ? book.bookmarks.find(
          (b) => b.bookmarkId === readerState.sourceBookmarkId,
        )
      : null;
    const openedFromSameBookmarkPage =
      !!sourceBookmark && page === readerState.sourcePage;

    if (openedFromSameBookmarkPage) {
      addReaderHistoryToBookmark(book, sourceBookmark, page);
      document.getElementById("readerStatusText").textContent =
        `History added to \"${sourceBookmark.label}\".`;
      return;
    }

    if (!Array.isArray(book.bookmarks) || book.bookmarks.length === 0) {
      openBookmarkModal(book.bookId, null, { prefillPdfPage: page });
      return;
    }

    const useExisting = window.confirm(
      "Add to an existing bookmark history?\n\nOK: Existing bookmark\nCancel: Create new bookmark on this page",
    );

    if (!useExisting) {
      openBookmarkModal(book.bookId, null, { prefillPdfPage: page });
      return;
    }

    const options = book.bookmarks
      .map(
        (bm, idx) =>
          `${idx + 1}. ${bm.label} (PDF ${bm.pdfPage}, Real ${formatRealBookPage(bm.realPage)})`,
      )
      .join("\n");
    const picked = window.prompt(
      `Pick bookmark number to append history:\n${options}`,
      "1",
    );
    if (picked === null) {
      return;
    }
    const index = parseInt(picked, 10) - 1;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= book.bookmarks.length
    ) {
      alert("Invalid bookmark selection.");
      return;
    }

    const selected = book.bookmarks[index];
    addReaderHistoryToBookmark(book, selected, page);
    document.getElementById("readerStatusText").textContent =
      `History added to \"${selected.label}\".`;
  }

  function openBookmarkInNewTab(bookId, page, bookmarkId) {
    const bookmarkPart = bookmarkId
      ? `&bookmark=${encodeURIComponent(bookmarkId)}`
      : "";
    const url = `${window.location.pathname}?reader=1&book=${encodeURIComponent(bookId)}&page=${encodeURIComponent(page)}${bookmarkPart}`;
    window.open(url, "_blank", "noopener");
  }

  async function renderBooksList() {
    const list = document.getElementById("booksList");
    if (!list) return;

    if (state.books.items.length === 0) {
      list.innerHTML =
        "<div class='empty-state'><p>No books added yet.</p></div>";
      return;
    }

    list.innerHTML = state.books.items
      .map((book) => {
        const active = state.books.activeBookId === book.bookId ? "active" : "";
        const hasBlob = !!booksBlobStatus[book.bookId];
        return `<article class='books-item ${active}'><div class='books-item-main'><h4>${sanitize(book.title)}</h4><p>${sanitize(book.author || "Unknown author")}</p><p class='books-file-meta'>${sanitize(book.fileName)} · ${Math.round((book.fileSize || 0) / 1024)}KB</p>${hasBlob ? "" : "<p class='books-warning'>PDF blob missing in this browser storage.</p>"}</div><div class='books-item-actions'><button class='btn-secondary' type='button' onclick="HabitApp.setActiveBook('${book.bookId}')">Select</button><button class='btn-secondary' type='button' onclick="HabitApp.editBook('${book.bookId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBook('${book.bookId}')">Delete</button></div></article>`;
      })
      .join("");
  }

  function renderBookmarksPanel() {
    const panel = document.getElementById("bookmarksPanel");
    if (!panel) return;

    const book = getActiveBook();
    if (!book) {
      panel.innerHTML =
        "<div class='empty-state'><p>Select a book to view bookmarks.</p></div>";
      return;
    }

    if (!Array.isArray(book.bookmarks) || book.bookmarks.length === 0) {
      panel.innerHTML =
        "<div class='empty-state'><p>No bookmarks yet. Add your first bookmark.</p></div>";
      return;
    }

    panel.innerHTML = book.bookmarks
      .map((bm) => {
        const latestSummary = getLatestBookmarkSummary(bm);
        const lastSummarizedPage = getBookmarkLastSummarizedPage(bm);
        const summaryStatus = latestSummary
          ? `Latest summary: pages ${latestSummary.startPage}-${latestSummary.endPage}`
          : "No summaries yet";
        const historyHtml = (Array.isArray(bm.history) ? bm.history : [])
          .slice(0, 8)
          .map(
            (h) =>
              `<li><div class='bookmark-history-row'><span><strong>${sanitize(h.type)}</strong> · ${sanitize(formatIsoForDisplay(h.at))}${h.note ? ` · ${sanitize(h.note)}` : ""}</span><span class='bookmark-history-actions'><button class='bookmark-history-btn' type='button' onclick="HabitApp.editHistoryEvent('${book.bookId}', '${bm.bookmarkId}', '${h.eventId}')">Edit</button><button class='bookmark-history-btn danger' type='button' onclick="HabitApp.deleteHistoryEvent('${book.bookId}', '${bm.bookmarkId}', '${h.eventId}')">Delete</button></span></div></li>`,
          )
          .join("");

        return `<article class='bookmark-item'><div class='bookmark-main'><h4>${sanitize(bm.label)}</h4><p>PDF page ${bm.pdfPage} · Real page ${formatRealBookPage(bm.realPage)}</p><p>${sanitize(bm.note || "No note")}</p><p class='bookmark-updated'>Updated ${sanitize(formatIsoForDisplay(bm.updatedAt))}</p><p class='bookmark-summary-status'>${sanitize(summaryStatus)}${lastSummarizedPage ? ` · summarized through page ${lastSummarizedPage}` : ""}</p></div><div class='bookmark-actions'><button class='btn-primary' type='button' onclick="HabitApp.openBookmark('${book.bookId}', ${bm.pdfPage}, '${bm.bookmarkId}')">Open at Bookmark</button><button class='btn-secondary' type='button' onclick="HabitApp.summarizeBookmark('${book.bookId}', '${bm.bookmarkId}')">Summarize up to Bookmark</button><button class='btn-secondary' type='button' onclick="HabitApp.viewBookmarkSummary('${book.bookId}', '${bm.bookmarkId}')">View Summaries</button><button class='btn-secondary' type='button' onclick="HabitApp.editBookmark('${book.bookId}', '${bm.bookmarkId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBookmark('${book.bookId}', '${bm.bookmarkId}')">Delete</button></div><ul class='bookmark-history'>${historyHtml || "<li>No history yet.</li>"}</ul></article>`;
      })
      .join("");
  }

  async function renderBooksView() {
    await refreshBookBlobStatus();
    await renderBooksList();
    renderBookmarksPanel();
    await renderBookFinisherHelper();
    renderBooksAnalyticsDashboard({ includeCharts: false });
    applyBookSummarySettingsToInputs();
  }

  function renderAll() {
    clearLinkedHoverState();
    renderMonthHeader();
    renderSummary();
    renderWeeklySummaryCards();
    renderDailyHabitsGrid();
    renderManageView();

    if (
      document.getElementById("view-analytics")?.classList.contains("active")
    ) {
      renderAnalyticsView();
    }
  }

  function setBackupStatus(text, tone) {
    const statusEl = document.getElementById("backupStatus");
    if (!statusEl) return;
    statusEl.textContent = String(text || "");
    statusEl.classList.remove("pending", "success", "warn", "error");
    if (["pending", "success", "warn", "error"].includes(String(tone))) {
      statusEl.classList.add(String(tone));
    }
  }

  function shouldExportIncludePdfs() {
    const checkbox = document.getElementById("exportIncludePdfs");
    return !!(checkbox && checkbox.checked);
  }

  async function collectEmbeddedPdfPayload() {
    const pdfBlobs = {};
    const books =
      isPlainObject(state.books) && Array.isArray(state.books.items)
        ? state.books.items
        : [];
    let embeddedCount = 0;
    let missingCount = 0;
    let failedCount = 0;
    let totalBytes = 0;

    for (const book of books) {
      if (!isPlainObject(book) || typeof book.fileId !== "string") continue;
      const fileId = book.fileId.trim();
      if (!fileId) continue;

      try {
        const blob = await idbGetPdfBlob(fileId);
        if (!blob) {
          missingCount += 1;
          continue;
        }

        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        pdfBlobs[fileId] = toBase64(bytes);
        embeddedCount += 1;
        totalBytes += Number.isFinite(Number(blob.size))
          ? Number(blob.size)
          : bytes.length;
      } catch (error) {
        failedCount += 1;
        appendLogEntry({
          level: "warn",
          component: "backup",
          operation: "collectEmbeddedPdfPayload",
          message: "Skipping PDF while building export payload.",
          error,
          context: { fileId },
        });
      }
    }

    return { pdfBlobs, embeddedCount, missingCount, failedCount, totalBytes };
  }

  async function restoreEmbeddedPdfPayload(pdfBlobs) {
    if (!isPlainObject(pdfBlobs)) {
      return { restoredCount: 0, failedCount: 0 };
    }

    let restoredCount = 0;
    let failedCount = 0;

    for (const [fileIdRaw, encoded] of Object.entries(pdfBlobs)) {
      const fileId = String(fileIdRaw || "").trim();
      if (!fileId || typeof encoded !== "string" || !encoded.trim()) {
        failedCount += 1;
        continue;
      }

      try {
        const bytes = fromBase64(encoded);
        const blob = new Blob([bytes], { type: "application/pdf" });
        await idbSavePdfBlob(fileId, blob);
        restoredCount += 1;
      } catch (error) {
        failedCount += 1;
        appendLogEntry({
          level: "warn",
          component: "backup",
          operation: "restoreEmbeddedPdfPayload",
          message: "Restoring embedded PDF failed.",
          error,
          context: { fileId },
        });
      }
    }

    return { restoredCount, failedCount };
  }

  async function exportData() {
    const includePdfs = shouldExportIncludePdfs();
    setBackupStatus(
      includePdfs
        ? "Preparing backup with embedded PDFs..."
        : "Preparing metadata backup...",
      "pending",
    );

    try {
      const exportedState = JSON.parse(JSON.stringify(state));
      let payloadStats = {
        pdfBlobs: {},
        embeddedCount: 0,
        missingCount: 0,
        failedCount: 0,
        totalBytes: 0,
      };

      if (includePdfs) {
        payloadStats = await collectEmbeddedPdfPayload();
        if (Object.keys(payloadStats.pdfBlobs).length > 0) {
          exportedState.pdfBlobs = payloadStats.pdfBlobs;
        }
      }

      const blob = new Blob([JSON.stringify(exportedState, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `habit-tracker-backup-${monthKey(state.currentYear, state.currentMonth)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      if (!includePdfs) {
        setBackupStatus(
          "Metadata backup exported. Enable Include PDFs for full backup.",
          "success",
        );
        return;
      }

      const estimatedJsonBytes = Math.round(payloadStats.totalBytes * 1.34);
      const info = `Embedded ${payloadStats.embeddedCount} PDF${payloadStats.embeddedCount === 1 ? "" : "s"} (~${formatByteSize(estimatedJsonBytes)}).`;
      if (
        estimatedJsonBytes >= EMBEDDED_EXPORT_SIZE_WARN_BYTES ||
        payloadStats.failedCount > 0 ||
        payloadStats.missingCount > 0
      ) {
        setBackupStatus(
          `${info} ${payloadStats.missingCount ? `${payloadStats.missingCount} missing in IndexedDB.` : ""} ${payloadStats.failedCount ? `${payloadStats.failedCount} failed to embed.` : ""}`.trim(),
          "warn",
        );
      } else {
        setBackupStatus(`Full backup exported. ${info}`, "success");
      }
    } catch (error) {
      appendLogEntry({
        level: "error",
        component: "backup",
        operation: "exportData",
        message: "Export failed.",
        error,
      });
      setBackupStatus("Export failed. See logs for details.", "error");
      alert("Export failed. See logs for details.");
    }
  }

  function validateImportedState(imported) {
    const errors = [];

    if (!isPlainObject(imported)) {
      return { ok: false, errors: ["Root value must be an object."] };
    }

    if (!Array.isArray(imported.categories)) {
      errors.push("categories must be an array.");
    }

    if (
      !isPlainObject(imported.habits) ||
      !Array.isArray(imported.habits.daily)
    ) {
      errors.push("habits.daily must be an array.");
    }

    if (!isPlainObject(imported.months)) {
      errors.push("months must be an object.");
    }

    if (imported.books !== undefined) {
      if (!isPlainObject(imported.books)) {
        errors.push("books must be an object when provided.");
      } else {
        if (!Array.isArray(imported.books.items)) {
          errors.push("books.items must be an array.");
        } else {
          imported.books.items.forEach((book, i) => {
            if (!isPlainObject(book)) {
              errors.push(`books.items[${i}] must be an object.`);
              return;
            }
            if (typeof book.bookId !== "string" || !book.bookId.trim()) {
              errors.push(
                `books.items[${i}].bookId must be a non-empty string.`,
              );
            }
            if (
              book.bookmarks !== undefined &&
              !Array.isArray(book.bookmarks)
            ) {
              errors.push(`books.items[${i}].bookmarks must be an array.`);
            }
            if (Array.isArray(book.bookmarks)) {
              book.bookmarks.forEach((bm, j) => {
                if (!isPlainObject(bm)) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}] must be an object.`,
                  );
                  return;
                }
                if (
                  typeof bm.bookmarkId !== "string" ||
                  !bm.bookmarkId.trim()
                ) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}].bookmarkId must be a non-empty string.`,
                  );
                }
                if (!Number.isFinite(Number(bm.pdfPage))) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}].pdfPage must be numeric.`,
                  );
                }
                const hasRealPageValue =
                  bm.realPage !== undefined &&
                  bm.realPage !== null &&
                  String(bm.realPage).trim() !== "";
                if (hasRealPageValue && !Number.isFinite(Number(bm.realPage))) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}].realPage must be numeric when provided.`,
                  );
                }
                if (bm.history !== undefined && !Array.isArray(bm.history)) {
                  errors.push(
                    `books.items[${i}].bookmarks[${j}].history must be an array.`,
                  );
                }
              });
            }
          });
        }
      }
    }

    if (imported.pdfBlobs !== undefined) {
      if (!isPlainObject(imported.pdfBlobs)) {
        errors.push("pdfBlobs must be an object when provided.");
      } else {
        Object.entries(imported.pdfBlobs).forEach(([fileId, encoded], i) => {
          if (typeof fileId !== "string" || !fileId.trim()) {
            errors.push(`pdfBlobs entry ${i + 1} has an invalid fileId key.`);
          }
          if (typeof encoded !== "string" || !encoded.trim()) {
            errors.push(
              `pdfBlobs[${fileId || i}] must be a non-empty base64 string.`,
            );
          }
        });
      }
    }

    return { ok: errors.length === 0, errors };
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const imported = JSON.parse(e.target.result);
        const validation = validateImportedState(imported);
        if (!validation.ok) {
          alert(
            `Import failed:\n- ${validation.errors.slice(0, 8).join("\n- ")}`,
          );
          return;
        }

        const embeddedPdfPayload =
          imported.pdfBlobs !== undefined ? imported.pdfBlobs : null;
        if (imported.pdfBlobs !== undefined) {
          delete imported.pdfBlobs;
        }

        state = imported;
        migrateState();
        ensureMonthData();
        saveState();
        renderAll();

        const restoreStats =
          await restoreEmbeddedPdfPayload(embeddedPdfPayload);
        await refreshBookBlobStatus();
        await renderBooksView();

        if (restoreStats.restoredCount > 0) {
          const tone = restoreStats.failedCount > 0 ? "warn" : "success";
          setBackupStatus(
            `Import completed. Restored ${restoreStats.restoredCount} embedded PDF${restoreStats.restoredCount === 1 ? "" : "s"}${restoreStats.failedCount ? `, ${restoreStats.failedCount} failed.` : "."}`,
            tone,
          );
        } else {
          setBackupStatus(
            "Import completed. No embedded PDFs found; re-upload PDFs if needed.",
            embeddedPdfPayload ? "warn" : "success",
          );
        }
      } catch (_) {
        alert("Failed to parse backup file.");
      }
    };
    reader.readAsText(file);
  }

  function initSidebarCollapse() {
    sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
    applySidebarCollapseState();
  }

  function isDesktopViewport() {
    return window.innerWidth > 768;
  }

  function applySidebarCollapseState() {
    const sidebar = document.querySelector(".sidebar");
    const toggle = document.getElementById("sidebarCollapseToggle");
    if (!sidebar || !toggle) return;
    const effective = sidebarCollapsed && isDesktopViewport();
    sidebar.classList.toggle("collapsed", effective);
    toggle.setAttribute("aria-expanded", String(!effective));
  }

  function setSidebarCollapsed(collapsed, persist = true) {
    sidebarCollapsed = !!collapsed;
    applySidebarCollapseState();
    if (persist) {
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, sidebarCollapsed ? "1" : "0");
    }
  }

  function loadScriptTag(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(
        `script[data-pdfjs-url="${url}"]`,
      );

      if (existing) {
        if (existing.dataset.loaded === "1") {
          resolve();
          return;
        }
        if (existing.dataset.failed === "1") {
          reject(new Error(`Script failed earlier: ${url}`));
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error(`Failed to load script: ${url}`)),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.pdfjsUrl = url;
      script.addEventListener(
        "load",
        () => {
          script.dataset.loaded = "1";
          resolve();
        },
        { once: true },
      );
      script.addEventListener(
        "error",
        () => {
          script.dataset.failed = "1";
          reject(new Error(`Failed to load script: ${url}`));
        },
        { once: true },
      );
      document.head.appendChild(script);
    });
  }

  async function ensurePdfJsLibLoaded() {
    if (window.pdfjsLib && typeof window.pdfjsLib.getDocument === "function") {
      return window.pdfjsLib;
    }

    for (const url of PDFJS_SCRIPT_URLS) {
      try {
        await loadScriptTag(url);
      } catch (_) {
        continue;
      }

      if (
        window.pdfjsLib &&
        typeof window.pdfjsLib.getDocument === "function"
      ) {
        return window.pdfjsLib;
      }
    }

    return null;
  }

  async function initReaderMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reader") !== "1") {
      return false;
    }

    document.getElementById("app").style.display = "none";
    const readerRoot = document.getElementById("readerMode");
    readerRoot.style.display = "block";
    loadReaderThemePreferences();
    applyReaderThemeClasses();

    const bookId = params.get("book") || "";
    const targetPage = Math.max(1, parseInt(params.get("page"), 10) || 1);
    const sourceBookmarkId = params.get("bookmark") || "";
    const book = getBookById(bookId);
    if (!book) {
      document.getElementById("readerStatusText").textContent =
        "Book metadata not found.";
      return true;
    }

    readerState.book = book;
    readerState.sourceBookmarkId = sourceBookmarkId || null;
    readerState.sourcePage = targetPage;
    document.getElementById("readerBookTitle").textContent = book.title;

    let blob = null;
    try {
      blob = await idbGetPdfBlob(book.fileId);
    } catch (_) {
      blob = null;
    }
    if (!blob) {
      document.getElementById("readerStatusText").textContent =
        "PDF file is missing in IndexedDB for this browser.";
      return true;
    }

    const pdfjsLib = await ensurePdfJsLibLoaded();
    if (!pdfjsLib) {
      document.getElementById("readerStatusText").textContent =
        "PDF.js failed to load. Check your internet and refresh.";
      return true;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

    const url = URL.createObjectURL(blob);
    try {
      const loadingTask = pdfjsLib.getDocument(url);
      readerState.pdfDoc = await loadingTask.promise;
      readerState.totalPages = readerState.pdfDoc.numPages;
      document.getElementById("readerStatusText").textContent = "Loaded";
      await renderReaderPage(Math.min(targetPage, readerState.totalPages));
    } catch (_) {
      document.getElementById("readerStatusText").textContent =
        "Failed to open PDF.";
    } finally {
      URL.revokeObjectURL(url);
    }

    bindReaderEvents();
    updateReaderThemeControls();
    return true;
  }

  async function renderReaderPage(pageNumber) {
    if (!readerState.pdfDoc) return;

    const safePage = Math.max(1, Math.min(pageNumber, readerState.totalPages));
    readerState.currentPage = safePage;

    const page = await readerState.pdfDoc.getPage(safePage);
    const baseViewport = page.getViewport({ scale: 1 });
    const canvasWrap = document.querySelector(".reader-canvas-wrap");
    const availableWidth = Math.max(
      320,
      (canvasWrap ? canvasWrap.clientWidth : window.innerWidth) - 24,
    );
    const fitScale = availableWidth / baseViewport.width;
    const cssScale = Math.max(1.4, Math.min(fitScale, 2.6));
    const viewport = page.getViewport({ scale: cssScale });

    const outputScale = Math.min(window.devicePixelRatio || 1, 3);
    const canvas = document.getElementById("readerCanvas");
    const ctx = canvas.getContext("2d");
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    if (readerState.renderTask) {
      try {
        readerState.renderTask.cancel();
      } catch (_) {}
    }

    readerState.renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform: [outputScale, 0, 0, outputScale, 0, 0],
    });
    await readerState.renderTask.promise;
    applyReaderThemeClasses();

    document.getElementById("readerPageIndicator").textContent =
      `${readerState.currentPage} / ${readerState.totalPages}`;
    document.getElementById("readerJumpPage").value = String(
      readerState.currentPage,
    );
  }

  function bindReaderEvents() {
    const prev = document.getElementById("readerPrevPage");
    const next = document.getElementById("readerNextPage");
    const go = document.getElementById("readerGoPage");
    const jump = document.getElementById("readerJumpPage");
    const addBookmarkOnPage = document.getElementById(
      "readerAddBookmarkOnPage",
    );
    const darkToggle = document.getElementById("readerDarkToggle");
    const darkMode = document.getElementById("readerDarkMode");
    const zoomIn = document.getElementById("readerZoomIn");
    const zoomOut = document.getElementById("readerZoomOut");
    const bookContainer = document.getElementById("readerBookContainer");

    // Zoom state
    let zoomLevel = 1;
    function applyZoom() {
      bookContainer.style.transform = `scale(${zoomLevel})`;
      bookContainer.style.transformOrigin = "top center";
    }
    zoomIn.addEventListener("click", () => {
      zoomLevel = Math.min(zoomLevel + 0.1, 2.5);
      applyZoom();
      localStorage.setItem("readerZoomLevel", zoomLevel);
    });
    zoomOut.addEventListener("click", () => {
      zoomLevel = Math.max(zoomLevel - 0.1, 0.5);
      applyZoom();
      localStorage.setItem("readerZoomLevel", zoomLevel);
    });
    // Load zoom from storage
    const savedZoom = parseFloat(localStorage.getItem("readerZoomLevel"));
    if (!isNaN(savedZoom)) {
      zoomLevel = savedZoom;
      applyZoom();
    }

    function scrollBookToTop() {
      if (bookContainer) {
        bookContainer.scrollTop = 0;
        bookContainer.parentElement.scrollTop = 0;
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }

    prev.addEventListener("click", () => {
      renderReaderPage(readerState.currentPage - 1);
      setTimeout(scrollBookToTop, 10);
    });
    next.addEventListener("click", () => {
      renderReaderPage(readerState.currentPage + 1);
      setTimeout(scrollBookToTop, 10);
    });
    go.addEventListener("click", () => {
      renderReaderPage(parseInt(jump.value, 10) || 1);
      setTimeout(scrollBookToTop, 10);
    });
    jump.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        renderReaderPage(parseInt(jump.value, 10) || 1);
        setTimeout(scrollBookToTop, 10);
      }
    });

    darkToggle.addEventListener("click", () => {
      toggleReaderDarkTheme();
    });

    darkMode.addEventListener("change", (e) => {
      setReaderDarkMode(e.target.value);
    });

    addBookmarkOnPage.addEventListener("click", () => {
      addBookmarkOnCurrentReaderPage();
    });

    if (!readerState.resizeHandlerBound) {
      window.addEventListener("resize", () => {
        if (!readerState.pdfDoc) return;
        if (readerState.resizeTimer) {
          clearTimeout(readerState.resizeTimer);
        }
        readerState.resizeTimer = setTimeout(() => {
          renderReaderPage(readerState.currentPage);
        }, 120);
      });
      readerState.resizeHandlerBound = true;
    }
  }

  function bindEvents() {
    document.querySelectorAll(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchView(tab.dataset.view));
    });

    document
      .getElementById("prevMonth")
      .addEventListener("click", () => navigateMonth(-1));
    document
      .getElementById("nextMonth")
      .addEventListener("click", () => navigateMonth(1));

    document
      .getElementById("btnAddDailyHabit")
      .addEventListener("click", () => openHabitModal());
    document
      .getElementById("btnAddDailyManage")
      .addEventListener("click", () => openHabitModal());
    document
      .getElementById("btnAddCategory")
      .addEventListener("click", () => openCategoryModal());

    document
      .getElementById("habitModalClose")
      .addEventListener("click", () => closeModal("habitModal"));
    document
      .getElementById("habitModalCancel")
      .addEventListener("click", () => closeModal("habitModal"));
    document
      .getElementById("habitModalSave")
      .addEventListener("click", saveHabitModal);
    document
      .getElementById("habitScheduleType")
      .addEventListener("change", (event) => {
        updateHabitScheduleTypeUI(event.target.value);
      });

    document
      .getElementById("categoryModalClose")
      .addEventListener("click", () => closeModal("categoryModal"));
    document
      .getElementById("categoryModalCancel")
      .addEventListener("click", () => closeModal("categoryModal"));
    document
      .getElementById("categoryModalSave")
      .addEventListener("click", saveCategoryModal);

    document
      .getElementById("noteModalClose")
      .addEventListener("click", () => closeModal("noteModal"));
    document
      .getElementById("noteModalCancel")
      .addEventListener("click", () => closeModal("noteModal"));
    document
      .getElementById("noteModalSave")
      .addEventListener("click", saveNoteModal);

    document
      .getElementById("bookModalClose")
      .addEventListener("click", () => closeModal("bookModal"));
    document
      .getElementById("bookModalCancel")
      .addEventListener("click", () => closeModal("bookModal"));
    document
      .getElementById("bookModalSave")
      .addEventListener("click", saveBookModal);

    document
      .getElementById("bookmarkModalClose")
      .addEventListener("click", () => closeModal("bookmarkModal"));
    document
      .getElementById("bookmarkModalCancel")
      .addEventListener("click", () => closeModal("bookmarkModal"));
    document
      .getElementById("bookmarkModalSave")
      .addEventListener("click", saveBookmark);

    document
      .getElementById("historyEventModalClose")
      .addEventListener("click", () => closeModal("historyEventModal"));
    document
      .getElementById("historyEventModalCancel")
      .addEventListener("click", () => closeModal("historyEventModal"));
    document
      .getElementById("historyEventModalSave")
      .addEventListener("click", saveHistoryEventModal);

    document
      .getElementById("summaryModalClose")
      .addEventListener("click", closeSummaryModal);
    document
      .getElementById("summaryModalCancel")
      .addEventListener("click", closeSummaryModal);
    document
      .getElementById("summaryRegenerateBtn")
      .addEventListener("click", regenerateLatestSummarySegment);
    document
      .getElementById("summaryRebuildBtn")
      .addEventListener("click", rebuildFullSummary);
    document.getElementById("summaryCopyBtn").addEventListener("click", () => {
      copySelectedSummaryToClipboard().catch((err) => {
        appendLogEntry({
          level: "error",
          component: "clipboard",
          operation: "summaryCopyBtn.click",
          message: "Unhandled clipboard error in copy action.",
          error: err,
        });
        alert("Failed to copy summary.");
      });
    });

    document
      .getElementById("btnSaveSummarySettings")
      .addEventListener("click", () => {
        saveBookSummarySettingsFromInputs().catch((error) => {
          appendLogEntry({
            level: "error",
            component: "secure-settings",
            operation: "btnSaveSummarySettings.click",
            message: "Unhandled settings save error.",
            error,
          });
          alert("Failed to save summary settings.");
        });
      });

    const unlockBtn = document.getElementById("summaryApiKeyUnlockBtn");
    if (unlockBtn) {
      unlockBtn.addEventListener("click", () => {
        unlockStoredApiKeyInteractive().catch((error) => {
          appendLogEntry({
            level: "error",
            component: "secure-settings",
            operation: "summaryApiKeyUnlockBtn.click",
            message: "Unhandled unlock error.",
            error,
          });
        });
      });
    }

    const clearBtn = document.getElementById("summaryApiKeyClearBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        const ok = window.confirm(
          "Delete the saved encrypted API key from this device?",
        );
        if (!ok) return;
        wipeStoredApiKey();
      });
    }

    bindSummaryModelPicker();
    bindLogsControls();

    document
      .getElementById("confirmModalClose")
      .addEventListener("click", () => closeModal("confirmModal"));
    document
      .getElementById("confirmCancel")
      .addEventListener("click", () => closeModal("confirmModal"));
    document.getElementById("confirmOk").addEventListener("click", () => {
      closeModal("confirmModal");
      if (confirmCallback) confirmCallback();
      confirmCallback = null;
    });

    document
      .getElementById("monthlyReviewSave")
      .addEventListener("click", saveMonthlyReview);

    const analyticsMode = document.getElementById(
      "analyticsDisplayModeAnalytics",
    );
    if (analyticsMode) {
      analyticsMode.addEventListener("change", (event) => {
        setAnalyticsDisplayMode(event.target.value);
      });
    }

    document.getElementById("btnExport").addEventListener("click", exportData);
    document.getElementById("btnImport").addEventListener("click", () => {
      document.getElementById("importFile").click();
    });
    document
      .getElementById("importFile")
      .addEventListener("change", function () {
        if (this.files && this.files[0]) {
          importData(this.files[0]);
          this.value = "";
        }
      });

    setBackupStatus(
      "Metadata-only export is default. Enable Include PDFs for full backup.",
      "",
    );

    document.getElementById("btnResetMonth").addEventListener("click", () => {
      openConfirm(
        "Reset Month",
        `Clear all check marks and notes for ${MONTH_NAMES[state.currentMonth]} ${state.currentYear}?`,
        () => {
          state.months[monthKey(state.currentYear, state.currentMonth)] =
            getDefaultMonthData();
          saveState();
          renderAll();
        },
      );
    });

    document.getElementById("btnClearAll").addEventListener("click", () => {
      openConfirm(
        "Clear All Data",
        "This deletes all habits and books metadata. Continue?",
        () => {
          state = getDefaultState();
          saveState();
          renderAll();
          renderBooksView();
        },
      );
    });

    document
      .getElementById("mobileMenuToggle")
      .addEventListener("click", () => {
        document.querySelector(".sidebar").classList.toggle("open");
      });

    document
      .getElementById("sidebarCollapseToggle")
      .addEventListener("click", () => {
        setSidebarCollapsed(!sidebarCollapsed);
      });

    window.addEventListener("resize", applySidebarCollapseState);

    document.querySelectorAll(".emoji-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        const target = document.getElementById(
          opt.dataset.target || "categoryEmoji",
        );
        if (target) target.value = opt.dataset.emoji;
      });
    });

    document.querySelectorAll(".color-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        document.getElementById("categoryColor").value = opt.dataset.color;
      });
    });

    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.remove("open");
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document
          .querySelectorAll(".modal-overlay.open")
          .forEach((m) => m.classList.remove("open"));
      }
    });

    document.getElementById("btnUploadBook").addEventListener("click", () => {
      saveBookFromUpload().catch((err) => {
        appendLogEntry({
          level: "error",
          component: "books",
          operation: "btnUploadBook.click",
          message: "Failed to upload PDF.",
          error: err,
        });
        setBookUploadStatus(
          "Upload failed. Please review the file and try again.",
          "error",
        );
        alert("Failed to upload PDF.");
      });
    });

    const pdfInput = document.getElementById("bookPdfInput");
    if (pdfInput) {
      pdfInput.addEventListener("change", handleBookFileInputChange);
    }
    document
      .getElementById("btnBookCreate")
      .addEventListener("click", () => openBookModal());
    document.getElementById("btnAddBookmark").addEventListener("click", () => {
      if (!state.books.activeBookId) {
        alert("Select a book first.");
        return;
      }
      openBookmarkModal(state.books.activeBookId);
    });

    document.querySelectorAll("[data-books-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setBooksAnalyticsRange(btn.dataset.booksRange || "30");
      });
    });

    const finisherBookSelect = document.getElementById("finisherBookSelect");
    if (finisherBookSelect) {
      finisherBookSelect.addEventListener("change", async (event) => {
        const helper = getOrInitBooksHelperState();
        helper.selectedBookId = String(event.target.value || "");
        const book = getSelectedFinisherBook();
        helper.startPage = book ? getBookMaxBookmarkPage(book) : 1;
        saveState();
        await renderBookFinisherHelper();
      });
    }

    const finisherTargetDate = document.getElementById("finisherTargetDate");
    if (finisherTargetDate) {
      finisherTargetDate.addEventListener("change", async (event) => {
        const helper = getOrInitBooksHelperState();
        helper.targetDate = String(event.target.value || "");
        saveState();
        await renderBookFinisherHelper();
      });
    }

    const finisherStartPage = document.getElementById("finisherStartPage");
    if (finisherStartPage) {
      finisherStartPage.addEventListener("change", async (event) => {
        const helper = getOrInitBooksHelperState();
        const next = parseInt(event.target.value, 10);
        helper.startPage = Number.isFinite(next) && next >= 1 ? next : 1;
        saveState();
        await renderBookFinisherHelper();
      });
    }

    const finisherTotalPages = document.getElementById("finisherTotalPages");
    if (finisherTotalPages) {
      finisherTotalPages.addEventListener("change", async (event) => {
        const book = getSelectedFinisherBook();
        if (!book) return;
        const next = parseInt(event.target.value, 10);
        book.totalPagesOverride =
          Number.isFinite(next) && next >= 1 ? next : null;
        book.updatedAt = nowIso();
        saveState();
        await renderBookFinisherHelper();
      });
    }

    const finisherUseAutoPagesBtn = document.getElementById(
      "finisherUseAutoPagesBtn",
    );
    if (finisherUseAutoPagesBtn) {
      finisherUseAutoPagesBtn.addEventListener("click", async () => {
        const book = getSelectedFinisherBook();
        if (!book) return;
        book.totalPagesOverride = null;
        book.updatedAt = nowIso();
        saveState();
        await renderBookFinisherHelper();
      });
    }

    document.querySelectorAll("[data-finisher-weekday]").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const helper = getOrInitBooksHelperState();
        helper.weekdays = Array.from(
          document.querySelectorAll("[data-finisher-weekday]"),
        )
          .filter((node) => node instanceof HTMLInputElement && node.checked)
          .map((node) => parseInt(node.dataset.finisherWeekday, 10))
          .filter(
            (value) => Number.isInteger(value) && value >= 0 && value <= 6,
          )
          .sort((a, b) => a - b);
        saveState();
        await renderBookFinisherHelper();
      });
    });

    const finisherRecalculateBtn = document.getElementById(
      "finisherRecalculateBtn",
    );
    if (finisherRecalculateBtn) {
      finisherRecalculateBtn.addEventListener("click", async () => {
        await renderBookFinisherHelper();
      });
    }

    window.addEventListener("error", (event) => {
      appendLogEntry({
        level: "error",
        component: "window",
        operation: "error",
        message: "Unhandled window error.",
        error: event && event.error ? event.error : event && event.message,
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      appendLogEntry({
        level: "error",
        component: "window",
        operation: "unhandledrejection",
        message: "Unhandled promise rejection.",
        error: event && event.reason ? event.reason : "Promise rejection",
      });
    });
  }

  window.HabitApp = {
    editHabit(id) {
      openHabitModal(id);
    },
    moveHabit(id, direction) {
      moveDailyHabit(id, direction);
    },
    deleteHabit,
    editCategory(id) {
      openCategoryModal(id);
    },
    deleteCategory,
    setActiveBook,
    editBook(bookId) {
      openBookModal(bookId);
    },
    deleteBook(bookId) {
      deleteBook(bookId);
    },
    editBookmark(bookId, bookmarkId) {
      openBookmarkModal(bookId, bookmarkId);
    },
    deleteBookmark,
    editHistoryEvent(bookId, bookmarkId, eventId) {
      openHistoryEventModal(bookId, bookmarkId, eventId);
    },
    deleteHistoryEvent,
    openBookmark(bookId, page, bookmarkId) {
      openBookmarkInNewTab(bookId, page, bookmarkId);
    },
    summarizeBookmark,
    viewBookmarkSummary,
    selectSummary(bookId, bookmarkId, summaryId) {
      selectSummaryForModal(bookId, bookmarkId, summaryId);
    },
  };

  async function init() {
    loadLogs();
    loadSecureSettings();
    loadState();
    loadAnalyticsPreferences();
    bindEvents();
    initSidebarCollapse();
    applyBookSummarySettingsToInputs();
    await maybeMigrateLegacyApiKey();
    await tryUnlockOnStartup();

    const inReaderMode = await initReaderMode();
    if (inReaderMode) {
      return;
    }

    initTopClock();
    renderAll();
    renderBooksView();
    renderLogsView();
    setBookUploadStatus("No file uploaded yet.", "");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init().catch((err) => {
        appendLogEntry({
          level: "error",
          component: "app",
          operation: "DOMContentLoaded.init",
          message: "App init failed.",
          error: err,
        });
      });
    });
  } else {
    init().catch((err) => {
      appendLogEntry({
        level: "error",
        component: "app",
        operation: "init",
        message: "App init failed.",
        error: err,
      });
    });
  }
})();
