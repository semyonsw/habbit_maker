"use strict";

// One place where DOM handlers are attached, called once from app.js.
//
// Each screen binds a delegated listener on its own <section>, so a re-render
// never has to rebind anything. This module wires the shell only: the bottom
// nav, the "Add habit" button, and the Android back button.

import { navigateTo } from "./router.js";
import { bindTodayEvents } from "./render-today.js";
import { bindDetailEvents } from "./render-detail.js";
import { bindAnalyticsEvents } from "./render-analytics.js";
import { bindSettingsEvents } from "./render-settings.js";
import { bindOverlayEvents, closeTopOverlay, openHabitSheet } from "./modals.js";
import { appendLogEntry } from "./logging.js";

export function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.view));
  });

  const addBtn = document.getElementById("btnAddHabit");
  if (addBtn) addBtn.addEventListener("click", () => openHabitSheet(null));

  bindTodayEvents();
  bindDetailEvents();
  bindAnalyticsEvents();
  bindSettingsEvents();
  bindOverlayEvents();

  // An open sheet or dialog should swallow the first back press rather than
  // leaving the screen. popstate is what the Android back button produces once
  // the router has put a hash entry into history.
  window.addEventListener("popstate", () => {
    closeTopOverlay();
  });

  window.addEventListener("error", (event) => {
    appendLogEntry({
      level: "error",
      component: "window",
      operation: "error",
      message: String(event.message || "Uncaught error"),
      error: event.error,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    appendLogEntry({
      level: "error",
      component: "window",
      operation: "unhandledrejection",
      message: "Unhandled promise rejection.",
      error: event.reason,
    });
  });
}
