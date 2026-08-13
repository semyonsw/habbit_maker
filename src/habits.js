"use strict";

import { ALL_WEEKDAYS } from "./constants.js";
import { state } from "./state.js";
import {
  monthKey,
  daysInMonth,
  daysBetweenDates,
  parseDateKey,
  normalizeWeekdayArray,
  normalizeMonthDayArray,
  normalizeSequenceLength,
  normalizeSequencePositions,
} from "./utils.js?v=2";
import { saveState, getCurrentMonthData } from "./persistence.js";
import { callRenderer } from "./render-registry.js";

export function getHabitScheduleMode(habit) {
  const mode = String(
    (habit && (habit.scheduleMode || habit.type)) || "fixed",
  );
  if (
    mode === "specific_weekdays" ||
    mode === "specific_month_days" ||
    mode === "custom_sequence"
  ) {
    return mode;
  }
  return "fixed";
}

export function isHabitTrackedOnDate(habit, year, month, day) {
  if (!habit) return true;
  const mode = getHabitScheduleMode(habit);
  if (mode === "fixed") return true;

  if (mode === "specific_weekdays") {
    const weekday = new Date(year, month, day).getDay();
    const activeWeekdays = normalizeWeekdayArray(
      Array.isArray(habit.activeWeekdays)
        ? habit.activeWeekdays
        : ALL_WEEKDAYS,
    );
    return activeWeekdays.includes(weekday);
  }

  if (mode === "specific_month_days") {
    const activeMonthDays = normalizeMonthDayArray(
      Array.isArray(habit.activeMonthDays) ? habit.activeMonthDays : [],
    );
    return activeMonthDays.includes(day);
  }

  if (mode === "custom_sequence") {
    const length = normalizeSequenceLength(habit.sequenceLength);
    const active = normalizeSequencePositions(habit.sequenceActive, length);
    if (!active.length) return false;
    const anchor = parseDateKey(habit.sequenceAnchor);
    // Without a valid start date the cycle has no phase; treat as always-on so
    // the habit stays visible (normalization guarantees a valid anchor).
    if (!anchor) return true;
    const diff = daysBetweenDates(
      anchor.year,
      anchor.month,
      anchor.day,
      year,
      month,
      day,
    );
    if (diff < 0) return false;
    const pos = ((diff % length) + length) % length;
    return active.includes(pos);
  }

  return true;
}

export function getSortedDailyHabits() {
  return [...state.habits.daily].sort(
    (a, b) => (a.order || 0) - (b.order || 0),
  );
}

export function updateHabitOrder() {
  state.habits.daily = getSortedDailyHabits();
  state.habits.daily.forEach((h, idx) => {
    h.order = idx;
  });
}

export function deleteHabit(id) {
  const habit = state.habits.daily.find((h) => h.id === id);
  if (!habit) return;

  callRenderer(
    "openConfirm",
    "Delete habit",
    `Delete "${habit.name}"? Its history goes with it.`,
    () => {
      state.habits.daily = state.habits.daily.filter((h) => h.id !== id);
      updateHabitOrder();
      Object.values(state.months).forEach((monthData) => {
        delete monthData.dailyCompletions[id];
        if (monthData.dailyNotes) {
          delete monthData.dailyNotes[id];
        }
      });
      saveState();
      callRenderer("closeHabitSheet");
      window.location.hash = "#/today";
      callRenderer("renderAll");
    },
  );
}

/* ==========================================================================
   Completion values and statistics
   --------------------------------------------------------------------------
   A checkbox habit stores `true`/`false` for a day. A count habit stores a
   number. Everything reads through these two helpers so the two shapes never
   have to be handled at a call site -- and so an existing boolean written by
   an older build still reads correctly.
   ========================================================================== */

export function getHabitTarget(habit) {
  return habit && habit.trackType === "count"
    ? Math.max(2, parseInt(habit.countTarget, 10) || 2)
    : 1;
}

export function getDayValue(monthData, habitId, day) {
  const row = monthData && monthData.dailyCompletions[habitId];
  const raw = row ? row[day] : undefined;
  if (typeof raw === "number") return raw;
  return raw ? 1 : 0;
}

