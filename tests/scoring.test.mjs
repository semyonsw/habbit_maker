// Unit tests for the pure habit maths.
//
// Run with:  npm test        (node --test, no dependencies)
//
// scoring.js and utils.js deliberately import nothing that touches the DOM or
// IndexedDB, which is what makes this file possible. The month-gap bug these
// start with survived for as long as it did precisely because there was
// nothing here.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeMonthDayCounts,
  computeScore,
  computeStreak,
  computeUsualTime,
  computeWeekdayStats,
  computeYearGrid,
  creditForValue,
  historyRange,
  firstScheduledOnOrAfter,
  isHabitTrackedOnDate,
  monthHasRecords,
  readDayValue,
} from "../src/scoring.js";
import { sanitize, parseTimeString, daysBetweenDates } from "../src/utils.js";
import { SKIPPED } from "../src/constants.js";

/* ------------------------------------------------------------- fixtures */

const DAILY = {
  id: "h1",
  name: "Read",
  trackType: "check",
  countTarget: 1,
  scheduleMode: "fixed",
  activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
  activeMonthDays: [],
};

// A month whose every day is marked done.
function fullMonth(habitId, year, month) {
  const days = new Date(year, month + 1, 0).getDate();
  const row = {};
  for (let d = 1; d <= days; d += 1) row[d] = true;
  return { dailyCompletions: { [habitId]: row } };
}

function monthWith(habitId, values) {
  return { dailyCompletions: { [habitId]: { ...values } } };
}

/* ====================================================================== */
/* The month-gap bug                                                      */
/* ====================================================================== */

test("a month with no record breaks the streak instead of being skipped over", () => {
  // January complete, February never opened (so absent from `months`), March
  // 1-5 complete. The old implementation iterated Object.keys(months), so
  // February simply did not exist and January chained onto March for a streak
  // of 36 across a 28-day disappearance.
  const months = {
    "2026-01": fullMonth("h1", 2026, 0),
    "2026-03": monthWith("h1", { 1: true, 2: true, 3: true, 4: true, 5: true }),
  };
  const today = { year: 2026, month: 2, day: 5 };

  const { current, best } = computeStreak(DAILY, months, today);
  assert.equal(current, 5, "only March counts toward the current streak");
  assert.equal(best, 31, "January's 31 days remain the best run");
});

test("historyRange spans from the earliest recorded month to today", () => {
  const range = historyRange(
    {
      "2025-11": monthWith("h1", { 4: true }),
      "2026-03": monthWith("h1", { 9: true }),
    },
    { year: 2026, month: 4, day: 9 },
  );
  assert.deepEqual(range.from, { year: 2025, month: 10 });
  assert.deepEqual(range.to, { year: 2026, month: 4 });
});

test("an EMPTY month does not count as the start of history", () => {
  // Paging back through the calendar used to create a month record for every
  // month merely looked at. History then started wherever you had browsed to,
  // and since the navigation floor is derived from it, the floor ran away from
  // you as you walked towards it.
  const range = historyRange(
    {
      "2020-01": { dailyCompletions: {}, dailyNotes: {} },
      "2024-06": { dailyCompletions: { h1: {} }, dailyNotes: {} },
      "2026-05": monthWith("h1", { 2: true }),
    },
    { year: 2026, month: 4, day: 9 },
  );
  assert.deepEqual(
    range.from,
    { year: 2026, month: 4 },
    "only the month with a real completion counts",
  );
});

test("monthHasRecords recognises every kind of real record", () => {
  assert.equal(monthHasRecords(null), false);
  assert.equal(monthHasRecords({}), false);
  assert.equal(
    monthHasRecords({ dailyCompletions: {}, dailyNotes: {} }),
    false,
    "an empty month is empty",
  );
  assert.equal(
    monthHasRecords({ dailyCompletions: { h1: {} } }),
    false,
    "a habit key with no days is still empty",
  );
  assert.equal(monthHasRecords(monthWith("h1", { 1: false })), true);
  assert.equal(
    monthHasRecords({ dailyNotes: { h1: { 3: "travelling" } } }),
    true,
    "a note alone is a record",
  );
  assert.equal(
    monthHasRecords({ monthlyReview: { wins: "shipped it" } }),
    true,
    "a monthly review alone is a record",
  );
  assert.equal(
    monthHasRecords({ monthlyReview: { wins: "", blockers: "", focus: "" } }),
    false,
    "a blank review is not",
  );
});

