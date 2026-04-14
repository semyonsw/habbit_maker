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
    const date = new Date(year, month, day);
    const weekday = date.getDay();
    const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
    date.setDate(date.getDate() + diffToMonday);
    date.setHours(0, 0, 0, 0);

    const mondayAnchor = date.getTime();
    if (mondayAnchor !== currentAnchor) {
      if (currentWeek) {
        weeks.push(currentWeek);
      }
      currentAnchor = mondayAnchor;
      currentWeek = {
        week: weeks.length + 1,
        start: day,
        end: day,
        isoWeek: getIsoWeekNumber(year, month, day),
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
