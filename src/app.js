"use strict";

// Entry point — imports everything and wires the app together

import {
  STORAGE_KEY,
  LOGS_STORAGE_KEY,
  SIDEBAR_COLLAPSE_KEY,
  ANALYTICS_DISPLAY_MODE_KEY,
} from "./constants.js";
import { loadLogs, appendLogEntry } from "./logging.js";
import { loadState } from "./persistence.js";
import { initUiPrefs } from "./ui-prefs.js";
import { bindEvents } from "./events.js";
import { callRenderer } from "./render-registry.js";
import {
  setGlobalLoaderMessage,
  hideGlobalLoader,
  waitForNextPaint,
} from "./loading-ui.js";
import * as db from "./db.js";

import { bindSheetGestures, initKeyboardInset } from "./sheet.js";
import { closeTopOverlay } from "./modals.js";
import { hideNativeSplash } from "./native.js";
import { initNotifications } from "./notifications.js";
import { initRouter } from "./router.js";

// Import render modules so they register themselves
import "./render-shell.js";
import "./render-today.js";
import "./render-detail.js";
import "./render-analytics.js";
import "./render-settings.js";
import "./notifications.js";

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

function collectLegacyPrefsBundle() {
  const out = {};
  const sidebar = readStringFromLocalStorage(SIDEBAR_COLLAPSE_KEY);
  if (sidebar !== null) out.sidebarCollapsed = sidebar === "1";
  const analytics = readStringFromLocalStorage(ANALYTICS_DISPLAY_MODE_KEY);
  if (analytics !== null) out.analyticsDisplayMode = analytics;
  return out;
}

async function buildLegacyBundleFromBrowser() {
  const state = readJsonFromLocalStorage(STORAGE_KEY);
  const logs = readJsonFromLocalStorage(LOGS_STORAGE_KEY);
  const prefs = collectLegacyPrefsBundle();
  const isEmpty = !state && !logs && Object.keys(prefs).length === 0;
  return { state, logs, prefs, isEmpty };
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
      // The auto-restore JSON has the same shape as `state`.
      bundle = {
        state: backup,
        logs: null,
        prefs: {},
        isEmpty: false,
      };
    }
  }

  if (bundle.isEmpty) {
    return { migrated: false };
  }

  const payload = {
    state: bundle.state,
    logs: bundle.logs,
    prefs: bundle.prefs,
  };
  await db.importLegacy(payload);

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
    await loadState();
    await initUiPrefs();
    bindEvents();
    // Bottom-sheet mechanics: drag-to-dismiss and on-screen-keyboard tracking.
    // Delegated/global, so they only need binding once.
    bindSheetGestures(() => closeTopOverlay());
    initKeyboardInset();

    setGlobalLoaderMessage("Loading habits...");
    await waitForNextPaint();
    callRenderer("renderAll");

    // After the first render, so a deep-linked view has something to switch to.
    initRouter();

    // Reminders. Deliberately after the first paint and never awaited: on
    // native this is a bridge round-trip, and a slow or missing plugin must not
    // hold the splash up. It also must not run before loadState(), because the
    // schedule is built from the habits.
    initNotifications().catch((err) => {
      appendLogEntry({
        level: "error",
        component: "app",
        operation: "initNotifications",
        message: "Could not initialise reminders.",
        error: err,
      });
    });

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
