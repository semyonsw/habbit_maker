"use strict";

import { state, setState } from "./state.js";
import {
  isPlainObject,
  monthKey,
} from "./utils.js?v=2";
import { appendLogEntry } from "./logging.js";
import { migrateState, ensureMonthData, saveState } from "./persistence.js";
import { callRenderer } from "./render-registry.js";
import { saveBlobNatively } from "./native.js";

export function setBackupStatus(text, tone) {
  const statusEl = document.getElementById("backupStatus");
  if (!statusEl) return;
  statusEl.textContent = String(text || "");
  statusEl.classList.remove("pending", "success", "warn", "error");
  if (["pending", "success", "warn", "error"].includes(String(tone))) {
    statusEl.classList.add(String(tone));
  }
}

export async function exportData() {
  setBackupStatus("Preparing backup...", "pending");

  try {
    const exportedState = JSON.parse(JSON.stringify(state));

    const blob = new Blob([JSON.stringify(exportedState, null, 2)], {
      type: "application/json",
    });
    const backupName = `habit-tracker-backup-${monthKey(state.currentYear, state.currentMonth)}.json`;
    // See src/native.js: inside the Android WebView an anchor download is a
    // silent no-op, which would make Export look like it worked while producing
    // no file. Awaited so the status messages below cannot claim success first.
    if (!(await saveBlobNatively(blob, backupName))) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backupName;
      a.click();
      URL.revokeObjectURL(url);
    }

    setBackupStatus("Backup exported.", "success");
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "backup",
      operation: "exportData",
      message: "Export failed.",
      error,
    });
    setBackupStatus("Export failed. See logs for details.", "error");
    alert("Export failed. See logs for details.");
  }
}

export function validateImportedState(imported) {
  const errors = [];

  if (!isPlainObject(imported)) {
    return { ok: false, errors: ["Root value must be an object."] };
  }

  if (!Array.isArray(imported.categories)) {
    errors.push("categories must be an array.");
  }

  if (
    !isPlainObject(imported.habits) ||
    !Array.isArray(imported.habits.daily)
  ) {
    errors.push("habits.daily must be an array.");
  }

  if (!isPlainObject(imported.months)) {
    errors.push("months must be an object.");
  }

  // `books` and `pdfBlobs` from an older backup are not validated: they are
  // dropped on import rather than read, so a malformed one cannot hurt us and
  // rejecting the whole file over it would lose the habits alongside it.
  return { ok: errors.length === 0, errors };
}

export function importData(file) {
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const imported = JSON.parse(e.target.result);
      const validation = validateImportedState(imported);
      if (!validation.ok) {
        alert(
          `Import failed:\n- ${validation.errors.slice(0, 8).join("\n- ")}`,
        );
        return;
      }

      // Older backups may embed base64 PDFs for the removed books feature.
      // There is nowhere to put them now, so they are skipped; every habit,
      // note, completion and report in the file is imported untouched.
      const hadEmbeddedPdfs =
        imported.pdfBlobs !== undefined &&
        Object.keys(imported.pdfBlobs || {}).length > 0;
      delete imported.pdfBlobs;

      setState(imported);
      migrateState();
      ensureMonthData();
      saveState();
      callRenderer("renderAll");


      setBackupStatus(
        hadEmbeddedPdfs
          ? "Import completed. Embedded PDFs were skipped."
          : "Import completed.",
        hadEmbeddedPdfs ? "warn" : "success",
      );
    } catch (err) {
      appendLogEntry({
        level: "error",
        component: "backup",
        operation: "importData",
        message: "Failed to import backup file.",
        error: err,
      });
      alert(
        "Failed to import backup file.\n" +
          (err && err.message ? err.message : String(err)),
      );
    }
  };
  reader.readAsText(file);
}
