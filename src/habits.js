"use strict";

// The stateful side of habits: reading and writing completions against the
// live `state`, and the memo cache in front of the (now range-walking, and so
// more expensive) streak and strength maths.
//
// All the actual arithmetic lives in scoring.js, which knows nothing about
// `state` and is unit-tested directly.

import { SKIPPED, SCORE_HALF_LIFE_DAYS } from "./constants.js";
import { state, globals, getStateRevision } from "./state.js";
import { monthKey, daysInMonth, formatTimeString } from "./utils.js";
import {
  saveState,
  getCurrentMonthData,
  getViewedMonthData,
} from "./persistence.js";
import { callRenderer } from "./render-registry.js";
import { navigateTo } from "./router.js";
import {
  historyRange,
  mergeVisibleOrder,
  computeMonthDayCounts,
  computeScore,
  computeStreak,
  computeUsualTime,
  computeWeekdayStats,
  computeYearGrid,
  getHabitScheduleMode,
  getHabitTarget,
  isDoneValue,
  isHabitTrackedOnDate,
  isSkippedValue,
  readDayValue,
} from "./scoring.js";

export {
  getHabitScheduleMode,
  getHabitTarget,
  isHabitTrackedOnDate,
  isSkippedValue,
};

/* ====================================================================== */
/* Memo cache                                                             */
/* ====================================================================== */

// computeStreak/computeScore now walk the whole calendar range rather than
// just the recorded months, and Today calls them once per visible habit on
// every render -- which happens on every single tap. Without a cache that is a
// full-history walk per habit per tap.
//
// The key is state.js's revision counter, which saveState() bumps on every
// write, so the whole cache is invalidated by any change without anyone having
// to know which derived values a given edit affects.
let memoRevision = -1;
const memo = new Map();

function memoized(kind, habitId, compute) {
  const revision = getStateRevision();
  if (revision !== memoRevision) {
    memo.clear();
    memoRevision = revision;
  }
  const key = `${kind}:${habitId}`;
  if (memo.has(key)) return memo.get(key);
  const value = compute();
  memo.set(key, value);
  return value;
}

/* ====================================================================== */
/* "Now"                                                                  */
/* ====================================================================== */

// A single {year, month, day} for the real current date. Everything that has to
// distinguish "past", "today" and "future" reads this, rather than each site
// building its own `new Date()` and comparing three fields by hand.
export function todayParts() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
  };
}

export function isToday(year, month, day) {
  const t = todayParts();
  return t.year === year && t.month === month && t.day === day;
}

export function isFutureDate(year, month, day) {
  const t = todayParts();
  if (year !== t.year) return year > t.year;
  if (month !== t.month) return month > t.month;
  return day > t.day;
}

/* ====================================================================== */
/* Habit list                                                             */
/* ====================================================================== */

export function getSortedDailyHabits() {
  return [...state.habits.daily].sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function updateHabitOrder() {
  state.habits.daily = getSortedDailyHabits();
  state.habits.daily.forEach((h, idx) => {
    h.order = idx;
  });
}

// Commit a drag on the Today list. `visibleIds` is what is now on screen, top
// to bottom; habits not scheduled for the viewed day keep their own slots.
export function applyVisibleOrder(visibleIds) {
  const ordered = getSortedDailyHabits();
  const allIds = ordered.map((h) => h.id);
  const known = new Set(allIds);
  const moving = visibleIds.filter((id) => known.has(id));
  if (!moving.length) return false;

  const nextIds = mergeVisibleOrder(allIds, moving);
  if (nextIds.every((id, i) => id === allIds[i])) return false; // no change

  const byId = new Map(ordered.map((h) => [h.id, h]));
  state.habits.daily = nextIds.map((id) => byId.get(id));
  state.habits.daily.forEach((habit, index) => {
    habit.order = index;
  });
  saveState();
  return true;
}

// Move one habit one place up or down within the habits visible on the viewed
// day. The keyboard equivalent of the drag, and how reordering is done without
// a pointer at all.
export function nudgeHabitOrder(habitId, delta) {
  const visible = getScheduledHabits(
    state.currentYear,
    state.currentMonth,
    currentSelectedDay(),
  ).map((h) => h.id);

  const from = visible.indexOf(habitId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= visible.length) return false;

  visible.splice(to, 0, visible.splice(from, 1)[0]);
  return applyVisibleOrder(visible);
}

// The day Today is showing. Duplicated from render-today's getSelectedDay()
// rather than imported, to keep habits.js free of render imports.
function currentSelectedDay() {
  const total = daysInMonth(state.currentYear, state.currentMonth);
  if (globals.dayFocusDay == null) {
    const t = todayParts();
    const viewingCurrent =
      t.year === state.currentYear && t.month === state.currentMonth;
    return viewingCurrent ? t.day : 1;
  }
  return Math.min(total, Math.max(1, globals.dayFocusDay));
}

export function findHabit(id) {
  return state.habits.daily.find((h) => h.id === id) || null;
}

export function deleteHabit(id) {
  const habit = findHabit(id);
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
        if (monthData.dailyNotes) delete monthData.dailyNotes[id];
        if (monthData.dailyTimes) delete monthData.dailyTimes[id];
      });
      saveState();
      // keepHistory + forgetOverlayEntry, because navigateTo() below is
      // itself a history change: letting the sheet issue its own back() here
      // would race the navigation. See the back-button notes in modals.js.
      callRenderer("closeHabitSheet", { keepHistory: true });
      callRenderer("forgetOverlayEntry");
      navigateTo("today");
      callRenderer("renderAll");
    },
  );
}