test("history with no months at all is just the current month", () => {
  const range = historyRange({}, { year: 2026, month: 6, day: 2 });
  assert.deepEqual(range.from, { year: 2026, month: 6 });
  assert.deepEqual(range.to, { year: 2026, month: 6 });
});

/* ====================================================================== */
/* Streak semantics                                                       */
/* ====================================================================== */

test("an unfinished today does not break the streak", () => {
  const months = {
    "2026-03": monthWith("h1", { 1: true, 2: true, 3: true }),
  };
  // The 4th is today and is still empty.
  const { current } = computeStreak(DAILY, months, {
    year: 2026,
    month: 2,
    day: 4,
  });
  assert.equal(current, 3);
});

test("an unfinished yesterday does break the streak", () => {
  const months = {
    "2026-03": monthWith("h1", { 1: true, 2: true, 3: true }),
  };
  const { current } = computeStreak(DAILY, months, {
    year: 2026,
    month: 2,
    day: 5,
  });
  assert.equal(current, 0, "the 4th was missed and is in the past");
});

test("a skipped day carries the streak across rather than ending it", () => {
  const months = {
    "2026-03": monthWith("h1", {
      1: true,
      2: true,
      3: SKIPPED,
      4: true,
      5: true,
    }),
  };
  const { current, best } = computeStreak(DAILY, months, {
    year: 2026,
    month: 2,
    day: 5,
  });
  assert.equal(current, 4, "four completions, the skip neither adds nor ends");
  assert.equal(best, 4);
});

test("future days are never counted", () => {
  const months = {
    "2026-03": monthWith("h1", { 1: true, 2: true, 20: true }),
  };
  const { best } = computeStreak(DAILY, months, {
    year: 2026,
    month: 2,
    day: 3,
  });
  assert.equal(best, 2, "the 20th has not happened yet");
});

/* ====================================================================== */
/* Strength score                                                         */
/* ====================================================================== */

test("score rises with completions and never quite reaches 1", () => {
  const months = { "2026-01": fullMonth("h1", 2026, 0) };
  const score = computeScore(
    DAILY,
    months,
    { year: 2026, month: 0, day: 31 },
    21,
  );
  assert.ok(score > 0.6, `expected a month of perfection to pass 0.6, got ${score}`);
  assert.ok(score < 1, "exponential smoothing never actually arrives at 1");
});

test("a single miss dents the score instead of destroying it", () => {
  const perfect = { "2026-01": fullMonth("h1", 2026, 0) };
  const today = { year: 2026, month: 0, day: 31 };
  const before = computeScore(DAILY, perfect, today, 21);

  const withMiss = { "2026-01": fullMonth("h1", 2026, 0) };
  withMiss["2026-01"].dailyCompletions.h1[31] = false;
  const after = computeScore(DAILY, withMiss, today, 21);

  assert.ok(after < before, "a miss must cost something");
  assert.ok(
    after > before * 0.9,
    `one miss should cost well under 10%, went ${before} -> ${after}`,
  );
});

test("the half-life is honoured: N consecutive misses halve the score", () => {
  const halfLife = 10;
  const months = { "2026-01": fullMonth("h1", 2026, 0) };
  const peak = computeScore(
    DAILY,
    months,
    { year: 2026, month: 0, day: 31 },
    halfLife,
  );

  // Ten missed days in February: the 1st to the 10th. "Today" has to be the
  // 11th, not the 10th -- today's own empty box is still open and is
  // deliberately not counted as a miss, so dating this to the 10th would apply
  // only nine and land ~3% high.
  const withMisses = {
    "2026-01": fullMonth("h1", 2026, 0),
    "2026-02": monthWith("h1", {}),
  };
  const after = computeScore(
    DAILY,
    withMisses,
    { year: 2026, month: 1, day: 11 },
    halfLife,
  );

  assert.ok(
    Math.abs(after - peak / 2) < 0.02,
    `expected ~${peak / 2} after one half-life of misses, got ${after}`,
  );
});

