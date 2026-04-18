"use strict";

export const STORAGE_KEY = "habitTracker_v1";
export const SECURE_SETTINGS_KEY = "habitTracker_secure_settings_v1";
export const API_KEY_CACHE_KEY = "habitTracker_summary_api_key_cache_v1";
export const LOGS_STORAGE_KEY = "habitTracker_logs_v1";
export const SIDEBAR_COLLAPSE_KEY = "habitTracker_sidebarCollapsed_v1";
export const SCHEMA_VERSION = 4;
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

export const MAX_PDF_FILE_SIZE_MB = 70;
export const MAX_PDF_FILE_SIZE_BYTES = MAX_PDF_FILE_SIZE_MB * 1024 * 1024;
export const EMBEDDED_EXPORT_SIZE_WARN_BYTES = 50 * 1024 * 1024;
export const MAX_BOOKMARK_HISTORY = 200;
export const PDF_DB_NAME = "habitTracker_books_pdf_v1";
export const PDF_DB_VERSION = 1;
export const PDF_STORE_NAME = "pdfFiles";
export const PDFJS_SCRIPT_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js",
];
export const PDFJS_WORKER_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
export const READER_DARK_ENABLED_KEY = "habitTracker_readerDarkEnabled_v1";
export const READER_DARK_MODE_KEY = "habitTracker_readerDarkMode_v1";
export const ANALYTICS_DISPLAY_MODE_KEY = "habitTracker_analyticsDisplayMode_v1";
export const GEMINI_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
  "gemini-2.5-pro-preview-tts",
  "gemini-2.5-flash-preview-tts",
  "gemini-flash-latest",
];
export const SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT = 12000;
export const SUMMARY_MAX_PAGES_PER_RUN_DEFAULT = 120;
export const MAX_LOG_RECORDS = 1000;

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
    type: "fixed",
    scheduleMode: "fixed",
    activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    activeMonthDays: [],
    excludedWeekdays: [],
    emoji: "\uD83D\uDCD6",
    order: 0,
  },
  {
    id: "dh_2",
    name: "Complete work tasks",
    categoryId: "cat_productivity",
    monthGoal: 28,
    type: "fixed",
    scheduleMode: "fixed",
    activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    activeMonthDays: [],
    excludedWeekdays: [],
    emoji: "\uD83D\uDCBC",
    order: 1,
  },
];
