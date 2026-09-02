"use strict";

// The Today screen: the date and completion figure, a month bar, a day picker,
// and the habit list you check off.
//
// The design shows a single day. This app has always let you fill in an earlier
// day, so the day strip stays -- restyled as the design's capsule row.
// globals.dayFocusDay holds the selection; null means "today if we are looking
// at the current month, else the 1st".

import { FULL_WEEKDAYS, MONTH_NAMES, WEEKDAY_LABELS } from "./constants.js";
import { state, globals } from "./state.js";
import { sanitize, daysInMonth } from "./utils.js";
import { getCurrentMonthData, getCategoryById } from "./persistence.js";
import {
  advanceHabitDay,
  computeHabitScore,
  computeHabitStreak,
  getDayCounts,
  getDayValue,
  getHabitTarget,
  getScheduledHabits,
  isFutureDate,
  isHabitDoneOn,
  isHabitSkippedOn,
  restoreHabitDayValue,
  toggleHabitDaySkip,
} from "./habits.js";
import { monthNavHtml, handleMonthNavClick } from "./month-nav.js";
import { showToast } from "./toast.js";
import { registerRenderer, callRenderer } from "./render-registry.js";

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

const SKIP_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="3" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M6 12h12"></path></svg>';

// Strength reads as a percentage, but it is deliberately NOT a completion rate
// -- see constants.js. The word "strength" earns its place next to the number.
function strengthLabel(score) {
  return `${Math.round(score * 100)}% strength`;
}

function metaHtml(habit, skipped) {
  const cat = getCategoryById(habit.categoryId);
  const streak = computeHabitStreak(habit.id);
  const score = computeHabitScore(habit.id);

  const parts = [];
  if (cat) parts.push(`<span>${sanitize(cat.name)}</span>`);
  parts.push(`<span class="mono">${strengthLabel(score)}</span>`);
  if (streak.current > 0) {
    parts.push(`<span class="mono">${streak.current}d streak</span>`);
  }
  if (skipped) {
    parts.push('<span class="mono is-skip">skipped</span>');
  }
  return parts.join('<span class="sep">·</span>');
}