test("a skipped day is neutral to the score", () => {
  const today = { year: 2026, month: 0, day: 10 };
  const base = {};
  for (let d = 1; d <= 9; d += 1) base[d] = true;

  const withSkip = computeScore(
    DAILY,
    { "2026-01": monthWith("h1", { ...base, 10: SKIPPED }) },
    today,
    21,
  );
  const withoutDay10 = computeScore(
    DAILY,
    { "2026-01": monthWith("h1", base) },
    { year: 2026, month: 0, day: 9 },
    21,
  );
  assert.ok(
    Math.abs(withSkip - withoutDay10) < 1e-9,
    "skipping day 10 must read exactly as if day 10 never came",
  );
});

test("an empty today does not drag the score down", () => {
  const base = {};
  for (let d = 1; d <= 9; d += 1) base[d] = true;
  const months = { "2026-01": monthWith("h1", base) };

  const yesterday = computeScore(
    DAILY,
    months,
    { year: 2026, month: 0, day: 9 },
    21,
  );
  const today = computeScore(
    DAILY,
    months,
    { year: 2026, month: 0, day: 10 },
    21,
  );
  assert.equal(today, yesterday, "opening the app in the morning costs nothing");
});

/* ====================================================================== */
/* Count habits                                                           */
/* ====================================================================== */

test("a count habit earns partial credit", () => {
  const habit = { ...DAILY, trackType: "count", countTarget: 4 };
  assert.equal(creditForValue(0, 4), 0);
  assert.equal(creditForValue(2, 4), 0.5);
  assert.equal(creditForValue(4, 4), 1);
  assert.equal(creditForValue(9, 4), 1, "clamped, never above 1");
  assert.equal(creditForValue(SKIPPED, 4), 0);

  const partial = computeScore(
    habit,
    { "2026-01": monthWith("h1", { 1: 2, 2: 2, 3: 2 }) },
    { year: 2026, month: 0, day: 3 },
    21,
  );
  const full = computeScore(
    habit,
    { "2026-01": monthWith("h1", { 1: 4, 2: 4, 3: 4 }) },
    { year: 2026, month: 0, day: 3 },
    21,
  );
  assert.ok(partial > 0 && partial < full);
});

test("legacy boolean and numeric shapes both read back", () => {
  const monthData = monthWith("h1", { 1: true, 2: false, 3: 3, 4: SKIPPED });
  assert.equal(readDayValue(monthData, "h1", 1), 1);
  assert.equal(readDayValue(monthData, "h1", 2), 0);
  assert.equal(readDayValue(monthData, "h1", 3), 3);
  assert.equal(readDayValue(monthData, "h1", 4), SKIPPED);
  assert.equal(readDayValue(monthData, "h1", 9), 0, "absent reads as not done");
  assert.equal(readDayValue(null, "h1", 1), 0, "absent month reads as not done");
});

/* ====================================================================== */
/* Scheduling                                                             */
/* ====================================================================== */

test("specific weekdays only track on those weekdays", () => {
  // 2026-03-02 is a Monday.
  const habit = {
    ...DAILY,
    scheduleMode: "specific_weekdays",
    activeWeekdays: [1, 3, 5],
  };
  assert.equal(isHabitTrackedOnDate(habit, 2026, 2, 2), true, "Monday");
  assert.equal(isHabitTrackedOnDate(habit, 2026, 2, 3), false, "Tuesday");
  assert.equal(isHabitTrackedOnDate(habit, 2026, 2, 4), true, "Wednesday");
});

test("specific month days only track on those dates", () => {
  const habit = {
    ...DAILY,
    scheduleMode: "specific_month_days",
    activeMonthDays: [1, 15],
  };
  assert.equal(isHabitTrackedOnDate(habit, 2026, 5, 1), true);
  assert.equal(isHabitTrackedOnDate(habit, 2026, 5, 15), true);
  assert.equal(isHabitTrackedOnDate(habit, 2026, 5, 16), false);
});

