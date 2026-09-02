"use strict";

// The two overlays in the app: the add/edit habit bottom sheet, and a confirm
// dialog.
//
// The sheet edits a draft (globals.habitDraft) and only writes on Save, so
// backing out with the scrim or Cancel leaves the habit untouched. The detail
// screen is the opposite -- it writes through immediately -- which is why the
// two are separate surfaces rather than one shared form.

import { DEFAULT_CATEGORIES, REMINDER_REPEATS, WEEKDAY_LABELS } from "./constants.js";
import { state, globals } from "./state.js";
import { uid, sanitize } from "./utils.js";
import { deriveHabitMark, saveState } from "./persistence.js";
import { deleteHabit, getHabitTarget, updateHabitOrder } from "./habits.js";
import { callRenderer, registerRenderer } from "./render-registry.js";
import { getWeekStart } from "./ui-prefs.js";
import { lockBodyScroll, unlockBodyScroll, trapWithin, releaseTrap } from "./sheet.js";

const SCHEDULES = [
  ["daily", "Every day"],
  ["weekdays", "Weekdays"],
  ["custom", "Custom"],
];

function weekdayOrder() {
  return getWeekStart() === "sunday"
    ? [0, 1, 2, 3, 4, 5, 6]
    : [1, 2, 3, 4, 5, 6, 0];
}

/* ------------------------------------------------------------------- open */

function draftFromHabit(habit) {
  if (!habit) {
    return {
      id: null,
      name: "",
      cue: "",
      categoryId: (state.categories[0] || DEFAULT_CATEGORIES[0]).id,
      trackType: "check",
      countTarget: 3,
      schedule: "daily",
      days: [1, 3, 5],
      monthGoal: 26,
      reminder: { enabled: false, repeat: "daily", days: [], time: "08:00" },
    };
  }
  const mode = habit.scheduleMode;
  const schedule =
    mode === "specific_weekdays"
      ? habit.activeWeekdays.length === 5 &&
        [1, 2, 3, 4, 5].every((d) => habit.activeWeekdays.includes(d))
        ? "weekdays"
        : "custom"
      : "daily";
  return {
    id: habit.id,
    name: habit.name,
    cue: habit.cue || "",
    categoryId: habit.categoryId,
    trackType: habit.trackType === "count" ? "count" : "check",
    countTarget: getHabitTarget(habit) > 1 ? getHabitTarget(habit) : 3,
    schedule,
    days: habit.activeWeekdays.slice(),
    monthGoal: Math.max(1, parseInt(habit.monthGoal, 10) || 26),
    reminder: Object.assign(
      { enabled: false, repeat: "daily", days: [], time: "08:00" },
      habit.reminder,
    ),
  };
}

export function openHabitSheet(habitId) {
  const habit = habitId
    ? state.habits.daily.find((h) => h.id === habitId) || null
    : null;
  globals.habitDraft = draftFromHabit(habit);

  const overlay = document.getElementById("habitSheet");
  const title = document.getElementById("habitSheetTitle");
  if (title) title.textContent = habit ? "Edit habit" : "New habit";
  if (!overlay) return;
  overlay.classList.add("open");
  lockBodyScroll();
  renderHabitSheet();
  trapWithin(overlay);
  const nameInput = document.getElementById("draftName");
  if (nameInput && !habit) nameInput.focus();
}

export function closeHabitSheet() {
  const overlay = document.getElementById("habitSheet");
  if (!overlay) return;
  overlay.classList.remove("open");
  releaseTrap();
  unlockBodyScroll();
  globals.habitDraft = null;
}

/* ----------------------------------------------------------------- markup */

function reminderPreview(d) {
  const r = d.reminder;
  if (!r.enabled) return "";
  if (r.repeat === "daily") return `Every day · ${r.time} · ${d.name.trim() || "this habit"}`;
  if (r.repeat === "weekdays")
    return `Weekdays · ${r.time} · ${d.name.trim() || "this habit"}`;
  const days = (r.days || [])
    .slice()
    .sort((a, b) => a - b)
    .map((i) => WEEKDAY_LABELS[i])
    .join(" ");
  return `${days || "No days"} · ${r.time} · ${d.name.trim() || "this habit"}`;
}

