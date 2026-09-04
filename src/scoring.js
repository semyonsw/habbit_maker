"use strict";

// Pure habit maths: scheduling, streaks, strength, and the roll-ups the
// Analytics screen draws.
//
// Nothing in here touches the DOM, the database, or the `state` singleton --
// every function takes what it needs as an argument. That is deliberate: this
// is the part of the app that is easy to get quietly wrong (see the month-gap
// bug this module was extracted to fix), so it is also the part that has to be
// testable under plain `node --test`. See tests/scoring.test.mjs.

import {
  ALL_WEEKDAYS,
  SKIPPED,
  SCORE_HALF_LIFE_DAYS,
} from "./constants.js";
import {
  daysInMonth,
  daysBetweenDates,
  monthKey,
  parseDateKey,
  normalizeWeekdayArray,
  normalizeMonthDayArray,
  normalizeSequenceLength,
  normalizeSequencePositions,
} from "./utils.js";

/* ====================================================================== */
/* Scheduling                                                             */
/* ====================================================================== */

export function getHabitScheduleMode(habit) {
  const mode = String((habit && (habit.scheduleMode || habit.type)) || "fixed");
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
      Array.isArray(habit.activeWeekdays) ? habit.activeWeekdays : ALL_WEEKDAYS,
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

/* ====================================================================== */
/* Reading one day                                                        */
/* ====================================================================== */

export function getHabitTarget(habit) {
  return habit && habit.trackType === "count"
    ? Math.max(2, parseInt(habit.countTarget, 10) || 2)
    : 1;
}

// Raw stored value for a day: a number, or 0/1 for the legacy boolean shape.
// SKIPPED (-1) is passed straight through.
export function readDayValue(monthData, habitId, day) {
  const row = monthData && monthData.dailyCompletions
    ? monthData.dailyCompletions[habitId]
    : undefined;
  const raw = row ? row[day] : undefined;
  if (typeof raw === "number") return raw;
  return raw ? 1 : 0;
}

export function isSkippedValue(value) {
  return value === SKIPPED;
}

export function isDoneValue(value, target) {
  return value >= Math.max(1, target);
}

// 0..1 credit toward the day. A count habit at 2 of 4 earns half. A skipped day
// earns nothing, but callers must exclude it rather than score it as a miss.
export function creditForValue(value, target) {
  if (isSkippedValue(value)) return 0;
  const safeTarget = Math.max(1, target);
  return Math.min(1, Math.max(0, value / safeTarget));
}

/* ====================================================================== */
/* Walking history                                                        */
/* ====================================================================== */

function parseMonthKey(key) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key));
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  if (month < 0 || month > 11) return null;
  return { year, month };
}

// Does this month hold anything a user actually entered?
//
// A month object exists as soon as a month is rendered, so "the month exists"
// is not the same as "something happened that month". Merely paging back
// through the calendar used to create records, which pushed the start of
// history back a month at a time -- and since the navigation floor is derived
// from the start of history, the floor receded exactly as fast as you walked
// towards it. (getViewedMonthData() in persistence.js is the other half of that
// fix: reads no longer create.)
export function monthHasRecords(monthData) {
  if (!monthData) return false;

  const anyRow = (bag) =>
    !!bag &&
    Object.values(bag).some(
      (row) => row && typeof row === "object" && Object.keys(row).length > 0,
    );

  if (anyRow(monthData.dailyCompletions)) return true;
  if (anyRow(monthData.dailyNotes)) return true;

  const review = monthData.monthlyReview;
  if (review && (review.wins || review.blockers || review.focus)) return true;

  return false;
}

// The calendar span the app should reason over: from the earliest month that
// has any record, to `today`.
//
// This is the fix for the month-gap bug. The old code iterated
// Object.keys(state.months), and a month object only ever exists if you opened
// the app during it -- so a month you skipped entirely was not "all missed", it
// was ABSENT, and the walk stepped straight over it. A 40-day streak survived a
// 30-day disappearance. Iterating the range instead means an unopened month
// contributes its scheduled days with no completions, which is the truth.
export function historyRange(months, today) {
  let earliest = { year: today.year, month: today.month };
  Object.keys(months || {}).forEach((key) => {
    const parsed = parseMonthKey(key);
    if (!parsed) return;
    if (!monthHasRecords(months[key])) return;
    if (
      parsed.year < earliest.year ||
      (parsed.year === earliest.year && parsed.month < earliest.month)
    ) {
      earliest = parsed;
    }
  });
  return { from: earliest, to: { year: today.year, month: today.month } };
}