function rowHtml(habit, monthData, day) {
  const done = isHabitDoneOn(habit, monthData, day);
  const skipped = isHabitSkippedOn(habit, monthData, day);
  const isCount = habit.trackType === "count";
  const value = getDayValue(monthData, habit.id, day);
  const target = getHabitTarget(habit);

  const classes = ["habit-row"];
  if (skipped) classes.push("is-skipped");

  // Hold-to-skip is the secondary action on the same control, so the primary
  // one (tap = done) keeps its full-size target.
  const holdHint = "Hold to skip this day";

  let control;
  if (skipped) {
    control =
      '<button type="button" class="habit-check is-skipped"' +
      ` data-advance="${sanitize(habit.id)}" data-day="${day}"` +
      ` title="${holdHint}" aria-label="${sanitize(habit.name)}: skipped">` +
      `${SKIP_SVG}</button>`;
  } else if (isCount) {
    control =
      `<button type="button" class="habit-count${done ? " is-done" : ""}"` +
      ` data-advance="${sanitize(habit.id)}" data-day="${day}"` +
      ` title="Tap to add one, tap again past the target to reset. ${holdHint}"` +
      ` aria-label="${sanitize(habit.name)}: ${value} of ${target}">${value}/${target}</button>`;
  } else {
    control =
      `<button type="button" class="habit-check${done ? " is-done" : ""}"` +
      ` data-advance="${sanitize(habit.id)}" data-day="${day}"` +
      ` title="${holdHint}"` +
      ` aria-pressed="${done}" aria-label="${sanitize(habit.name)}">` +
      `${done ? CHECK_SVG : ""}</button>`;
  }

  // The implementation intention, when the habit has one. Shown on the row
  // rather than buried in the edit sheet, because a cue you never read is not
  // a cue.
  const cue = habit.cue
    ? `<span class="habit-cue">${sanitize(habit.cue)}</span>`
    : "";

  return (
    `<div class="${classes.join(" ")}">` +
    `<button type="button" class="habit-open" data-open="${sanitize(habit.id)}">` +
    `<span class="habit-mark" aria-hidden="true">${sanitize(habit.mark || "HB")}</span>` +
    '<span class="habit-text">' +
    `<span class="habit-name">${sanitize(habit.name)}</span>` +
    `<span class="habit-meta">${metaHtml(habit, skipped)}</span>` +
    cue +
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
  const counts = getDayCounts(day);
  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;

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
  if (countEl) {
    countEl.textContent =
      `${counts.done} of ${counts.total} done` +
      (counts.skipped ? ` · ${counts.skipped} skipped` : "");
  }

  const progress = document.getElementById("todayProgress");
  if (progress) {
    progress.setAttribute("aria-valuenow", String(pct));
    const fill = progress.querySelector("span");
    if (fill) fill.style.width = `${pct}%`;
  }

  const monthBar = document.getElementById("todayMonthNav");
  if (monthBar) monthBar.innerHTML = monthNavHtml();

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
        const left = Math.max(
          0,
          Math.min(
            max,
            selected.offsetLeft -
              strip.clientWidth / 2 +
              selected.offsetWidth / 2,
          ),
        );
        // scrollTo is not universal (it is absent in some embedded WebViews and
        // in the test DOM), and centring the strip is a nicety -- it must never
        // be able to take the whole render down with it.
        if (typeof strip.scrollTo === "function") {
          strip.scrollTo({
            left,
            behavior: options.recenter ? "smooth" : "auto",
          });
        } else {
          strip.scrollLeft = left;
        }
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

const HOLD_MS = 500;

function habitNameFor(habitId) {
  const habit = state.habits.daily.find((h) => h.id === habitId);
  return habit ? habit.name : "Habit";
}

// Skip, with the undo attached. Marking a day skipped is the one action here
// that changes what a streak *means*, so it always says what it did.
function skipWithUndo(habitId, day) {
  const result = toggleHabitDaySkip(habitId, day);
  if (!result) return;
  const name = habitNameFor(habitId);
  const message =
    result.next === 0
      ? `${name}: skip removed`
      : `${name} skipped — streak and strength unaffected`;
  showToast(message, {
    onAction: () => {
      restoreHabitDayValue(habitId, day, result.previous);
      callRenderer("renderAll");
    },
  });
}

// Tap, with an undo only where one is actually needed: wrapping a count habit
// back to zero silently discards real progress (a target of 50 discards fifty
// taps), which was the sharpest edge on this screen.
function advanceWithUndo(habitId, day) {
  const result = advanceHabitDay(habitId, day);
  if (!result) return;
  if (result.next === 0 && result.previous > 1) {
    showToast(`${habitNameFor(habitId)} reset to 0`, {
      onAction: () => {
        restoreHabitDayValue(habitId, day, result.previous);
        callRenderer("renderAll");
      },
    });
  }
}

export function bindTodayEvents() {
  const section = document.getElementById("view-today");
  if (!section) return;

  // --- hold-to-skip ------------------------------------------------------
  //
  // pointer events rather than touch/mouse pairs, so this is one code path on
  // both. `holdFired` suppresses the click that a pointerup always produces
  // after a long press, which would otherwise toggle the habit on top of the
  // skip we just applied.
  let holdTimer = 0;
  let holdFired = false;
  let holdTarget = null;
  let holdStart = null;

  const cancelHold = () => {
    clearTimeout(holdTimer);
    holdTimer = 0;
    if (holdTarget) holdTarget.classList.remove("is-holding");
    holdTarget = null;
    holdStart = null;
  };

  section.addEventListener("pointerdown", (event) => {
    const control = event.target.closest("[data-advance]");
    if (!control) return;
    const habitId = control.dataset.advance;
    const day = parseInt(control.dataset.day, 10);
    if (isFutureDate(state.currentYear, state.currentMonth, day)) return;

    holdFired = false;
    holdTarget = control;
    holdStart = { x: event.clientX, y: event.clientY };
    control.classList.add("is-holding");
    holdTimer = setTimeout(() => {
      holdFired = true;
      cancelHold();
      // A skip is a real state change on a press the user cannot see the result
      // of yet, so confirm it physically where the device can.
      if (navigator.vibrate) {
        try {
          navigator.vibrate(12);
        } catch (_) {
          /* vibration blocked; the toast still explains what happened */
        }
      }
      skipWithUndo(habitId, day);
    }, HOLD_MS);
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
    section.addEventListener(type, cancelHold);
  });
  // Scrolling the list or the day strip must not arm a skip. Measured from
  // where the press started rather than from event.movementX, which touch
  // pointers do not reliably populate.
  const HOLD_SLOP_PX = 10;
  section.addEventListener("pointermove", (event) => {
    if (!holdTimer || !holdStart) return;
    if (
      Math.abs(event.clientX - holdStart.x) > HOLD_SLOP_PX ||
      Math.abs(event.clientY - holdStart.y) > HOLD_SLOP_PX
    ) {
      cancelHold();
    }
  });

  section.addEventListener("click", (event) => {
    if (holdFired) {
      holdFired = false;
      return;
    }

    if (handleMonthNavClick(event)) return;

    const dayChip = event.target.closest("[data-day]:not([data-advance])");
    if (dayChip && dayChip.classList.contains("day-chip")) {
      setSelectedDay(dayChip.dataset.day);
      return;
    }

    const advance = event.target.closest("[data-advance]");
    if (advance) {
      advanceWithUndo(advance.dataset.advance, parseInt(advance.dataset.day, 10));
      return;
    }

    const open = event.target.closest("[data-open]");
    if (open) {
      globals.detailHabitId = open.dataset.open;
      // Through the router so the Android back button returns to Today.
      window.location.hash = "#/detail";
    }
  });

  // Keyboard equivalent of hold-to-skip, since a long press has none.
  section.addEventListener("keydown", (event) => {
    if (event.key !== "s" && event.key !== "S") return;
    const control = event.target.closest("[data-advance]");
    if (!control) return;
    event.preventDefault();
    skipWithUndo(control.dataset.advance, parseInt(control.dataset.day, 10));
  });
}

registerRenderer("renderToday", renderToday);
