"use strict";

export const STORAGE_KEY = "habitTracker_v1";
export const LOGS_STORAGE_KEY = "habitTracker_logs_v1";
export const SIDEBAR_COLLAPSE_KEY = "habitTracker_sidebarCollapsed_v1";
export const SCHEMA_VERSION = 5;
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

export const EMBEDDED_EXPORT_SIZE_WARN_BYTES = 50 * 1024 * 1024;
// On-device persistence (replaces the Python/SQLite backend for the PWA build).
// One database, two stores: a generic key-value store (app state blob, prefs,
// meta flags) and an append-only logs store.
export const IDB_NAME = "habitTracker_store_v1";
export const IDB_VERSION = 1;
export const IDB_KV_STORE = "kv";
export const IDB_LOGS_STORE = "logs";

export const ANALYTICS_DISPLAY_MODE_KEY = "habitTracker_analyticsDisplayMode_v1";
export const MAX_LOG_RECORDS = 1000;

export const APP_VERSION = "1.0.0";

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
    emoji: "\uD83D\uDCD6",
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
    emoji: "\uD83D\uDCBC",
    order: 1,
  },
];
