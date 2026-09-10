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
const { saveTextWithPicker } = await import("../src/native.js");
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
  delete window.Capacitor;
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
/* An export that would be empty                                          */
/* ====================================================================== */

test("an export with no data loaded is refused rather than written", async () => {
  // `state` is null until the store has loaded, and null serialises to the
  // perfectly valid JSON `null` -- so this used to write a four-byte file and
  // report it as a saved backup. Importing it back would wipe the real data.
  const picker = stubSavePicker();
  setState(null);

  await exportData();

  assert.equal(picker.options, null, "the save dialog was never opened");
  assert.equal(picker.written, null, "and nothing was written");
  assert.match(status(), /failed/i);
  assert.equal(
    document.getElementById("backupStatus").classList.contains("error"),
    true,
  );
});

test("an export of an empty object is refused too", async () => {
  const picker = stubSavePicker();
  setState({});

  await exportData();

  assert.equal(picker.written, null, "nothing was written");
  assert.match(status(), /failed/i);
});

test("an empty payload never reaches the file browser", async () => {
  // The guard sits in front of the picker on purpose: the Android file browser
  // CREATES the file the moment the user taps Save, so a write that cannot
  // succeed must not be allowed to get that far -- otherwise the failure leaves
  // a 0-byte file exactly where the user expects a backup.
  const calls = stubFileSaver();

  const result = await saveTextWithPicker(
    "",
    "nothing.json",
    "application/json",
  );

  assert.equal(result.status, "failed", "reported as a failure");
  assert.equal(calls.picks.length, 0, "and the picker was never opened");
  assert.equal(calls.writes.length, 0);
});

/* ====================================================================== */
/* Export on Android                                                      */
/* ====================================================================== */

// The bridge the native WebView injects into the page. Note what is NOT on it:
// `registerPlugin`. That function comes from the @capacitor/core npm module and
// only exists where something bundles it in; this app is raw ES modules, so on
// the phone a plugin is reachable ONLY as `Capacitor.Plugins.<Name>` -- an
// object the WebView builds itself, one method per @PluginMethod.
//
// The stub therefore offers nothing else on purpose. Reaching for registerPlugin
// first is exactly what made every plugin come back null on the phone.
function stubNativeBridge(plugins = {}) {
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: plugins,
  };
}

// The FileSaver plugin, modelled on the real one: TWO calls, and the write
// computes its byte count from the text it was actually handed. A test
// asserting on the reported size is therefore asserting on the bytes that
// reached the file, not on a number the stub was told to return.
function fileSaverPlugin({
  uri = "content://docs/backup.json",
  name = "habits.json",
  cancelled = false,
  bytes = null,
  writeError = null,
} = {}) {
  const calls = { picks: [], writes: [] };
  const plugin = {
    pickSaveLocation: async (options) => {
      calls.picks.push(options);
      if (cancelled) return { cancelled: true };
      return { cancelled: false, uri, name };
    },
    write: async (options) => {
      calls.writes.push(options);
      if (writeError) throw writeError;
      const onDisk = Buffer.byteLength(String(options.text || ""), "utf8");
      return {
        saved: true,
        uri: options.uri,
        name,
        bytes: bytes == null ? onDisk : bytes,
        verified: true,
      };
    },
  };
  return { plugin, calls };
}

// Filesystem + Share, the fallback route.
function sharePlugins() {
  const calls = { written: [], shared: [] };
  return {
    plugins: {
      Filesystem: {
        writeFile: async (options) => {
          calls.written.push(options);
        },
        getUri: async () => ({ uri: "file:///cache/backup.json" }),
      },
      Share: {
        share: async (options) => {
          calls.shared.push(options);
        },
      },
    },
    calls,
  };
}

function stubFileSaver(options = {}) {
  const { plugin, calls } = fileSaverPlugin(options);
  stubNativeBridge({ FileSaver: plugin });
  return calls;
}

test("on Android the export goes through the system file browser", async () => {
  const calls = stubFileSaver({ name: "habits.json" });

  await exportData();

  assert.equal(calls.picks.length, 1, "the file browser was opened");
  assert.equal(calls.picks[0].filename, TODAY_NAME, "with today's name suggested");
  assert.equal(calls.picks[0].mimeType, "application/json");

  assert.equal(calls.writes.length, 1, "and then written to");
  const parsed = JSON.parse(calls.writes[0].text);
  assert.ok(Array.isArray(parsed.habits.daily), "the whole backup went over");
  assert.equal(parsed.habits.daily.length, getSortedDailyHabits().length);

  assert.match(status(), /Saved as habits\.json/);
});

