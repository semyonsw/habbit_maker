"use strict";

import {
  READER_DARK_ENABLED_KEY,
  READER_DARK_MODE_KEY,
  ANALYTICS_DISPLAY_MODE_KEY,
  BOOKS_ANALYTICS_RANGE_KEY,
} from "./constants.js";
import { readerState, analyticsState } from "./state.js";
import { callRenderer } from "./render-registry.js";

export function loadReaderThemePreferences() {
  readerState.darkEnabled =
    localStorage.getItem(READER_DARK_ENABLED_KEY) === "1";
  const savedMode = localStorage.getItem(READER_DARK_MODE_KEY);
  readerState.darkMode = savedMode === "text" ? "text" : "full";
}

export function persistReaderThemePreferences() {
  localStorage.setItem(
    READER_DARK_ENABLED_KEY,
    readerState.darkEnabled ? "1" : "0",
  );
  localStorage.setItem(READER_DARK_MODE_KEY, readerState.darkMode);
}

export function applyReaderThemeClasses() {
  const root = document.getElementById("readerMode");
  const canvas = document.getElementById("readerCanvas");
  if (!root || !canvas) return;

  root.classList.toggle("reader-dark-enabled", readerState.darkEnabled);
  canvas.classList.toggle("reader-dark-full", false);
  canvas.classList.toggle("reader-dark-text", false);

  if (readerState.darkEnabled) {
    canvas.classList.add(
      readerState.darkMode === "text"
        ? "reader-dark-text"
        : "reader-dark-full",
    );
  }
}

export function updateReaderThemeControls() {
  const toggle = document.getElementById("readerDarkToggle");
  const mode = document.getElementById("readerDarkMode");
  if (!toggle || !mode) return;

  toggle.setAttribute("aria-pressed", String(readerState.darkEnabled));
  toggle.textContent = readerState.darkEnabled
    ? "Read in dark theme: ON"
    : "Read in dark theme: OFF";

  mode.value = readerState.darkMode;
  mode.disabled = !readerState.darkEnabled;
}

export function toggleReaderDarkTheme() {
  readerState.darkEnabled = !readerState.darkEnabled;
  persistReaderThemePreferences();
  applyReaderThemeClasses();
  updateReaderThemeControls();
}

export function setReaderDarkMode(mode) {
  readerState.darkMode = mode === "text" ? "text" : "full";
  persistReaderThemePreferences();
  applyReaderThemeClasses();
  updateReaderThemeControls();
}

export function normalizeBooksRange(value) {
  const asString = String(value || "30").toLowerCase();
  if (asString === "all") return 0;
  const parsed = parseInt(asString, 10);
  if ([7, 30, 90].includes(parsed)) return parsed;
  return 30;
}

export function loadAnalyticsPreferences() {
  const savedMode = localStorage.getItem(ANALYTICS_DISPLAY_MODE_KEY);
  analyticsState.displayMode = savedMode === "raw" ? "raw" : "percent";
  const savedBooksRange = localStorage.getItem(BOOKS_ANALYTICS_RANGE_KEY);
  analyticsState.booksRangeDays = normalizeBooksRange(savedBooksRange);
}

export function persistAnalyticsPreferences() {
  localStorage.setItem(
    ANALYTICS_DISPLAY_MODE_KEY,
    analyticsState.displayMode,
  );
  localStorage.setItem(
    BOOKS_ANALYTICS_RANGE_KEY,
    analyticsState.booksRangeDays === 0
      ? "all"
      : String(analyticsState.booksRangeDays),
  );
}

export function getBooksAnalyticsRangeDays() {
  return normalizeBooksRange(analyticsState.booksRangeDays);
}

export function getAnalyticsDisplayMode() {
  return analyticsState.displayMode === "raw" ? "raw" : "percent";
}

export function getMetricValue(done, possible) {
  if (getAnalyticsDisplayMode() === "raw") {
    return Number(done || 0);
  }
  if (!possible) return 0;
  return Math.round((Number(done || 0) / Number(possible || 1)) * 100);
}

export function getMetricLabel(value) {
  if (getAnalyticsDisplayMode() === "raw") {
    return String(Math.round(value || 0));
  }
  return `${Math.round(value || 0)}%`;
}

export function getMetricAxisLabel() {
  return getAnalyticsDisplayMode() === "raw"
    ? "Completed habits"
    : "Completion rate (%)";
}

export function syncAnalyticsModeControls() {
  ["analyticsDisplayModeAnalytics"]
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .forEach((control) => {
      control.value = getAnalyticsDisplayMode();
    });
}

export function setAnalyticsDisplayMode(mode) {
  analyticsState.displayMode = mode === "raw" ? "raw" : "percent";
  persistAnalyticsPreferences();
  syncAnalyticsModeControls();
  callRenderer("renderAnalyticsView");
}

export function syncBooksRangeControls() {
  const current = getBooksAnalyticsRangeDays();
  document.querySelectorAll("[data-books-range]").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const range = normalizeBooksRange(btn.dataset.booksRange);
    btn.classList.toggle("active", range === current);
    btn.setAttribute("aria-pressed", range === current ? "true" : "false");
  });
}

export function setBooksAnalyticsRange(value) {
  const next = normalizeBooksRange(value);
  if (next === analyticsState.booksRangeDays) return;
  analyticsState.booksRangeDays = next;
  persistAnalyticsPreferences();
  syncBooksRangeControls();
  if (document.getElementById("view-books")?.classList.contains("active")) {
    callRenderer("renderBooksView");
  } else {
    callRenderer("renderBooksStatsOverview");
  }
  if (
    document.getElementById("view-analytics")?.classList.contains("active")
  ) {
    callRenderer("renderAnalyticsView");
  }
}
