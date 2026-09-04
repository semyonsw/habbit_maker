"use strict";

// Export and import: one JSON file holding the whole of your data.
//
// Where the file GOES is the interesting part, and there are three routes
// because the platforms genuinely differ:
//
//   1. A real save dialog -- File System Access API (showSaveFilePicker). You
//      pick the folder and the filename, and the browser remembers the folder
//      for next time. Chromium desktop, including the local Python build, since
//      127.0.0.1 counts as a secure context.
//
//   2. On Android, the Storage Access Framework file browser, via the local
//      FileSaverPlugin -- the same "pick a folder, name the file" dialog every
//      other Android app uses. The share sheet is the fallback below it: it can
//      SEND a file but is not a place to put one, which is why exports kept
//      ending up somewhere nobody could find.
//
//   3. A plain anchor download, for Firefox and Safari. Straight to the
//      browser's download folder with nothing to choose -- the old behaviour,
//      and now only the last resort. WEB ONLY: Capacitor wires no
//      DownloadListener into the Android WebView, so there `<a download>` does
//      nothing whatsoever, and route 2 has to end the export either way.
//
// Import mirrors it: a real open dialog where available, starting in the same
// remembered folder, otherwise a hidden <input type="file">.

import { state, setState } from "./state.js";
import { isPlainObject, formatDateKey } from "./utils.js";
import { appendLogEntry } from "./logging.js";
import { migrateState, ensureMonthData, saveState } from "./persistence.js";
import { callRenderer } from "./render-registry.js";
import {
  saveBlobWithPicker,
  shareBlobNatively,
  isNative,
} from "./native.js";
import { showToast } from "./toast.js";

// Shared between the save and open dialogs on purpose: Chromium remembers the
// last directory per id, so exporting to a folder and then importing from it
// reopens exactly where you were.
const PICKER_ID = "habitMakerBackup";

const BACKUP_TYPES = [
  {
    description: "Habit Maker backup",
    accept: { "application/json": [".json"] },
  },
];

export function setBackupStatus(text, tone) {
  const statusEl = document.getElementById("backupStatus");
  if (!statusEl) return;
  statusEl.textContent = String(text || "");
  statusEl.classList.remove("pending", "success", "warn", "error");
  if (["pending", "success", "warn", "error"].includes(String(tone))) {
    statusEl.classList.add(String(tone));
  }
}

// Dismissing a file dialog is a normal thing to do, not a failure. It arrives
// as an AbortError (older Chromium used a plain DOMException with that name).
function isAbort(error) {
  return !!error && (error.name === "AbortError" || error.code === 20);
}

// Named for the day it was taken, NOT for the month being viewed.
//
// It used to use state.currentMonth, which was harmless while that was always
// the current month -- but month navigation made it browsable, so paging back
// to March 2024 and exporting produced "backup-2024-03.json" containing all of
// your data. A filename that lies about what is in the file is worse than a
// dull one.
function backupFilename() {
  const now = new Date();
  return `habit-maker-backup-${formatDateKey(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  )}.json`;
}

// Exported so Settings can tell the user, before they tap, whether they get to
// choose a folder or whether the file simply lands in Downloads.
export function canChooseExportFolder() {
  return canPickSaveLocation();
}

function canPickSaveLocation() {
  return (
    !isNative() &&
    typeof window !== "undefined" &&
    typeof window.showSaveFilePicker === "function"
  );
}

function canPickOpenLocation() {
  return (
    !isNative() &&
    typeof window !== "undefined" &&
    typeof window.showOpenFilePicker === "function"
  );
}

/* ====================================================================== */
/* Export                                                                 */
/* ====================================================================== */

async function writeThroughPicker(text, suggestedName) {
  const handle = await window.showSaveFilePicker({
    id: PICKER_ID,
    suggestedName,
    startIn: "documents",
    types: BACKUP_TYPES,
  });
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } finally {
    // close() is what actually commits the file. Without it in a finally, a
    // write that throws half way leaves a zero-byte file on disk looking like
    // a successful backup.
    await writable.close();
  }
  return handle.name || suggestedName;
}