export function isHabitDoneOn(habit, monthData, day) {
  return getDayValue(monthData, habit.id, day) >= getHabitTarget(habit);
}

// The single write path for a completion, so every surface stays in step.
export function setHabitDayValue(habitId, day, value) {
  const habit = state.habits.daily.find((h) => h.id === habitId);
  if (!habit) return;
  const monthData = getCurrentMonthData();
  if (!monthData.dailyCompletions[habitId]) {
    monthData.dailyCompletions[habitId] = {};
  }
  const target = getHabitTarget(habit);
  const next = Math.max(0, Math.min(target, Number(value) || 0));
  // Checkbox habits keep storing booleans, so a downgrade to an older build
  // (or an export read by one) still sees the shape it expects.
  monthData.dailyCompletions[habitId][day] =
    habit.trackType === "count" ? next : next >= 1;
  saveState();
  callRenderer("renderAll");
}

// Tap behaviour from the design: a checkbox toggles; a counter increments and
// wraps back to zero once it is past its target.
export function advanceHabitDay(habitId, day) {
  const habit = state.habits.daily.find((h) => h.id === habitId);
  if (!habit) return;
  const monthData = getCurrentMonthData();
  const value = getDayValue(monthData, habitId, day);
  const target = getHabitTarget(habit);
  setHabitDayValue(habitId, day, value >= target ? 0 : value + 1);
}

export function getScheduledHabits(year, month, day) {
  return getSortedDailyHabits().filter((h) =>
    isHabitTrackedOnDate(h, year, month, day),
  );
}

export function getDayCounts(day) {
  const monthData = getCurrentMonthData();
  const habits = getScheduledHabits(state.currentYear, state.currentMonth, day);
  const done = habits.filter((h) => isHabitDoneOn(h, monthData, day)).length;
  return { done, total: habits.length };
}

// Current and best run of consecutive scheduled days, walked over every month
// on record. An unfinished *today* does not break the current run -- you have
// not missed it yet.
export function computeHabitStreak(habitId) {
  const habit = state.habits.daily.find((h) => h.id === habitId);
  if (!habit) return { current: 0, best: 0 };

  const days = [];
  Object.keys(state.months)
    .sort()
    .forEach((key) => {
      const [y, m] = key.split("-").map((n) => parseInt(n, 10));
      const month = m - 1;
      const total = daysInMonth(y, month);
      for (let day = 1; day <= total; day += 1) {
        if (!isHabitTrackedOnDate(habit, y, month, day)) continue;
        days.push({
          y,
          m: month,
          day,
          done: isHabitDoneOn(habit, state.months[key], day),
        });
      }
    });

  let best = 0;
  let chain = 0;
  days.forEach((d) => {
    chain = d.done ? chain + 1 : 0;
    best = Math.max(best, chain);
  });

  const now = new Date();
  const isFuture = (d) =>
    d.y > now.getFullYear() ||
    (d.y === now.getFullYear() && d.m > now.getMonth()) ||
    (d.y === now.getFullYear() && d.m === now.getMonth() && d.day > now.getDate());
  const isToday = (d) =>
    d.y === now.getFullYear() && d.m === now.getMonth() && d.day === now.getDate();

  let current = 0;
  const past = days.filter((d) => !isFuture(d));
  for (let i = past.length - 1; i >= 0; i -= 1) {
    const d = past[i];
    if (!d.done) {
      if (isToday(d)) continue; // still open, not yet a miss
      break;
    }
    current += 1;
  }

  return { current, best };
}

// How many of a habit's scheduled days this month are complete.
export function countHabitMonthDone(habit, year, month) {
  const key = monthKey(year, month);
  const monthData = state.months[key];
  if (!monthData) return 0;
  const total = daysInMonth(year, month);
  let done = 0;
  for (let day = 1; day <= total; day += 1) {
    if (!isHabitTrackedOnDate(habit, year, month, day)) continue;
    if (isHabitDoneOn(habit, monthData, day)) done += 1;
  }
  return done;
}

