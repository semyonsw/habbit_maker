"use strict";

// Prev / month / next, used by both Today and Analytics.
//
// The app has always stored completions per month, migrated every month, and
// exported every month -- and had no way to look at any month but the current
// one. `state.currentMonth` was written by loadState() and never changed again,
// so every month of history you built up was unreachable from inside the app.
// This is the two chevrons that were missing.

import { MONTH_NAMES } from "./constants.js";
import { state } from "./state.js";
import { sanitize } from "./utils.js";
import {
  goToCurrentMonth,
  isViewingCurrentMonth,
  shiftViewedMonth,
  todayParts,
} from "./habits.js";

const CHEVRON_LEFT =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 5l-7 7 7 7"></path></svg>';
const CHEVRON_RIGHT =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9 5l7 7-7 7"></path></svg>';

// There is nothing to see past the current month -- a future month has no
// completions and cannot get any -- so forward stops there rather than letting
// you scroll into empty calendars forever.
export function canGoForward() {
  const t = todayParts();
  if (state.currentYear < t.year) return true;
  return state.currentYear === t.year && state.currentMonth < t.month;
}

export function monthNavHtml() {
  const label = `${MONTH_NAMES[state.currentMonth]} ${state.currentYear}`;
  const forward = canGoForward();
  const current = isViewingCurrentMonth();

  return (
    '<div class="month-nav">' +
    '<button type="button" class="month-nav-step" data-month-step="-1"' +
    ' aria-label="Previous month">' +
    CHEVRON_LEFT +
    "</button>" +
    '<button type="button" class="month-nav-label" data-month-today' +
    (current ? " disabled" : "") +
    ` aria-label="${sanitize(label)}${current ? "" : ", jump to this month"}">` +
    `<span>${sanitize(label)}</span>` +
    (current ? "" : '<span class="month-nav-back">Today</span>') +
    "</button>" +
    '<button type="button" class="month-nav-step" data-month-step="1"' +
    (forward ? "" : " disabled") +
    ' aria-label="Next month">' +
    CHEVRON_RIGHT +
    "</button>" +
    "</div>"
  );
}

// Returns true if the event was a month-nav interaction, so the caller can stop
// processing it.
export function handleMonthNavClick(event) {
  const step = event.target.closest("[data-month-step]");
  if (step && !step.disabled) {
    shiftViewedMonth(parseInt(step.dataset.monthStep, 10));
    return true;
  }
  const jump = event.target.closest("[data-month-today]");
  if (jump && !jump.disabled) {
    goToCurrentMonth();
    return true;
  }
  return false;
}
