"use strict";

// Entry point — imports everything and wires the app together

import { loadLogs, appendLogEntry } from "./logging.js";
import { loadSecureSettings, maybeMigrateLegacyApiKey, tryUnlockOnStartup, applyBookSummarySettingsToInputs } from "./encryption.js";
import { loadState, saveState } from "./persistence.js";
import { loadAnalyticsPreferences } from "./preferences.js";
import { initSidebarCollapse, initTopClock } from "./layout.js";
import { bindEvents } from "./events.js";
import { initReaderMode } from "./pdf-reader.js";
import { setBookUploadStatus } from "./books.js";
import { callRenderer } from "./render-registry.js";
import {
  deleteHabit,
  deleteCategory,
  moveDailyHabit,
} from "./habits.js";
import {
  setActiveBook,
  openBookmarkInNewTab,
} from "./books.js";
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
