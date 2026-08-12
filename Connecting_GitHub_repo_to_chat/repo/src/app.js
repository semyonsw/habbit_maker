"use strict";

import { globals, state } from "./state.js";
import { loadState, saveState } from "./persistence.js";
import { getHabitById, tapHabit, deleteHabit } from "./habits.js";
import { initReminders, rescheduleAll, requestPermission } from "./reminders.js";
import { openHabitSheet, closeHabitSheet, handleSheetAction } from "./sheet.js";
import { exportData, importData, resetAllData } from "./data-io.js";
import { initRouter, navigateTo, render } from "./router.js";
import { todayParts } from "./render-today.js";
import { appendLogEntry } from "./logging.js";
import * as db from "./db.js";

// ---- preferences (theme, week start) -------------------------------------

function applyTheme() {
  const pref = globals.prefs.theme || "dark";
  const dark = pref === "dark" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0d0f14" : "#f5f6f7");
}

async function loadPrefs() {
  try {
    const prefs = await db.getPrefs();
    globals.prefs = prefs && typeof prefs === "object" ? prefs : {};
  } catch (_) {
    globals.prefs = {};
  }
  applyTheme();
}

function patchPrefs(patch) {
  globals.prefs = { ...globals.prefs, ...patch };
  applyTheme();
  db.patchPrefs(patch).catch(() => {});
}

// ---- event delegation ----------------------------------------------------

function currentDetailHabit() {
  return getHabitById(globals.detailHabitId);
}

function handleDetailAction(act, el) {
  const habit = currentDetailHabit();
  if (!habit) return false;
  switch (act) {
    case "detail-track":
      habit.trackType = el.dataset.type === "count" ? "count" : "check";
      if (habit.trackType === "count" && habit.countTarget < 2) habit.countTarget = 3;
      if (habit.trackType === "check") habit.countTarget = 1;
      break;
    case "detail-target":
      habit.countTarget = Math.max(2, Math.min(99, habit.countTarget + Number(el.dataset.step)));
      break;
    case "detail-rem-toggle":
      habit.reminder.enabled = !habit.reminder.enabled;
      if (habit.reminder.enabled) requestPermission().then(rescheduleAll);
      break;
    case "detail-rem-repeat":
      habit.reminder.repeat = el.dataset.repeat;
      break;
    case "detail-rem-day": {
      const day = Number(el.dataset.day);
      const days = habit.reminder.days || [];
      habit.reminder.days = days.includes(day) ? days.filter((d) => d !== day) : days.concat([day]);
      break;
    }
    default:
      return false;
  }
  saveState();
  rescheduleAll();
  render();
  return true;
}

function onClick(event) {
  const el = event.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (handleSheetAction(act, el)) return;
  if (handleDetailAction(act, el)) return;

  switch (act) {
    case "nav":
      navigateTo(el.dataset.view);
      break;
    case "open":
      navigateTo("detail", el.dataset.habit);
      break;
    case "back":
      navigateTo("today");
      break;
    case "tap": {
      const habit = getHabitById(el.dataset.habit);
      if (!habit) break;
      const { year, month, day } = todayParts();
      tapHabit(habit, year, month, day);
      render();
      break;
    }
    case "add":
      openHabitSheet(null);
      break;
    case "edit":
      openHabitSheet(el.dataset.habit);
      break;
    case "delete": {
      const habit = getHabitById(el.dataset.habit);
      if (!habit || !confirm(`Delete "${habit.name}"? Its history goes too.`)) break;
      deleteHabit(habit.id);
      rescheduleAll();
      navigateTo("today");
      break;
    }
    case "theme":
      patchPrefs({ theme: el.dataset.theme });
      render();
      break;
    case "weekstart":
      patchPrefs({ weekStart: Number(el.dataset.start) });
      render();
      break;
    case "notif-permission":
      requestPermission().then(() => { rescheduleAll(); render(); });
      break;
    case "export":
      exportData();
      break;
    case "import":
      document.getElementById("importFile").click();
      break;
    case "reset":
      resetAllData();
      break;
    default:
      break;
  }
}

function onChange(event) {
  const el = event.target.closest("[data-act]");
  if (!el) return;
  if (el.dataset.act === "detail-rem-time") {
    const habit = currentDetailHabit();
    if (!habit) return;
    habit.reminder.time = el.value || "08:00";
    saveState();
    rescheduleAll();
    render();
    return;
  }
  if (el.id === "importFile" && el.files && el.files[0]) {
    importData(el.files[0]);
    el.value = "";
  }
}

function onKeydown(event) {
  if (event.key === "Escape") closeHabitSheet();
}

// ---- boot ----------------------------------------------------------------

async function init() {
  try {
    await loadPrefs();
    await loadState();

    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.getElementById("importFile").addEventListener("change", onChange);
    document.addEventListener("keydown", onKeydown);

    initRouter();
    initReminders();

    document.getElementById("app").hidden = false;
  } catch (error) {
    appendLogEntry({ level: "error", component: "app", operation: "init", message: "App init failed.", error });
    alert("The app failed to start. See the browser console for details.");
  } finally {
    const boot = document.getElementById("boot");
    if (boot) boot.remove();
  }

  // Midnight rollover: the Today screen must follow the calendar day.
  setInterval(() => {
    const { day } = todayParts();
    if (globals.lastRenderedDay !== day) {
      globals.lastRenderedDay = day;
      if (state) render();
    }
  }, 60000);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((yes) => { if (!yes) navigator.storage.persist().catch(() => {}); }).catch(() => {});
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { init(); });
} else {
  init();
}
