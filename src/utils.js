"use strict";

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function formatDateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Escape a string for interpolation into markup.
//
// This is used in BOTH text and attribute position -- `${sanitize(name)}` shows
// up inside `value="..."` and `aria-label="..."` all over the render modules --
// so quotes have to be escaped too.
//
// The old implementation was textContent -> innerHTML, which only escapes
// `&`, `<`, `>` and nbsp, because those are the only characters the HTML
// serializer escapes in a TEXT node. Quotes came through untouched, so a habit
// named `x" onfocus="alert(1)" autofocus` broke out of the attribute it was
// written into. Import accepts arbitrary JSON, which made that reachable from a
// shared backup file rather than only from your own typing.
const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

export function sanitize(str) {
  return String(str == null ? "" : str).replace(
    /[&<>"'`]/g,
    (ch) => ESCAPES[ch],
  );
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function nowIso() {
  return new Date().toISOString();
}

export function sanitizeErrorForLog(error) {
  const message = String(error && error.message ? error.message : error || "");
  return {
    errorName: error && error.name ? String(error.name) : "Error",
    errorMessage: message,
    stack:
      error && typeof error.stack === "string"
        ? String(error.stack).slice(0, 3000)
        : "",
  };
}

export function redactForLogs(value) {
  const serialized = JSON.stringify(value || {});
  return JSON.parse(
    serialized
      .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[REDACTED_API_KEY]")
      .replace(/(apiKey\"\s*:\s*\")[^\"]*(\")/gi, "$1[REDACTED]$2")
      .replace(/(passphrase\"\s*:\s*\")[^\"]*(\")/gi, "$1[REDACTED]$2"),
  );
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// Whole-day difference (date2 - date1) computed in UTC so DST transitions never
// shift the count. Used by custom-sequence scheduling to find a date's phase.
export function daysBetweenDates(y1, m1, d1, y2, m2, d2) {
  return Math.round(
    (Date.UTC(y2, m2, d2) - Date.UTC(y1, m1, d1)) / 86400000,
  );
}

// Parse a "YYYY-MM-DD" key into {year, month(0-based), day}, or null if invalid.
export function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}

// "HH:MM" or null.
export function parseTimeString(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatTimeString(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// Cap on how long a custom-sequence cycle can be (keeps the checkbox grid sane).
const MAX_SEQUENCE_LENGTH = 60;

export function normalizeSequenceLength(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(MAX_SEQUENCE_LENGTH, parsed);
}

export function normalizeSequencePositions(values, length) {
  const max = normalizeSequenceLength(length);
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((n) => parseInt(n, 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < max),
    ),
  ].sort((a, b) => a - b);
}

export function normalizeWeekdayArray(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((d) => parseInt(d, 10))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    ),
  ].sort((a, b) => a - b);
}

export function normalizeMonthDayArray(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((d) => parseInt(d, 10))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31),
    ),
  ].sort((a, b) => a - b);
}
