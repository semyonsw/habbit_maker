"use strict";

import { PDFJS_SCRIPT_URLS, PDFJS_WORKER_URL } from "./constants.js";
import { readerState } from "./state.js";
import { appendLogEntry } from "./logging.js";
import { idbGetPdfBlob } from "./idb.js";
import { clampNumber } from "./utils.js?v=2";
import { getBookById, addBookmarkOnCurrentReaderPage } from "./books.js";
import { callRenderer, registerRenderer } from "./render-registry.js";
import {
  loadReaderThemePreferences,
  applyReaderThemeClasses,
  updateReaderThemeControls,
  toggleReaderDarkTheme,
  setReaderDarkMode,
} from "./preferences.js";
import {
  showGlobalLoader,
  hideGlobalLoader,
  waitForNextPaint,
} from "./loading-ui.js";
import * as db from "./db.js";

export function loadScriptTag(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-pdfjs-url="${url}"]`);

    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve();
        return;
      }
      if (existing.dataset.failed === "1") {
        reject(new Error(`Script failed earlier: ${url}`));
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load script: ${url}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.dataset.pdfjsUrl = url;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "1";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.dataset.failed = "1";
        reject(new Error(`Failed to load script: ${url}`));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });
}

export async function ensurePdfJsLibLoaded() {
  if (window.pdfjsLib && typeof window.pdfjsLib.getDocument === "function") {
    return window.pdfjsLib;
  }

  for (const url of PDFJS_SCRIPT_URLS) {
    try {
      await loadScriptTag(url);
    } catch (_) {
      continue;
    }

    if (window.pdfjsLib && typeof window.pdfjsLib.getDocument === "function") {
      return window.pdfjsLib;
    }
  }

  return null;
}

export async function renderPdfPagePreviewDataUrl(pdfDoc, options = {}) {
  if (!pdfDoc || typeof pdfDoc.getPage !== "function") {
    return null;
  }

  const pageNumber = Math.max(1, parseInt(options.pageNumber, 10) || 1);
  const maxWidth = Math.max(120, parseInt(options.maxWidth, 10) || 180);
  const qualityRaw = Number(options.quality);
  const quality = Number.isFinite(qualityRaw)
    ? Math.min(0.95, Math.max(0.35, qualityRaw))
    : 0.76;

  try {
    const safePage = Math.min(pageNumber, Math.max(1, pdfDoc.numPages || 1));
    const page = await pdfDoc.getPage(safePage);
    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = Math.max(0.1, maxWidth / Math.max(1, baseViewport.width));
    const viewport = page.getViewport({ scale: cssScale });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;

    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));

    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform: [outputScale, 0, 0, outputScale, 0, 0],
    });
    await renderTask.promise;

    const preview = canvas.toDataURL("image/jpeg", quality);
    canvas.width = 0;
    canvas.height = 0;
    return preview;
  } catch (error) {
    appendLogEntry({
      level: "warn",
      component: "pdf-reader",
      operation: "renderPdfPagePreviewDataUrl",
      message: "Failed to render PDF preview image.",
      error,
    });
    return null;
  }
}

// Loads a book into the reader section and renders `targetPage`.
//
// Shared by the standalone `?reader=1` URL and by the in-page reader, so both
// behave identically -- including landing on the bookmarked page rather than
// page 1.
async function startReader(bookId, targetPage, sourceBookmarkId) {
  const statusEl = document.getElementById("readerStatusText");
  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  await loadReaderThemePreferences();
  applyReaderThemeClasses();

  const closeBtn = document.getElementById("readerClose");
  if (closeBtn) closeBtn.style.display = readerState.isInPage ? "" : "none";

  const book = getBookById(bookId);
  if (!book) {
    setStatus("Book metadata not found.");
    return false;
  }

  const safeTargetPage = Math.max(1, parseInt(targetPage, 10) || 1);
  readerState.book = book;
  readerState.sourceBookmarkId = sourceBookmarkId || null;
  readerState.sourcePage = safeTargetPage;
  document.getElementById("readerBookTitle").textContent = book.title;

  let blob = null;
  try {
    blob = await idbGetPdfBlob(book.fileId);
  } catch (_) {
    blob = null;
  }
  if (!blob) {
    setStatus("No PDF file on this device — use “Choose PDF file”.");
    return false;
  }

  const pdfjsLib = await ensurePdfJsLibLoaded();
  if (!pdfjsLib) {
    setStatus("PDF.js failed to load. Check your internet and refresh.");
    return false;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

  const url = URL.createObjectURL(blob);
  let loaded = false;
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    readerState.pdfDoc = await loadingTask.promise;
    readerState.totalPages = readerState.pdfDoc.numPages;
    setStatus("Loaded");
    await renderReaderPage(Math.min(safeTargetPage, readerState.totalPages));
    loaded = true;
  } catch (_) {
    setStatus("Failed to open PDF.");
  } finally {
    URL.revokeObjectURL(url);
  }

  bindReaderEvents();
  updateReaderThemeControls();
  updateReaderBookmarkButton();
  return loaded;
}

export async function initReaderMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reader") !== "1") {
    return false;
  }

  showGlobalLoader("Opening bookmark...");
  await waitForNextPaint();

  try {
    document.getElementById("app").style.display = "none";
    document.getElementById("readerMode").style.display = "block";
    document.documentElement.classList.add("reader-open");
    readerState.isInPage = false;
    await startReader(
      params.get("book") || "",
      parseInt(params.get("page"), 10) || 1,
      params.get("bookmark") || "",
    );
    return true;
  } finally {
    hideGlobalLoader();
  }
}

// Opens the reader over the app without navigating.
//
// The old path opened `?reader=1` in a new tab, which does not work in the
// Android build at all: Capacitor's WebView routes window.open() to an external
// browser, and https://habitmaker.app only resolves inside the WebView, so
// "Open at Bookmark" went nowhere. Swapping the two sections keeps everything
// in one document, so it works identically on the phone and on the desktop and
// costs no reload.
export async function openReaderInPage(bookId, page, bookmarkId) {
  const appRoot = document.getElementById("app");
  const readerRoot = document.getElementById("readerMode");
  if (!appRoot || !readerRoot) return;

  showGlobalLoader("Opening bookmark...");
  await waitForNextPaint();

  try {
    await closeReaderDocument();
    appRoot.style.display = "none";
    readerRoot.style.display = "block";
    // Hides the floating hamburger, which is fixed to the same top-left corner
    // as the reader's back button.
    document.documentElement.classList.add("reader-open");
    if (!readerState.isInPage) {
      // Own a history entry so Android's back gesture leaves the reader instead
      // of leaving the app, exactly as it does for the dialogs.
      try {
        window.history.pushState({ reader: true }, "");
        readerState.ownsHistoryEntry = true;
      } catch (_) {
        /* embedded contexts without history; the Close button still works */
        readerState.ownsHistoryEntry = false;
      }
    }
    readerState.isInPage = true;
    window.scrollTo({ top: 0 });
    await startReader(bookId, page, bookmarkId || "");
  } finally {
    hideGlobalLoader();
  }
}

async function closeReaderDocument() {
  if (readerState.renderTask) {
    try {
      readerState.renderTask.cancel();
    } catch (_) {}
    readerState.renderTask = null;
  }
  if (readerState.pdfDoc && typeof readerState.pdfDoc.destroy === "function") {
    try {
      await readerState.pdfDoc.destroy();
    } catch (_) {}
  }
  readerState.pdfDoc = null;
  readerState.totalPages = 0;
  readerState.currentPage = 1;
}

let closingReaderFromPopstate = false;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (!readerState.isInPage || !readerState.ownsHistoryEntry) return;
    // Closing a dialog also pops a history entry -- its own -- and by the time
    // popstate fires modals.js has already stripped the .open class, so "is a
    // dialog open?" cannot tell the two cases apart. The entry we landed on
    // can: back out of a dialog and the reader's own entry is still current.
    if (window.history.state && window.history.state.reader) return;
    closingReaderFromPopstate = true;
    closeReaderInPage().finally(() => {
      closingReaderFromPopstate = false;
    });
  });
}

export async function closeReaderInPage() {
  if (!readerState.isInPage) return;
  readerState.isInPage = false;

  // Pop on the flag, not on history.state: a dialog closed a moment earlier
  // has its own back() still in flight, so the current entry may still read as
  // that dialog's. Trusting it there leaves the reader's entry on the stack and
  // the next back press does nothing visible.
  const owesHistoryPop =
    readerState.ownsHistoryEntry && !closingReaderFromPopstate;
  readerState.ownsHistoryEntry = false;
  if (owesHistoryPop) {
    try {
      window.history.back();
    } catch (_) {}
  }

  await closeReaderDocument();

  readerState.book = null;
  readerState.sourceBookmarkId = null;
  readerState.sourcePage = null;

  const canvas = document.getElementById("readerCanvas");
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }

  document.getElementById("readerMode").style.display = "none";
  document.getElementById("app").style.display = "";
  document.documentElement.classList.remove("reader-open");
  await callRenderer("renderBooksView");
}

registerRenderer("openReaderInPage", openReaderInPage);

export async function renderReaderPage(pageNumber) {
  if (!readerState.pdfDoc) return;

  const safePage = Math.max(1, Math.min(pageNumber, readerState.totalPages));
  readerState.currentPage = safePage;

  const page = await readerState.pdfDoc.getPage(safePage);
  const baseViewport = page.getViewport({ scale: 1 });
  const canvasWrap = document.querySelector(".reader-canvas-wrap");
  const availableWidth = Math.max(
    240,
    (canvasWrap ? canvasWrap.clientWidth : window.innerWidth) - 24,
  );
  // Fit to width, then apply the user's zoom. The old formula clamped with
  // Math.max(1.4, ...), so a 612pt page never rendered narrower than ~857px and
  // could not fit a phone at all.
  const fitScale = availableWidth / baseViewport.width;
  const cssScale = clampNumber(fitScale * (readerState.zoom || 1), 0.4, 4);
  const viewport = page.getViewport({ scale: cssScale });

  // Cap the backing store. At dpr 3 and zoom 3 the naive figure is ~56M pixels,
  // past iOS Safari's per-canvas budget, where it silently yields a blank page.
  const maxCanvasPx = window.matchMedia("(pointer: coarse)").matches
    ? 4e6
    : 16e6;
  const area = Math.max(1, viewport.width * viewport.height);
  const outputScale = Math.max(
    1,
    Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(maxCanvasPx / area)),
  );

  const canvas = document.getElementById("readerCanvas");
  const ctx = canvas.getContext("2d");
  // Release the previous backing store before allocating the next one.
  canvas.width = 0;
  canvas.height = 0;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  if (readerState.renderTask) {
    try {
      readerState.renderTask.cancel();
    } catch (_) {}
  }

  readerState.renderTask = page.render({
    canvasContext: ctx,
    viewport,
    transform: [outputScale, 0, 0, outputScale, 0, 0],
  });
  try {
    await readerState.renderTask.promise;
  } catch (error) {
    // Turning pages quickly cancels the in-flight render. That rejection is
    // expected; letting it escape reaches window.onunhandledrejection and pops
    // the full-screen error banner during perfectly normal reading.
    if (error && error.name === "RenderingCancelledException") return;
    throw error;
  }
  applyReaderThemeClasses();

  document.getElementById("readerPageIndicator").textContent =
    `${readerState.currentPage} / ${readerState.totalPages}`;
  document.getElementById("readerJumpPage").value = String(
    readerState.currentPage,
  );
}

// Jump the reader to a page from outside this module (the bookmark panel).
export function goToReaderPage(pageNumber) {
  if (!readerState.pdfDoc) return;
  renderReaderPageSafe(pageNumber);
  const container = document.getElementById("readerBookContainer");
  setTimeout(() => {
    if (container) container.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, 10);
}

// Every caller is a click handler, so a rejection here would be unhandled.
function renderReaderPageSafe(pageNumber) {
  renderReaderPage(pageNumber).catch((error) => {
    appendLogEntry({
      level: "error",
      component: "reader",
      operation: "renderReaderPage",
      message: "Rendering a PDF page failed.",
      error,
      context: { pageNumber },
    });
  });
}

// Keeps the reader's bookmark button honest about what it will do: on the page
// a bookmark was opened at, tapping it logs a reading session against that
// bookmark; anywhere else it offers to create or move one.
export function updateReaderBookmarkButton() {
  const button = document.getElementById("readerBookmarksBtn");
  if (!button) return;
  const book = readerState.book;
  const count =
    book && Array.isArray(book.bookmarks) ? book.bookmarks.length : 0;
  button.textContent = count ? `Bookmarks (${count})` : "Bookmarks";
}

export function bindReaderEvents() {
  // Re-entrant: the in-page reader calls this every time a book is opened, and
  // a second set of listeners would turn one tap into two page turns.
  if (readerState.eventsBound) {
    updateReaderThemeControls();
    return;
  }
  readerState.eventsBound = true;

  const prev = document.getElementById("readerPrevPage");
  const next = document.getElementById("readerNextPage");
  const go = document.getElementById("readerGoPage");
  const jump = document.getElementById("readerJumpPage");
  const addBookmarkOnPage = document.getElementById("readerAddBookmarkOnPage");
  const darkToggle = document.getElementById("readerDarkToggle");
  const darkMode = document.getElementById("readerDarkMode");
  const zoomIn = document.getElementById("readerZoomIn");
  const zoomOut = document.getElementById("readerZoomOut");
  const bookContainer = document.getElementById("readerBookContainer");
  const tapPrev = document.getElementById("readerTapPrev");
  const tapNext = document.getElementById("readerTapNext");

  // Zoom re-renders the page at the new scale instead of CSS-scaling the
  // scroll container. The old transform approach produced a blurry upscale and
  // made panning impossible, because it scaled the scrollport itself.
  function setZoom(next) {
    readerState.zoom = clampNumber(next, 0.5, 3);
    renderReaderPageSafe(readerState.currentPage);
    db.patchPrefs({ readerZoomLevel: readerState.zoom }).catch(() => {});
  }
  zoomIn.addEventListener("click", () => setZoom((readerState.zoom || 1) + 0.15));
  zoomOut.addEventListener("click", () =>
    setZoom((readerState.zoom || 1) - 0.15),
  );

  // Load zoom from storage (same pref key as before).
  db.getPrefs()
    .then((prefs) => {
      const savedZoom = parseFloat(prefs && prefs.readerZoomLevel);
      if (!isNaN(savedZoom)) {
        readerState.zoom = clampNumber(savedZoom, 0.5, 3);
        renderReaderPageSafe(readerState.currentPage);
      }
    })
    .catch(() => {});

  function scrollBookToTop() {
    if (bookContainer) {
      bookContainer.scrollTop = 0;
      bookContainer.parentElement.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function goToPage(pageNumber) {
    renderReaderPageSafe(pageNumber);
    setTimeout(scrollBookToTop, 10);
  }

  prev.addEventListener("click", () => goToPage(readerState.currentPage - 1));
  next.addEventListener("click", () => goToPage(readerState.currentPage + 1));
  go.addEventListener("click", () => goToPage(parseInt(jump.value, 10) || 1));
  jump.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goToPage(parseInt(jump.value, 10) || 1);
  });

  // Touch page-turn zones. Null-guarded: bindReaderEvents already does several
  // unguarded lookups, and a missing id here would abort reader setup.
  if (tapPrev) {
    tapPrev.addEventListener("click", () =>
      goToPage(readerState.currentPage - 1),
    );
  }
  if (tapNext) {
    tapNext.addEventListener("click", () =>
      goToPage(readerState.currentPage + 1),
    );
  }

  darkToggle.addEventListener("click", () => {
    toggleReaderDarkTheme();
  });

  darkMode.addEventListener("change", (e) => {
    setReaderDarkMode(e.target.value);
  });

  addBookmarkOnPage.addEventListener("click", () => {
    addBookmarkOnCurrentReaderPage();
  });

  const bookmarksBtn = document.getElementById("readerBookmarksBtn");
  if (bookmarksBtn) {
    bookmarksBtn.addEventListener("click", () => {
      callRenderer("openReaderBookmarksPanel");
    });
  }

  // Only meaningful for the in-page reader; the standalone ?reader=1 tab has
  // nothing to go back to, so the button stays hidden there (see index.html).
  const closeBtn = document.getElementById("readerClose");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeReaderInPage().catch(() => {});
    });
  }

  if (!readerState.resizeHandlerBound) {
    window.addEventListener("resize", () => {
      if (!readerState.pdfDoc) return;
      if (readerState.resizeTimer) {
        clearTimeout(readerState.resizeTimer);
      }
      readerState.resizeTimer = setTimeout(() => {
        renderReaderPageSafe(readerState.currentPage);
      }, 120);
    });
    readerState.resizeHandlerBound = true;
  }
}
