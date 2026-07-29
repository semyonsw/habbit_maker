"use strict";

// Day-focus card: the mobile check-in surface.
//
// The month grid is 1 + 31 columns and roughly 1500px wide, which is not a
// phone UI. In the mobile layout we don't render it at all (see
// renderDailyHabitsGrid) and show this instead: one day at a time as a big
// tappable checklist, a horizontally scrolling date strip to move between days,
// and a compact month heatmap so the whole-month overview isn't lost.
//
// This is a generalisation of the old renderTodayQuickCheck(), with the day
// promoted from "always today" to view state (globals.dayFocusDay).
//
// Writes go through setHabitDayCompletion() in render-dashboard.js -- the same
// single path the desktop grid checkbox uses, so the two can never disagree.
// That function calls back here via patchDayFocusCompletion/patchDayIndicators,
// which PATCH nodes rather than re-rendering: a re-render would rebind the
// handlers that called it and would reset the date strip's scroll on every tap.

import { WEEKDAY_LABELS, MONTH_NAMES } from "./constants.js";
import { state, globals } from "./state.js";
import {
  sanitize,
  daysInMonth,
  getHeatColor,
  getWeekShadeColor,
  getMonthCalendarWeekLayout,
} from "./utils.js?v=2";
import { getCurrentMonthData, getHabitEmoji } from "./persistence.js";
import {
  getSortedDailyHabits,
  isHabitTrackedOnDate,
  navigateMonth,
} from "./habits.js";
import {
  setHabitDayCompletion,
  computeDayFullyCompleted,
  computeHabitStreak,
  buildDailyCompletionMountainSeries,
} from "./render-dashboard.js";
import { registerRenderer, callRenderer } from "./render-registry.js";

const SWIPE_MIN_PX = 48;

/* ------------------------------------------------------------------ state */

export function getSelectedDay() {
  const total = daysInMonth(state.currentYear, state.currentMonth);
  if (globals.dayFocusDay == null) {
    const now = new Date();
    const viewingCurrentMonth =
      now.getFullYear() === state.currentYear &&
      now.getMonth() === state.currentMonth;
    return viewingCurrentMonth ? now.getDate() : 1;
  }
  return Math.min(total, Math.max(1, globals.dayFocusDay));
}

export function setSelectedDay(day) {
  const total = daysInMonth(state.currentYear, state.currentMonth);
  const parsed = parseInt(day, 10);
  globals.dayFocusDay = Math.min(
    total,
    Math.max(1, Number.isFinite(parsed) ? parsed : 1),
  );
  renderDayFocus({ recenter: true });
}

// Move by one day, rolling into the neighbouring month at the edges.
// navigateMonth() is synchronous and ends in renderAll(), which re-renders this
// card; the setSelectedDay() after it then lands on the correct edge day.
export function stepDay(delta) {
  const total = daysInMonth(state.currentYear, state.currentMonth);
  const next = getSelectedDay() + delta;
  if (next >= 1 && next <= total) {
    setSelectedDay(next);
    return;
  }
  navigateMonth(delta > 0 ? 1 : -1);
  setSelectedDay(
    delta > 0 ? 1 : daysInMonth(state.currentYear, state.currentMonth),
  );
}

/* ----------------------------------------------------------------- helpers */

function isDone(monthData, habitId, day) {
  return !!(
    monthData.dailyCompletions[habitId] &&
    monthData.dailyCompletions[habitId][day]
  );
}

function hasNote(monthData, habitId, day) {
  const note = monthData.dailyNotes[habitId] &&
    monthData.dailyNotes[habitId][day];
  return typeof note === "string" && note.trim().length > 0;
}

function scheduledOn(day) {
  return getSortedDailyHabits().filter((h) =>
    isHabitTrackedOnDate(h, state.currentYear, state.currentMonth, day),
  );
}

function relativeLabel(day) {
  const now = new Date();
  const selected = new Date(state.currentYear, state.currentMonth, day);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const diffDays = Math.round(
    (selected - startOfToday) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === -1) return "Yesterday";
  if (diffDays === 1) return "Tomorrow";
  return "";
}

function dayCounts(day) {
  const monthData = getCurrentMonthData();
  const habits = scheduledOn(day);
  const done = habits.filter((h) => isDone(monthData, h.id, day)).length;
  return { done, total: habits.length };
}

function reduceMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Same approach the month grid uses to scroll "today" into view.
function centerChip(track, chip, smooth) {
  if (!track || !chip) return;
  const max = track.scrollWidth - track.clientWidth;
  if (max <= 0) return;
  const left = Math.max(
    0,
    Math.min(max, chip.offsetLeft - track.clientWidth / 2 + chip.offsetWidth / 2),
  );
  track.scrollTo({ left, behavior: smooth && !reduceMotion() ? "smooth" : "auto" });
}

