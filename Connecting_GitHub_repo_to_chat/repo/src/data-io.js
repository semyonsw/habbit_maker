"use strict";

import { state, setState } from "./state.js";
import { monthKey, isPlainObject } from "./utils.js";
import { appendLogEntry } from "./logging.js";
import { migrateState, ensureMonthData, saveState, getDefaultState } from "./persistence.js";
import { rescheduleAll } from "./reminders.js";
import { callRenderer } from "./render-registry.js";

export function exportData() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `habit-tracker-backup-${monthKey(state.currentYear, state.currentMonth)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    appendLogEntry({ level: "error", component: "backup", operation: "exportData", message: "Export failed.", error });
    alert("Export failed.");
  }
}

export function validateImportedState(imported) {
  const errors = [];
  if (!isPlainObject(imported)) return { ok: false, errors: ["Root value must be an object."] };
  if (!Array.isArray(imported.categories)) errors.push("categories must be an array.");
  if (!isPlainObject(imported.habits) || !Array.isArray(imported.habits.daily)) {
    errors.push("habits.daily must be an array.");
  }
  if (!isPlainObject(imported.months)) errors.push("months must be an object.");
  return { ok: errors.length === 0, errors };
}

export function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      const check = validateImportedState(imported);
      if (!check.ok) {
        alert(`Import failed:\n- ${check.errors.join("\n- ")}`);
        return;
      }
      setState(imported);
      migrateState();
      ensureMonthData();
      saveState();
      rescheduleAll();
      callRenderer("render");
      alert("Import completed.");
    } catch (error) {
      appendLogEntry({ level: "error", component: "backup", operation: "importData", message: "Import failed.", error });
      alert(`Failed to import backup file.\n${error && error.message ? error.message : error}`);
    }
  };
  reader.readAsText(file);
}

export function resetAllData() {
  if (!confirm("Delete every habit and all history? This cannot be undone.")) return;
  setState(getDefaultState());
  saveState();
  rescheduleAll();
  callRenderer("render");
}
