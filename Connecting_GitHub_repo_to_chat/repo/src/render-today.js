"use strict";

import { state } from "./state.js";
import { escapeHtml, habitMark } from "./utils.js";
import { getCategoryById } from "./persistence.js";
import { habitsForDate, getValue, isDone, targetOf, streakOf } from "./habits.js";

export function todayParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate(), now };
}

function rowHtml(habit, y, m, d) {
  const value = getValue(habit, y, m, d);
  const target = targetOf(habit);
  const done = value >= target;
  const cat = getCategoryById(habit.categoryId);
  const streak = streakOf(habit);
  const meta = [];
  if (cat) meta.push(`<span>${escapeHtml(cat.name)}</span>`);
  meta.push(`<span class="mono">${streak > 0 ? `${streak}d streak` : "no streak"}</span>`);
  if (habit.reminder && habit.reminder.enabled) {
    meta.push(`<span class="mono">${escapeHtml(habit.reminder.time)}</span>`);
  }

  const control = habit.trackType === "count"
    ? `<button class="count${done ? " on" : ""}" data-act="tap" data-habit="${habit.id}" aria-label="${escapeHtml(habit.name)}: ${value} of ${target}">${value}/${target}</button>`
    : `<button class="check${done ? " on" : ""}" data-act="tap" data-habit="${habit.id}" aria-pressed="${done}" aria-label="${escapeHtml(habit.name)}">
         <svg viewBox="0 0 24 24" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"></path></svg>
       </button>`;

  return `<div class="row${done ? " is-done" : ""}">
    <button class="row-main" data-act="open" data-habit="${habit.id}">
      <span class="mark">${escapeHtml(habitMark(habit.name))}</span>
      <span style="flex:1;min-width:0">
        <span class="row-name" style="display:block">${escapeHtml(habit.name)}</span>
        <span class="row-meta">${meta.join('<span class="dot">·</span>')}</span>
      </span>
    </button>
    ${control}
  </div>`;
}

export function renderToday() {
  const { year, month, day, now } = todayParts();
  const habits = habitsForDate(year, month, day);
  const done = habits.filter((h) => isDone(h, year, month, day)).length;
  const pct = habits.length ? Math.round((done / habits.length) * 100) : 0;
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  const date = now.toLocaleDateString(undefined, { day: "numeric", month: "long" });

  const list = habits.length
    ? habits.map((h) => rowHtml(h, year, month, day)).join("")
    : `<p class="empty">Nothing scheduled today.<br>Add a habit to get started.</p>`;

  return `
    <div class="today-head">
      <div>
        <div class="eyebrow">${escapeHtml(weekday)}</div>
        <h1 class="h1">${escapeHtml(date)}</h1>
      </div>
      <div class="today-pct">${pct}%<small>${done} of ${habits.length} done</small></div>
    </div>
    <div class="progress"><i style="width:${pct}%"></i></div>
    <div class="section-head">
      <span class="eyebrow">Today</span>
      <span style="font-size:11px;color:var(--faint)">${state.habits.daily.length} habit${state.habits.daily.length === 1 ? "" : "s"}</span>
    </div>
    ${list}
    <button class="add" data-act="add">Add habit</button>
  `;
}