test("a custom sequence repeats from its anchor and ignores dates before it", () => {
  // Every third day, starting 2026-03-01.
  const habit = {
    ...DAILY,
    scheduleMode: "custom_sequence",
    sequenceLength: 3,
    sequenceActive: [0],
    sequenceAnchor: "2026-03-01",
  };
  assert.equal(isHabitTrackedOnDate(habit, 2026, 2, 1), true);
  assert.equal(isHabitTrackedOnDate(habit, 2026, 2, 2), false);
  assert.equal(isHabitTrackedOnDate(habit, 2026, 2, 3), false);
  assert.equal(isHabitTrackedOnDate(habit, 2026, 2, 4), true);
  assert.equal(
    isHabitTrackedOnDate(habit, 2026, 1, 28),
    false,
    "before the anchor",
  );
});

test("a sequence's phase is DST-proof", () => {
  // Whatever the local zone, a whole-day difference has to stay whole.
  assert.equal(daysBetweenDates(2026, 2, 1, 2026, 2, 31), 30);
  assert.equal(daysBetweenDates(2026, 9, 1, 2026, 10, 1), 31);
});

/* ====================================================================== */
/* Start date                                                             */
/* ====================================================================== */

test("a habit is not tracked before its start date", () => {
  // 2026-03-10 is a Tuesday.
  const h = { ...DAILY, startDate: "2026-03-10" };
  assert.equal(isHabitTrackedOnDate(h, 2026, 2, 9), false, "the day before");
  assert.equal(isHabitTrackedOnDate(h, 2026, 2, 10), true, "the start day");
  assert.equal(isHabitTrackedOnDate(h, 2026, 2, 11), true, "after");
  assert.equal(isHabitTrackedOnDate(h, 2026, 1, 28), false, "a month earlier");
});

test("an empty start date means no restriction", () => {
  assert.equal(isHabitTrackedOnDate({ ...DAILY, startDate: "" }, 2020, 0, 1), true);
  assert.equal(isHabitTrackedOnDate(DAILY, 2020, 0, 1), true, "absent field");
  assert.equal(
    isHabitTrackedOnDate({ ...DAILY, startDate: "nonsense" }, 2020, 0, 1),
    true,
    "an unparseable value is not a silent block",
  );
});

test("a habit added today is not retroactively missed", () => {
  // The complaint this exists for. Added on the 10th, the days before it must
  // not count as misses -- so the score is the score of one good day, not of
  // nine failures followed by one.
  const today = { year: 2026, month: 2, day: 10 };
  const fresh = { ...DAILY, startDate: "2026-03-10" };
  const months = { "2026-03": monthWith("h1", { 10: true }) };

  const { current } = computeStreak(fresh, months, today);
  assert.equal(current, 1, "one day, one streak");

  const score = computeScore(fresh, months, today, 21);
  const oneGoodDay = computeScore(
    { ...DAILY, startDate: "" },
    { "2026-03": monthWith("h1", { 1: true }) },
    { year: 2026, month: 2, day: 1 },
    21,
  );
  assert.ok(
    Math.abs(score - oneGoodDay) < 1e-9,
    "identical to that habit having existed for exactly one day",
  );
});

test("what a start date actually changes is the counts, not the score", () => {
  // Worth being precise about. Misses BEFORE the first completion cannot move
  // the strength score at all: the average starts at zero and a miss multiplies
  // it, so 0 * k is still 0. Scoping the habit to its start date therefore
  // leaves the score identical...
  const today = { year: 2026, month: 2, day: 10 };
  const months = { "2026-03": monthWith("h1", { 10: true }) };
  const unscoped = computeScore({ ...DAILY, startDate: "" }, months, today, 21);
  const scoped = computeScore(
    { ...DAILY, startDate: "2026-03-10" },
    months,
    today,
    21,
  );
  assert.equal(scoped, unscoped, "leading misses were never in the score");

  // ...and changes everything that COUNTS scheduled days: the day totals, the
  // month figure, the weekday breakdown. That is where a habit added today
  // showed up as nine days of failure.
  const counts = computeMonthDayCounts(
    [{ ...DAILY, startDate: "2026-03-10" }],
    months["2026-03"],
    2026,
    2,
  );
  assert.equal(counts[9].total, 0, "the 9th does not schedule it at all");
  assert.equal(counts[10].total, 1);

  const before = computeMonthDayCounts(
    [{ ...DAILY, startDate: "" }],
    months["2026-03"],
    2026,
    2,
  );
  assert.equal(before[9].total, 1, "unscoped, the 9th counted as a miss");
  assert.equal(before[9].done, 0);

  const weekday = computeWeekdayStats(
    [{ ...DAILY, startDate: "2026-03-10" }],
    months,
    today,
  );
  const totalRated = weekday.reduce((sum, w) => sum + w.total, 0);
  assert.equal(totalRated, 1, "one rated day: the one the habit has existed for");

  const totalUnscoped = computeWeekdayStats(
    [{ ...DAILY, startDate: "" }],
    months,
    today,
  ).reduce((sum, w) => sum + w.total, 0);
  assert.equal(totalUnscoped, 10, "unscoped, ten days were being judged");
});

