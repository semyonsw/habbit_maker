"use strict";

import {
  MAX_PDF_FILE_SIZE_MB,
  MAX_PDF_FILE_SIZE_BYTES,
  MAX_BOOKMARK_HISTORY,
} from "./constants.js";
import {
  state,
  setBooksBlobStatus,
  booksBlobStatus,
} from "./state.js";
import { uid, nowIso, isPlainObject } from "./utils.js?v=2";
import { appendLogEntry } from "./logging.js";
import { idbGetPdfBlob, idbSavePdfBlob } from "./idb.js";
import { saveState } from "./persistence.js";
import { callRenderer } from "./render-registry.js";
import { openPdfExternally, isNative } from "./native.js";

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

/* ---------------------------------------------------------- the book's file */

// Android's document picker hands back files whose `type` is "" or
// "application/octet-stream" depending on which file manager answered the
// intent, so the MIME type cannot be required -- only trusted when present.
// Returns an error string, or "" when the file is usable.
export function describeBookFileProblem(file) {
  if (!file) return "Choose a PDF file first.";
  const looksLikePdf =
    /\.pdf$/i.test(file.name || "") ||
    String(file.type || "") === "application/pdf";
  if (!looksLikePdf) return "Only PDF files are supported.";
  if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
    return `PDF file is too large. Maximum size is ${MAX_PDF_FILE_SIZE_MB}MB.`;
  }
  if (!file.size) return "That file is empty.";
  return "";
}

// Which book the hidden "choose a file" input is currently picking for.
let pendingFilePickBookId = null;

// Points an existing book at a different PDF, keeping its fileId -- and
// therefore every bookmark, history entry and summary attached to it.
//
// This is what makes an imported metadata-only backup usable: the books arrive
// with a fileId that has no bytes behind it (the PDF paths in a backup are the
// PC's, meaningless on a phone), and this attaches the phone's own copy.
export async function replaceBookFile(bookId, file) {
  const book = getBookById(bookId);
  if (!book) return false;

  const problem = describeBookFileProblem(file);
  if (problem) {
    alert(problem);
    return false;
  }

  const isReplacement = !!booksBlobStatus[bookId];
  setBookUploadStatus(`Linking ${file.name} to "${book.title}"...`, "pending");

  if (!book.fileId) book.fileId = uid("file");
  await idbSavePdfBlob(book.fileId, file);

  book.fileName = file.name;
  book.fileSize = file.size;
  book.updatedAt = nowIso();
  saveState();

  // The cached cover belongs to the old bytes.

  setBookUploadStatus(
    `${isReplacement ? "Replaced" : "Linked"} the file for "${book.title}": ${file.name}.`,
    "success",
  );

  await refreshBookBlobStatus();
  await callRenderer("renderBooksView");
  // The Edit Book dialog stays open behind the picker, so its file row has to
  // catch up too.
  callRenderer("refreshBookModalFileRow");
  return true;
}

// Opens the system file picker for one specific book. On Android this is the
// normal document picker, so it reaches internal storage, the SD card, Drive --
// anywhere the phone can read from.
export function chooseBookFile(bookId) {
  const book = getBookById(bookId);
  if (!book) return;
  const input = document.getElementById("bookFilePickerInput");
  if (!input) return;
  pendingFilePickBookId = bookId;
  input.value = "";
  input.click();
}

export async function handleBookFilePicked() {
  const input = document.getElementById("bookFilePickerInput");
  const bookId = pendingFilePickBookId;
  pendingFilePickBookId = null;
  if (!input || !bookId) return;

  const file = input.files && input.files[0] ? input.files[0] : null;
  input.value = "";
  if (!file) return;

  try {
    await replaceBookFile(bookId, file);
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "books",
      operation: "handleBookFilePicked",
      message: "Attaching a picked PDF to a book failed.",
      error,
      context: { bookId },
    });
    setBookUploadStatus("Could not save that file. Please try again.", "error");
    alert("Could not save that file. Please try again.");
  }
}

/* -------------------------------------------------- opening a bookmark page */

// "Open at Bookmark" hands the file to the phone's own PDF app. The in-app
// reader that used to be the other half of this choice is gone.
export function openBookmarkTarget(bookId, page) {
  const book = getBookById(bookId);
  if (!book) return;
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  openBookInExternalViewer(bookId, safePage).catch((error) => {
    logBookOpenFailure("openBookInExternalViewer", error, bookId);
  });
}

function logBookOpenFailure(operation, error, bookId) {
  appendLogEntry({
    level: "error",
    component: "books",
    operation,
    message: "Opening a book failed.",
    error,
    context: { bookId },
  });
}

function openBlankTab() {
  try {
    const tab = window.open("", "_blank");
    if (tab) {
      try {
        tab.opener = null;
      } catch (_) {}
    }
    return tab;
  } catch (_) {
    return null;
  }
}

// Hands the PDF to another app. On Android that is a real ACTION_VIEW through
// src/native.js; in a browser it is a new tab, where the built-in PDF viewers
// do honour #page= and so still land on the right page.
export async function openBookInExternalViewer(bookId, page) {
  const book = getBookById(bookId);
  if (!book) return;
  const safePage = Math.max(1, parseInt(page, 10) || 1);

  // In a browser the tab has to be claimed synchronously, while the click is
  // still the current task: reading the blob is async, and a window.open() on
  // the far side of an await is a pop-up, not a user action. Not on Android,
  // where the file goes to another app entirely and a blank tab would just be
  // litter.
  // Deliberately no "noopener" feature: with it, window.open returns null by
  // spec, and the handle is the whole point here. Severing .opener afterwards
  // gets the same protection.
  let pendingTab = isNative() ? null : openBlankTab();

  let blob = null;
  try {
    blob = await idbGetPdfBlob(book.fileId);
  } catch (_) {
    blob = null;
  }
  if (!blob) {
    if (pendingTab) pendingTab.close();
    alert(
      `"${book.title}" has no PDF file on this device yet.\n\nUse "Choose PDF file" on the book to pick it from your storage.`,
    );
    return;
  }

  const handledNatively = await openPdfExternally(blob, {
    fileName: book.fileName || `${book.title}.pdf`,
    cacheKey: book.fileId,
    page: safePage,
  });

  if (handledNatively) {
    setBookUploadStatus(
      `Opened "${book.title}" in your PDF app. The bookmark is on page ${safePage}.`,
      "success",
    );
    return;
  }

  // Browser fallback, and the path taken when the phone has no PDF app: the
  // built-in viewers honour #page=, so this still lands on the bookmark.
  const url = URL.createObjectURL(blob);
  const target = pendingTab || openBlankTab();
  if (!target) {
    URL.revokeObjectURL(url);
    alert(
      "Your browser blocked the new tab. Allow pop-ups for this app, or switch the open mode to the in-app reader.",
    );
    return;
  }
  target.location.href = `${url}#page=${safePage}`;
  // The blob URL has to outlive the new tab's load. It is only a handle into
  // memory this page already holds, so a generous delay costs nothing.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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
  const fileProblem = describeBookFileProblem(file);
  if (fileProblem) {
    setBookUploadStatus(fileProblem, "error");
    alert(fileProblem);
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
