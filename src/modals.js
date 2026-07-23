"use strict";

import { ALL_WEEKDAYS, MONTH_NAMES } from "./constants.js";
import {
  state,
  globals,
  noteModalState,
  reportModalState,
  bookModalState,
  bookmarkModalState,
  historyEventModalState,
  readerHistoryPickerState,
} from "./state.js";
import {
  uid,
  nowIso,
  sanitize,
  formatDateKey,
  formatIsoForDisplay,
  formatRealBookPage,
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
import {
  getBookById,
  addBookmarkHistoryEvent,
  addReaderHistoryToBookmark,
  refreshBookBlobStatus,
  clearBookCoverPreview,
} from "./books.js";
import { idbDeletePdfBlob } from "./idb.js";
import { uploadFile, deleteFile } from "./db.js";
import { callRenderer, registerRenderer } from "./render-registry.js";

export function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("open");
  requestAnimationFrame(() => {
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
  el.classList.remove("open");
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
  callRenderer("renderDailyHabitsGrid");
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
  try {
    // Upload newly-added files to the blob store.
    const uploaded = [];
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

export function openBookModal(bookId) {
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

export function saveBookModal() {
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
      createdAt: nowIso(),
      updatedAt: nowIso(),
      bookmarks: [],
    });
  }

  saveState();
  closeModal("bookModal");
  callRenderer("renderBooksView");
}

export async function deleteBook(bookId) {
  const book = getBookById(bookId);
  if (!book) return;

  openConfirm(
    "Delete Book",
    `Delete \"${book.title}\" and all its bookmarks?`,
    async () => {
      clearBookCoverPreview(bookId);
      state.books.items = state.books.items.filter((b) => b.bookId !== bookId);
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
      callRenderer("renderBooksView");
    },
  );
}

export function openBookmarkModal(bookId, bookmarkId, options = {}) {
  const book = getBookById(bookId);
  if (!book) {
    alert("Please select a book first.");
    return;
  }

  Object.assign(bookmarkModalState, {
    editingBookId: bookId,
    editingBookmarkId: bookmarkId || null,
  });

  const title = document.getElementById("bookmarkModalTitle");
  const labelInput = document.getElementById("bookmarkLabel");
  const pdfPageInput = document.getElementById("bookmarkPdfPage");
  const realPageInput = document.getElementById("bookmarkRealPage");
  const noteInput = document.getElementById("bookmarkNote");

  const prefillPdfPage = parseInt(options.prefillPdfPage, 10);
  const safePrefillPdfPage =
    Number.isFinite(prefillPdfPage) && prefillPdfPage >= 1 ? prefillPdfPage : 1;

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
    labelInput.value = String(options.label || "");
    pdfPageInput.value = "";
    pdfPageInput.valueAsNumber = safePrefillPdfPage;
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
    requestAnimationFrame(() => {
      pdfPageInput.valueAsNumber = safePrefillPdfPage;
    });
  }
}

export function saveBookmark() {
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
  const realPageRaw = document.getElementById("bookmarkRealPage").value.trim();
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
  callRenderer("renderBooksView");
}

export function deleteBookmark(bookId, bookmarkId) {
  const book = getBookById(bookId);
  if (!book) return;
  const bm = book.bookmarks.find((b) => b.bookmarkId === bookmarkId);
  if (!bm) return;

  openConfirm("Delete Bookmark", `Delete bookmark \"${bm.label}\"?`, () => {
    book.bookmarks = book.bookmarks.filter((b) => b.bookmarkId !== bookmarkId);
    book.updatedAt = nowIso();
    saveState();
    callRenderer("renderBooksView");
  });
}

export function openHistoryEventModal(bookId, bookmarkId, eventId) {
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

  Object.assign(historyEventModalState, {
    editingBookId: bookId,
    editingBookmarkId: bookmarkId,
    editingEventId: eventId,
  });

  document.getElementById("historyEventType").value = String(
    event.type || "updated",
  );
  document.getElementById("historyEventNote").value = String(event.note || "");
  openModal("historyEventModal");
}

export function saveHistoryEventModal() {
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
  callRenderer("renderBooksView");
}

export function deleteHistoryEvent(bookId, bookmarkId, eventId) {
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
      bookmark.history = bookmark.history.filter((h) => h.eventId !== eventId);
      bookmark.updatedAt = nowIso();
      book.updatedAt = bookmark.updatedAt;
      book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      saveState();
      callRenderer("renderBooksView");
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

export function openReaderHistoryPicker(bookId, page) {
  const book = getBookById(bookId);
  if (!book) return;

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const bookmarks = Array.isArray(book.bookmarks) ? book.bookmarks : [];

  if (bookmarks.length === 0) {
    openBookmarkModal(bookId, null, { prefillPdfPage: safePage });
    return;
  }

  Object.assign(readerHistoryPickerState, {
    bookId,
    page: safePage,
  });

  const subtitle = document.getElementById("readerHistoryPickerSubtitle");
  if (subtitle) {
    subtitle.textContent = "";
    subtitle.append("You're on PDF page ");
    const strong = document.createElement("strong");
    strong.textContent = String(safePage);
    subtitle.appendChild(strong);
    subtitle.append(
      ". Tap a bookmark to add this session to it, or create a new one.",
    );
  }

  const listEl = document.getElementById("readerHistoryPickerList");
  if (!listEl) return;
  listEl.textContent = "";

  bookmarks.forEach((bm) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "reader-history-picker-item";
    card.dataset.bookmarkId = bm.bookmarkId;
    card.setAttribute("role", "listitem");

    const labelEl = document.createElement("div");
    labelEl.className = "reader-history-picker-item__label";
    labelEl.textContent = bm.label || "Bookmark";

    const metaEl = document.createElement("div");
    metaEl.className = "reader-history-picker-item__meta";

    const pdfSpan = document.createElement("span");
    pdfSpan.textContent = `PDF ${bm.pdfPage}`;
    metaEl.appendChild(pdfSpan);

    const realSpan = document.createElement("span");
    realSpan.textContent = `Real ${formatRealBookPage(bm.realPage)}`;
    metaEl.appendChild(realSpan);

    if (bm.updatedAt) {
      const updatedSpan = document.createElement("span");
      updatedSpan.textContent = `Updated ${formatIsoForDisplay(bm.updatedAt)}`;
      metaEl.appendChild(updatedSpan);
    }

    card.appendChild(labelEl);
    card.appendChild(metaEl);

    card.addEventListener("click", () => {
      addReaderHistoryToBookmark(book, bm, safePage);
      const statusText = document.getElementById("readerStatusText");
      if (statusText) {
        statusText.textContent = `History added to "${bm.label || "Bookmark"}".`;
      }
      closeModal("readerHistoryPickerModal");
    });

    listEl.appendChild(card);
  });

  openModal("readerHistoryPickerModal");
}

// Register openConfirm so other modules can call it via callRenderer
registerRenderer("openConfirm", openConfirm);
registerRenderer("openBookmarkModal", openBookmarkModal);
registerRenderer("openReaderHistoryPicker", openReaderHistoryPicker);
registerRenderer("renderMonthlyReview", renderMonthlyReview);
registerRenderer("openNoteModal", openNoteModal);
