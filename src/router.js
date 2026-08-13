"use strict";

// Minimal hash router.
//
// Why the hash and not the History API: this app is served both from the local
// Python server at / and from GitHub Pages under /habbit_maker/. Real paths
// would need base-path awareness and would collide with the service worker's
// "fall back to index.html for navigations" rule (sw.js). A fragment is
// base-path-free and never touches the network.
//
// The point is the Android back button: without this, back exits the installed
// PWA from any view, and a reload always dumps you on Today.
//
// navigateTo() is the cause, switchView() is the effect. Nav handlers call
// navigateTo; only the hashchange listener calls switchView.

import { callRenderer } from "./render-registry.js";

const VIEWS = new Set(["today", "detail", "analytics", "settings"]);

function toHash(view) {
  return `#/${view}`;
}

function fromHash() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "").split("/")[0];
  return VIEWS.has(raw) ? raw : "";
}

export function navigateTo(view) {
  if (!VIEWS.has(view)) return;
  if (fromHash() === view) {
    // Already the current fragment, so no hashchange will fire.
    callRenderer("switchView", view);
    return;
  }
  window.location.hash = toHash(view);
}

export function initRouter() {
  window.addEventListener("hashchange", () => {
    const view = fromHash();
    if (view) callRenderer("switchView", view);
  });

  const start = fromHash();
  if (!start) {
    // replaceState, not assignment: keep exactly one history entry for the
    // initial view so the first back press leaves the app rather than
    // bouncing between "no hash" and "#/today".
    window.history.replaceState(null, "", toHash("today"));
  } else if (start !== "today") {
    callRenderer("switchView", start);
  }
}
