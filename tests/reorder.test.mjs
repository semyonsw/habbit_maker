// Reordering habits: the ordering rule, the keyboard path, and the drag.
//
// The drag is geometry, so the rows are given real rectangles here (linkedom
// reports every element as 0x0). That makes the part most likely to be subtly
// wrong -- when a row crosses a neighbour's midpoint, and which way it then
// moves -- actually testable, rather than only the bookkeeping around it.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();

const S = await import("../src/state.js");
const { setState, globals } = S;
const { getDefaultMonthData, migrateState } = await import(
  "../src/persistence.js"
);
const { mergeVisibleOrder } = await import("../src/scoring.js");
const { applyVisibleOrder, nudgeHabitOrder, getSortedDailyHabits } =
  await import("../src/habits.js");
const { bindEvents } = await import("../src/events.js");
const { renderAll, switchView } = await import("../src/render-shell.js");
await import("../src/render-today.js");
await import("../src/render-detail.js");
await import("../src/render-analytics.js");
await import("../src/render-settings.js");

document.getElementById("app").style.display = "";
bindEvents();

const NOW = new Date();
const KEY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;

function habit(id, name, weekdays) {
  return {
    id,
    name,
    categoryId: "c1",
    monthGoal: 20,
    scheduleMode: weekdays ? "specific_weekdays" : "fixed",
    activeWeekdays: weekdays || [0, 1, 2, 3, 4, 5, 6],
    activeMonthDays: [],
    trackType: "check",
    countTarget: 1,
    reminder: { enabled: false, repeat: "daily", days: [], time: "08:00" },
  };
}

function seed(habits) {
  setState({
    currentYear: NOW.getFullYear(),
    currentMonth: NOW.getMonth(),
    categories: [{ id: "c1", name: "Health", emoji: "x", color: "#fff" }],
    habits: {
      daily: (habits || [
        habit("a", "Alpha"),
        habit("b", "Bravo"),
        habit("c", "Charlie"),
        habit("d", "Delta"),
      ]).map((h, i) => ({ ...h, order: i })),
    },
    months: { [KEY]: getDefaultMonthData() },
    meta: { schemaVersion: 7 },
  });
  migrateState();
  globals.dayFocusDay = null;
  globals.detailHabitId = null;
  switchView("today");
  renderAll();
}

beforeEach(() => seed());

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const orderOnScreen = () =>
  $$("#todayList [data-open]").map((el) => el.dataset.open);
const storedOrder = () => getSortedDailyHabits().map((h) => h.id);

/* ====================================================================== */
/* The ordering rule                                                      */
/* ====================================================================== */

test("mergeVisibleOrder refills only the slots the visible habits held", () => {
  // b and d hidden. Reordering a and c must leave them exactly where they were
  // rather than sweeping them to the end.
  assert.deepEqual(mergeVisibleOrder(["a", "b", "c", "d"], ["c", "a"]), [
    "c",
    "b",
    "a",
    "d",
  ]);
  assert.deepEqual(
    mergeVisibleOrder(["a", "b", "c"], ["a", "b", "c"]),
    ["a", "b", "c"],
    "an unchanged order is a no-op",
  );
  assert.deepEqual(
    mergeVisibleOrder(["a", "b", "c"], []),
    ["a", "b", "c"],
    "nothing visible changes nothing",
  );
  assert.deepEqual(mergeVisibleOrder([], ["a"]), [], "no habits is not a crash");
});

test("reordering a filtered day leaves the hidden habits alone", () => {
  seed([
    habit("a", "Alpha"),
    habit("b", "Bravo", [1]), // Mondays only
    habit("c", "Charlie"),
    habit("d", "Delta"),
  ]);
  let day = 1;
  while (
    new Date(S.state.currentYear, S.state.currentMonth, day).getDay() === 1
  ) {
    day += 1;
  }
  globals.dayFocusDay = day;
  renderAll();

  assert.equal(
    orderOnScreen().includes("b"),
    false,
    "Bravo is hidden on this day",
  );

  assert.equal(applyVisibleOrder(["c", "a", "d"]), true);
  assert.deepEqual(
    storedOrder(),
    ["c", "b", "a", "d"],
    "Bravo keeps its slot; only the visible three moved",
  );
});

test("applyVisibleOrder reports whether anything actually changed", () => {
  assert.equal(applyVisibleOrder(["a", "b", "c", "d"]), false, "same order");
  assert.equal(applyVisibleOrder([]), false, "nothing to do");
  assert.equal(applyVisibleOrder(["ghost"]), false, "unknown ids are ignored");
  assert.equal(applyVisibleOrder(["b", "a", "c", "d"]), true);
  assert.deepEqual(storedOrder(), ["b", "a", "c", "d"]);
});

