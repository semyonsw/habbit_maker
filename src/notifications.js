"use strict";

// Reminders that actually fire.
//
// Until now the app had three reminder UIs -- the global daily one in Settings,
// and a per-habit one on both the detail screen and the add/edit sheet -- which
// stored their settings, rendered summaries like "Weekdays · 08:00", and then
// did nothing at all. No Notification, no plugin, no service worker handler.
//
// There are two backends, because the two builds have genuinely different
// ceilings:
//
//   * NATIVE (the Android APK, via Capacitor LocalNotifications). Real OS
//     alarms. They fire when the app is closed, which is the only thing a
//     reminder is for.
//
//   * WEB (the PWA / any browser). There is no cross-browser API for scheduling
//     a notification for later -- Notification Triggers never shipped beyond an
//     origin trial -- so the honest ceiling is a timer that only runs while the
//     page is alive. We do that, re-arming on every wake, and Settings says so
//     out loud rather than implying background delivery it cannot provide.
//     Delivery goes through the service worker where there is one, because on
//     Android `new Notification()` is an illegal constructor and throws.
//
// Nothing here throws into a caller: a denied permission or a missing plugin
// degrades to "no reminders", never to a broken screen.

import {
  ALL_WEEKDAYS,
  SCORE_ESTABLISHED,
  WEEKDAY_LABELS,
} from "./constants.js";
import { state } from "./state.js";
import { parseTimeString } from "./utils.js";
import { appendLogEntry } from "./logging.js";
import { isNative, plugin } from "./native.js";
import { getSortedDailyHabits, computeHabitScore } from "./habits.js";
import { getAllTasks } from "./tasks.js";
import { taskReminderAt } from "./task-core.js";
import { getDailyReminder, getFadeReminders } from "./ui-prefs.js";
import { registerRenderer } from "./render-registry.js";
import { showToast } from "./toast.js";

// Base ids, kept apart so the global reminder can never collide with a habit's.
const GLOBAL_ID_BASE = 100;
const HABIT_ID_BASE = 1000;
// Room for one notification per weekday per habit.
const IDS_PER_HABIT = 10;
// Tasks get one id each, far above the habit block: habit N occupies
// 1000 + N*10 + 0..9, so this leaves room for ~49,900 habits before the two
// ranges could ever meet.
const TASK_ID_BASE = 500000;

/* ====================================================================== */
/* Capability                                                             */
/* ====================================================================== */

// Cached because Settings reads it on every render, synchronously, and the
// native round-trip is a bridge call. Refreshed before every reschedule -- so a
// permission revoked in system settings is noticed rather than believed to be
// granted until the app is next restarted.
let nativePermission = "prompt";

// Whether the OS will honour an exact alarm: "granted", "denied", or "unknown"
// until the first check has answered.
let exactAlarms = "unknown";

function localNotifications() {
  return plugin("LocalNotifications");
}

// Android has FOUR permission states where the rest of this app understands
// three.
//
// Dismiss the system dialog once without choosing and POST_NOTIFICATIONS lands
// on "prompt-with-rationale" -- still perfectly askable, and the single most
// likely state for anyone who swiped the first prompt away. Code that only
// recognised the exact string "prompt" then never asked again and never
// explained why: the toggle sat there looking on, with no alarms behind it.
// That is the precise failure this module exists to end.
//
// So it is normalised here, at the boundary, and nothing downstream ever sees a
// state it does not handle.
function normalizePermission(raw) {
  const value = String(raw || "");
  if (value === "granted" || value === "denied") return value;
  return "prompt";
}

export function notificationsSupported() {
  if (isNative()) return !!localNotifications();
  return typeof Notification !== "undefined";
}

// What Settings shows. `permission` is one of granted / denied / prompt /
// unsupported; `background` says whether a reminder survives the app being
// closed, which is the distinction users actually care about.
export function getNotificationStatus() {
  if (!notificationsSupported()) {
    return { permission: "unsupported", background: false };
  }
  if (isNative()) {
    return {
      permission: nativePermission,
      background: true,
      // Only meaningful on Android, and only once checked. "denied" means the
      // alarms are still scheduled but inexact, so they can arrive late.
      exact: exactAlarms,
    };
  }
  return {
    permission: normalizePermission(Notification.permission),
    background: false,
    exact: "unknown",
  };
}

