"use strict";

import { PDFJS_SCRIPT_URLS, PDFJS_WORKER_URL } from "./constants.js";
import { readerState } from "./state.js";
import { appendLogEntry } from "./logging.js";
import { idbGetPdfBlob } from "./idb.js";
import { clampNumber } from "./utils.js?v=2";
import { getBookById, addBookmarkOnCurrentReaderPage } from "./books.js";
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

export async function initReaderMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reader") !== "1") {
    return false;
  }

  showGlobalLoader("Opening bookmark...");
  await waitForNextPaint();

  try {
    document.getElementById("app").style.display = "none";
    const readerRoot = document.getElementById("readerMode");
    readerRoot.style.display = "block";
    await loadReaderThemePreferences();
    applyReaderThemeClasses();

    const bookId = params.get("book") || "";
    const targetPage = Math.max(1, parseInt(params.get("page"), 10) || 1);
    const sourceBookmarkId = params.get("bookmark") || "";
    const book = getBookById(bookId);
    if (!book) {
      document.getElementById("readerStatusText").textContent =
        "Book metadata not found.";
      return true;
    }

    readerState.book = book;
    readerState.sourceBookmarkId = sourceBookmarkId || null;
    readerState.sourcePage = targetPage;
    document.getElementById("readerBookTitle").textContent = book.title;

    let blob = null;
    try {
      blob = await idbGetPdfBlob(book.fileId);
    } catch (_) {
      blob = null;
    }
    if (!blob) {
      document.getElementById("readerStatusText").textContent =
        "PDF file is missing in IndexedDB for this browser.";
      return true;
    }

    const pdfjsLib = await ensurePdfJsLibLoaded();
    if (!pdfjsLib) {
      document.getElementById("readerStatusText").textContent =
        "PDF.js failed to load. Check your internet and refresh.";
      return true;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

    const url = URL.createObjectURL(blob);
    try {
      const loadingTask = pdfjsLib.getDocument(url);
      readerState.pdfDoc = await loadingTask.promise;
      readerState.totalPages = readerState.pdfDoc.numPages;
      document.getElementById("readerStatusText").textContent = "Loaded";
      await renderReaderPage(Math.min(targetPage, readerState.totalPages));
    } catch (_) {
      document.getElementById("readerStatusText").textContent =
        "Failed to open PDF.";
    } finally {
      URL.revokeObjectURL(url);
    }

    bindReaderEvents();
    updateReaderThemeControls();
    return true;
  } finally {
    hideGlobalLoader();
  }
}

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

export function bindReaderEvents() {
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
