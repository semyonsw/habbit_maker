"use strict";

// Entry point — imports everything and wires the app together

import {
  STORAGE_KEY,
  SECURE_SETTINGS_KEY,
  LOGS_STORAGE_KEY,
  SIDEBAR_COLLAPSE_KEY,
  READER_DARK_ENABLED_KEY,
  READER_DARK_MODE_KEY,
  ANALYTICS_DISPLAY_MODE_KEY,
  PDF_DB_NAME,
  PDF_DB_VERSION,
  PDF_STORE_NAME,
} from "./constants.js";
import { loadLogs, appendLogEntry } from "./logging.js";
import {
  loadSecureSettings,
  maybeMigrateLegacyApiKey,
  tryUnlockOnStartup,
  applyBookSummarySettingsToInputs,
} from "./encryption.js";
import { loadState } from "./persistence.js";
import { loadAnalyticsPreferences } from "./preferences.js";
import { initSidebarCollapse, initTopClock } from "./layout.js";
import { bindEvents } from "./events.js";
import { initReaderMode } from "./pdf-reader.js";
import { setBookUploadStatus } from "./books.js";
import { callRenderer } from "./render-registry.js";
import { deleteHabit, deleteCategory, moveDailyHabit } from "./habits.js";
import { setActiveBook, openBookmarkInNewTab } from "./books.js";
import {
  openHabitModal,
  openCategoryModal,
  openBookModal,
  openBookmarkModal,
  openHistoryEventModal,
  deleteBook,
  deleteBookmark,
  deleteHistoryEvent,
} from "./modals.js";
import {
  summarizeBookmark,
  viewBookmarkSummary,
  selectSummaryForModal,
} from "./ai-summary.js";
import * as db from "./db.js";

// Import render modules so they register themselves
import "./render-dashboard.js";
import "./render-analytics.js";
import "./render-books.js";
import "./render-logs.js";

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

// ---- Legacy bundle collection (one-shot, runs only on first launch) ------

function readJsonFromLocalStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function readStringFromLocalStorage(key) {
  return localStorage.getItem(key);
}

function readAllPdfBlobsFromIndexedDB() {
  return new Promise((resolve) => {
    const result = [];
    if (typeof indexedDB === "undefined") {
      resolve(result);
      return;
    }
    let openReq;
    try {
      openReq = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);
    } catch (_) {
      resolve(result);
      return;
    }
    openReq.onerror = () => resolve(result);
    openReq.onupgradeneeded = () => {
      // No store -> empty database, nothing to migrate.
    };
    openReq.onsuccess = () => {
      const idb = openReq.result;
      if (!idb.objectStoreNames.contains(PDF_STORE_NAME)) {
        idb.close();
        resolve(result);
        return;
      }
      const tx = idb.transaction(PDF_STORE_NAME, "readonly");
      const store = tx.objectStore(PDF_STORE_NAME);
      const req = store.openCursor();
      req.onerror = () => {
        idb.close();
        resolve(result);
      };
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          idb.close();
          resolve(result);
          return;
        }
        const value = cursor.value;
        if (value && typeof value.fileId === "string" && value.blob) {
          result.push({ fileId: value.fileId, blob: value.blob });
        }
        cursor.continue();
      };
    };
  });
}

function collectLegacyPrefsBundle() {
  const out = {};
  const sidebar = readStringFromLocalStorage(SIDEBAR_COLLAPSE_KEY);
  if (sidebar !== null) out.sidebarCollapsed = sidebar === "1";
  const dark = readStringFromLocalStorage(READER_DARK_ENABLED_KEY);
  if (dark !== null) out.readerDarkEnabled = dark === "1";
  const darkMode = readStringFromLocalStorage(READER_DARK_MODE_KEY);
  if (darkMode !== null) out.readerDarkMode = darkMode;
  const analytics = readStringFromLocalStorage(ANALYTICS_DISPLAY_MODE_KEY);
  if (analytics !== null) out.analyticsDisplayMode = analytics;
  const zoom = readStringFromLocalStorage("readerZoomLevel");
  if (zoom !== null) {
    const n = parseFloat(zoom);
    if (!isNaN(n)) out.readerZoomLevel = n;
  }
  return out;
}

