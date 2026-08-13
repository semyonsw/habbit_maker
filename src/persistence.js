"use strict";

import {
  SCHEMA_VERSION,
  REMINDER_REPEATS,
  ALL_WEEKDAYS,
  DEFAULT_CATEGORIES,
  DEFAULT_DAILY_HABITS,
} from "./constants.js";
import { state, setState } from "./state.js";
import {
  uid,
  monthKey,
  isPlainObject,
  normalizeWeekdayArray,
  normalizeMonthDayArray,
  normalizeSequenceLength,
  normalizeSequencePositions,
  parseDateKey,
  formatDateKey,
} from "./utils.js?v=2";
import { appendLogEntry } from "./logging.js";
import * as db from "./db.js";

// Two-letter mark shown in place of the old emoji tile: the initials of the
// first two words, or the first two letters of a single-word name.
export function deriveHabitMark(name) {
  const words = String(name || "")
    .replace(/[^A-Za-z\u0400-\u04FF ]/g, "")
    .split(" ")
    .filter(Boolean);
  if (!words.length) return "HB";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function getDefaultMonthData() {
  return {
    dailyCompletions: {},
    dailyNotes: {},
    monthlyReview: { wins: "", blockers: "", focus: "" },
  };
}

export function ensureMonthDataShape(monthData) {
  if (!isPlainObject(monthData.dailyCompletions)) {
    monthData.dailyCompletions = {};
  }
  if (!isPlainObject(monthData.dailyNotes)) {
    monthData.dailyNotes = {};
  }
  if (!isPlainObject(monthData.monthlyReview)) {
    monthData.monthlyReview = {};
  }
  monthData.monthlyReview.wins = String(monthData.monthlyReview.wins || "");
  monthData.monthlyReview.blockers = String(
    monthData.monthlyReview.blockers || "",
  );
  monthData.monthlyReview.focus = String(monthData.monthlyReview.focus || "");
  return monthData;
}

export function getDefaultState() {
  const now = new Date();
  const key = monthKey(now.getFullYear(), now.getMonth());
  return {
    currentYear: now.getFullYear(),
    currentMonth: now.getMonth(),
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    habits: {
      daily: DEFAULT_DAILY_HABITS.map((h, idx) => ({ ...h, order: idx })),
    },
    months: {
      [key]: getDefaultMonthData(),
    },
    meta: {
      schemaVersion: SCHEMA_VERSION,
    },
  };
}

// Coerce one stored report entry into the canonical shape. Blobs live in the
// file store; only lightweight attachment metadata is kept in state.
export function migrateState() {
  if (!isPlainObject(state)) {
    setState(getDefaultState());
    return;
  }

  if (!Array.isArray(state.categories)) {
    state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  }

  if (!isPlainObject(state.habits)) {
    state.habits = { daily: [] };
  }
  if (!Array.isArray(state.habits.daily)) {
    state.habits.daily = [];
  }
  delete state.habits.weekly;

  if (!isPlainObject(state.months)) {
    state.months = {};
  }
  Object.keys(state.months).forEach((key) => {
    if (!isPlainObject(state.months[key])) {
      state.months[key] = getDefaultMonthData();
    }
    delete state.months[key].weeklyCompletions;
    ensureMonthDataShape(state.months[key]);
  });

  state.habits.daily.forEach((habit, idx) => {
    habit.id = String(habit.id || uid("dh"));
    habit.name = String(habit.name || "Habit");
    habit.categoryId = String(habit.categoryId || "");
    habit.monthGoal = Math.max(1, parseInt(habit.monthGoal, 10) || 20);

    if (!Array.isArray(habit.excludedWeekdays)) {
      const legacy = Array.isArray(habit.excludedDays)
        ? habit.excludedDays
        : [];
      habit.excludedWeekdays = legacy
        .map((d) => parseInt(d, 10))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    }
    habit.excludedWeekdays = [...new Set(habit.excludedWeekdays)]
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b);

    let mode = String(habit.scheduleMode || habit.type || "fixed");
    if (mode === "dynamic") {
      const activeWeekdays = ALL_WEEKDAYS.filter(
        (weekday) => !habit.excludedWeekdays.includes(weekday),
      );
      habit.activeWeekdays = activeWeekdays.length
        ? activeWeekdays
        : [...ALL_WEEKDAYS];
      mode = habit.activeWeekdays.length === 7 ? "fixed" : "specific_weekdays";
    }

    if (mode === "custom_sequence") {
      // Preserve the repeating-cycle schedule. This branch MUST run before the
      // coercion below, which would otherwise reset the mode back to "fixed".
      habit.sequenceLength = normalizeSequenceLength(habit.sequenceLength);
      const seqActive = normalizeSequencePositions(
        habit.sequenceActive,
        habit.sequenceLength,
      );
      habit.sequenceActive = seqActive.length ? seqActive : [0];
      const anchor = parseDateKey(habit.sequenceAnchor);
      const today = new Date();
      habit.sequenceAnchor = anchor
        ? formatDateKey(anchor.year, anchor.month, anchor.day)
        : formatDateKey(
            today.getFullYear(),
            today.getMonth(),
            today.getDate(),
          );
      habit.activeWeekdays = [...ALL_WEEKDAYS];
      habit.activeMonthDays = [];
    } else {
      if (mode !== "specific_weekdays" && mode !== "specific_month_days") {
        mode = "fixed";
      }

      habit.activeWeekdays = normalizeWeekdayArray(
        Array.isArray(habit.activeWeekdays)
          ? habit.activeWeekdays
          : mode === "specific_weekdays"
            ? ALL_WEEKDAYS.filter(
                (weekday) => !habit.excludedWeekdays.includes(weekday),
              )
            : ALL_WEEKDAYS,
      );
      if (!habit.activeWeekdays.length) {
        habit.activeWeekdays = [...ALL_WEEKDAYS];
      }

      habit.activeMonthDays = normalizeMonthDayArray(
        Array.isArray(habit.activeMonthDays) ? habit.activeMonthDays : [],
      );
      if (mode === "specific_month_days" && !habit.activeMonthDays.length) {
        habit.activeMonthDays = [1];
      }

      if (mode === "fixed") {
        habit.activeWeekdays = [...ALL_WEEKDAYS];
      }

      delete habit.sequenceLength;
      delete habit.sequenceActive;
      delete habit.sequenceAnchor;
    }

    habit.scheduleMode = mode;
    habit.type = mode;
    delete habit.excludedDays;
    habit.order = Number.isInteger(habit.order) ? habit.order : idx;

    // --- schema 6: tracking type, count target, per-habit reminder ---------
    // Added in place. A habit stored by schema 5 has none of these, so it
    // becomes a checkbox habit with no reminder -- exactly how it behaved
    // before. Nothing here reads or rewrites a completion.
    habit.trackType = habit.trackType === "count" ? "count" : "check";
    const target = parseInt(habit.countTarget, 10);
    habit.countTarget =
      habit.trackType === "count"
        ? Math.min(50, Math.max(2, Number.isFinite(target) ? target : 3))
        : 1;

    if (!isPlainObject(habit.reminder)) habit.reminder = {};
    habit.reminder.enabled = habit.reminder.enabled === true;
    habit.reminder.repeat = REMINDER_REPEATS.includes(habit.reminder.repeat)
      ? habit.reminder.repeat
      : "daily";
    habit.reminder.days = normalizeWeekdayArray(
      Array.isArray(habit.reminder.days) ? habit.reminder.days : [],
    );
    habit.reminder.time = /^\d{2}:\d{2}$/.test(habit.reminder.time)
      ? habit.reminder.time
      : "08:00";

    // The design drops emoji: a habit is identified by a two-letter mark
    // derived from its name. `emoji` is left on the record rather than
    // deleted, so nothing is lost if it is ever wanted back.
    habit.mark = deriveHabitMark(habit.name);
  });
  state.habits.daily.sort((a, b) => a.order - b.order);
  state.habits.daily.forEach((h, idx) => {
    h.order = idx;
  });


  if (!isPlainObject(state.meta)) {
    state.meta = {};
  }
  state.meta.schemaVersion = SCHEMA_VERSION;

  if (!Number.isInteger(state.currentYear)) {
    state.currentYear = new Date().getFullYear();
  }
  if (
    !Number.isInteger(state.currentMonth) ||
    state.currentMonth < 0 ||
    state.currentMonth > 11
  ) {
    state.currentMonth = new Date().getMonth();
  }
}

