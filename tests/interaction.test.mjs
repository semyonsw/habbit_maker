// End-to-end interaction tests.
//
// These bind the app's real event handlers to the real index.html and then
// click things, the way a person does. `click()` in dom.mjs refuses to
// dispatch on anything a browser would not route a pointer event to -- inert
// or disabled -- so a control that renders but cannot be used fails here.
//
// That distinction is the whole reason this file exists. The render tests were
// green while "Add habit" opened a sheet that could not be touched, because
// asserting that markup EXISTS says nothing about whether it WORKS.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, click, setValue, isInert, whyNotInteractive } from "./dom.mjs";

installDom();

// The module namespace, not a destructure: `state` is reassigned by setState()
// and a destructured copy would freeze at its import-time value (null).
const S = await import("../src/state.js");
const { setState, globals } = S;
const { getDefaultState, migrateState, getDefaultMonthData } = await import(
  "../src/persistence.js"
);
const { bindEvents } = await import("../src/events.js");
const { initRouter } = await import("../src/router.js");
const { renderAll, switchView } = await import("../src/render-shell.js");
const { getSortedDailyHabits, getDayCounts, isHabitSkippedOn } = await import(
  "../src/habits.js"
);
const { getCurrentMonthData } = await import("../src/persistence.js");
const { SKIPPED } = await import("../src/constants.js");
const { closeConfirm, closeHabitSheet } = await import("../src/modals.js");
const { getTheme, getWeekStart, getDailyReminder, getFadeReminders } =
  await import("../src/ui-prefs.js");

// Registers the render functions and the reminder renderers.
await import("../src/render-today.js");
await import("../src/render-detail.js");
await import("../src/render-analytics.js");
await import("../src/render-settings.js");
await import("../src/notifications.js");

document.getElementById("app").style.display = "";
bindEvents();
initRouter();

const TODAY = new Date();
const TODAY_DAY = TODAY.getDate();

function reset() {
  setState(getDefaultState());
  migrateState();
  globals.dayFocusDay = null;
  globals.detailHabitId = null;
  globals.habitDraft = null;
  globals.analyticsYear = null;
  // Close anything a previous test left open, through the app's own close
  // paths, so the scroll lock and focus trap unwind exactly as they do in use.
  closeConfirm();
  closeHabitSheet();
  window.history.exited = false;
  window.location.hash = "#/today";
  switchView("today");
  renderAll();
}

beforeEach(reset);

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ====================================================================== */
/* The reported bug                                                       */
/* ====================================================================== */

test("Add habit opens a sheet whose controls can actually be used", () => {
  click($("#btnAddHabit"), "#btnAddHabit");

  const overlay = $("#habitSheet");
  assert.ok(overlay.classList.contains("open"), "the sheet opened");

  // The regression. trapWithin() used to inert every child of <body>, and the
  // overlay lives inside #app, so the sheet inerted itself: it rendered, the
  // scrim was up, body scroll was locked, and nothing inside could be touched.
  assert.equal(
    isInert(overlay),
    false,
    `the sheet must not be inert -- ${whyNotInteractive(overlay)}`,
  );

  const name = $("#draftName");
  assert.ok(name, "the name field rendered");
  assert.equal(whyNotInteractive(name), null, "the name field is reachable");

  const save = $("[data-sheet-save]");
  const cancel = $("[data-sheet-cancel]");
  assert.equal(whyNotInteractive(cancel), null, "Cancel is reachable");
  assert.ok(save.disabled, "Save starts disabled with an empty name");
});

test("everything outside the open sheet IS inert", () => {
  click($("#btnAddHabit"), "#btnAddHabit");
  assert.ok(isInert($(".app-main")), "the screen behind is trapped out");
  assert.ok(isInert($(".bottom-nav")), "the nav is trapped out");
  assert.ok(isInert($("#confirmDialog")), "the other overlay is trapped out");
});