export function renderHabitSheet() {
  const body = document.getElementById("habitSheetBody");
  const d = globals.habitDraft;
  if (!body || !d) return;

  const cats = state.categories.length ? state.categories : DEFAULT_CATEGORIES;

  let html =
    '<div class="section-label field-label">Name</div>' +
    `<input id="draftName" class="text-input" type="text" value="${sanitize(d.name)}" placeholder="e.g. Evening walk" />` +
    // The implementation intention. Naming the cue and the place -- "after X,
    // I will do Y, in Z" -- is the best-evidenced single thing a habit app can
    // ask a user to write down, and it costs one optional field.
    '<div class="section-label field-label">When and where <span class="field-optional">optional</span></div>' +
    `<textarea id="draftCue" class="text-input note-input" rows="2" placeholder="After I pour my morning coffee, I will read in the kitchen">${sanitize(d.cue)}</textarea>` +
    '<div class="field-hint">Habits stick to a moment you already have. Naming one makes it far more likely to happen — and it becomes the reminder text.</div>' +
    '<div class="section-label field-label">Category</div>' +
    '<div class="chip-row">' +
    cats
      .map(
        (c) =>
          `<button type="button" class="chip${c.id === d.categoryId ? " is-on" : ""}" data-cat="${sanitize(c.id)}">${sanitize(c.name)}</button>`,
      )
      .join("") +
    "</div>" +
    '<div class="section-label field-label">Tracking</div>' +
    '<div class="segmented">' +
    `<button type="button" data-draft-track="check" class="${d.trackType === "check" ? "is-active" : ""}">Done / not done</button>` +
    `<button type="button" data-draft-track="count" class="${d.trackType === "count" ? "is-active" : ""}">Count</button>` +
    "</div>";

  if (d.trackType === "count") {
    html +=
      '<div class="boxed-row">' +
      '<div class="boxed-row-label">Target per day</div>' +
      '<div class="stepper">' +
      '<button type="button" data-draft-target="-1" aria-label="Decrease target">−</button>' +
      `<div class="stepper-value">${d.countTarget}</div>` +
      '<button type="button" data-draft-target="1" aria-label="Increase target">+</button>' +
      "</div></div>";
  }

  html +=
    '<div class="section-label field-label">Schedule</div>' +
    '<div class="segmented">' +
    SCHEDULES.map(
      ([key, label]) =>
        `<button type="button" data-draft-schedule="${key}" class="${d.schedule === key ? "is-active" : ""}">${label}</button>`,
    ).join("") +
    "</div>";

  if (d.schedule === "custom") {
    html +=
      '<div class="day-toggles">' +
      weekdayOrder()
        .map((day) => {
          const on = d.days.includes(day);
          return `<button type="button" data-draft-day="${day}" class="${on ? "is-on" : ""}" aria-pressed="${on}">${sanitize(WEEKDAY_LABELS[day][0])}</button>`;
        })
        .join("") +
      "</div>";
  }

  html +=
    '<div class="row-split" style="margin-top:20px">' +
    '<div class="section-label">Reminder</div>' +
    `<button type="button" class="toggle${d.reminder.enabled ? " is-on" : ""}" data-draft-reminder` +
    ` role="switch" aria-checked="${d.reminder.enabled}" aria-label="Reminder"><span></span></button>` +
    "</div>";

  if (d.reminder.enabled) {
    html +=
      '<div class="segmented" style="margin-top:8px">' +
      REMINDER_REPEATS.map((key) => {
        const label =
          key === "daily" ? "Every day" : key === "weekdays" ? "Weekdays" : "Custom";
        return `<button type="button" data-draft-repeat="${key}" class="${d.reminder.repeat === key ? "is-active" : ""}">${label}</button>`;
      }).join("") +
      "</div>";

    if (d.reminder.repeat === "custom") {
      html +=
        '<div class="day-toggles">' +
        weekdayOrder()
          .map((day) => {
            const on = (d.reminder.days || []).includes(day);
            return `<button type="button" data-draft-reminder-day="${day}" class="${on ? "is-on" : ""}" aria-pressed="${on}">${sanitize(WEEKDAY_LABELS[day][0])}</button>`;
          })
          .join("") +
        "</div>";
    }

    html +=
      '<div class="boxed-row">' +
      '<div class="boxed-row-label">Time</div>' +
      `<input type="time" id="draftReminderTime" value="${sanitize(d.reminder.time)}" aria-label="Reminder time" />` +
      "</div>" +
      `<div class="sheet-preview">${sanitize(reminderPreview(d))}</div>`;
  }

  html +=
    '<div class="boxed-row" style="margin-top:20px">' +
    '<div class="boxed-row-label">Monthly goal</div>' +
    '<div class="stepper">' +
    '<button type="button" data-draft-goal="-1" aria-label="Decrease goal">−</button>' +
    `<div class="stepper-value">${d.monthGoal}</div>` +
    '<button type="button" data-draft-goal="1" aria-label="Increase goal">+</button>' +
    "</div></div>";

  // The design has no delete affordance, but the app has always had one and
  // dropping it would strand existing habits. Edit mode gets it; Add does not.
  if (d.id) {
    html +=
      '<button type="button" class="btn btn-danger" style="width:100%;margin-top:14px"' +
      " data-sheet-delete>Delete habit</button>";
  }

  const canSave = d.name.trim().length > 0;
  html +=
    '<div class="sheet-actions">' +
    '<button type="button" class="btn btn-ghost" data-sheet-cancel>Cancel</button>' +
    `<button type="button" class="btn btn-primary" data-sheet-save${canSave ? "" : " disabled"}>` +
    `${d.id ? "Save changes" : "Save habit"}</button>` +
    "</div>";

  body.innerHTML = html;
}

