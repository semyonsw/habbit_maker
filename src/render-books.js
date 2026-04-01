"use strict";

import { state } from "./state.js";
import {
  chartInstances,
  booksBlobStatus,
  summaryModalState,
  finisherState,
} from "./state.js";
import {
  sanitize,
  getHeatColor,
  monthKey,
  getValueColor,
  formatIsoForDisplay,
  formatRealBookPage,
} from "./utils.js";
import {
  getActiveBook,
  getBookById,
  buildBooksAnalytics,
  computeBookFinisherPlan,
  getSelectedFinisherBook,
  getOrInitBooksHelperState,
  getEffectiveBookTotalPages,
  getBookMaxBookmarkPage,
  formatShortDateLabel,
  formatDateInputValue,
  round1,
  refreshBookBlobStatus,
  detectBookTotalPages,
} from "./books.js";
import {
  getBookmarkLastSummarizedPage,
  getReadySummariesFromBookmark,
  getLatestBookmarkSummary,
  floorToDayTime,
} from "./books.js";
import { saveState } from "./persistence.js";
import { applyBookSummarySettingsToInputs } from "./encryption.js";
import {
  getBooksAnalyticsRangeDays,
  syncBooksRangeControls,
} from "./preferences.js";
import { registerRenderer, callRenderer } from "./render-registry.js";

export function renderBooksStatsOverview(analytics) {
  const kpisEl = document.getElementById("booksStatsOverview");
  const topEl = document.getElementById("booksStatsTopBook");
  const byBookEl = document.getElementById("booksStatsByBook");
  if (!kpisEl || !topEl || !byBookEl) return;

  if (!analytics.perBook.length) {
    kpisEl.innerHTML =
      "<p class='books-stats-empty'>No books yet. Add a book and bookmark reading pages to unlock statistics.</p>";
    topEl.innerHTML = "";
    byBookEl.innerHTML = "";
    return;
  }

  const overall = analytics.overall;
  kpisEl.innerHTML = [
    { label: "Range", value: analytics.rangeLabel },
    {
      label: "Books with progress",
      value: `${overall.booksWithProgress}/${overall.booksTracked}`,
    },
    { label: "Avg pages/day", value: round1(overall.avgPerDay).toFixed(1) },
    { label: "Avg pages/week", value: round1(overall.avgPerWeek).toFixed(1) },
    {
      label: "Total pages advanced",
      value: String(Math.round(overall.totalPages)),
    },
    { label: "Bookmark events", value: String(overall.totalEvents) },
  ]
    .map(
      (item) =>
        `<article class='books-kpi-card'><p>${sanitize(item.label)}</p><h4>${sanitize(item.value)}</h4></article>`,
    )
    .join("");

  if (overall.topBook) {
    topEl.innerHTML = `<article class='books-top-book-card'><h4>Top Performing Book</h4><p class='books-top-book-title'>${sanitize(overall.topBook.title)}</p><p>${sanitize(overall.topBook.author)}</p><div class='books-top-book-meta'><span>${round1(overall.topBook.avgPerDay).toFixed(1)} pages/day</span><span>${round1(overall.topBook.avgPerWeek).toFixed(1)} pages/week</span><span>${Math.round(overall.topBook.pagesNet)} pages advanced</span></div></article>`;
  } else {
    topEl.innerHTML =
      "<p class='books-stats-empty'>Need at least two bookmark events to estimate reading pace.</p>";
  }

  byBookEl.innerHTML = analytics.perBook
    .map((book) => {
      const confidence =
        book.insufficientData || book.eventCount < 3 || book.calendarDays < 7
          ? "<span class='books-low-confidence'>Low confidence</span>"
          : "";
      return `<article class='books-book-stat-card'><div class='books-book-stat-head'><h4>${sanitize(book.title)}</h4>${confidence}</div><p>${sanitize(book.author)}</p><div class='books-book-stat-grid'><span>Pages advanced: <strong>${Math.round(book.pagesNet)}</strong></span><span>Avg/day: <strong>${round1(book.avgPerDay).toFixed(1)}</strong></span><span>Avg/week: <strong>${round1(book.avgPerWeek).toFixed(1)}</strong></span><span>7d pages: <strong>${Math.round(book.current7dPages)}</strong></span><span>Best week: <strong>${Math.round(book.bestWeekPages)}</strong></span><span>Consistency: <strong>${book.consistencyPct}%</strong></span></div></article>`;
    })
    .join("");
}