test("a habit can be created end to end", () => {
  const before = getSortedDailyHabits().length;

  click($("#btnAddHabit"), "#btnAddHabit");
  setValue($("#draftName"), "Evening walk", "input", "name");
  setValue(
    $("#draftCue"),
    "After dinner, I will walk around the block",
    "input",
    "cue",
  );

  const save = $("[data-sheet-save]");
  assert.equal(save.disabled, false, "Save enables once there is a name");
  click(save, "Save");

  assert.equal($("#habitSheet").classList.contains("open"), false, "sheet closed");
  const habits = getSortedDailyHabits();
  assert.equal(habits.length, before + 1);
  const created = habits[habits.length - 1];
  assert.equal(created.name, "Evening walk");
  assert.equal(created.cue, "After dinner, I will walk around the block");
  assert.equal(created.mark, "EW", "the two-letter mark is derived");

  // And the trap is released, so the app is usable again.
  assert.equal(isInert($(".app-main")), false, "the screen is live again");
  assert.equal(isInert($(".bottom-nav")), false);
  assert.ok(
    $("#todayList").innerHTML.includes("Evening walk"),
    "the new habit is on Today",
  );
});

test("Cancel closes the sheet and writes nothing", () => {
  const before = getSortedDailyHabits().length;
  click($("#btnAddHabit"), "#btnAddHabit");
  setValue($("#draftName"), "Should not exist", "input", "name");
  click($("[data-sheet-cancel]"), "Cancel");

  assert.equal($("#habitSheet").classList.contains("open"), false);
  assert.equal(getSortedDailyHabits().length, before);
  assert.equal(isInert($(".app-main")), false, "the trap was released");
});

test("the scrim dismisses the sheet", () => {
  click($("#btnAddHabit"), "#btnAddHabit");
  click($("#habitSheetScrim"), "scrim");
  assert.equal($("#habitSheet").classList.contains("open"), false);
  assert.equal(isInert($(".app-main")), false);
});

/* ====================================================================== */
/* Every control in the new-habit sheet                                   */
/* ====================================================================== */

test("every control in the sheet is reachable and does something", () => {
  click($("#btnAddHabit"), "#btnAddHabit");
  setValue($("#draftName"), "Test", "input", "name");

  // Category
  const cats = $$("[data-cat]");
  assert.ok(cats.length >= 2, "categories render");
  click(cats[2], "category chip");
  assert.equal(globals.habitDraft.categoryId, cats[2].dataset.cat);

  // Tracking type -> reveals the target stepper
  click($('[data-draft-track="count"]'), "Count");
  assert.equal(globals.habitDraft.trackType, "count");
  const plus = $('[data-draft-target="1"]');
  assert.ok(plus, "the target stepper appears for a count habit");
  const targetBefore = globals.habitDraft.countTarget;
  click(plus, "target +");
  assert.equal(globals.habitDraft.countTarget, targetBefore + 1);
  click($('[data-draft-target="-1"]'), "target -");
  assert.equal(globals.habitDraft.countTarget, targetBefore);

  // Schedule -> reveals the weekday toggles
  click($('[data-draft-schedule="custom"]'), "Custom schedule");
  const dayToggles = $$("[data-draft-day]");
  assert.equal(dayToggles.length, 7, "seven weekday toggles");
  const day = dayToggles[0];
  const wasOn = globals.habitDraft.days.includes(
    parseInt(day.dataset.draftDay, 10),
  );
  click(day, "weekday toggle");
  assert.notEqual(
    globals.habitDraft.days.includes(parseInt(day.dataset.draftDay, 10)),
    wasOn,
    "the weekday toggled",
  );

  // Reminder -> reveals repeat + time
  click($("[data-draft-reminder]"), "reminder toggle");
  assert.equal(globals.habitDraft.reminder.enabled, true);
  click($('[data-draft-repeat="weekdays"]'), "Weekdays");
  assert.equal(globals.habitDraft.reminder.repeat, "weekdays");
  click($('[data-draft-repeat="custom"]'), "Custom repeat");
  const rDays = $$("[data-draft-reminder-day]");
  assert.equal(rDays.length, 7, "seven reminder-day toggles");
  click(rDays[1], "reminder day");
  assert.ok(globals.habitDraft.reminder.days.length > 0);
  setValue($("#draftReminderTime"), "07:30", "input", "reminder time");
  assert.equal(globals.habitDraft.reminder.time, "07:30");

  // Monthly goal
  const goalBefore = globals.habitDraft.monthGoal;
  click($('[data-draft-goal="1"]'), "goal +");
  assert.equal(globals.habitDraft.monthGoal, goalBefore + 1);

  // And it saves.
  click($("[data-sheet-save]"), "Save");
  assert.equal($("#habitSheet").classList.contains("open"), false);
  const created = getSortedDailyHabits().find((h) => h.name === "Test");
  assert.ok(created, "the habit was created");
  assert.equal(created.trackType, "count");
  assert.equal(created.reminder.enabled, true);
  assert.equal(created.reminder.time, "07:30");
});

