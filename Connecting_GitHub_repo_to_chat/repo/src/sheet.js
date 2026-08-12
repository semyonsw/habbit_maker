"use strict";

import { WEEKDAY_LABELS, DEFAULT_REMINDER } from "./constants.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { getHabitById, upsertHabit } from "./habits.js";
import { describe, rescheduleAll, requestPermission } from "./reminders.js";
import { callRenderer } from "./render-registry.js";

let draft = null;

function blankDraft() {
  return {
    id: null,
    name: "",
    categoryId: state.categories[0] ? state.categories[0].id : "",
    trackType: "check",
    countTarget: 3,
    scheduleMode: "fixed",
    activeWeekdays: [1, 2, 3, 4, 5],
    monthGoal: 26,
    reminder: { ...DEFAULT_REMINDER, enabled: true },
  };
}

export function openHabitSheet(habitId) {
  const habit = habitId ? getHabitById(habitId) : null;
  draft = habit
    ? {
        id: habit.id,
        name: habit.name,
        categoryId: habit.categoryId,
        trackType: habit.trackType,
        countTarget: habit.countTarget > 1 ? habit.countTarget : 3,
        scheduleMode: habit.scheduleMode,
        activeWeekdays: (habit.activeWeekdays || [1, 2, 3, 4, 5]).slice(),
        monthGoal: habit.monthGoal,
        reminder: { ...habit.reminder },
      }
    : blankDraft();
  document.getElementById("sheetRoot").hidden = false;
  renderSheet();
}

export function closeHabitSheet() {
  draft = null;
  document.getElementById("sheetRoot").hidden = true;
  document.getElementById("sheet").innerHTML = "";
}

function renderSheet() {
  const el = document.getElementById("sheet");
  if (!el || !draft) return;
  const isCount = draft.trackType === "count";
  const r = draft.reminder;
  const dayRow = (act, selected) => [1, 2, 3, 4, 5, 6, 0]
    .map((i) => `<button class="${selected.includes(i) ? "on" : ""}" data-act="${act}" data-day="${i}">${WEEKDAY_LABELS[i][0]}</button>`)
    .join("");

  el.innerHTML = `
    <div class="sheet-grip"></div>
    <div class="sheet-title">${draft.id ? "Edit habit" : "New habit"}</div>

    <div class="eyebrow sheet-label">Name</div>
    <input class="field" id="sheetName" value="${escapeHtml(draft.name)}" placeholder="e.g. Evening walk" autocomplete="off">

    <div class="eyebrow sheet-label">Category</div>
    <div class="chips">
      ${state.categories.map((c) => `<button class="${c.id === draft.categoryId ? "on" : ""}" data-act="sheet-cat" data-cat="${c.id}">${escapeHtml(c.name)}</button>`).join("")}
    </div>

    <div class="eyebrow sheet-label">Tracking</div>
    <div class="seg">
      <button class="${isCount ? "" : "on"}" data-act="sheet-type" data-type="check">Done / not done</button>
      <button class="${isCount ? "on" : ""}" data-act="sheet-type" data-type="count">Count</button>
    </div>
    ${isCount ? `
    <div class="inline-row">
      <span class="lab">Target per day</span>
      <span class="stepper">
        <button data-act="sheet-target" data-step="-1">−</button><b>${draft.countTarget}</b><button data-act="sheet-target" data-step="1">+</button>
      </span>
    </div>` : ""}

    <div class="eyebrow sheet-label">Schedule</div>
    <div class="seg">
      <button class="${draft.scheduleMode === "fixed" ? "on" : ""}" data-act="sheet-schedule" data-mode="fixed">Every day</button>
      <button class="${draft.scheduleMode === "specific_weekdays" ? "on" : ""}" data-act="sheet-schedule" data-mode="specific_weekdays">Chosen days</button>
    </div>
    ${draft.scheduleMode === "specific_weekdays" ? `<div class="days">${dayRow("sheet-day", draft.activeWeekdays)}</div>` : ""}

    <div class="eyebrow sheet-label flex">
      <span>Reminder</span>
      <button class="switch${r.enabled ? " on" : ""}" data-act="sheet-rem-toggle" aria-pressed="${!!r.enabled}"><i></i></button>
    </div>
    ${r.enabled ? `
    <div class="seg">
      <button class="${r.repeat === "daily" ? "on" : ""}" data-act="sheet-rem-repeat" data-repeat="daily">Every day</button>
      <button class="${r.repeat === "weekdays" ? "on" : ""}" data-act="sheet-rem-repeat" data-repeat="weekdays">Weekdays</button>
      <button class="${r.repeat === "custom" ? "on" : ""}" data-act="sheet-rem-repeat" data-repeat="custom">Custom</button>
    </div>
    ${r.repeat === "custom" ? `<div class="days">${dayRow("sheet-rem-day", r.days || [])}</div>` : ""}
    <div class="inline-row">
      <span class="lab">Time</span>
      <input type="time" value="${escapeHtml(r.time)}" data-act="sheet-rem-time">
    </div>
    <p class="preview">${escapeHtml(describe(r))} · ${escapeHtml(draft.name.trim() || "this habit")}</p>` : ""}

    <div class="inline-row" style="margin-top:20px">
      <span class="lab">Monthly goal</span>
      <span class="stepper">
        <button data-act="sheet-goal" data-step="-1">−</button><b>${draft.monthGoal}</b><button data-act="sheet-goal" data-step="1">+</button>
      </span>
    </div>

    <div class="btn-row">
      <button class="btn ghost" data-act="sheet-close">Cancel</button>
      <button class="btn primary" data-act="sheet-save" ${draft.name.trim() ? "" : "disabled"}>${draft.id ? "Save changes" : "Save habit"}</button>
    </div>
  `;

  const name = document.getElementById("sheetName");
  if (name) {
    name.oninput = () => {
      draft.name = name.value;
      const save = el.querySelector('[data-act="sheet-save"]');
      if (save) save.disabled = !draft.name.trim();
      const preview = el.querySelector(".preview");
      if (preview) preview.textContent = `${describe(draft.reminder)} · ${draft.name.trim() || "this habit"}`;
    };
  }
  const time = el.querySelector('[data-act="sheet-rem-time"]');
  if (time) time.onchange = () => { draft.reminder.time = time.value || "08:00"; renderSheet(); };
}

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : list.concat([value]);
}

