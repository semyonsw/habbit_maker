"use strict";

import { SIDEBAR_COLLAPSE_KEY } from "./constants.js";
import { globals } from "./state.js";
import { formatTopClockDateTime } from "./utils.js?v=2";

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

export function initSidebarCollapse() {
  globals.sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  applySidebarCollapseState();
}

export function setSidebarCollapsed(collapsed, persist = true) {
  globals.sidebarCollapsed = !!collapsed;
  applySidebarCollapseState();
  if (persist) {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, globals.sidebarCollapsed ? "1" : "0");
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