test("editing an existing habit loads it and saves back", () => {
  const target = getSortedDailyHabits()[0];
  globals.detailHabitId = target.id;
  switchView("detail");

  click($("[data-detail-edit]"), "Edit habit");
  assert.ok($("#habitSheet").classList.contains("open"));
  assert.equal(isInert($("#habitSheet")), false, "the edit sheet is usable");
  assert.equal($("#draftName").value, target.name, "prefilled with the habit");

  setValue($("#draftName"), "Renamed", "input", "name");
  click($("[data-sheet-save]"), "Save");
  assert.equal(getSortedDailyHabits()[0].name, "Renamed");
});

/* ====================================================================== */
/* Confirm dialog -- same trap, same bug                                  */
/* ====================================================================== */

test("the delete confirmation is usable and actually deletes", () => {
  const target = getSortedDailyHabits()[0];
  const before = getSortedDailyHabits().length;

  globals.detailHabitId = target.id;
  switchView("detail");
  click($("[data-detail-edit]"), "Edit habit");
  click($("[data-sheet-delete]"), "Delete habit");

  const dialog = $("#confirmDialog");
  assert.ok(dialog.classList.contains("open"), "the confirm dialog opened");
  assert.equal(
    isInert(dialog),
    false,
    `the dialog must be usable -- ${whyNotInteractive(dialog)}`,
  );
  assert.ok(isInert($("#habitSheet")), "the sheet underneath is trapped out");

  click($("#confirmOk"), "Confirm");
  assert.equal(getSortedDailyHabits().length, before - 1);
  assert.equal(
    getSortedDailyHabits().some((h) => h.id === target.id),
    false,
  );
  assert.equal(isInert($(".app-main")), false, "everything is released");
});

test("deleting from the detail screen lands on Today and stays there", () => {
  const target = getSortedDailyHabits()[0];
  globals.detailHabitId = target.id;
  window.location.hash = "#/detail";
  switchView("detail");

  click($("[data-detail-edit]"), "Edit habit");
  click($("[data-sheet-delete]"), "Delete habit");
  click($("#confirmOk"), "Confirm");

  assert.equal(window.location.hash, "#/today", "navigated to Today");
  assert.ok($("#view-today").classList.contains("active"));
  assert.equal($("#habitSheet").classList.contains("open"), false);
  assert.equal($("#confirmDialog").classList.contains("open"), false);
  assert.equal(isInert($(".app-main")), false, "and the app is usable");
  assert.equal(
    document.body.classList.contains("is-modal-open"),
    false,
    "scrolling is unlocked",
  );
});

test("cancelling the confirmation leaves the sheet behind it usable", () => {
  const target = getSortedDailyHabits()[0];
  const before = getSortedDailyHabits().length;

  globals.detailHabitId = target.id;
  switchView("detail");
  click($("[data-detail-edit]"), "Edit habit");
  click($("[data-sheet-delete]"), "Delete habit");
  click($("#confirmCancel"), "Cancel");

  assert.equal(getSortedDailyHabits().length, before, "nothing was deleted");
  assert.ok($("#habitSheet").classList.contains("open"), "the sheet is still up");
  assert.equal(
    isInert($("#habitSheet")),
    false,
    "and it is usable again, not left trapped out",
  );
  assert.equal(whyNotInteractive($("[data-sheet-cancel]")), null);
});

