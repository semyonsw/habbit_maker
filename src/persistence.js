"use strict";

import {
  STORAGE_KEY,
  SCHEMA_VERSION,
  ALL_WEEKDAYS,
  MAX_BOOKMARK_HISTORY,
  DEFAULT_CATEGORIES,
  DEFAULT_DAILY_HABITS,
  SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT,
  SUMMARY_MAX_PAGES_PER_RUN_DEFAULT,
} from "./constants.js";
import { state, setState, globals } from "./state.js";
import {
  uid,
  monthKey,
  nowIso,
  isPlainObject,
  normalizeWeekdayArray,
  normalizeMonthDayArray,
} from "./utils.js";
import { appendLogEntry } from "./logging.js";
import { hasStoredEncryptedApiKey, ensureModelAllowed, _bindSaveState } from "./encryption.js";

export function getDefaultMonthData() {
  return {
    dailyCompletions: {},
    dailyNotes: {},
    monthlyReview: { wins: "", blockers: "", focus: "" },
  };
}

export function ensureMonthDataShape(monthData) {
  if (!isPlainObject(monthData.dailyCompletions)) {
    monthData.dailyCompletions = {};
  }
  if (!isPlainObject(monthData.dailyNotes)) {
    monthData.dailyNotes = {};
  }
  if (!isPlainObject(monthData.monthlyReview)) {
    monthData.monthlyReview = {};
  }
  monthData.monthlyReview.wins = String(monthData.monthlyReview.wins || "");
  monthData.monthlyReview.blockers = String(
    monthData.monthlyReview.blockers || "",
  );
  monthData.monthlyReview.focus = String(monthData.monthlyReview.focus || "");
  return monthData;
}

