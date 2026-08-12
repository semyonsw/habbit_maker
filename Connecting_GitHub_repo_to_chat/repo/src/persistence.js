"use strict";

import {
  SCHEMA_VERSION,
  ALL_WEEKDAYS,
  DEFAULT_CATEGORIES,
  DEFAULT_DAILY_HABITS,
  DEFAULT_REMINDER,
} from "./constants.js";
import { state, setState } from "./state.js";
import {
  uid, monthKey, isPlainObject,
  normalizeWeekdayArray, normalizeMonthDayArray,
} from "./utils.js";
import { appendLogEntry } from "./logging.js";
import * as db from "./db.js";

export function getDefaultMonthData() {
  return { dailyCompletions: {}, dailyNotes: {} };
}

export function getDefaultState() {
  const now = new Date();
  return {
    currentYear: now.getFullYear(),
    currentMonth: now.getMonth(),
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    habits: { daily: DEFAULT_DAILY_HABITS.map((h, i) => ({ ...h, order: i })) },
    months: { [monthKey(now.getFullYear(), now.getMonth())]: getDefaultMonthData() },
    meta: { schemaVersion: SCHEMA_VERSION },
  };
}

function normalizeReminder(input) {
  const r = isPlainObject(input) ? input : {};
  const repeat = ["daily", "weekdays", "custom"].includes(String(r.repeat)) ? String(r.repeat) : "daily";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time || "")) ? String(r.time) : DEFAULT_REMINDER.time;
  let days = normalizeWeekdayArray(r.days);
  if (repeat === "custom" && !days.length) days = [1, 2, 3, 4, 5];
  return { enabled: r.enabled === true, time, repeat, days };
}

// Completions used to be booleans (done / not done). Count habits need a
// number, so every stored value becomes one: true -> 1, false/absent -> 0.
function normalizeCompletions(map) {
  const out = {};
  if (!isPlainObject(map)) return out;
  Object.keys(map).forEach((habitId) => {
    const byDay = map[habitId];
    if (!isPlainObject(byDay)) return;
    const days = {};
    Object.keys(byDay).forEach((day) => {
      const raw = byDay[day];
      const n = raw === true ? 1 : raw === false ? 0 : Math.max(0, parseInt(raw, 10) || 0);
      if (n > 0) days[String(parseInt(day, 10))] = n;
    });
    if (Object.keys(days).length) out[habitId] = days;
  });
  return out;
}

export function migrateState() {
  if (!isPlainObject(state)) {
    setState(getDefaultState());
    return;
  }

  if (!Array.isArray(state.categories) || !state.categories.length) {
    state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  }
  state.categories = state.categories
    .filter(isPlainObject)
    .map((c) => ({
      id: String(c.id || uid("cat")),
      name: String(c.name || "Category"),
      color: String(c.color || "#4F6BD8"),
    }));

  if (!isPlainObject(state.habits)) state.habits = { daily: [] };
  if (!Array.isArray(state.habits.daily)) state.habits.daily = [];
  delete state.habits.weekly;

  state.habits.daily = state.habits.daily.filter(isPlainObject).map((habit, idx) => {
    const h = habit;
    h.id = String(h.id || uid("dh"));
    h.name = String(h.name || "Habit");
    h.categoryId = String(h.categoryId || "");
    h.monthGoal = Math.max(1, parseInt(h.monthGoal, 10) || 20);

    // Tracking type: check (one tap) or count (n per day).
    const target = Math.max(1, parseInt(h.countTarget, 10) || 1);
    h.trackType = h.trackType === "count" && target > 1 ? "count" : "check";
    h.countTarget = target;

    let mode = String(h.scheduleMode || h.type || "fixed");
    // custom_sequence (the old repeating-cycle mode) collapses to weekday rules.
    if (!["fixed", "specific_weekdays", "specific_month_days"].includes(mode)) mode = "fixed";
    h.scheduleMode = mode;
    delete h.type;
    delete h.sequenceLength;
    delete h.sequenceActive;
    delete h.sequenceAnchor;
    delete h.excludedWeekdays;
    delete h.excludedDays;
    delete h.emoji;

    h.activeWeekdays = normalizeWeekdayArray(
      Array.isArray(h.activeWeekdays) ? h.activeWeekdays : ALL_WEEKDAYS,
    );
    if (!h.activeWeekdays.length) h.activeWeekdays = [...ALL_WEEKDAYS];
    if (mode === "fixed") h.activeWeekdays = [...ALL_WEEKDAYS];

    h.activeMonthDays = normalizeMonthDayArray(h.activeMonthDays);
    if (mode === "specific_month_days" && !h.activeMonthDays.length) h.activeMonthDays = [1];

    h.reminder = normalizeReminder(h.reminder);
    h.order = Number.isInteger(h.order) ? h.order : idx;
    return h;
  });
  state.habits.daily.sort((a, b) => a.order - b.order).forEach((h, i) => { h.order = i; });

  if (!isPlainObject(state.months)) state.months = {};
  Object.keys(state.months).forEach((key) => {
    const md = isPlainObject(state.months[key]) ? state.months[key] : {};
    state.months[key] = {
      dailyCompletions: normalizeCompletions(md.dailyCompletions),
      dailyNotes: isPlainObject(md.dailyNotes) ? md.dailyNotes : {},
    };
  });

  // Removed features — drop their state so exports stay small.
  delete state.books;
  delete state.reports;
  delete state.pdfBlobs;

  if (!isPlainObject(state.meta)) state.meta = {};
  state.meta.schemaVersion = SCHEMA_VERSION;

  const now = new Date();
  if (!Number.isInteger(state.currentYear)) state.currentYear = now.getFullYear();
  if (!Number.isInteger(state.currentMonth) || state.currentMonth < 0 || state.currentMonth > 11) {
    state.currentMonth = now.getMonth();
  }
}

export function ensureMonthData(year, month) {
  const y = Number.isInteger(year) ? year : state.currentYear;
  const m = Number.isInteger(month) ? month : state.currentMonth;
  const key = monthKey(y, m);
  if (!isPlainObject(state.months[key])) state.months[key] = getDefaultMonthData();
  return state.months[key];
}

export function getCurrentMonthData() {
  return ensureMonthData(state.currentYear, state.currentMonth);
}

export function getCategoryById(categoryId) {
  return state.categories.find((c) => c.id === categoryId) || null;
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
      level: "error", component: "state", operation: "loadState",
      message: "Failed to load state, using defaults.", error,
    });
  }
  setState(getDefaultState());
  saveState();
}

export function saveState() {
  db.putState(state).catch((error) => {
    appendLogEntry({
      level: "error", component: "state", operation: "saveState",
      message: "Failed to persist state.", error,
    });
  });
}