/* ------------------------------------------------------------------- save */

function saveDraft() {
  const d = globals.habitDraft;
  if (!d) return;
  const name = d.name.trim();
  if (!name) return;

  const activeWeekdays =
    d.schedule === "daily"
      ? [0, 1, 2, 3, 4, 5, 6]
      : d.schedule === "weekdays"
        ? [1, 2, 3, 4, 5]
        : d.days.slice().sort((a, b) => a - b);

  const fields = {
    name,
    cue: String(d.cue || "").trim().slice(0, 200),
    categoryId: d.categoryId,
    trackType: d.trackType,
    countTarget: d.trackType === "count" ? d.countTarget : 1,
    monthGoal: d.monthGoal,
    scheduleMode: activeWeekdays.length === 7 ? "fixed" : "specific_weekdays",
    activeWeekdays: activeWeekdays.length ? activeWeekdays : [0, 1, 2, 3, 4, 5, 6],
    activeMonthDays: [],
    reminder: {
      enabled: !!d.reminder.enabled,
      repeat: d.reminder.repeat,
      days: (d.reminder.days || []).slice().sort((a, b) => a - b),
      time: d.reminder.time,
    },
    mark: deriveHabitMark(name),
  };

  if (d.id) {
    const habit = state.habits.daily.find((h) => h.id === d.id);
    if (habit) Object.assign(habit, fields);
  } else {
    state.habits.daily.push(
      Object.assign({ id: uid("dh"), order: state.habits.daily.length }, fields),
    );
    updateHabitOrder();
  }

  saveState();
  // The habit's reminder may have been added, changed or removed by this save,
  // and the notification text is built from its name and cue.
  callRenderer("rescheduleReminders");
  if (fields.reminder.enabled) callRenderer("requestReminderPermission");
  closeHabitSheet();
  callRenderer("renderAll");
}

/* ---------------------------------------------------------------- confirm */

