// Export and import.
//
// The interesting behaviour is which of the three save routes gets taken and
// what the user is told afterwards, so the File System Access API is stubbed
// rather than mocked away: the tests drive the same code a Chromium desktop
// browser would.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();

const S = await import("../src/state.js");
const { setState, globals } = S;
const { getDefaultState, migrateState, getDefaultMonthData } = await import(
  "../src/persistence.js"
);
const {
  exportData,
  importData,
  importThroughPicker,
  validateImportedState,
  canChooseExportFolder,
} = await import("../src/data-io.js");
const { getSortedDailyHabits } = await import("../src/habits.js");
const { renderSettings } = await import("../src/render-settings.js");
await import("../src/render-today.js");
await import("../src/render-analytics.js");
await import("../src/render-detail.js");

const TODAY = new Date();
const TODAY_NAME = `habit-maker-backup-${TODAY.getFullYear()}-${String(
  TODAY.getMonth() + 1,
).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}.json`;

function status() {
  const el = document.getElementById("backupStatus");
  return el ? el.textContent : "";
}

// A stand-in for the File System Access API. `written` collects what actually
// reached disk, so a test can prove the file was committed rather than just
// that no error was thrown.
function stubSavePicker({ name = TODAY_NAME, fail = null } = {}) {
  const record = { written: null, closed: false, options: null, name };
  window.showSaveFilePicker = async (options) => {
    record.options = options;
    if (fail) throw fail;
    return {
      name,
      createWritable: async () => ({
        write: async (text) => {
          record.written = text;
        },
        close: async () => {
          record.closed = true;
        },
      }),
    };
  };
  return record;
}

function stubOpenPicker({ text, fail = null } = {}) {
  const record = { options: null };
  window.showOpenFilePicker = async (options) => {
    record.options = options;
    if (fail) throw fail;
    return [{ getFile: async () => ({ text: async () => text }) }];
  };
  return record;
}

function abortError() {
  const error = new Error("The user aborted a request.");
  error.name = "AbortError";
  return error;
}

function seed() {
  setState(getDefaultState());
  migrateState();
  globals.dayFocusDay = null;
  globals.detailHabitId = null;
  renderSettings();
}

beforeEach(seed);

afterEach(() => {
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
});

/* ====================================================================== */
/* Export                                                                 */
/* ====================================================================== */

test("export opens a save dialog and writes the file you chose", async () => {
  const picker = stubSavePicker({ name: "my-habits.json" });

  await exportData();

  assert.ok(picker.options, "the save dialog was opened");
  assert.equal(
    picker.options.suggestedName,
    TODAY_NAME,
    "with a sensible suggested name",
  );
  assert.ok(picker.written, "and the file was written");
  assert.ok(picker.closed, "and closed, which is what commits it");
  assert.match(status(), /Saved as my-habits\.json/);

  const parsed = JSON.parse(picker.written);
  assert.ok(Array.isArray(parsed.habits.daily), "the backup holds the habits");
  assert.equal(parsed.habits.daily.length, getSortedDailyHabits().length);
});

test("the save dialog is filtered to JSON and remembers its folder", async () => {
  const picker = stubSavePicker();
  await exportData();

  assert.equal(
    picker.options.types[0].accept["application/json"][0],
    ".json",
  );
  // A stable id is what makes the browser reopen in the last folder used. It is
  // shared with the open dialog so export-then-import lands in the same place.
  assert.equal(picker.options.id, "habitMakerBackup");
  assert.equal(picker.options.startIn, "documents");
});

test("cancelling the save dialog is not an error", async () => {
  stubSavePicker({ fail: abortError() });
  await exportData();

  assert.match(status(), /cancelled/i);
  assert.equal(
    document.getElementById("backupStatus").classList.contains("error"),
    false,
    "dismissing a dialog must not be reported as a failure",
  );
});

test("a failing save dialog still gets you a file", async () => {
  // A read-only folder, a revoked permission. Falling through to the download
  // beats handing the user nothing but an error.
  stubSavePicker({ fail: new Error("NotAllowedError") });
  await exportData();
  assert.match(status(), /downloads/i);
});

test("with no save dialog, export falls back to a download", async () => {
  assert.equal(canChooseExportFolder(), false, "no picker in this environment");
  await exportData();
  assert.match(status(), /downloads/i);
  assert.match(status(), /habit-maker-backup-/);
});

