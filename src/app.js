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
import { loadAnalyticsPreferences, loadBookOpenMode } from "./preferences.js";
import { initSidebarCollapse, initTopClock } from "./layout.js";
import { initUiPrefs } from "./ui-prefs.js";
import { bindEvents } from "./events.js";
import { initReaderMode } from "./pdf-reader.js";
import { setBookUploadStatus } from "./books.js";
import { callRenderer } from "./render-registry.js";
import { deleteHabit, deleteCategory, moveDailyHabit } from "./habits.js";
import {
  setActiveBook,
  openBookmarkTarget,
  chooseBookFile,
} from "./books.js";
import {
  openHabitModal,
  openCategoryModal,
  openBookModal,
  openBookmarkModal,
  openHistoryEventModal,
  openReportModal,
  deleteReport,
  deleteBook,
  deleteBookmark,
  deleteHistoryEvent,
} from "./modals.js";
import { openReportAttachment } from "./render-report.js";
import {
  summarizeBookmark,
  viewBookmarkSummary,
  selectSummaryForModal,
} from "./ai-summary.js";
import {
  setGlobalLoaderMessage,
  hideGlobalLoader,
  waitForNextPaint,
} from "./loading-ui.js";
import * as db from "./db.js";

import { bindSheetGestures, initKeyboardInset } from "./sheet.js";
import { closeModal } from "./modals.js";
import { hideNativeSplash } from "./native.js";
import { initRouter } from "./router.js";

// Import render modules so they register themselves
import "./render-dashboard.js";
import "./render-day-focus.js";
import "./render-analytics.js";
import "./render-books.js";
import "./render-logs.js";
import "./render-report.js";

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
    openBookmarkTarget(bookId, page, bookmarkId);
  },
  chooseBookFile,
  // "Read" on a book card: no bookmark involved, so start at page 1 and go
  // through the same in-app / phone-PDF-app choice as a bookmark.
  readBook(bookId) {
    openBookmarkTarget(bookId, 1, null);
  },
  summarizeBookmark,
  viewBookmarkSummary,
  selectSummary(bookId, bookmarkId, summaryId) {
    selectSummaryForModal(bookId, bookmarkId, summaryId);
  },
  editReport(reportId) {
    openReportModal(reportId);
  },
  deleteReport,
  openReportAttachment,
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
    for (const [fileId, encoded] of Object.entries(bundle.backupBlobsBase64)) {
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

// Best-effort request for durable (non-evictable) storage. Fire-and-forget:
// never blocks boot and never throws into the caller.
function requestPersistentStorage() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === "function") {
      navigator.storage
        .persisted()
        .then((already) => {
          if (!already) navigator.storage.persist().catch(() => {});
        })
        .catch(() => {});
    }
  } catch (_) {
    /* storage manager unavailable; ignore */
  }
}

async function init() {
  const appRoot = document.getElementById("app");
  try {
    setGlobalLoaderMessage("Loading...");

    // On the phone/PWA build we persist in on-device IndexedDB; ask the browser
    // to keep it from being evicted. The PC (server) build doesn't need this.
    if (db.getBackendMode() === "idb") {
      requestPersistentStorage();
    }

    let status = null;
    try {
      status = await db.getMigrationStatus();
    } catch (err) {
      appendLogEntry({
        level: "error",
        component: "app",
        operation: "init",
        message: "Could not read migration status.",
        error: err,
      });
      if (db.getBackendMode() === "rest") {
        // PC build: the local Python server is expected but not reachable.
        if (appRoot) appRoot.style.display = "";
        hideGlobalLoader();
        alert(
          "The Habit Tracker backend is not reachable. Please run start.bat first, then refresh this page.",
        );
        return;
      }
      // Phone/PWA build: on-device storage unavailable -> carry on with defaults.
      status = { legacy_imported: true, schemaVersion: 1 };
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
    await loadBookOpenMode();
    await initUiPrefs();
    bindEvents();
    // Bottom-sheet mechanics: drag-to-dismiss and on-screen-keyboard tracking.
    // Delegated/global, so they only need binding once.
    bindSheetGestures((id) => closeModal(id));
    initKeyboardInset();
    await initSidebarCollapse();
    applyBookSummarySettingsToInputs();

    const inReaderMode = await initReaderMode();
    if (inReaderMode) {
      return;
    }

    await maybeMigrateLegacyApiKey();
    await tryUnlockOnStartup();

    initTopClock();

    setGlobalLoaderMessage("Loading Dashboard...");
    await waitForNextPaint();
    callRenderer("renderAll");
    callRenderer("renderBooksView");
    callRenderer("renderLogsView");
    setBookUploadStatus("No file uploaded yet.", "");

    // After the reader early-return above (reader mode is a ?reader=1 query, so
    // the hash is free) and after the first render, so switching to a
    // deep-linked view has something to switch to.
    initRouter();

    if (appRoot) appRoot.style.display = "";
    await waitForNextPaint();
  } finally {
    hideGlobalLoader();
  }
}

// .finally, not .then: on Android the native splash covers the WebView until
// something hides it, so a failed init must still uncover the UI -- otherwise a
// boot error is indistinguishable from a hung app. No-op on the web.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    init()
      .catch((err) => {
        appendLogEntry({
          level: "error",
          component: "app",
          operation: "DOMContentLoaded.init",
          message: "App init failed.",
          error: err,
        });
      })
      .finally(hideNativeSplash);
  });
} else {
  init()
    .catch((err) => {
      appendLogEntry({
        level: "error",
        component: "app",
        operation: "init",
        message: "App init failed.",
        error: err,
      });
    })
    .finally(hideNativeSplash);
}
