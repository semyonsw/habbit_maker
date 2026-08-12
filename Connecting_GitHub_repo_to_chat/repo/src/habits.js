"use strict";

import { ALL_WEEKDAYS, DEFAULT_REMINDER } from "./constants.js";
import { state } from "./state.js";
import { uid, monthKey, daysInMonth, isPlainObject } from "./utils.js";
import { ensureMonthData, saveState } from "./persistence.js";

export function getSortedDailyHabits() {
  return [...state.habits.daily].sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function getHabitById(id) {
  return state.habits.daily.find((h) => h.id === id) || null;
}

export function targetOf(habit) {
  return habit && habit.trackType === "count" ? Math.max(1, habit.countTarget || 1) : 1;
}

export function isHabitTrackedOnDate(habit, year, month, day) {
  if (!habit) return true;
  const mode = habit.scheduleMode || "fixed";
  if (mode === "specific_weekdays") {
    return (habit.activeWeekdays || ALL_WEEKDAYS).includes(new Date(year, month, day).getDay());
  }
  if (mode === "specific_month_days") {
    return (habit.activeMonthDays || []).includes(day);
  }
  return true;
}

export function getValue(habit, year, month, day) {
  const md = state.months[monthKey(year, month)];
  if (!isPlainObject(md)) return 0;
  const byDay = md.dailyCompletions[habit.id];
  if (!isPlainObject(byDay)) return 0;
  return Math.max(0, parseInt(byDay[String(day)], 10) || 0);
}

export function isDone(habit, year, month, day) {
  return getValue(habit, year, month, day) >= targetOf(habit);
}

export function setValue(habit, year, month, day, value) {
  const md = ensureMonthData(year, month);
  const clamped = Math.max(0, Math.min(targetOf(habit), Math.round(value)));
  if (!isPlainObject(md.dailyCompletions[habit.id])) md.dailyCompletions[habit.id] = {};
  if (clamped > 0) md.dailyCompletions[habit.id][String(day)] = clamped;
  else delete md.dailyCompletions[habit.id][String(day)];
  saveState();
}

// One tap: check habits flip, count habits step up and wrap to 0 once full.
export function tapHabit(habit, year, month, day) {
  const value = getValue(habit, year, month, day);
  const target = targetOf(habit);
  setValue(habit, year, month, day, value >= target ? 0 : value + 1);
}

// Streak = consecutive CALENDAR days completed, ending today (or yesterday if
// today is still open, so an unfinished day does not zero the count).
export function streakOf(habit, from = new Date()) {
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (!isDone(habit, cursor.getFullYear(), cursor.getMonth(), cursor.getDate())) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let n = 0;
  for (let guard = 0; guard < 1000; guard += 1) {
    if (!isDone(habit, cursor.getFullYear(), cursor.getMonth(), cursor.getDate())) break;
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export function bestStreakOf(habit) {
  const keys = Object.keys(state.months).sort();
  if (!keys.length) return 0;
  const first = keys[0].split("-");
  const cursor = new Date(parseInt(first[0], 10), parseInt(first[1], 10) - 1, 1);
  const today = new Date();
  let best = 0, run = 0;
  while (cursor <= today) {
    if (isDone(habit, cursor.getFullYear(), cursor.getMonth(), cursor.getDate())) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return best;
}

export function doneCountInMonth(habit, year, month, upToDay) {
  const last = Math.min(upToDay || daysInMonth(year, month), daysInMonth(year, month));
  let n = 0;
  for (let d = 1; d <= last; d += 1) if (isDone(habit, year, month, d)) n += 1;
  return n;
}

export function habitsForDate(year, month, day) {
  return getSortedDailyHabits().filter((h) => isHabitTrackedOnDate(h, year, month, day));
}

export function upsertHabit(input) {
  const draft = isPlainObject(input) ? input : {};
  const existing = draft.id ? getHabitById(draft.id) : null;
  const habit = existing || {
    id: uid("dh"),
    order: state.habits.daily.length,
    reminder: { ...DEFAULT_REMINDER },
  };

  habit.name = String(draft.name || habit.name || "Habit").trim() || "Habit";
  habit.categoryId = String(draft.categoryId || habit.categoryId || "");
  habit.monthGoal = Math.max(1, parseInt(draft.monthGoal, 10) || habit.monthGoal || 20);
  habit.trackType = draft.trackType === "count" ? "count" : "check";
  habit.countTarget = habit.trackType === "count"
    ? Math.max(2, parseInt(draft.countTarget, 10) || 3)
    : 1;
  habit.scheduleMode = ["fixed", "specific_weekdays", "specific_month_days"].includes(draft.scheduleMode)
    ? draft.scheduleMode
    : "fixed";
  habit.activeWeekdays = habit.scheduleMode === "specific_weekdays"
    ? (draft.activeWeekdays && draft.activeWeekdays.length ? draft.activeWeekdays : [1, 2, 3, 4, 5])
    : [...ALL_WEEKDAYS];
  habit.activeMonthDays = habit.scheduleMode === "specific_month_days"
    ? (draft.activeMonthDays && draft.activeMonthDays.length ? draft.activeMonthDays : [1])
    : [];
  habit.reminder = {
    enabled: !!(draft.reminder && draft.reminder.enabled),
    time: (draft.reminder && draft.reminder.time) || habit.reminder.time || DEFAULT_REMINDER.time,
    repeat: (draft.reminder && draft.reminder.repeat) || habit.reminder.repeat || "daily",
    days: (draft.reminder && draft.reminder.days) || habit.reminder.days || [1, 2, 3, 4, 5],
  };

  if (!existing) state.habits.daily.push(habit);
  reorder();
  saveState();
  return habit;
}

export function deleteHabit(id) {
  state.habits.daily = state.habits.daily.filter((h) => h.id !== id);
  Object.values(state.months).forEach((md) => {
    if (md && md.dailyCompletions) delete md.dailyCompletions[id];
    if (md && md.dailyNotes) delete md.dailyNotes[id];
  });
  reorder();
  saveState();
}

export function moveHabit(id, direction) {
  const habits = getSortedDailyHabits();
  const from = habits.findIndex((h) => h.id === id);
  const to = from + (direction === "up" ? -1 : 1);
  if (from < 0 || to < 0 || to >= habits.length) return;
  habits.splice(to, 0, habits.splice(from, 1)[0]);
  state.habits.daily = habits;
  reorder();
  saveState();
}

function reorder() {
  state.habits.daily
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach((h, i) => { h.order = i; });
}