// Returns true when the action belonged to the sheet.
export function handleSheetAction(act, el) {
  if (!draft && act !== "add" && act !== "edit") return false;
  switch (act) {
    case "sheet-close": closeHabitSheet(); return true;
    case "sheet-cat": draft.categoryId = el.dataset.cat; renderSheet(); return true;
    case "sheet-type": draft.trackType = el.dataset.type === "count" ? "count" : "check"; renderSheet(); return true;
    case "sheet-target":
      draft.countTarget = Math.max(2, Math.min(99, draft.countTarget + Number(el.dataset.step)));
      renderSheet(); return true;
    case "sheet-schedule": draft.scheduleMode = el.dataset.mode; renderSheet(); return true;
    case "sheet-day": draft.activeWeekdays = toggle(draft.activeWeekdays, Number(el.dataset.day)); renderSheet(); return true;
    case "sheet-goal":
      draft.monthGoal = Math.max(1, Math.min(31, draft.monthGoal + Number(el.dataset.step)));
      renderSheet(); return true;
    case "sheet-rem-toggle":
      draft.reminder.enabled = !draft.reminder.enabled;
      if (draft.reminder.enabled) requestPermission();
      renderSheet(); return true;
    case "sheet-rem-repeat": draft.reminder.repeat = el.dataset.repeat; renderSheet(); return true;
    case "sheet-rem-day": draft.reminder.days = toggle(draft.reminder.days || [], Number(el.dataset.day)); renderSheet(); return true;
    case "sheet-save": {
      if (!draft.name.trim()) return true;
      upsertHabit(draft);
      closeHabitSheet();
      rescheduleAll();
      callRenderer("render");
      return true;
    }
    default: return false;
  }
}
