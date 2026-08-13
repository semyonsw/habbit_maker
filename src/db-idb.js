"use strict";

// On-device persistence layer (PWA build).
//
// This module used to be a REST client for the local Python backend
// (server/app.py). For the installable/offline Android PWA there is no server,
// so persistence now lives in IndexedDB on the device. The public API below is
// byte-for-byte the same as the old REST client -- same function names,
// signatures, and return shapes -- so none of the ~25 modules that import from
// here need to change.
//
// Storage layout (one database, three stores):
//   kv   {key, value}            -- __state__ blob, prefs, secure settings, meta
//   logs {id, timestamp, ...}    -- app log records (index: by_timestamp)
//   pdfs {fileId, blob, ...}     -- PDF blobs, stored natively (no base64)

import {
  IDB_NAME,
  IDB_VERSION,
  IDB_KV_STORE,
  IDB_LOGS_STORE,
  IDB_PDF_STORE,
  MAX_LOG_RECORDS,
} from "./constants.js";

const PUT_STATE_DEBOUNCE_MS = 150;

// kv key conventions. Anything starting with "__" is reserved (never returned
// by getPrefs / never written by patchPrefs), mirroring the old server rules.
const STATE_KEY = "__state__";
const META_PREFIX = "__meta__:";
const PDF_FILE_ID_RE = /^[A-Za-z0-9_\-]{1,128}$/;

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(IDB_NAME, IDB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(IDB_KV_STORE)) {
        d.createObjectStore(IDB_KV_STORE, { keyPath: "key" });
      }
      if (!d.objectStoreNames.contains(IDB_LOGS_STORE)) {
        const s = d.createObjectStore(IDB_LOGS_STORE, { keyPath: "id" });
        s.createIndex("by_timestamp", "timestamp", { unique: false });
      }
      if (!d.objectStoreNames.contains(IDB_PDF_STORE)) {
        d.createObjectStore(IDB_PDF_STORE, { keyPath: "fileId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      /* an older-version connection in another tab is blocking; ignore */
    };
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

async function kvGet(key) {
  const db = await openDB();
  const tx = db.transaction(IDB_KV_STORE, "readonly");
  const rec = await reqToPromise(tx.objectStore(IDB_KV_STORE).get(key));
  return rec ? rec.value : undefined;
}

async function kvPut(key, value) {
  const db = await openDB();
  const tx = db.transaction(IDB_KV_STORE, "readwrite");
  tx.objectStore(IDB_KV_STORE).put({ key, value });
  await txDone(tx);
}

async function kvGetAll() {
  const db = await openDB();
  const tx = db.transaction(IDB_KV_STORE, "readonly");
  return (await reqToPromise(tx.objectStore(IDB_KV_STORE).getAll())) || [];
}

// ---------------------------------------------------------------------------
// Migration status / legacy import
// ---------------------------------------------------------------------------

export async function getMigrationStatus() {
  const imported = await kvGet(META_PREFIX + "legacy_imported");
  const ver = await kvGet(META_PREFIX + "schema_version");
  return { legacy_imported: !!imported, schemaVersion: Number(ver) || 1 };
}

export async function importLegacy(bundle) {
  const force = !!(bundle && bundle.force);
  const already = await kvGet(META_PREFIX + "legacy_imported");
  if (already && !force) {
    // Preserve the old REST contract: callers that inspect err.status still work.
    const err = new Error("already_imported");
    err.status = 409;
    throw err;
  }

  const db = await openDB();
  const tx = db.transaction([IDB_KV_STORE, IDB_LOGS_STORE], "readwrite");
  const kv = tx.objectStore(IDB_KV_STORE);
  const logsStore = tx.objectStore(IDB_LOGS_STORE);

  // Full reset of kv + logs (PDF blobs are uploaded separately by the caller,
  // exactly as the old server kept the books/ directory out of import_legacy).
  kv.clear();
  logsStore.clear();

  const state =
    bundle && typeof bundle.state === "object" ? bundle.state : null;
  if (state) kv.put({ key: STATE_KEY, value: state });

  const prefs =
    bundle && typeof bundle.prefs === "object" && bundle.prefs ? bundle.prefs : null;
  if (prefs) {
    for (const [k, v] of Object.entries(prefs)) {
      if (!String(k).startsWith("__")) kv.put({ key: String(k), value: v });
    }
  }

  const logs = Array.isArray(bundle && bundle.logs) ? bundle.logs : [];
  for (const entry of logs.slice(-MAX_LOG_RECORDS)) {
    if (entry && typeof entry === "object" && entry.id != null) {
      logsStore.put(entry);
    }
  }

  kv.put({ key: META_PREFIX + "legacy_imported", value: true });
  kv.put({ key: META_PREFIX + "schema_version", value: 1 });

  await txDone(tx);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// App state (single JSON blob), with the same debounce + flush behavior.
// ---------------------------------------------------------------------------

let pendingPutState = null;
let pendingPutStateResolvers = [];
let pendingPutStateTimer = null;

export async function getState() {
  const v = await kvGet(STATE_KEY);
  return v && typeof v === "object" ? v : null;
}

async function flushPutState() {
  pendingPutStateTimer = null;
  const snapshot = pendingPutState;
  const resolvers = pendingPutStateResolvers;
  pendingPutState = null;
  pendingPutStateResolvers = [];
  if (snapshot == null) {
    resolvers.forEach((r) => r.resolve(true));
    return;
  }
  try {
    await kvPut(STATE_KEY, snapshot);
    resolvers.forEach((r) => r.resolve(true));
  } catch (err) {
    resolvers.forEach((r) => r.reject(err));
  }
}

// Debounced full-state save. Multiple rapid calls coalesce into one write.
// Returns a promise that resolves once the next flush completes.
export function putState(state) {
  pendingPutState = state;
  if (pendingPutStateTimer) {
    clearTimeout(pendingPutStateTimer);
  }
  return new Promise((resolve, reject) => {
    pendingPutStateResolvers.push({ resolve, reject });
    pendingPutStateTimer = setTimeout(flushPutState, PUT_STATE_DEBOUNCE_MS);
  });
}

export function flushPendingState() {
  if (pendingPutStateTimer) {
    clearTimeout(pendingPutStateTimer);
    return flushPutState();
  }
  return Promise.resolve();
}

// Best-effort flush when the page is hidden or going away. On Android Chrome
// visibilitychange/pagehide fire reliably (beforeunload does not), so they are
// the primary triggers; we cannot block, but the IndexedDB transaction is
// usually committed before the page is frozen or discarded.
function flushOnHide() {
  if (pendingPutStateTimer) {
    clearTimeout(pendingPutStateTimer);
    flushPutState();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnHide();
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushOnHide);
  window.addEventListener("beforeunload", flushOnHide);
}


// ---------------------------------------------------------------------------
// Preferences (plain key-value; "__"-prefixed keys are reserved)
// ---------------------------------------------------------------------------

export async function getPrefs() {
  const all = await kvGetAll();
  const out = {};
  for (const rec of all) {
    if (rec && typeof rec.key === "string" && !rec.key.startsWith("__")) {
      out[rec.key] = rec.value;
    }
  }
  return out;
}

export async function patchPrefs(partial) {
  const p = partial || {};
  const db = await openDB();
  const tx = db.transaction(IDB_KV_STORE, "readwrite");
  const store = tx.objectStore(IDB_KV_STORE);
  for (const [k, v] of Object.entries(p)) {
    if (String(k).startsWith("__")) continue; // reserved keys (e.g. __state__)
    store.put({ key: String(k), value: v });
  }
  await txDone(tx);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Logs (append-only, capped at MAX_LOG_RECORDS newest-by-timestamp)
// ---------------------------------------------------------------------------

export async function getLogs() {
  const db = await openDB();
  const tx = db.transaction(IDB_LOGS_STORE, "readonly");
  const all = (await reqToPromise(tx.objectStore(IDB_LOGS_STORE).getAll())) || [];
  all.sort((a, b) =>
    String(a && a.timestamp).localeCompare(String(b && b.timestamp)),
  );
  return all.slice(-MAX_LOG_RECORDS);
}

async function trimLogs() {
  const db = await openDB();
  let count;
  {
    const tx = db.transaction(IDB_LOGS_STORE, "readonly");
    count = await reqToPromise(tx.objectStore(IDB_LOGS_STORE).count());
  }
  if (count <= MAX_LOG_RECORDS) return;
  const toDelete = count - MAX_LOG_RECORDS;
  const tx = db.transaction(IDB_LOGS_STORE, "readwrite");
  const idx = tx.objectStore(IDB_LOGS_STORE).index("by_timestamp");
  await new Promise((resolve, reject) => {
    let deleted = 0;
    const curReq = idx.openCursor(); // ascending => oldest first
    curReq.onsuccess = () => {
      const cursor = curReq.result;
      if (cursor && deleted < toDelete) {
        cursor.delete();
        deleted += 1;
        cursor.continue();
      } else {
        resolve();
      }
    };
    curReq.onerror = () => reject(curReq.error);
  });
  await txDone(tx);
}

export async function appendLog(entry) {
  if (!entry || typeof entry !== "object") return { ok: true };
  const db = await openDB();
  const tx = db.transaction(IDB_LOGS_STORE, "readwrite");
  tx.objectStore(IDB_LOGS_STORE).put(entry);
  await txDone(tx);
  await trimLogs();
  return { ok: true };
}

export async function clearLogs() {
  const db = await openDB();
  const tx = db.transaction(IDB_LOGS_STORE, "readwrite");
  tx.objectStore(IDB_LOGS_STORE).clear();
  await txDone(tx);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PDF blobs
// ---------------------------------------------------------------------------

export async function uploadPdf(fileId, blob) {
  if (!PDF_FILE_ID_RE.test(fileId)) {
    throw new Error(`Invalid PDF fileId: ${fileId}`);
  }
  const sizeBytes =
    blob && typeof blob.size === "number" ? blob.size : 0;
  const db = await openDB();
  const tx = db.transaction(IDB_PDF_STORE, "readwrite");
  tx.objectStore(IDB_PDF_STORE).put({
    fileId,
    blob,
    sizeBytes,
    updatedAt: new Date().toISOString(),
  });
  await txDone(tx);
  return { ok: true, sizeBytes };
}

export async function getPdfBlob(fileId) {
  if (!PDF_FILE_ID_RE.test(fileId)) return null;
  const db = await openDB();
  const tx = db.transaction(IDB_PDF_STORE, "readonly");
  const rec = await reqToPromise(tx.objectStore(IDB_PDF_STORE).get(fileId));
  return rec ? rec.blob : null;
}

export async function deletePdf(fileId) {
  if (!PDF_FILE_ID_RE.test(fileId)) return true;
  const db = await openDB();
  const tx = db.transaction(IDB_PDF_STORE, "readwrite");
  tx.objectStore(IDB_PDF_STORE).delete(fileId);
  await txDone(tx);
  return true;
}

// ---------------------------------------------------------------------------
// Generic attachment blobs (any MIME type). The blob store is content-type
// agnostic, so report attachments reuse it -- keyed by their own unique fileId.
// ---------------------------------------------------------------------------

export async function uploadFile(fileId, blob) {
  return uploadPdf(fileId, blob);
}

export async function getFileBlob(fileId) {
  return getPdfBlob(fileId);
}

export async function deleteFile(fileId) {
  return deletePdf(fileId);
}
