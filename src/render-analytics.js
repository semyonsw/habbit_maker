"use strict";

// Analytics: KPI tiles, a seven-day bar chart, a year heatmap, a weekday
// breakdown, and a per-habit progress list.
//
// The charts are plain CSS boxes, as drawn in the design. That is also why
// Chart.js is no longer vendored: nothing on this screen needs a canvas.

import { MONTH_NAMES, WEEKDAY_LABELS } from "./constants.js";
import { state, globals } from "./state.js";
import { sanitize, daysInMonth } from "./utils.js";
import {
  computeHabitScore,
  countHabitMonthDone,
  getAllWeekdayStats,
  getDayCounts,
  getSortedDailyHabits,
  getYearGrid,
  todayParts,
} from "./habits.js";
import { monthNavHtml, handleMonthNavClick } from "./month-nav.js";
import { getWeekStart } from "./ui-prefs.js";
import { registerRenderer } from "./render-registry.js";

/* -------------------------------------------------------------- month KPIs */

// Days of the viewed month that have actually happened. A past month counts
// in full; a future month counts as zero.
function elapsedDays() {
  const t = todayParts();
  const total = daysInMonth(state.currentYear, state.currentMonth);
  if (
    state.currentYear > t.year ||
    (state.currentYear === t.year && state.currentMonth > t.month)
  ) {
    return 0;
  }
  if (state.currentYear === t.year && state.currentMonth === t.month) {
    return t.day;
  }
  return total;
}

function monthTotals() {
  const days = elapsedDays();
  let slots = 0;
  let done = 0;
  let perfect = 0;
  let skipped = 0;
  for (let day = 1; day <= days; day += 1) {
    const counts = getDayCounts(day);
    slots += counts.total;
    done += counts.done;
    skipped += counts.skipped;
    if (counts.total > 0 && counts.done === counts.total) perfect += 1;
  }
  return { days, slots, done, perfect, skipped };
}

function averageStrength() {
  const habits = getSortedDailyHabits();
  if (!habits.length) return 0;
  const sum = habits.reduce((acc, h) => acc + computeHabitScore(h.id), 0);
  return sum / habits.length;
}

/* ------------------------------------------------------------- 7-day bars */

function trendBarsHtml() {
  const days = elapsedDays();
  const last =
    days > 0 ? days : daysInMonth(state.currentYear, state.currentMonth);
  const from = Math.max(1, last - 6);

  let html = "";
  for (let day = from; day <= last; day += 1) {
    const { done, total } = getDayCounts(day);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const cls = pct >= 100 ? "is-full" : pct >= 50 ? "is-mid" : "";
    // 1.06 keeps a full day just under the 112px track, matching the design.
    const height = Math.max(6, Math.round(pct * 1.06));
    html +=
      '<div class="bar-col">' +
      `<div class="bar ${cls}" style="height:${height}px" title="${done} of ${total} done"></div>` +
      `<div class="bar-label">${day}</div>` +
      "</div>";
  }
  return html;
}

/* ---------------------------------------------------------------- heatmap */

export function getAnalyticsYear() {
  return globals.analyticsYear == null
    ? todayParts().year
    : globals.analyticsYear;
}