async function buildLegacyBundleFromBrowser() {
  const state = readJsonFromLocalStorage(STORAGE_KEY);
  const secureSettings = readJsonFromLocalStorage(SECURE_SETTINGS_KEY);
  const logs = readJsonFromLocalStorage(LOGS_STORAGE_KEY);
  const prefs = collectLegacyPrefsBundle();
  const pdfs = await readAllPdfBlobsFromIndexedDB();
  const isEmpty =
    !state &&
    !secureSettings &&
    !logs &&
    Object.keys(prefs).length === 0 &&
    pdfs.length === 0;
  return { state, secureSettings, logs, prefs, pdfs, isEmpty };
}

async function tryFetchBackupBundle() {
  try {
    const resp = await fetch("habit-tracker-backup-2026-03.json");
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && typeof data === "object" ? data : null;
  } catch (_) {
    return null;
  }
}

async function runLegacyMigration() {
  let bundle = await buildLegacyBundleFromBrowser();

  if (bundle.isEmpty) {
    const backup = await tryFetchBackupBundle();
    if (backup) {
      // The auto-restore JSON has the same shape as `state` and may carry
      // base64-encoded PDFs under `pdfBlobs`.
      const pdfBlobsRaw =
        backup && typeof backup === "object" && backup.pdfBlobs
          ? backup.pdfBlobs
          : null;
      if (pdfBlobsRaw && typeof pdfBlobsRaw === "object") {
        delete backup.pdfBlobs;
      }
      bundle = {
        state: backup,
        secureSettings: null,
        logs: null,
        prefs: {},
        pdfs: [],
        backupBlobsBase64: pdfBlobsRaw,
        isEmpty: false,
      };
    }
  }

  if (bundle.isEmpty) {
    return { migrated: false };
  }

  const payload = {
    state: bundle.state,
    secureSettings: bundle.secureSettings,
    logs: bundle.logs,
    prefs: bundle.prefs,
  };
  await db.importLegacy(payload);

  // Upload PDFs (separate POSTs so JSON bundle stays small).
  for (const { fileId, blob } of bundle.pdfs) {
    try {
      await db.uploadPdf(fileId, blob);
    } catch (err) {
      appendLogEntry({
        level: "warn",
        component: "migration",
        operation: "uploadPdf",
        message: "Failed to migrate PDF blob from IndexedDB.",
        error: err,
        context: { fileId },
      });
    }
  }

  // If the auto-restore JSON carried base64-encoded PDFs, decode and upload.
  if (bundle.backupBlobsBase64) {
    for (const [fileId, encoded] of Object.entries(
      bundle.backupBlobsBase64,
    )) {
      if (typeof encoded !== "string" || !encoded.trim()) continue;
      try {
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        await db.uploadPdf(fileId, blob);
      } catch (err) {
        appendLogEntry({
          level: "warn",
          component: "migration",
          operation: "uploadPdf",
          message: "Failed to migrate base64 PDF from backup file.",
          error: err,
          context: { fileId },
        });
      }
    }
  }

  return { migrated: true };
}

// -------------------------------------------------------------------------

async function init() {
  let status = null;
  try {
    status = await db.getMigrationStatus();
  } catch (err) {
    appendLogEntry({
      level: "error",
      component: "app",
      operation: "init",
      message:
        "Backend unreachable. Start the local server (start.bat) before opening this page.",
      error: err,
    });
    alert(
      "The Habit Tracker backend is not reachable. Please run start.bat first, then refresh this page.",
    );
    return;
  }

  if (!status.legacy_imported) {
    try {
      await runLegacyMigration();
    } catch (err) {
      appendLogEntry({
        level: "error",
        component: "app",
        operation: "runLegacyMigration",
        message: "Legacy migration failed; continuing with default state.",
        error: err,
      });
    }
  }

  await loadLogs();
  await loadSecureSettings();
  await loadState();
  await loadAnalyticsPreferences();
  bindEvents();
  await initSidebarCollapse();
  applyBookSummarySettingsToInputs();
  await maybeMigrateLegacyApiKey();
  await tryUnlockOnStartup();

  const inReaderMode = await initReaderMode();
  if (inReaderMode) {
    return;
  }

  initTopClock();
  callRenderer("renderAll");
  callRenderer("renderBooksView");
  callRenderer("renderLogsView");
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
