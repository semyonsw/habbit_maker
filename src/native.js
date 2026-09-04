"use strict";

// Android (Capacitor) integration.
//
// This app has no bundler -- src/*.js are loaded as raw ES modules -- so the
// Capacitor plugins are reached through the global bridge that the native
// WebView injects (`window.Capacitor.registerPlugin`) rather than by importing
// the npm packages. The npm packages still have to be installed: that is what
// registers the Java side during `npx cap sync`.
//
// Every export here is a no-op on the web, so callers never need to branch.

const cap = typeof window !== "undefined" ? window.Capacitor : undefined;

export function isNative() {
  return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
}

// Exported so notifications.js can reach LocalNotifications the same way --
// there is no bundler here, so plugins come off the injected global bridge
// rather than from an npm import. The npm package must still be installed:
// that is what registers the Java side during `npx cap sync`.
export function plugin(name) {
  if (!cap || typeof cap.registerPlugin !== "function") return null;
  try {
    return cap.registerPlugin(name);
  } catch {
    return null;
  }
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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.onload = () => {
      // readAsDataURL gives "data:<mime>;base64,<payload>" -- Filesystem wants
      // only the payload.
      const out = String(reader.result || "");
      const comma = out.indexOf(",");
      resolve(comma === -1 ? "" : out.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

// Android's WebView has no download manager wired up: Capacitor registers no
// DownloadListener, so `<a download>` with a blob: URL silently does nothing.
// Instead write the file into the app cache and hand it to the system share
// sheet, which lets it be saved to Files/Drive/anywhere without needing a
// storage permission.
//
/* --------------------------------------------------------- save with a picker

   The real thing: Android's Storage Access Framework file browser, via the
   local FileSaverPlugin. You choose the folder and the filename and the file
   lands there, visible to every other app.

   This is what Export should have been doing all along. The share sheet below
   is a way to SEND a file, not a place to put one -- there is no folder to
   pick, some targets copy it somewhere private, and dismissing it writes
   nothing. "I exported and cannot find the file" is the expected outcome.

   Returns one of:
     { status: "saved", name }   the file is on disk where the user put it
     { status: "cancelled" }     the picker was dismissed; nothing was written
     { status: "unavailable" }   no plugin (web, or an APK predating it)
     { status: "failed", error } the picker ran but the write did not
   -------------------------------------------------------------------------- */
export async function saveBlobWithPicker(blob, filename, mimeType) {
  if (!isNative()) return { status: "unavailable" };
  const FileSaver = plugin("FileSaver");
  if (!FileSaver || typeof FileSaver.save !== "function") {
    return { status: "unavailable" };
  }

  try {
    const data = await blobToBase64(blob);
    const result = await FileSaver.save({
      filename,
      mimeType: mimeType || "application/json",
      data,
    });
    if (result && result.saved) {
      return { status: "saved", name: result.name || filename };
    }
    return { status: "cancelled" };
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
// saveBlobWithPicker, deliberately: a dismissed share sheet is "cancelled", NOT
// success. It used to be reported as success, so Export said "Exported as
// habit-maker-backup.json" whether or not a single byte had been written.
export async function shareBlobNatively(blob, filename) {
  if (!isNative()) return { status: "unavailable" };
  const Filesystem = plugin("Filesystem");
  const Share = plugin("Share");
  if (!Filesystem || !Share) return { status: "unavailable" };

  try {
    const data = await blobToBase64(blob);
    // No `encoding` -> the payload is treated as base64 and written as binary.
    await Filesystem.writeFile({
      path: filename,
      data,
      directory: "CACHE",
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({
      path: filename,
      directory: "CACHE",
    });
    await Share.share({ title: filename, files: [uri] });
    return { status: "saved", name: filename };
  } catch (error) {
    const message = String((error && error.message) || error || "");
    if (/cancel/i.test(message)) return { status: "cancelled" };
    return { status: "failed", error };
  }
}
