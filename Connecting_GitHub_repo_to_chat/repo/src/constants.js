"use strict";

// Storage keys kept identical to the previous build so existing data loads.
export const STORAGE_KEY = "habitTracker_v1";
export const SECURE_SETTINGS_KEY = "habitTracker_secure_settings_v1";
export const LOGS_STORAGE_KEY = "habitTracker_logs_v1";

// 6 adds per-habit tracking type (check | count) and per-habit reminders,
// and drops books / reports / bookmarks from state.
export const SCHEMA_VERSION = 6;
export const APP_VERSION = "2.0.0";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// On-device persistence (PWA build). Unchanged from the previous version.
export const IDB_NAME = "habitTracker_store_v1";
export const IDB_VERSION = 1;
export const IDB_KV_STORE = "kv";
export const IDB_LOGS_STORE = "logs";
export const IDB_PDF_STORE = "pdfs";

// Legacy browser PDF store — referenced only by db-idb.js's store setup.
export const PDF_DB_NAME = "habitTracker_books_pdf_v1";
export const PDF_DB_VERSION = 1;
export const PDF_STORE_NAME = "pdfFiles";

export const MAX_LOG_RECORDS = 300;

export const DEFAULT_CATEGORIES = [
  { id: "cat_health", name: "Health", color: "#3E85B5" },
  { id: "cat_productivity", name: "Productivity", color: "#4F6BD8" },
  { id: "cat_fitness", name: "Fitness", color: "#2F9E7A" },
  { id: "cat_family", name: "Family", color: "#D97706" },
  { id: "cat_sleep", name: "Sleep", color: "#7C8CFF" },
  { id: "cat_study", name: "Study", color: "#B56BE3" },
  { id: "cat_diet", name: "Diet", color: "#22C55E" },
  { id: "cat_career", name: "Career", color: "#F59E0B" },
];

export const DEFAULT_REMINDER = {
  enabled: false,
  time: "08:00",
  repeat: "daily", // daily | weekdays | custom
  days: [1, 2, 3, 4, 5],
};

export const DEFAULT_DAILY_HABITS = [
  {
    id: "dh_1",
    name: "Morning Bible reading",
    categoryId: "cat_health",
    monthGoal: 30,
    trackType: "check",
    countTarget: 1,
    scheduleMode: "fixed",
    activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    activeMonthDays: [],
    reminder: { enabled: true, time: "07:00", repeat: "daily", days: [1, 2, 3, 4, 5] },
    order: 0,
  },
  {
    id: "dh_2",
    name: "Complete work tasks",
    categoryId: "cat_productivity",
    monthGoal: 28,
    trackType: "check",
    countTarget: 5,
    scheduleMode: "specific_weekdays",
    activeWeekdays: [1, 2, 3, 4, 5],
    activeMonthDays: [],
    reminder: { enabled: true, time: "09:15", repeat: "weekdays", days: [1, 2, 3, 4, 5] },
    order: 1,
  },
];