async function refreshNativePermission() {
  const api = localNotifications();
  if (!api) return "unsupported";
  try {
    const result = await api.checkPermissions();
    nativePermission = normalizePermission(result && result.display);
  } catch (_) {
    nativePermission = "prompt";
  }
  return nativePermission;
}

// Ask for permission. Called when a reminder is switched on, not at boot: a
// permission prompt on first launch, before the user has asked for anything, is
// the fastest way to get permanently denied.
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return "unsupported";

  if (isNative()) {
    const api = localNotifications();
    try {
      const result = await api.requestPermissions();
      nativePermission = normalizePermission(result && result.display);
    } catch (_) {
      nativePermission = "denied";
    }
    return nativePermission;
  }

  try {
    return normalizePermission(await Notification.requestPermission());
  } catch (_) {
    return "denied";
  }
}

// Android 12+ downgrades scheduled notifications to inexact unless
// SCHEDULE_EXACT_ALARM is both declared AND left enabled by the user -- and
// from Android 14 it is NOT granted on install, so the default state for a new
// phone is "denied": every reminder is set with setAndAllowWhileIdle and can
// land a quarter of an hour late or worse under Doze.
//
// This is checked after every reschedule, not once at install, because the
// setting is user-revocable at any time -- and revoking it deletes the alarms
// already scheduled, which is what the reschedule is there to repair. It used
// to be checked nowhere at all: the function existed, nothing called it, and a
// late reminder had no explanation anywhere in the UI.
export async function checkExactAlarms() {
  const api = localNotifications();
  if (!api || typeof api.checkExactNotificationSetting !== "function") {
    exactAlarms = "unknown";
    return exactAlarms;
  }
  try {
    const result = await api.checkExactNotificationSetting();
    exactAlarms = normalizeExact(result);
  } catch (_) {
    exactAlarms = "unknown";
  }
  return exactAlarms;
}

function normalizeExact(result) {
  const value = String((result && result.exact_alarm) || "");
  return value === "granted" || value === "denied" ? value : "unknown";
}

// Opens Android's "Alarms & reminders" screen for this app and reports what the
// user chose. There is no way to grant this from inside the app -- the OS owns
// the decision -- so the honest offer is a shortcut to the switch.
export async function openExactAlarmSettings() {
  const api = localNotifications();
  if (!api || typeof api.changeExactNotificationSetting !== "function") {
    return exactAlarms;
  }
  try {
    exactAlarms = normalizeExact(await api.changeExactNotificationSetting());
  } catch (_) {
    /* dismissed, or no such screen on this device: leave the last known state */
  }
  // Alarms already on the books were scheduled inexact; granting the permission
  // does not upgrade them, so they have to be laid down again.
  rescheduleReminders();
  return exactAlarms;
}

/* ====================================================================== */
/* What to schedule                                                       */
/* ====================================================================== */

