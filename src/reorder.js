"use strict";

// Press-and-hold, then drag a habit up or down the Today list.
//
// Pointer events and transforms rather than HTML5 drag-and-drop, which does not
// fire on touch at all -- and this is a phone-first app.
//
// The gesture has to share the row with the one that was already there:
//
//   hold the CHECKBOX  ->  skip the day        (render-today.js)
//   hold the ROW BODY  ->  pick it up to move  (here)
//
// which is a clean split, because the control is about today's value and the
// row is about the habit itself. They never collide: a pointerdown lands on one
// or the other, and each handler ignores what is not its own.
//
// Holding rather than dragging immediately is what keeps the list scrollable --
// a finger that moves before the timer is scrolling, and cancels the hold.

import { HOLD_TO_DRAG_MS, DRAG_SLOP_PX } from "./constants.js";
import { applyVisibleOrder } from "./habits.js";
import { callRenderer } from "./render-registry.js";
import { showToast } from "./toast.js";

const ROW = ".habit-row";
const GRIP = ".habit-open";
const EDGE_PX = 72; // auto-scroll zone at the top and bottom of the scroller
const EDGE_SPEED = 14; // px per frame

let drag = null;
let holdTimer = 0;
let holdStart = null;
let pendingRow = null;
// A drag ends with a click the browser has already queued; left alone it would
// open the habit's detail screen the instant you drop it.
//
// Time-bounded rather than a plain flag waiting to be consumed. Dropping
// re-renders the list, which detaches the row the click was aimed at, so that
// click may never reach the delegated handler at all -- and a flag nothing
// clears stays armed and silently swallows the NEXT tap the user makes,
// anywhere. An expiry cannot get stuck.
const CLICK_SUPPRESS_MS = 400;
let swallowClickUntil = 0;

/* ------------------------------------------------------------------ FLIP */

// Animate the rows that were displaced by a reinsertion: measure, mutate,
// invert, play. Without it every other row teleports and the list reads as
// broken rather than as rearranging.
function flip(list, skip, mutate) {
  const rows = Array.from(list.children).filter((el) => el !== skip);
  const before = new Map(rows.map((el) => [el, el.getBoundingClientRect().top]));

  mutate();

  rows.forEach((el) => {
    const delta = before.get(el) - el.getBoundingClientRect().top;
    if (!delta) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "transform 0.18s ease";
      el.style.transform = "";
    });
  });
}

function clearRowStyles(list) {
  Array.from(list.children).forEach((el) => {
    el.style.transition = "";
    el.style.transform = "";
  });
}

/* ------------------------------------------------------------- the drag */

function rowsIn(list) {
  return Array.from(list.querySelectorAll(ROW));
}

function beginDrag(row, event) {
  const list = row.parentElement;
  if (!list) return;

  drag = {
    row,
    list,
    pointerId: event.pointerId,
    // translateY = pointerY - originY. Reinsertions adjust originY so the row
    // does not jump when the layout under it changes.
    originY: event.clientY,
    pointerY: event.clientY,
    scroller: document.querySelector(".app-main"),
    frame: 0,
    moved: false,
  };

  row.classList.add("is-dragging");
  list.classList.add("is-reordering");
  try {
    row.setPointerCapture(event.pointerId);
  } catch (_) {
    // Capture is an optimisation; the document-level listeners still work.
  }
  if (navigator.vibrate) {
    try {
      navigator.vibrate(12);
    } catch (_) {
      /* blocked; the lift animation is feedback enough */
    }
  }

  applyTransform();
  drag.frame = requestAnimationFrame(tick);
}

function applyTransform() {
  if (!drag) return;
  drag.row.style.transform = `translateY(${drag.pointerY - drag.originY}px)`;
}

// Reinsert the dragged row for every neighbour midpoint its centre has passed.
//
// Loops rather than moving one place per call: pointermove is not guaranteed to
// fire once per row-height, and a quick flick can cross three rows between two
// events. Settling only one of them per move leaves the row lagging visibly
// behind the finger and, if the drag ends on that same event, dropping in the
// wrong place. Bounded by the row count, so it always terminates.
function reorderIfNeeded() {
  if (!drag) return;
  const limit = rowsIn(drag.list).length;
  for (let pass = 0; pass < limit; pass += 1) {
    if (!reorderOnce()) return;
  }
}

