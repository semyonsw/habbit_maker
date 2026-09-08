"use strict";

// The stateful side of one-off tasks: reading and writing `state.tasks`.
//
// All the rules live in task-core.js, which knows nothing about `state` and is
// unit-tested directly. This module is the thin layer that reads the singleton
// and writes through saveState(), which is the app's only sanctioned write path
// -- it bumps the revision counter that invalidates the derived-value caches.
//
// See the header of task-core.js for why a task is not modelled as a habit.

import { state } from "./state.js";
import { saveState } from "./persistence.js";
import { uid, todayDateKey } from "./utils.js";
import {
  normalizeTask,
  sortTasks,
  tasksOnDate,
  overdueTasks,
  TASK_REMINDER_DEFAULT_TIME,
} from "./task-core.js";

// migrateState() guarantees the array, but a task write must never be the thing
// that throws on a state assembled by hand (a test, an import mid-flight).
function taskList() {
  if (!Array.isArray(state.tasks)) state.tasks = [];
  return state.tasks;
}

export function getAllTasks() {
  return sortTasks(taskList());
}

export function findTask(id) {
  return taskList().find((task) => task.id === id) || null;
}

export function getTasksForDate(dateKey) {
  return tasksOnDate(taskList(), dateKey);
}

// Undone tasks whose day has already gone by. Surfaced on today's list so a
// task you missed is not silently lost.
export function getOverdueTasks() {
  return overdueTasks(taskList(), todayDateKey());
}

/* ====================================================================== */
/* Writing                                                                */
/* ====================================================================== */

export function addTask(fields) {
  const task = normalizeTask(
    Object.assign(
      {
        id: uid("tk"),
        done: false,
        createdAt: todayDateKey(),
        reminder: { enabled: false, time: TASK_REMINDER_DEFAULT_TIME },
      },
      fields,
    ),
  );
  if (!task) return null;
  taskList().push(task);
  saveState();
  return task;
}

export function updateTask(id, fields) {
  const existing = findTask(id);
  if (!existing) return null;
  const next = normalizeTask(Object.assign({}, existing, fields, { id }));
  if (!next) return null;
  Object.assign(existing, next);
  saveState();
  return existing;
}

// Returns the record that was removed, so the caller can offer it back.
export function removeTask(id) {
  const list = taskList();
  const at = list.findIndex((task) => task.id === id);
  if (at === -1) return null;
  const [removed] = list.splice(at, 1);
  saveState();
  return removed;
}

// Put a deleted task back, for Undo. Re-normalised rather than trusted, because
// what comes back has been sitting in a closure since before the last save.
export function restoreTask(task) {
  const restored = normalizeTask(task);
  if (!restored) return null;
  taskList().push(restored);
  saveState();
  return restored;
}

// A task has exactly two states, so this is a plain toggle -- there is no
// "skipped" here. Skipping exists for habits because a rest day must be neutral
// to a streak and a score; a one-off task has neither, and a task you decided
// not to do is a task to delete.
export function toggleTaskDone(id) {
  const task = findTask(id);
  if (!task) return null;
  task.done = !task.done;
  saveState();
  return { done: task.done };
}