function weekdaysForRepeat(reminder) {
  if (reminder.repeat === "daily") return [...ALL_WEEKDAYS];
  if (reminder.repeat === "weekdays") return [1, 2, 3, 4, 5];
  const days = Array.isArray(reminder.days) ? reminder.days : [];
  return days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

// Fading reminders.
//
// A prompt you no longer need is noise, and noise is what gets an app's
// notifications switched off wholesale. As a habit's strength climbs, thin the
// reminders out -- but never to nothing, because a habit that has gone quiet
// for a fortnight still deserves one nudge.
//
// This is one of the interventions habit researchers rate highly and almost no
// shipping app implements.
export function fadeWeekdays(weekdays, score) {
  if (weekdays.length <= 1) return weekdays;
  if (score < SCORE_ESTABLISHED) return weekdays;
  if (score < 0.9) {
    // Roughly half: keep every other configured day.
    return weekdays.filter((_, index) => index % 2 === 0);
  }
  // Established. One standing nudge a week.
  return weekdays.slice(0, 1);
}

// The full set of alarms the current state implies. Pure enough to eyeball:
// it reads state and prefs, and returns plain descriptors.
export function collectReminders() {
  const out = [];

  const global = getDailyReminder();
  if (global.enabled) {
    const time = parseTimeString(global.time);
    if (time) {
      ALL_WEEKDAYS.forEach((weekday) => {
        out.push({
          id: GLOBAL_ID_BASE + weekday,
          title: "Habit Maker",
          body: "How did today go? Tick off what you managed.",
          weekday,
          hour: time.hour,
          minute: time.minute,
        });
      });
    }
  }

  const fade = getFadeReminders();

  getSortedDailyHabits().forEach((habit, index) => {
    const reminder = habit.reminder || {};
    if (!reminder.enabled) return;
    const time = parseTimeString(reminder.time);
    if (!time) return;

    let weekdays = weekdaysForRepeat(reminder);
    if (!weekdays.length) return;
    if (fade) weekdays = fadeWeekdays(weekdays, computeHabitScore(habit.id));

    weekdays.forEach((weekday, slot) => {
      if (slot >= IDS_PER_HABIT) return;
      out.push({
        id: HABIT_ID_BASE + index * IDS_PER_HABIT + weekday,
        title: habit.name,
        // The implementation intention, when there is one, IS the reminder.
        // "After I pour my coffee, I will read for ten minutes" is a far better
        // nudge than the habit's name repeated back at you.
        body: habit.cue
          ? habit.cue
          : `Time for ${habit.name}.`,
        weekday,
        hour: time.hour,
        minute: time.minute,
      });
    });
  });

  // One-off tasks. A single alarm at a single moment, described by `at` rather
  // than a weekday -- the one place this app schedules something that does not
  // repeat. Nothing is laid down for a task already ticked off, or for one
  // whose moment has gone: the OS would fire it immediately on Android, which
  // is how a missed reminder turns into a notification storm on next launch.
  const now = Date.now();
  getAllTasks().forEach((task, index) => {
    if (task.done) return;
    const at = taskReminderAt(task);
    if (!at || at.getTime() <= now) return;
    out.push({
      id: TASK_ID_BASE + index,
      title: task.title,
      body: task.note ? task.note : "Due today.",
      at,
    });
  });

  return out;
}

/* ====================================================================== */
/* Native scheduling                                                      */
/* ====================================================================== */

// Capacitor's Weekday enum is 1-based from Sunday; JS getDay() is 0-based from
// Sunday. One of the two off-by-ones this file exists to contain.
function toCapacitorWeekday(jsWeekday) {
  return jsWeekday + 1;
}

async function scheduleNative(reminders) {
  const api = localNotifications();
  if (!api) return false;

  try {
    const pending = await api.getPending();
    const ids = ((pending && pending.notifications) || [])
      .map((n) => ({ id: n.id }))
      .filter((n) => Number.isInteger(n.id));
    if (ids.length) await api.cancel({ notifications: ids });
  } catch (_) {
    /* nothing pending, or the query failed; scheduling below still works */
  }

  if (!reminders.length) return true;

  try {
    await api.schedule({
      notifications: reminders.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        // A one-off task carries `at`: an exact moment, fired once, never
        // repeated. Everything else is a weekly recurrence.
        schedule: r.at
          ? { at: r.at, allowWhileIdle: true }
          : {
              on: {
                weekday: toCapacitorWeekday(r.weekday),
                hour: r.hour,
                minute: r.minute,
                // Pinned, because the plugin builds the trigger from "now" and
                // only overwrites the fields it is given -- so without this an
                // 08:00 reminder fires at 08:00 plus whatever second the app
                // happened to reschedule on.
                second: 0,
              },
              repeats: true,
              // Survive Doze. Without it a 21:00 reminder can arrive at 23:40.
              allowWhileIdle: true,
            },
      })),
    });
    return true;
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "notifications",
      operation: "scheduleNative",
      message: "Could not schedule native reminders.",
      error,
    });
    return false;
  }
}

