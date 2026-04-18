"use strict";

import { state } from "./state.js";
import { booksBlobStatus } from "./state.js";
import {
  sanitize,
  formatIsoForDisplay,
  formatRealBookPage,
} from "./utils.js?v=2";
import {
  getActiveBook,
  getBookById,
  getBookCoverPreview,
  ensureBookCoverPreview,
  refreshBookBlobStatus,
} from "./books.js";
import {
  getBookmarkLastSummarizedPage,
  getLatestBookmarkSummary,
} from "./books.js";
import { applyBookSummarySettingsToInputs } from "./encryption.js";
import { registerRenderer } from "./render-registry.js";

let booksCoverObserver = null;

function getBookCoverFallbackLabel(book) {
  const rawTitle = String((book && book.title) || "Book").trim();
  if (!rawTitle.length) return "B";
  return rawTitle.slice(0, 1).toUpperCase();
}

function renderBookCoverMarkup(book, previewDataUrl) {
  if (previewDataUrl) {
    return `<img class='books-item-cover-image' src='${previewDataUrl}' alt='${sanitize(book.title || "Book")} cover preview' loading='lazy' decoding='async'>`;
  }
  return `<div class='books-item-cover-fallback' aria-hidden='true'><span>${sanitize(getBookCoverFallbackLabel(book))}</span></div>`;
}

async function hydrateBookCoverElement(container) {
  if (!(container instanceof HTMLElement)) return;
  const bookId = String(container.dataset.bookCoverId || "");
  if (!bookId) return;
  const stateValue = String(container.dataset.bookCoverState || "");
  if (stateValue === "ready" || stateValue === "loading") return;

  container.dataset.bookCoverState = "loading";
  container.classList.add("is-loading");

  const previewDataUrl = await ensureBookCoverPreview(bookId);
  if (!container.isConnected) return;

  container.classList.remove("is-loading");
  const book = getBookById(bookId);
  container.innerHTML = renderBookCoverMarkup(
    book || { title: "Book" },
    previewDataUrl,
  );

  if (previewDataUrl) {
    container.dataset.bookCoverState = "ready";
    container.classList.remove("failed");
    container.classList.add("ready");
  } else {
    container.dataset.bookCoverState = "failed";
    container.classList.remove("ready");
    container.classList.add("failed");
  }
}

function bindBookCoverLazyLoading(root) {
  if (!(root instanceof HTMLElement)) return;
  if (booksCoverObserver) {
    booksCoverObserver.disconnect();
    booksCoverObserver = null;
  }

  const nodes = Array.from(root.querySelectorAll("[data-book-cover-id]"));
  if (!nodes.length) return;

  const eagerNodes = nodes.slice(0, Math.min(4, nodes.length));
  eagerNodes.forEach((node) => {
    const stateValue = String(node.dataset.bookCoverState || "");
    if (stateValue === "ready") return;
    hydrateBookCoverElement(node);
  });

  if (typeof IntersectionObserver !== "function") {
    nodes.forEach((node) => {
      hydrateBookCoverElement(node);
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target;
        observer.unobserve(target);
        hydrateBookCoverElement(target);
      });
    },
    {
      root: null,
      rootMargin: "120px 0px",
      threshold: 0.02,
    },
  );
  booksCoverObserver = observer;

  nodes.forEach((node) => {
    const stateValue = String(node.dataset.bookCoverState || "");
    if (stateValue === "ready") return;
    if (eagerNodes.includes(node)) return;
    observer.observe(node);
  });
}

export async function renderBooksList() {
  const list = document.getElementById("booksList");
  if (!list) return;
  if (booksCoverObserver) {
    booksCoverObserver.disconnect();
    booksCoverObserver = null;
  }

  if (state.books.items.length === 0) {
    list.innerHTML =
      "<div class='empty-state'><p>No books added yet.</p></div>";
    return;
  }

  list.innerHTML = state.books.items
    .map((book) => {
      const active = state.books.activeBookId === book.bookId ? "active" : "";
      const hasBlob = !!booksBlobStatus[book.bookId];
      const previewDataUrl = getBookCoverPreview(book.bookId);
      const coverState = previewDataUrl ? "ready" : "pending";
      const coverMarkup = renderBookCoverMarkup(book, previewDataUrl);
      return `<article class='books-item ${active}'><div class='books-item-main'><h4>${sanitize(book.title)}</h4><p>${sanitize(book.author || "Unknown author")}</p><p class='books-file-meta'>${sanitize(book.fileName)} · ${Math.round((book.fileSize || 0) / 1024)}KB</p>${hasBlob ? "" : "<p class='books-warning'>PDF blob missing in this browser storage.</p>"}<div class='books-item-actions'><button class='btn-secondary' type='button' onclick="HabitApp.setActiveBook('${book.bookId}')">Select</button><button class='btn-secondary' type='button' onclick="HabitApp.editBook('${book.bookId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBook('${book.bookId}')">Delete</button></div></div><div class='books-item-cover ${coverState === "ready" ? "ready" : "pending"}' data-book-cover-id='${sanitize(book.bookId)}' data-book-cover-state='${coverState}'>${coverMarkup}</div></article>`;
    })
    .join("");

  bindBookCoverLazyLoading(list);
}

