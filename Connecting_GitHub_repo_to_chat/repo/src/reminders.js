"use strict";

// Per-habit reminders.
//
// A PWA cannot wake itself when it is closed without a push server, so this
// schedules one in-page timer per habit for its next occurrence and re-arms on
// fire. Reminders therefore land while the app is open or backgrounded by the
// system; that is the honest limit of a serverless build, and it covers the
// "remind me at 12:40" case for anyone who keeps the app installed.

import { state } from "./state.js";
import { appendLogEntry } from "./logging.js";
import { getSortedDailyHabits } from "./habits.js";

const timers = new Map();

export function notificationsSupported() {
  return typeof Notification !== "undefined";
}

export function permission() {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export async function requestPermission() {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch (error) {
    appendLogEntry({
      level: "warn", component: "reminders", operation: "requestPermission",
      message: "Permission request failed.", error,
    });
    return Notification.permission;
  }
}

function activeDays(reminder) {
  if (reminder.repeat === "daily") return [0, 1, 2, 3, 4, 5, 6];
  if (reminder.repeat === "weekdays") return [1, 2, 3, 4, 5];
  return Array.isArray(reminder.days) ? reminder.days : [];
}

export function nextOccurrence(reminder, from = new Date()) {
  const days = activeDays(reminder);
  if (!days.length) return null;
  const [h, m] = String(reminder.time || "08:00").split(":").map((n) => parseInt(n, 10));
  for (let offset = 0; offset <= 7; offset += 1) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, h, m, 0, 0);
    if (d > from && days.includes(d.getDay())) return d;
  }
  return null;
}

export function describe(reminder) {
  if (!reminder || !reminder.enabled) return "Off";
  const time = String(reminder.time || "08:00");
  if (reminder.repeat === "daily") return `Every day · ${time}`;
  if (reminder.repeat === "weekdays") return `Weekdays · ${time}`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const list = (reminder.days || []).slice().sort().map((i) => names[i]).join(" ");
  return `${list || "No days"} · ${time}`;
}

function fire(habit) {
  const body = `Reminder · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(habit.name, {
          body, tag: `habit-${habit.id}`, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
        }))
        .catch(() => new Notification(habit.name, { body }));
    } else {
      new Notification(habit.name, { body });
    }
  } catch (error) {
    appendLogEntry({
      level: "warn", component: "reminders", operation: "fire",
      message: "Could not show notification.", error, context: { habitId: habit.id },
    });
  }
}

function scheduleOne(habit) {
  const reminder = habit.reminder;
  if (!reminder || !reminder.enabled) return;
  const next = nextOccurrence(reminder);
  if (!next) return;
  // setTimeout caps out around 24.8 days; reminders are never that far away.
  const delay = Math.max(1000, next.getTime() - Date.now());
  const id = setTimeout(() => {
    fire(habit);
    scheduleOne(habit);
  }, delay);
  timers.set(habit.id, id);
}

export function rescheduleAll() {
  timers.forEach((id) => clearTimeout(id));
  timers.clear();
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (state && state.habits) getSortedDailyHabits().forEach(scheduleOne);
}

export function initReminders() {
  rescheduleAll();
  // Re-arm after the device sleeps or the tab is restored: timers do not fire
  // reliably across suspension, so recompute from the clock on wake.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") rescheduleAll();
  });
}
