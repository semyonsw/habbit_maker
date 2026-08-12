"use strict";

import { WEEKDAY_LABELS } from "./constants.js";
import { globals } from "./state.js";
import { escapeHtml, daysInMonth, monthLabel } from "./utils.js";
import { getCategoryById } from "./persistence.js";
import {
  getHabitById, getValue, isDone, targetOf, streakOf, bestStreakOf,
  doneCountInMonth, isHabitTrackedOnDate,
} from "./habits.js";
import { describe } from "./reminders.js";
import { todayParts } from "./render-today.js";

function weekStart() {
  return globals.prefs.weekStart === 0 ? 0 : 1;
}

function headHtml() {
  const start = weekStart();
  const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (i + start) % 7);
  return order.map((i) => `<span>${WEEKDAY_LABELS[i][0]}</span>`).join("");
}

function gridHtml(habit, year, month, today) {
  const total = daysInMonth(year, month);
  const start = weekStart();
  const pad = (new Date(year, month, 1).getDay() - start + 7) % 7;
  const cells = [];
  for (let i = 0; i < pad; i += 1) cells.push('<div class="cell pad"></div>');
  for (let d = 1; d <= total; d += 1) {
    const value = getValue(habit, year, month, d);
    const done = value >= targetOf(habit);
    const future = d > today;
    const tracked = isHabitTrackedOnDate(habit, year, month, d);
    const cls = [
      "cell",
      done ? "done" : value > 0 ? "partial" : future ? "future" : "",
      d === today ? "today" : "",
      tracked ? "" : "untracked",
    ].filter(Boolean).join(" ");
    cells.push(`<div class="${cls}">${d}</div>`);
  }
  return cells.join("");
}

export function renderDetail(habitId) {
  const habit = getHabitById(habitId);
  if (!habit) {
    return `<button class="back" data-act="back">Today</button><p class="empty">This habit no longer exists.</p>`;
  }
  const { year, month, day } = todayParts();
  const cat = getCategoryById(habit.categoryId);
  const doneThisMonth = doneCountInMonth(habit, year, month, day);
  const isCount = habit.trackType === "count";
  const reminder = habit.reminder || { enabled: false };

  const dayButtons = [1, 2, 3, 4, 5, 6, 0].map((i) => {
    const on = (reminder.days || []).includes(i);
    return `<button class="${on ? "on" : ""}" data-act="detail-rem-day" data-day="${i}">${WEEKDAY_LABELS[i][0]}</button>`;
  }).join("");

  return `
    <button class="back" data-act="back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"></path></svg>
      Today
    </button>

    <div class="eyebrow">${escapeHtml(cat ? cat.name : "No category")}</div>
    <h1 class="h2">${escapeHtml(habit.name)}</h1>

    <div class="stats">
      <div class="stat accent"><b>${streakOf(habit)}d</b><span>Current streak</span></div>
      <div class="stat"><b>${bestStreakOf(habit)}d</b><span>Best streak</span></div>
      <div class="stat"><b>${doneThisMonth}/${habit.monthGoal}</b><span>Of month goal</span></div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:13px;font-weight:600">${escapeHtml(monthLabel(year, month))}</div>
        <div style="font-size:11px;color:var(--dim)">${doneThisMonth} of ${day} days</div>
      </div>
      <div class="grid-head">${headHtml()}</div>
      <div class="grid">${gridHtml(habit, year, month, day)}</div>
    </div>

    <div class="card">
      <div class="eyebrow" style="margin-bottom:10px">Tracking</div>
      <div class="seg">
        <button class="${isCount ? "" : "on"}" data-act="detail-track" data-type="check">Checkbox</button>
        <button class="${isCount ? "on" : ""}" data-act="detail-track" data-type="count">Count</button>
      </div>
      ${isCount ? `
      <div class="inline-row">
        <span class="lab">Target per day</span>
        <span class="stepper">
          <button data-act="detail-target" data-step="-1">−</button>
          <b>${habit.countTarget}</b>
          <button data-act="detail-target" data-step="1">+</button>
        </span>
      </div>` : ""}

      <div style="height:1px;background:var(--line);margin:16px -16px"></div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <div style="font-size:13.5px">Reminder</div>
          <div class="hint" style="font-size:11.5px;color:var(--dim);margin-top:3px">${escapeHtml(describe(reminder))}</div>
        </div>
        <button class="switch${reminder.enabled ? " on" : ""}" data-act="detail-rem-toggle" aria-pressed="${!!reminder.enabled}"><i></i></button>
      </div>

      ${reminder.enabled ? `
      <div class="seg" style="margin-top:12px">
        <button class="${reminder.repeat === "daily" ? "on" : ""}" data-act="detail-rem-repeat" data-repeat="daily">Every day</button>
        <button class="${reminder.repeat === "weekdays" ? "on" : ""}" data-act="detail-rem-repeat" data-repeat="weekdays">Weekdays</button>
        <button class="${reminder.repeat === "custom" ? "on" : ""}" data-act="detail-rem-repeat" data-repeat="custom">Custom</button>
      </div>
      ${reminder.repeat === "custom" ? `<div class="days">${dayButtons}</div>` : ""}
      <div class="inline-row">
        <span class="lab">Time</span>
        <input type="time" value="${escapeHtml(reminder.time)}" data-act="detail-rem-time">
      </div>` : ""}
    </div>

    <div class="btn-row">
      <button class="btn" data-act="edit" data-habit="${habit.id}">Edit habit</button>
      <button class="btn danger" data-act="delete" data-habit="${habit.id}">Delete</button>
    </div>
  `;
}
