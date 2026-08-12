"use strict";

import { MONTH_NAMES } from "./constants.js";

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function nowIso() {
  return new Date().toISOString();
}

export function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function formatDateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateKey(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const year = +m[1], month = +m[2] - 1, day = +m[3];
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function monthLabel(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

export function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function normalizeWeekdayArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((d) => parseInt(d, 10))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

export function normalizeMonthDayArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((d) => parseInt(d, 10))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31))].sort((a, b) => a - b);
}

// Two-letter mark derived from the habit name; replaces the old emoji field.
export function habitMark(name) {
  const words = String(name || "").replace(/[^\p{L}\s]/gu, "").split(/\s+/).filter(Boolean);
  if (!words.length) return "··";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function formatTime(hhmm) {
  return String(hhmm || "").slice(0, 5);
}

export function toBase64(bytes) {
  const chars = [];
  for (let i = 0; i < bytes.length; i += 1) chars.push(String.fromCharCode(bytes[i]));
  return btoa(chars.join(""));
}

export function fromBase64(str) {
  const raw = atob(str);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function sanitizeErrorForLog(error) {
  return {
    errorName: error && error.name ? String(error.name) : "Error",
    errorMessage: String(error && error.message ? error.message : error || ""),
    stack: error && typeof error.stack === "string" ? error.stack.slice(0, 2000) : "",
  };
}