/* ====================================================================== */
/* Web scheduling                                                         */
/* ====================================================================== */

// Only alarms inside this window get a timer. Anything further out is picked up
// by a later re-arm; a setTimeout measured in days is neither reliable nor
// necessary.
const WEB_HORIZON_MS = 6 * 60 * 60 * 1000;
const WEB_REARM_MS = 15 * 60 * 1000;

let webTimers = [];
let rearmTimer = 0;
// Fired-at stamps, so a re-arm inside the same minute cannot double-fire.
const firedAt = new Map();

function clearWebTimers() {
  webTimers.forEach((t) => clearTimeout(t));
  webTimers = [];
}

function nextOccurrence(reminder, from) {
  // A one-off task already knows exactly when it wants to fire.
  if (reminder.at) return new Date(reminder.at);
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setHours(reminder.hour, reminder.minute, 0, 0);
  let ahead = (reminder.weekday - candidate.getDay() + 7) % 7;
  if (ahead === 0 && candidate.getTime() <= from.getTime()) ahead = 7;
  candidate.setDate(candidate.getDate() + ahead);
  return candidate;
}

// The service worker registration, or null. Deliberately `getRegistration()`
// and not `ready`: `ready` never settles when nothing is registered, which is
// every environment without a service worker -- the APK among them -- and
// awaiting it there would hang the delivery for ever instead of falling back.
async function serviceWorkerRegistration() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) || null;
  } catch (_) {
    return null;
  }
}

// Exported so the tests can drive the real delivery path with a stubbed
// service worker and a stubbed Notification, rather than asserting that a timer
// was set and hoping.
export async function fireWebNotification(reminder) {
  const stamp = `${reminder.id}:${new Date().toDateString()}`;
  if (firedAt.has(stamp)) return;
  firedAt.set(stamp, Date.now());
  // Bounded: one entry per reminder per day, cleared well before it matters.
  if (firedAt.size > 200) firedAt.clear();

  const options = {
    body: reminder.body,
    tag: `habit-${reminder.id}`,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
  };

  try {
    // Through the service worker first.
    //
    // `new Notification()` is an ILLEGAL CONSTRUCTOR in Chrome on Android: it
    // throws, so on a phone the PWA's reminders fired the timer, threw, logged
    // a warning nobody reads, and showed nothing -- for every reminder, every
    // day. A notification there may only be owned by a service worker, and
    // sw.js already has the `notificationclick` handler that focuses Today.
    const registration = await serviceWorkerRegistration();
    if (registration && typeof registration.showNotification === "function") {
      await registration.showNotification(reminder.title, options);
      return;
    }

    // Desktop, or a page with no service worker: the page owns it, so it also
    // owns the click.
    const notification = new Notification(reminder.title, options);
    notification.onclick = () => {
      try {
        window.focus();
        window.location.hash = "#/today";
      } catch (_) {
        /* pop-up blocked or the window is gone */
      }
      notification.close();
    };
  } catch (error) {
    appendLogEntry({
      level: "warn",
      component: "notifications",
      operation: "fireWebNotification",
      message: "Could not show a web notification.",
      error,
    });
  }
}

function scheduleWeb(reminders) {
  clearWebTimers();
  if (Notification.permission !== "granted") return false;

  const now = new Date();
  reminders.forEach((reminder) => {
    const at = nextOccurrence(reminder, now);
    const delay = at.getTime() - now.getTime();
    if (delay < 0 || delay > WEB_HORIZON_MS) return;
    webTimers.push(
      setTimeout(() => {
        fireWebNotification(reminder);
        // Re-arm immediately so the next weekly occurrence is not lost if the
        // tab stays open for days.
        rescheduleReminders();
      }, delay),
    );
  });

  return true;
}

/* ====================================================================== */
/* Entry points                                                           */
/* ====================================================================== */

let rescheduleQueued = false;

