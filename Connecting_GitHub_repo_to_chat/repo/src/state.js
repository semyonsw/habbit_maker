"use strict";

export let state = null;
export function setState(s) {
  state = s;
}

export const globals = {
  // Current view: today | analytics | settings | detail
  view: "today",
  detailHabitId: null,
  // Habit being edited in the sheet; null while adding a new one.
  editingHabitId: null,
  prefs: {},
};

export let appLogs = [];
export function setAppLogs(logs) {
  appLogs = logs;
}
