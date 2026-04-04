"use strict";

import {
  ALL_WEEKDAYS,
  WEEKDAY_LABELS,
  MAX_BOOKMARK_HISTORY,
  MONTH_NAMES,
} from "./constants.js";
import {
  state,
  globals,
  noteModalState,
  bookModalState,
  bookmarkModalState,
  historyEventModalState,
} from "./state.js";
import {
  uid,
  nowIso,
  sanitize,
  isPlainObject,
  monthKey,
  formatDateKey,
  normalizeWeekdayArray,
  normalizeMonthDayArray,
} from "./utils.js";
import { appendLogEntry } from "./logging.js";
import {
  saveState,
  getCurrentMonthData,
  getCategoryById,
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
  getActiveBook,
  getBookmarkById,
  addBookmarkHistoryEvent,
  refreshBookBlobStatus,
  clearBookCoverPreview,
} from "./books.js";
import { idbSavePdfBlob, idbDeletePdfBlob } from "./idb.js";
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
          ? ALL_WEEKDAYS.filter((weekday) => !activeWeekdays.includes(weekday))
          : [],
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

// Register openConfirm so other modules can call it via callRenderer
registerRenderer("openConfirm", openConfirm);
registerRenderer("openBookmarkModal", openBookmarkModal);
registerRenderer("renderMonthlyReview", renderMonthlyReview);
registerRenderer("openNoteModal", openNoteModal);