// A year of days as a 7-row grid, one column per week -- the shape everyone
// already knows how to read from a contributions graph.
//
// Every byte this draws was already being stored; there was simply no screen
// that looked further back than the current month.
function heatmapHtml() {
  const year = getAnalyticsYear();
  const grid = getYearGrid(year);
  const t = todayParts();
  const weekStartsSunday = getWeekStart() === "sunday";

  // Back up from 1 January to the start of its week, so every column is a
  // whole week and the rows line up with the weekday labels.
  const start = new Date(year, 0, 1);
  const startDow = start.getDay();
  const lead = weekStartsSunday ? startDow : (startDow + 6) % 7;
  start.setDate(start.getDate() - lead);

  const cursor = new Date(start);
  const columns = [];

  // 53 weeks covers any year plus its partial leading and trailing weeks.
  for (let week = 0; week < 53; week += 1) {
    let cells = "";
    let any = false;
    for (let row = 0; row < 7; row += 1) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const d = cursor.getDate();
      cursor.setDate(cursor.getDate() + 1);

      if (y !== year) {
        cells += '<span class="heat-cell is-void"></span>';
        continue;
      }
      any = true;

      const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const counts = grid.get(key);
      const isToday = y === t.year && m === t.month && d === t.day;

      if (!counts) {
        // Future, or beyond today.
        cells += `<span class="heat-cell is-future${isToday ? " is-today" : ""}"></span>`;
        continue;
      }

      const pct = counts.total > 0 ? counts.done / counts.total : null;
      let level;
      if (counts.total === 0) level = counts.skipped > 0 ? "skip" : "none";
      else if (pct >= 1) level = "l4";
      else if (pct >= 0.66) level = "l3";
      else if (pct >= 0.33) level = "l2";
      else if (pct > 0) level = "l1";
      else level = "l0";

      const label =
        counts.total === 0
          ? `${d} ${MONTH_NAMES[m]}: nothing scheduled`
          : `${d} ${MONTH_NAMES[m]}: ${counts.done} of ${counts.total}`;

      cells +=
        `<span class="heat-cell is-${level}${isToday ? " is-today" : ""}"` +
        ` title="${sanitize(label)}"></span>`;
    }
    if (any) columns.push(`<div class="heat-col">${cells}</div>`);
  }

  const order = weekStartsSunday
    ? [0, 1, 2, 3, 4, 5, 6]
    : [1, 2, 3, 4, 5, 6, 0];
  const rowLabels = order
    .map((d, i) =>
      // Every other row, so the labels do not collide at cell size.
      i % 2 === 1 ? `<span>${sanitize(WEEKDAY_LABELS[d][0])}</span>` : "<span></span>",
    )
    .join("");

  const canForward = year < t.year;

  return (
    '<div class="chart-card">' +
    '<div class="chart-head">' +
    '<div class="chart-title">Year at a glance</div>' +
    '<div class="year-nav">' +
    '<button type="button" data-year-step="-1" aria-label="Previous year">‹</button>' +
    `<span class="year-nav-label">${year}</span>` +
    `<button type="button" data-year-step="1"${canForward ? "" : " disabled"} aria-label="Next year">›</button>` +
    "</div>" +
    "</div>" +
    '<div class="heat-wrap">' +
    `<div class="heat-rows" aria-hidden="true">${rowLabels}</div>` +
    `<div class="heat-grid">${columns.join("")}</div>` +
    "</div>" +
    '<div class="heat-legend">' +
    "<span>less</span>" +
    '<i class="heat-cell is-l0"></i>' +
    '<i class="heat-cell is-l1"></i>' +
    '<i class="heat-cell is-l2"></i>' +
    '<i class="heat-cell is-l3"></i>' +
    '<i class="heat-cell is-l4"></i>' +
    "<span>more</span>" +
    "</div>" +
    "</div>"
  );
}

/* --------------------------------------------------------- weekday profile */

function weekdayHtml() {
  const stats = getAllWeekdayStats();
  const rated = stats.filter((s) => s.pct !== null && s.total >= 2);
  if (rated.length < 3) return "";

  const order =
    getWeekStart() === "sunday" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];

  const best = rated.reduce((a, b) => (b.pct > a.pct ? b : a));
  const worst = rated.reduce((a, b) => (b.pct < a.pct ? b : a));
  const caption =
    best.pct === worst.pct
      ? "Steady across the week."
      : `Strongest on ${WEEKDAY_LABELS[stats.indexOf(best)]}, weakest on ${WEEKDAY_LABELS[stats.indexOf(worst)]}.`;

  return (
    '<div class="chart-card">' +
    '<div class="chart-title">By weekday</div>' +
    '<div class="weekday-bars is-wide">' +
    order
      .map((d) => {
        const stat = stats[d];
        const pct = stat.pct === null ? 0 : stat.pct;
        return (
          '<div class="weekday-col">' +
          `<div class="weekday-track" title="${stat.done} of ${stat.total}">` +
          `<div class="weekday-fill" style="height:${Math.max(3, pct)}%"></div></div>` +
          `<div class="weekday-value">${stat.pct === null ? "–" : `${pct}%`}</div>` +
          `<div class="weekday-label">${sanitize(WEEKDAY_LABELS[d].slice(0, 2))}</div>` +
          "</div>"
        );
      })
      .join("") +
    "</div>" +
    `<div class="chart-caption">${sanitize(caption)}</div>` +
    "</div>"
  );
}

