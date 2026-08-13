"use strict";

import { analyticsState } from "./state.js";
import { callRenderer } from "./render-registry.js";
import * as db from "./db.js";

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