/* ====================================================================== */
/* Reading a day                                                          */
/* ====================================================================== */

export function getDayValue(monthData, habitId, day) {
  return readDayValue(monthData, habitId, day);
}

export function isHabitDoneOn(habit, monthData, day) {
  return isDoneValue(
    readDayValue(monthData, habit.id, day),
    getHabitTarget(habit),
  );
}

export function isHabitSkippedOn(habit, monthData, day) {
  return isSkippedValue(readDayValue(monthData, habit.id, day));
}

export function getScheduledHabits(year, month, day) {
  return getSortedDailyHabits().filter((h) =>
    isHabitTrackedOnDate(h, year, month, day),
  );
}

/* ====================================================================== */
/* Writing a day                                                          */
/* ====================================================================== */

function monthDataFor(year, month) {
  return state.months[monthKey(year, month)] || null;
}

// Record the wall-clock time a habit was completed, but only when the day being
// filled in IS today -- back-filling last Tuesday says nothing about when you
// usually do the thing, and would poison the "usual time" average.
function recordCompletionTime(monthData, habitId, day) {
  if (!isToday(state.currentYear, state.currentMonth, day)) return;
  if (!monthData.dailyTimes) monthData.dailyTimes = {};
  if (!monthData.dailyTimes[habitId]) monthData.dailyTimes[habitId] = {};
  const now = new Date();
  monthData.dailyTimes[habitId][day] = formatTimeString(
    now.getHours(),
    now.getMinutes(),
  );
}

function clearCompletionTime(monthData, habitId, day) {
  if (monthData.dailyTimes && monthData.dailyTimes[habitId]) {
    delete monthData.dailyTimes[habitId][day];
  }
}

// The single write path for a completion, so every surface stays in step.
export function setHabitDayValue(habitId, day, value, options = {}) {
  const habit = findHabit(habitId);
  if (!habit) return;
  const monthData = getCurrentMonthData();
  if (!monthData.dailyCompletions[habitId]) {
    monthData.dailyCompletions[habitId] = {};
  }

  const target = getHabitTarget(habit);

  if (value === SKIPPED) {
    monthData.dailyCompletions[habitId][day] = SKIPPED;
    clearCompletionTime(monthData, habitId, day);
  } else {
    const next = Math.max(0, Math.min(target, Number(value) || 0));
    // Checkbox habits keep storing booleans, so a downgrade to an older build
    // (or an export read by one) still sees the shape it expects.
    monthData.dailyCompletions[habitId][day] =
      habit.trackType === "count" ? next : next >= 1;
    if (isDoneValue(next, target)) recordCompletionTime(monthData, habitId, day);
    else clearCompletionTime(monthData, habitId, day);
  }

  saveState();
  if (!options.silent) callRenderer("renderAll");
}

// Tap behaviour from the design: a checkbox toggles; a counter increments and
// wraps back to zero once it is past its target. A skipped day is cleared by
// the same tap rather than needing to be un-skipped first.
export function advanceHabitDay(habitId, day) {
  const habit = findHabit(habitId);
  if (!habit) return null;
  const monthData = getViewedMonthData();
  const previous = readDayValue(monthData, habitId, day);
  const target = getHabitTarget(habit);

  let next;
  if (isSkippedValue(previous)) next = target; // skipped -> straight to done
  else if (previous >= target) next = 0;
  else next = previous + 1;

  setHabitDayValue(habitId, day, next);
  return { previous, next };
}

// Mark a day deliberately skipped -- rest day, illness, travel. Neutral to both
// the streak and the strength score, which is the point: the alternative is
// either lying (marking it done) or taking a hit for a day you had already
// decided not to do. Skipping again clears it.
export function toggleHabitDaySkip(habitId, day) {
  const habit = findHabit(habitId);
  if (!habit) return null;
  const monthData = getViewedMonthData();
  const previous = readDayValue(monthData, habitId, day);
  const next = isSkippedValue(previous) ? 0 : SKIPPED;
  setHabitDayValue(habitId, day, next);
  return { previous, next };
}

// Restore a raw stored value. Used by Undo, which has to be able to put back a
// partial count or a skip, not just "off".
export function restoreHabitDayValue(habitId, day, value) {
  setHabitDayValue(habitId, day, value);
}