test("Reset all data goes through the confirm dialog", () => {
  switchView("settings");
  click($("[data-reset]"), "Reset all data");
  const dialog = $("#confirmDialog");
  assert.ok(dialog.classList.contains("open"));
  assert.equal(isInert(dialog), false, "the reset confirmation is usable");
  click($("#confirmCancel"), "Cancel");
  assert.equal(dialog.classList.contains("open"), false);
});

/* ====================================================================== */
/* Today                                                                  */
/* ====================================================================== */

test("tapping a habit checks it off, and tapping again clears it", () => {
  const habit = getSortedDailyHabits()[0];
  const control = $(`[data-advance="${habit.id}"]`);
  assert.equal(whyNotInteractive(control), null, "the checkbox is reachable");

  const before = getDayCounts(TODAY_DAY).done;
  click(control, "habit check");
  assert.equal(getDayCounts(TODAY_DAY).done, before + 1);

  click($(`[data-advance="${habit.id}"]`), "habit check again");
  assert.equal(getDayCounts(TODAY_DAY).done, before);
});

test("the day strip selects a day", () => {
  const chip = $$(".day-chip")[0];
  click(chip, "day chip 1");
  assert.equal(globals.dayFocusDay, 1);
  assert.ok($("#todayDate").textContent.startsWith("1 "));
});

test("tapping a habit name opens its detail screen", () => {
  const habit = getSortedDailyHabits()[0];
  click($(`[data-open="${habit.id}"]`), "habit row");
  assert.equal(globals.detailHabitId, habit.id);
});

test("month navigation moves back and returns", () => {
  const startMonth = S.state.currentMonth;
  const startYear = S.state.currentYear;

  click($("#todayMonthNav [data-month-step='-1']"), "previous month");
  assert.notEqual(
    `${S.state.currentYear}-${S.state.currentMonth}`,
    `${startYear}-${startMonth}`,
    "the viewed month moved",
  );

  // Forward is enabled again now that we are in the past.
  const forward = $("#todayMonthNav [data-month-step='1']");
  assert.equal(forward.disabled, false, "forward is available from the past");
  click(forward, "next month");
  assert.equal(S.state.currentMonth, startMonth);
  assert.equal(S.state.currentYear, startYear);

  // And forward is blocked at the present.
  assert.ok(
    $("#todayMonthNav [data-month-step='1']").disabled,
    "cannot navigate into the future",
  );
});

test("the Today shortcut returns from a past month", () => {
  click($("#todayMonthNav [data-month-step='-1']"), "previous month");
  const back = $("#todayMonthNav [data-month-today]");
  assert.equal(back.disabled, false, "the shortcut is offered when away");
  click(back, "Today");
  assert.equal(S.state.currentMonth, new Date().getMonth());
  assert.ok(
    $("#todayMonthNav [data-month-today]").disabled,
    "and is inert once you are back",
  );
});

/* ====================================================================== */
/* Detail                                                                 */
/* ====================================================================== */

test("the detail calendar cycles a day done -> skipped -> clear", () => {
  const habit = getSortedDailyHabits()[0];
  globals.detailHabitId = habit.id;
  globals.dayFocusDay = 1;
  switchView("detail");

  const cell = () => $('[data-cal-day="1"]');
  assert.equal(whyNotInteractive(cell()), null, "past days are tappable");

  click(cell(), "day 1");
  assert.ok(cell().classList.contains("is-complete"), "done");

  click(cell(), "day 1 again");
  assert.ok(cell().classList.contains("is-skipped"), "skipped");
  assert.ok(isHabitSkippedOn(habit, getCurrentMonthData(), 1));

  click(cell(), "day 1 a third time");
  assert.equal(cell().classList.contains("is-complete"), false);
  assert.equal(cell().classList.contains("is-skipped"), false, "cleared");
});