export function renderBooksAnalyticsKpis(analytics) {
  const el = document.getElementById("booksAnalyticsKpis");
  if (!el) return;
  const overall = analytics.overall;
  if (!analytics.perBook.length) {
    el.innerHTML =
      "<p class='books-stats-empty'>No book data available yet.</p>";
    return;
  }
  el.innerHTML = [
    { label: "Range", value: analytics.rangeLabel },
    { label: "Pages/day", value: round1(overall.avgPerDay).toFixed(1) },
    { label: "Pages/week", value: round1(overall.avgPerWeek).toFixed(1) },
    {
      label: "Most consistent",
      value: overall.mostConsistent ? overall.mostConsistent.title : "-",
    },
  ]
    .map(
      (item) =>
        `<article class='books-kpi-card'><p>${sanitize(item.label)}</p><h4>${sanitize(item.value)}</h4></article>`,
    )
    .join("");
}

export function renderBooksMiniTrendChart(analytics) {
  callRenderer("renderChart", "booksMiniTrendChart", "booksMiniTrendChart", {
    type: "line",
    data: {
      labels: analytics.trendLabels,
      datasets: [
        {
          label: "Pages/day",
          data: analytics.trendValues,
          borderColor: "rgba(56, 189, 248, 0.92)",
          backgroundColor: "rgba(56, 189, 248, 0.16)",
          borderWidth: 2,
          tension: 0.34,
          fill: true,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } },
        x: { ticks: { maxTicksLimit: 7 } },
      },
    },
  });
}

export function renderBooksMiniShareChart(analytics) {
  const rows = [...analytics.perBook]
    .filter((book) => book.pagesNet > 0)
    .sort((a, b) => b.pagesNet - a.pagesNet)
    .slice(0, 6);
  const labels = rows.map((row) => row.title);
  const values = rows.map((row) => Math.round(row.pagesNet));

  callRenderer(
    "renderChart",
    "booksMiniBookShareChart",
    "booksMiniBookShareChart",
    {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["No data"],
        datasets: [
          {
            data: labels.length ? values : [0],
            backgroundColor: labels.length
              ? values.map((value) =>
                  getValueColor(value, Math.max(1, ...values), 0.86),
                )
              : ["rgba(148, 163, 184, 0.5)"],
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { maxTicksLimit: 5 } },
        },
      },
    },
  );
}

export function renderBooksVelocityTrendChart(analytics) {
  callRenderer(
    "renderChart",
    "booksVelocityTrendChart",
    "booksVelocityTrendChart",
    {
      type: "line",
      data: {
        labels: analytics.trendLabels,
        datasets: [
          {
            label: "Pages advanced",
            data: analytics.trendValues,
            borderColor: "rgba(56, 189, 248, 0.95)",
            backgroundColor: "rgba(56, 189, 248, 0.2)",
            borderWidth: 2,
            tension: 0.28,
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Pages/day" } },
          x: { ticks: { maxTicksLimit: 10 } },
        },
      },
    },
  );
}

export function renderBooksComparisonChart(analytics) {
  const labels = analytics.comparisonRows.map((row) => row.title);
  const avgDay = analytics.comparisonRows.map((row) => round1(row.avgPerDay));
  const avgWeek = analytics.comparisonRows.map((row) => round1(row.avgPerWeek));

  callRenderer(
    "renderChart",
    "booksPerBookComparisonChart",
    "booksPerBookComparisonChart",
    {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["No data"],
        datasets: [
          {
            label: "Avg pages/day",
            data: labels.length ? avgDay : [0],
            backgroundColor: "rgba(34, 197, 94, 0.82)",
            borderRadius: 6,
          },
          {
            label: "Avg pages/week",
            data: labels.length ? avgWeek : [0],
            backgroundColor: "rgba(249, 115, 22, 0.78)",
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: {
          y: { beginAtZero: true },
        },
      },
    },
  );
}

export function renderBooksBookmarkActivityChart(analytics) {
  callRenderer(
    "renderChart",
    "booksBookmarkActivityChart",
    "booksBookmarkActivityChart",
    {
      type: "bar",
      data: {
        labels: analytics.trendLabels,
        datasets: [
          {
            label: "Bookmark events",
            data: analytics.trendActivity,
            backgroundColor: "rgba(99, 102, 241, 0.78)",
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Events/day" },
          },
          x: { ticks: { maxTicksLimit: 10 } },
        },
      },
    },
  );
}

export function renderBooksWeeklyHeatmap(analytics) {
  const container = document.getElementById("booksWeeklyHeatmap");
  if (!container) return;
  if (!analytics.heatWeeks.length) {
    container.innerHTML =
      "<div class='heatmap-empty'>No reading data yet.</div>";
    return;
  }

  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const allCells = analytics.heatWeeks.flatMap((week) => week.weekdays);
  const maxValue = Math.max(1, ...allCells);

  let html = "<div></div>";
  labels.forEach((label) => {
    html += `<div class='heatmap-head'>${label}</div>`;
  });

  analytics.heatWeeks.forEach((week) => {
    html += `<div class='heatmap-week-label'>${week.label}</div>`;
    week.weekdays.forEach((value) => {
      const ratio = value / maxValue;
      html += `<div class='heatmap-cell' style='background:${getHeatColor(ratio)}' title='${Math.round(value)} pages'>${Math.round(value)}</div>`;
    });
  });

  container.innerHTML = html;
}

export function renderBooksAnalyticsDashboard(options = {}) {
  const includeCharts = options.includeCharts !== false;
  syncBooksRangeControls();
  const analytics = buildBooksAnalytics();
  renderBooksStatsOverview(analytics);
  renderBooksAnalyticsKpis(analytics);
  renderBooksMiniTrendChart(analytics);
  renderBooksMiniShareChart(analytics);
  if (!includeCharts) {
    return;
  }
  renderBooksVelocityTrendChart(analytics);
  renderBooksComparisonChart(analytics);
  renderBooksBookmarkActivityChart(analytics);
  renderBooksWeeklyHeatmap(analytics);
}

export function renderBookFinisherPlanChart(plan) {
  const weekEntries =
    plan && plan.ok && Array.isArray(plan.weekEntries) ? plan.weekEntries : [];
  const labels = weekEntries.map((entry) => entry.label);
  const values = weekEntries.map((entry) => entry.pages);
  callRenderer(
    "renderChart",
    "booksFinisherPlanChart",
    "booksFinisherPlanChart",
    {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["No plan"],
        datasets: [
          {
            label: "Pages",
            data: values.length ? values : [0],
            backgroundColor: values.length
              ? values.map((value) =>
                  getValueColor(value, Math.max(1, ...values), 0.84),
                )
              : ["rgba(148, 163, 184, 0.5)"],
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return `${Math.round(context.parsed.y || 0)} pages`;
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } },
        },
      },
    },
  );
}

