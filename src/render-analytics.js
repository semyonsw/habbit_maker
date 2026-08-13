"use strict";

// Analytics: two KPI tiles, a seven-day bar chart and a per-habit progress
// list.
//
// The charts are plain CSS boxes, as drawn in the design. That is also why
// Chart.js is no longer vendored: nothing on this screen needs a canvas.

import { MONTH_NAMES } from "./constants.js";
import { state } from "./state.js";
import { sanitize, daysInMonth } from "./utils.js?v=2";
import {
  countHabitMonthDone,
  getDayCounts,
  getSortedDailyHabits,
} from "./habits.js";
import { registerRenderer } from "./render-registry.js";

// Days of the viewed month that have actually happened. A past month counts
// in full; a future month counts as zero.
function elapsedDays() {
  const now = new Date();
  const total = daysInMonth(state.currentYear, state.currentMonth);
  if (
    state.currentYear > now.getFullYear() ||
    (state.currentYear === now.getFullYear() &&
      state.currentMonth > now.getMonth())
  ) {
    return 0;
  }
  if (
    state.currentYear === now.getFullYear() &&
    state.currentMonth === now.getMonth()
  ) {
    return now.getDate();
  }
  return total;
}

function monthTotals() {
  const days = elapsedDays();
  let slots = 0;
  let done = 0;
  let perfect = 0;
  for (let day = 1; day <= days; day += 1) {
    const counts = getDayCounts(day);
    slots += counts.total;
    done += counts.done;
    if (counts.total > 0 && counts.done === counts.total) perfect += 1;
  }
  return { days, slots, done, perfect };
}

function trendBarsHtml() {
  const days = elapsedDays();
  const last = days > 0 ? days : daysInMonth(state.currentYear, state.currentMonth);
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
      return (
        '<div class="goal-row">' +
        '<div class="goal-head">' +
        `<div class="goal-name">${sanitize(habit.name)}</div>` +
        `<div class="goal-figure">${done} / ${goal}</div>` +
        "</div>" +
        '<div class="goal-track">' +
        `<div class="goal-fill${pct >= 100 ? " is-full" : ""}" style="width:${pct}%"></div>` +
        "</div></div>"
      );
    })
    .join("");
}

export function renderAnalytics() {
  const body = document.getElementById("analyticsBody");
  if (!body) return;

  const { days, slots, done, perfect } = monthTotals();
  const pct = slots > 0 ? Math.round((done / slots) * 100) : 0;

  const sub = document.getElementById("analyticsSub");
  if (sub) {
    sub.textContent = `${MONTH_NAMES[state.currentMonth]} ${state.currentYear} · ${days} day${days === 1 ? "" : "s"} in`;
  }

  body.innerHTML =
    '<div class="kpi-grid">' +
    '<div class="kpi">' +
    `<div class="kpi-value is-accent">${pct}%</div>` +
    '<div class="kpi-caption">Month completion</div></div>' +
    '<div class="kpi">' +
    `<div class="kpi-value">${perfect}</div>` +
    '<div class="kpi-caption">Perfect days</div></div>' +
    "</div>" +
    '<div class="chart-card">' +
    '<div class="chart-title">Last 7 days</div>' +
    `<div class="bars">${trendBarsHtml()}</div>` +
    "</div>" +
    '<div class="chart-card">' +
    '<div class="chart-title">Progress to goal</div>' +
    goalRowsHtml() +
    "</div>";
}

registerRenderer("renderAnalytics", renderAnalytics);