test("future calendar days are disabled, not silently ignored", () => {
  const habit = getSortedDailyHabits()[0];
  globals.detailHabitId = habit.id;
  switchView("detail");

  const total = new Date(
    S.state.currentYear,
    S.state.currentMonth + 1,
    0,
  ).getDate();
  if (TODAY_DAY < total) {
    const future = $$(".cal-cell").find(
      (c) => c.textContent.trim() === String(total),
    );
    assert.ok(future.disabled, "a future day is disabled");
    assert.equal(future.hasAttribute("data-cal-day"), false);
  }
});

test("the detail tracking and reminder controls all work", () => {
  const habit = getSortedDailyHabits()[0];
  globals.detailHabitId = habit.id;
  switchView("detail");

  click($('[data-track="count"]'), "Count");
  assert.equal(habit.trackType, "count");
  const t = habit.countTarget;
  click($('[data-target-step="1"]'), "target +");
  assert.equal(habit.countTarget, t + 1);

  click($("[data-reminder-toggle]"), "reminder on");
  assert.equal(habit.reminder.enabled, true);
  click($('[data-repeat="custom"]'), "custom repeat");
  assert.equal(habit.reminder.repeat, "custom");
  click($$("[data-reminder-day]")[2], "reminder day");
  assert.ok(habit.reminder.days.length > 0);
  setValue($("#detailReminderTime"), "06:15", "change", "reminder time");
  assert.equal(habit.reminder.time, "06:15");

  click($("[data-reminder-toggle]"), "reminder off");
  assert.equal(habit.reminder.enabled, false);
});

test("a note is saved against the selected day", () => {
  const habit = getSortedDailyHabits()[0];
  globals.detailHabitId = habit.id;
  globals.dayFocusDay = 1;
  switchView("detail");

  setValue($("#detailNote"), "was travelling", "change", "note");
  assert.equal(getCurrentMonthData().dailyNotes[habit.id][1], "was travelling");

  switchView("detail");
  assert.equal($("#detailNote").value, "was travelling", "and it reads back");
});

test("Back returns to Today", () => {
  const habit = getSortedDailyHabits()[0];
  globals.detailHabitId = habit.id;
  switchView("detail");
  click($("[data-detail-back]"), "Back");
  assert.equal(window.location.hash, "#/today");
});

/* ====================================================================== */
/* Analytics                                                              */
/* ====================================================================== */

test("the analytics year stepper is bounded by the data at both ends", () => {
  const thisYear = new Date().getFullYear();

  // With nothing recorded before this year there is nowhere to step back to,
  // and nothing after today either. Both chevrons are dead ends, and they say
  // so rather than walking you through empty calendars for ever.
  switchView("analytics");
  assert.ok($('[data-year-step="1"]').disabled, "no future year");
  assert.ok($('[data-year-step="-1"]').disabled, "no earlier year to show");

  // Give it a REAL record in the previous year and back opens up. An empty
  // month does not count -- that is what stops browsing from inventing history.
  const habitId = getSortedDailyHabits()[0].id;
  S.state.months[`${thisYear - 1}-06`] = Object.assign(getDefaultMonthData(), {
    dailyCompletions: { [habitId]: { 12: true } },
  });
  renderAll();
  const back = $('[data-year-step="-1"]');
  assert.equal(back.disabled, false, "an earlier record unlocks back");
  click(back, "previous year");
  assert.equal($(".year-nav-label").textContent, String(thisYear - 1));

  const forward = $('[data-year-step="1"]');
  assert.equal(forward.disabled, false);
  click(forward, "next year");
  assert.equal($(".year-nav-label").textContent, String(thisYear));
});

test("browsing months records nothing", () => {
  const before = Object.keys(S.state.months).length;
  for (let i = 0; i < 6; i += 1) {
    click($("#todayMonthNav [data-month-step='-1']"), "previous month");
  }
  assert.equal(
    Object.keys(S.state.months).length,
    before,
    "looking at a month must not create a record for it",
  );
  click($("#todayMonthNav [data-month-today]"), "Today");
});

