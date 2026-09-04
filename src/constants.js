"use strict";

export const STORAGE_KEY = "habitTracker_v1";
export const LOGS_STORAGE_KEY = "habitTracker_logs_v1";
export const SIDEBAR_COLLAPSE_KEY = "habitTracker_sidebarCollapsed_v1";
export const SCHEMA_VERSION = 7;
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Monday-first, matching the design's day-toggle row and "Week starts on".
export const FULL_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
// Monday-first, matching the design's day-toggle row and "Week starts on".
export const WEEKDAY_ORDER_MON = [1, 2, 3, 4, 5, 6, 0];
export const REMINDER_REPEATS = ["daily", "weekdays", "custom"];
export const THEMES = ["light", "dark", "auto"];
export const WEEK_STARTS = ["monday", "sunday"];
export const DAILY_REMINDER_DEFAULT_TIME = "21:00";
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/* ------------------------------------------------------------- completions
   A day's stored value is one of:
     * a number >= 0   -- a count habit's progress toward its target
     * true / false    -- a checkbox habit (kept as booleans so an export read
                          by an older build still makes sense)
     * SKIPPED (-1)    -- deliberately skipped: neutral to streak AND score.
   SKIPPED is a negative sentinel precisely so an older build, which coerces
   with `>= target`, reads it as "not done" rather than as a completion.
   ------------------------------------------------------------------------ */
export const SKIPPED = -1;

/* ------------------------------------------------------------ habit score
   Habit strength is an exponentially weighted moving average over a habit's
   SCHEDULED days -- not calendar days -- so a 3x/week habit is judged on the
   three chances it actually had, not on seven. Every completion pushes the
   score up, every miss decays it, and a skipped day does neither.
   HALF_LIFE_DAYS is how many consecutive missed chances halve the score; it is
   also, symmetrically, how long a perfect run takes to close half the gap to
   100%.

   This is the anti-streak. A streak is worth 40 one day and 0 the next, which
   is the mechanic every "I quit after one bad day" story turns on. A decaying
   score costs you a few points for a bad day and rewards getting straight back
   on, so the honest response to a miss is to do it tomorrow, not to give up.
   ------------------------------------------------------------------------ */
// 21 scheduled days. Long enough that a bad week barely dents an established
// habit; short enough that a new habit shows real movement inside a month.
export const SCORE_HALF_LIFE_DAYS = 21;
// Below this the score reads as "building"; above it, as established. Also the
// point at which fading reminders start backing off.
export const SCORE_ESTABLISHED = 0.75;
// On-device persistence (replaces the Python/SQLite backend for the PWA build).
// One database, two stores: a generic key-value store (app state blob, prefs,
// meta flags) and an append-only logs store.
export const IDB_NAME = "habitTracker_store_v1";
export const IDB_VERSION = 1;
export const IDB_KV_STORE = "kv";
export const IDB_LOGS_STORE = "logs";

export const ANALYTICS_DISPLAY_MODE_KEY = "habitTracker_analyticsDisplayMode_v1";
export const MAX_LOG_RECORDS = 1000;

// A skipped/undone action stays undoable for this long.
export const UNDO_WINDOW_MS = 6000;

export const APP_VERSION = "1.2.0";

export const DEFAULT_CATEGORIES = [
  { id: "cat_health", name: "Health", emoji: "\u2764\uFE0F", color: "#3E85B5" },
  {
    id: "cat_productivity",
    name: "Productivity",
    emoji: "\uD83E\uDDE0",
    color: "#4F6BD8",
  },
  { id: "cat_fitness", name: "Fitness", emoji: "\uD83D\uDCAA", color: "#2F9E7A" },
  { id: "cat_family", name: "Family", emoji: "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66", color: "#D97706" },
  { id: "cat_sleep", name: "Sleep", emoji: "\uD83D\uDE34", color: "#7C8CFF" },
  { id: "cat_study", name: "Study", emoji: "\uD83D\uDCDA", color: "#B56BE3" },
  { id: "cat_diet", name: "Diet", emoji: "\uD83E\uDD57", color: "#22C55E" },
  { id: "cat_career", name: "Career", emoji: "\uD83D\uDCBC", color: "#F59E0B" },
  { id: "cat_music", name: "Music", emoji: "\uD83C\uDFB5", color: "#F97316" },
];

export const DEFAULT_DAILY_HABITS = [
  {
    id: "dh_1",
    name: "Morning Bible reading",
    categoryId: "cat_health",
    monthGoal: 30,
    scheduleMode: "fixed",
    activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    activeMonthDays: [],
    trackType: "check",
    countTarget: 1,
    order: 0,
  },
  {
    id: "dh_2",
    name: "Complete work tasks",
    categoryId: "cat_productivity",
    monthGoal: 28,
    scheduleMode: "fixed",
    activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    activeMonthDays: [],
    trackType: "check",
    countTarget: 1,
    order: 1,
  },
];
