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
  refreshBookBlobStatus,
} from "./books.js";
import { registerRenderer } from "./render-registry.js";

function getBookCoverFallbackLabel(book) {
  const rawTitle = String((book && book.title) || "Book").trim();
  if (!rawTitle.length) return "B";
  return rawTitle.slice(0, 1).toUpperCase();
}

function renderBookCoverMarkup(book) {
  return `<div class='books-item-cover-fallback' aria-hidden='true'><span>${sanitize(getBookCoverFallbackLabel(book))}</span></div>`;
}

export async function renderBooksList() {
  const list = document.getElementById("booksList");
  if (!list) return;

  if (state.books.items.length === 0) {
    list.innerHTML =
      "<div class='empty-state'><p>No books added yet.</p></div>";
    return;
  }

  list.innerHTML = state.books.items
    .map((book) => {
      const active = state.books.activeBookId === book.bookId ? "active" : "";
      const hasBlob = !!booksBlobStatus[book.bookId];
      const coverMarkup = renderBookCoverMarkup(book);

      // A book with no bytes on this device is the normal state right after
      // importing a backup that carried metadata only: the file path in it was
      // the PC's. Say that, and put the fix directly under it.
      const missingFileMarkup = hasBlob
        ? ""
        : `<div class='books-missing-file'><p class='books-warning'>No PDF file on this device yet.</p><button class='btn-primary' type='button' onclick="HabitApp.chooseBookFile('${book.bookId}')">Choose PDF file</button></div>`;

      const readButton = hasBlob
        ? `<button class='btn-primary' type='button' onclick="HabitApp.readBook('${book.bookId}')">Read</button>`
        : "";

      return `<article class='books-item ${active}'><div class='books-item-main'><h4>${sanitize(book.title)}</h4><p>${sanitize(book.author || "Unknown author")}</p><p class='books-file-meta'>${sanitize(book.fileName)} · ${Math.round((book.fileSize || 0) / 1024)}KB</p>${missingFileMarkup}<div class='books-item-actions'><button class='btn-secondary' type='button' onclick="HabitApp.setActiveBook('${book.bookId}')">Select</button>${readButton}<button class='btn-secondary' type='button' onclick="HabitApp.editBook('${book.bookId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBook('${book.bookId}')">Delete</button></div></div><div class='books-item-cover'>${coverMarkup}</div></article>`;
    })
    .join("");
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

  // The bookmarks themselves stay usable (editing) without the PDF;
  // only opening them needs the file, so this is a banner rather than a block.
  const missingFileBanner = booksBlobStatus[book.bookId]
    ? ""
    : `<div class='books-missing-file'><p class='books-warning'>"${sanitize(book.title)}" has no PDF file on this device, so these bookmarks cannot be opened yet.</p><button class='btn-primary' type='button' onclick="HabitApp.chooseBookFile('${book.bookId}')">Choose PDF file</button></div>`;

  if (!Array.isArray(book.bookmarks) || book.bookmarks.length === 0) {
    panel.innerHTML = `${missingFileBanner}<div class='empty-state'><p>No bookmarks yet. Add your first bookmark.</p></div>`;
    return;
  }

  const bookmarksHtml = book.bookmarks
    .map((bm) => {
      const historyHtml = (Array.isArray(bm.history) ? bm.history : [])
        .slice(0, 8)
        .map(
          (h) =>
            `<li><div class='bookmark-history-row'><span><strong>${sanitize(h.type)}</strong> · ${sanitize(formatIsoForDisplay(h.at))}${h.note ? ` · ${sanitize(h.note)}` : ""}</span><span class='bookmark-history-actions'><button class='bookmark-history-btn' type='button' onclick="HabitApp.editHistoryEvent('${book.bookId}', '${bm.bookmarkId}', '${h.eventId}')">Edit</button><button class='bookmark-history-btn danger' type='button' onclick="HabitApp.deleteHistoryEvent('${book.bookId}', '${bm.bookmarkId}', '${h.eventId}')">Delete</button></span></div></li>`,
        )
        .join("");

      return `<article class='bookmark-item'><div class='bookmark-main'><h4>${sanitize(bm.label)}</h4><p>PDF page ${bm.pdfPage} · Real page ${formatRealBookPage(bm.realPage)}</p><p>${sanitize(bm.note || "No note")}</p><p class='bookmark-updated'>Updated ${sanitize(formatIsoForDisplay(bm.updatedAt))}</p></div><div class='bookmark-actions'><button class='btn-primary' type='button' onclick="HabitApp.openBookmark('${book.bookId}', ${bm.pdfPage}, '${bm.bookmarkId}')">Open at Bookmark</button><button class='btn-secondary' type='button' onclick="HabitApp.editBookmark('${book.bookId}', '${bm.bookmarkId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBookmark('${book.bookId}', '${bm.bookmarkId}')">Delete</button></div><ul class='bookmark-history'>${historyHtml || "<li>No history yet.</li>"}</ul></article>`;
    })
    .join("");

  panel.innerHTML = missingFileBanner + bookmarksHtml;
}

export async function renderBooksView() {
  await refreshBookBlobStatus();
  await renderBooksList();
  renderBookmarksPanel();
}

registerRenderer("renderBooksView", renderBooksView);