// One reinsertion. Returns true if the list changed.
function reorderOnce() {
  if (!drag) return false;
  const { row, list } = drag;
  const rect = row.getBoundingClientRect();
  const centre = rect.top + rect.height / 2;

  // Index comparison rather than compareDocumentPosition + a
  // DOCUMENT_POSITION_* bitmask: the constants are not present on every DOM
  // implementation, and `x & undefined` is NaN, which is quietly falsy. This
  // says the same thing and cannot fail that way.
  const rows = rowsIn(list);
  const rowIndex = rows.indexOf(row);

  for (let i = 0; i < rows.length; i += 1) {
    const other = rows[i];
    if (other === row) continue;
    const r = other.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const isAfter = i > rowIndex;

    const shouldMoveDown = isAfter && centre > mid;
    const shouldMoveUp = !isAfter && centre < mid;
    if (!shouldMoveDown && !shouldMoveUp) continue;

    // Measure the row's LAYOUT position either side of the move, with its
    // transform removed, so originY can be shifted by exactly the amount the
    // layout moved. Skip this and the row jumps a full row-height every swap.
    row.style.transform = "";
    const layoutBefore = row.getBoundingClientRect().top;

    flip(list, row, () => {
      if (shouldMoveDown) list.insertBefore(row, other.nextSibling);
      else list.insertBefore(row, other);
    });

    const layoutAfter = row.getBoundingClientRect().top;
    drag.originY += layoutAfter - layoutBefore;
    applyTransform();
    return true;
  }
  return false;
}

// Keep dragging past the edge of the screen. Runs every frame rather than on
// pointermove, because a finger held still at the edge produces no move events
// and the list would simply stop.
function tick() {
  if (!drag) return;
  const { scroller, pointerY } = drag;

  if (scroller) {
    const rect = scroller.getBoundingClientRect();
    let delta = 0;
    if (pointerY < rect.top + EDGE_PX) delta = -EDGE_SPEED;
    else if (pointerY > rect.bottom - EDGE_PX) delta = EDGE_SPEED;

    if (delta) {
      const before = scroller.scrollTop;
      scroller.scrollTop += delta;
      // The row is positioned against the pointer, which has not moved -- so
      // when the list scrolls under it, the origin has to follow.
      drag.originY -= scroller.scrollTop - before;
      applyTransform();
      reorderIfNeeded();
    }
  }

  drag.frame = requestAnimationFrame(tick);
}

function endDrag(commit) {
  if (!drag) return;
  const { row, list, frame, pointerId, moved } = drag;
  cancelAnimationFrame(frame);
  try {
    row.releasePointerCapture(pointerId);
  } catch (_) {
    /* never captured, or already released */
  }

  const ids = rowsIn(list)
    .map((el) => el.querySelector("[data-open]")?.dataset.open)
    .filter(Boolean);

  row.classList.remove("is-dragging");
  list.classList.remove("is-reordering");
  clearRowStyles(list);
  drag = null;

  if (moved) swallowClickUntil = Date.now() + CLICK_SUPPRESS_MS;
  if (!commit || !moved) {
    // Put everything back where the state says it belongs.
    callRenderer("renderAll");
    return;
  }

  if (applyVisibleOrder(ids)) {
    showToast("Order saved.", { duration: 2200 });
  }
  callRenderer("renderAll");
}

/* ---------------------------------------------------------------- wiring */

function cancelHold() {
  clearTimeout(holdTimer);
  holdTimer = 0;
  holdStart = null;
  if (pendingRow) pendingRow.classList.remove("is-lifting");
  pendingRow = null;
}

export function bindHabitReorder(section) {
  if (!section) return;

  section.addEventListener("pointerdown", (event) => {
    // Only the row body. The checkbox belongs to hold-to-skip.
    const grip = event.target.closest(GRIP);
    if (!grip) return;
    const row = grip.closest(ROW);
    const list = row && row.parentElement;
    // Nothing to reorder with fewer than two rows.
    if (!row || !list || list.querySelectorAll(ROW).length < 2) return;

    pendingRow = row;
    row.classList.add("is-lifting");
    holdStart = { x: event.clientX, y: event.clientY };
    holdTimer = setTimeout(() => {
      const target = pendingRow;
      cancelHold();
      if (target) beginDrag(target, event);
    }, HOLD_TO_DRAG_MS);
  });

  section.addEventListener("pointermove", (event) => {
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      drag.pointerY = event.clientY;
      drag.moved = true;
      applyTransform();
      reorderIfNeeded();
      return;
    }
    // Before the hold fires, movement means a scroll, not a drag.
    if (!holdTimer || !holdStart) return;
    if (
      Math.abs(event.clientX - holdStart.x) > DRAG_SLOP_PX ||
      Math.abs(event.clientY - holdStart.y) > DRAG_SLOP_PX
    ) {
      cancelHold();
    }
  });

  ["pointerup", "pointercancel"].forEach((type) => {
    section.addEventListener(type, (event) => {
      cancelHold();
      if (drag && event.pointerId === drag.pointerId) {
        endDrag(type === "pointerup");
      }
    });
  });

  // Once a drag is under way the browser must stop treating the gesture as a
  // scroll. touch-action alone is decided when the gesture starts -- by which
  // time the hold has not fired yet -- so the move is also cancelled here.
  // Non-passive, or preventDefault() is ignored.
  section.addEventListener(
    "touchmove",
    (event) => {
      if (drag) event.preventDefault();
    },
    { passive: false },
  );
}

// True for a moment after a drag: the click the browser queues on drop must not
// also open the habit.
export function consumeDragClick() {
  if (Date.now() >= swallowClickUntil) return false;
  swallowClickUntil = 0;
  return true;
}

export function isDragging() {
  return !!drag;
}
