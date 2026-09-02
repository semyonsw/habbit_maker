// Render smoke tests.
//
// These do not check pixels. They check that every screen actually renders
// against the real index.html, that the new surfaces appear where they should,
// and that nothing throws -- which is the whole class of bug a no-build vanilla
// app otherwise only finds on a phone.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.mjs";

installDom();

// Imported after the DOM exists: several modules touch window at evaluation.
const { setState } = await import("../src/state.js");
const { migrateState, getDefaultMonthData } = await import(
  "../src/persistence.js"
);
const { renderToday } = await import("../src/render-today.js");
const { renderDetail } = await import("../src/render-detail.js");
const { renderAnalytics } = await import("../src/render-analytics.js");
const { renderSettings } = await import("../src/render-settings.js");
const { globals } = await import("../src/state.js");
const { monthNavHtml } = await import("../src/month-nav.js");
const { collectReminders, fadeWeekdays } = await import(
  "../src/notifications.js"
);
const { SKIPPED } = await import("../src/constants.js");

const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth();
const KEY = `${YEAR}-${String(MONTH + 1).padStart(2, "0")}`;

function seed() {
  setState({
    currentYear: YEAR,
    currentMonth: MONTH,
    categories: [{ id: "c1", name: "Health", emoji: "x", color: "#fff" }],
    habits: {
      daily: [
        {
          id: "h1",
          name: "Read",
          cue: "After I pour my coffee, I will read in the kitchen",
          categoryId: "c1",
          monthGoal: 20,
          scheduleMode: "fixed",
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
          activeMonthDays: [],
          trackType: "check",
          countTarget: 1,
          order: 0,
          reminder: {
            enabled: true,
            repeat: "daily",
            days: [],
            time: "08:00",
          },
        },
        {
          id: "h2",
          // Deliberately hostile: this is the string that used to break out of
          // value="..." and aria-label="...".
          name: 'Push-ups" onfocus="alert(1)',
          categoryId: "c1",
          monthGoal: 20,
          scheduleMode: "fixed",
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
          activeMonthDays: [],
          trackType: "count",
          countTarget: 4,
          order: 1,
          reminder: { enabled: false, repeat: "daily", days: [], time: "08:00" },
        },
      ],
    },
    months: {
      [KEY]: Object.assign(getDefaultMonthData(), {
        dailyCompletions: {
          h1: { 1: true, 2: true, 3: SKIPPED },
          h2: { 1: 4, 2: 2 },
        },
      }),
    },
    meta: { schemaVersion: 7 },
  });
  migrateState();
  globals.dayFocusDay = null;
  globals.detailHabitId = null;
  globals.analyticsYear = null;
}

// Per test, not once: these render the same singleton `state` and set
// globals.dayFocusDay, so a leaked selection from one test silently changes
// what the next one is looking at.
beforeEach(seed);

/* ---------------------------------------------------------------- Today */

test("Today renders habits, the month bar and the day strip", () => {
  renderToday();

  const list = document.getElementById("todayList");
  assert.ok(list.innerHTML.includes("Read"), "the habit name is on the row");
  assert.ok(
    list.innerHTML.includes("strength"),
    "the strength figure replaced the bare streak",
  );
  assert.ok(
    list.innerHTML.includes("After I pour my coffee"),
    "the implementation intention shows on the row",
  );

  const nav = document.getElementById("todayMonthNav");
  assert.ok(
    nav.querySelector("[data-month-step]"),
    "month navigation is mounted",
  );

  const strip = document.getElementById("dayStrip");
  assert.ok(
    strip.querySelectorAll(".day-chip").length >= 28,
    "one chip per day of the month",
  );
});

test("a hostile habit name cannot escape its attribute", () => {
  renderToday();
  const html = document.getElementById("todayList").innerHTML;
  assert.ok(html.includes("Push-ups"), "the name is still shown");
  assert.equal(
    html.includes('onfocus="alert(1)"'),
    false,
    "the quote is escaped, so no attribute is created",
  );
  assert.ok(html.includes("&quot;"), "it is escaped rather than stripped");
});

test("a skipped habit renders as skipped rather than as missed", () => {
  globals.dayFocusDay = 3;
  renderToday();
  const html = document.getElementById("todayList").innerHTML;
  assert.ok(html.includes("is-skipped"), "the skip state reaches the markup");
});

/* --------------------------------------------------------------- Detail */