test("order survives a re-render and is written to every habit", () => {
  applyVisibleOrder(["d", "c", "b", "a"]);
  renderAll();
  assert.deepEqual(orderOnScreen(), ["d", "c", "b", "a"]);
  assert.deepEqual(
    getSortedDailyHabits().map((h) => h.order),
    [0, 1, 2, 3],
    "order indices are compacted, not left with gaps",
  );
});

/* ====================================================================== */
/* Keyboard                                                               */
/* ====================================================================== */

function altArrow(el, key) {
  el.dispatchEvent(
    Object.assign(new Event("keydown", { bubbles: true }), {
      key,
      altKey: true,
      preventDefault() {},
    }),
  );
}

test("nudgeHabitOrder moves one place and stops at the ends", () => {
  assert.equal(nudgeHabitOrder("c", -1), true);
  assert.deepEqual(storedOrder(), ["a", "c", "b", "d"]);

  assert.equal(nudgeHabitOrder("a", -1), false, "already at the top");
  assert.deepEqual(storedOrder(), ["a", "c", "b", "d"], "and nothing moved");

  assert.equal(nudgeHabitOrder("d", 1), false, "already at the bottom");
  assert.equal(nudgeHabitOrder("ghost", 1), false, "unknown habit");
});

test("a new habit can be moved off the bottom with the keyboard", () => {
  // The thing that prompted the feature: new habits land last and stayed there.
  const newest = $$("#todayList [data-open]").pop();
  assert.equal(newest.dataset.open, "d", "Delta is last");

  altArrow(newest, "ArrowUp");
  assert.deepEqual(storedOrder(), ["a", "b", "d", "c"]);
  assert.deepEqual(orderOnScreen(), ["a", "b", "d", "c"], "and the list redrew");
});

test("a bare arrow key does not reorder anything", () => {
  const row = $("#todayList [data-open]");
  row.dispatchEvent(
    Object.assign(new Event("keydown", { bubbles: true }), {
      key: "ArrowDown",
      altKey: false,
      preventDefault() {},
    }),
  );
  assert.deepEqual(storedOrder(), ["a", "b", "c", "d"]);
});

/* ====================================================================== */
/* The drag                                                               */
/* ====================================================================== */

const ROW_H = 60;

function readTranslate(el) {
  const match = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform || "");
  return match ? parseFloat(match[1]) : 0;
}

// Give every row a rectangle that follows its position in the DOM, so the
// midpoint arithmetic in reorder.js has something true to work with.
function layOutRows() {
  const list = $("#todayList");

  const relayout = () => {
    Array.from(list.querySelectorAll(".habit-row")).forEach((row, index) => {
      row.__top = index * ROW_H;
      if (row.__laidOut) return;
      row.__laidOut = true;
      row.getBoundingClientRect = () => {
        const shift = readTranslate(row);
        return {
          top: row.__top + shift,
          bottom: row.__top + shift + ROW_H,
          height: ROW_H,
          left: 0,
          right: 300,
          width: 300,
        };
      };
    });
  };
  relayout();

  // Reinsertion changes every row's layout position; keep the fake rects honest.
  if (!list.__patched) {
    list.__patched = true;
    const original = list.insertBefore.bind(list);
    list.insertBefore = (node, ref) => {
      const result = original(node, ref);
      relayout();
      return result;
    };
  }

  const scroller = $(".app-main");
  if (scroller) {
    // Edges deliberately far outside the rows' coordinates, so no drag in this
    // file lands in reorder.js's auto-scroll zone. Real browsers clamp
    // scrollTop; linkedom does not, so a stub whose top edge sat at y=0 let the
    // auto-scroll run every frame against a scroll position that kept going
    // negative, dragging the drag origin with it.
    scroller.getBoundingClientRect = () => ({
      top: -5000,
      bottom: 5000,
      height: 10000,
      left: 0,
      right: 300,
      width: 300,
    });
  }
}

function gripFor(id) {
  return $$("#todayList [data-open]").find((el) => el.dataset.open === id);
}

function pointer(type, target, clientY) {
  target.dispatchEvent(
    Object.assign(new Event(type, { bubbles: true }), {
      pointerId: 1,
      clientX: 10,
      clientY,
      preventDefault() {},
    }),
  );
}

const pastTheHold = () => new Promise((r) => setTimeout(r, 600));

// Hold the row body, drag to a Y, drop.
async function dragRow(id, toY) {
  const grip = gripFor(id);
  const row = grip.closest(".habit-row");
  const startY = row.getBoundingClientRect().top + ROW_H / 2;

  pointer("pointerdown", grip, startY);
  await pastTheHold();
  pointer("pointermove", grip, toY);
  pointer("pointerup", grip, toY);
}