// Visit every scheduled day for `habit` from the start of history to `today`,
// in chronological order. `visit({year, month, day, value, isToday})`.
export function walkScheduledDays(habit, months, today, visit) {
  const { from, to } = historyRange(months, today);
  let year = from.year;
  let month = from.month;

  for (;;) {
    const monthData = (months || {})[monthKey(year, month)] || null;
    const total = daysInMonth(year, month);
    const lastDay =
      year === today.year && month === today.month ? today.day : total;

    for (let day = 1; day <= lastDay; day += 1) {
      if (!isHabitTrackedOnDate(habit, year, month, day)) continue;
      visit({
        year,
        month,
        day,
        value: readDayValue(monthData, habit.id, day),
        isToday:
          year === today.year && month === today.month && day === today.day,
      });
    }

    if (year === to.year && month === to.month) break;
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    // Guard against a corrupt future-dated month key sending this to infinity.
    if (year > to.year + 1) break;
  }
}

/* ====================================================================== */
/* Streak                                                                 */
/* ====================================================================== */

// Current and best run of consecutive scheduled days.
//
// An unfinished *today* does not break the current run -- you have not missed
// it yet. A deliberately skipped day is neutral: it neither extends the streak
// nor ends it.
export function computeStreak(habit, months, today) {
  if (!habit) return { current: 0, best: 0 };
  const target = getHabitTarget(habit);
  const days = [];

  walkScheduledDays(habit, months, today, (entry) => days.push(entry));

  let best = 0;
  let chain = 0;
  days.forEach((d) => {
    if (isSkippedValue(d.value)) return; // neutral: carry the chain across
    if (isDoneValue(d.value, target)) {
      chain += 1;
      best = Math.max(best, chain);
    } else {
      chain = 0;
    }
  });

  let current = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const d = days[i];
    if (isSkippedValue(d.value)) continue;
    if (!isDoneValue(d.value, target)) {
      if (d.isToday) continue; // still open, not yet a miss
      break;
    }
    current += 1;
  }

  return { current, best };
}

/* ====================================================================== */
/* Strength                                                               */
/* ====================================================================== */

// Exponentially weighted moving average over scheduled days, in [0, 1].
//
//   score <- score * k + credit * (1 - k),   k = 0.5 ** (1 / halfLife)
//
// Recent chances weigh most, but nothing is ever discarded, so the number moves
// like a real habit does: it climbs steadily, dips on a bad week, and recovers
// quickly once you start again. Unlike a streak it cannot be destroyed by one
// bad day, which is the entire point.
export function computeScore(habit, months, today, halfLife) {
  if (!habit) return 0;
  const target = getHabitTarget(habit);
  const k = Math.pow(0.5, 1 / Math.max(1, halfLife || SCORE_HALF_LIFE_DAYS));
  let score = 0;

  walkScheduledDays(habit, months, today, (d) => {
    if (isSkippedValue(d.value)) return; // neutral
    // Today is still open: an empty box is not yet a miss, so it must not drag
    // the score down every time you look at the app in the morning.
    if (d.isToday && !isDoneValue(d.value, target)) return;
    score = score * k + creditForValue(d.value, target) * (1 - k);
  });

  return Math.min(1, Math.max(0, score));
}

/* ====================================================================== */
/* Ordering                                                               */
/* ====================================================================== */

// Splice a reordered subset back into the full list.
//
// Today only shows the habits scheduled for the day you are looking at, so a
// drag there reorders a FILTERED list. Rewriting the whole order from what was
// on screen would fling every hidden habit to the end -- reorder two habits on
// a Tuesday and the ones you only do at weekends silently pile up at the
// bottom.
//
// Instead the slots the visible habits occupied are refilled, in their new
// order, and every hidden habit keeps the exact position it had. Move the third
// visible habit to the top and that is all that changes.
export function mergeVisibleOrder(allIds, visibleIdsInNewOrder) {
  const moving = new Set(visibleIdsInNewOrder);
  let next = 0;
  return allIds.map((id) =>
    moving.has(id) ? visibleIdsInNewOrder[next++] : id,
  );
}

