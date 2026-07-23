"use strict";

import { MONTH_NAMES } from "./constants.js";

export function formatRealBookPage(value) {
  const page = parseInt(value, 10);
  return Number.isFinite(page) && page > 0 ? String(page) : "-";
}

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function formatDateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function sanitize(str) {
  const div = document.createElement("div");
  div.textContent = String(str || "");
  return div.innerHTML;
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function nowIso() {
  return new Date().toISOString();
}

export function toBase64(bytes) {
  const chars = [];
  for (let i = 0; i < bytes.length; i += 1) {
    chars.push(String.fromCharCode(bytes[i]));
  }
  return btoa(chars.join(""));
}

export function fromBase64(str) {
  const raw = atob(str);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

export function formatByteSize(bytes) {
  const normalized = Number.isFinite(Number(bytes)) ? Number(bytes) : 0;
  if (normalized < 1024) return `${Math.max(0, Math.round(normalized))} B`;
  if (normalized < 1024 * 1024) {
    return `${(normalized / 1024).toFixed(1)} KB`;
  }
  return `${(normalized / (1024 * 1024)).toFixed(1)} MB`;
}

export function bytesFromString(input) {
  return new TextEncoder().encode(String(input || ""));
}

export function stringFromBytes(input) {
  return new TextDecoder().decode(input);
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

export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function getValueColor(value, maxValue, alpha = 1) {
  const safeMax = Math.max(1, Number(maxValue) || 1);
  const ratio = clampNumber((Number(value) || 0) / safeMax, 0, 1);
  const hue = ratio * 120;
  return `hsla(${hue.toFixed(1)}, 72%, 46%, ${clampNumber(alpha, 0, 1).toFixed(3)})`;
}

export function getWeekShadeColor(weekNumber) {
  const parsed = Math.floor(Number(weekNumber) || 1);
  const normalized = ((((parsed - 1) % 2) + 2) % 2) + 1;
  return normalized === 1 ? "hsl(207, 78%, 74%)" : "hsl(207, 78%, 66%)";
}

export function getHeatColor(strength) {
  return getValueColor((Number(strength) || 0) * 100, 100, 0.82);
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

// Cap on how long a custom-sequence cycle can be (keeps the checkbox grid sane).
export const MAX_SEQUENCE_LENGTH = 60;

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

export function getIsoWeekNumber(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

export function getMonthCalendarWeeks(year, month) {
  const totalDays = daysInMonth(year, month);
  const weeks = [];
  let currentAnchor = null;
  let currentWeek = null;

  for (let day = 1; day <= totalDays; day++) {
    const monday = new Date(year, month, day);
    const weekday = monday.getDay();
    const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
    monday.setDate(monday.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const mondayAnchor = monday.getTime();
    if (mondayAnchor !== currentAnchor) {
      if (currentWeek) {
        weeks.push(currentWeek);
      }
      currentAnchor = mondayAnchor;
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      const isoWeek = getIsoWeekNumber(year, month, day);
      currentWeek = {
        week: isoWeek,
        isoWeek,
        start: day,
        end: day,
        fullStart: {
          year: monday.getFullYear(),
          month: monday.getMonth(),
          day: monday.getDate(),
        },
        fullEnd: {
          year: sunday.getFullYear(),
          month: sunday.getMonth(),
          day: sunday.getDate(),
        },
      };
      continue;
    }

    currentWeek.end = day;
  }

  if (currentWeek) {
    weeks.push(currentWeek);
  }

  return weeks;
}

export function formatIsoWeekRangeLabel(fullStart, fullEnd) {
  if (!fullStart || !fullEnd) return "";
  const sameMonth =
    fullStart.year === fullEnd.year && fullStart.month === fullEnd.month;
  if (sameMonth) {
    return `${fullStart.day}–${fullEnd.day}`;
  }
  const startMonth = (MONTH_NAMES[fullStart.month] || "").slice(0, 3);
  const endMonth = (MONTH_NAMES[fullEnd.month] || "").slice(0, 3);
  return `${startMonth} ${fullStart.day} – ${endMonth} ${fullEnd.day}`;
}

export function getMonthCalendarWeekLayout(year, month) {
  const weeks = getMonthCalendarWeeks(year, month);
  const dayToWeek = {};
  weeks.forEach((range) => {
    for (let day = range.start; day <= range.end; day++) {
      dayToWeek[day] = range.week;
    }
  });
  return { weeks, dayToWeek };
}

export function formatIsoForDisplay(iso) {
  if (!iso) return "-";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString();
}

export function formatTopClockDateTime(date) {
  return date.toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