test("the picker call carries no payload at all", async () => {
  // THE BUG. The payload used to be handed to the picker, which then had to
  // survive the whole time the user spent browsing folders in another activity.
  // When it did not, the plugin wrote zero bytes and still reported success:
  // a 0 KB file announced as a saved backup, which then failed to import as
  // "not valid JSON". Nothing but a URI may cross that boundary now.
  const calls = stubFileSaver();

  await exportData();

  const pick = calls.picks[0];
  assert.equal(pick.data, undefined, "no base64 payload on the picker call");
  assert.equal(pick.text, undefined, "and no text either");
  assert.deepEqual(
    Object.keys(pick).sort(),
    ["filename", "mimeType"],
    "the picker is told where to save, and nothing else",
  );
});

test("the backup crosses the bridge as text, not as base64", async () => {
  // Five conversions used to move a string that was already a string: Blob ->
  // FileReader -> data: URL -> slice the prefix -> Base64.decode in Java. Two
  // of them are where the empty exports came from.
  const calls = stubFileSaver();

  await exportData();

  const written = calls.writes[0];
  assert.equal(typeof written.text, "string");
  assert.equal(written.data, undefined, "nothing is base64-encoded");
  assert.ok(
    written.text.trimStart().startsWith("{"),
    "it is the JSON itself, readable as it goes over",
  );
  assert.ok(written.uri, "aimed at the URI the picker returned");
});

test("the confirmation reports the size the file actually holds", async () => {
  // "Saved" on its own is exactly what an empty file also says. The number
  // comes from the native side, which reads the file back and counts the bytes
  // after writing -- so this is a report about the file on disk, not about our
  // intention to write one.
  stubFileSaver({ name: "habits.json", bytes: 4096 });

  await exportData();

  assert.match(status(), /Saved as habits\.json \(4\.0 KB\)/);
});

test("the reported size is the real byte count of the backup", async () => {
  const calls = stubFileSaver({ name: "habits.json" });
  await exportData();

  const bytes = Buffer.byteLength(calls.writes[0].text, "utf8");
  assert.ok(bytes > 100, "there is a real backup here");
  // Whatever it is, the status line must not be able to claim 0.
  assert.doesNotMatch(status(), /\(0 bytes\)/);
  assert.match(status(), /\d/);
});

test("dismissing Android's file browser is reported as cancelled", async () => {
  const calls = stubFileSaver({ cancelled: true });

  await exportData();

  assert.match(status(), /cancelled/i);
  assert.equal(calls.writes.length, 0, "and nothing was written");
  assert.doesNotMatch(
    status(),
    /downloads/i,
    "nothing was written, so nothing may be claimed about Downloads",
  );
});

test("a write that fails is never reported as a saved backup", async () => {
  // The native side rejects on a short or empty write rather than resolving,
  // so this is the shape a verified-but-wrong file arrives in.
  const { plugin } = fileSaverPlugin({
    writeError: new Error("The file was written but holds 0 bytes instead of 8123."),
  });
  const share = sharePlugins();
  stubNativeBridge({ FileSaver: plugin, ...share.plugins });

  await exportData();

  assert.doesNotMatch(status(), /^Saved as/, "not announced as saved");
  // It falls through to the share sheet, which is a real route to a file.
  assert.equal(share.calls.shared.length, 1, "the fallback was tried");
});

test("the share fallback sends the backup as UTF-8 text", async () => {
  const share = sharePlugins();
  stubNativeBridge(share.plugins); // no FileSaver at all

  await exportData();

  assert.equal(share.calls.written.length, 1);
  const file = share.calls.written[0];
  assert.equal(file.encoding, "utf8", "written as text, not decoded as base64");
  assert.ok(JSON.parse(file.data).habits, "and it is the backup");
  assert.equal(share.calls.shared.length, 1, "then handed to the share sheet");
  assert.match(status(), /share sheet/i);
});

test("a non-ASCII habit name does not corrupt the file or its size", async () => {
  S.state.habits.daily[0].name = "Утренняя молитва 🙏";
  const calls = stubFileSaver({ name: "habits.json" });

  await exportData();

  const parsed = JSON.parse(calls.writes[0].text);
  assert.equal(
    parsed.habits.daily[0].name,
    "Утренняя молитва 🙏",
    "the name survives the trip intact",
  );
  // A character is not a byte: the size must be measured in bytes.
  const bytes = Buffer.byteLength(calls.writes[0].text, "utf8");
  assert.ok(bytes > calls.writes[0].text.length, "multi-byte characters counted");
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
