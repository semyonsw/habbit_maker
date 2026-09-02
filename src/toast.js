"use strict";

// A single transient message at the bottom of the screen, optionally with one
// action button.
//
// This exists because two of the app's taps are destructive and were silent:
// tapping a count habit that is already at its target resets it to zero (so a
// 50-target habit could lose fifty taps to one mis-tap), and marking a day
// skipped changes what the streak means. Both now say what they did and offer
// it back.
//
// One toast at a time, on purpose: a stack of them covers the habit list, which
// is the thing you are trying to look at.

import { UNDO_WINDOW_MS } from "./constants.js";
import { sanitize } from "./utils.js";

let node = null;
let hideTimer = 0;
let action = null;

function ensureNode() {
  if (node && node.isConnected) return node;
  node = document.createElement("div");
  node.className = "toast";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.innerHTML =
    '<span class="toast-text"></span>' +
    '<button type="button" class="toast-action" hidden></button>';
  node.querySelector(".toast-action").addEventListener("click", () => {
    const fn = action;
    dismissToast();
    if (typeof fn === "function") fn();
  });
  document.body.appendChild(node);
  return node;
}

export function dismissToast() {
  clearTimeout(hideTimer);
  action = null;
  if (!node) return;
  node.classList.remove("is-open");
  // Left in the DOM rather than removed: the class toggle is what animates it
  // out, and removing the element mid-transition makes it vanish instantly.
}

export function showToast(message, options = {}) {
  const el = ensureNode();
  clearTimeout(hideTimer);

  el.querySelector(".toast-text").innerHTML = sanitize(message);

  const button = el.querySelector(".toast-action");
  action = typeof options.onAction === "function" ? options.onAction : null;
  if (action) {
    button.textContent = options.actionLabel || "Undo";
    button.hidden = false;
  } else {
    button.hidden = true;
  }

  // Force a reflow so re-showing while already open replays the animation.
  void el.offsetWidth;
  el.classList.add("is-open");

  hideTimer = setTimeout(dismissToast, options.duration || UNDO_WINDOW_MS);
}