export function ensureBooksShape(input) {
  if (!isPlainObject(input.books)) {
    input.books = { items: [], activeBookId: null };
  }
  if (!Array.isArray(input.books.items)) {
    input.books.items = [];
  }
  if (typeof input.books.activeBookId !== "string") {
    input.books.activeBookId = null;
  }
  if (!isPlainObject(input.books.ai)) {
    input.books.ai = {};
  }
  input.books.ai.apiKey = "";
  input.books.ai.apiKeyMode = "encrypted";
  input.books.ai.apiKeySaved = hasStoredEncryptedApiKey();
  input.books.ai.apiKeyLastUpdated = String(
    input.books.ai.apiKeyLastUpdated || "",
  );
  input.books.ai.model = ensureModelAllowed(input.books.ai.model);
  const normalizedChunkChars = parseInt(input.books.ai.chunkChars, 10);
  input.books.ai.chunkChars = Number.isFinite(normalizedChunkChars)
    ? Math.min(30000, Math.max(4000, normalizedChunkChars))
    : SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT;
  const normalizedMaxPages = parseInt(input.books.ai.maxPagesPerRun, 10);
  input.books.ai.maxPagesPerRun = Number.isFinite(normalizedMaxPages)
    ? Math.min(1000, Math.max(20, normalizedMaxPages))
    : SUMMARY_MAX_PAGES_PER_RUN_DEFAULT;
  input.books.ai.consolidateMode =
    input.books.ai.consolidateMode === false ? false : true;

  input.books.items = input.books.items
    .filter((book) => isPlainObject(book) && typeof book.bookId === "string")
    .map((book) => {
      const createdAt = String(book.createdAt || nowIso());
      const updatedAt = String(book.updatedAt || createdAt);
      const cleanBook = {
        bookId: String(book.bookId),
        title:
          String(book.title || "Untitled Book").trim() || "Untitled Book",
        author: book.author ? String(book.author) : "",
        fileId: String(book.fileId || uid("file")),
        fileName: String(book.fileName || "unknown.pdf"),
        fileSize: Number.isFinite(book.fileSize)
          ? Math.max(0, book.fileSize)
          : 0,
        totalPagesDetected: Number.isFinite(
          parseInt(book.totalPagesDetected, 10),
        )
          ? Math.max(1, parseInt(book.totalPagesDetected, 10))
          : null,
        totalPagesDetectedAt: String(book.totalPagesDetectedAt || ""),
        totalPagesOverride: Number.isFinite(
          parseInt(book.totalPagesOverride, 10),
        )
          ? Math.max(1, parseInt(book.totalPagesOverride, 10))
          : null,
        createdAt,
        updatedAt,
        bookmarks: [],
      };

      const rawBookmarks = Array.isArray(book.bookmarks)
        ? book.bookmarks
        : [];
      cleanBook.bookmarks = rawBookmarks
        .filter(
          (bm) =>
            isPlainObject(bm) &&
            typeof bm.bookmarkId === "string" &&
            Number.isFinite(Number(bm.pdfPage)),
        )
        .map((bm) => {
          const bmCreatedAt = String(bm.createdAt || nowIso());
          const bmUpdatedAt = String(bm.updatedAt || bmCreatedAt);
          const history = Array.isArray(bm.history) ? bm.history : [];
          const bookmarkPage = Math.max(1, parseInt(bm.pdfPage, 10) || 1);
          const summaries = Array.isArray(bm.summaries) ? bm.summaries : [];
          return {
            bookmarkId: String(bm.bookmarkId),
            label: String(bm.label || "Bookmark").trim() || "Bookmark",
            pdfPage: bookmarkPage,
            realPage: (() => {
              const parsed = parseInt(bm.realPage, 10);
              return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
            })(),
            note: String(bm.note || ""),
            createdAt: bmCreatedAt,
            updatedAt: bmUpdatedAt,
            history: history
              .filter((h) => isPlainObject(h))
              .map((h) => ({
                eventId: String(h.eventId || uid("hist")),
                type: String(h.type || "updated"),
                at: String(h.at || bmUpdatedAt),
                note: String(h.note || ""),
              }))
              .sort((a, b) => (a.at < b.at ? 1 : -1))
              .slice(0, MAX_BOOKMARK_HISTORY),
            summaries: summaries
              .filter((s) => isPlainObject(s))
              .map((s) => {
                const sCreatedAt = String(s.createdAt || nowIso());
                const sUpdatedAt = String(s.updatedAt || sCreatedAt);
                const fallbackStart =
                  s.isIncremental === true
                    ? Math.max(1, parseInt(s.startPage, 10) || 1)
                    : 1;
                const startPage = Math.max(
                  1,
                  parseInt(s.startPage, 10) || fallbackStart,
                );
                const endPage = Math.max(
                  startPage,
                  parseInt(s.endPage, 10) || bookmarkPage,
                );
                const status = ["ready", "failed", "running"].includes(
                  String(s.status || ""),
                )
                  ? String(s.status)
                  : String(s.content || "").trim().length
                    ? "ready"
                    : "failed";
                const basedOnSummaryId =
                  typeof s.basedOnSummaryId === "string" &&
                  s.basedOnSummaryId.trim()
                    ? s.basedOnSummaryId
                    : null;
                const durationMs = Number.isFinite(Number(s.durationMs))
                  ? Math.max(0, Number(s.durationMs))
                  : null;
                return {
                  summaryId: String(s.summaryId || uid("sum")),
                  model: String(s.model || ""),
                  startPage,
                  endPage,
                  isIncremental: s.isIncremental === true,
                  basedOnSummaryId,
                  createdAt: sCreatedAt,
                  updatedAt: sUpdatedAt,
                  status,
                  content: String(s.content || ""),
                  chunkMeta: isPlainObject(s.chunkMeta) ? s.chunkMeta : {},
                  durationMs,
                  error: String(s.error || ""),
                };
              })
              .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
          };
        })
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

      return cleanBook;
    });

  if (!isPlainObject(input.books.helper)) {
    input.books.helper = {};
  }
  input.books.helper.selectedBookId =
    typeof input.books.helper.selectedBookId === "string"
      ? input.books.helper.selectedBookId
      : "";
  input.books.helper.targetDate =
    typeof input.books.helper.targetDate === "string"
      ? input.books.helper.targetDate
      : "";
  input.books.helper.startPage = Number.isFinite(
    parseInt(input.books.helper.startPage, 10),
  )
    ? Math.max(1, parseInt(input.books.helper.startPage, 10))
    : null;
  const rawWeekdays = Array.isArray(input.books.helper.weekdays)
    ? input.books.helper.weekdays
    : [...ALL_WEEKDAYS];
  input.books.helper.weekdays = [...new Set(rawWeekdays)]
    .map((value) => parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    .sort((a, b) => a - b);
}

export function getDefaultState() {
  const now = new Date();
  const key = monthKey(now.getFullYear(), now.getMonth());
  return {
    currentYear: now.getFullYear(),
    currentMonth: now.getMonth(),
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    habits: {
      daily: DEFAULT_DAILY_HABITS.map((h, idx) => ({ ...h, order: idx })),
    },
    months: {
      [key]: getDefaultMonthData(),
    },
    books: {
      items: [],
      activeBookId: null,
      helper: {
        selectedBookId: "",
        targetDate: "",
        startPage: null,
        weekdays: [...ALL_WEEKDAYS],
      },
      ai: {
        apiKey: "",
        apiKeyMode: "encrypted",
        apiKeySaved: false,
        apiKeyLastUpdated: "",
        model: "gemini-2.5-flash",
        chunkChars: SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT,
        maxPagesPerRun: SUMMARY_MAX_PAGES_PER_RUN_DEFAULT,
        consolidateMode: true,
      },
    },
    meta: {
      schemaVersion: SCHEMA_VERSION,
    },
  };
}

export function migrateState() {
  if (!isPlainObject(state)) {
    setState(getDefaultState());
    return;
  }

  if (!Array.isArray(state.categories)) {
    state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  }

  if (!isPlainObject(state.habits)) {
    state.habits = { daily: [] };
  }
  if (!Array.isArray(state.habits.daily)) {
    state.habits.daily = [];
  }
  delete state.habits.weekly;

  if (!isPlainObject(state.months)) {
    state.months = {};
  }
  Object.keys(state.months).forEach((key) => {
    if (!isPlainObject(state.months[key])) {
      state.months[key] = getDefaultMonthData();
    }
    delete state.months[key].weeklyCompletions;
    ensureMonthDataShape(state.months[key]);
  });

  state.habits.daily.forEach((habit, idx) => {
    habit.id = String(habit.id || uid("dh"));
    habit.name = String(habit.name || "Habit");
    habit.categoryId = String(habit.categoryId || "");
    habit.monthGoal = Math.max(1, parseInt(habit.monthGoal, 10) || 20);

    if (!Array.isArray(habit.excludedWeekdays)) {
      const legacy = Array.isArray(habit.excludedDays)
        ? habit.excludedDays
        : [];
      habit.excludedWeekdays = legacy
        .map((d) => parseInt(d, 10))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    }
    habit.excludedWeekdays = [...new Set(habit.excludedWeekdays)]
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b);

    let mode = String(habit.scheduleMode || habit.type || "fixed");
    if (mode === "dynamic") {
      const activeWeekdays = ALL_WEEKDAYS.filter(
        (weekday) => !habit.excludedWeekdays.includes(weekday),
      );
      habit.activeWeekdays = activeWeekdays.length
        ? activeWeekdays
        : [...ALL_WEEKDAYS];
      mode =
        habit.activeWeekdays.length === 7 ? "fixed" : "specific_weekdays";
    }

    if (mode !== "specific_weekdays" && mode !== "specific_month_days") {
      mode = "fixed";
    }

    habit.activeWeekdays = normalizeWeekdayArray(
      Array.isArray(habit.activeWeekdays)
        ? habit.activeWeekdays
        : mode === "specific_weekdays"
          ? ALL_WEEKDAYS.filter(
              (weekday) => !habit.excludedWeekdays.includes(weekday),
            )
          : ALL_WEEKDAYS,
    );
    if (!habit.activeWeekdays.length) {
      habit.activeWeekdays = [...ALL_WEEKDAYS];
    }

    habit.activeMonthDays = normalizeMonthDayArray(
      Array.isArray(habit.activeMonthDays) ? habit.activeMonthDays : [],
    );
    if (mode === "specific_month_days" && !habit.activeMonthDays.length) {
      habit.activeMonthDays = [1];
    }

    if (mode === "fixed") {
      habit.activeWeekdays = [...ALL_WEEKDAYS];
    }

    habit.scheduleMode = mode;
    habit.type = mode;
    delete habit.excludedDays;
    habit.emoji = String(habit.emoji || "\uD83D\uDCCC");
    habit.order = Number.isInteger(habit.order) ? habit.order : idx;
  });
  state.habits.daily.sort((a, b) => a.order - b.order);
  state.habits.daily.forEach((h, idx) => {
    h.order = idx;
  });

  ensureBooksShape(state);

  if (!isPlainObject(state.meta)) {
    state.meta = {};
  }
  state.meta.schemaVersion = SCHEMA_VERSION;

  if (!Number.isInteger(state.currentYear)) {
    state.currentYear = new Date().getFullYear();
  }
  if (
    !Number.isInteger(state.currentMonth) ||
    state.currentMonth < 0 ||
    state.currentMonth > 11
  ) {
    state.currentMonth = new Date().getMonth();
  }
}