test("filling in a past month DOES record it, and extends the floor", () => {
  click($("#todayMonthNav [data-month-step='-1']"), "previous month");
  const habit = getSortedDailyHabits()[0];
  const monthsBefore = Object.keys(S.state.months).length;

  click($(`[data-advance="${habit.id}"][data-day="1"]`), "day 1 of last month");
  assert.equal(
    Object.keys(S.state.months).length,
    monthsBefore + 1,
    "writing creates the month",
  );
  assert.equal(getDayCounts(1).done, 1);
});

test("month navigation stops at a floor instead of walking back for ever", () => {
  // 12 months of back-fill room from the earliest record, so entering last
  // week on a fresh install still works.
  let steps = 0;
  while (!$("#todayMonthNav [data-month-step='-1']").disabled && steps < 40) {
    click($("#todayMonthNav [data-month-step='-1']"), "previous month");
    steps += 1;
  }
  assert.ok(steps >= 11, `expected ~12 months of back-fill room, got ${steps}`);
  assert.ok(steps <= 13, `expected a floor near 12 months, walked ${steps}`);

  // The way home is always one tap.
  click($("#todayMonthNav [data-month-today]"), "Today");
  assert.equal(S.state.currentMonth, new Date().getMonth());
  assert.equal(S.state.currentYear, new Date().getFullYear());
});

test("analytics month navigation works", () => {
  switchView("analytics");
  const before = S.state.currentMonth;
  click($("#analyticsMonthNav [data-month-step='-1']"), "previous month");
  assert.notEqual(S.state.currentMonth, before);
});

/* ====================================================================== */
/* Settings                                                               */
/* ====================================================================== */

test("every settings control responds", () => {
  switchView("settings");

  click($('[data-theme-set="light"]'), "Light theme");
  assert.equal(getTheme(), "light");
  click($('[data-theme-set="dark"]'), "Dark theme");
  assert.equal(getTheme(), "dark");

  const week = getWeekStart();
  click($("[data-week-toggle]"), "Week starts on");
  assert.notEqual(getWeekStart(), week);

  const reminderWasOn = getDailyReminder().enabled;
  click($("[data-daily-reminder]"), "Daily reminder");
  assert.notEqual(getDailyReminder().enabled, reminderWasOn);
  // Enabling it reveals the time input.
  if (getDailyReminder().enabled) {
    setValue($("#dailyReminderTime"), "20:45", "change", "reminder time");
    assert.equal(getDailyReminder().time, "20:45");
  }

  const fade = getFadeReminders();
  click($("[data-fade-reminders]"), "Ease off automatically");
  assert.notEqual(getFadeReminders(), fade);
});

test("the bottom nav switches every view", () => {
  const views = ["analytics", "settings", "today"];
  views.forEach((view) => {
    const btn = $(`.nav-btn[data-view="${view}"]`);
    assert.equal(whyNotInteractive(btn), null, `${view} nav button reachable`);
    click(btn, `${view} nav`);
    assert.ok(
      $(`#view-${view}`).classList.contains("active"),
      `${view} became active`,
    );
  });
});

/* ====================================================================== */
/* The Android back button                                                */
/* ====================================================================== */

test("back closes the sheet instead of closing the app", () => {
  window.history.exited = false;
  click($("#btnAddHabit"), "#btnAddHabit");
  setValue($("#draftName"), "Half-written", "input", "name");

  window.history.back();

  assert.equal(
    window.history.exited,
    false,
    "the app must not exit with a sheet open -- that loses the draft",
  );
  assert.equal($("#habitSheet").classList.contains("open"), false, "sheet closed");
  assert.equal(isInert($(".app-main")), false, "and the app is usable");
  assert.ok($("#view-today").classList.contains("active"), "still on Today");
});

