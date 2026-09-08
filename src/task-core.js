"use strict";

// Pure rules for one-off tasks: normalisation, ordering, and the labels that
// say which day a task belongs to.
//
// Like scoring.js, nothing in here touches the DOM, the database or the `state`
// singleton -- every function takes what it needs as an argument, so it is
// testable under plain `node --test`. tasks.js is the stateful half.
//
// A task is NOT a habit, and deliberately shares none of the habit maths.
// There is no schedule to satisfy, no streak to extend and no strength to
// decay: it happens once, on one day, and then it is finished. Keeping the two
// models apart is the whole point -- an errand you forgot last Tuesday must not
// dent the strength of a habit you have kept for a year, and a habit's score
// must not be diluted by one-off chores. That is why tasks live in their own
// array rather than as a habit with a one-day schedule.

import { MONTH_NAMES, FULL_WEEKDAYS } from "./constants.js";
import {
  uid,
  isPlainObject,
  parseDateKey,
  formatDateKey,
  parseTimeString,
  daysBetweenDates,
  formatFriendlyDate,
} from "./utils.js";

export const TASK_TITLE_MAX = 120;
export const TASK_NOTE_MAX = 500;
export const TASK_REMINDER_DEFAULT_TIME = "09:00";

/* ====================================================================== */
/* Normalisation                                                          */
/* ====================================================================== */

// One stored task, coerced into the shape the app understands, or null if there
// is nothing usable left.
//
// The date IS the task: a task with nowhere to sit cannot be drawn on any
// screen, so there is no "undated" state to fall back to. A hand-edited backup
// can still carry a broken one, so an unparseable date falls back to the day
// the task was created -- a date we genuinely have on record for it, rather
// than one invented on its behalf. With neither, there is nothing to keep.
export function normalizeTask(raw) {
  if (!isPlainObject(raw)) return null;

  const dated = parseDateKey(raw.date);
  const created = parseDateKey(raw.createdAt);
  const day = dated || created;
  if (!day) return null;

  const reminder = isPlainObject(raw.reminder) ? raw.reminder : {};
  const time = parseTimeString(reminder.time);

  return {
    id: String(raw.id || "") || uid("tk"),
    title:
      String(raw.title == null ? "" : raw.title)
        .trim()
        .slice(0, TASK_TITLE_MAX) || "Task",
    date: formatDateKey(day.year, day.month, day.day),
    note: String(raw.note == null ? "" : raw.note).slice(0, TASK_NOTE_MAX),
    // Optional, unlike a habit's: most one-off errands do not belong to any of
    // the habit categories, and forcing one on them would be noise.
    categoryId: String(raw.categoryId || ""),
    done: raw.done === true,
    reminder: {
      enabled: reminder.enabled === true,
      time: time ? reminder.time : TASK_REMINDER_DEFAULT_TIME,
    },
    createdAt: created
      ? formatDateKey(created.year, created.month, created.day)
      : formatDateKey(day.year, day.month, day.day),
  };
}

// Returns a fresh array; malformed records are dropped rather than carried
// along as landmines for the renderers. The caller can compare lengths if it
// wants to report the loss.
export function normalizeTaskList(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeTask)
    .filter(Boolean);
}

/* ====================================================================== */
/* Ordering and selection                                                 */
/* ====================================================================== */

// Chronological, and STABLE within a day, so tasks added for the same date stay
// in the order they were written down.
//
// Deliberately not "undone first": ticking a task off would then make it jump
// down the list under your finger, and the next tap would land on whatever slid
// up into its place.
//
// A plain string compare is enough because a normalised date is always
// "YYYY-MM-DD" with a four-digit year and zero-padded parts -- parseDateKey()
// accepts nothing else, and formatDateKey() writes nothing else -- so
// lexicographic and chronological order are the same thing here.
export function sortTasks(tasks) {
  return (Array.isArray(tasks) ? tasks.slice() : []).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

export function tasksOnDate(tasks, dateKey) {
  return sortTasks(tasks).filter((task) => task.date === dateKey);
}

// Whole days from `dateKey` to `todayKey`. Positive means the date has passed.
export function daysLate(dateKey, todayKey) {
  const from = parseDateKey(dateKey);
  const to = parseDateKey(todayKey);
  if (!from || !to) return 0;
  return daysBetweenDates(from.year, from.month, from.day, to.year, to.month, to.day);
}

// Tasks whose day has gone by without them being done, oldest first.
//
// Without this a task you missed simply disappears the next morning, which
// defeats the entire purpose of writing it down. They are surfaced on today's
// list instead, marked for what they are.
export function overdueTasks(tasks, todayKey) {
  return sortTasks(tasks).filter(
    (task) => !task.done && daysLate(task.date, todayKey) > 0,
  );
}

export function taskCounts(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  return {
    total: list.length,
    done: list.filter((task) => task.done).length,
  };
}

/* ====================================================================== */
/* Labels                                                                 */
/* ====================================================================== */

// "Today", "Tomorrow", "Yesterday", or "Thursday 10 September".
//
// The date is parsed BEFORE the relative cases are considered. daysLate()
// answers 0 for a date it cannot read, so testing `late === 0` first labelled
// an unreadable date "Today" -- and the task sheet calls this with whatever is
// currently in the date field, which is half-typed or empty much of the time.
export function taskDateLabel(dateKey, todayKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return "";
  const late = daysLate(dateKey, todayKey);
  if (late === 0) return "Today";
  if (late === 1) return "Yesterday";
  if (late === -1) return "Tomorrow";
  return formatFriendlyDate(
    parsed.year,
    parsed.month,
    parsed.day,
    MONTH_NAMES,
    FULL_WEEKDAYS,
  );
}

// How late an overdue task is, in words. Only ever called with late > 0.
export function overdueLabel(late) {
  if (late === 1) return "1 day late";
  return `${late} days late`;
}

/* ====================================================================== */
/* Reminders                                                              */
/* ====================================================================== */

// The exact moment a task's reminder should fire, or null if it has none or
// cannot be read.
//
// One shot, not a weekly repeat: that is the whole difference from a habit's
// reminder, and it is why the notification descriptors in notifications.js
// carry either a weekday or an `at`.
export function taskReminderAt(task) {
  if (!task || !task.reminder || task.reminder.enabled !== true) return null;
  const day = parseDateKey(task.date);
  const time = parseTimeString(task.reminder.time);
  if (!day || !time) return null;
  return new Date(day.year, day.month, day.day, time.hour, time.minute, 0, 0);
}
