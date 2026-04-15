"use strict";

// Entry point — imports everything and wires the app together

import { STORAGE_KEY } from "./constants.js";
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

async function init() {
  // Auto-restore backup if localStorage is empty or has no real data
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    const parsed = existing ? JSON.parse(existing) : null;
    const hasHabits =
      parsed &&
      parsed.habits &&
      Array.isArray(parsed.habits.daily) &&
      parsed.habits.daily.length > 0;
    if (!hasHabits) {
      const resp = await fetch("habit-tracker-backup-2026-03.json");
      if (resp.ok) {
        const data = await resp.json();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log("Backup restored from habit-tracker-backup-2026-03.json");
      }
    }
  } catch (_) {
    /* no backup file available, start fresh */
  }

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
