"use strict";

import {
  SCHEMA_VERSION,
  ALL_WEEKDAYS,
  DEFAULT_CATEGORIES,
  DEFAULT_DAILY_HABITS,
} from "./constants.js";
import { state, setState } from "./state.js";
import {
  uid,
  monthKey,
  nowIso,
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
    reports: [],
    meta: {
      schemaVersion: SCHEMA_VERSION,
    },
  };
}

// Coerce one stored report entry into the canonical shape. Blobs live in the
// file store; only lightweight attachment metadata is kept in state.
function normalizeReport(input) {
  const report = isPlainObject(input) ? input : {};
  const attachments = Array.isArray(report.attachments)
    ? report.attachments
        .filter(isPlainObject)
        .map((att) => ({
          fileId: String(att.fileId || ""),
          fileName: String(att.fileName || "file"),
          fileSize: Math.max(0, parseInt(att.fileSize, 10) || 0),
          mimeType: String(att.mimeType || ""),
        }))
        .filter((att) => att.fileId)
    : [];
  const createdAt = report.createdAt ? String(report.createdAt) : nowIso();
  return {
    id: String(report.id || uid("report")),
    title: String(report.title || ""),
    note: String(report.note || ""),
    habitId: String(report.habitId || ""),
    createdAt,
    updatedAt: report.updatedAt ? String(report.updatedAt) : createdAt,
    attachments,
  };
}

export function ensureReportsShape(input) {
  if (!Array.isArray(input.reports)) {
    input.reports = [];
    return;
  }
  input.reports = input.reports.map((report) => normalizeReport(report));
}

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
    habit.emoji = String(habit.emoji || "\uD83D\uDCCC");
    habit.order = Number.isInteger(habit.order) ? habit.order : idx;
  });
  state.habits.daily.sort((a, b) => a.order - b.order);
  state.habits.daily.forEach((h, idx) => {
    h.order = idx;
  });

  ensureReportsShape(state);

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

  setState(getDefaultState());
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