export function ensureMonthData() {
  const key = monthKey(state.currentYear, state.currentMonth);
  if (!state.months[key]) {
    state.months[key] = getDefaultMonthData();
  }
  ensureMonthDataShape(state.months[key]);
}

export function getCurrentMonthData() {
  ensureMonthData();
  return state.months[monthKey(state.currentYear, state.currentMonth)];
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      setState(JSON.parse(raw));
      migrateState();
      const now = new Date();
      state.currentYear = now.getFullYear();
      state.currentMonth = now.getMonth();
      ensureMonthData();
      if (
        isPlainObject(state.books) &&
        isPlainObject(state.books.ai) &&
        typeof state.books.ai.apiKey === "string" &&
        state.books.ai.apiKey.trim().length
      ) {
        globals.legacyPlaintextApiKeyForMigration = state.books.ai.apiKey.trim();
        appendLogEntry({
          level: "warn",
          component: "secure-settings",
          operation: "loadState",
          message: "Legacy plaintext API key detected; scrubbing from state.",
        });
        state.books.ai.apiKey = "";
      }
      saveState();
      return;
    }
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "state",
      operation: "loadState",
      message: "Failed to load state, using defaults.",
      error,
    });
  }

  setState(getDefaultState());
  saveState();
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Bind saveState to encryption module to break circular dependency
_bindSaveState(saveState);

export function getCategoryById(categoryId) {
  return state.categories.find((c) => c.id === categoryId) || null;
}

export function getHabitEmoji(habit) {
  if (habit.emoji) return habit.emoji;
  const cat = getCategoryById(habit.categoryId);
  return cat ? cat.emoji : "\uD83D\uDCCC";
}
