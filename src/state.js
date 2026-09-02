"use strict";

export let state = null;
export function setState(s) {
  state = s;
  bumpStateRevision();
}

// Monotonic counter bumped on every write to `state`. It is the cache key for
// the memoised streak/score maths in habits.js -- those walk the full calendar
// range now, so they must not re-run once per habit per render.
//
// It lives here rather than in habits.js because persistence.saveState() is
// what bumps it, and habits.js already imports persistence.js: putting the
// counter in either of those makes the import cycle load-order-sensitive.
let stateRevision = 0;

export function getStateRevision() {
  return stateRevision;
}

export function bumpStateRevision() {
  stateRevision += 1;
}

export const globals = {
  confirmCallback: null,
  // Day selected on the Today screen, 1..31. null means "resolve to today if
  // we are viewing the current month, else day 1" -- see getSelectedDay() in
  // render-today.js. Deliberately not persisted: the month the app opens on is
  // always the current one, so the default is always right.
  dayFocusDay: null,
  // Habit shown on the detail screen; cleared when that screen is left.
  detailHabitId: null,
  // Staged edits in the add/edit sheet; null while the sheet is closed.
  habitDraft: null,
  // Year drawn by the Analytics heatmap. Independent of the viewed month so
  // scrolling the year does not move the rest of the app.
  analyticsYear: null,
};

export let appLogs = [];
export function setAppLogs(logs) {
  appLogs = logs;
}
