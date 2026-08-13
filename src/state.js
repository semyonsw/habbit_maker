"use strict";

export let state = null;
export function setState(s) {
  state = s;
}

export let chartInstances = {};
export function setChartInstances(c) {
  chartInstances = c;
}

export const globals = {
  sidebarCollapsed: false,
  confirmCallback: null,
  editingHabitId: null,
  editingCategoryId: null,
  topClockTimer: null,
  lastAutoScrolledMonthKey: null,
  logAutoDownloadBlockedUntil: 0,
  legacyPlaintextApiKeyForMigration: "",
  // Day selected in the mobile day-focus card, 1..31. null means "resolve to
  // today if we are viewing the current month, else day 1" -- see
  // render-day-focus.js getSelectedDay(). Deliberately not persisted: loadState()
  // already forces the current month on every boot, so the default is correct.
  dayFocusDay: null,
};

export const noteModalState = { habitId: null, day: null };
export const reportModalState = {
  reportId: null,
  attachments: [],
  pendingFiles: [],
  removedFileIds: [],
};
export const bookModalState = { editingBookId: null };
export const bookmarkModalState = {
  editingBookId: null,
  editingBookmarkId: null,
};
export const historyEventModalState = {
  editingBookId: null,
  editingBookmarkId: null,
  editingEventId: null,
};
export const readerHistoryPickerState = {
  bookId: null,
  page: 1,
};
export const bookOpenModalState = {
  bookId: null,
  page: 1,
  bookmarkId: null,
};

export let idbPromise = null;
export function setIdbPromise(p) {
  idbPromise = p;
}

export let booksBlobStatus = {};
export function setBooksBlobStatus(s) {
  booksBlobStatus = s;
}

export const linkedHoverState = {
  day: null,
  week: null,
  scope: null,
  source: null,
};

export let appLogs = [];
export function setAppLogs(logs) {
  appLogs = logs;
}

export const liveLogFileState = {
  enabled: false,
  handle: null,
  writeQueue: Promise.resolve(),
  sessionId: "",
  writeCount: 0,
  lastError: "",
};

export const analyticsState = {
  displayMode: "percent",
};

// How "Open at Bookmark" behaves: "app" (in-app reader, lands on the exact
// page), "external" (hand the file to the phone's PDF app) or "ask" (choose per
// tap). Persisted through prefs, see preferences.js.
export const booksUiState = {
  openMode: "ask",
};

export const readerState = {
  pdfDoc: null,
  book: null,
  currentPage: 1,
  totalPages: 0,
  renderTask: null,
  resizeHandlerBound: false,
  resizeTimer: null,
  darkEnabled: false,
  darkMode: "full",
  sourceBookmarkId: null,
  sourcePage: null,
  // true when the reader is showing over the app (no navigation), false for the
  // standalone ?reader=1 tab. Drives the Close button and the back gesture.
  isInPage: false,
  ownsHistoryEntry: false,
  eventsBound: false,
  // Multiplier on top of fit-to-width. Drives a real re-render (crisp at any
  // scale) rather than a CSS transform on the scroll container.
  zoom: 1,
};
