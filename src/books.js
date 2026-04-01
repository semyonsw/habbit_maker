"use strict";

import { MAX_PDF_FILE_SIZE_MB, MAX_PDF_FILE_SIZE_BYTES, MAX_BOOKMARK_HISTORY, ALL_WEEKDAYS, WEEKDAY_LABELS, PDFJS_WORKER_URL, MONTH_NAMES } from "./constants.js";
import { state, booksBlobStatus, setBooksBlobStatus, finisherState, readerState, bookmarkModalState } from "./state.js";
import { uid, nowIso, sanitize, isPlainObject, formatRealBookPage, formatByteSize, formatIsoForDisplay, daysInMonth, formatDateKey, clampNumber } from "./utils.js";
import { appendLogEntry } from "./logging.js";
import { idbGetPdfBlob, idbSavePdfBlob, idbDeletePdfBlob } from "./idb.js";
import { saveState } from "./persistence.js";
import { getBooksAnalyticsRangeDays } from "./preferences.js";
import { callRenderer } from "./render-registry.js";
import { ensurePdfJsLibLoaded } from "./pdf-reader.js";

export function getBookById(bookId) {
  return state.books.items.find((b) => b.bookId === bookId) || null;
}

export function getActiveBook() {
  return getBookById(state.books.activeBookId);
}

export function getBookmarkById(book, bookmarkId) {
  if (!book || !Array.isArray(book.bookmarks)) return null;
  return book.bookmarks.find((bm) => bm.bookmarkId === bookmarkId) || null;
}

export function getReadySummariesFromBookmark(bookmark) {
  const summaries = Array.isArray(bookmark && bookmark.summaries)
    ? bookmark.summaries
    : [];
  return summaries.filter(
    (s) =>
      isPlainObject(s) &&
      s.status === "ready" &&
      typeof s.content === "string" &&
      s.content.trim().length,
  );
}

export function getBookmarkLastSummarizedPage(bookmark) {
  const ready = getReadySummariesFromBookmark(bookmark);
  if (!ready.length) return 0;
  return ready.reduce(
    (maxPage, s) => Math.max(maxPage, parseInt(s.endPage, 10) || 0),
    0,
  );
}

