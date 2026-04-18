"use strict";

import {
  MAX_PDF_FILE_SIZE_MB,
  MAX_PDF_FILE_SIZE_BYTES,
  MAX_BOOKMARK_HISTORY,
  PDFJS_WORKER_URL,
} from "./constants.js";
import { state, setBooksBlobStatus, readerState } from "./state.js";
import { uid, nowIso, isPlainObject, formatRealBookPage } from "./utils.js?v=2";
import { appendLogEntry } from "./logging.js";
import { idbGetPdfBlob, idbSavePdfBlob } from "./idb.js";
import { saveState } from "./persistence.js";
import { callRenderer } from "./render-registry.js";
import {
  ensurePdfJsLibLoaded,
  renderPdfPagePreviewDataUrl,
} from "./pdf-reader.js";

const bookCoverPreviewCache = new Map();
const bookCoverPreviewTasks = new Map();
const bookCoverPreviewFailed = new Set();

export function getBookById(bookId) {
  return state.books.items.find((b) => b.bookId === bookId) || null;
}

export function getActiveBook() {
  return getBookById(state.books.activeBookId);
}

export function getBookCoverPreview(bookId) {
  const value = bookCoverPreviewCache.get(String(bookId || ""));
  return typeof value === "string" && value.trim().length ? value : null;
}

export function clearBookCoverPreview(bookId) {
  const safeBookId = String(bookId || "");
  if (!safeBookId) return;
  bookCoverPreviewCache.delete(safeBookId);
  bookCoverPreviewTasks.delete(safeBookId);
  bookCoverPreviewFailed.delete(safeBookId);
}

export async function ensureBookCoverPreview(bookId) {
  const safeBookId = String(bookId || "");
  if (!safeBookId) return null;
  if (bookCoverPreviewCache.has(safeBookId)) {
    return getBookCoverPreview(safeBookId);
  }
  if (bookCoverPreviewFailed.has(safeBookId)) {
    return null;
  }
  if (bookCoverPreviewTasks.has(safeBookId)) {
    return bookCoverPreviewTasks.get(safeBookId);
  }

  const task = (async () => {
    const book = getBookById(safeBookId);
    if (!book || !book.fileId) return null;

    let pdfDoc = null;
    try {
      const blob = await idbGetPdfBlob(book.fileId);
      if (!blob) {
        bookCoverPreviewFailed.add(safeBookId);
        return null;
      }

      const pdfjsLib = await ensurePdfJsLibLoaded();
      if (!pdfjsLib) {
        bookCoverPreviewFailed.add(safeBookId);
        return null;
      }

      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      const pdfData = await blob.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      pdfDoc = await loadingTask.promise;

      const previewDataUrl = await renderPdfPagePreviewDataUrl(pdfDoc, {
        pageNumber: 1,
        maxWidth: 170,
        quality: 0.74,
      });

      if (!previewDataUrl) {
        bookCoverPreviewFailed.add(safeBookId);
        return null;
      }

      bookCoverPreviewCache.set(safeBookId, previewDataUrl);
      return previewDataUrl;
    } catch (error) {
      bookCoverPreviewFailed.add(safeBookId);
      appendLogEntry({
        level: "warn",
        component: "books",
        operation: "ensureBookCoverPreview",
        message: "Failed to generate book cover preview.",
        error,
        context: { bookId: safeBookId },
      });
      return null;
    } finally {
      if (pdfDoc && typeof pdfDoc.destroy === "function") {
        try {
          await pdfDoc.destroy();
        } catch (_) {}
      }
      bookCoverPreviewTasks.delete(safeBookId);
    }
  })();

  bookCoverPreviewTasks.set(safeBookId, task);
  return task;
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
    alert(`PDF file is too large. Maximum size is ${MAX_PDF_FILE_SIZE_MB}MB.`);
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
    ? book.bookmarks.find((b) => b.bookmarkId === readerState.sourceBookmarkId)
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
    callRenderer("openBookmarkModal", book.bookId, null, {
      prefillPdfPage: page,
    });
    return;
  }

  const useExisting = window.confirm(
    "Add to an existing bookmark history?\n\nOK: Existing bookmark\nCancel: Create new bookmark on this page",
  );

  if (!useExisting) {
    callRenderer("openBookmarkModal", book.bookId, null, {
      prefillPdfPage: page,
    });
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
  if (!Number.isInteger(index) || index < 0 || index >= book.bookmarks.length) {
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