/* ------------------------------------------------------------------ markup */

function dateStripHtml(selectedDay, seriesByDay) {
  const total = daysInMonth(state.currentYear, state.currentMonth);
  const { dayToWeek } = getMonthCalendarWeekLayout(
    state.currentYear,
    state.currentMonth,
  );
  const now = new Date();
  const todayDay =
    now.getFullYear() === state.currentYear &&
    now.getMonth() === state.currentMonth
      ? now.getDate()
      : -1;

  let html =
    "<div class='day-focus-strip'>" +
    "<button type='button' class='day-focus-step' data-day-step='-1' aria-label='Previous day'>‹</button>" +
    `<div class='day-focus-track' id='dayFocusTrack' role='group' aria-label='Days in ${MONTH_NAMES[state.currentMonth]} ${state.currentYear}'>`;

  for (let day = 1; day <= total; day += 1) {
    const info = seriesByDay[day] || { done: 0, possible: 0, rate: 0 };
    const dow = new Date(state.currentYear, state.currentMonth, day).getDay();
    const complete = info.possible > 0 && info.done === info.possible;
    const classes = ["day-chip"];
    if (day === selectedDay) classes.push("is-selected");
    if (day === todayDay) classes.push("is-today");
    else if (todayDay !== -1 && day < todayDay) classes.push("is-past");
    else if (todayDay !== -1) classes.push("is-future");
    if (complete) classes.push("is-complete");
    if (info.possible === 0) classes.push("is-empty");

    const heat =
      info.possible > 0 ? getHeatColor(info.done / info.possible) : "transparent";
    const label = `${WEEKDAY_LABELS[dow]} ${day}, ${info.done} of ${info.possible} done`;

    html +=
      `<button type='button' class='${classes.join(" ")}' data-day='${day}'` +
      ` aria-pressed='${day === selectedDay}' aria-label='${sanitize(label)}'` +
      ` tabindex='${day === selectedDay ? "0" : "-1"}'` +
      ` style='--week-accent:${getWeekShadeColor(dayToWeek[day] || 1)};--chip-heat:${heat}'>` +
      `<span class='day-chip-dow'>${sanitize(WEEKDAY_LABELS[dow].slice(0, 2))}</span>` +
      `<span class='day-chip-num'>${day}</span>` +
      "<span class='day-chip-dot' aria-hidden='true'></span>" +
      "</button>";
  }

  html +=
    "</div>" +
    "<button type='button' class='day-focus-step' data-day-step='1' aria-label='Next day'>›</button>" +
    "</div>";
  return html;
}

function headerHtml(selectedDay, done, total) {
  const date = new Date(state.currentYear, state.currentMonth, selectedDay);
  const dateText = `${WEEKDAY_LABELS[date.getDay()]}, ${selectedDay} ${MONTH_NAMES[state.currentMonth]}`;
  const rel = relativeLabel(selectedDay);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    "<div class='day-focus-head'>" +
    "<div class='day-focus-title'>" +
    `<span class='day-focus-date'>${sanitize(dateText)}</span>` +
    (rel ? `<span class='day-focus-rel'>${sanitize(rel)}</span>` : "") +
    "</div>" +
    `<span class='day-focus-count' aria-live='polite'>${done}/${total}</span>` +
    "</div>" +
    `<div class='day-focus-progress' role='progressbar' aria-valuemin='0' aria-valuemax='${total}' aria-valuenow='${done}' aria-label='Habits completed'>` +
    `<span style='width:${pct}%'></span></div>`
  );
}

function rowsHtml(habits, monthData, selectedDay) {
  let html = "<div class='day-focus-list'>";
  habits.forEach((h) => {
    const done = isDone(monthData, h.id, selectedDay);
    const noted = hasNote(monthData, h.id, selectedDay);
    const streak = computeHabitStreak(h.id);
    html +=
      `<div class='day-focus-row${done ? " is-done" : ""}'>` +
      // A container, not a button: the note button below is a sibling, and
      // nesting interactive elements is invalid HTML.
      `<button type='button' class='day-focus-toggle' data-habit='${sanitize(h.id)}' data-day='${selectedDay}' aria-pressed='${done}'>` +
      "<span class='day-focus-check' aria-hidden='true'></span>" +
      `<span class='day-focus-emoji' aria-hidden='true'>${sanitize(getHabitEmoji(h))}</span>` +
      "<span class='day-focus-text'>" +
      `<span class='day-focus-name'>${sanitize(h.name)}</span>` +
      `<span class='day-focus-streak' data-streak-habit='${sanitize(h.id)}' data-streak-format='short'` +
      ` data-streak-current='${streak.current}' data-streak-best='${streak.best}'></span>` +
      "</span></button>" +
      `<button type='button' class='day-focus-note note-btn${noted ? " has-note" : ""}' data-habit='${sanitize(h.id)}' data-day='${selectedDay}' aria-label='Note for ${sanitize(h.name)}'>\u{1F4DD}</button>` +
      "</div>";
  });
  html += "</div>";
  return html;
}