export function ensureMonthData() {
  const key = monthKey(state.currentYear, state.currentMonth);
  if (!state.months[key]) {
    state.months[key] = getDefaultMonthData();
  }
  ensureMonthDataShape(state.months[key]);
}

export function getCurrentMonthData() {
  ensureMonthData();
  return state.months[monthKey(state.currentYear, state.currentMonth)];
}

export async function loadState() {
  try {
    const remote = await db.getState();
    if (remote && Object.keys(remote).length > 0) {
      setState(remote);
      migrateState();
      const now = new Date();
      state.currentYear = now.getFullYear();
      state.currentMonth = now.getMonth();
      ensureMonthData();
      saveState();
      return;
    }
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "state",
      operation: "loadState",
      message: "Failed to load state, using defaults.",
      error,
    });
  }

  // First launch. The defaults go through migrateState() too, so the seeded
  // habits pick up the same normalised shape (trackType, reminder, mark) as a
  // restored one -- without this they render with every field missing.
  setState(getDefaultState());
  migrateState();
  ensureMonthData();
  saveState();
}

export function saveState() {
  db.putState(state).catch((error) => {
    appendLogEntry({
      level: "error",
      component: "state",
      operation: "saveState",
      message: "Failed to persist state to backend.",
      error,
    });
  });
}

export function getCategoryById(categoryId) {
  return state.categories.find((c) => c.id === categoryId) || null;
}

export function getHabitEmoji(habit) {
  if (habit.emoji) return habit.emoji;
  const cat = getCategoryById(habit.categoryId);
  return cat ? cat.emoji : "\uD83D\uDCCC";
}
