"use strict";

// REST client for the local Python backend (server/app.py).
// All persistence used to be browser-resident (localStorage + IndexedDB);
// it now flows through this module to a real SQLite file on disk.

const API_BASE = "/api";
const PUT_STATE_DEBOUNCE_MS = 150;

let pendingPutState = null;
let pendingPutStateResolvers = [];
let pendingPutStateTimer = null;

async function jsonFetch(url, options = {}) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(
      `HTTP ${resp.status} ${resp.statusText} for ${url}: ${text.slice(0, 200)}`,
    );
    err.status = resp.status;
    throw err;
  }
  if (resp.status === 204) return null;
  const ctype = resp.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    return resp.json();
  }
  return resp.text();
}

export async function getMigrationStatus() {
  return jsonFetch(`${API_BASE}/migration-status`);
}

export async function importLegacy(bundle) {
  return jsonFetch(`${API_BASE}/import-legacy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
}

export async function getState() {
  const data = await jsonFetch(`${API_BASE}/state`);
  return data && typeof data === "object" ? data : null;
}

async function flushPutState() {
  pendingPutStateTimer = null;
  const snapshot = pendingPutState;
  const resolvers = pendingPutStateResolvers;
  pendingPutState = null;
  pendingPutStateResolvers = [];
  try {
    await jsonFetch(`${API_BASE}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    resolvers.forEach((r) => r.resolve(true));
  } catch (err) {
    resolvers.forEach((r) => r.reject(err));
  }
}

// Debounced full-state PUT. Multiple rapid calls coalesce into one network
// round-trip. Returns a promise that resolves once the next flush completes.
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

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (pendingPutStateTimer) {
      clearTimeout(pendingPutStateTimer);
      const snapshot = pendingPutState;
      pendingPutState = null;
      pendingPutStateResolvers = [];
      pendingPutStateTimer = null;
      if (snapshot && navigator.sendBeacon) {
        try {
          const blob = new Blob([JSON.stringify(snapshot)], {
            type: "application/json",
          });
          navigator.sendBeacon(`${API_BASE}/state`, blob);
        } catch (_) {
          /* best-effort flush on tab close */
        }
      }
    }
  });
}

export async function getSecureSettings() {
  const data = await jsonFetch(`${API_BASE}/secure-settings`);
  return data && typeof data === "object" ? data : {};
}

export async function putSecureSettings(blob) {
  return jsonFetch(`${API_BASE}/secure-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blob || {}),
  });
}

export async function getPrefs() {
  const data = await jsonFetch(`${API_BASE}/prefs`);
  return data && typeof data === "object" ? data : {};
}

export async function patchPrefs(partial) {
  return jsonFetch(`${API_BASE}/prefs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partial || {}),
  });
}

export async function getLogs() {
  const data = await jsonFetch(`${API_BASE}/logs`);
  return Array.isArray(data) ? data : [];
}

export async function appendLog(entry) {
  return jsonFetch(`${API_BASE}/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry || {}),
  });
}

export async function clearLogs() {
  return jsonFetch(`${API_BASE}/logs`, { method: "DELETE" });
}

export async function uploadPdf(fileId, blob) {
  const resp = await fetch(`${API_BASE}/pdf/${encodeURIComponent(fileId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: blob,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `PDF upload failed: HTTP ${resp.status} ${resp.statusText} ${text.slice(0, 200)}`,
    );
  }
  return resp.json();
}

export async function getPdfBlob(fileId) {
  const resp = await fetch(`${API_BASE}/pdf/${encodeURIComponent(fileId)}`);
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`PDF fetch failed: HTTP ${resp.status} ${resp.statusText}`);
  }
  return resp.blob();
}

export async function deletePdf(fileId) {
  const resp = await fetch(`${API_BASE}/pdf/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(
      `PDF delete failed: HTTP ${resp.status} ${resp.statusText}`,
    );
  }
  return true;
}