/* ------------------------------------------------------------ goal rows */

function goalRowsHtml() {
  const habits = getSortedDailyHabits();
  if (!habits.length) {
    return "<div class='empty-state'><p>No habits yet.</p></div>";
  }
  return habits
    .map((habit) => {
      const done = countHabitMonthDone(
        habit,
        state.currentYear,
        state.currentMonth,
      );
      const goal = Math.max(1, parseInt(habit.monthGoal, 10) || 20);
      const pct = Math.min(100, Math.round((done / goal) * 100));
      const strength = Math.round(computeHabitScore(habit.id) * 100);
      return (
        '<div class="goal-row">' +
        '<div class="goal-head">' +
        `<div class="goal-name">${sanitize(habit.name)}</div>` +
        `<div class="goal-figure">${done} / ${goal}` +
        `<span class="goal-strength" title="Habit strength">${strength}%</span>` +
        "</div>" +
        "</div>" +
        '<div class="goal-track">' +
        `<div class="goal-fill${pct >= 100 ? " is-full" : ""}" style="width:${pct}%"></div>` +
        "</div></div>"
      );
    })
    .join("");
}

/* ------------------------------------------------------------------ render */

export function renderAnalytics() {
  const body = document.getElementById("analyticsBody");
  if (!body) return;

  const { days, slots, done, perfect } = monthTotals();
  const pct = slots > 0 ? Math.round((done / slots) * 100) : 0;
  const strength = Math.round(averageStrength() * 100);

  const sub = document.getElementById("analyticsSub");
  if (sub) {
    sub.textContent = `${days} day${days === 1 ? "" : "s"} in`;
  }

  const nav = document.getElementById("analyticsMonthNav");
  if (nav) nav.innerHTML = monthNavHtml();

  body.innerHTML =
    '<div class="kpi-grid is-three">' +
    '<div class="kpi">' +
    `<div class="kpi-value is-accent">${strength}%</div>` +
    '<div class="kpi-caption">Avg strength</div></div>' +
    '<div class="kpi">' +
    `<div class="kpi-value">${pct}%</div>` +
    '<div class="kpi-caption">Month done</div></div>' +
    '<div class="kpi">' +
    `<div class="kpi-value">${perfect}</div>` +
    '<div class="kpi-caption">Perfect days</div></div>' +
    "</div>" +
    '<div class="chart-card">' +
    '<div class="chart-title">Last 7 days</div>' +
    `<div class="bars">${trendBarsHtml()}</div>` +
    "</div>" +
    heatmapHtml() +
    weekdayHtml() +
    '<div class="chart-card">' +
    '<div class="chart-title">Progress to goal</div>' +
    goalRowsHtml() +
    "</div>";

  // A year is 53 columns wide and a phone shows about 30, so the interesting
  // end -- now -- is off-screen by default. Next frame, because scrollWidth is
  // still stale in the tick that set innerHTML.
  const wrap = body.querySelector(".heat-wrap");
  if (wrap) {
    requestAnimationFrame(() => {
      const marker = wrap.querySelector(".heat-cell.is-today");
      const max = wrap.scrollWidth - wrap.clientWidth;
      if (max <= 0) return;
      wrap.scrollLeft = marker
        ? Math.min(max, Math.max(0, marker.offsetLeft - wrap.clientWidth + 40))
        : max;
    });
  }
}

/* ---------------------------------------------------------------- handlers */

export function bindAnalyticsEvents() {
  const section = document.getElementById("view-analytics");
  if (!section) return;

  section.addEventListener("click", (event) => {
    if (handleMonthNavClick(event)) return;

    const yearStep = event.target.closest("[data-year-step]");
    if (yearStep && !yearStep.disabled) {
      globals.analyticsYear =
        getAnalyticsYear() + parseInt(yearStep.dataset.yearStep, 10);
      renderAnalytics();
    }
  });
}

registerRenderer("renderAnalytics", renderAnalytics);
