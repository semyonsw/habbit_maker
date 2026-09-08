"use strict";

// One place where DOM handlers are attached, called once from app.js.
//
// Each screen binds a delegated listener on its own <section>, so a re-render
// never has to rebind anything. This module wires the shell only: the bottom
// nav, the two add buttons, and the Android back button.

import { navigateTo } from "./router.js";
import { bindTodayEvents } from "./render-today.js";
import { bindDetailEvents } from "./render-detail.js";
import { bindAnalyticsEvents } from "./render-analytics.js";
import { bindSettingsEvents } from "./render-settings.js";
import {
  bindOverlayEvents,
  handleBackNavigation,
  openHabitSheet,
  openTaskSheet,
} from "./modals.js";
import { appendLogEntry } from "./logging.js";

export function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.view));
  });

  const addBtn = document.getElementById("btnAddHabit");
  if (addBtn) addBtn.addEventListener("click", () => openHabitSheet(null));

  // The one-off task sheet. null = a new task; it prefills the day currently
  // shown on Today.
  const addTaskBtn = document.getElementById("btnAddTask");
  if (addTaskBtn) addTaskBtn.addEventListener("click", () => openTaskSheet(null));

  bindTodayEvents();
  bindDetailEvents();
  bindAnalyticsEvents();
  bindSettingsEvents();
  bindOverlayEvents();

  // An open sheet or dialog swallows the first back press rather than letting
  // it leave the screen -- or, on Today, the app. See the back-button notes in
  // modals.js: opening an overlay pushes a history entry precisely so that
  // there is something for this to pop.
  window.addEventListener("popstate", () => {
    handleBackNavigation();
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