export function renderBookmarksPanel() {
  const panel = document.getElementById("bookmarksPanel");
  if (!panel) return;

  const book = getActiveBook();
  if (!book) {
    panel.innerHTML =
      "<div class='empty-state'><p>Select a book to view bookmarks.</p></div>";
    return;
  }

  if (!Array.isArray(book.bookmarks) || book.bookmarks.length === 0) {
    panel.innerHTML =
      "<div class='empty-state'><p>No bookmarks yet. Add your first bookmark.</p></div>";
    return;
  }

  panel.innerHTML = book.bookmarks
    .map((bm) => {
      const latestSummary = getLatestBookmarkSummary(bm);
      const lastSummarizedPage = getBookmarkLastSummarizedPage(bm);
      const summaryStatus = latestSummary
        ? `Latest summary: pages ${latestSummary.startPage}-${latestSummary.endPage}`
        : "No summaries yet";
      const historyHtml = (Array.isArray(bm.history) ? bm.history : [])
        .slice(0, 8)
        .map(
          (h) =>
            `<li><div class='bookmark-history-row'><span><strong>${sanitize(h.type)}</strong> · ${sanitize(formatIsoForDisplay(h.at))}${h.note ? ` · ${sanitize(h.note)}` : ""}</span><span class='bookmark-history-actions'><button class='bookmark-history-btn' type='button' onclick="HabitApp.editHistoryEvent('${book.bookId}', '${bm.bookmarkId}', '${h.eventId}')">Edit</button><button class='bookmark-history-btn danger' type='button' onclick="HabitApp.deleteHistoryEvent('${book.bookId}', '${bm.bookmarkId}', '${h.eventId}')">Delete</button></span></div></li>`,
        )
        .join("");

      return `<article class='bookmark-item'><div class='bookmark-main'><h4>${sanitize(bm.label)}</h4><p>PDF page ${bm.pdfPage} · Real page ${formatRealBookPage(bm.realPage)}</p><p>${sanitize(bm.note || "No note")}</p><p class='bookmark-updated'>Updated ${sanitize(formatIsoForDisplay(bm.updatedAt))}</p><p class='bookmark-summary-status'>${sanitize(summaryStatus)}${lastSummarizedPage ? ` · summarized through page ${lastSummarizedPage}` : ""}</p></div><div class='bookmark-actions'><button class='btn-primary' type='button' onclick="HabitApp.openBookmark('${book.bookId}', ${bm.pdfPage}, '${bm.bookmarkId}')">Open at Bookmark</button><button class='btn-secondary bookmark-summarize-btn' type='button' data-summary-book-id='${sanitize(book.bookId)}' data-summary-bookmark-id='${sanitize(bm.bookmarkId)}' onclick="HabitApp.summarizeBookmark('${book.bookId}', '${bm.bookmarkId}')">Summarize up to Bookmark</button><button class='btn-secondary' type='button' onclick="HabitApp.viewBookmarkSummary('${book.bookId}', '${bm.bookmarkId}')">View Summaries</button><button class='btn-secondary' type='button' onclick="HabitApp.editBookmark('${book.bookId}', '${bm.bookmarkId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBookmark('${book.bookId}', '${bm.bookmarkId}')">Delete</button></div><ul class='bookmark-history'>${historyHtml || "<li>No history yet.</li>"}</ul></article>`;
    })
    .join("");
}

export async function renderBooksView() {
  await refreshBookBlobStatus();
  await renderBooksList();
  renderBookmarksPanel();
  applyBookSummarySettingsToInputs();
}

registerRenderer("renderBooksView", renderBooksView);