test("dragging a habit to the top reorders it", async () => {
  layOutRows();
  // Charlie sits third (top 120, centre 150). Drag it above Alpha's midpoint.
  await dragRow("c", 10);
  assert.deepEqual(storedOrder(), ["c", "a", "b", "d"]);
  assert.deepEqual(orderOnScreen(), ["c", "a", "b", "d"]);
});

test("dragging a habit to the bottom reorders it", async () => {
  layOutRows();
  await dragRow("a", 220);
  assert.deepEqual(storedOrder(), ["b", "c", "d", "a"]);
});

test("a drag that does not cross a midpoint changes nothing", async () => {
  layOutRows();
  // Alpha's centre is 30; 45 is still short of Bravo's midpoint at 90.
  await dragRow("a", 45);
  assert.deepEqual(storedOrder(), ["a", "b", "c", "d"]);
});

test("the drag cleans up after itself", async () => {
  layOutRows();
  await dragRow("c", 10);

  assert.equal(
    $$(".habit-row").some((r) => r.classList.contains("is-dragging")),
    false,
    "no row left in the dragging state",
  );
  assert.equal(
    $("#todayList").classList.contains("is-reordering"),
    false,
    "the list is scrollable again",
  );
  assert.equal(
    $$(".habit-row").some((r) => r.style.transform),
    false,
    "no leftover transforms",
  );
});

test("dropping a habit does not also open it", async () => {
  layOutRows();
  const grip = gripFor("c");
  const row = grip.closest(".habit-row");

  pointer("pointerdown", grip, row.getBoundingClientRect().top + ROW_H / 2);
  await pastTheHold();
  pointer("pointermove", grip, 10);
  pointer("pointerup", grip, 10);
  // The click a browser queues after the drop. Dropping re-renders the list, so
  // it lands on whatever node is now at that position -- re-find it rather than
  // dispatching on the detached one the drag started from.
  gripFor("c").dispatchEvent(new Event("click", { bubbles: true }));

  assert.equal(
    globals.detailHabitId,
    null,
    "the detail screen must not open on drop",
  );
});

test("a drag whose click never arrives does not eat the next tap", async () => {
  layOutRows();
  // The drop's click is deliberately NOT dispatched -- which is what happens
  // when the re-render detaches the node it was aimed at.
  await dragRow("c", 10);
  assert.deepEqual(storedOrder(), ["c", "a", "b", "d"]);

  // Long enough for the suppression window to lapse.
  await new Promise((r) => setTimeout(r, 450));

  const grip = gripFor("a");
  pointer("pointerdown", grip, 90);
  pointer("pointerup", grip, 90);
  grip.dispatchEvent(new Event("click", { bubbles: true }));
  assert.equal(globals.detailHabitId, "a", "the next tap still works");
});

test("a tap without the hold still opens the habit", () => {
  layOutRows();
  const grip = gripFor("b");
  pointer("pointerdown", grip, 90);
  pointer("pointerup", grip, 90);
  grip.dispatchEvent(new Event("click", { bubbles: true }));
  assert.equal(globals.detailHabitId, "b");
});

test("moving before the hold fires is a scroll, not a drag", async () => {
  layOutRows();
  const grip = gripFor("c");

  pointer("pointerdown", grip, 150);
  pointer("pointermove", grip, 120); // 30px, well past the slop
  await pastTheHold();
  pointer("pointermove", grip, 10);
  pointer("pointerup", grip, 10);

  assert.deepEqual(
    storedOrder(),
    ["a", "b", "c", "d"],
    "scrolling the list must never reorder it",
  );
});

test("holding the checkbox skips the day instead of starting a drag", async () => {
  layOutRows();
  const control = $('#todayList [data-advance]');
  pointer("pointerdown", control, 30);
  await pastTheHold();
  pointer("pointerup", control, 30);

  assert.deepEqual(
    storedOrder(),
    ["a", "b", "c", "d"],
    "the two hold gestures must not collide",
  );
});

test("a single habit cannot start a drag", async () => {
  seed([habit("a", "Alpha")]);
  layOutRows();
  const grip = gripFor("a");
  pointer("pointerdown", grip, 30);
  await pastTheHold();
  assert.equal(
    $(".habit-row").classList.contains("is-dragging"),
    false,
    "nothing to reorder, so no drag",
  );
});

test("the list advertises the gesture only when there is something to reorder", () => {
  assert.match($("#todayListHint").textContent, /Hold a habit/);
  seed([habit("a", "Alpha")]);
  assert.equal($("#todayListHint").textContent, "", "not with one habit");
});
