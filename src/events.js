"use strict";

import { MONTH_NAMES } from "./constants.js";
import { state, globals, readerHistoryPickerState } from "./state.js";
import { monthKey } from "./utils.js?v=2";
import { navigateMonth } from "./habits.js";
import {
  openHabitModal,
  saveHabitModal,
  openCategoryModal,
  saveCategoryModal,
  saveNoteModal,
  openReportModal,
  saveReportModal,
  handleReportFileInputChange,
  openBookModal,
  saveBookModal,
  openBookmarkModal,
  saveBookmark,
  saveHistoryEventModal,
  openModal,
  closeModal,
  closeTopModal,
  openConfirm,
  saveMonthlyReview,
} from "./modals.js";
import { navigateTo } from "./router.js";
import { setSidebarCollapsed, applySidebarCollapseState } from "./layout.js";
import {
  handleBookFileInputChange,
  saveBookFromUpload,
  setBookUploadStatus,
} from "./books.js";
import { exportData, importData, setBackupStatus } from "./data-io.js";
import { bindLogsControls } from "./render-logs.js";
import { bindSummaryModelPicker } from "./model-picker.js";
import {
  saveBookSummarySettingsFromInputs,
  unlockStoredApiKeyInteractive,
  wipeStoredApiKey,
} from "./encryption.js";
import {
  updateHabitScheduleTypeUI,
  renderSequenceCheckboxes,
  getCheckedValuesFromContainer,
} from "./habits.js";
import { setAnalyticsDisplayMode } from "./preferences.js";
import {
  getDefaultMonthData,
  saveState,
  getDefaultState,
} from "./persistence.js";
import { callRenderer } from "./render-registry.js";
import {
  closeSummaryModal,
  regenerateLatestSummarySegment,
  rebuildFullSummary,
  copySelectedSummaryToClipboard,
} from "./ai-summary.js";
import { appendLogEntry } from "./logging.js";
import {
  openFeedbackPanel,
  bindFeedbackForm,
  submitFeedbackToGithub,
  submitFeedbackToMail,
  saveEmailJsConfigFromInputs,
  sendFromPreview,
  previewBackToForm,
  retryAiPolish,
  sendRawWithoutAi,
  errorBackToForm,
  handleFeedbackImageInputChange,
} from "./feedback.js";
import {
  bindUiAppearanceControls,
  syncUiAppearanceControls,
} from "./ui-prefs.js";

