"use strict";

// The habit detail screen: streak stats, a month calendar, and the tracking
// and reminder controls for one habit.
//
// Everything on this screen writes straight through to the habit record and
// re-renders; there is no draft state. The add/edit sheet is the place where
// edits are staged, and it is reached from the "Edit habit" button here.

import { MONTH_NAMES, REMINDER_REPEATS, WEEKDAY_LABELS } from "./constants.js";
import { state, globals } from "./state.js";
import { sanitize, daysInMonth } from "./utils.js?v=2";
import {
  getCurrentMonthData,
  getCategoryById,
  saveState,
} from "./persistence.js";
import {
  computeHabitStreak,
  countHabitMonthDone,
  getDayValue,
  getHabitTarget,
  isHabitTrackedOnDate,
  isHabitDoneOn,
} from "./habits.js";
import { registerRenderer, callRenderer } from "./render-registry.js";
import { getWeekStart } from "./ui-prefs.js";
import { openHabitSheet } from "./modals.js";

export function getDetailHabit() {
  if (!globals.detailHabitId) return null;
  return state.habits.daily.find((h) => h.id === globals.detailHabitId) || null;
}

function patch(habit, changes) {
  Object.assign(habit, changes);
  saveState();
  renderDetail();
  // The row's meta line and control shape can both change from here.
  callRenderer("renderToday");
}

function patchReminder(habit, changes) {
  habit.reminder = Object.assign({}, habit.reminder, changes);
  saveState();
  renderDetail();
  callRenderer("renderToday");
}

/* ----------------------------------------------------------------- markup */

const BACK_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 5l-7 7 7 7"></path></svg>';

// Monday- or Sunday-first depending on the "Week starts on" preference.
function weekdayOrder() {
  return getWeekStart() === "sunday"
    ? [0, 1, 2, 3, 4, 5, 6]
    : [1, 2, 3, 4, 5, 6, 0];
}

function calendarHtml(habit) {
  const year = state.currentYear;
  const month = state.currentMonth;
  const total = daysInMonth(year, month);
  const monthData = getCurrentMonthData();
  const order = weekdayOrder();

  const firstDow = new Date(year, month, 1).getDay();
  const leading = order.indexOf(firstDow);

  const now = new Date();
  const todayDay =
    now.getFullYear() === year && now.getMonth() === month
      ? now.getDate()
      : -1;

  let cells = "";
  for (let i = 0; i < leading; i += 1) {
    cells += '<span class="cal-cell is-blank"></span>';
  }
  for (let day = 1; day <= total; day += 1) {
    const tracked = isHabitTrackedOnDate(habit, year, month, day);
    const value = getDayValue(monthData, habit.id, day);
    const complete = isHabitDoneOn(habit, monthData, day);
    const future = todayDay !== -1 && day > todayDay;

    const classes = ["cal-cell"];
    if (!tracked || future) classes.push("is-future");
    else if (complete) classes.push("is-complete");
    else if (value > 0) classes.push("is-partial");
    if (day === todayDay) classes.push("is-today");
    if (tracked && !future) classes.push("is-clickable");

    cells +=
      `<button type="button" class="${classes.join(" ")}"` +
      (tracked && !future ? ` data-cal-day="${day}"` : " disabled") +
      ` aria-label="${day} ${sanitize(MONTH_NAMES[month])}">${day}</button>`;
  }

  const doneThisMonth = countHabitMonthDone(habit, year, month);
  const heads = order
    .map((d) => `<span>${sanitize(WEEKDAY_LABELS[d][0])}</span>`)
    .join("");

  return (
    '<div class="detail-card">' +
    '<div class="cal-head">' +
    `<div class="cal-month">${sanitize(MONTH_NAMES[month])} ${year}</div>` +
    `<div class="cal-sub">${doneThisMonth} of ${total} days</div>` +
    "</div>" +
    `<div class="cal-dow" aria-hidden="true">${heads}</div>` +
    `<div class="cal-grid">${cells}</div>` +
    "</div>"
  );
}

function trackingHtml(habit) {
  const isCount = habit.trackType === "count";
  const target = getHabitTarget(habit);

  let html =
    '<div class="detail-card">' +
    '<div class="section-label" style="margin-bottom:10px">Tracking</div>' +
    '<div class="segmented">' +
    `<button type="button" data-track="check" class="${isCount ? "" : "is-active"}">Checkbox</button>` +
    `<button type="button" data-track="count" class="${isCount ? "is-active" : ""}">Count</button>` +
    "</div>";

  if (isCount) {
    html +=
      '<div class="stepper-row">' +
      '<div class="stepper-label">Target per day</div>' +
      '<div class="stepper">' +
      '<button type="button" data-target-step="-1" aria-label="Decrease target">−</button>' +
      `<div class="stepper-value">${target}</div>` +
      '<button type="button" data-target-step="1" aria-label="Increase target">+</button>' +
      "</div></div>";
  }

  html += reminderHtml(habit) + "</div>";
  return html;
}

function reminderSummary(habit) {
  const r = habit.reminder || {};
  if (!r.enabled) return "Off";
  if (r.repeat === "daily") return `Every day · ${r.time}`;
  if (r.repeat === "weekdays") return `Weekdays · ${r.time}`;
  const days = (r.days || [])
    .slice()
    .sort((a, b) => a - b)
    .map((i) => WEEKDAY_LABELS[i])
    .join(" ");
  return `${days || "No days"} · ${r.time}`;
}