/* ====================================================================== */
/* Stats                                                                  */
/* ====================================================================== */

export function computeHabitStreak(habitId) {
  const habit = findHabit(habitId);
  if (!habit) return { current: 0, best: 0 };
  return memoized("streak", habitId, () =>
    computeStreak(habit, state.months, todayParts()),
  );
}

// 0..1 habit strength. See constants.js for what the number means.
export function computeHabitScore(habitId) {
  const habit = findHabit(habitId);
  if (!habit) return 0;
  return memoized("score", habitId, () =>
    computeScore(habit, state.months, todayParts(), SCORE_HALF_LIFE_DAYS),
  );
}

export function getHabitUsualTime(habitId) {
  const habit = findHabit(habitId);
  if (!habit) return null;
  return memoized("usualTime", habitId, () =>
    computeUsualTime(habit, state.months),
  );
}

export function getHabitWeekdayStats(habitId) {
  const habit = findHabit(habitId);
  if (!habit) return [];
  return memoized("weekday", habitId, () =>
    computeWeekdayStats([habit], state.months, todayParts()),
  );
}

export function getAllWeekdayStats() {
  return memoized("weekday", "__all__", () =>
    computeWeekdayStats(getSortedDailyHabits(), state.months, todayParts()),
  );
}

export function getYearGrid(year) {
  return memoized("yearGrid", String(year), () =>
    computeYearGrid(getSortedDailyHabits(), state.months, year, todayParts()),
  );
}

// Per-day {done, total, skipped} for the whole viewed month, in one pass.
// Cached per render because the day strip needs all 31 at once.
export function getMonthDayCounts() {
  const year = state.currentYear;
  const month = state.currentMonth;
  return memoized("dayCounts", `${year}-${month}`, () =>
    computeMonthDayCounts(
      getSortedDailyHabits(),
      monthDataFor(year, month),
      year,
      month,
    ),
  );
}

export function getDayCounts(day) {
  const counts = getMonthDayCounts();
  return counts[day] || { done: 0, total: 0, skipped: 0 };
}

// How many of a habit's scheduled days this month are complete.
export function countHabitMonthDone(habit, year, month) {
  const monthData = monthDataFor(year, month);
  if (!monthData) return 0;
  const total = daysInMonth(year, month);
  const target = getHabitTarget(habit);
  let done = 0;
  for (let day = 1; day <= total; day += 1) {
    if (!isHabitTrackedOnDate(habit, year, month, day)) continue;
    if (isDoneValue(readDayValue(monthData, habit.id, day), target)) done += 1;
  }
  return done;
}

/* ====================================================================== */
/* Month navigation                                                       */
/* ====================================================================== */

// Step the viewed month. The day selection is dropped, because day 29 of a
// 31-day month is meaningless in February -- getSelectedDay() re-resolves it to
// today (if the new month is the current one) or the 1st.
export function shiftViewedMonth(delta) {
  let month = state.currentMonth + delta;
  let year = state.currentYear;
  while (month < 0) {
    month += 12;
    year -= 1;
  }
  while (month > 11) {
    month -= 12;
    year += 1;
  }
  state.currentMonth = month;
  state.currentYear = year;
  globals.dayFocusDay = null;
  saveState();
  callRenderer("renderAll");
}

// The oldest month the app will let you navigate to.
//
// Both the month bar and the year stepper were unbounded, so holding the back
// chevron walked you into 1997 through a thousand identical empty calendars
// with no indication that there was nothing there and no quick way back.
//
// The floor is a year before your first record rather than the record itself,
// because back-filling a month you did not have the app open for is a real
// thing people do -- and on a fresh install the earliest record IS this month,
// so bounding to it exactly would forbid entering anything for last week.
const BACKFILL_MONTHS = 12;

export function earliestNavigableMonth() {
  const { from } = historyRange(state.months, todayParts());
  let year = from.year;
  let month = from.month - BACKFILL_MONTHS;
  while (month < 0) {
    month += 12;
    year -= 1;
  }
  return { year, month };
}

export function canViewEarlierMonth() {
  const floor = earliestNavigableMonth();
  if (state.currentYear !== floor.year) return state.currentYear > floor.year;
  return state.currentMonth > floor.month;
}

// Oldest year with any record, for the Analytics heatmap. Read-only, so there
// is no back-fill allowance here: an empty year is just noise.
export function earliestRecordedYear() {
  return historyRange(state.months, todayParts()).from.year;
}

export function isViewingCurrentMonth() {
  const t = todayParts();
  return state.currentYear === t.year && state.currentMonth === t.month;
}

export function goToCurrentMonth() {
  const t = todayParts();
  state.currentYear = t.year;
  state.currentMonth = t.month;
  globals.dayFocusDay = null;
  saveState();
  callRenderer("renderAll");
}
