"use strict";

// User-configurable mobile-comfort UI preferences.
//
// Four independent toggles, each "auto" | "on" | "off" (default "auto"):
//   uiBottomNav    - bottom tab navigation bar
//   uiComfortTouch - bigger touch targets + safe-area insets
//   uiTodayList    - "Today" quick-check list on the dashboard
//   uiBottomSheets - bottom-sheet modals + larger grid cells
//
// Each pref is mirrored onto <html> as a data attribute (data-ui-bottomnav,
// data-ui-comforttouch, data-ui-todaylist, data-ui-bottomsheets). CSS resolves
// "auto" against the @media (max-width: 768px) breakpoint, so toggling a pref
// reflows the layout live with no reload, and desktop is untouched unless a
// pref is explicitly set to "on". Prefs persist through db.patchPrefs, which is
// identical on both backends (PC SQLite + phone IndexedDB).

import * as db from "./db.js";
import { callRenderer } from "./render-registry.js";

const UI_PREF_KEYS = [
  "uiBottomNav",
  "uiComfortTouch",
  "uiTodayList",
  "uiBottomSheets",
];
const VALID = new Set(["auto", "on", "off"]);

// pref key -> document.documentElement.dataset property (camelCase of the
// kebab-case data-ui-* attribute).
const DATASET_PROP = {
  uiBottomNav: "uiBottomnav",
  uiComfortTouch: "uiComforttouch",
  uiTodayList: "uiTodaylist",
  uiBottomSheets: "uiBottomsheets",
};

export const uiPrefs = {
  uiBottomNav: "auto",
  uiComfortTouch: "auto",
  uiTodayList: "auto",
  uiBottomSheets: "auto",
};

function normalize(value) {
  return VALID.has(value) ? value : "auto";
}

export function applyUiPrefAttributes() {
  if (typeof document === "undefined") return;
  for (const key of UI_PREF_KEYS) {
    document.documentElement.dataset[DATASET_PROP[key]] = uiPrefs[key];
  }
}

export function initUiPrefsFromBlob(prefs) {
  const blob = prefs && typeof prefs === "object" ? prefs : {};
  for (const key of UI_PREF_KEYS) {
    uiPrefs[key] = normalize(blob[key]);
  }
  applyUiPrefAttributes();
}

export async function initUiPrefs() {
  try {
    initUiPrefsFromBlob(await db.getPrefs());
  } catch (_) {
    initUiPrefsFromBlob({});
  }
}

export function setUiPref(key, value, persist = true) {
  if (!UI_PREF_KEYS.includes(key)) return;
  uiPrefs[key] = normalize(value);
  applyUiPrefAttributes();
  // The Today list is JS-rendered (not pure CSS), so refresh it when toggled
  // live; the other three are resolved entirely in CSS.
  if (key === "uiTodayList") {
    callRenderer("renderTodayQuickCheck");
  }
  if (persist) {
    db.patchPrefs({ [key]: uiPrefs[key] }).catch(() => {});
  }
}

// Reflect current pref values into the Appearance radio controls.
export function syncUiAppearanceControls() {
  if (typeof document === "undefined") return;
  for (const key of UI_PREF_KEYS) {
    document.querySelectorAll(`input[name="${key}"]`).forEach((input) => {
      input.checked = input.value === uiPrefs[key];
    });
  }
}

// Wire the Appearance radios: reflect current state and persist + apply on change.
export function bindUiAppearanceControls() {
  if (typeof document === "undefined") return;
  for (const key of UI_PREF_KEYS) {
    document.querySelectorAll(`input[name="${key}"]`).forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) setUiPref(key, input.value);
      });
    });
  }
  syncUiAppearanceControls();
}