/* ====================================================================== */
/* Roll-ups for Analytics                                                 */
/* ====================================================================== */

// One pass over the month producing per-day totals for every day, instead of
// the old getDayCounts() called 31 times (each of which re-sorted and
// re-filtered the whole habit list).
//
// Returns an array indexed by day-of-month; index 0 is unused.
export function computeMonthDayCounts(habits, monthData, year, month) {
  const total = daysInMonth(year, month);
  const out = new Array(total + 1);
  for (let day = 0; day <= total; day += 1) {
    out[day] = { done: 0, total: 0, skipped: 0 };
  }

  (habits || []).forEach((habit) => {
    const target = getHabitTarget(habit);
    for (let day = 1; day <= total; day += 1) {
      if (!isHabitTrackedOnDate(habit, year, month, day)) continue;
      const value = readDayValue(monthData, habit.id, day);
      if (isSkippedValue(value)) {
        // A skipped habit is not "scheduled but unmet" -- drop it from the
        // denominator so the day can still read as 100%.
        out[day].skipped += 1;
        continue;
      }
      out[day].total += 1;
      if (isDoneValue(value, target)) out[day].done += 1;
    }
  });

  return out;
}

// Completion rate per weekday (0=Sun..6=Sat) across all history up to today.
// `habits` may be one habit or many.
export function computeWeekdayStats(habits, months, today) {
  const stats = ALL_WEEKDAYS.map(() => ({ done: 0, total: 0 }));

  (habits || []).forEach((habit) => {
    const target = getHabitTarget(habit);
    walkScheduledDays(habit, months, today, (d) => {
      if (isSkippedValue(d.value)) return;
      if (d.isToday && !isDoneValue(d.value, target)) return;
      const weekday = new Date(d.year, d.month, d.day).getDay();
      stats[weekday].total += 1;
      if (isDoneValue(d.value, target)) stats[weekday].done += 1;
    });
  });

  return stats.map((s) => ({
    ...s,
    pct: s.total ? Math.round((s.done / s.total) * 100) : null,
  }));
}

// Aggregate completion per calendar date for one year, for the heatmap.
// Returns a Map keyed "YYYY-MM-DD" -> {done, total, skipped}.
export function computeYearGrid(habits, months, year, today) {
  const grid = new Map();

  for (let month = 0; month < 12; month += 1) {
    const monthData = (months || {})[monthKey(year, month)] || null;
    const counts = computeMonthDayCounts(habits, monthData, year, month);
    const total = daysInMonth(year, month);
    for (let day = 1; day <= total; day += 1) {
      const after =
        year > today.year ||
        (year === today.year && month > today.month) ||
        (year === today.year && month === today.month && day > today.day);
      if (after) continue;
      grid.set(
        `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        counts[day],
      );
    }
  }

  return grid;
}

// The hour a habit usually gets done, from the recorded completion times.
// Returns null until there are enough samples to mean anything.
export function computeUsualTime(habit, months, minSamples = 4) {
  if (!habit) return null;
  // Circular mean over 24h, so 23:50 and 00:10 average to midnight rather than
  // to noon.
  let sumSin = 0;
  let sumCos = 0;
  let n = 0;

  Object.keys(months || {}).forEach((key) => {
    const monthData = months[key];
    const row = monthData && monthData.dailyTimes
      ? monthData.dailyTimes[habit.id]
      : null;
    if (!row) return;
    Object.keys(row).forEach((day) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(row[day]));
      if (!match) return;
      const minutes = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
      const angle = (minutes / 1440) * 2 * Math.PI;
      sumSin += Math.sin(angle);
      sumCos += Math.cos(angle);
      n += 1;
    });
  });

  if (n < minSamples) return null;
  let angle = Math.atan2(sumSin / n, sumCos / n);
  if (angle < 0) angle += 2 * Math.PI;
  const minutes = Math.round((angle / (2 * Math.PI)) * 1440) % 1440;
  return {
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
    samples: n,
  };
}
