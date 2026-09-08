"use strict";

// The Today screen: the date and completion figure, a month bar, a day picker,
// the habit list you check off, and below it the one-off tasks for that day.
//
// The design shows a single day. This app has always let you fill in an earlier
// day, so the day strip stays -- restyled as the design's capsule row.
// globals.dayFocusDay holds the selection; null means "today if we are looking
// at the current month, else the 1st".

import {
  FULL_WEEKDAYS,
  HOLD_TO_SKIP_MS,
  MONTH_NAMES,
  WEEKDAY_LABELS,
} from "./constants.js";
import { state, globals } from "./state.js";
import { sanitize, daysInMonth, formatDateKey, todayDateKey } from "./utils.js";
import { getViewedMonthData, getCategoryById } from "./persistence.js";
import { getTasksForDate, getOverdueTasks, toggleTaskDone } from "./tasks.js";
import {
  daysLate,
  overdueLabel,
  taskCounts,
  taskDateLabel,
} from "./task-core.js";
import {
  advanceHabitDay,
  computeHabitScore,
  nudgeHabitOrder,
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
import {
  bindHabitReorder,
  consumeDragClick,
  isDragging,
} from "./reorder.js";
import { registerRenderer, callRenderer } from "./render-registry.js";
import { navigateTo } from "./router.js";

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
    '<button type="button" class="habit-open" title="Hold to reorder"' +
    ` data-open="${sanitize(habit.id)}">` +
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

/* -------------------------------------------------------------- tasks ---
   One-off tasks for the selected day.

   Kept visually and structurally apart from the habit list above: a task has
   no strength, no streak and no schedule, and it is absent from the completion
   figure at the top of the screen. Its own count is shown here instead, so
   "2 of 3 done" on a habit day never silently means "and one errand".
   ---------------------------------------------------------------------- */

function taskRowHtml(task, todayKey, options = {}) {
  const classes = ["task-row"];
  if (task.done) classes.push("is-done");
  if (options.overdue) classes.push("is-overdue");

  const cat = task.categoryId ? getCategoryById(task.categoryId) : null;
  const parts = [];
  if (options.overdue) {
    const late = daysLate(task.date, todayKey);
    parts.push(
      `<span class="mono is-late">${sanitize(overdueLabel(late))}</span>`,
      `<span>${sanitize(taskDateLabel(task.date, todayKey))}</span>`,
    );
  }
  if (cat) parts.push(`<span>${sanitize(cat.name)}</span>`);
  if (task.reminder && task.reminder.enabled) {
    parts.push(`<span class="mono">${sanitize(task.reminder.time)}</span>`);
  }

  const meta = parts.length
    ? `<span class="task-meta">${parts.join('<span class="sep">·</span>')}</span>`
    : "";
  const note = task.note
    ? `<span class="task-note">${sanitize(task.note)}</span>`
    : "";

  return (
    `<div class="${classes.join(" ")}">` +
    '<button type="button" class="task-open" title="Edit this task"' +
    ` data-task-open="${sanitize(task.id)}">` +
    '<span class="task-text">' +
    `<span class="task-title">${sanitize(task.title)}</span>` +
    meta +
    note +
    "</span></button>" +
    `<button type="button" class="task-check${task.done ? " is-done" : ""}"` +
    ` data-task-toggle="${sanitize(task.id)}"` +
    ` aria-pressed="${task.done}"` +
    ` aria-label="${sanitize(task.title)}">${task.done ? CHECK_SVG : ""}</button>` +
    "</div>"
  );
}

function tasksSectionHtml(dateKey, todayKey) {
  const forDay = getTasksForDate(dateKey);
  // Overdue tasks appear ONLY while Today is showing today. Looking back at
  // last Tuesday should show what last Tuesday actually held, not a pile of
  // things that have fallen behind since.
  const overdue = dateKey === todayKey ? getOverdueTasks() : [];
  if (!forDay.length && !overdue.length) return "";

  const counts = taskCounts(forDay);
  let html = "";

  if (forDay.length) {
    html +=
      '<div class="today-listhead">' +
      '<div class="eyebrow">Tasks</div>' +
      `<div class="today-scheduled">${counts.done} of ${counts.total} done</div>` +
      "</div>" +
      '<div class="task-list">' +
      forDay.map((task) => taskRowHtml(task, todayKey)).join("") +
      "</div>";
  }

  // Its own block rather than mixed into the list above, so the day's count
  // means the day and nothing else.
  if (overdue.length) {
    html +=
      '<div class="today-listhead">' +
      '<div class="eyebrow">Carried over</div>' +
      `<div class="today-scheduled">${overdue.length} still waiting</div>` +
      "</div>" +
      '<div class="task-list">' +
      overdue.map((task) => taskRowHtml(task, todayKey, { overdue: true })).join("") +
      "</div>";
  }

  return html;
}

/* ------------------------------------------------------------------ render */

export function renderToday(options = {}) {
  const section = document.getElementById("view-today");
  if (!section) return;

  const day = getSelectedDay();
  const monthData = getViewedMonthData();
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

  // A gesture nobody knows about is a gesture nobody uses. Only shown once
  // there is actually something to reorder.
  const hint = document.getElementById("todayListHint");
  if (hint) {
    hint.textContent =
      habits.length > 1 ? "Hold a habit to drag it up or down" : "";
  }

  const tasks = document.getElementById("todayTasks");
  if (tasks) {
    tasks.innerHTML = tasksSectionHtml(
      formatDateKey(state.currentYear, state.currentMonth, day),
      todayDateKey(),
    );
  }
}

/* ---------------------------------------------------------------- handlers */


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

  // Hold the row body to drag it; hold the checkbox to skip. Bound first so its
  // pointerdown runs before the skip gesture's.
  bindHabitReorder(section);

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
    // Cleared on EVERY press, not only on presses that land on a habit
    // control. It used to be reset after the early return below, so a long
    // press that produced no click (the finger drifted off the button, so
    // pointerup fired somewhere else) left holdFired stuck true -- and the
    // click handler then swallowed the next unrelated tap anywhere on Today.
    holdFired = false;

    const control = event.target.closest("[data-advance]");
    if (!control) return;
    const habitId = control.dataset.advance;
    const day = parseInt(control.dataset.day, 10);
    if (isFutureDate(state.currentYear, state.currentMonth, day)) return;

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
    }, HOLD_TO_SKIP_MS);
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
    // The click the browser queues when a drag is dropped must not also open
    // the habit that was dropped.
    if (consumeDragClick() || isDragging()) return;
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
      const day = parseInt(advance.dataset.day, 10);
      // The habit calendar disables future days; Today did not, so the same
      // habit could be ticked off for next Tuesday from one screen and not the
      // other -- and a completion dated in the future is not a completion.
      if (isFutureDate(state.currentYear, state.currentMonth, day)) {
        showToast("That day has not happened yet.");
        return;
      }
      advanceWithUndo(advance.dataset.advance, day);
      return;
    }

    const taskToggle = event.target.closest("[data-task-toggle]");
    if (taskToggle) {
      // No future-day guard here, unlike a habit's.
      //
      // A habit completion dated tomorrow would corrupt the strength average,
      // which is why Today refuses one. A task feeds no maths at all, and
      // finishing an errand a day early is an ordinary thing to do -- so
      // ticking it off is allowed on whatever day it is showing.
      toggleTaskDone(taskToggle.dataset.taskToggle);
      callRenderer("renderAll");
      return;
    }

    const taskOpen = event.target.closest("[data-task-open]");
    if (taskOpen) {
      // Straight to the edit sheet: a task has no detail screen, because there
      // is no history, no streak and no calendar to show for a single day.
      callRenderer("openTaskSheet", taskOpen.dataset.taskOpen);
      return;
    }

    const open = event.target.closest("[data-open]");
    if (open) {
      globals.detailHabitId = open.dataset.open;
      // Through the router so the Android back button returns to Today -- and
      // via navigateTo rather than a raw hash assignment, because assigning the
      // hash it already has fires no hashchange and the view would never switch.
      navigateTo("detail");
    }
  });

  section.addEventListener("keydown", (event) => {
    // Keyboard equivalent of hold-to-skip, since a long press has none.
    if (event.key === "s" || event.key === "S") {
      const control = event.target.closest("[data-advance]");
      if (!control) return;
      event.preventDefault();
      skipWithUndo(control.dataset.advance, parseInt(control.dataset.day, 10));
      return;
    }

    // ...and of the drag. Alt+Arrow rather than a bare arrow, so the arrows are
    // left doing what they normally do inside a list.
    if (!event.altKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const open = event.target.closest("[data-open]");
    if (!open) return;
    event.preventDefault();
    const habitId = open.dataset.open;
    if (!nudgeHabitOrder(habitId, event.key === "ArrowUp" ? -1 : 1)) return;
    callRenderer("renderAll");
    // Keep the habit you are moving focused, so it can be moved again.
    // Matched by scanning rather than by building a selector: habit ids come
    // from imported files as well as from uid(), and CSS.escape is not defined
    // everywhere it would be needed.
    const next = Array.from(document.querySelectorAll("[data-open]")).find(
      (el) => el.dataset.open === habitId,
    );
    if (next && typeof next.focus === "function") next.focus();
  });
}

registerRenderer("renderToday", renderToday);
