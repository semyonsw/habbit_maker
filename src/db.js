"use strict";

// Persistence router.
//
// The app runs in two environments with the SAME codebase:
//   * PC  (served by the local Python server on localhost): persists through
//     the REST backend to a real SQLite file -- exactly as it always did.
//   * Phone / any non-localhost host (the installable PWA on GitHub Pages):
//     persists on-device in IndexedDB, with no server.
//
// The two are completely independent stores; move data between them with the
// app's Export / Import. This module picks one implementation up front (by
// hostname) and re-exports it, so the other ~25 modules import from here
// unchanged and never need to know which backend is live.

import * as rest from "./db-rest.js";
import * as idb from "./db-idb.js";

function detectMode() {
  if (typeof location === "undefined" || !location.hostname) return "idb";
  // The Android APK (Capacitor) serves the same files from a WebView. There is
  // no Python server on the phone, so it must never resolve to "rest". This is
  // checked FIRST because Capacitor's default hostname is literally "localhost"
  // -- the one value that would otherwise select the dead REST backend. The
  // capacitor.config.json in this repo also overrides that hostname, so either
  // signal alone is enough; both are kept because a silent fallback to REST
  // makes the packaged app look completely broken on launch.
  if (typeof globalThis !== "undefined" && globalThis.Capacitor) return "idb";
  const h = location.hostname;
  // Local Python-server build -> SQLite via REST. Everything else -> IndexedDB.
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
    return "rest";
  }
  return "idb";
}

const MODE = detectMode();
const impl = MODE === "rest" ? rest : idb;

// 'rest' (PC, SQLite) or 'idb' (phone/PWA, IndexedDB). Synchronous so callers
// (e.g. app.js boot) can branch on it without awaiting.
export function getBackendMode() {
  return MODE;
}

// Re-export the active implementation. Arrow wrappers keep the call exactly as
// before (these are plain module functions, no `this`), preserving signatures,
// return shapes, and putState's synchronous debounce setup.
export const getMigrationStatus = (...a) => impl.getMigrationStatus(...a);
export const importLegacy = (...a) => impl.importLegacy(...a);
export const getState = (...a) => impl.getState(...a);
export const putState = (...a) => impl.putState(...a);
export const flushPendingState = (...a) => impl.flushPendingState(...a);
export const getPrefs = (...a) => impl.getPrefs(...a);
export const patchPrefs = (...a) => impl.patchPrefs(...a);
export const getLogs = (...a) => impl.getLogs(...a);
export const appendLog = (...a) => impl.appendLog(...a);
export const clearLogs = (...a) => impl.clearLogs(...a);
export const uploadPdf = (...a) => impl.uploadPdf(...a);
export const getPdfBlob = (...a) => impl.getPdfBlob(...a);
export const deletePdf = (...a) => impl.deletePdf(...a);
// Generic attachment blobs (any MIME type) -- used by the Report section.
export const uploadFile = (...a) => impl.uploadFile(...a);
export const getFileBlob = (...a) => impl.getFileBlob(...a);
export const deleteFile = (...a) => impl.deleteFile(...a);
