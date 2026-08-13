"use strict";

export let state = null;
export function setState(s) {
  state = s;
}

export let chartInstances = {};
export function setChartInstances(c) {
  chartInstances = c;
}

export const globals = {
  sidebarCollapsed: false,
  confirmCallback: null,
  editingHabitId: null,
  editingCategoryId: null,
  topClockTimer: null,
  lastAutoScrolledMonthKey: null,
  // Day selected in the mobile day-focus card, 1..31. null means "resolve to
  // today if we are viewing the current month, else day 1" -- see
  // render-day-focus.js getSelectedDay(). Deliberately not persisted: loadState()
  // already forces the current month on every boot, so the default is correct.
  dayFocusDay: null,
};

export const noteModalState = { habitId: null, day: null };
export let idbPromise = null;
export function setIdbPromise(p) {
  idbPromise = p;
}

export const linkedHoverState = {
  day: null,
  week: null,
  scope: null,
  source: null,
};

export let appLogs = [];
export function setAppLogs(logs) {
  appLogs = logs;
}


export const analyticsState = {
  displayMode: "percent",
};