export async function renderBookFinisherHelper() {
  const panel = document.getElementById("booksFinisherCard");
  const bookSelect = document.getElementById("finisherBookSelect");
  const targetInput = document.getElementById("finisherTargetDate");
  const startInput = document.getElementById("finisherStartPage");
  const totalInput = document.getElementById("finisherTotalPages");
  const statusEl = document.getElementById("finisherStatusText");
  const resultsEl = document.getElementById("finisherResultsPanel");
  const autoBtn = document.getElementById("finisherUseAutoPagesBtn");
  if (
    !panel ||
    !bookSelect ||
    !targetInput ||
    !startInput ||
    !totalInput ||
    !statusEl ||
    !resultsEl ||
    !autoBtn
  ) {
    return;
  }

  const helper = getOrInitBooksHelperState();
  const books = Array.isArray(state.books && state.books.items)
    ? state.books.items
    : [];

  if (!books.length) {
    bookSelect.innerHTML = "<option value=''>No books yet</option>";
    targetInput.value = "";
    startInput.value = "";
    totalInput.value = "";
    statusEl.textContent = "Add at least one book to build a finish plan.";
    resultsEl.innerHTML = "";
    renderBookFinisherPlanChart(null);
    return;
  }

  if (
    !helper.selectedBookId ||
    !books.some((book) => book.bookId === helper.selectedBookId)
  ) {
    const fallback = getSelectedFinisherBook();
    helper.selectedBookId = fallback ? fallback.bookId : "";
  }
  const selectedBook = getSelectedFinisherBook();
  if (!selectedBook) return;

  if (!helper.targetDate) {
    helper.targetDate = formatDateInputValue(
      floorToDayTime(Date.now()) + 20 * 86400000,
    );
  }

  if (!Number.isFinite(parseInt(helper.startPage, 10))) {
    helper.startPage = getBookMaxBookmarkPage(selectedBook);
  }

  if (finisherState.loadingBookId === selectedBook.bookId) {
    statusEl.textContent = "Detecting total pages from PDF...";
  }

  await detectBookTotalPages(selectedBook);

  bookSelect.innerHTML = books
    .map(
      (book) =>
        `<option value="${book.bookId}">${sanitize(book.title)}</option>`,
    )
    .join("");
  bookSelect.value = selectedBook.bookId;

  targetInput.value = helper.targetDate;
  startInput.value = String(Math.max(1, parseInt(helper.startPage, 10) || 1));

  const effectiveTotal = getEffectiveBookTotalPages(selectedBook);
  totalInput.placeholder = effectiveTotal
    ? `Auto: ${effectiveTotal}`
    : "Auto not detected";
  totalInput.value = Number.isFinite(
    parseInt(selectedBook.totalPagesOverride, 10),
  )
    ? String(Math.max(1, parseInt(selectedBook.totalPagesOverride, 10)))
    : "";
  autoBtn.disabled = !Number.isFinite(
    parseInt(selectedBook.totalPagesOverride, 10),
  );

  const weekdaySet = new Set(helper.weekdays || []);
  document.querySelectorAll("[data-finisher-weekday]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const value = parseInt(input.dataset.finisherWeekday, 10);
    input.checked = weekdaySet.has(value);
  });

  const plan = computeBookFinisherPlan(selectedBook);
  if (!plan.ok) {
    statusEl.textContent =
      finisherState.lastError || plan.message || "No plan available yet.";
    resultsEl.innerHTML = "";
    renderBookFinisherPlanChart(null);
    return;
  }

  statusEl.textContent = plan.canFinishByTarget
    ? "Plan ready. Stay on this pace to finish on time."
    : "Plan is tight. Increase reading days or move the finish date.";

  const readingDays = Array.isArray(plan.readingDays) ? plan.readingDays : [];
  const pagesPerDay = Number.isFinite(plan.pagesPerDay) ? plan.pagesPerDay : 0;
  const pagesPerDayExact = Number.isFinite(plan.pagesPerDayExact)
    ? plan.pagesPerDayExact
    : 0;

  resultsEl.innerHTML = [
    { label: "Start page", value: String(plan.startPage) },
    { label: "Total pages", value: String(plan.totalPages) },
    { label: "Remaining pages", value: String(plan.remainingPages) },
    { label: "Reading days", value: String(readingDays.length) },
    {
      label: "Needed per reading day",
      value: `${Math.ceil(pagesPerDay)} pages`,
    },
    {
      label: "Average exact",
      value: `${round1(pagesPerDayExact).toFixed(1)} pages`,
    },
    {
      label: "Projected finish",
      value:
        plan.projectedDate === "Done"
          ? "Already done"
          : String(plan.projectedDate),
    },
    {
      label: "Target",
      value: String(helper.targetDate),
    },
  ]
    .map(
      (item) =>
        `<article class='books-finisher-result-card${plan.canFinishByTarget ? "" : " warning"}'><p>${sanitize(item.label)}</p><h4>${sanitize(item.value)}</h4></article>`,
    )
    .join("");

  renderBookFinisherPlanChart(plan);
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
      return `<article class='books-item ${active}'><div class='books-item-main'><h4>${sanitize(book.title)}</h4><p>${sanitize(book.author || "Unknown author")}</p><p class='books-file-meta'>${sanitize(book.fileName)} · ${Math.round((book.fileSize || 0) / 1024)}KB</p>${hasBlob ? "" : "<p class='books-warning'>PDF blob missing in this browser storage.</p>"}</div><div class='books-item-actions'><button class='btn-secondary' type='button' onclick="HabitApp.setActiveBook('${book.bookId}')">Select</button><button class='btn-secondary' type='button' onclick="HabitApp.editBook('${book.bookId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBook('${book.bookId}')">Delete</button></div></article>`;
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

      return `<article class='bookmark-item'><div class='bookmark-main'><h4>${sanitize(bm.label)}</h4><p>PDF page ${bm.pdfPage} · Real page ${formatRealBookPage(bm.realPage)}</p><p>${sanitize(bm.note || "No note")}</p><p class='bookmark-updated'>Updated ${sanitize(formatIsoForDisplay(bm.updatedAt))}</p><p class='bookmark-summary-status'>${sanitize(summaryStatus)}${lastSummarizedPage ? ` · summarized through page ${lastSummarizedPage}` : ""}</p></div><div class='bookmark-actions'><button class='btn-primary' type='button' onclick="HabitApp.openBookmark('${book.bookId}', ${bm.pdfPage}, '${bm.bookmarkId}')">Open at Bookmark</button><button class='btn-secondary' type='button' onclick="HabitApp.summarizeBookmark('${book.bookId}', '${bm.bookmarkId}')">Summarize up to Bookmark</button><button class='btn-secondary' type='button' onclick="HabitApp.viewBookmarkSummary('${book.bookId}', '${bm.bookmarkId}')">View Summaries</button><button class='btn-secondary' type='button' onclick="HabitApp.editBookmark('${book.bookId}', '${bm.bookmarkId}')">Edit</button><button class='btn-danger' type='button' onclick="HabitApp.deleteBookmark('${book.bookId}', '${bm.bookmarkId}')">Delete</button></div><ul class='bookmark-history'>${historyHtml || "<li>No history yet.</li>"}</ul></article>`;
    })
    .join("");
}

export async function renderBooksView() {
  await refreshBookBlobStatus();
  await renderBooksList();
  renderBookmarksPanel();
  await renderBookFinisherHelper();
  renderBooksAnalyticsDashboard({ includeCharts: false });
  applyBookSummarySettingsToInputs();
}

registerRenderer("renderBooksView", renderBooksView);
registerRenderer("renderBooksStatsOverview", renderBooksStatsOverview);
registerRenderer("renderBookFinisherHelper", renderBookFinisherHelper);
registerRenderer(
  "renderBooksAnalyticsDashboard",
  renderBooksAnalyticsDashboard,
);