function offHtml(selectedDay) {
  const off = getSortedDailyHabits().filter(
    (h) =>
      !isHabitTrackedOnDate(
        h,
        state.currentYear,
        state.currentMonth,
        selectedDay,
      ),
  );
  if (!off.length) return "";
  return (
    "<details class='day-focus-off'>" +
    `<summary>${off.length} not scheduled</summary>` +
    "<div class='day-focus-off-list'>" +
    off
      .map(
        (h) =>
          `<span class='day-focus-off-item'>${sanitize(getHabitEmoji(h))} ${sanitize(h.name)}</span>`,
      )
      .join("") +
    "</div></details>"
  );
}

// Compact whole-month overview. Deliberately does NOT reuse .heatmap-cell /
// .weekly-heatmap from the analytics view: that skin assumes a 58px label
// column and carries its own responsive overrides.
function heatmapHtml(selectedDay, seriesByDay) {
  const total = daysInMonth(state.currentYear, state.currentMonth);
  // Monday-first, matching getMonthCalendarWeekLayout / ISO weeks.
  const firstDow = new Date(state.currentYear, state.currentMonth, 1).getDay();
  const leadingBlanks = (firstDow + 6) % 7;

  let html =
    "<div class='day-focus-heat'><div class='day-heat-dow' aria-hidden='true'>" +
    ["M", "T", "W", "T", "F", "S", "S"]
      .map((d) => `<span>${d}</span>`)
      .join("") +
    "</div><div class='day-heat-grid'>";

  for (let i = 0; i < leadingBlanks; i += 1) {
    html += "<span class='day-heat-blank'></span>";
  }
  for (let day = 1; day <= total; day += 1) {
    const info = seriesByDay[day] || { done: 0, possible: 0 };
    const complete = info.possible > 0 && info.done === info.possible;
    const bg =
      info.possible > 0 ? getHeatColor(info.done / info.possible) : "transparent";
    html +=
      `<button type='button' class='day-heat-cell${complete ? " is-complete" : ""}${day === selectedDay ? " is-selected" : ""}'` +
      ` data-day='${day}' style='background:${bg}'` +
      ` aria-label='${day} ${sanitize(MONTH_NAMES[state.currentMonth])}, ${info.done} of ${info.possible} done'></button>`;
  }
  html += "</div></div>";
  return html;
}

/* ------------------------------------------------------------------ render */

export function renderDayFocus(options = {}) {
  const container = document.getElementById("dayFocus");
  if (!container) return;

  const selectedDay = getSelectedDay();
  const monthData = getCurrentMonthData();
  const habits = scheduledOn(selectedDay);
  const done = habits.filter((h) => isDone(monthData, h.id, selectedDay)).length;

  const seriesByDay = {};
  buildDailyCompletionMountainSeries().days.forEach((d) => {
    seriesByDay[d.day] = d;
  });

  // Habits first, day pickers after. On a phone the check-in list is what the
  // user came for, so it gets the top of the card and the two month-navigation
  // surfaces (the day strip and the heatmap) sit together below it. This is DOM
  // order rather than CSS `order` on purpose: the card is phone/tablet-only, so
  // reordering here keeps the screen-reader and tab order matching the visuals.
  container.innerHTML =
    headerHtml(selectedDay, done, habits.length) +
    (habits.length
      ? rowsHtml(habits, monthData, selectedDay)
      : "<p class='day-focus-empty'>Nothing scheduled for this day.</p>") +
    offHtml(selectedDay) +
    dateStripHtml(selectedDay, seriesByDay) +
    heatmapHtml(selectedDay, seriesByDay);

  bindDayFocus(container);

  // Only chase the selection when it actually moved. Re-centring on every
  // render would yank the strip away from a user who just scrolled it by hand.
  if (options.recenter !== false) {
    requestAnimationFrame(() => {
      const track = container.querySelector(".day-focus-track");
      const chip = container.querySelector(".day-chip.is-selected");
      centerChip(track, chip, options.recenter === true);
    });
  }
}