test("start on a Tuesday, scheduled Mon and Fri: the first day is Friday", () => {
  // Exactly the case in the request. 2026-03-10 is a Tuesday; the next Friday
  // is the 13th.
  const monFri = {
    ...DAILY,
    scheduleMode: "specific_weekdays",
    activeWeekdays: [1, 5],
    startDate: "2026-03-10",
  };
  assert.equal(isHabitTrackedOnDate(monFri, 2026, 2, 10), false, "Tuesday");
  assert.equal(isHabitTrackedOnDate(monFri, 2026, 2, 11), false, "Wednesday");
  assert.equal(isHabitTrackedOnDate(monFri, 2026, 2, 12), false, "Thursday");
  assert.equal(isHabitTrackedOnDate(monFri, 2026, 2, 13), true, "Friday");

  assert.deepEqual(
    firstScheduledOnOrAfter(monFri, { year: 2026, month: 2, day: 10 }),
    { year: 2026, month: 2, day: 13 },
  );
  // And the Monday BEFORE the start date is still excluded.
  assert.equal(isHabitTrackedOnDate(monFri, 2026, 2, 9), false, "prior Monday");
});

test("firstScheduledOnOrAfter never returns a day before the start date", () => {
  const monFri = {
    ...DAILY,
    scheduleMode: "specific_weekdays",
    activeWeekdays: [1, 5],
    startDate: "2026-03-10",
  };
  // Asked from a month earlier, it still starts at the start date.
  assert.deepEqual(
    firstScheduledOnOrAfter(monFri, { year: 2026, month: 1, day: 1 }),
    { year: 2026, month: 2, day: 13 },
  );
});

test("firstScheduledOnOrAfter handles a start date that is itself active", () => {
  const daily = { ...DAILY, startDate: "2026-03-10" };
  assert.deepEqual(
    firstScheduledOnOrAfter(daily, { year: 2026, month: 2, day: 10 }),
    { year: 2026, month: 2, day: 10 },
  );
});

test("firstScheduledOnOrAfter gives up rather than looping for ever", () => {
  // A schedule with no active days at all.
  const never = {
    ...DAILY,
    scheduleMode: "specific_month_days",
    activeMonthDays: [],
    startDate: "2026-03-10",
  };
  assert.equal(
    firstScheduledOnOrAfter(never, { year: 2026, month: 2, day: 10 }),
    null,
  );
  assert.equal(firstScheduledOnOrAfter(null, { year: 2026, month: 2, day: 1 }), null);
});

test("a start date keeps a new habit out of the day's denominator", () => {
  const old = { ...DAILY, id: "old", startDate: "" };
  const fresh = { ...DAILY, id: "fresh", startDate: "2026-03-10" };
  const monthData = { dailyCompletions: {} };

  const counts = computeMonthDayCounts([old, fresh], monthData, 2026, 2);
  assert.equal(counts[9].total, 1, "only the old habit was scheduled on the 9th");
  assert.equal(counts[10].total, 2, "both from the 10th");
});

/* ====================================================================== */
/* Roll-ups                                                               */
/* ====================================================================== */

