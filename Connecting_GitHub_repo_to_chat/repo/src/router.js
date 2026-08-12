"use strict";

import { globals } from "./state.js";
import { registerRenderer } from "./render-registry.js";
import { renderToday } from "./render-today.js";
import { renderDetail } from "./render-detail.js";
import { renderAnalytics } from "./render-analytics.js";
import { renderSettings } from "./render-settings.js";

const VIEWS = ["today", "analytics", "settings"];

function parseHash() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  const [head, id] = raw.split("/");
  if (head === "habit" && id) return { view: "detail", id };
  if (VIEWS.includes(head)) return { view: head, id: null };
  return { view: "", id: null };
}

export function navigateTo(view, id) {
  const hash = view === "detail" ? `#/habit/${id}` : `#/${view}`;
  if (window.location.hash === hash) {
    render();
    return;
  }
  window.location.hash = hash;
}

export function render() {
  const view = document.getElementById("view");
  if (!view) return;
  const scrollTop = 0;
  if (globals.view === "detail") view.innerHTML = renderDetail(globals.detailHabitId);
  else if (globals.view === "analytics") view.innerHTML = renderAnalytics();
  else if (globals.view === "settings") view.innerHTML = renderSettings();
  else view.innerHTML = renderToday();
  view.scrollTop = scrollTop;

  const active = globals.view === "detail" ? "today" : globals.view;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("on", tab.dataset.view === active);
  });
}

function apply() {
  const { view, id } = parseHash();
  globals.view = view || "today";
  globals.detailHabitId = id;
  render();
}

export function initRouter() {
  window.addEventListener("hashchange", apply);
  if (!parseHash().view) {
    window.history.replaceState(null, "", "#/today");
  }
  apply();
}

registerRenderer("render", render);
