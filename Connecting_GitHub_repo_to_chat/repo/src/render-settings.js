"use strict";

import { APP_VERSION } from "./constants.js";
import { globals, state } from "./state.js";
import { permission, notificationsSupported } from "./reminders.js";

export function renderSettings() {
  const theme = globals.prefs.theme || "dark";
  const weekStart = globals.prefs.weekStart === 0 ? 0 : 1;
  const perm = permission();
  const permLabel = !notificationsSupported()
    ? "Not supported on this device"
    : perm === "granted"
      ? "Allowed"
      : perm === "denied"
        ? "Blocked in browser settings"
        : "Tap to allow";

  return `
    <h1 class="h1">Settings</h1>

    <div class="eyebrow group-label">Appearance</div>
    <div class="list">
      <div class="list-row">
        <span class="lab">Theme</span>
        <span class="seg" style="width:190px">
          <button class="${theme === "light" ? "on" : ""}" data-act="theme" data-theme="light">Light</button>
          <button class="${theme === "dark" ? "on" : ""}" data-act="theme" data-theme="dark">Dark</button>
          <button class="${theme === "auto" ? "on" : ""}" data-act="theme" data-theme="auto">Auto</button>
        </span>
      </div>
      <div class="list-row">
        <span class="lab">Week starts on</span>
        <span class="seg" style="width:150px">
          <button class="${weekStart === 1 ? "on" : ""}" data-act="weekstart" data-start="1">Monday</button>
          <button class="${weekStart === 0 ? "on" : ""}" data-act="weekstart" data-start="0">Sunday</button>
        </span>
      </div>
    </div>

    <div class="eyebrow group-label">Reminders</div>
    <div class="list">
      <button class="list-row" data-act="notif-permission">
        <span>
          <span class="lab">Notifications</span>
          <span class="hint">${permLabel}</span>
        </span>
        <span class="val">${perm === "granted" ? "On" : "Off"}</span>
      </button>
      <div class="list-row">
        <span>
          <span class="lab">Per-habit reminders</span>
          <span class="hint">Set the time and days on each habit</span>
        </span>
        <span class="val">${state.habits.daily.filter((h) => h.reminder && h.reminder.enabled).length} active</span>
      </div>
    </div>

    <div class="eyebrow group-label">Data</div>
    <div class="list">
      <button class="list-row" data-act="export"><span class="lab">Export data</span><span class="val">JSON</span></button>
      <button class="list-row" data-act="import"><span class="lab">Import data</span><span class="val">JSON</span></button>
      <button class="list-row danger" data-act="reset"><span class="lab">Reset all data</span></button>
    </div>

    <p style="text-align:center;margin-top:28px;font-size:11.5px;color:var(--faint);font-family:var(--mono)">Habit Tracker ${APP_VERSION}</p>
  `;
}
