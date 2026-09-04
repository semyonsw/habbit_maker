"use strict";

// The habit detail screen: strength and streak stats, a month calendar you can
// fill in directly, a note for the selected day, and the tracking and reminder
// controls for one habit.
//
// Everything on this screen writes straight through to the habit record and
// re-renders; there is no draft state. The add/edit sheet is the place where
// edits are staged, and it is reached from the "Edit habit" button here.

import {
  MONTH_NAMES,
  REMINDER_REPEATS,
  SKIPPED,
  WEEKDAY_LABELS,
} from "./constants.js";
import { state, globals } from "./state.js";
import { sanitize, daysInMonth, formatTimeString } from "./utils.js";
import {
  getCurrentMonthData,
  getViewedMonthData,
  getCategoryById,
  saveState,
} from "./persistence.js";
import {
  computeHabitScore,
  computeHabitStreak,
  countHabitMonthDone,
  getDayValue,
  getHabitTarget,
  getHabitUsualTime,
  getHabitWeekdayStats,
  isFutureDate,
  isHabitTrackedOnDate,
  isHabitDoneOn,
  isHabitSkippedOn,
  isSkippedValue,
  setHabitDayValue,
} from "./habits.js";
import { monthNavHtml, handleMonthNavClick } from "./month-nav.js";
import { registerRenderer, callRenderer } from "./render-registry.js";
import { navigateTo } from "./router.js";
import { getWeekStart } from "./ui-prefs.js";
import { describeEffectiveReminder } from "./notifications.js";
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
  // A reminder edit that is not re-scheduled is exactly the bug this app had:
  // settings that persist and never fire.
  callRenderer("rescheduleReminders");
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

/* ---------------------------------------------------------------- calendar */

function calendarHtml(habit) {
  const year = state.currentYear;
  const month = state.currentMonth;
  const total = daysInMonth(year, month);
  const monthData = getViewedMonthData();
  const order = weekdayOrder();

  const firstDow = new Date(year, month, 1).getDay();
  const leading = order.indexOf(firstDow);

  const now = new Date();
  const todayDay =
    now.getFullYear() === year && now.getMonth() === month ? now.getDate() : -1;

  let cells = "";
  for (let i = 0; i < leading; i += 1) {
    cells += '<span class="cal-cell is-blank"></span>';
  }
  for (let day = 1; day <= total; day += 1) {
    const tracked = isHabitTrackedOnDate(habit, year, month, day);
    const value = getDayValue(monthData, habit.id, day);
    const complete = isHabitDoneOn(habit, monthData, day);
    const skipped = isHabitSkippedOn(habit, monthData, day);
    const future = isFutureDate(year, month, day);

    const classes = ["cal-cell"];
    if (!tracked || future) classes.push("is-future");
    else if (skipped) classes.push("is-skipped");
    else if (complete) classes.push("is-complete");
    else if (value > 0) classes.push("is-partial");
    if (day === todayDay) classes.push("is-today");
    if (tracked && !future) classes.push("is-clickable");

    const stateWord = skipped
      ? "skipped"
      : complete
        ? "done"
        : value > 0
          ? "partly done"
          : "not done";

    cells +=
      `<button type="button" class="${classes.join(" ")}"` +
      (tracked && !future ? ` data-cal-day="${day}"` : " disabled") +
      ` aria-label="${day} ${sanitize(MONTH_NAMES[month])}, ${stateWord}">${day}</button>`;
  }

  const doneThisMonth = countHabitMonthDone(habit, year, month);
  const heads = order
    .map((d) => `<span>${sanitize(WEEKDAY_LABELS[d][0])}</span>`)
    .join("");

  return (
    '<div class="detail-card">' +
    monthNavHtml() +
    '<div class="cal-head">' +
    `<div class="cal-sub">${doneThisMonth} of ${total} days</div>` +
    '<div class="cal-legend">' +
    '<span><i class="dot is-complete"></i>done</span>' +
    '<span><i class="dot is-skipped"></i>skipped</span>' +
    "</div>" +
    "</div>" +
    `<div class="cal-dow" aria-hidden="true">${heads}</div>` +
    `<div class="cal-grid">${cells}</div>` +
    '<div class="cal-hint">Tap a day to cycle: done → skipped → clear</div>' +
    "</div>"
  );
}

// Tapping a cell used to jump back to Today with that day selected, which meant
// the habit's own calendar was the one place you could not actually fill the
// habit in. It now cycles the day in place -- and the third state is skip, so
// the forgiving option is reachable without knowing about hold-to-skip.
function cycleCalendarDay(habit, day) {
  const monthData = getViewedMonthData();
  const value = getDayValue(monthData, habit.id, day);
  const target = getHabitTarget(habit);

  let next;
  if (isSkippedValue(value)) next = 0;
  else if (value >= target) next = SKIPPED;
  else next = target;

  setHabitDayValue(habit.id, day, next);
}

