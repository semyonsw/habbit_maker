"use strict";

// Android (Capacitor) integration.
//
// This app has no bundler -- src/*.js are loaded as raw ES modules -- so the
// Capacitor plugins are reached through the global bridge that the native
// WebView injects (`window.Capacitor.Plugins`) rather than by importing the npm
// packages. The npm packages still have to be installed: that is what registers
// the Java side during `npx cap sync`.
//
// Every export here is a no-op on the web, so callers never need to branch.

// The bridge object, read on every call rather than captured once at module
// load. It is injected into the page by the native WebView, and a module that
// evaluated before the injection would cache `undefined` for the life of the
// app -- turning the whole APK into "not native" with no way to tell.
function bridge() {
  return typeof window !== "undefined" ? window.Capacitor : undefined;
}

export function isNative() {
  const cap = bridge();
  return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
}

// Reach a Capacitor plugin, or null if this build cannot.
//
// There are two shapes of bridge and only ONE of them exists here:
//
//   * `Capacitor.Plugins.<Name>` -- injected into the page by the native
//     WebView itself, one ready-made object per registered plugin with every
//     @PluginMethod already wrapped as a promise-returning function. No import,
//     no registration, no bundler. This is the APK's route, and the only one
//     an app of raw ES modules can use.
//
//   * `Capacitor.registerPlugin` -- a function from the @capacitor/core npm
//     module, which is only in the page if something bundles it in. Nothing
//     here does, so on the phone it simply does not exist.
//
// This tried registerPlugin FIRST and gave up when it was missing, so on the
// phone EVERY plugin came back null. Export skipped both the file browser and
// the share sheet and fell through to `<a download>`, which the Android WebView
// ignores outright -- while Settings cheerfully reported the backup as saved to
// Downloads. Reminders went the same way, silently downgrading to in-page
// timers that die with the app.
export function plugin(name) {
  const cap = bridge();
  if (!cap) return null;

  const injected = cap.Plugins ? cap.Plugins[name] : null;
  if (injected) return injected;

  if (typeof cap.registerPlugin === "function") {
    try {
      return cap.registerPlugin(name);
    } catch {
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ splash */

let splashHidden = false;

// Dismisses the launch splash early, as soon as the app has actually rendered.
//
// This is an OPTIMISATION ONLY -- it must never be the sole thing that hides the
// splash. capacitor.config.json keeps launchAutoHide:true for that reason: the
// plugin's Android 12 path installs an OnPreDrawListener that returns false
// unconditionally and is only removed on auto-hide or on an explicit hide().
// With launchAutoHide:false, every draw pass is cancelled while the view tree
// keeps re-requesting traversals, so if the web layer is slow to boot -- or
// fails to boot at all -- the UI thread spins until Android kills the app with
// "isn't responding". Cold-start boot here (33 ES modules + IndexedDB open +
// first full render) is easily longer than that 5s window, so relying on this
// function alone reliably ANRs on a real device.
export async function hideNativeSplash() {
  if (splashHidden || !isNative()) return;
  splashHidden = true;
  const SplashScreen = plugin("SplashScreen");
  if (!SplashScreen) return;
  try {
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    /* nothing useful to do -- the app is already usable underneath */
  }
}

if (isNative()) {
  // Belt and braces: app.js hides the splash when init() settles, but init()
  // can hang outright (a blocked IndexedDB upgrade waits forever), and the
  // plugin's auto-hide is the only other thing that would uncover the UI.
  setTimeout(() => {
    hideNativeSplash();
  }, 6000);
}

/* -------------------------------------------------------------- file saves */

// A backup is JSON, so it goes to the native side as TEXT.
//
// It used to be turned into a Blob, read back through FileReader as a data: URL,
// have the "data:...;base64," prefix sliced off, cross the bridge, and be
// Base64.decode()d in Java. Five conversions, each able to fail, to move a
// string that was already a string -- and a payload a third larger for the
// trip. Two of those steps are where the empty exports came from.
//
// The real UTF-8 byte length, which is not the character count once a habit is
// named in anything but ASCII.
function utf8Size(text) {
  const payload = String(text == null ? "" : text);
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(payload).length;
  }
  // No TextEncoder (very old WebView): a Blob still measures bytes.
  return new Blob([payload]).size;
}

/* --------------------------------------------------------- save with a picker

   The real thing: Android's Storage Access Framework file browser, via the
   local FileSaverPlugin. You choose the folder and the filename and the file
   lands there, visible to every other app.

   This is what Export should have been doing all along. The share sheet below
   is a way to SEND a file, not a place to put one -- there is no folder to
   pick, some targets copy it somewhere private, and dismissing it writes
   nothing. "I exported and cannot find the file" is the expected outcome.

   TWO CALLS: pick the location, then write to it.

   The picker used to be handed the payload, which then had to survive the whole
   time the user spent browsing folders in another activity. When it did not,
   the plugin wrote zero bytes and reported success -- so Export announced a
   backup and left a 0 KB file, and re-importing it failed as "not valid JSON".
   Nothing crosses the activity boundary now except a URI, and the write is a
   fresh call. See FileSaverPlugin.java.

   Returns one of:
     { status: "saved", name, bytes }  the file is on disk where the user put
                                       it, and `bytes` is what the native side
                                       read back out of it -- never a guess
     { status: "cancelled" }     the picker was dismissed; nothing was written
     { status: "unavailable" }   no plugin (web, or an APK predating it)
     { status: "failed", error } the picker ran but the write did not
   -------------------------------------------------------------------------- */
export async function saveTextWithPicker(text, filename, mimeType) {
  if (!isNative()) return { status: "unavailable" };
  const FileSaver = plugin("FileSaver");
  if (
    !FileSaver ||
    typeof FileSaver.pickSaveLocation !== "function" ||
    typeof FileSaver.write !== "function"
  ) {
    return { status: "unavailable" };
  }

  // Checked before the picker is opened, not after. The file browser creates
  // the file the instant the user taps Save, so anything that cannot succeed
  // must not be allowed to get that far -- otherwise the failure leaves a
  // 0-byte file exactly where the user expects their backup.
  const payload = String(text == null ? "" : text);
  if (!payload) {
    return { status: "failed", error: new Error("there was nothing to save") };
  }

  try {
    const picked = await FileSaver.pickSaveLocation({
      filename,
      mimeType: mimeType || "application/json",
    });
    if (!picked || picked.cancelled || !picked.uri) {
      return { status: "cancelled" };
    }

    const written = await FileSaver.write({ uri: picked.uri, text: payload });
    // The native side rejects rather than resolving on a short write, so
    // reaching here without `saved` means a plugin older than this code.
    if (!written || !written.saved) {
      return {
        status: "failed",
        error: new Error("the file was chosen but nothing confirmed the write"),
      };
    }

    return {
      status: "saved",
      name: written.name || picked.name || filename,
      bytes: Number(written.bytes) > 0 ? Number(written.bytes) : utf8Size(payload),
    };
  } catch (error) {
    return { status: "failed", error };
  }
}

/* ------------------------------------------------------------- share sheet */

// Android's WebView has no download manager wired up: Capacitor registers no
// DownloadListener, so `<a download>` with a blob: URL silently does nothing.
// This writes the file into the app cache and hands it to the system share
// sheet, which can send it anywhere without needing a storage permission.
//
// Kept as the fallback for when the picker is unavailable. Same result shape as
// saveTextWithPicker, deliberately: a dismissed share sheet is "cancelled", NOT
// success. It used to be reported as success, so Export said "Exported as
// habit-maker-backup.json" whether or not a single byte had been written.
export async function shareTextNatively(text, filename) {
  if (!isNative()) return { status: "unavailable" };
  const Filesystem = plugin("Filesystem");
  const Share = plugin("Share");
  if (!Filesystem || !Share) return { status: "unavailable" };

  const payload = String(text == null ? "" : text);
  if (!payload) {
    return { status: "failed", error: new Error("there was nothing to share") };
  }

  try {
    // encoding: "utf8" writes the string as text. Without it the plugin treats
    // `data` as base64, which is what forced the whole Blob/FileReader detour.
    await Filesystem.writeFile({
      path: filename,
      data: payload,
      directory: "CACHE",
      encoding: "utf8",
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({
      path: filename,
      directory: "CACHE",
    });
    await Share.share({ title: filename, files: [uri] });
    return { status: "saved", name: filename, bytes: utf8Size(payload) };
  } catch (error) {
    const message = String((error && error.message) || error || "");
    if (/cancel/i.test(message)) return { status: "cancelled" };
    return { status: "failed", error };
  }
}
