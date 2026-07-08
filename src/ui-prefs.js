"use strict";

// User-configurable UI "Version" switch.
//
// A single preference, uiMode ∈ {"auto", "mobile", "desktop"} (default "auto"):
//   auto    - comfortable mobile layout on phone-sized screens, classic
//             desktop layout otherwise (preserves the historical behaviour)
//   mobile  - always use the mobile layout (even on a desktop)
//   desktop - always use the classic desktop layout (even on a phone)
//
// The RESOLVED layout ("mobile" | "desktop") is mirrored onto <html> as
// data-ui-mode; every mobile rule in styles.css is gated on
// html[data-ui-mode="mobile"]. In "auto" we follow the (max-width: 768px)
// breakpoint live via matchMedia, so rotating/resizing reflows the layout with
// no reload. The preference persists through db.patchPrefs, which is identical
// on both backends (PC SQLite + phone IndexedDB).

import * as db from "./db.js";
import { callRenderer } from "./render-registry.js";

const VALID = new Set(["auto", "mobile", "desktop"]);
const MOBILE_QUERY = "(max-width: 768px)";

export const uiPrefs = {
  uiMode: "auto",
};

let mql = null;

function normalize(value) {
  return VALID.has(value) ? value : "auto";
}

function viewportIsNarrow() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

// Resolve the abstract preference to a concrete layout for the current viewport.
function resolveMode() {
  if (uiPrefs.uiMode === "mobile") return "mobile";
  if (uiPrefs.uiMode === "desktop") return "desktop";
  return viewportIsNarrow() ? "mobile" : "desktop";
}

export function applyUiMode() {
  if (typeof document === "undefined") return;
  const resolved = resolveMode();
  const prev = document.documentElement.dataset.uiMode;
  document.documentElement.dataset.uiMode = resolved;
  // The "Today" quick-check list is JS-rendered and only shown in the mobile
  // layout; refresh it whenever the resolved layout changes (auto crossing the
  // breakpoint, or the user flipping the switch) so it is never stale.
  if (prev !== resolved) {
    callRenderer("renderTodayQuickCheck");
  }
}

// In "auto" mode, follow the breakpoint live (orientation change / resize).
function ensureBreakpointListener() {
  if (mql || typeof window === "undefined" || !window.matchMedia) return;
  mql = window.matchMedia(MOBILE_QUERY);
  const onChange = () => {
    if (uiPrefs.uiMode === "auto") applyUiMode();
  };
  if (mql.addEventListener) mql.addEventListener("change", onChange);
  else if (mql.addListener) mql.addListener(onChange); // older Safari
}

export function initUiPrefsFromBlob(prefs) {
  const blob = prefs && typeof prefs === "object" ? prefs : {};
  uiPrefs.uiMode = normalize(blob.uiMode);
  ensureBreakpointListener();
  applyUiMode();
}

export async function initUiPrefs() {
  try {
    initUiPrefsFromBlob(await db.getPrefs());
  } catch (_) {
    initUiPrefsFromBlob({});
  }
}

export function setUiMode(value, persist = true) {
  uiPrefs.uiMode = normalize(value);
  applyUiMode();
  if (persist) {
    db.patchPrefs({ uiMode: uiPrefs.uiMode }).catch(() => {});
  }
}

// Reflect the current preference into the Version segmented control.
export function syncUiAppearanceControls() {
  if (typeof document === "undefined") return;
  document.querySelectorAll('input[name="uiMode"]').forEach((input) => {
    input.checked = input.value === uiPrefs.uiMode;
  });
}

// Wire the Version radios: reflect current state and persist + apply on change.
export function bindUiAppearanceControls() {
  if (typeof document === "undefined") return;
  document.querySelectorAll('input[name="uiMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setUiMode(input.value);
    });
  });
  syncUiAppearanceControls();
}