/* ------------------------------------------------------------------ events */

function toggleHabit(habitId, day) {
  const md = getCurrentMonthData();
  setHabitDayCompletion(habitId, day, !isDone(md, habitId, day));
}

function bindDayFocus(container) {
  container.querySelectorAll(".day-focus-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleHabit(btn.dataset.habit, parseInt(btn.dataset.day, 10));
      // Feature-detected; a no-op on iOS.
      if (navigator.vibrate) navigator.vibrate(8);
    });
  });

  container.querySelectorAll(".day-focus-note").forEach((btn) => {
    btn.addEventListener("click", () => {
      callRenderer(
        "openNoteModal",
        btn.dataset.habit,
        parseInt(btn.dataset.day, 10),
      );
    });
  });

  container
    .querySelectorAll(".day-chip, .day-heat-cell")
    .forEach((el) => {
      el.addEventListener("click", () => setSelectedDay(el.dataset.day));
    });

  container.querySelectorAll(".day-focus-step").forEach((btn) => {
    btn.addEventListener("click", () => {
      stepDay(parseInt(btn.dataset.dayStep, 10));
    });
  });

  const track = container.querySelector(".day-focus-track");
  if (track) {
    track.addEventListener("keydown", (e) => {
      const total = daysInMonth(state.currentYear, state.currentMonth);
      if (e.key === "ArrowRight") stepDay(1);
      else if (e.key === "ArrowLeft") stepDay(-1);
      else if (e.key === "Home") setSelectedDay(1);
      else if (e.key === "End") setSelectedDay(total);
      else return;
      e.preventDefault();
    });
  }

  const list = container.querySelector(".day-focus-list");
  if (list) bindHorizontalSwipe(list);
}

// Swipe the habit list left/right to change day. Passive listeners, and we bail
// out the moment the gesture looks vertical so page scrolling is never blocked.
function bindHorizontalSwipe(el) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  el.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    },
    { passive: true },
  );

  el.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const dy = Math.abs(e.touches[0].clientY - startY);
      const dx = Math.abs(e.touches[0].clientX - startX);
      if (dy > dx) tracking = false;
    },
    { passive: true },
  );

  el.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches && e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx)) return;
      stepDay(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );
}

/* ------------------------------------------------------------------ patches */

// Called by setHabitDayCompletion. Patches only -- never re-renders.
export function patchDayFocusCompletion(habitId, day, checked) {
  const container = document.getElementById("dayFocus");
  if (!container) return;
  if (parseInt(day, 10) !== getSelectedDay()) return;

  const toggle = container.querySelector(
    `.day-focus-toggle[data-habit="${CSS.escape(String(habitId))}"]`,
  );
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(!!checked));
    const row = toggle.closest(".day-focus-row");
    if (row) row.classList.toggle("is-done", !!checked);
  }

  const { done, total } = dayCounts(getSelectedDay());
  const count = container.querySelector(".day-focus-count");
  if (count) count.textContent = `${done}/${total}`;
  const bar = container.querySelector(".day-focus-progress");
  if (bar) {
    bar.setAttribute("aria-valuemax", String(total));
    bar.setAttribute("aria-valuenow", String(done));
    const fill = bar.querySelector("span");
    if (fill) {
      fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
    }
  }
}

// Refresh the two whole-month indicators for a single day.
export function patchDayIndicators(day) {
  const container = document.getElementById("dayFocus");
  if (!container) return;
  const d = parseInt(day, 10);
  const { done, total } = dayCounts(d);
  const complete = computeDayFullyCompleted(d);
  const heat = total > 0 ? getHeatColor(done / total) : "transparent";

  const chip = container.querySelector(`.day-chip[data-day="${d}"]`);
  if (chip) {
    chip.classList.toggle("is-complete", complete);
    chip.style.setProperty("--chip-heat", heat);
  }

  const cell = container.querySelector(`.day-heat-cell[data-day="${d}"]`);
  if (cell) {
    cell.classList.toggle("is-complete", complete);
    cell.style.background = heat;
  }
}

registerRenderer("renderDayFocus", renderDayFocus);
registerRenderer("patchDayFocusCompletion", patchDayFocusCompletion);
registerRenderer("patchDayIndicators", patchDayIndicators);
// Back-compat: the service worker is cache-first, so a phone can briefly run an
// older ui-prefs.js that still asks for "renderTodayQuickCheck".
registerRenderer("renderTodayQuickCheck", renderDayFocus);
