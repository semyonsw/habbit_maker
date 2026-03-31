(function () {
  "use strict";

  H.uid = function (prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  };

  H.monthKey = function (year, month) {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
  };

  H.formatDateKey = function (year, month, day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  H.sanitize = function (str) {
    const div = document.createElement("div");
    div.textContent = String(str || "");
    return div.innerHTML;
  };

  H.isPlainObject = function (value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  };

  H.nowIso = function () {
    return new Date().toISOString();
  };

  H.toBase64 = function (bytes) {
    const chars = [];
    for (let i = 0; i < bytes.length; i += 1) {
      chars.push(String.fromCharCode(bytes[i]));
    }
    return btoa(chars.join(""));
  };

  H.fromBase64 = function (str) {
    const raw = atob(str);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      out[i] = raw.charCodeAt(i);
    }
    return out;
  };

  H.formatByteSize = function (bytes) {
    const normalized = Number.isFinite(Number(bytes)) ? Number(bytes) : 0;
    if (normalized < 1024) return `${Math.max(0, Math.round(normalized))} B`;
    if (normalized < 1024 * 1024) {
      return `${(normalized / 1024).toFixed(1)} KB`;
    }
    return `${(normalized / (1024 * 1024)).toFixed(1)} MB`;
  };

  H.bytesFromString = function (input) {
    return new TextEncoder().encode(String(input || ""));
  };

  H.stringFromBytes = function (input) {
    return new TextDecoder().decode(input);
  };

  H.sanitizeErrorForLog = function (error) {
    const message = String(
      error && error.message ? error.message : error || "",
    );
    return {
      errorName: error && error.name ? String(error.name) : "Error",
      errorMessage: message,
      stack:
        error && typeof error.stack === "string"
          ? String(error.stack).slice(0, 3000)
          : "",
    };
  };

  H.redactForLogs = function (value) {
    const serialized = JSON.stringify(value || {});
    return JSON.parse(
      serialized
        .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[REDACTED_API_KEY]")
        .replace(/(apiKey\"\s*:\s*\")[^\"]*(\")/gi, "$1[REDACTED]$2")
        .replace(/(passphrase\"\s*:\s*\")[^\"]*(\")/gi, "$1[REDACTED]$2"),
    );
  };

  H.downloadTextFile = function (fileName, mimeType, text) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  };

  H.clampNumber = function (value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  };

  H.getValueColor = function (value, maxValue, alpha) {
    if (alpha === undefined) alpha = 1;
    const safeMax = Math.max(1, Number(maxValue) || 1);
    const ratio = H.clampNumber((Number(value) || 0) / safeMax, 0, 1);
    const hue = ratio * 120;
    return `hsla(${hue.toFixed(1)}, 72%, 46%, ${H.clampNumber(alpha, 0, 1).toFixed(3)})`;
  };

  H.getWeekShadeColor = function (isoWeek) {
    const normalized = (((Number(isoWeek) || 0) % 8) + 8) % 8;
    const lightness = 72 - normalized * 4;
    return `hsl(207, 78%, ${lightness}%)`;
  };

  H.formatIsoForDisplay = function (iso) {
    if (!iso) return "-";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return String(iso);
    return dt.toLocaleString();
  };

  H.formatTopClockDateTime = function (date) {
    return date.toLocaleString(undefined, {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  H.daysInMonth = function (year, month) {
    return new Date(year, month + 1, 0).getDate();
  };

  H.getIsoWeekNumber = function (year, month, day) {
    const date = new Date(Date.UTC(year, month, day));
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  };

  H.normalizeWeekdayArray = function (values) {
    return [
      ...new Set(
        (Array.isArray(values) ? values : [])
          .map((d) => parseInt(d, 10))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      ),
    ].sort((a, b) => a - b);
  };

  H.normalizeMonthDayArray = function (values) {
    return [
      ...new Set(
        (Array.isArray(values) ? values : [])
          .map((d) => parseInt(d, 10))
          .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31),
      ),
    ].sort((a, b) => a - b);
  };

  H.formatRealBookPage = function (value) {
    const page = parseInt(value, 10);
    return Number.isFinite(page) && page > 0 ? String(page) : "-";
  };

  H.formatDuration = function (durationMs) {
    const ms = Number(durationMs);
    if (!Number.isFinite(ms) || ms <= 0) return "-";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  };

  H.formatShortDateLabel = function (dateValue) {
    const dt = new Date(dateValue);
    return `${H.MONTH_NAMES[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
  };

  H.floorToDayTime = function (ms) {
    const dt = new Date(ms);
    dt.setHours(0, 0, 0, 0);
    return dt.getTime();
  };

  H.toLocalDayKey = function (ms) {
    const dt = new Date(ms);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  H.parseIsoMs = function (value) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : null;
  };

  H.parsePageFromHistoryNote = function (note) {
    const match = String(note || "").match(/page\s+(\d+)/i);
    const parsed = match ? parseInt(match[1], 10) : NaN;
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return parsed;
  };

  H.daysInclusiveFromTimes = function (startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
    const diff = H.floorToDayTime(endMs) - H.floorToDayTime(startMs);
    return Math.max(1, Math.round(diff / 86400000) + 1);
  };

  H.round1 = function (value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  };

  H.formatDateInputValue = function (dateLike) {
    const dt = new Date(dateLike);
    if (Number.isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
})();
