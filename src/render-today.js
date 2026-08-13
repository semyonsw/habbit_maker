"use strict";

// The Today screen: the date and completion figure, a day picker, and the
// habit list you check off.
//
// The design shows a single day. This app has always let you fill in an
// earlier day, so the day strip stays -- restyled as the design's capsule row.
// globals.dayFocusDay holds the selection; null means "today if we are looking
// at the current month, else the 1st".

import { FULL_WEEKDAYS, MONTH_NAMES, WEEKDAY_LABELS } from "./constants.js";
import { state, globals } from "./state.js";
import { sanitize, daysInMonth } from "./utils.js?v=2";
import { getCurrentMonthData, getCategoryById } from "./persistence.js";
import {
  advanceHabitDay,
  computeHabitStreak,
  getDayCounts,
  getDayValue,
  getHabitTarget,
  getScheduledHabits,
  isHabitDoneOn,
} from "./habits.js";
import { registerRenderer } from "./render-registry.js";

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
  renderToday({ recenter: true });
}

function relativeLabel(day) {
  const now = new Date();
  const selected = new Date(state.currentYear, state.currentMonth, day);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const diff = Math.round((selected - startOfToday) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return WEEKDAY_LABELS[selected.getDay()];
}

/* ----------------------------------------------------------------- markup */

function dayStripHtml(selectedDay) {
  const total = daysInMonth(state.currentYear, state.currentMonth);
  const now = new Date();
  const todayDay =
    now.getFullYear() === state.currentYear &&
    now.getMonth() === state.currentMonth
      ? now.getDate()
      : -1;

  let html = "";
  for (let day = 1; day <= total; day += 1) {
    const dow = new Date(state.currentYear, state.currentMonth, day).getDay();
    const { done, total: scheduled } = getDayCounts(day);
    const classes = ["day-chip"];
    if (day === selectedDay) classes.push("is-selected");
    if (day === todayDay) classes.push("is-today");
    if (scheduled > 0 && done === scheduled) classes.push("is-complete");

    html +=
      `<button type="button" class="${classes.join(" ")}" data-day="${day}"` +
      ` aria-pressed="${day === selectedDay}"` +
      ` aria-label="${sanitize(WEEKDAY_LABELS[dow])} ${day}, ${done} of ${scheduled} done">` +
      `<span class="day-chip-dow">${sanitize(WEEKDAY_LABELS[dow].slice(0, 2))}</span>` +
      `<span class="day-chip-num">${day}</span>` +
      "</button>";
  }
  return html;
}

const CHECK_SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M5 12.5l4.5 4.5L19 7"></path></svg>';

function metaHtml(habit, streak) {
  const cat = getCategoryById(habit.categoryId);
  const parts = [];
  if (cat) parts.push(`<span>${sanitize(cat.name)}</span>`);
  parts.push(
    `<span class="mono">${streak.current > 0 ? `${streak.current}d streak` : "no streak"}</span>`,
  );
  if (habit.reminder && habit.reminder.enabled) {
    parts.push(`<span class="mono">${sanitize(habit.reminder.time)}</span>`);
  }
  return parts.join('<span class="sep">·</span>');
}

function rowHtml(habit, monthData, day) {
  const done = isHabitDoneOn(habit, monthData, day);
  const streak = computeHabitStreak(habit.id);
  const isCount = habit.trackType === "count";
  const value = getDayValue(monthData, habit.id, day);
  const target = getHabitTarget(habit);

  const control = isCount
    ? `<button type="button" class="habit-count${done ? " is-done" : ""}"` +
      ` data-advance="${sanitize(habit.id)}" data-day="${day}"` +
      ' title="Tap to add one, tap again past the target to reset"' +
      ` aria-label="${sanitize(habit.name)}: ${value} of ${target}">${value}/${target}</button>`
    : `<button type="button" class="habit-check${done ? " is-done" : ""}"` +
      ` data-advance="${sanitize(habit.id)}" data-day="${day}"` +
      ` aria-pressed="${done}" aria-label="${sanitize(habit.name)}">` +
      `${done ? CHECK_SVG : ""}</button>`;

  return (
    '<div class="habit-row">' +
    `<button type="button" class="habit-open" data-open="${sanitize(habit.id)}">` +
    `<span class="habit-mark" aria-hidden="true">${sanitize(habit.mark || "HB")}</span>` +
    '<span class="habit-text">' +
    `<span class="habit-name">${sanitize(habit.name)}</span>` +
    `<span class="habit-meta">${metaHtml(habit, streak)}</span>` +
    "</span></button>" +
    control +
    "</div>"
  );
}

/* ------------------------------------------------------------------ render */

export function renderToday(options = {}) {
  const section = document.getElementById("view-today");
  if (!section) return;

  const day = getSelectedDay();
  const monthData = getCurrentMonthData();
  const habits = getScheduledHabits(state.currentYear, state.currentMonth, day);
  const done = habits.filter((h) => isHabitDoneOn(h, monthData, day)).length;
  const pct = habits.length ? Math.round((done / habits.length) * 100) : 0;

  const weekday = document.getElementById("todayWeekday");
  if (weekday) {
    const dow = new Date(state.currentYear, state.currentMonth, day).getDay();
    weekday.textContent = FULL_WEEKDAYS[dow];
  }

  const dateEl = document.getElementById("todayDate");
  if (dateEl) {
    dateEl.textContent = `${day} ${MONTH_NAMES[state.currentMonth]}`;
  }

  const pctEl = document.getElementById("todayPct");
  if (pctEl) pctEl.textContent = `${pct}%`;

  const countEl = document.getElementById("todayCount");
  if (countEl) countEl.textContent = `${done} of ${habits.length} done`;

  const progress = document.getElementById("todayProgress");
  if (progress) {
    progress.setAttribute("aria-valuenow", String(pct));
    const fill = progress.querySelector("span");
    if (fill) fill.style.width = `${pct}%`;
  }

  const listLabel = document.getElementById("todayListLabel");
  if (listLabel) listLabel.textContent = relativeLabel(day);

  const scheduled = document.getElementById("todayScheduled");
  if (scheduled) {
    scheduled.textContent = `${habits.length} scheduled`;
  }

  const strip = document.getElementById("dayStrip");
  if (strip) {
    strip.innerHTML = dayStripHtml(day);
    const selected = strip.querySelector(".day-chip.is-selected");
    if (selected) {
      // Next frame: scrollWidth/clientWidth are still stale in the tick that
      // set innerHTML, so measuring here would leave the strip at day 1.
      requestAnimationFrame(() => {
        const max = strip.scrollWidth - strip.clientWidth;
        if (max <= 0) return;
        strip.scrollTo({
          left: Math.max(
            0,
            Math.min(
              max,
              selected.offsetLeft -
                strip.clientWidth / 2 +
                selected.offsetWidth / 2,
            ),
          ),
          behavior: options.recenter ? "smooth" : "auto",
        });
      });
    }
  }

  const list = document.getElementById("todayList");
  if (list) {
    list.innerHTML = habits.length
      ? habits.map((h) => rowHtml(h, monthData, day)).join("")
      : "<div class='empty-state'><p>Nothing scheduled for this day.</p></div>";
  }
}

/* ---------------------------------------------------------------- handlers */

export function bindTodayEvents() {
  const section = document.getElementById("view-today");
  if (!section) return;

  section.addEventListener("click", (event) => {
    const dayChip = event.target.closest("[data-day]:not([data-advance])");
    if (dayChip && dayChip.classList.contains("day-chip")) {
      setSelectedDay(dayChip.dataset.day);
      return;
    }

    const advance = event.target.closest("[data-advance]");
    if (advance) {
      advanceHabitDay(advance.dataset.advance, parseInt(advance.dataset.day, 10));
      return;
    }

    const open = event.target.closest("[data-open]");
    if (open) {
      globals.detailHabitId = open.dataset.open;
      // Through the router so the Android back button returns to Today.
      window.location.hash = "#/detail";
    }
  });
}

registerRenderer("renderToday", renderToday);
