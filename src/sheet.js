"use strict";

// Cross-cutting mechanics for the app's overlays.
//
// The add/edit habit sheet is <div class="sheet-overlay"><div class="sheet">,
// toggled by an .open class (see modals.js). This module supplies the
// behaviour that CSS cannot:
//
//   - body scroll lock, so the page behind a sheet does not scroll
//   - a focus trap, via `inert` on everything outside the open dialog
//   - drag-down-to-dismiss on the sheet's grab handle
//   - a --kb-inset custom property tracking the on-screen keyboard, so a
//     sheet's footer is never hidden behind it on iOS
//
// modals.js is the only caller; nothing else should import this directly.

/* -------------------------------------------------------------- scroll lock */

// Selector for "an overlay is on screen right now". The lock is derived from
// this rather than from a counter.
//
// A counter is the obvious implementation and it was the wrong one: it holds a
// number that is only correct if every open is matched by exactly one close,
// forever. One unbalanced call -- a close on an overlay that was not open, an
// open that throws before its close is wired, a dialog opened over a sheet and
// dismissed in an order nobody tested -- and the count never returns to zero.
// The body then stays `position: fixed` with the overlays gone: the app looks
// completely dead and only a reload fixes it. Reading the DOM instead makes the
// lock self-correcting, because the DOM is the thing the user can actually see.
const OPEN_OVERLAY = ".sheet-overlay.open, .dialog-overlay.open";

let savedScrollY = 0;

function isLocked() {
  return document.body.classList.contains("is-modal-open");
}

export function lockBodyScroll() {
  if (isLocked()) return; // already held by another overlay

  savedScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.classList.add("is-modal-open");
  // position:fixed is the only thing that reliably holds on iOS Safari;
  // overflow:hidden alone still allows rubber-band scrolling of the page.
  document.body.style.top = `-${savedScrollY}px`;
  document.body.classList.add("is-modal-open-fixed");
}

// Callers must remove the overlay's `.open` class BEFORE calling this, so the
// query below sees the world as it now is.
export function unlockBodyScroll() {
  if (!isLocked()) return;
  // Something else is still open (a confirm dismissed over the habit sheet).
  if (document.querySelector(OPEN_OVERLAY)) return;

  const wasFixed = document.body.classList.contains("is-modal-open-fixed");
  document.body.classList.remove("is-modal-open", "is-modal-open-fixed");
  document.body.style.top = "";
  if (wasFixed) window.scrollTo(0, savedScrollY);
}

// The topmost overlay still open, or null. Used to hand the focus trap back
// when a dialog closes over a sheet that is still up.
export function topOpenOverlay() {
  const dialog = document.querySelector(".dialog-overlay.open");
  if (dialog) return dialog;
  return document.querySelector(".sheet-overlay.open");
}

/* -------------------------------------------------------------- focus trap */

const SUPPORTS_INERT =
  typeof HTMLElement !== "undefined" && "inert" in HTMLElement.prototype;

let inertedNodes = [];
let fallbackKeydown = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details, summary, [tabindex]:not([tabindex="-1"])';

// Make everything except `overlay` unreachable by Tab, screen readers and
// pointer. Cheaper and more correct than a hand-rolled Tab cycle.
//
// This walks the overlay's ANCESTOR CHAIN and inerts the siblings at each
// level. It must not simply inert every child of <body>, because the overlays
// are not children of <body> -- index.html nests both #habitSheet and
// #confirmDialog inside #app, alongside <main> and the bottom nav. Inerting
// body's children therefore inerted #app, and #app *contains* the dialog being
// opened, so `inert` inherits straight down into it: the sheet rendered, the
// scrim was up, body scroll was locked, and not one control inside it could be
// clicked, focused or typed into. That is the "Add habit freezes the screen"
// bug -- the sheet was disabling itself, and the only way out was a reload.
export function trapWithin(overlay) {
  releaseTrap();
  if (!overlay) return;

  if (SUPPORTS_INERT) {
    let node = overlay;
    while (node && node !== document.body && node.parentElement) {
      const parent = node.parentElement;
      Array.from(parent.children).forEach((sibling) => {
        // Never the branch the dialog is on.
        if (sibling === node) return;
        // The global loader must stay visible/announced if it is showing.
        if (sibling.id === "globalLoadingOverlay") return;
        if (sibling.inert) return;
        sibling.inert = true;
        inertedNodes.push(sibling);
      });
      node = parent;
    }
    return;
  }

  // Fallback for engines without inert: cycle Tab inside the dialog.
  fallbackKeydown = (e) => {
    if (e.key !== "Tab") return;
    const items = Array.from(overlay.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", fallbackKeydown, true);
}

export function releaseTrap() {
  inertedNodes.forEach((node) => {
    node.inert = false;
  });
  inertedNodes = [];
  if (fallbackKeydown) {
    document.removeEventListener("keydown", fallbackKeydown, true);
    fallbackKeydown = null;
  }
}

/* --------------------------------------------------------- keyboard inset */

// On iOS the layout viewport does not shrink when the keyboard opens, so a
// bottom sheet's footer ends up behind it. Publish the overlap as --kb-inset
// and let CSS subtract it.
export function initKeyboardInset() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return;

  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb-inset", `${inset}px`);
  };

  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

/* ------------------------------------------------------- drag to dismiss */

// Delegated once at boot. Dragging the header of a bottom sheet downwards far
// enough (or fast enough) dismisses it, which is the same "cancel" semantics
// the backdrop click already has.
export function bindSheetGestures(onDismiss) {
  if (typeof document === "undefined") return;

  let sheet = null;
  let overlay = null;
  let startY = 0;
  let startT = 0;
  let dy = 0;
  let pointerId = null;

  const reset = (animate) => {
    if (sheet) {
      sheet.style.transition = animate
        ? "transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)"
        : "";
      sheet.style.transform = "";
      const el = sheet;
      setTimeout(() => {
        el.style.transition = "";
      }, 260);
    }
    sheet = null;
    overlay = null;
    pointerId = null;
    dy = 0;
  };

  document.addEventListener("pointerdown", (e) => {
    // Only the grab handle starts a drag; the rest of the sheet scrolls.
    const handle = e.target.closest(".sheet-handle");
    if (!handle) return;
    const candidate = handle.closest(".sheet");
    if (!candidate) return;
    const parentOverlay = candidate.closest(".sheet-overlay.open");
    if (!parentOverlay) return;

    sheet = candidate;
    overlay = parentOverlay;
    startY = e.clientY;
    startT = e.timeStamp;
    dy = 0;
    pointerId = e.pointerId;
    // Kill the entry animation so it cannot fight the drag.
    sheet.style.animation = "none";
  });

  document.addEventListener("pointermove", (e) => {
    if (!sheet || e.pointerId !== pointerId) return;
    dy = e.clientY - startY;
    if (dy <= 0) {
      sheet.style.transform = "";
      return;
    }
    sheet.style.transform = `translateY(${dy}px)`;
  });

  const finish = (e) => {
    if (!sheet || (pointerId !== null && e.pointerId !== pointerId)) return;
    const elapsed = Math.max(1, e.timeStamp - startT);
    const velocity = dy / elapsed; // px per ms
    const shouldDismiss = dy > 90 || (dy > 24 && velocity > 0.5);
    const target = overlay;
    reset(!shouldDismiss);
    if (shouldDismiss && target && typeof onDismiss === "function") {
      onDismiss(target.id);
    }
  };

  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
}