function downloadThroughAnchor(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  // Appended to the document: Firefox ignores click() on a detached anchor.
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Revoked on a timer, not immediately. Some engines have not finished reading
  // the blob when click() returns, and revoking under them produces an empty or
  // failed download. Ten seconds is far longer than any of them need.
  const timer = setTimeout(() => URL.revokeObjectURL(url), 10000);
  // Pure cleanup: it must never be the reason a process stays alive. In a
  // browser setTimeout returns a number and this is a no-op; under Node (the
  // tests) it returns a Timeout, which would otherwise hold the runner open for
  // the full ten seconds after the work is done.
  if (timer && typeof timer.unref === "function") timer.unref();
}

export async function exportData() {
  setBackupStatus("Preparing backup...", "pending");

  const filename = backupFilename();
  let json;
  try {
    json = JSON.stringify(JSON.parse(JSON.stringify(state)), null, 2);
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "backup",
      operation: "exportData.serialize",
      message: "Could not serialise the app state.",
      error,
    });
    setBackupStatus("Export failed: your data could not be read.", "error");
    showToast("Export failed. See the logs for details.");
    return;
  }

  // 1. Pick a folder.
  if (canPickSaveLocation()) {
    setBackupStatus("Choose where to save it...", "pending");
    try {
      const name = await writeThroughPicker(json, filename);
      setBackupStatus(`Saved as ${name}.`, "success");
      return;
    } catch (error) {
      if (isAbort(error)) {
        setBackupStatus("Export cancelled. Nothing was saved.", "warn");
        return;
      }
      // A real failure -- a read-only folder, a revoked permission. Log it and
      // fall through, so the user still ends up with a file rather than only an
      // error message.
      appendLogEntry({
        level: "warn",
        component: "backup",
        operation: "exportData.picker",
        message: "Save dialog failed; falling back to a download.",
        error,
      });
    }
  }

  // 2. Android: the system file browser, then the share sheet.
  if (isNative()) {
    const blob = new Blob([json], { type: "application/json" });

    setBackupStatus("Choose where to save it...", "pending");
    const picked = await saveBlobWithPicker(blob, filename, "application/json");
    if (picked.status === "saved") {
      setBackupStatus(`Saved as ${picked.name}.`, "success");
      return;
    }
    if (picked.status === "cancelled") {
      setBackupStatus("Export cancelled. Nothing was saved.", "warn");
      return;
    }
    if (picked.status === "failed") {
      appendLogEntry({
        level: "warn",
        component: "backup",
        operation: "exportData.picker.native",
        message: "The file picker failed; falling back to the share sheet.",
        error: picked.error,
      });
    }

    // Only reached on an APK built before FileSaverPlugin existed, or if the
    // picker itself failed.
    const shared = await shareBlobNatively(blob, filename);
    if (shared.status === "saved") {
      setBackupStatus(`Sent ${filename} to the share sheet.`, "success");
      return;
    }
    if (shared.status === "cancelled") {
      // Reported honestly. This used to claim success, so Export said the file
      // had been written whether or not anything happened.
      setBackupStatus("Export cancelled. Nothing was saved.", "warn");
      return;
    }
    if (shared.status === "failed") {
      appendLogEntry({
        level: "error",
        component: "backup",
        operation: "exportData.share",
        message: "Native share failed.",
        error: shared.error,
      });
      setBackupStatus("Export failed. See the logs for details.", "error");
      showToast("Export failed. See the logs for details.");
      return;
    }

    // Both native routes reported "unavailable", so nothing was written. This
    // MUST NOT fall through to the download below: Capacitor registers no
    // DownloadListener, so `<a download>` in the Android WebView does exactly
    // nothing, and the status line then announced a file in Downloads that was
    // never created anywhere. Say what actually happened instead.
    appendLogEntry({
      level: "error",
      component: "backup",
      operation: "exportData.native",
      message: "No native save route: neither FileSaver nor Share resolved.",
    });
    setBackupStatus(
      "Export failed: this app could not reach Android's file saver. " +
        "See the logs for details.",
      "error",
    );
    showToast("Export failed. See the logs for details.");
    return;
  }

  // 3. Plain download. Web only -- see the note at the top of the file.
  try {
    downloadThroughAnchor(json, filename);
    setBackupStatus(
      `Saved to your downloads as ${filename}.`,
      "success",
    );
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "backup",
      operation: "exportData.download",
      message: "Export failed.",
      error,
    });
    setBackupStatus("Export failed. See the logs for details.", "error");
    showToast("Export failed. See the logs for details.");
  }
}

