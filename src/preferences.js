"use strict";

import { readerState, analyticsState } from "./state.js";
import { callRenderer } from "./render-registry.js";
import * as db from "./db.js";

export function loadReaderThemePreferencesFromBlob(prefs) {
  const blob = prefs && typeof prefs === "object" ? prefs : {};
  readerState.darkEnabled = blob.readerDarkEnabled === true;
  readerState.darkMode = blob.readerDarkMode === "text" ? "text" : "full";
}

export async function loadReaderThemePreferences() {
  try {
    const prefs = await db.getPrefs();
    loadReaderThemePreferencesFromBlob(prefs);
  } catch (_) {
    loadReaderThemePreferencesFromBlob({});
  }
}

export function persistReaderThemePreferences() {
  db.patchPrefs({
    readerDarkEnabled: readerState.darkEnabled === true,
    readerDarkMode: readerState.darkMode === "text" ? "text" : "full",
  }).catch(() => {});
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

export function loadAnalyticsPreferencesFromBlob(prefs) {
  const blob = prefs && typeof prefs === "object" ? prefs : {};
  analyticsState.displayMode =
    blob.analyticsDisplayMode === "raw" ? "raw" : "percent";
}

export async function loadAnalyticsPreferences() {
  try {
    const prefs = await db.getPrefs();
    loadAnalyticsPreferencesFromBlob(prefs);
  } catch (_) {
    loadAnalyticsPreferencesFromBlob({});
  }
}

export function persistAnalyticsPreferences() {
  db.patchPrefs({
    analyticsDisplayMode:
      analyticsState.displayMode === "raw" ? "raw" : "percent",
  }).catch(() => {});
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

