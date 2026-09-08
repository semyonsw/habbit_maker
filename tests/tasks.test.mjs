// Unit tests for the pure one-off-task rules.
//
// Run with:  npm test        (node --test, no dependencies)
//
// task-core.js imports nothing that touches the DOM, the database or `state`,
// which is what makes this file possible -- the same reason scoring.test.mjs
// exists next to it.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TASK_REMINDER_DEFAULT_TIME,
  daysLate,
  normalizeTask,
  normalizeTaskList,
  overdueLabel,
  overdueTasks,
  sortTasks,
  taskCounts,
  taskDateLabel,
  taskReminderAt,
  tasksOnDate,
} from "../src/task-core.js";

/* ------------------------------------------------------------- fixtures */

function task(overrides) {
  return Object.assign(
    {
      id: "tk_1",
      title: "Renew passport",
      date: "2026-09-10",
      note: "",
      categoryId: "",
      done: false,
      reminder: { enabled: false, time: "09:00" },
      createdAt: "2026-09-09",
    },
    overrides,
  );
}

/* ====================================================================== */
/* Normalisation                                                          */
/* ====================================================================== */

test("a bare record is filled out into the full shape", () => {
  const out = normalizeTask({ title: "Call the bank", date: "2026-09-10" });
  assert.equal(out.title, "Call the bank");
  assert.equal(out.date, "2026-09-10");
  assert.equal(out.done, false);
  assert.equal(out.note, "");
  assert.equal(out.categoryId, "");
  assert.equal(out.reminder.enabled, false);
  assert.equal(out.reminder.time, TASK_REMINDER_DEFAULT_TIME);
  assert.ok(out.id, "an id is minted when one is missing");
  assert.equal(out.createdAt, "2026-09-10", "createdAt falls back to the day");
});

test("a task with no usable date at all is dropped, not invented", () => {
  assert.equal(normalizeTask({ title: "x", date: "nonsense" }), null);
  assert.equal(normalizeTask({ title: "x" }), null);
  assert.equal(normalizeTask(null), null);
  assert.equal(normalizeTask("nope"), null);
});

test("a broken date falls back to the day the task was created", () => {
  // The one date we genuinely have on record for it. Anything else would be
  // making a date up on the user's behalf.
  const out = normalizeTask({
    title: "x",
    date: "2026-13-45",
    createdAt: "2026-09-09",
  });
  assert.equal(out.date, "2026-09-09");
});

test("normalizeTaskList drops only the unusable ones", () => {
  const out = normalizeTaskList([
    { title: "keep me", date: "2026-09-10" },
    { title: "drop me", date: "" },
    { title: "keep me too", date: "2026-09-11" },
    "not an object",
  ]);
  assert.deepEqual(
    out.map((t) => t.title),
    ["keep me", "keep me too"],
  );
});

test("normalizeTaskList tolerates a missing or non-array value", () => {
  assert.deepEqual(normalizeTaskList(undefined), []);
  assert.deepEqual(normalizeTaskList({ nope: 1 }), []);
});

test("a hostile title survives as data and is length-capped", () => {
  const out = normalizeTask({
    title: `x" onfocus="alert(1)`,
    date: "2026-09-10",
  });
  // Escaping is the renderer's job (sanitize); normalisation must not mangle
  // what the user actually typed.
  assert.equal(out.title, `x" onfocus="alert(1)`);

  const long = normalizeTask({ title: "y".repeat(500), date: "2026-09-10" });
  assert.equal(long.title.length, 120);
});

test("an empty title becomes something drawable rather than a blank row", () => {
  assert.equal(normalizeTask({ title: "   ", date: "2026-09-10" }).title, "Task");
});

test("done is strictly boolean true, not merely truthy", () => {
  assert.equal(normalizeTask(task({ done: 1 })).done, false);
  assert.equal(normalizeTask(task({ done: "yes" })).done, false);
  assert.equal(normalizeTask(task({ done: true })).done, true);
});

test("a garbage reminder time falls back rather than reaching the scheduler", () => {
  const out = normalizeTask(
    task({ reminder: { enabled: true, time: "99:99" } }),
  );
  assert.equal(out.reminder.enabled, true);
  assert.equal(out.reminder.time, TASK_REMINDER_DEFAULT_TIME);
});

/* ====================================================================== */
/* Ordering and selection                                                 */
/* ====================================================================== */

test("tasks sort by date, and stay put within a day", () => {
  const list = [
    task({ id: "c", date: "2026-09-12", title: "third" }),
    task({ id: "a", date: "2026-09-10", title: "first" }),
    task({ id: "b", date: "2026-09-10", title: "second" }),
  ];
  assert.deepEqual(
    sortTasks(list).map((t) => t.title),
    ["first", "second", "third"],
    "chronological, and the same-day pair keeps its written order",
  );
});