export function bindEvents() {
  // Nav entries either route to a view (through the hash, so the back button
  // works) or open a sheet. switchView stays a pure effect of the router.
  document.querySelectorAll(".nav-tab, .bottom-nav-btn").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.sheet) {
        openModal(`${tab.dataset.sheet}Sheet`);
        return;
      }
      if (tab.dataset.view) navigateTo(tab.dataset.view);
    });
  });

  bindMoreSheet();

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
    .getElementById("habitSequenceLength")
    .addEventListener("input", (event) => {
      // Preserve any positions still valid for the new cycle length.
      const current = getCheckedValuesFromContainer("habitSequenceActive");
      renderSequenceCheckboxes(event.target.value, current);
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
    .getElementById("btnAddReport")
    .addEventListener("click", () => openReportModal());
  document
    .getElementById("reportModalClose")
    .addEventListener("click", () => closeModal("reportModal"));
  document
    .getElementById("reportModalCancel")
    .addEventListener("click", () => closeModal("reportModal"));
  document
    .getElementById("reportModalSave")
    .addEventListener("click", saveReportModal);
  document
    .getElementById("reportAttachInput")
    .addEventListener("change", handleReportFileInputChange);

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
    const confirmButton = document.getElementById("confirmOk");
    confirmButton.disabled = true;
    confirmButton.classList.add("is-loading");
    const callback = globals.confirmCallback;
    closeModal("confirmModal");
    Promise.resolve(typeof callback === "function" ? callback() : null)
      .catch((error) => {
        appendLogEntry({
          level: "error",
          component: "confirm-modal",
          operation: "confirmOk.click",
          message: "Confirmation callback failed.",
          error,
        });
      })
      .finally(() => {
        globals.confirmCallback = null;
        confirmButton.disabled = false;
        confirmButton.classList.remove("is-loading");
      });
  });

  document
    .getElementById("readerHistoryPickerClose")
    .addEventListener("click", () => closeModal("readerHistoryPickerModal"));
  document
    .getElementById("readerHistoryPickerCancel")
    .addEventListener("click", () => closeModal("readerHistoryPickerModal"));
  document
    .getElementById("readerHistoryPickerCreateNew")
    .addEventListener("click", () => {
      const { bookId, page } = readerHistoryPickerState;
      closeModal("readerHistoryPickerModal");
      if (bookId) {
        openBookmarkModal(bookId, null, { prefillPdfPage: page });
      }
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
  document.getElementById("importFile").addEventListener("change", function () {
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

  document.getElementById("mobileMenuToggle").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("open");
  });

  document.getElementById("mobileMenuClose").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.remove("open");
  });

  document
    .getElementById("sidebarCollapseToggle")
    .addEventListener("click", () => {
      setSidebarCollapsed(!globals.sidebarCollapsed);
    });

  const settingsBtn = document.getElementById("btnOpenSettings");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      syncUiAppearanceControls();
      openFeedbackPanel();
    });
  }
  const settingsClose = document.getElementById("settingsModalClose");
  if (settingsClose) {
    settingsClose.addEventListener("click", () => closeModal("settingsModal"));
  }
  const settingsCancel = document.getElementById("settingsModalCancel");
  if (settingsCancel) {
    settingsCancel.addEventListener("click", () =>
      closeModal("settingsModal"),
    );
  }
  const feedbackGithubBtn = document.getElementById("feedbackSubmitGithub");
  if (feedbackGithubBtn) {
    feedbackGithubBtn.addEventListener("click", submitFeedbackToGithub);
  }
  const feedbackMailtoBtn = document.getElementById("feedbackSubmitMailto");
  if (feedbackMailtoBtn) {
    feedbackMailtoBtn.addEventListener("click", submitFeedbackToMail);
  }
  const emailjsSaveBtn = document.getElementById("emailjsSave");
  if (emailjsSaveBtn) {
    emailjsSaveBtn.addEventListener("click", saveEmailJsConfigFromInputs);
  }
  const feedbackImageInput = document.getElementById("feedbackImageInput");
  if (feedbackImageInput) {
    feedbackImageInput.addEventListener("change", handleFeedbackImageInputChange);
  }
  const previewSendBtn = document.getElementById("feedbackPreviewSend");
  if (previewSendBtn) {
    previewSendBtn.addEventListener("click", sendFromPreview);
  }
  const previewBackBtn = document.getElementById("feedbackPreviewBack");
  if (previewBackBtn) {
    previewBackBtn.addEventListener("click", previewBackToForm);
  }
  const errorRetryBtn = document.getElementById("feedbackErrorRetry");
  if (errorRetryBtn) {
    errorRetryBtn.addEventListener("click", retryAiPolish);
  }
  const errorSendRawBtn = document.getElementById("feedbackErrorSendRaw");
  if (errorSendRawBtn) {
    errorSendRawBtn.addEventListener("click", sendRawWithoutAi);
  }
  const errorCancelBtn = document.getElementById("feedbackErrorCancel");
  if (errorCancelBtn) {
    errorCancelBtn.addEventListener("click", errorBackToForm);
  }
  bindFeedbackForm();
  bindUiAppearanceControls();

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

  // Backdrop click and Escape both mean "cancel". They used to strip the .open
  // class directly, which skipped closeModal() and therefore the scroll lock,
  // the focus trap and focus restoration.
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTopModal();
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

// The mobile bottom nav only has room for five entries, so Manage, Logs,
// Settings, Export and Import live behind "More". Every action here just
// forwards to the control that already exists in the sidebar, so there is one
// implementation per action rather than two.
// Close the sheet, THEN run the action -- and wait for the history traversal
// to land first. closeModal() pops the dialog's own history entry with
// history.back(), which is asynchronous: doing `closeModal(); navigateTo(x)`
// synchronously lets the back undo the hash that navigateTo just set, so the
// sheet closed and nothing navigated.
function closeMoreSheetThen(action) {
  const needsPop =
    window.history.state && window.history.state.modal === "moreSheet";
  if (needsPop) {
    window.addEventListener("popstate", () => action(), { once: true });
    closeModal("moreSheet");
    return;
  }
  closeModal("moreSheet");
  action();
}

function bindMoreSheet() {
  const sheet = document.getElementById("moreSheet");
  if (!sheet) return;

  const close = document.getElementById("moreSheetClose");
  if (close) close.addEventListener("click", () => closeModal("moreSheet"));

  sheet.querySelectorAll("[data-more-view]").forEach((btn) => {
    btn.addEventListener("click", () =>
      closeMoreSheetThen(() => navigateTo(btn.dataset.moreView)),
    );
  });

  const settings = document.getElementById("moreSheetSettings");
  if (settings) {
    settings.addEventListener("click", () =>
      closeMoreSheetThen(() =>
        document.getElementById("btnOpenSettings")?.click(),
      ),
    );
  }

  const exportBtn = document.getElementById("moreSheetExport");
  if (exportBtn) {
    exportBtn.addEventListener("click", () =>
      closeMoreSheetThen(() => document.getElementById("btnExport")?.click()),
    );
  }

  const importBtn = document.getElementById("moreSheetImport");
  if (importBtn) {
    importBtn.addEventListener("click", () =>
      closeMoreSheetThen(() => document.getElementById("btnImport")?.click()),
    );
  }
}
