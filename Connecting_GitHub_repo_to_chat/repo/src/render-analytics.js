"use strict";

import { escapeHtml, monthLabel } from "./utils.js";
import { getSortedDailyHabits, habitsForDate, isDone, doneCountInMonth } from "./habits.js";
import { todayParts } from "./render-today.js";

export function renderAnalytics() {
  const { year, month, day } = todayParts();
  const habits = getSortedDailyHabits();

  let slots = 0, hits = 0, perfect = 0;
  for (let d = 1; d <= day; d += 1) {
    const scheduled = habitsForDate(year, month, d);
    if (!scheduled.length) continue;
    const doneToday = scheduled.filter((h) => isDone(h, year, month, d)).length;
    slots += scheduled.length;
    hits += doneToday;
    if (doneToday === scheduled.length) perfect += 1;
  }
  const monthPct = slots ? Math.round((hits / slots) * 100) : 0;

  const bars = [];
  for (let d = Math.max(1, day - 6); d <= day; d += 1) {
    const scheduled = habitsForDate(year, month, d);
    const doneToday = scheduled.filter((h) => isDone(h, year, month, d)).length;
    const pct = scheduled.length ? Math.round((doneToday / scheduled.length) * 100) : 0;
    const cls = pct >= 100 ? "full" : pct >= 50 ? "mid" : "";
    bars.push(`<div><i class="${cls}" style="height:${Math.max(6, Math.round(pct * 1.06))}px"></i><small>${d}</small></div>`);
  }

  const goals = habits.length
    ? habits.map((h) => {
        const n = doneCountInMonth(h, year, month, day);
        const pct = Math.min(100, Math.round((n / h.monthGoal) * 100));
        return `<div class="goal">
          <div class="goal-top"><b>${escapeHtml(h.name)}</b><span>${n} / ${h.monthGoal}</span></div>
          <div class="track"><i class="${pct >= 100 ? "full" : ""}" style="width:${pct}%"></i></div>
        </div>`;
      }).join("")
    : `<p class="empty" style="padding:10px 0">No habits yet.</p>`;

  return `
    <h1 class="h1">Analytics</h1>
    <p class="sub">${escapeHtml(monthLabel(year, month))} · ${day} day${day === 1 ? "" : "s"} in</p>

    <div class="stats two">
      <div class="stat accent"><b>${monthPct}%</b><span>Month completion</span></div>
      <div class="stat"><b>${perfect}</b><span>Perfect days</span></div>
    </div>

    <div class="card">
      <div class="card-title">Last 7 days</div>
      <div class="bars">${bars.join("")}</div>
    </div>

    <div class="card">
      <div class="card-title">Progress to goal</div>
      ${goals}
    </div>
  `;
}