test("ticking a task off must not reorder the list", () => {
  // The reason sortTasks does not put undone tasks first: the row would slide
  // away from under the finger that just tapped it.
  const list = [
    task({ id: "a", date: "2026-09-10", title: "first", done: true }),
    task({ id: "b", date: "2026-09-10", title: "second" }),
  ];
  assert.deepEqual(
    sortTasks(list).map((t) => t.title),
    ["first", "second"],
  );
});

test("sortTasks does not mutate its input", () => {
  const list = [
    task({ id: "b", date: "2026-09-12" }),
    task({ id: "a", date: "2026-09-10" }),
  ];
  sortTasks(list);
  assert.deepEqual(list.map((t) => t.id), ["b", "a"]);
});

test("tasksOnDate picks exactly one day", () => {
  const list = [
    task({ id: "a", date: "2026-09-09" }),
    task({ id: "b", date: "2026-09-10" }),
    task({ id: "c", date: "2026-09-10" }),
    task({ id: "d", date: "2026-09-11" }),
  ];
  assert.deepEqual(
    tasksOnDate(list, "2026-09-10").map((t) => t.id),
    ["b", "c"],
  );
  assert.deepEqual(tasksOnDate(list, "2026-09-13"), []);
});

test("taskCounts counts done against total", () => {
  assert.deepEqual(
    taskCounts([task({ done: true }), task({}), task({ done: true })]),
    { total: 3, done: 2 },
  );
  assert.deepEqual(taskCounts([]), { total: 0, done: 0 });
});

/* ====================================================================== */
/* Overdue                                                                */
/* ====================================================================== */

test("daysLate is positive for a day that has gone by", () => {
  assert.equal(daysLate("2026-09-09", "2026-09-10"), 1);
  assert.equal(daysLate("2026-09-10", "2026-09-10"), 0);
  assert.equal(daysLate("2026-09-11", "2026-09-10"), -1);
});

test("daysLate crosses a month and a year boundary", () => {
  assert.equal(daysLate("2026-08-31", "2026-09-01"), 1);
  assert.equal(daysLate("2025-12-31", "2026-01-01"), 1);
});

test("an unfinished task from a past day is overdue; a finished one is not", () => {
  const list = [
    task({ id: "old", date: "2026-09-08" }),
    task({ id: "olddone", date: "2026-09-08", done: true }),
    task({ id: "today", date: "2026-09-10" }),
    task({ id: "future", date: "2026-09-12" }),
  ];
  assert.deepEqual(
    overdueTasks(list, "2026-09-10").map((t) => t.id),
    ["old"],
    "only the unfinished one, and only from the past",
  );
});

test("overdue tasks come back oldest first", () => {
  const list = [
    task({ id: "b", date: "2026-09-08" }),
    task({ id: "a", date: "2026-09-01" }),
  ];
  assert.deepEqual(
    overdueTasks(list, "2026-09-10").map((t) => t.id),
    ["a", "b"],
  );
});

test("overdueLabel reads as English at one day and at many", () => {
  assert.equal(overdueLabel(1), "1 day late");
  assert.equal(overdueLabel(4), "4 days late");
});

/* ====================================================================== */
/* Labels                                                                 */
/* ====================================================================== */

test("the day label is relative where that helps and absolute where it does not", () => {
  assert.equal(taskDateLabel("2026-09-10", "2026-09-10"), "Today");
  assert.equal(taskDateLabel("2026-09-11", "2026-09-10"), "Tomorrow");
  assert.equal(taskDateLabel("2026-09-09", "2026-09-10"), "Yesterday");
  // Two days out, a weekday and a date is more use than "in 2 days".
  assert.equal(taskDateLabel("2026-09-12", "2026-09-10"), "Saturday 12 September");
});

test("an unreadable date labels as nothing rather than as NaN", () => {
  assert.equal(taskDateLabel("nope", "2026-09-10"), "");
});

/* ====================================================================== */
/* Reminders                                                              */
/* ====================================================================== */

test("a task reminder resolves to one exact moment", () => {
  const at = taskReminderAt(
    task({ date: "2026-09-10", reminder: { enabled: true, time: "07:30" } }),
  );
  assert.ok(at instanceof Date);
  assert.equal(at.getFullYear(), 2026);
  assert.equal(at.getMonth(), 8, "September is month 8");
  assert.equal(at.getDate(), 10);
  assert.equal(at.getHours(), 7);
  assert.equal(at.getMinutes(), 30);
  assert.equal(at.getSeconds(), 0, "pinned, so it cannot drift by a minute");
});

test("no reminder, a disabled one, or an unreadable one schedules nothing", () => {
  assert.equal(taskReminderAt(task({})), null, "disabled by default");
  assert.equal(taskReminderAt(task({ reminder: undefined })), null);
  assert.equal(
    taskReminderAt(task({ date: "nope", reminder: { enabled: true, time: "07:30" } })),
    null,
  );
  assert.equal(
    taskReminderAt(task({ reminder: { enabled: true, time: "7pm" } })),
    null,
  );
  assert.equal(taskReminderAt(null), null);
});
