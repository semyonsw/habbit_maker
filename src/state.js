"use strict";

export let state = null;
export function setState(s) {
  state = s;
}

export const globals = {
  confirmCallback: null,
  // Day selected on the Today screen, 1..31. null means "resolve to today if
  // we are viewing the current month, else day 1" -- see getSelectedDay() in
  // render-today.js. Deliberately not persisted: loadState() forces the
  // current month on every boot, so the default is always right.
  dayFocusDay: null,
  // Habit shown on the detail screen; cleared when that screen is left.
  detailHabitId: null,
  // Staged edits in the add/edit sheet; null while the sheet is closed.
  habitDraft: null,
};

export let appLogs = [];
export function setAppLogs(logs) {
  appLogs = logs;
}
