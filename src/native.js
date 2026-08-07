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

function plugin(name) {
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

// Slices are base64-encoded one at a time on the way to the Filesystem plugin.
// A multiple of 3 so each chunk encodes without padding, which keeps the
// concatenated file byte-identical to the blob.
const PDF_CHUNK_BYTES = 3 * 1024 * 1024;

function sanitizePathSegment(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/^[_.\s]+|[_\s]+$/g, "");
  return cleaned.length ? cleaned.slice(0, 80) : fallback;
}

// Streams a blob into the app cache in slices. Writing it in one call would
// hand the bridge a base64 string ~1.34x the file size -- for the 60MB books in
// this library that is ~80MB in a single JS string plus a copy on the Java
// side, which the WebView does not survive.
async function writeBlobToCacheChunked(Filesystem, path, blob) {
  const total = blob.size || 0;
  let offset = 0;
  let isFirst = true;

  while (isFirst || offset < total) {
    const slice = blob.slice(offset, Math.min(offset + PDF_CHUNK_BYTES, total));
    const data = await blobToBase64(slice);
    if (isFirst) {
      // writeFile truncates, so a stale/partial file from an aborted run cannot
      // survive as a prefix of the new one.
      await Filesystem.writeFile({
        path,
        data,
        directory: "CACHE",
        recursive: true,
      });
      isFirst = false;
    } else {
      await Filesystem.appendFile({ path, data, directory: "CACHE" });
    }
    offset += PDF_CHUNK_BYTES;
  }
}

// Hands a PDF to whatever app the phone uses to read PDFs.
//
// The bytes live in IndexedDB inside the WebView, so no other app can reach
// them: they have to be materialised as a real file first. The copy is kept in
// the app cache and reused on the next open (matched by byte size), so opening
// the same book repeatedly only pays the write cost once.
//
// Returns true if an external app was handed the file, false if the caller
// should fall back to its own handling (which is always the case on the web).
export async function openPdfExternally(blob, options = {}) {
  if (!isNative() || !blob) return false;
  const Filesystem = plugin("Filesystem");
  if (!Filesystem) return false;

  const rawName = sanitizePathSegment(options.fileName, "book.pdf");
  const fileName = /\.pdf$/i.test(rawName) ? rawName : `${rawName}.pdf`;
  const key = sanitizePathSegment(options.cacheKey, "book");
  const path = `open-book/${key}/${fileName}`;

  try {
    let needsWrite = true;
    try {
      const info = await Filesystem.stat({ path, directory: "CACHE" });
      needsWrite = Number(info && info.size) !== Number(blob.size);
    } catch {
      needsWrite = true;
    }
    if (needsWrite) {
      await writeBlobToCacheChunked(Filesystem, path, blob);
    }

    // PdfOpener is the small local plugin in
    // android/app/src/main/java/com/semyonsw/habitmaker/PdfOpenerPlugin.java.
    // It fires a real ACTION_VIEW, which is what actually launches the phone's
    // PDF reader. registerPlugin() hands back a proxy even when the native side
    // is missing (an APK built before that file existed), so the only way to
    // know is to call it and see whether it rejects.
    const PdfOpener = plugin("PdfOpener");
    if (PdfOpener && typeof PdfOpener.open === "function") {
      try {
        const result = await PdfOpener.open({
          path,
          page: Math.max(1, parseInt(options.page, 10) || 1),
        });
        if (result && result.opened) return true;
      } catch {
        /* no viewer installed, or an older APK -- share sheet below */
      }
    }

    const Share = plugin("Share");
    if (!Share) return false;
    const { uri } = await Filesystem.getUri({ path, directory: "CACHE" });
    await Share.share({ title: options.fileName || fileName, files: [uri] });
    return true;
  } catch {
    return false;
  }
}

// Android's WebView has no download manager wired up: Capacitor registers no
// DownloadListener, so `<a download>` with a blob: URL silently does nothing.
// Instead write the file into the app cache and hand it to the system share
// sheet, which lets it be saved to Files/Drive/anywhere without needing a
// storage permission.
//
// Returns true if it handled the save, false if the caller should fall back to
// the normal browser anchor-download path.
export async function saveBlobNatively(blob, filename) {
  if (!isNative()) return false;
  const Filesystem = plugin("Filesystem");
  const Share = plugin("Share");
  if (!Filesystem || !Share) return false;

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
    return true;
  } catch (err) {
    // A user dismissing the share sheet also lands here. Returning true keeps
    // the caller from firing a second, broken anchor download on top of it.
    const message = String((err && err.message) || err || "");
    if (/cancel/i.test(message)) return true;
    return false;
  }
}
