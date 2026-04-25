"use strict";

import { globals } from "./state.js";
import { formatTopClockDateTime } from "./utils.js?v=2";
import * as db from "./db.js";

export function isDesktopViewport() {
  return window.innerWidth > 768;
}

export function applySidebarCollapseState() {
  const sidebar = document.querySelector(".sidebar");
  const toggle = document.getElementById("sidebarCollapseToggle");
  if (!sidebar || !toggle) return;
  const effective = globals.sidebarCollapsed && isDesktopViewport();
  sidebar.classList.toggle("collapsed", effective);
  toggle.setAttribute("aria-expanded", String(!effective));
}

export function initSidebarCollapseFromBlob(prefs) {
  const blob = prefs && typeof prefs === "object" ? prefs : {};
  globals.sidebarCollapsed = blob.sidebarCollapsed === true;
  applySidebarCollapseState();
}

export async function initSidebarCollapse() {
  try {
    const prefs = await db.getPrefs();
    initSidebarCollapseFromBlob(prefs);
  } catch (_) {
    initSidebarCollapseFromBlob({});
  }
}

export function setSidebarCollapsed(collapsed, persist = true) {
  globals.sidebarCollapsed = !!collapsed;
  applySidebarCollapseState();
  if (persist) {
    db.patchPrefs({ sidebarCollapsed: globals.sidebarCollapsed }).catch(
      () => {},
    );
  }
}

export function updateTopClock() {
  const topDateTime = document.getElementById("topDateTime");
  if (!topDateTime) return;
  topDateTime.textContent = formatTopClockDateTime(new Date());
}

export function initTopClock() {
  updateTopClock();
  if (globals.topClockTimer) {
    clearInterval(globals.topClockTimer);
  }
  globals.topClockTimer = setInterval(updateTopClock, 1000);
}