test("skipped habits leave the day's denominator, so a day can still be 100%", () => {
  const a = { ...DAILY, id: "a" };
  const b = { ...DAILY, id: "b" };
  const monthData = {
    dailyCompletions: {
      a: { 1: true },
      b: { 1: SKIPPED },
    },
  };
  const counts = computeMonthDayCounts([a, b], monthData, 2026, 0);
  assert.deepEqual(counts[1], { done: 1, total: 1, skipped: 1 });
  assert.deepEqual(counts[2], { done: 0, total: 2, skipped: 0 });
});

test("weekday stats bucket by real weekday", () => {
  // 2026-03-02 Mon, 03 Tue, 09 Mon, 10 Tue.
  const months = {
    "2026-03": monthWith("h1", { 2: true, 3: false, 9: true, 10: false }),
  };
  const stats = computeWeekdayStats([DAILY], months, {
    year: 2026,
    month: 2,
    day: 10,
  });
  assert.equal(stats[1].done, 2, "both Mondays done");
  assert.equal(stats[1].pct, 100);
  assert.equal(stats[2].done, 0, "both Tuesdays missed");
  assert.equal(stats[2].pct, 0);
});

test("the year grid stops at today and covers the whole year before it", () => {
  const months = { "2026-01": monthWith("h1", { 1: true }) };
  const grid = computeYearGrid([DAILY], months, 2026, {
    year: 2026,
    month: 0,
    day: 3,
  });
  assert.ok(grid.has("2026-01-01"));
  assert.ok(grid.has("2026-01-03"));
  assert.equal(grid.has("2026-01-04"), false, "tomorrow is not in the grid");
  assert.deepEqual(grid.get("2026-01-01"), { done: 1, total: 1, skipped: 0 });
});

test("usual time is a circular mean, so times either side of midnight average correctly", () => {
  const months = {
    "2026-01": {
      dailyTimes: {
        h1: { 1: "23:50", 2: "23:58", 3: "00:02", 4: "00:10" },
      },
    },
  };
  const usual = computeUsualTime(DAILY, months, 4);
  assert.equal(usual.samples, 4);
  // A naive arithmetic mean of these gives ~11:58. The right answer is 00:00.
  const minutes = usual.hour * 60 + usual.minute;
  assert.ok(
    minutes <= 1 || minutes >= 1439,
    `expected ~midnight, got ${usual.hour}:${usual.minute}`,
  );
});

test("usual time stays null until there are enough samples", () => {
  const months = { "2026-01": { dailyTimes: { h1: { 1: "08:00" } } } };
  assert.equal(computeUsualTime(DAILY, months, 4), null);
});

/* ====================================================================== */
/* sanitize()                                                             */
/* ====================================================================== */

test("sanitize escapes quotes, so it is safe in attribute position", () => {
  // The bug: textContent -> innerHTML escapes < > &, but NOT quotes, and
  // sanitize()'s output goes straight into value="..." and aria-label="...".
  // A habit name is user input, and Import accepts arbitrary JSON.
  const hostile = 'x" autofocus onfocus="alert(1)';
  const escaped = sanitize(hostile);
  assert.equal(escaped.includes('"'), false, "no raw double quote survives");
  assert.equal(
    escaped,
    "x&quot; autofocus onfocus=&quot;alert(1)",
  );
});

test("sanitize escapes the rest of the set", () => {
  assert.equal(sanitize("<script>"), "&lt;script&gt;");
  assert.equal(sanitize("a & b"), "a &amp; b");
  assert.equal(sanitize("it's"), "it&#39;s");
  assert.equal(sanitize("`tick`"), "&#96;tick&#96;");
  assert.equal(sanitize(null), "");
  assert.equal(sanitize(0), "0", "zero is a value, not an absence");
});

test("parseTimeString accepts valid times and rejects the rest", () => {
  assert.deepEqual(parseTimeString("08:05"), { hour: 8, minute: 5 });
  assert.deepEqual(parseTimeString("23:59"), { hour: 23, minute: 59 });
  assert.equal(parseTimeString("24:00"), null);
  assert.equal(parseTimeString("08:60"), null);
  assert.equal(parseTimeString(""), null);
  assert.equal(parseTimeString("nope"), null);
});