export function openConfirm(title, message, onConfirm) {
  const overlay = document.getElementById("confirmDialog");
  if (!overlay) {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;
  globals.confirmCallback = onConfirm;
  overlay.classList.add("open");
  lockBodyScroll();
  trapWithin(overlay);
}

export function closeConfirm() {
  const overlay = document.getElementById("confirmDialog");
  if (!overlay) return;
  overlay.classList.remove("open");
  releaseTrap();
  unlockBodyScroll();
  globals.confirmCallback = null;
}

/** True if an overlay was open and has now been closed. Drives Escape and the
 *  Android back button. */
export function closeTopOverlay() {
  const confirmOpen = document
    .getElementById("confirmDialog")
    ?.classList.contains("open");
  if (confirmOpen) {
    closeConfirm();
    return true;
  }
  const sheetOpen = document
    .getElementById("habitSheet")
    ?.classList.contains("open");
  if (sheetOpen) {
    closeHabitSheet();
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------- binding */

export function bindOverlayEvents() {
  const sheet = document.getElementById("habitSheet");
  if (sheet) {
    sheet.addEventListener("click", (event) => {
      const d = globals.habitDraft;
      if (event.target.closest("#habitSheetScrim")) return closeHabitSheet();
      if (event.target.closest("[data-sheet-cancel]")) return closeHabitSheet();
      if (event.target.closest("[data-sheet-save]")) return saveDraft();
      if (event.target.closest("[data-sheet-delete]")) {
        return deleteHabit(d && d.id);
      }
      if (!d) return;

      const cat = event.target.closest("[data-cat]");
      if (cat) {
        d.categoryId = cat.dataset.cat;
        return renderHabitSheet();
      }
      const track = event.target.closest("[data-draft-track]");
      if (track) {
        d.trackType = track.dataset.draftTrack;
        return renderHabitSheet();
      }
      const target = event.target.closest("[data-draft-target]");
      if (target) {
        const delta = parseInt(target.dataset.draftTarget, 10);
        d.countTarget = Math.min(50, Math.max(2, d.countTarget + delta));
        return renderHabitSheet();
      }
      const schedule = event.target.closest("[data-draft-schedule]");
      if (schedule) {
        d.schedule = schedule.dataset.draftSchedule;
        return renderHabitSheet();
      }
      const day = event.target.closest("[data-draft-day]");
      if (day) {
        const value = parseInt(day.dataset.draftDay, 10);
        const at = d.days.indexOf(value);
        if (at >= 0) d.days.splice(at, 1);
        else d.days.push(value);
        return renderHabitSheet();
      }
      if (event.target.closest("[data-draft-reminder]")) {
        d.reminder.enabled = !d.reminder.enabled;
        return renderHabitSheet();
      }
      const repeat = event.target.closest("[data-draft-repeat]");
      if (repeat) {
        d.reminder.repeat = repeat.dataset.draftRepeat;
        return renderHabitSheet();
      }
      const rDay = event.target.closest("[data-draft-reminder-day]");
      if (rDay) {
        const value = parseInt(rDay.dataset.draftReminderDay, 10);
        const days = d.reminder.days || (d.reminder.days = []);
        const at = days.indexOf(value);
        if (at >= 0) days.splice(at, 1);
        else days.push(value);
        return renderHabitSheet();
      }
      const goal = event.target.closest("[data-draft-goal]");
      if (goal) {
        const delta = parseInt(goal.dataset.draftGoal, 10);
        d.monthGoal = Math.min(31, Math.max(1, d.monthGoal + delta));
        return renderHabitSheet();
      }
    });

    // input, not change: the Save button enables as soon as there is a name.
    sheet.addEventListener("input", (event) => {
      const d = globals.habitDraft;
      if (!d) return;
      if (event.target.id === "draftName") {
        d.name = event.target.value;
        const save = sheet.querySelector("[data-sheet-save]");
        if (save) save.disabled = !d.name.trim();
      }
      if (event.target.id === "draftCue") {
        d.cue = event.target.value;
      }
      if (event.target.id === "draftReminderTime") {
        d.reminder.time = event.target.value;
        const preview = sheet.querySelector(".sheet-preview");
        if (preview) preview.textContent = reminderPreview(d);
      }
    });
  }

  const confirm = document.getElementById("confirmDialog");
  if (confirm) {
    confirm.addEventListener("click", (event) => {
      if (event.target.closest("#confirmCancel")) return closeConfirm();
      if (event.target.closest("#confirmOk")) {
        const cb = globals.confirmCallback;
        closeConfirm();
        if (typeof cb === "function") cb();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTopOverlay();
  });
}

registerRenderer("openConfirm", openConfirm);
registerRenderer("openHabitSheet", openHabitSheet);
registerRenderer("closeHabitSheet", closeHabitSheet);