export function getReadySummariesFromBook(book) {
  if (!book || !Array.isArray(book.bookmarks)) return [];
  return book.bookmarks
    .flatMap((bookmark) =>
      getReadySummariesFromBookmark(bookmark).map((summary) => ({
        ...summary,
        bookmarkId: bookmark.bookmarkId,
      })),
    )
    .sort((a, b) => {
      const endDelta =
        (parseInt(b.endPage, 10) || 0) - (parseInt(a.endPage, 10) || 0);
      if (endDelta !== 0) return endDelta;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
}

export function getLatestSummaryUpToPageFromBook(book, page) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const byCoverage = getReadySummariesFromBook(book).filter(
    (s) => (parseInt(s.endPage, 10) || 0) <= safePage,
  );
  if (byCoverage.length) return byCoverage[0];

  const all = getReadySummariesFromBook(book);
  if (!all.length) return null;
  return [...all].sort((a, b) => {
    const aDiff = Math.abs((parseInt(a.endPage, 10) || 0) - safePage);
    const bDiff = Math.abs((parseInt(b.endPage, 10) || 0) - safePage);
    if (aDiff !== bDiff) return aDiff - bDiff;
    return a.createdAt < b.createdAt ? 1 : -1;
  })[0];
}

export function getBookLastSummarizedPage(book) {
  const summaries = getReadySummariesFromBook(book);
  if (!summaries.length) return 0;
  return summaries.reduce(
    (maxPage, s) => Math.max(maxPage, parseInt(s.endPage, 10) || 0),
    0,
  );
}

export function resolveIncrementalRange(book, currentBookmarkPage) {
  const safeCurrentPage = Math.max(1, parseInt(currentBookmarkPage, 10) || 1);
  const lastSummarizedPage = getBookLastSummarizedPage(book);
  const relevantSummary = getLatestSummaryUpToPageFromBook(
    book,
    safeCurrentPage,
  );

  if (safeCurrentPage <= lastSummarizedPage) {
    return {
      mode: "reuse",
      startPage: null,
      endPage: safeCurrentPage,
      lastSummarizedPage,
      relevantSummary,
    };
  }

  if (!relevantSummary) {
    return {
      mode: "full",
      startPage: 1,
      endPage: safeCurrentPage,
      lastSummarizedPage: 0,
      relevantSummary: null,
    };
  }

  return {
    mode: "incremental",
    startPage: Math.max(1, (parseInt(relevantSummary.endPage, 10) || 0) + 1),
    endPage: safeCurrentPage,
    lastSummarizedPage,
    relevantSummary,
  };
}

export function getSummaryById(bookmark, summaryId) {
  if (!bookmark || !Array.isArray(bookmark.summaries)) return null;
  return (
    bookmark.summaries.find((summary) => summary.summaryId === summaryId) ||
    null
  );
}

export function getLatestBookmarkSummary(bookmark) {
  const summaries = getReadySummariesFromBookmark(bookmark);
  return summaries.length ? summaries[0] : null;
}

export function appendBookmarkSummaryRecord(book, bookmark, recordInput) {
  const timestamp = nowIso();
  const record = {
    summaryId: uid("sum"),
    model: String(recordInput.model || ""),
    startPage: Math.max(1, parseInt(recordInput.startPage, 10) || 1),
    endPage: Math.max(1, parseInt(recordInput.endPage, 10) || 1),
    isIncremental: recordInput.isIncremental === true,
    basedOnSummaryId:
      typeof recordInput.basedOnSummaryId === "string" &&
      recordInput.basedOnSummaryId.trim()
        ? recordInput.basedOnSummaryId
        : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: recordInput.status === "failed" ? "failed" : "ready",
    content: String(recordInput.content || ""),
    chunkMeta: isPlainObject(recordInput.chunkMeta)
      ? recordInput.chunkMeta
      : {},
    durationMs: Number.isFinite(Number(recordInput.durationMs))
      ? Math.max(0, Number(recordInput.durationMs))
      : null,
    error: String(recordInput.error || ""),
  };

  record.endPage = Math.max(record.startPage, record.endPage);

  if (!Array.isArray(bookmark.summaries)) {
    bookmark.summaries = [];
  }
  bookmark.summaries.unshift(record);
  bookmark.updatedAt = timestamp;
  book.updatedAt = timestamp;
  book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  saveState();
  return record;
}

export async function refreshBookBlobStatus() {
  const entries = await Promise.all(
    state.books.items.map(async (book) => {
      try {
        const blob = await idbGetPdfBlob(book.fileId);
        return [book.bookId, !!blob];
      } catch (_) {
        return [book.bookId, false];
      }
    }),
  );
  setBooksBlobStatus(Object.fromEntries(entries));
}

export function setActiveBook(bookId) {
  state.books.activeBookId = bookId;
  saveState();
  callRenderer("renderBooksView");
}

export function setBookUploadStatus(text, tone) {
  const statusEl = document.getElementById("bookUploadStatus");
  if (!statusEl) return;
  statusEl.textContent = String(text || "");
  statusEl.classList.remove("pending", "success", "error");
  if (["pending", "success", "error"].includes(tone)) {
    statusEl.classList.add(tone);
  }
}

export function addBookmarkHistoryEvent(bookmark, type, note) {
  const event = {
    eventId: uid("hist"),
    type,
    at: nowIso(),
    note: String(note || ""),
  };
  bookmark.history = [
    event,
    ...(Array.isArray(bookmark.history) ? bookmark.history : []),
  ].slice(0, MAX_BOOKMARK_HISTORY);
  return event;
}

export function formatShortDateLabel(dateValue) {
  const dt = new Date(dateValue);
  return `${MONTH_NAMES[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
}

export function floorToDayTime(ms) {
  const dt = new Date(ms);
  dt.setHours(0, 0, 0, 0);
  return dt.getTime();
}

export function toLocalDayKey(ms) {
  const dt = new Date(ms);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseIsoMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePageFromHistoryNote(note) {
  const match = String(note || "").match(/page\s+(\d+)/i);
  const parsed = match ? parseInt(match[1], 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

export function daysInclusiveFromTimes(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  const diff = floorToDayTime(endMs) - floorToDayTime(startMs);
  return Math.max(1, Math.round(diff / 86400000) + 1);
}

export function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

export function formatDateInputValue(dateLike) {
  const dt = new Date(dateLike);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getBookMaxBookmarkPage(book) {
  const bookmarks = Array.isArray(book && book.bookmarks)
    ? book.bookmarks
    : [];
  if (!bookmarks.length) return 1;
  return Math.max(
    1,
    ...bookmarks.map((bm) => Math.max(1, parseInt(bm.pdfPage, 10) || 1)),
  );
}

export function getEffectiveBookTotalPages(book) {
  if (!book) return null;
  const override = parseInt(book.totalPagesOverride, 10);
  if (Number.isFinite(override) && override >= 1) return override;
  const detected = parseInt(book.totalPagesDetected, 10);
  if (Number.isFinite(detected) && detected >= 1) return detected;
  return null;
}

export function getOrInitBooksHelperState() {
  if (!isPlainObject(state.books)) {
    state.books = { items: [], activeBookId: null, helper: {} };
  }
  if (!isPlainObject(state.books.helper)) {
    state.books.helper = {};
  }
  if (typeof state.books.helper.selectedBookId !== "string") {
    state.books.helper.selectedBookId = "";
  }
  if (typeof state.books.helper.targetDate !== "string") {
    state.books.helper.targetDate = "";
  }
  if (!Number.isFinite(parseInt(state.books.helper.startPage, 10))) {
    state.books.helper.startPage = null;
  } else {
    state.books.helper.startPage = Math.max(
      1,
      parseInt(state.books.helper.startPage, 10),
    );
  }
  if (!Array.isArray(state.books.helper.weekdays)) {
    state.books.helper.weekdays = [...ALL_WEEKDAYS];
  }
  state.books.helper.weekdays = [...new Set(state.books.helper.weekdays)]
    .map((value) => parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    .sort((a, b) => a - b);
  return state.books.helper;
}

export function getSelectedFinisherBook() {
  const helper = getOrInitBooksHelperState();
  const books = Array.isArray(state.books && state.books.items)
    ? state.books.items
    : [];
  if (!books.length) return null;
  if (helper.selectedBookId) {
    const matched = books.find(
      (book) => book.bookId === helper.selectedBookId,
    );
    if (matched) return matched;
  }
  if (state.books.activeBookId) {
    const active = books.find(
      (book) => book.bookId === state.books.activeBookId,
    );
    if (active) return active;
  }
  return books[0] || null;
}

export async function detectBookTotalPages(book) {
  if (!book || !book.fileId) return null;
  if (
    Number.isFinite(parseInt(book.totalPagesDetected, 10)) &&
    parseInt(book.totalPagesDetected, 10) > 0
  ) {
    return Math.max(1, parseInt(book.totalPagesDetected, 10));
  }

  if (finisherState.loadingBookId === book.bookId) {
    return null;
  }

  finisherState.loadingBookId = book.bookId;
  finisherState.lastError = "";
  try {
    const blob = await idbGetPdfBlob(book.fileId);
    if (!blob) {
      finisherState.lastError = "PDF blob missing in local storage.";
      return null;
    }
    const pdfjsLib = await ensurePdfJsLibLoaded();
    if (!pdfjsLib) {
      finisherState.lastError = "PDF.js failed to load.";
      return null;
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const pdfData = await blob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdfDoc = await loadingTask.promise;
    const pages = Math.max(1, parseInt(pdfDoc.numPages, 10) || 1);
    book.totalPagesDetected = pages;
    book.totalPagesDetectedAt = nowIso();
    saveState();
    return pages;
  } catch (error) {
    finisherState.lastError = "Could not detect total pages from PDF.";
    appendLogEntry({
      level: "warn",
      component: "books-finisher",
      operation: "detectBookTotalPages",
      message: "Failed to detect total pages.",
      error,
      context: { bookId: book.bookId, fileId: book.fileId },
    });
    return null;
  } finally {
    finisherState.loadingBookId = null;
  }
}

export function computeBookFinisherPlan(book) {
  const helper = getOrInitBooksHelperState();
  if (!book) {
    return {
      ok: false,
      message: "Add a book first to use Book Finisher Helper.",
    };
  }

  const totalPages = getEffectiveBookTotalPages(book);
  const startPage = Math.max(
    1,
    parseInt(helper.startPage, 10) || getBookMaxBookmarkPage(book),
  );
  if (!totalPages) {
    return {
      ok: false,
      message: "Total pages unknown. Detect pages or enter an override.",
      startPage,
    };
  }

  if (startPage >= totalPages) {
    return {
      ok: true,
      totalPages,
      startPage,
      remainingPages: 0,
      readingDays: [],
      pagesPerDay: 0,
      pagesPerDayExact: 0,
      projectedDate: "Done",
      message: "This book is already at or beyond the final page.",
    };
  }

  const targetMs = parseIsoMs(`${String(helper.targetDate || "")}T00:00:00`);
  if (!Number.isFinite(targetMs)) {
    return {
      ok: false,
      totalPages,
      startPage,
      message: "Choose a finish date.",
    };
  }

  const todayMs = floorToDayTime(Date.now());
  if (targetMs < todayMs) {
    return {
      ok: false,
      totalPages,
      startPage,
      message: "Finish date is in the past.",
    };
  }

  const weekdaySet = new Set(helper.weekdays || []);
  if (!weekdaySet.size) {
    return {
      ok: false,
      totalPages,
      startPage,
      message: "Select at least one reading weekday.",
    };
  }

  const readingDays = [];
  for (let at = todayMs; at <= targetMs; at += 86400000) {
    const weekday = new Date(at).getDay();
    if (!weekdaySet.has(weekday)) continue;
    readingDays.push(at);
  }

  if (!readingDays.length) {
    return {
      ok: false,
      totalPages,
      startPage,
      message: "No reading days found before the finish date.",
    };
  }

  const remainingPages = Math.max(0, totalPages - startPage);
  const pagesPerDayExact = remainingPages / readingDays.length;
  const pagesPerDay = Math.max(1, Math.ceil(pagesPerDayExact));

  let remaining = remainingPages;
  let projectedAt = readingDays[readingDays.length - 1];
  const weeklyLoads = {};
  readingDays.forEach((dayMs) => {
    const weekStart = new Date(dayMs);
    const weekday = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - weekday);
    weekStart.setHours(0, 0, 0, 0);
    const weekKey = toLocalDayKey(weekStart.getTime());

    const amount = Math.min(remaining, pagesPerDay);
    weeklyLoads[weekKey] = (weeklyLoads[weekKey] || 0) + amount;
    remaining -= amount;
    if (remaining <= 0) {
      projectedAt = dayMs;
    }
  });

  const weekEntries = Object.keys(weeklyLoads)
    .sort((a, b) => (a < b ? -1 : 1))
    .map((weekKey, index) => ({
      label: `W${index + 1}`,
      pages: Math.round(weeklyLoads[weekKey]),
    }));

  return {
    ok: true,
    totalPages,
    startPage,
    targetMs,
    remainingPages,
    readingDays,
    pagesPerDay,
    pagesPerDayExact,
    projectedDate: formatDateInputValue(projectedAt),
    canFinishByTarget: remaining <= 0 && projectedAt <= targetMs,
    weekEntries,
    message: "",
  };
}

export function buildBookReadingEvents(book) {
  const events = [];
  const bookmarks = Array.isArray(book.bookmarks) ? book.bookmarks : [];

  bookmarks.forEach((bookmark) => {
    const page = Math.max(1, parseInt(bookmark.pdfPage, 10) || 1);
    const createdAt = parseIsoMs(bookmark.createdAt);
    const updatedAt = parseIsoMs(bookmark.updatedAt);

    if (Number.isFinite(createdAt)) {
      events.push({
        at: createdAt,
        page,
        type: "bookmark-created",
      });
    }

    if (Number.isFinite(updatedAt) && updatedAt !== createdAt) {
      events.push({
        at: updatedAt,
        page,
        type: "bookmark-updated",
      });
    }

    (Array.isArray(bookmark.history) ? bookmark.history : []).forEach((h) => {
      const at = parseIsoMs(h && h.at);
      if (!Number.isFinite(at)) return;
      const historyPage =
        (h && h.type === "reader-note"
          ? parsePageFromHistoryNote(h.note)
          : null) || null;
      if (!historyPage) return;
      events.push({
        at,
        page: historyPage,
        type: "reader-note",
      });
    });
  });

  const seen = new Set();
  return events
    .sort((a, b) => a.at - b.at)
    .filter((event) => {
      const key = `${event.at}:${event.page}:${event.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function computePerBookStats(book, events) {
  if (!events.length) {
    return {
      bookId: book.bookId,
      title: book.title,
      author: book.author || "Unknown author",
      totalBookmarks: Array.isArray(book.bookmarks)
        ? book.bookmarks.length
        : 0,
      eventCount: 0,
      firstAt: null,
      lastAt: null,
      calendarDays: 0,
      activeDays: 0,
      pagesNet: 0,
      avgPerDay: 0,
      avgPerWeek: 0,
      current7dPages: 0,
      bestWeekPages: 0,
      consistencyPct: 0,
      insufficientData: true,
      dayPages: {},
    };
  }

  const dayPages = {};
  let pagesNet = 0;
  for (let i = 1; i < events.length; i += 1) {
    const delta = events[i].page - events[i - 1].page;
    if (delta <= 0) continue;
    pagesNet += delta;
    const key = toLocalDayKey(events[i].at);
    dayPages[key] = (dayPages[key] || 0) + delta;
  }

  const firstAt = events[0].at;
  const lastAt = events[events.length - 1].at;
  const calendarDays = daysInclusiveFromTimes(firstAt, lastAt);
  const activeDays = Object.keys(dayPages).filter(
    (key) => dayPages[key] > 0,
  ).length;
  const avgPerDay = calendarDays > 0 ? pagesNet / calendarDays : 0;
  const avgPerWeek = avgPerDay * 7;

  const nowDay = floorToDayTime(Date.now());
  let current7dPages = 0;
  Object.keys(dayPages).forEach((key) => {
    const at = parseIsoMs(`${key}T00:00:00`);
    if (!Number.isFinite(at)) return;
    if (nowDay - at <= 6 * 86400000) {
      current7dPages += dayPages[key];
    }
  });

  const weekPages = {};
  Object.keys(dayPages).forEach((key) => {
    const dt = new Date(`${key}T00:00:00`);
    const weekAnchor = new Date(dt);
    const day = weekAnchor.getDay();
    const shift = day === 0 ? -6 : 1 - day;
    weekAnchor.setDate(weekAnchor.getDate() + shift);
    const weekKey = toLocalDayKey(weekAnchor.getTime());
    weekPages[weekKey] = (weekPages[weekKey] || 0) + dayPages[key];
  });
  const bestWeekPages = Object.keys(weekPages).length
    ? Math.max(...Object.values(weekPages))
    : 0;

  const consistencyPct =
    calendarDays > 0 ? Math.round((activeDays / calendarDays) * 100) : 0;

  return {
    bookId: book.bookId,
    title: book.title,
    author: book.author || "Unknown author",
    totalBookmarks: Array.isArray(book.bookmarks) ? book.bookmarks.length : 0,
    eventCount: events.length,
    firstAt,
    lastAt,
    calendarDays,
    activeDays,
    pagesNet,
    avgPerDay,
    avgPerWeek,
    current7dPages,
    bestWeekPages,
    consistencyPct,
    insufficientData: events.length < 2 || pagesNet <= 0,
    dayPages,
  };
}

export function buildBooksAnalytics() {
  const rangeDays = getBooksAnalyticsRangeDays();
  const allBooks =
    isPlainObject(state.books) && Array.isArray(state.books.items)
      ? state.books.items
      : [];

  const now = Date.now();
  const rangeStart =
    rangeDays > 0 ? floorToDayTime(now) - (rangeDays - 1) * 86400000 : null;

  const perBook = allBooks.map((book) => {
    const allEvents = buildBookReadingEvents(book);
    const events = rangeStart
      ? allEvents.filter((event) => event.at >= rangeStart)
      : allEvents;
    return computePerBookStats(book, events);
  });

  const withProgress = perBook.filter((book) => book.pagesNet > 0);
  const allDayPages = {};
  const activityCounts = {};
  let totalBookmarks = 0;
  let totalEvents = 0;

  perBook.forEach((book) => {
    totalBookmarks += book.totalBookmarks;
    totalEvents += book.eventCount;
    Object.keys(book.dayPages).forEach((dayKey) => {
      allDayPages[dayKey] =
        (allDayPages[dayKey] || 0) + book.dayPages[dayKey];
    });
  });

  const allBooksRaw =
    isPlainObject(state.books) && Array.isArray(state.books.items)
      ? state.books.items
      : [];
  allBooksRaw.forEach((book) => {
    const events = buildBookReadingEvents(book);
    events
      .filter((event) => (rangeStart ? event.at >= rangeStart : true))
      .forEach((event) => {
        const key = toLocalDayKey(event.at);
        activityCounts[key] = (activityCounts[key] || 0) + 1;
      });
  });

  const totalPages = withProgress.reduce(
    (sum, book) => sum + book.pagesNet,
    0,
  );
  const firstAt = withProgress.length
    ? Math.min(...withProgress.map((book) => book.firstAt))
    : null;
  const lastAt = withProgress.length
    ? Math.max(...withProgress.map((book) => book.lastAt))
    : null;
  const overallDays =
    Number.isFinite(firstAt) && Number.isFinite(lastAt)
      ? daysInclusiveFromTimes(firstAt, lastAt)
      : 0;

  const overall = {
    booksTracked: allBooks.length,
    booksWithProgress: withProgress.length,
    totalBookmarks,
    totalEvents,
    totalPages,
    avgPerDay: overallDays > 0 ? totalPages / overallDays : 0,
    avgPerWeek: overallDays > 0 ? (totalPages / overallDays) * 7 : 0,
    activeDays: Object.keys(allDayPages).length,
    calendarDays: overallDays,
    topBook:
      withProgress.length > 0
        ? [...withProgress].sort((a, b) => b.avgPerDay - a.avgPerDay)[0]
        : null,
    mostConsistent:
      withProgress.length > 0
        ? [...withProgress].sort(
            (a, b) => b.consistencyPct - a.consistencyPct,
          )[0]
        : null,
  };

  const trendWindowDays = rangeDays > 0 ? rangeDays : 90;
  const trendStart = floorToDayTime(now) - (trendWindowDays - 1) * 86400000;
  const trendLabels = [];
  const trendValues = [];
  const trendActivity = [];

  for (let i = 0; i < trendWindowDays; i += 1) {
    const at = trendStart + i * 86400000;
    const key = toLocalDayKey(at);
    trendLabels.push(formatShortDateLabel(at));
    trendValues.push(round1(allDayPages[key] || 0));
    trendActivity.push(activityCounts[key] || 0);
  }

  const heatWindowDays = Math.min(84, trendWindowDays);
  const heatStart = floorToDayTime(now) - (heatWindowDays - 1) * 86400000;
  const weekCount = Math.max(1, Math.ceil(heatWindowDays / 7));
  const heatWeeks = Array.from({ length: weekCount }, (_, idx) => ({
    label: `W${idx + 1}`,
    weekdays: Array.from({ length: 7 }, () => 0),
  }));
  for (let i = 0; i < heatWindowDays; i += 1) {
    const at = heatStart + i * 86400000;
    const dt = new Date(at);
    const weekday = dt.getDay();
    const weekIndex = Math.floor(i / 7);
    const key = toLocalDayKey(at);
    heatWeeks[weekIndex].weekdays[weekday] += allDayPages[key] || 0;
  }

  const comparisonRows = [...withProgress]
    .sort((a, b) => b.avgPerWeek - a.avgPerWeek)
    .slice(0, 12);

  return {
    rangeDays,
    rangeLabel: rangeDays === 0 ? "All time" : `Last ${rangeDays} days`,
    perBook: [...perBook].sort((a, b) => b.avgPerDay - a.avgPerDay),
    overall,
    trendLabels,
    trendValues,
    trendActivity,
    heatWeeks,
    comparisonRows,
  };
}

export function handleBookFileInputChange() {
  const fileInput = document.getElementById("bookPdfInput");
  if (!fileInput) return;
  const file =
    fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
  if (!file) {
    setBookUploadStatus("No file uploaded yet.", "");
    return;
  }
  setBookUploadStatus(`Selected: ${file.name}. Ready to upload.`, "pending");
}

export async function saveBookFromUpload() {
  const titleInput = document.getElementById("bookTitleInput");
  const authorInput = document.getElementById("bookAuthorInput");
  const fileInput = document.getElementById("bookPdfInput");

  const title = titleInput.value.trim();
  const author = authorInput.value.trim();
  const file =
    fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

  if (!title) {
    setBookUploadStatus("Book title is required before upload.", "error");
    alert("Please enter a book title.");
    return;
  }
  if (!file) {
    setBookUploadStatus("Select a PDF file before upload.", "error");
    alert("Please choose a PDF file.");
    return;
  }
  if (!/\.pdf$/i.test(file.name) || file.type !== "application/pdf") {
    setBookUploadStatus("Only PDF files are supported.", "error");
    alert("Only PDF files are supported.");
    return;
  }
  if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
    setBookUploadStatus(
      `File is too large. Maximum size is ${MAX_PDF_FILE_SIZE_MB}MB.`,
      "error",
    );
    alert(
      `PDF file is too large. Maximum size is ${MAX_PDF_FILE_SIZE_MB}MB.`,
    );
    return;
  }

  setBookUploadStatus(`Uploading ${file.name}...`, "pending");

  const fileId = uid("file");
  const bookId = uid("book");
  const createdAt = nowIso();

  await idbSavePdfBlob(fileId, file);

  state.books.items.push({
    bookId,
    title,
    author,
    fileId,
    fileName: file.name,
    fileSize: file.size,
    totalPagesDetected: null,
    totalPagesDetectedAt: "",
    totalPagesOverride: null,
    createdAt,
    updatedAt: createdAt,
    bookmarks: [],
  });
  state.books.activeBookId = bookId;
  saveState();

  titleInput.value = "";
  authorInput.value = "";
  fileInput.value = "";

  setBookUploadStatus(
    `File uploaded: ${file.name} at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
    "success",
  );

  await refreshBookBlobStatus();
  callRenderer("renderBooksView");
}

export function addReaderHistoryToBookmark(book, bookmark, page) {
  if (!book || !bookmark) return;
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  bookmark.pdfPage = safePage;
  bookmark.updatedAt = nowIso();
  addBookmarkHistoryEvent(
    bookmark,
    "reader-note",
    `Reader action on PDF page ${safePage}`,
  );
  book.bookmarks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  book.updatedAt = nowIso();
  saveState();
}

export function addBookmarkOnCurrentReaderPage() {
  const book = readerState.book;
  if (!book) return;

  const page = Math.max(1, parseInt(readerState.currentPage, 10) || 1);
  const sourceBookmark = readerState.sourceBookmarkId
    ? book.bookmarks.find(
        (b) => b.bookmarkId === readerState.sourceBookmarkId,
      )
    : null;
  const openedFromSameBookmarkPage =
    !!sourceBookmark && page === readerState.sourcePage;

  if (openedFromSameBookmarkPage) {
    addReaderHistoryToBookmark(book, sourceBookmark, page);
    document.getElementById("readerStatusText").textContent =
      `History added to \"${sourceBookmark.label}\".`;
    return;
  }

  if (!Array.isArray(book.bookmarks) || book.bookmarks.length === 0) {
    callRenderer("openBookmarkModal", book.bookId, null, { prefillPdfPage: page });
    return;
  }

  const useExisting = window.confirm(
    "Add to an existing bookmark history?\n\nOK: Existing bookmark\nCancel: Create new bookmark on this page",
  );

  if (!useExisting) {
    callRenderer("openBookmarkModal", book.bookId, null, { prefillPdfPage: page });
    return;
  }

  const options = book.bookmarks
    .map(
      (bm, idx) =>
        `${idx + 1}. ${bm.label} (PDF ${bm.pdfPage}, Real ${formatRealBookPage(bm.realPage)})`,
    )
    .join("\n");
  const picked = window.prompt(
    `Pick bookmark number to append history:\n${options}`,
    "1",
  );
  if (picked === null) {
    return;
  }
  const index = parseInt(picked, 10) - 1;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= book.bookmarks.length
  ) {
    alert("Invalid bookmark selection.");
    return;
  }

  const selected = book.bookmarks[index];
  addReaderHistoryToBookmark(book, selected, page);
  document.getElementById("readerStatusText").textContent =
    `History added to \"${selected.label}\".`;
}

export function openBookmarkInNewTab(bookId, page, bookmarkId) {
  const bookmarkPart = bookmarkId
    ? `&bookmark=${encodeURIComponent(bookmarkId)}`
    : "";
  const url = `${window.location.pathname}?reader=1&book=${encodeURIComponent(bookId)}&page=${encodeURIComponent(page)}${bookmarkPart}`;
  window.open(url, "_blank", "noopener");
}

