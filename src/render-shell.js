"use strict";

// View switching and the one "redraw everything" entry point.
//
// The app is four screens inside a single column: Today, a habit detail page,
// Analytics and Settings. Detail is not a nav destination -- it is reached by
// tapping a habit row -- so the bottom nav keeps Today lit while it is open.

import { globals } from "./state.js";
import { callRenderer, registerRenderer } from "./render-registry.js";

// Which nav button stays lit for a given view.
const NAV_FOR_VIEW = {
  today: "today",
  detail: "today",
  analytics: "analytics",
  settings: "settings",
};

export function switchView(viewId) {
  const section = document.getElementById(`view-${viewId}`);
  if (!section) return;

  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.toggle("active", v === section));

  const navFor = NAV_FOR_VIEW[viewId] || viewId;
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => b.classList.toggle("is-active", b.dataset.view === navFor));

  // Leaving detail clears the selection so a later tap on Today does not
  // reopen the previous habit.
  if (viewId !== "detail") globals.detailHabitId = null;

  const main = document.querySelector(".app-main");
  if (main) main.scrollTop = 0;

  if (viewId === "today") callRenderer("renderToday");
  if (viewId === "detail") callRenderer("renderDetail");
  if (viewId === "analytics") callRenderer("renderAnalytics");
  if (viewId === "settings") callRenderer("renderSettings");
}

// Redraw whichever screen is on-screen. Called after any state write, so it
// must stay cheap: only the active view is rebuilt.
export function renderAll() {
  const active = document.querySelector(".view.active");
  const id = active ? active.id.replace(/^view-/, "") : "today";
  if (id === "today") callRenderer("renderToday");
  else if (id === "detail") callRenderer("renderDetail");
  else if (id === "analytics") callRenderer("renderAnalytics");
  else if (id === "settings") callRenderer("renderSettings");
}

registerRenderer("switchView", switchView);
registerRenderer("renderAll", renderAll);
