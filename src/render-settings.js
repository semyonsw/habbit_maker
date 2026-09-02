"use strict";

// Settings: Appearance, Reminders, Data.

import { APP_VERSION, THEMES } from "./constants.js";
import { setState } from "./state.js";
import { sanitize } from "./utils.js";
import { getDefaultState, saveState } from "./persistence.js";
import { exportData, importData, setBackupStatus } from "./data-io.js";
import {
  getDailyReminder,
  getFadeReminders,
  getTheme,
  getWeekStart,
  setDailyReminderEnabled,
  setDailyReminderTime,
  setFadeReminders,
  setTheme,
  setWeekStart,
} from "./ui-prefs.js";
import {
  getNotificationStatus,
  notificationsSupported,
  rescheduleReminders,
} from "./notifications.js";
import { openConfirm } from "./modals.js";
import { callRenderer, registerRenderer } from "./render-registry.js";

const THEME_LABELS = { light: "Light", dark: "Dark", auto: "Auto" };

// One line telling the truth about whether a reminder will actually arrive.
// The app used to imply background delivery it had no code for at all; the
// web build still cannot provide it, so it says so rather than pretending.
function deliveryNoteHtml() {
  if (!notificationsSupported()) {
    return (
      '<div class="settings-note is-warn">' +
      "This browser cannot show notifications, so reminders will not fire." +
      "</div>"
    );
  }

  const { permission, background } = getNotificationStatus();

  if (permission === "denied") {
    return (
      '<div class="settings-note is-warn">' +
      "Notifications are blocked for Habit Maker. Turn them back on in your " +
      "system settings, then reopen the app." +
      "</div>"
    );
  }

  if (background) {
    return (
      '<div class="settings-note">' +
      "Reminders are scheduled with Android and arrive even when the app is " +
      "closed." +
      "</div>"
    );
  }

  return (
    '<div class="settings-note">' +
    "On the web, reminders only fire while Habit Maker is open in a tab. " +
    "Install the Android app for reminders that arrive in the background." +
    "</div>"
  );
}

export function renderSettings() {
  const body = document.getElementById("settingsBody");
  if (!body) return;

  const theme = getTheme();
  const reminder = getDailyReminder();
  const fade = getFadeReminders();

  body.innerHTML =
    // ---- Appearance ----------------------------------------------------
    '<div class="section-label settings-label">Appearance</div>' +
    '<div class="settings-group">' +
    '<div class="settings-row">' +
    '<div class="settings-row-label">Theme</div>' +
    '<div class="pill-group" role="group" aria-label="Theme">' +
    THEMES.map(
      (key) =>
        `<button type="button" data-theme-set="${key}" class="${theme === key ? "is-active" : ""}">${THEME_LABELS[key]}</button>`,
    ).join("") +
    "</div></div>" +
    '<button type="button" class="settings-row is-tappable" data-week-toggle>' +
    '<span class="settings-row-label">Week starts on</span>' +
    `<span class="settings-row-value">${getWeekStart() === "sunday" ? "Sunday" : "Monday"}</span>` +
    "</button>" +
    "</div>" +
    // ---- Reminders ------------------------------------------------------
    '<div class="section-label settings-label">Reminders</div>' +
    '<div class="settings-group">' +
    '<div class="settings-row">' +
    "<div>" +
    '<div class="settings-row-label">Daily reminder</div>' +
    '<div class="settings-row-hint">One nudge, at a time you choose</div>' +
    "</div>" +
    `<button type="button" class="toggle${reminder.enabled ? " is-on" : ""}" data-daily-reminder` +
    ` role="switch" aria-checked="${reminder.enabled}" aria-label="Daily reminder"><span></span></button>` +
    "</div>" +
    `<div class="settings-row${reminder.enabled ? "" : " is-dimmed"}">` +
    '<div class="settings-row-label">Reminder time</div>' +
    (reminder.enabled
      ? `<input type="time" id="dailyReminderTime" value="${sanitize(reminder.time)}" aria-label="Reminder time" />`
      : `<div class="settings-row-value num">${sanitize(reminder.time)}</div>`) +
    "</div>" +
    '<div class="settings-row">' +
    "<div>" +
    '<div class="settings-row-label">Ease off automatically</div>' +
    '<div class="settings-row-hint">Remind less as a habit gets stronger</div>' +
    "</div>" +
    `<button type="button" class="toggle${fade ? " is-on" : ""}" data-fade-reminders` +
    ` role="switch" aria-checked="${fade}" aria-label="Ease off automatically"><span></span></button>` +
    "</div>" +
    "</div>" +
    deliveryNoteHtml() +
    // ---- Data -----------------------------------------------------------
    '<div class="section-label settings-label">Data</div>' +
    '<div class="settings-group">' +
    '<button type="button" class="settings-row is-tappable" data-export>' +
    '<span class="settings-row-label">Export data</span>' +
    '<span class="settings-row-value">JSON</span>' +
    "</button>" +
    '<button type="button" class="settings-row is-tappable" data-import>' +
    '<span class="settings-row-label">Import data</span>' +
    '<span class="settings-row-value">JSON</span>' +
    "</button>" +
    '<button type="button" class="settings-row is-tappable" data-reset>' +
    '<span class="settings-row-label settings-row-danger">Reset all data</span>' +
    "</button>" +
    "</div>" +
    '<p class="backup-status" id="backupStatus" role="status" aria-live="polite"></p>' +
    `<div class="version-line">Habit Maker ${sanitize(APP_VERSION)}</div>` +
    // The file picker Import drives. Kept in the DOM (not created per click)
    // so the change handler binds once.
    '<input type="file" id="importFileInput" accept="application/json,.json" class="visually-hidden" />';
}

export function bindSettingsEvents() {
  const section = document.getElementById("view-settings");
  if (!section) return;

  section.addEventListener("click", (event) => {
    const themeBtn = event.target.closest("[data-theme-set]");
    if (themeBtn) {
      setTheme(themeBtn.dataset.themeSet);
      renderSettings();
      return;
    }
    if (event.target.closest("[data-week-toggle]")) {
      setWeekStart(getWeekStart() === "sunday" ? "monday" : "sunday");
      renderSettings();
      return;
    }
    if (event.target.closest("[data-daily-reminder]")) {
      const enabling = !getDailyReminder().enabled;
      setDailyReminderEnabled(enabling);
      if (enabling) callRenderer("requestReminderPermission");
      else rescheduleReminders();
      renderSettings();
      return;
    }
    if (event.target.closest("[data-fade-reminders]")) {
      setFadeReminders(!getFadeReminders());
      rescheduleReminders();
      renderSettings();
      return;
    }
    if (event.target.closest("[data-export]")) {
      exportData();
      return;
    }
    if (event.target.closest("[data-import]")) {
      const input = document.getElementById("importFileInput");
      if (input) input.click();
      return;
    }
    if (event.target.closest("[data-reset]")) {
      openConfirm(
        "Reset all data",
        "This deletes every habit, note and completion on this device. It cannot be undone.",
        () => {
          setState(getDefaultState());
          saveState();
          rescheduleReminders();
          setBackupStatus("All data reset.", "warn");
          callRenderer("renderAll");
        },
      );
    }
  });

  section.addEventListener("change", (event) => {
    if (event.target.id === "dailyReminderTime") {
      setDailyReminderTime(event.target.value);
      rescheduleReminders();
      return;
    }
    if (event.target.id === "importFileInput") {
      const file = event.target.files && event.target.files[0];
      if (file) importData(file);
      // Reset so re-picking the same file fires change again.
      event.target.value = "";
    }
  });
}

registerRenderer("renderSettings", renderSettings);