// Coalesced: editing a reminder re-renders, and several call sites can ask for
// a reschedule within the same tick.
export function rescheduleReminders() {
  if (rescheduleQueued) return;
  rescheduleQueued = true;
  Promise.resolve().then(async () => {
    rescheduleQueued = false;
    if (!state || !notificationsSupported()) return;

    const reminders = collectReminders();
    try {
      if (isNative()) {
        // Re-read the permission every time rather than trusting the cache: it
        // is revocable from system settings at any moment, and a cache that
        // only ever gets refreshed while it says "not granted" can never find
        // out that it stopped being true.
        await refreshNativePermission();
        if (nativePermission !== "granted") return;
        await scheduleNative(reminders);
        // After scheduling, so Settings can explain a late reminder.
        await checkExactAlarms();
      } else {
        scheduleWeb(reminders);
      }
    } catch (error) {
      appendLogEntry({
        level: "error",
        component: "notifications",
        operation: "rescheduleReminders",
        message: "Rescheduling reminders failed.",
        error,
      });
    }
  });
}

export async function initNotifications() {
  if (!notificationsSupported()) return;

  if (isNative()) {
    await refreshNativePermission();
  }

  rescheduleReminders();

  // Re-arm whenever the app comes back. On the web this is what makes a
  // long-lived tab keep working; on Android it is what recovers alarms the OS
  // dropped when the user revoked the exact-alarm setting.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") rescheduleReminders();
  });
  window.addEventListener("focus", () => rescheduleReminders());

  if (!isNative()) {
    clearTimeout(rearmTimer);
    const tick = () => {
      rescheduleReminders();
      rearmTimer = setTimeout(tick, WEB_REARM_MS);
    };
    rearmTimer = setTimeout(tick, WEB_REARM_MS);
  }
}

// Called from the reminder toggles, so turning one on is what triggers the
// permission prompt. Returns the resulting permission so the UI can explain a
// denial instead of silently doing nothing.
export async function enableRemindersInteractive() {
  const status = getNotificationStatus();
  let permission = status.permission;
  // Anything that is not already settled is worth asking about. Android's
  // fourth state ("prompt-with-rationale", after a dismissed dialog) is
  // normalised into "prompt" upstream precisely so this stays a two-way
  // decision rather than silently doing nothing.
  if (permission === "prompt") {
    permission = await requestNotificationPermission();
  }
  rescheduleReminders();
  return permission;
}

// Human-readable summary of what a habit's reminder will actually do once
// fading has been applied -- so the UI never promises "every day" while the
// scheduler has quietly thinned it to Mondays.
export function describeEffectiveReminder(habit) {
  const reminder = (habit && habit.reminder) || {};
  if (!reminder.enabled) return "Off";
  const time = parseTimeString(reminder.time);
  if (!time) return "Off";

  const configured = weekdaysForRepeat(reminder);
  if (!configured.length) return "No days";

  const effective = getFadeReminders()
    ? fadeWeekdays(configured, computeHabitScore(habit.id))
    : configured;

  const faded = effective.length < configured.length;
  let label;
  if (effective.length === 7) label = "Every day";
  else if (
    effective.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => effective.includes(d))
  ) {
    label = "Weekdays";
  } else {
    label = effective
      .slice()
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d])
      .join(" ");
  }

  return `${label} · ${reminder.time}${faded ? " · eased off" : ""}`;
}

registerRenderer("rescheduleReminders", rescheduleReminders);

// Turning a reminder on is what asks for the OS permission -- and if it comes
// back denied, the app says so instead of leaving a switch that looks on and
// does nothing, which is the failure mode this whole module exists to end.
registerRenderer("requestReminderPermission", () => {
  enableRemindersInteractive().then((permission) => {
    if (permission === "denied") {
      showToast(
        "Notifications are blocked. Turn them on for Habit Maker in your system settings.",
        { duration: 7000 },
      );
    } else if (permission === "granted" && !getNotificationStatus().background) {
      showToast(
        "Reminders will fire while the app is open. Install the Android app for background reminders.",
        { duration: 7000 },
      );
    }
  });
});