function reminderHtml(habit) {
  const r = habit.reminder || {};
  let html =
    '<div class="hr"></div>' +
    '<div class="row-split">' +
    "<div>" +
    '<div class="row-title">Reminder</div>' +
    `<div class="row-sub">${sanitize(reminderSummary(habit))}</div>` +
    "</div>" +
    `<button type="button" class="toggle${r.enabled ? " is-on" : ""}" data-reminder-toggle` +
    ` role="switch" aria-checked="${!!r.enabled}" aria-label="Reminder"><span></span></button>` +
    "</div>";

  if (!r.enabled) return html;

  html +=
    '<div class="segmented" style="margin-top:12px">' +
    REMINDER_REPEATS.map((key) => {
      const label =
        key === "daily" ? "Every day" : key === "weekdays" ? "Weekdays" : "Custom";
      return `<button type="button" data-repeat="${key}" class="${r.repeat === key ? "is-active" : ""}">${label}</button>`;
    }).join("") +
    "</div>";

  if (r.repeat === "custom") {
    html +=
      '<div class="day-toggles">' +
      weekdayOrder()
        .map((d) => {
          const on = (r.days || []).includes(d);
          return `<button type="button" data-reminder-day="${d}" class="${on ? "is-on" : ""}" aria-pressed="${on}">${sanitize(WEEKDAY_LABELS[d][0])}</button>`;
        })
        .join("") +
      "</div>";
  }

  html +=
    '<div class="stepper-row">' +
    '<div class="stepper-label">Time</div>' +
    `<input type="time" id="detailReminderTime" value="${sanitize(r.time)}" aria-label="Reminder time" />` +
    "</div>";

  return html;
}

/* ------------------------------------------------------------------ render */

export function renderDetail() {
  const body = document.getElementById("detailBody");
  if (!body) return;

  const habit = getDetailHabit();
  if (!habit) {
    body.innerHTML =
      '<button type="button" class="back-link" data-detail-back>' +
      `${BACK_SVG}Today</button>` +
      "<div class='empty-state'><p>That habit no longer exists.</p></div>";
    return;
  }

  const streak = computeHabitStreak(habit.id);
  const cat = getCategoryById(habit.categoryId);
  const monthDone = countHabitMonthDone(
    habit,
    state.currentYear,
    state.currentMonth,
  );
  const goal = Math.max(1, parseInt(habit.monthGoal, 10) || 20);

  body.innerHTML =
    '<button type="button" class="back-link" data-detail-back>' +
    `${BACK_SVG}Today</button>` +
    `<div class="eyebrow">${sanitize(cat ? cat.name : "No category")}</div>` +
    `<div class="detail-name">${sanitize(habit.name)}</div>` +
    '<div class="stat-grid">' +
    '<div class="stat-tile">' +
    `<div class="stat-value is-accent">${streak.current}d</div>` +
    '<div class="stat-caption">Current streak</div></div>' +
    '<div class="stat-tile">' +
    `<div class="stat-value">${streak.best}d</div>` +
    '<div class="stat-caption">Best streak</div></div>' +
    '<div class="stat-tile">' +
    `<div class="stat-value">${monthDone}/${goal}</div>` +
    '<div class="stat-caption">Of month goal</div></div>' +
    "</div>" +
    calendarHtml(habit) +
    trackingHtml(habit) +
    '<div class="detail-actions">' +
    '<button type="button" class="btn btn-ghost" data-detail-edit>Edit habit</button>' +
    '<button type="button" class="btn btn-primary" data-detail-back>Done</button>' +
    "</div>";
}

/* ---------------------------------------------------------------- handlers */

export function bindDetailEvents() {
  const section = document.getElementById("view-detail");
  if (!section) return;

  section.addEventListener("click", (event) => {
    const habit = getDetailHabit();

    if (event.target.closest("[data-detail-back]")) {
      window.location.hash = "#/today";
      return;
    }
    if (event.target.closest("[data-detail-edit]")) {
      if (habit) openHabitSheet(habit.id);
      return;
    }
    if (!habit) return;

    const track = event.target.closest("[data-track]");
    if (track) {
      const next = track.dataset.track;
      patch(habit, {
        trackType: next,
        countTarget: next === "count" ? getHabitTarget(habit) || 3 : 1,
      });
      return;
    }

    const step = event.target.closest("[data-target-step]");
    if (step) {
      const delta = parseInt(step.dataset.targetStep, 10);
      patch(habit, {
        countTarget: Math.min(
          50,
          Math.max(2, getHabitTarget(habit) + delta),
        ),
      });
      return;
    }

    if (event.target.closest("[data-reminder-toggle]")) {
      patchReminder(habit, { enabled: !(habit.reminder || {}).enabled });
      return;
    }

    const repeat = event.target.closest("[data-repeat]");
    if (repeat) {
      patchReminder(habit, { repeat: repeat.dataset.repeat });
      return;
    }

    const rDay = event.target.closest("[data-reminder-day]");
    if (rDay) {
      const day = parseInt(rDay.dataset.reminderDay, 10);
      const days = (habit.reminder.days || []).slice();
      const at = days.indexOf(day);
      if (at >= 0) days.splice(at, 1);
      else days.push(day);
      patchReminder(habit, { days: days.sort((a, b) => a - b) });
      return;
    }

    const cell = event.target.closest("[data-cal-day]");
    if (cell) {
      globals.dayFocusDay = parseInt(cell.dataset.calDay, 10);
      window.location.hash = "#/today";
    }
  });

  section.addEventListener("change", (event) => {
    if (event.target.id !== "detailReminderTime") return;
    const habit = getDetailHabit();
    if (habit) patchReminder(habit, { time: event.target.value });
  });
}

registerRenderer("renderDetail", renderDetail);
