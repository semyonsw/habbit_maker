"use strict";

import { PDFJS_SCRIPT_URLS, PDFJS_WORKER_URL } from "./constants.js";
import { readerState } from "./state.js";
import { appendLogEntry } from "./logging.js";
import { idbGetPdfBlob } from "./idb.js";
import { getBookById, addBookmarkOnCurrentReaderPage } from "./books.js";
import {
  loadReaderThemePreferences,
  applyReaderThemeClasses,
  updateReaderThemeControls,
  toggleReaderDarkTheme,
  setReaderDarkMode,
} from "./preferences.js";
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
}

export async function renderReaderPage(pageNumber) {
  if (!readerState.pdfDoc) return;

  const safePage = Math.max(1, Math.min(pageNumber, readerState.totalPages));
  readerState.currentPage = safePage;

  const page = await readerState.pdfDoc.getPage(safePage);
  const baseViewport = page.getViewport({ scale: 1 });
  const canvasWrap = document.querySelector(".reader-canvas-wrap");
  const availableWidth = Math.max(
    320,
    (canvasWrap ? canvasWrap.clientWidth : window.innerWidth) - 24,
  );
  const fitScale = availableWidth / baseViewport.width;
  const cssScale = Math.max(1.4, Math.min(fitScale, 2.6));
  const viewport = page.getViewport({ scale: cssScale });

  const outputScale = Math.min(window.devicePixelRatio || 1, 3);
  const canvas = document.getElementById("readerCanvas");
  const ctx = canvas.getContext("2d");
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
  await readerState.renderTask.promise;
  applyReaderThemeClasses();

  document.getElementById("readerPageIndicator").textContent =
    `${readerState.currentPage} / ${readerState.totalPages}`;
  document.getElementById("readerJumpPage").value = String(
    readerState.currentPage,
  );
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

  // Zoom state
  let zoomLevel = 1;
  function applyZoom() {
    bookContainer.style.transform = `scale(${zoomLevel})`;
    bookContainer.style.transformOrigin = "top center";
  }
  zoomIn.addEventListener("click", () => {
    zoomLevel = Math.min(zoomLevel + 0.1, 2.5);
    applyZoom();
    db.patchPrefs({ readerZoomLevel: zoomLevel }).catch(() => {});
  });
  zoomOut.addEventListener("click", () => {
    zoomLevel = Math.max(zoomLevel - 0.1, 0.5);
    applyZoom();
    db.patchPrefs({ readerZoomLevel: zoomLevel }).catch(() => {});
  });
  // Load zoom from storage
  db.getPrefs()
    .then((prefs) => {
      const savedZoom = parseFloat(prefs && prefs.readerZoomLevel);
      if (!isNaN(savedZoom)) {
        zoomLevel = savedZoom;
        applyZoom();
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

  prev.addEventListener("click", () => {
    renderReaderPage(readerState.currentPage - 1);
    setTimeout(scrollBookToTop, 10);
  });
  next.addEventListener("click", () => {
    renderReaderPage(readerState.currentPage + 1);
    setTimeout(scrollBookToTop, 10);
  });
  go.addEventListener("click", () => {
    renderReaderPage(parseInt(jump.value, 10) || 1);
    setTimeout(scrollBookToTop, 10);
  });
  jump.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      renderReaderPage(parseInt(jump.value, 10) || 1);
      setTimeout(scrollBookToTop, 10);
    }
  });

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
        renderReaderPage(readerState.currentPage);
      }, 120);
    });
    readerState.resizeHandlerBound = true;
  }
}
