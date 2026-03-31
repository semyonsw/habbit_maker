"use strict";

import { globals } from "./state.js";
import { monthKey, nowIso } from "./utils.js";
import { navigateMonth, moveDailyHabit } from "./habits.js";
import {
  openHabitModal,
  saveHabitModal,
  openCategoryModal,
  saveCategoryModal,
  openNoteModal,
  saveNoteModal,
  openBookModal,
  saveBookModal,
  openBookmarkModal,
  saveBookmark,
  openHistoryEventModal,
  saveHistoryEventModal,
  openModal,
  closeModal,
  openConfirm,
  saveMonthlyReview,
} from "./modals.js";
import { setSidebarCollapsed, isDesktopViewport, applySidebarCollapseState } from "./layout.js";
import {
  handleBookFileInputChange,
  saveBookFromUpload,
  setBookUploadStatus,
  getOrInitBooksHelperState,
  getSelectedFinisherBook,
  getBookMaxBookmarkPage,
} from "./books.js";
import { exportData, importData, setBackupStatus } from "./data-io.js";
import { bindLogsControls } from "./render-logs.js";
import { bindSummaryModelPicker, setSummaryModelValue, closeSummaryModelDropdown } from "./model-picker.js";
import { saveBookSummarySettingsFromInputs, applyBookSummarySettingsToInputs, unlockStoredApiKeyInteractive, wipeStoredApiKey } from "./encryption.js";
import { updateHabitScheduleTypeUI, renderHabitScheduleSelectors } from "./habits.js";
import { setBooksAnalyticsRange, setAnalyticsDisplayMode } from "./preferences.js";
import { getDefaultMonthData, saveState, getDefaultState } from "./persistence.js";
import { callRenderer } from "./render-registry.js";
import {
  closeSummaryModal,
  regenerateLatestSummarySegment,
  rebuildFullSummary,
  copySelectedSummaryToClipboard,
} from "./ai-summary.js";
import { appendLogEntry } from "./logging.js";

export function bindEvents() {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => callRenderer("switchView", tab.dataset.view));
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
    if (globals.confirmCallback) globals.confirmCallback();
    globals.confirmCallback = null;
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
        callRenderer("renderAll");
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
        callRenderer("renderAll");
        callRenderer("renderBooksView");
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
      setSidebarCollapsed(!globals.sidebarCollapsed);
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
      await callRenderer("renderBookFinisherHelper");
    });
  }

  const finisherTargetDate = document.getElementById("finisherTargetDate");
  if (finisherTargetDate) {
    finisherTargetDate.addEventListener("change", async (event) => {
      const helper = getOrInitBooksHelperState();
      helper.targetDate = String(event.target.value || "");
      saveState();
      await callRenderer("renderBookFinisherHelper");
    });
  }

  const finisherStartPage = document.getElementById("finisherStartPage");
  if (finisherStartPage) {
    finisherStartPage.addEventListener("change", async (event) => {
      const helper = getOrInitBooksHelperState();
      const next = parseInt(event.target.value, 10);
      helper.startPage = Number.isFinite(next) && next >= 1 ? next : 1;
      saveState();
      await callRenderer("renderBookFinisherHelper");
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
      await callRenderer("renderBookFinisherHelper");
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
      await callRenderer("renderBookFinisherHelper");
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
      await callRenderer("renderBookFinisherHelper");
    });
  });

  const finisherRecalculateBtn = document.getElementById(
    "finisherRecalculateBtn",
  );
  if (finisherRecalculateBtn) {
    finisherRecalculateBtn.addEventListener("click", async () => {
      await callRenderer("renderBookFinisherHelper");
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