/* ====================================================================== */
/* Import                                                                 */
/* ====================================================================== */

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

function applyImportedState(imported) {
  // Older backups may embed base64 PDFs for the removed books feature. There is
  // nowhere to put them now, so they are skipped; every habit, note and
  // completion in the file is imported untouched.
  const hadEmbeddedPdfs =
    imported.pdfBlobs !== undefined &&
    Object.keys(imported.pdfBlobs || {}).length > 0;
  delete imported.pdfBlobs;

  setState(imported);
  migrateState();

  // A backup carries the month its author happened to be viewing. Land on the
  // current month instead, the way a fresh boot does -- otherwise importing a
  // file made last March silently drops you into last March, which is now a
  // real place you can be and looks like the import lost everything.
  const now = new Date();
  state.currentYear = now.getFullYear();
  state.currentMonth = now.getMonth();

  ensureMonthData();
  saveState();
  // The imported reminder settings have to replace whatever was scheduled for
  // the habits they just overwrote.
  callRenderer("rescheduleReminders");
  callRenderer("renderAll");

  setBackupStatus(
    hadEmbeddedPdfs
      ? "Import completed. Embedded PDFs were skipped."
      : "Import completed.",
    hadEmbeddedPdfs ? "warn" : "success",
  );
}

export async function importData(file) {
  if (!file) return;
  setBackupStatus("Reading backup...", "pending");

  let text;
  try {
    text = await file.text();
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "backup",
      operation: "importData.read",
      message: "Could not read the chosen file.",
      error,
    });
    setBackupStatus("Could not read that file.", "error");
    showToast("Could not read that file.");
    return;
  }

  let imported;
  try {
    imported = JSON.parse(text);
  } catch (_) {
    setBackupStatus(
      "That file is not valid JSON, so it is not a Habit Maker backup.",
      "error",
    );
    showToast("That is not a Habit Maker backup.");
    return;
  }

  const validation = validateImportedState(imported);
  if (!validation.ok) {
    const detail = validation.errors.slice(0, 4).join(" ");
    setBackupStatus(`Import failed. ${detail}`, "error");
    showToast("That file is not a Habit Maker backup.");
    return;
  }

  try {
    applyImportedState(imported);
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "backup",
      operation: "importData.apply",
      message: "Failed to apply the imported backup.",
      error,
    });
    setBackupStatus("Import failed. See the logs for details.", "error");
    showToast("Import failed. See the logs for details.");
  }
}

// Returns true if it handled the whole flow, false if the caller should fall
// back to the hidden <input type="file">.
export async function importThroughPicker() {
  if (!canPickOpenLocation()) return false;

  setBackupStatus("Choose a backup to import...", "pending");
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({
      id: PICKER_ID,
      startIn: "documents",
      types: BACKUP_TYPES,
      excludeAcceptAllOption: false,
      multiple: false,
    });
  } catch (error) {
    if (isAbort(error)) {
      setBackupStatus("Import cancelled.", "warn");
      return true;
    }
    appendLogEntry({
      level: "warn",
      component: "backup",
      operation: "importThroughPicker",
      message: "Open dialog failed; falling back to the file input.",
      error,
    });
    return false;
  }

  if (!handle) {
    setBackupStatus("Import cancelled.", "warn");
    return true;
  }

  await importData(await handle.getFile());
  return true;
}
