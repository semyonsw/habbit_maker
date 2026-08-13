"use strict";

import { ALL_WEEKDAYS, MONTH_NAMES } from "./constants.js";
import {
  state,
  globals,
  noteModalState,
  reportModalState,
} from "./state.js";
import {
  uid,
  nowIso,
  sanitize,
  formatDateKey,
  formatByteSize,
  normalizeWeekdayArray,
  normalizeMonthDayArray,
  normalizeSequenceLength,
  normalizeSequencePositions,
  parseDateKey,
} from "./utils.js?v=2";
import {
  saveState,
  getCurrentMonthData,
  getHabitEmoji,
} from "./persistence.js";
import {
  getHabitScheduleMode,
  renderHabitScheduleSelectors,
  updateHabitScheduleTypeUI,
  getCheckedValuesFromContainer,
  updateHabitOrder,
  getPossibleActiveDaysInMonth,
} from "./habits.js";
import { uploadFile, deleteFile } from "./db.js";
import { callRenderer, registerRenderer } from "./render-registry.js";
import { isMobileLayout } from "./ui-prefs.js";
import {
  lockBodyScroll,
  unlockBodyScroll,
  trapWithin,
  releaseTrap,
} from "./sheet.js";

// Ids of every currently-open dialog, innermost last.
const modalStack = [];
// Element that had focus when each dialog opened, so it can be restored.
const modalOpeners = new Map();

/* --------------------------------------------------- back closes the sheet */

// An open dialog gets its own history entry, so the Android back button (and
// the browser back button) closes it instead of leaving the view. Guarded by a
// flag so the popstate-driven close does not itself try to pop again.
let closingFromPopstate = false;

function pushModalHistory(id) {
  try {
    window.history.pushState({ modal: id }, "");
  } catch (_) {
    /* history is unavailable in some embedded contexts; dialogs still work */
  }
}

function popModalHistory(id) {
  if (closingFromPopstate) return;
  if (window.history.state && window.history.state.modal === id) {
    window.history.back();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    const topId = getTopOpenModalId();
    if (!topId) return;
    closingFromPopstate = true;
    try {
      closeModal(topId);
    } finally {
      closingFromPopstate = false;
    }
  });
}

export function getTopOpenModalId() {
  // Trust the DOM over the stack: some code paths still toggle .open directly.
  const open = Array.from(document.querySelectorAll(".modal-overlay.open"));
  if (!open.length) return null;
  for (let i = modalStack.length - 1; i >= 0; i -= 1) {
    if (open.some((el) => el.id === modalStack[i])) return modalStack[i];
  }
  return open[open.length - 1].id;
}

export function closeTopModal() {
  const id = getTopOpenModalId();
  if (id) closeModal(id);
}

// Give the dialog an accessible name without touching index.html: most .modal
// headers have an <h3> but no id to point aria-labelledby at.
function ensureDialogSemantics(overlay, id) {
  const dialog = overlay.querySelector(".modal");
  if (!dialog) return;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  if (!dialog.hasAttribute("aria-labelledby")) {
    const heading = dialog.querySelector(".modal-header h3, .modal-header h2");
    if (heading) {
      if (!heading.id) heading.id = `${id}-title`;
      dialog.setAttribute("aria-labelledby", heading.id);
    }
  }
}

