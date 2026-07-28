"use strict";

// Cross-cutting mechanics for the app's dialogs.
//
// Every dialog is a <div class="modal-overlay"><div class="modal">, toggled by
// an .open class (see modals.js). In the mobile layout CSS turns them into
// bottom sheets. This module supplies the behaviour that CSS cannot:
//
//   - body scroll lock, so the page behind a sheet does not scroll
//   - a focus trap, via `inert` on everything outside the open dialog
//   - drag-down-to-dismiss on the sheet header
//   - a --kb-inset custom property tracking the on-screen keyboard, so a
//     sheet's footer is never hidden behind it on iOS
//
// modals.js is the only caller; nothing else should import this directly.

import { isMobileLayout } from "./ui-prefs.js";

/* -------------------------------------------------------------- scroll lock */

let lockCount = 0;
let savedScrollY = 0;

export function lockBodyScroll() {
  lockCount += 1;
  if (lockCount > 1) return;

  savedScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.classList.add("is-modal-open");
  if (isMobileLayout()) {
    // position:fixed is the only thing that reliably holds on iOS Safari;
    // overflow:hidden alone still allows rubber-band scrolling of the page.
    document.body.style.top = `-${savedScrollY}px`;
    document.body.classList.add("is-modal-open-fixed");
  }
}

export function unlockBodyScroll() {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0) return;

  const wasFixed = document.body.classList.contains("is-modal-open-fixed");
  document.body.classList.remove("is-modal-open", "is-modal-open-fixed");
  document.body.style.top = "";
  if (wasFixed) window.scrollTo(0, savedScrollY);
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
export function trapWithin(overlay) {
  releaseTrap();
  if (!overlay) return;

  if (SUPPORTS_INERT) {
    Array.from(document.body.children).forEach((child) => {
      if (child === overlay) return;
      // The global loader must stay visible/announced if it is showing.
      if (child.id === "globalLoadingOverlay") return;
      if (child.inert) return;
      child.inert = true;
      inertedNodes.push(child);
    });
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
        ? "transform var(--motion-base) var(--ease-emphasized)"
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
    if (!isMobileLayout()) return;
    const header = e.target.closest(".modal-header");
    if (!header) return;
    // The close button is a button; let it do its own job.
    if (e.target.closest(".modal-close")) return;
    const candidate = header.closest(".modal");
    if (!candidate) return;
    const parentOverlay = candidate.closest(".modal-overlay.open");
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