/* ------------------------------------------------------------------- notes */

function noteFor(habit, day) {
  const monthData = getViewedMonthData();
  const row =
    monthData && monthData.dailyNotes ? monthData.dailyNotes[habit.id] : null;
  return row && row[day] ? String(row[day]) : "";
}

function setNote(habit, day, text) {
  const monthData = getCurrentMonthData();
  if (!monthData.dailyNotes) monthData.dailyNotes = {};
  if (!monthData.dailyNotes[habit.id]) monthData.dailyNotes[habit.id] = {};
  const trimmed = String(text || "").slice(0, 500);
  if (trimmed) monthData.dailyNotes[habit.id][day] = trimmed;
  else delete monthData.dailyNotes[habit.id][day];
  saveState();
}

// `dailyNotes` has been in the schema, migrated on every load and carried
// through every export since long before this -- with nothing anywhere in the
// app that could read or write one. This is that screen.
//
// The prompt changes with the day's outcome: after a miss, "what got in the
// way?" is the question that turns tracking into something you learn from.
function notesHtml(habit) {
  const day = selectedDetailDay();
  const monthData = getViewedMonthData();
  const done = isHabitDoneOn(habit, monthData, day);
  const skipped = isHabitSkippedOn(habit, monthData, day);
  const future = isFutureDate(state.currentYear, state.currentMonth, day);
  if (future) return "";

  const placeholder = done
    ? "What made it easy today?"
    : skipped
      ? "Why did you skip?"
      : "What got in the way?";

  return (
    '<div class="detail-card">' +
    '<div class="row-split">' +
    '<div class="section-label">Note</div>' +
    `<div class="row-sub">${day} ${sanitize(MONTH_NAMES[state.currentMonth])}</div>` +
    "</div>" +
    `<textarea id="detailNote" class="text-input note-input" rows="2"` +
    ` placeholder="${sanitize(placeholder)}"` +
    ` aria-label="Note for ${day} ${sanitize(MONTH_NAMES[state.currentMonth])}"` +
    `>${sanitize(noteFor(habit, day))}</textarea>` +
    "</div>"
  );
}

function selectedDetailDay() {
  const total = daysInMonth(state.currentYear, state.currentMonth);
  if (globals.dayFocusDay == null) {
    const now = new Date();
    const viewingCurrent =
      now.getFullYear() === state.currentYear &&
      now.getMonth() === state.currentMonth;
    return viewingCurrent ? now.getDate() : 1;
  }
  return Math.min(total, Math.max(1, globals.dayFocusDay));
}

/* ---------------------------------------------------------------- insights */

// Two facts the app already had the data for and never told you: which weekday
// this habit actually fails on, and what time you usually do it.
function insightsHtml(habit) {
  const weekday = getHabitWeekdayStats(habit.id);
  const rated = weekday.filter((w) => w.pct !== null && w.total >= 2);
  const usual = getHabitUsualTime(habit.id);

  if (rated.length < 3 && !usual) return "";

  let html =
    '<div class="detail-card">' +
    '<div class="section-label" style="margin-bottom:10px">Patterns</div>';

  if (usual) {
    html +=
      '<div class="insight-line">' +
      "Usually done around " +
      `<strong>${sanitize(formatTimeString(usual.hour, usual.minute))}</strong>` +
      ` <span class="row-sub">(${usual.samples} logged)</span>` +
      "</div>";
  }

  if (rated.length >= 3) {
    const best = rated.reduce((a, b) => (b.pct > a.pct ? b : a));
    const worst = rated.reduce((a, b) => (b.pct < a.pct ? b : a));
    if (best.pct !== worst.pct) {
      const bestDay = WEEKDAY_LABELS[weekday.indexOf(best)];
      const worstDay = WEEKDAY_LABELS[weekday.indexOf(worst)];
      html +=
        '<div class="insight-line">' +
        `Strongest on <strong>${sanitize(bestDay)}</strong> (${best.pct}%), ` +
        `weakest on <strong>${sanitize(worstDay)}</strong> (${worst.pct}%)` +
        "</div>";
    }

    html +=
      '<div class="weekday-bars">' +
      weekdayOrder()
        .map((d) => {
          const stat = weekday[d];
          const pct = stat.pct === null ? 0 : stat.pct;
          return (
            '<div class="weekday-col">' +
            `<div class="weekday-track"><div class="weekday-fill" style="height:${Math.max(3, pct)}%"></div></div>` +
            `<div class="weekday-label">${sanitize(WEEKDAY_LABELS[d][0])}</div>` +
            "</div>"
          );
        })
        .join("") +
      "</div>";
  }

  return `${html}</div>`;
}