export function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains("open")) return;

  modalOpeners.set(
    id,
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  modalStack.push(id);

  ensureDialogSemantics(el, id);
  el.classList.add("open");
  lockBodyScroll();
  trapWithin(el);
  pushModalHistory(id);

  requestAnimationFrame(() => {
    // Don't auto-focus a field on a phone: it summons the keyboard the instant
    // the sheet appears and hides most of what just opened.
    if (isMobileLayout()) {
      const dialog = el.querySelector(".modal");
      if (dialog) {
        dialog.setAttribute("tabindex", "-1");
        dialog.focus({ preventScroll: true });
      }
      return;
    }
    const firstInput = el.querySelector(
      ".modal-body input:not([type='hidden']):not([disabled]), .modal-body textarea:not([disabled]), .modal-body select:not([disabled])",
    );
    const firstFocusable =
      firstInput ||
      el.querySelector(
        "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      );
    if (firstFocusable instanceof HTMLElement) {
      firstFocusable.focus({ preventScroll: true });
    }
  });
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const wasOpen = el.classList.contains("open");
  el.classList.remove("open");
  el.querySelector(".modal")?.removeAttribute("aria-modal");

  const at = modalStack.lastIndexOf(id);
  if (at !== -1) modalStack.splice(at, 1);

  if (!wasOpen) return;
  unlockBodyScroll();
  releaseTrap();
  popModalHistory(id);

  // Hand focus to the next dialog down, or back to whatever opened this one.
  const nextId = getTopOpenModalId();
  if (nextId) {
    const next = document.getElementById(nextId);
    if (next) trapWithin(next);
  } else {
    const opener = modalOpeners.get(id);
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  }
  modalOpeners.delete(id);
}

export function openConfirm(title, message, callback) {
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;
  globals.confirmCallback = callback;
  openModal("confirmModal");
}

export function openHabitModal(habitId) {
  globals.editingHabitId = habitId || null;

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

  if (globals.editingHabitId) {
    const habit = state.habits.daily.find(
      (h) => h.id === globals.editingHabitId,
    );
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
    const today = new Date();
    renderHabitScheduleSelectors({
      scheduleMode: "fixed",
      activeWeekdays: [...ALL_WEEKDAYS],
      activeMonthDays: [1],
      sequenceLength: 2,
      sequenceActive: [0],
      sequenceAnchor: formatDateKey(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      ),
    });
  }

  document.getElementById("habitTypeGroup").style.display = "none";
  document.getElementById("habitScheduleTypeGroup").style.display = "block";
  document.getElementById("habitGoalGroup").style.display = "block";
  document.getElementById("habitEmojiGroup").style.display = "block";
  updateHabitScheduleTypeUI(type.value);

  openModal("habitModal");
}

export function saveHabitModal() {
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
  const sequenceLength = normalizeSequenceLength(
    document.getElementById("habitSequenceLength").value,
  );
  const sequenceActive = normalizeSequencePositions(
    getCheckedValuesFromContainer("habitSequenceActive"),
    sequenceLength,
  );
  const sequenceAnchorRaw = document.getElementById(
    "habitSequenceAnchor",
  ).value;
  if (scheduleMode === "specific_weekdays" && !activeWeekdays.length) {
    alert("Select at least one active weekday.");
    return;
  }
  if (scheduleMode === "specific_month_days" && !activeMonthDays.length) {
    alert("Select at least one active month day.");
    return;
  }
  if (scheduleMode === "custom_sequence" && !sequenceActive.length) {
    alert("Select at least one active day within the cycle.");
    return;
  }
  let sequenceAnchor = sequenceAnchorRaw;
  if (scheduleMode === "custom_sequence") {
    const parsedAnchor = parseDateKey(sequenceAnchorRaw);
    if (!parsedAnchor) {
      const today = new Date();
      sequenceAnchor = formatDateKey(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      );
    }
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
      sequenceLength,
      sequenceActive,
      sequenceAnchor,
    },
    state.currentYear,
    state.currentMonth,
  );
  if (monthGoal > possibleActiveDays) {
    alert(
      `Warning: monthly goal ${monthGoal} is higher than possible active days (${possibleActiveDays}) in ${MONTH_NAMES[state.currentMonth]}. Your goal will be saved as entered.`,
    );
  }

  if (globals.editingHabitId) {
    const habit = state.habits.daily.find(
      (h) => h.id === globals.editingHabitId,
    );
    if (habit) {
      habit.name = name;
      habit.categoryId = categoryId;
      habit.type = scheduleMode;
      habit.scheduleMode = scheduleMode;
      habit.activeWeekdays =
        scheduleMode === "specific_weekdays"
          ? activeWeekdays
          : [...ALL_WEEKDAYS];
      habit.activeMonthDays =
        scheduleMode === "specific_month_days" ? activeMonthDays : [];
      habit.excludedWeekdays =
        scheduleMode === "specific_weekdays"
          ? ALL_WEEKDAYS.filter(
              (weekday) => !habit.activeWeekdays.includes(weekday),
            )
          : [];
      habit.sequenceLength = sequenceLength;
      habit.sequenceActive =
        scheduleMode === "custom_sequence" ? sequenceActive : [];
      habit.sequenceAnchor =
        scheduleMode === "custom_sequence" ? sequenceAnchor : "";
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
        scheduleMode === "specific_weekdays" ? activeWeekdays : [...ALL_WEEKDAYS],
      activeMonthDays:
        scheduleMode === "specific_month_days" ? activeMonthDays : [],
      excludedWeekdays:
        scheduleMode === "specific_weekdays"
          ? ALL_WEEKDAYS.filter((weekday) => !activeWeekdays.includes(weekday))
          : [],
      sequenceLength,
      sequenceActive: scheduleMode === "custom_sequence" ? sequenceActive : [],
      sequenceAnchor: scheduleMode === "custom_sequence" ? sequenceAnchor : "",
      emoji,
      order: state.habits.daily.length,
    });
  }

  updateHabitOrder();
  saveState();
  closeModal("habitModal");
  callRenderer("renderAll");
}

