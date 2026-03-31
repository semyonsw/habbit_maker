"use strict";

export let state = null;
export function setState(s) { state = s; }

export let chartInstances = {};
export function setChartInstances(c) { chartInstances = c; }

export const globals = {
  sidebarCollapsed: false,
  confirmCallback: null,
  editingHabitId: null,
  editingCategoryId: null,
  topClockTimer: null,
  lastAutoScrolledMonthKey: null,
  logAutoDownloadBlockedUntil: 0,
  legacyPlaintextApiKeyForMigration: "",
};

export const noteModalState = { habitId: null, day: null };
export const bookModalState = { editingBookId: null };
export const bookmarkModalState = { editingBookId: null, editingBookmarkId: null };
export const historyEventModalState = {
  editingBookId: null,
  editingBookmarkId: null,
  editingEventId: null,
};
export const summaryModalState = {
  bookId: null,
  bookmarkId: null,
  selectedSummaryId: null,
  statusText: "",
  detectionText: "",
  externalSummary: null,
  isRunning: false,
};

export let idbPromise = null;
export function setIdbPromise(p) { idbPromise = p; }

export let booksBlobStatus = {};
export function setBooksBlobStatus(s) { booksBlobStatus = s; }

export const linkedHoverState = {
  day: null,
  week: null,
  scope: null,
  source: null,
};

export const secureSettings = {
  keyCiphertext: null,
  saltBase64: null,
  ivBase64: null,
  kdfIterations: 200000,
  keyUpdatedAt: null,
};

export const runtimeSecrets = {
  apiKey: "",
  unlockedAt: null,
};

export let appLogs = [];
export function setAppLogs(logs) { appLogs = logs; }

export const summaryModelPickerState = {
  isOpen: false,
  activeIndex: -1,
  filtered: [],
};

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
  booksRangeDays: 30,
};

export const finisherState = {
  loadingBookId: null,
  lastError: "",
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
};