/* --------------------------------------------------------------- tracking */

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

function reminderHtml(habit) {
  const r = habit.reminder || {};
  let html =
    '<div class="hr"></div>' +
    '<div class="row-split">' +
    "<div>" +
    '<div class="row-title">Reminder</div>' +
    `<div class="row-sub">${sanitize(describeEffectiveReminder(habit))}</div>` +
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
  const score = computeHabitScore(habit.id);
  const cat = getCategoryById(habit.categoryId);
  const monthDone = countHabitMonthDone(
    habit,
    state.currentYear,
    state.currentMonth,
  );
  const goal = Math.max(1, parseInt(habit.monthGoal, 10) || 20);

  const cue = habit.cue
    ? `<div class="detail-cue">${sanitize(habit.cue)}</div>`
    : "";

  body.innerHTML =
    '<button type="button" class="back-link" data-detail-back>' +
    `${BACK_SVG}Today</button>` +
    `<div class="eyebrow">${sanitize(cat ? cat.name : "No category")}</div>` +
    `<div class="detail-name">${sanitize(habit.name)}</div>` +
    cue +
    '<div class="stat-grid is-four">' +
    '<div class="stat-tile">' +
    `<div class="stat-value is-accent">${Math.round(score * 100)}%</div>` +
    '<div class="stat-caption">Strength</div></div>' +
    '<div class="stat-tile">' +
    `<div class="stat-value">${streak.current}d</div>` +
    '<div class="stat-caption">Current streak</div></div>' +
    '<div class="stat-tile">' +
    `<div class="stat-value">${streak.best}d</div>` +
    '<div class="stat-caption">Best streak</div></div>' +
    '<div class="stat-tile">' +
    `<div class="stat-value">${monthDone}/${goal}</div>` +
    '<div class="stat-caption">Of month goal</div></div>' +
    "</div>" +
    calendarHtml(habit) +
    notesHtml(habit) +
    insightsHtml(habit) +
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
      navigateTo("today");
      return;
    }
    if (event.target.closest("[data-detail-edit]")) {
      if (habit) openHabitSheet(habit.id);
      return;
    }
    if (handleMonthNavClick(event)) return;
    if (!habit) return;

    const track = event.target.closest("[data-track]");
    if (track) {
      const next = track.dataset.track;
      // `getHabitTarget(habit) || 3` never reached the 3: getHabitTarget
      // returns 1 for a checkbox habit, which is truthy, so switching to Count
      // stored countTarget: 1 -- below the minimum of 2. getHabitTarget then
      // clamped it back up to 2 on read, so the tile said "0/2" while the
      // record said 1, and the first tap of + jumped the target from 1 to 3.
      const stored = parseInt(habit.countTarget, 10);
      patch(habit, {
        trackType: next,
        countTarget:
          next === "count" ? Math.min(50, Math.max(2, stored >= 2 ? stored : 3)) : 1,
      });
      return;
    }

    const step = event.target.closest("[data-target-step]");
    if (step) {
      const delta = parseInt(step.dataset.targetStep, 10);
      patch(habit, {
        countTarget: Math.min(50, Math.max(2, getHabitTarget(habit) + delta)),
      });
      return;
    }

    if (event.target.closest("[data-reminder-toggle]")) {
      const enabling = !(habit.reminder || {}).enabled;
      patchReminder(habit, { enabled: enabling });
      // Ask for the OS permission at the moment the user asks for a reminder,
      // which is the only moment the request makes sense to them.
      if (enabling) callRenderer("requestReminderPermission");
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
      const day = parseInt(cell.dataset.calDay, 10);
      // Keep the note card pointed at whatever you just touched.
      globals.dayFocusDay = day;
      cycleCalendarDay(habit, day);
    }
  });

  section.addEventListener("change", (event) => {
    const habit = getDetailHabit();
    if (!habit) return;
    if (event.target.id === "detailReminderTime") {
      patchReminder(habit, { time: event.target.value });
      return;
    }
    if (event.target.id === "detailNote") {
      setNote(habit, selectedDetailDay(), event.target.value);
    }
  });

  // Save the note on the way out too -- a `change` only fires on blur, and
  // leaving the screen by tapping Done does not always produce one first.
  section.addEventListener(
    "blur",
    (event) => {
      const habit = getDetailHabit();
      if (habit && event.target.id === "detailNote") {
        setNote(habit, selectedDetailDay(), event.target.value);
      }
    },
    true,
  );
}

registerRenderer("renderDetail", renderDetail);