test("Detail renders stats, calendar, notes and tracking", () => {
  globals.detailHabitId = "h1";
  renderDetail();

  const body = document.getElementById("detailBody");
  const html = body.innerHTML;
  assert.ok(html.includes("Strength"), "the strength tile is present");
  assert.ok(html.includes("Current streak"));
  assert.ok(html.includes("Best streak"));
  assert.ok(
    body.querySelector("#detailNote"),
    "the per-day note field is rendered",
  );
  assert.ok(
    body.querySelectorAll(".cal-cell").length >= 28,
    "the month calendar is drawn",
  );
  assert.ok(
    body.querySelector("[data-cal-day]"),
    "past calendar days are tappable",
  );
});

test("Detail survives a habit that no longer exists", () => {
  globals.detailHabitId = "gone";
  renderDetail();
  assert.ok(
    document.getElementById("detailBody").innerHTML.includes("no longer exists"),
  );
});

/* ------------------------------------------------------------ Analytics */

test("Analytics renders KPIs, the heatmap and the goal list", () => {
  renderAnalytics();
  const body = document.getElementById("analyticsBody");
  const html = body.innerHTML;

  assert.ok(html.includes("Avg strength"));
  assert.ok(html.includes("Year at a glance"));
  assert.ok(body.querySelector(".heat-grid"), "the year heatmap is drawn");
  assert.ok(
    body.querySelectorAll(".heat-col").length >= 50,
    "a full year of week columns",
  );
  assert.ok(html.includes("Progress to goal"));
  assert.ok(
    document.getElementById("analyticsMonthNav").querySelector("[data-month-step]"),
    "month navigation is mounted on Analytics too",
  );
});

test("the heatmap marks today exactly once", () => {
  renderAnalytics();
  const todays = document
    .getElementById("analyticsBody")
    .querySelectorAll(".heat-cell.is-today");
  assert.equal(todays.length, 1);
});

/* ------------------------------------------------------------- Settings */

test("Settings renders the reminder controls and an honest delivery note", () => {
  renderSettings();
  const html = document.getElementById("settingsBody").innerHTML;
  assert.ok(html.includes("Daily reminder"));
  assert.ok(html.includes("Ease off automatically"));
  assert.ok(
    html.includes("cannot show notifications") ||
      html.includes("only fire while") ||
      html.includes("even when the app is closed") ||
      html.includes("blocked"),
    "the delivery note says what will actually happen",
  );
});

/* -------------------------------------------------------------- Reminders */

test("collectReminders turns an enabled habit reminder into seven weekly alarms", () => {
  const reminders = collectReminders();
  const forHabit = reminders.filter((r) => r.title === "Read");
  assert.equal(forHabit.length, 7, "a daily reminder is seven weekly alarms");
  assert.ok(
    forHabit.every((r) => r.hour === 8 && r.minute === 0),
    "at the configured time",
  );
  assert.deepEqual(
    forHabit.map((r) => r.weekday).sort(),
    [0, 1, 2, 3, 4, 5, 6],
    "one per weekday",
  );
  assert.ok(
    new Set(forHabit.map((r) => r.id)).size === 7,
    "with distinct notification ids",
  );
  assert.ok(
    forHabit[0].body.includes("pour my coffee"),
    "the cue becomes the notification text",
  );
  assert.equal(
    reminders.some((r) => r.title.includes("Push-ups")),
    false,
    "a disabled reminder schedules nothing",
  );
});

test("fading thins reminders out as strength rises, but never to nothing", () => {
  const week = [0, 1, 2, 3, 4, 5, 6];
  assert.equal(fadeWeekdays(week, 0.2).length, 7, "a new habit gets every day");
  assert.equal(fadeWeekdays(week, 0.8).length, 4, "an established habit, fewer");
  assert.equal(fadeWeekdays(week, 0.95).length, 1, "a strong habit, one nudge");
  assert.equal(fadeWeekdays([3], 0.99).length, 1, "never faded to zero");
});

/* -------------------------------------------------------------- Month nav */

test("month navigation offers a way back but not into the future", () => {
  const html = monthNavHtml();
  assert.ok(html.includes('data-month-step="-1"'));
  // Viewing the current month: forward is disabled and there is no "Today"
  // shortcut to show, because you are already there.
  assert.ok(html.includes("disabled"));
  assert.equal(html.includes("month-nav-back"), false);
});