test("the backup is named for today, not for the month being viewed", async () => {
  // It used to use state.currentMonth. That was harmless until month
  // navigation made it browsable -- then paging back to 2024 and exporting
  // produced a file called backup-2024-03.json holding all of your data.
  S.state.currentYear = 2024;
  S.state.currentMonth = 2;

  const picker = stubSavePicker();
  await exportData();

  assert.equal(picker.options.suggestedName, TODAY_NAME);
  assert.equal(
    picker.options.suggestedName.includes("2024-03"),
    false,
    "the viewed month must not leak into the filename",
  );
});

/* ====================================================================== */
/* Import                                                                 */
/* ====================================================================== */

test("export then import round-trips the data", async () => {
  const picker = stubSavePicker();
  S.state.habits.daily[0].name = "Round trip";
  await exportData();
  const backup = picker.written;

  // Wipe, then import the file back.
  setState(getDefaultState());
  migrateState();
  assert.notEqual(getSortedDailyHabits()[0].name, "Round trip");

  await importData({ text: async () => backup });

  assert.equal(getSortedDailyHabits()[0].name, "Round trip");
  assert.match(status(), /Import completed/);
});

test("import opens a dialog in the same folder the export went to", async () => {
  const backup = JSON.stringify(getDefaultState());
  const picker = stubOpenPicker({ text: backup });

  const handled = await importThroughPicker();

  assert.equal(handled, true, "the picker handled the whole flow");
  assert.equal(picker.options.id, "habitMakerBackup", "same remembered folder");
  assert.equal(picker.options.multiple, false);
  assert.match(status(), /Import completed/);
});

test("cancelling the open dialog is not an error and needs no fallback", async () => {
  stubOpenPicker({ fail: abortError() });
  const handled = await importThroughPicker();
  assert.equal(handled, true, "cancelling is a complete outcome");
  assert.match(status(), /cancelled/i);
});

test("with no open dialog, import defers to the file input", async () => {
  const handled = await importThroughPicker();
  assert.equal(handled, false, "the caller falls back to <input type=file>");
});

test("importing a file that is not a backup leaves the data alone", async () => {
  const before = getSortedDailyHabits()[0].name;

  await importData({ text: async () => '{"name":"some-package","version":"1"}' });
  assert.match(status(), /not a Habit Maker backup|Import failed/i);
  assert.equal(getSortedDailyHabits()[0].name, before, "nothing was replaced");

  await importData({ text: async () => "this is not json at all" });
  assert.match(status(), /not valid JSON/i);
  assert.equal(getSortedDailyHabits()[0].name, before);
});

test("importing lands you on the current month, not the file's", async () => {
  // A backup carries whatever month its author was looking at. Restoring one
  // made last March used to drop you into last March -- which, now that it is a
  // real place you can be, looks exactly like the import lost everything.
  const backup = getDefaultState();
  backup.currentYear = 2024;
  backup.currentMonth = 2;
  backup.months["2024-03"] = getDefaultMonthData();

  await importData({ text: async () => JSON.stringify(backup) });

  assert.equal(S.state.currentYear, TODAY.getFullYear());
  assert.equal(S.state.currentMonth, TODAY.getMonth());
});

test("a backup with embedded PDFs from the old build still imports", async () => {
  const backup = getDefaultState();
  backup.pdfBlobs = { a: "AAAA" };
  await importData({ text: async () => JSON.stringify(backup) });
  assert.match(status(), /Embedded PDFs were skipped/);
  assert.equal(S.state.pdfBlobs, undefined, "and they are not carried in");
});

/* ====================================================================== */
/* Validation                                                             */
/* ====================================================================== */

test("validateImportedState accepts a real backup and rejects the rest", () => {
  assert.equal(validateImportedState(getDefaultState()).ok, true);
  assert.equal(validateImportedState(null).ok, false);
  assert.equal(validateImportedState([]).ok, false);
  assert.equal(validateImportedState({}).ok, false);
  assert.equal(
    validateImportedState({ categories: [], habits: {}, months: {} }).ok,
    false,
    "habits.daily has to be an array",
  );
});

/* ====================================================================== */
/* What Settings promises                                                 */
/* ====================================================================== */

test("Settings says where the file will actually go", () => {
  renderSettings();
  const html = document.getElementById("settingsBody").innerHTML;
  assert.ok(html.includes("Export data"));
  assert.ok(
    html.includes("Saves to your downloads folder"),
    "with no picker available it promises a download, not a folder choice",
  );

  stubSavePicker();
  renderSettings();
  assert.ok(
    document
      .getElementById("settingsBody")
      .innerHTML.includes("Choose the folder to save it in"),
    "and offers the choice once the browser can provide one",
  );
});