test("back peels one overlay at a time", () => {
  window.history.exited = false;
  const habit = getSortedDailyHabits()[0];
  globals.detailHabitId = habit.id;
  switchView("detail");
  click($("[data-detail-edit]"), "Edit habit");
  click($("[data-sheet-delete]"), "Delete habit");

  // First back: the confirm only.
  window.history.back();
  assert.equal($("#confirmDialog").classList.contains("open"), false, "dialog gone");
  assert.ok($("#habitSheet").classList.contains("open"), "sheet still open");
  assert.equal(
    isInert($("#habitSheet")),
    false,
    "and usable again, not left trapped out",
  );
  assert.equal(window.history.exited, false);

  // Second back: the sheet.
  window.history.back();
  assert.equal($("#habitSheet").classList.contains("open"), false, "sheet gone");
  assert.equal(window.history.exited, false, "still inside the app");
  assert.equal(getSortedDailyHabits().length > 0, true, "nothing was deleted");
});

test("closing by hand does not leave a dead history entry behind", () => {
  // Otherwise every open/cancel would cost an extra back press to leave.
  const at = window.history.index;
  click($("#btnAddHabit"), "#btnAddHabit");
  assert.equal(window.history.index, at + 1, "opening pushed one");
  click($("[data-sheet-cancel]"), "Cancel");
  assert.equal(window.history.index, at, "cancelling gave it back");
});

test("saving also gives the history entry back", () => {
  const at = window.history.index;
  click($("#btnAddHabit"), "#btnAddHabit");
  setValue($("#draftName"), "Kept", "input", "name");
  click($("[data-sheet-save]"), "Save");
  assert.equal(window.history.index, at);
  assert.ok(getSortedDailyHabits().some((h) => h.name === "Kept"));
});

test("Escape closes the sheet and unwinds history too", () => {
  const at = window.history.index;
  click($("#btnAddHabit"), "#btnAddHabit");
  document.dispatchEvent(
    Object.assign(new Event("keydown", { bubbles: true }), { key: "Escape" }),
  );
  assert.equal($("#habitSheet").classList.contains("open"), false);
  assert.equal(window.history.index, at);
});

test("repeated open/back cycles never drift the history stack", () => {
  const at = window.history.index;
  for (let i = 0; i < 5; i += 1) {
    click($("#btnAddHabit"), "#btnAddHabit");
    window.history.back();
    assert.equal($("#habitSheet").classList.contains("open"), false);
  }
  assert.equal(
    window.history.index,
    at,
    "five open/back cycles left the stack where it started",
  );
  assert.equal(window.history.exited, false);
});

/* ====================================================================== */
/* Nothing is left broken behind                                          */
/* ====================================================================== */

test("opening and closing a sheet many times never leaves the app trapped", () => {
  for (let i = 0; i < 5; i += 1) {
    click($("#btnAddHabit"), "#btnAddHabit");
    assert.equal(isInert($("#habitSheet")), false, `open #${i + 1} is usable`);
    click($("[data-sheet-cancel]"), "Cancel");
    assert.equal(isInert($(".app-main")), false, `close #${i + 1} released`);
    assert.equal(
      document.body.classList.contains("is-modal-open"),
      false,
      `close #${i + 1} unlocked scrolling`,
    );
  }
  // And the app still works afterwards.
  const habit = getSortedDailyHabits()[0];
  click($(`[data-advance="${habit.id}"]`), "habit check");
  assert.equal(getDayCounts(TODAY_DAY).done, 1);
});

test("a skipped habit still shows a usable control", () => {
  const habit = getSortedDailyHabits()[0];
  const monthData = getCurrentMonthData();
  monthData.dailyCompletions[habit.id] = { [TODAY_DAY]: SKIPPED };
  renderAll();

  const control = $(`[data-advance="${habit.id}"]`);
  assert.ok(control.classList.contains("is-skipped"));
  assert.equal(whyNotInteractive(control), null, "and it can be tapped back");
  click(control, "skipped control");
  assert.equal(isHabitSkippedOn(habit, getCurrentMonthData(), TODAY_DAY), false);
});
