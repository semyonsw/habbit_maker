"use strict";

// App-level preferences: theme, week start, and the single daily reminder.
//
// These live in the prefs store (IndexedDB on the phone, SQLite on the PC),
// same as before. The theme is *additionally* mirrored into localStorage so
// the inline script in index.html can paint it before first paint -- without
// that mirror a Light-theme user gets a dark flash on every launch, because
// reading the real store is async.

import {
  DAILY_REMINDER_DEFAULT_TIME,
  THEMES,
  WEEK_STARTS,
} from "./constants.js";
import * as db from "./db.js";

const THEME_CACHE_KEY = "hm.theme";

export const uiPrefs = {
  // Dark by default: the design is dark-first, and "auto" on a light OS would
  // otherwise show a first-run user the light theme.
  theme: "dark",
  weekStart: "monday",
  dailyReminderEnabled: false,
  dailyReminderTime: DAILY_REMINDER_DEFAULT_TIME,
  // Thin a habit's reminders out as its strength score climbs. On by default:
  // the whole point of a reminder is to stop needing it, and an app that keeps
  // nagging about something you now do automatically is an app whose
  // notifications get switched off entirely.
  fadeReminders: true,
};

let mediaQuery = null;

/* -------------------------------------------------------------- accessors */

export function getTheme() {
  return THEMES.includes(uiPrefs.theme) ? uiPrefs.theme : "dark";
}

export function getWeekStart() {
  return WEEK_STARTS.includes(uiPrefs.weekStart) ? uiPrefs.weekStart : "monday";
}

export function getFadeReminders() {
  return uiPrefs.fadeReminders !== false;
}

export function getDailyReminder() {
  return {
    enabled: uiPrefs.dailyReminderEnabled === true,
    time: /^\d{2}:\d{2}$/.test(uiPrefs.dailyReminderTime)
      ? uiPrefs.dailyReminderTime
      : DAILY_REMINDER_DEFAULT_TIME,
  };
}

/* ------------------------------------------------------------------ apply */

// "auto" follows the OS. Everything else is an explicit choice.
function resolveTheme() {
  const theme = getTheme();
  if (theme !== "auto") return theme;
  return window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme() {
  const resolved = resolveTheme();
  document.documentElement.setAttribute("data-theme", resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#0d0f14" : "#f5f7fa");
}

// Re-apply on OS change, but only while the preference is "auto".
function watchSystemTheme() {
  if (mediaQuery || !window.matchMedia) return;
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getTheme() === "auto") applyTheme();
  };
  if (mediaQuery.addEventListener) mediaQuery.addEventListener("change", onChange);
  else if (mediaQuery.addListener) mediaQuery.addListener(onChange);
}

/* ------------------------------------------------------------------- load */

export function initUiPrefsFromBlob(prefs) {
  const blob = prefs && typeof prefs === "object" ? prefs : {};
  uiPrefs.theme = THEMES.includes(blob.theme) ? blob.theme : "dark";
  uiPrefs.weekStart = WEEK_STARTS.includes(blob.weekStart)
    ? blob.weekStart
    : "monday";
  uiPrefs.dailyReminderEnabled = blob.dailyReminderEnabled === true;
  uiPrefs.dailyReminderTime = /^\d{2}:\d{2}$/.test(blob.dailyReminderTime)
    ? blob.dailyReminderTime
    : DAILY_REMINDER_DEFAULT_TIME;
  uiPrefs.fadeReminders = blob.fadeReminders !== false;
}

export async function initUiPrefs() {
  try {
    initUiPrefsFromBlob(await db.getPrefs());
  } catch (_) {
    initUiPrefsFromBlob({});
  }
  cacheThemeLocally();
  applyTheme();
  watchSystemTheme();
}

function cacheThemeLocally() {
  try {
    localStorage.setItem(THEME_CACHE_KEY, getTheme());
  } catch (_) {
    /* private mode or storage disabled; the async read still works */
  }
}

/* ------------------------------------------------------------------ write */

export function setTheme(value) {
  uiPrefs.theme = THEMES.includes(value) ? value : "dark";
  cacheThemeLocally();
  applyTheme();
  db.patchPrefs({ theme: uiPrefs.theme }).catch(() => {});
}

export function setWeekStart(value) {
  uiPrefs.weekStart = WEEK_STARTS.includes(value) ? value : "monday";
  db.patchPrefs({ weekStart: uiPrefs.weekStart }).catch(() => {});
}

export function setDailyReminderEnabled(enabled) {
  uiPrefs.dailyReminderEnabled = !!enabled;
  db.patchPrefs({ dailyReminderEnabled: uiPrefs.dailyReminderEnabled }).catch(
    () => {},
  );
}

export function setDailyReminderTime(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) return;
  uiPrefs.dailyReminderTime = time;
  db.patchPrefs({ dailyReminderTime: time }).catch(() => {});
}

export function setFadeReminders(enabled) {
  uiPrefs.fadeReminders = !!enabled;
  db.patchPrefs({ fadeReminders: uiPrefs.fadeReminders }).catch(() => {});
}
