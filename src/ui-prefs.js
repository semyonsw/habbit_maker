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

// The single source of truth for "are we in the mobile layout?". Everything in
// JS asks this instead of measuring innerWidth, so a forced Mobile/Desktop
// preference is honoured everywhere rather than only in CSS.
export function isMobileLayout() {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.uiMode === "mobile";
}

export function applyUiMode() {
  if (typeof document === "undefined") return;
  const resolved = resolveMode();
  const prev = document.documentElement.dataset.uiMode;
  document.documentElement.dataset.uiMode = resolved;

  // A real flip (auto crossing the breakpoint, or the user using the switch)
  // changes which surfaces exist: the month grid is not rendered at all in the
  // mobile layout, and the day card is not rendered in the desktop one. So the
  // whole dashboard has to be rebuilt, not just one list.
  //
  // `prev &&` matters: on the very first applyUiMode() (during initUiPrefs(),
  // before bindEvents()) prev is undefined and would always look like a flip,
  // firing a full wasted render -- donut, Chart.js, grid -- moments before
  // app.js renders for real.
  if (prev && prev !== resolved) {
    callRenderer("renderAll");
  }

  // The sidebar collapse rail only exists in the desktop layout, and its state
  // is derived from the resolved mode (see layout.js isDesktopLayout).
  callRenderer("applySidebarCollapseState");
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