export function openCategoryModal(catId) {
  globals.editingCategoryId = catId || null;
  const title = document.getElementById("categoryModalTitle");
  const name = document.getElementById("categoryName");
  const emoji = document.getElementById("categoryEmoji");
  const color = document.getElementById("categoryColor");

  if (globals.editingCategoryId) {
    const cat = state.categories.find(
      (c) => c.id === globals.editingCategoryId,
    );
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

export function saveCategoryModal() {
  const name = document.getElementById("categoryName").value.trim();
  if (!name) return;

  const emoji = document.getElementById("categoryEmoji").value || "⭐";
  const color = document.getElementById("categoryColor").value || "#3e85b5";

  if (globals.editingCategoryId) {
    const cat = state.categories.find(
      (c) => c.id === globals.editingCategoryId,
    );
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
  callRenderer("renderAll");
}

export function openNoteModal(habitId, day) {
  const monthData = getCurrentMonthData();
  if (!monthData.dailyNotes[habitId]) {
    monthData.dailyNotes[habitId] = {};
  }

  Object.assign(noteModalState, { habitId, day });
  const habit = state.habits.daily.find((h) => h.id === habitId);
  document.getElementById("noteModalTitle").textContent = habit
    ? `${habit.name} - ${formatDateKey(state.currentYear, state.currentMonth, day)}`
    : "Daily Note";
  document.getElementById("noteText").value =
    monthData.dailyNotes[habitId][day] || "";
  openModal("noteModal");
}

export function saveNoteModal() {
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
  Object.assign(noteModalState, { habitId: null, day: null });
  // Both surfaces show a "has note" marker, and only one of them is rendered at
  // a time depending on the layout.
  callRenderer("renderDailyHabitsGrid");
  callRenderer("renderDayFocus");
}

function buildReportAttachmentRow(name, size, onRemove) {
  const row = document.createElement("div");
  row.className = "report-attach-row";
  const label = document.createElement("span");
  label.className = "report-attach-name";
  label.textContent = `📎 ${name} · ${formatByteSize(size)}`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "manage-btn delete";
  btn.textContent = "Remove";
  btn.addEventListener("click", onRemove);
  row.appendChild(label);
  row.appendChild(btn);
  return row;
}

export function renderReportAttachmentsList() {
  const container = document.getElementById("reportAttachmentsList");
  if (!container) return;
  container.innerHTML = "";

  reportModalState.attachments.forEach((att) => {
    container.appendChild(
      buildReportAttachmentRow(att.fileName, att.fileSize, () => {
        reportModalState.removedFileIds.push(att.fileId);
        reportModalState.attachments = reportModalState.attachments.filter(
          (a) => a.fileId !== att.fileId,
        );
        renderReportAttachmentsList();
      }),
    );
  });

  reportModalState.pendingFiles.forEach((file, idx) => {
    container.appendChild(
      buildReportAttachmentRow(`${file.name} (new)`, file.size, () => {
        reportModalState.pendingFiles.splice(idx, 1);
        renderReportAttachmentsList();
      }),
    );
  });

  if (
    !reportModalState.attachments.length &&
    !reportModalState.pendingFiles.length
  ) {
    const empty = document.createElement("p");
    empty.className = "report-attach-empty";
    empty.textContent = "No attachments yet.";
    container.appendChild(empty);
  }
}

export function handleReportFileInputChange() {
  const fileInput = document.getElementById("reportAttachInput");
  if (!fileInput || !fileInput.files) return;
  Array.from(fileInput.files).forEach((file) => {
    reportModalState.pendingFiles.push(file);
  });
  fileInput.value = "";
  renderReportAttachmentsList();
}

export function openReportModal(reportId) {
  reportModalState.reportId = reportId || null;
  reportModalState.pendingFiles = [];
  reportModalState.removedFileIds = [];

  const titleEl = document.getElementById("reportModalTitle");
  const titleInput = document.getElementById("reportTitle");
  const noteInput = document.getElementById("reportNote");
  const habitSelect = document.getElementById("reportHabit");
  const fileInput = document.getElementById("reportAttachInput");
  if (fileInput) fileInput.value = "";

  habitSelect.innerHTML =
    "<option value=''>None</option>" +
    state.habits.daily
      .map(
        (h) =>
          `<option value='${h.id}'>${sanitize(getHabitEmoji(h))} ${sanitize(h.name)}</option>`,
      )
      .join("");

  if (reportModalState.reportId) {
    const report = (state.reports || []).find(
      (r) => r.id === reportModalState.reportId,
    );
    if (!report) return;
    titleEl.textContent = "Edit Report";
    titleInput.value = report.title || "";
    noteInput.value = report.note || "";
    habitSelect.value = report.habitId || "";
    reportModalState.attachments = (report.attachments || []).map((a) => ({
      ...a,
    }));
  } else {
    titleEl.textContent = "New Report";
    titleInput.value = "";
    noteInput.value = "";
    habitSelect.value = "";
    reportModalState.attachments = [];
  }

  renderReportAttachmentsList();
  openModal("reportModal");
}

export async function saveReportModal() {
  const title = document.getElementById("reportTitle").value.trim();
  const note = document.getElementById("reportNote").value.trim();
  const habitId = document.getElementById("reportHabit").value || "";

  if (
    !title &&
    !note &&
    !reportModalState.attachments.length &&
    !reportModalState.pendingFiles.length
  ) {
    alert("Add a title, a note, or an attachment before saving.");
    return;
  }

  const saveBtn = document.getElementById("reportModalSave");
  if (saveBtn) saveBtn.disabled = true;
  const uploaded = [];
  try {
    // Upload newly-added files to the blob store.
    for (const file of reportModalState.pendingFiles) {
      const fileId = uid("file");
      await uploadFile(fileId, file);
      uploaded.push({
        fileId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "",
      });
    }

    // Remove attachments the user detached (existing report only).
    for (const fileId of reportModalState.removedFileIds) {
      try {
        await deleteFile(fileId);
      } catch (_) {}
    }

    const attachments = [...reportModalState.attachments, ...uploaded];
    const now = nowIso();

    if (reportModalState.reportId) {
      const report = (state.reports || []).find(
        (r) => r.id === reportModalState.reportId,
      );
      if (report) {
        report.title = title;
        report.note = note;
        report.habitId = habitId;
        report.attachments = attachments;
        report.updatedAt = now;
      }
    } else {
      if (!Array.isArray(state.reports)) state.reports = [];
      state.reports.push({
        id: uid("report"),
        title,
        note,
        habitId,
        attachments,
        createdAt: now,
        updatedAt: now,
      });
    }

    saveState();
    closeModal("reportModal");
    reportModalState.reportId = null;
    reportModalState.attachments = [];
    reportModalState.pendingFiles = [];
    reportModalState.removedFileIds = [];
    callRenderer("renderReportView");
  } catch (_) {
    // Roll back any blobs uploaded before the failure so they don't orphan.
    for (const att of uploaded) {
      try {
        await deleteFile(att.fileId);
      } catch (_e) {}
    }
    alert("Saving the report failed. Please try again.");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

export function deleteReport(reportId) {
  const report = (state.reports || []).find((r) => r.id === reportId);
  if (!report) return;
  openConfirm(
    "Delete Report",
    `Delete "${report.title || "this report"}"?`,
    async () => {
      state.reports = (state.reports || []).filter((r) => r.id !== reportId);
      saveState();
      for (const att of report.attachments || []) {
        try {
          await deleteFile(att.fileId);
        } catch (_) {}
      }
      callRenderer("renderReportView");
    },
  );
}

export function saveMonthlyReview() {
  const monthData = getCurrentMonthData();
  monthData.monthlyReview = {
    wins: document.getElementById("monthlyWins").value.trim(),
    blockers: document.getElementById("monthlyBlockers").value.trim(),
    focus: document.getElementById("monthlyFocus").value.trim(),
  };
  saveState();
}

export function renderMonthlyReview() {
  const review = getCurrentMonthData().monthlyReview;
  document.getElementById("monthlyWins").value = review.wins || "";
  document.getElementById("monthlyBlockers").value = review.blockers || "";
  document.getElementById("monthlyFocus").value = review.focus || "";
}

registerRenderer("openConfirm", openConfirm);
registerRenderer("renderMonthlyReview", renderMonthlyReview);
registerRenderer("openNoteModal", openNoteModal);
