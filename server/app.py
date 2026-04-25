"""Habit Tracker local server.

Serves the static frontend (index.html, src/, styles.css, ...) AND a small
JSON API backed by a real SQLite file (`data.db`) plus a `books/` directory
for PDF blobs. Replaces the previous `py -m http.server 3000` launch.

Single-user, localhost only (binds 127.0.0.1). Stdlib only -- no pip install.
"""

import json
import mimetypes
import os
import re
import sqlite3
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

HOST = "127.0.0.1"
PORT = 3000
MAX_PDF_BYTES = 80 * 1024 * 1024  # 80 MiB; client cap is 70 MiB
MAX_BOOKMARK_HISTORY = 200
MAX_LOG_RECORDS = 1000
CHUNK = 64 * 1024
PDF_FILE_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT_DIR, "data.db")
BOOKS_DIR = os.path.join(ROOT_DIR, "books")
MIGRATIONS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations.sql")

DB_LOCK = threading.Lock()


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    os.makedirs(BOOKS_DIR, exist_ok=True)
    with open(MIGRATIONS_PATH, "r", encoding="utf-8") as f:
        ddl = f.read()
    conn = get_conn()
    try:
        conn.executescript(ddl)
    finally:
        conn.close()
    # Sweep stale .tmp files left over from a crashed PDF upload.
    for entry in os.listdir(BOOKS_DIR):
        if entry.endswith(".tmp"):
            try:
                os.remove(os.path.join(BOOKS_DIR, entry))
            except OSError:
                pass


def get_meta(conn, key, default=None):
    row = conn.execute("SELECT value FROM schema_meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_meta(conn, key, value):
    conn.execute(
        "INSERT INTO schema_meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)),
    )


def upsert_pref(conn, key, value):
    conn.execute(
        "INSERT INTO prefs(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value)),
    )


def read_pref(conn, key, default=None):
    row = conn.execute("SELECT value FROM prefs WHERE key=?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except (TypeError, ValueError):
        return default


def get_state_blob(conn):
    """Pass 1 stores the whole client state as one JSON blob in prefs.__state__.
    Pass 2 will replace this with normalized table reads."""
    return read_pref(conn, "__state__", None)


def put_state_blob(conn, state):
    upsert_pref(conn, "__state__", state)


# ---------------------------------------------------------------------------
# Legacy import: accepts the full localStorage payload and persists it.
# Writes both the full-state blob (Pass 1 source of truth) AND decomposes
# into normalized tables (Pass 2 readiness).
# ---------------------------------------------------------------------------

def import_legacy(conn, payload):
    state = payload.get("state") if isinstance(payload, dict) else None
    secure_settings = payload.get("secureSettings") if isinstance(payload, dict) else None
    logs = payload.get("logs") if isinstance(payload, dict) else None
    prefs = payload.get("prefs") if isinstance(payload, dict) else None

    conn.execute("BEGIN IMMEDIATE")
    try:
        # Wipe everything; we know nothing else has written yet.
        for table in (
            "summaries", "bookmark_history", "bookmarks", "books",
            "monthly_review", "daily_notes", "daily_completions",
            "habits_daily", "categories", "app_logs", "prefs", "secure_settings",
        ):
            conn.execute(f"DELETE FROM {table}")
        # Re-seed schema_meta default
        set_meta(conn, "schema_version", "1")

        if isinstance(state, dict):
            put_state_blob(conn, state)
            _decompose_state_into_tables(conn, state)

        if isinstance(secure_settings, dict):
            for k in ("keyCiphertext", "saltBase64", "ivBase64", "kdfIterations", "keyUpdatedAt"):
                v = secure_settings.get(k)
                conn.execute(
                    "INSERT INTO secure_settings(key, value) VALUES(?, ?)",
                    (k, None if v is None else str(v)),
                )

        if isinstance(prefs, dict):
            for k, v in prefs.items():
                upsert_pref(conn, str(k), v)

        if isinstance(logs, list):
            for entry in logs[-MAX_LOG_RECORDS:]:
                if not isinstance(entry, dict):
                    continue
                _insert_log(conn, entry)

        set_meta(conn, "legacy_imported", "1")
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def _decompose_state_into_tables(conn, state):
    """Project the JSON state into normalized tables (Pass 2 readiness).
    Pass 1 reads continue to come from the __state__ blob; this is for
    future-proofing and for ad-hoc SQL inspection."""
    for cat in (state.get("categories") or []):
        if not isinstance(cat, dict) or not cat.get("id"):
            continue
        conn.execute(
            "INSERT OR REPLACE INTO categories(id, name, emoji, color) VALUES(?, ?, ?, ?)",
            (str(cat["id"]), str(cat.get("name", "")), str(cat.get("emoji", "")),
             str(cat.get("color", ""))),
        )

    habits = ((state.get("habits") or {}).get("daily") or [])
    for idx, h in enumerate(habits):
        if not isinstance(h, dict) or not h.get("id"):
            continue
        conn.execute(
            "INSERT OR REPLACE INTO habits_daily("
            "id, name, category_id, month_goal, schedule_mode, "
            "active_weekdays, active_month_days, emoji, order_index) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(h["id"]), str(h.get("name", "")),
                str(h.get("categoryId", "")) or None,
                int(h.get("monthGoal", 20) or 20),
                str(h.get("scheduleMode", "fixed")),
                json.dumps(h.get("activeWeekdays") or [0, 1, 2, 3, 4, 5, 6]),
                json.dumps(h.get("activeMonthDays") or []),
                str(h.get("emoji", "")),
                int(h.get("order", idx) if isinstance(h.get("order"), int) else idx),
            ),
        )

    months = state.get("months") or {}
    if isinstance(months, dict):
        for month_key, mdata in months.items():
            if not isinstance(mdata, dict):
                continue
            comps = mdata.get("dailyCompletions") or {}
            if isinstance(comps, dict):
                for habit_id, days in comps.items():
                    if not isinstance(days, dict):
                        continue
                    for day, completed in days.items():
                        try:
                            day_int = int(day)
                        except (TypeError, ValueError):
                            continue
                        conn.execute(
                            "INSERT OR REPLACE INTO daily_completions("
                            "month_key, habit_id, day, completed) VALUES(?, ?, ?, ?)",
                            (str(month_key), str(habit_id), day_int, 1 if completed else 0),
                        )
            notes = mdata.get("dailyNotes") or {}
            if isinstance(notes, dict):
                for habit_id, days in notes.items():
                    if not isinstance(days, dict):
                        continue
                    for day, text in days.items():
                        try:
                            day_int = int(day)
                        except (TypeError, ValueError):
                            continue
                        conn.execute(
                            "INSERT OR REPLACE INTO daily_notes("
                            "month_key, habit_id, day, note_text) VALUES(?, ?, ?, ?)",
                            (str(month_key), str(habit_id), day_int, str(text or "")),
                        )
            review = mdata.get("monthlyReview") or {}
            if isinstance(review, dict):
                conn.execute(
                    "INSERT OR REPLACE INTO monthly_review("
                    "month_key, wins, blockers, focus) VALUES(?, ?, ?, ?)",
                    (
                        str(month_key),
                        str(review.get("wins", "")),
                        str(review.get("blockers", "")),
                        str(review.get("focus", "")),
                    ),
                )

    books = ((state.get("books") or {}).get("items") or [])
    for book in books:
        if not isinstance(book, dict) or not book.get("bookId"):
            continue
        conn.execute(
            "INSERT OR REPLACE INTO books("
            "book_id, title, author, file_id, file_name, file_size, "
            "created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(book["bookId"]), str(book.get("title", "")),
                str(book.get("author", "")), str(book.get("fileId", "")),
                str(book.get("fileName", "")), int(book.get("fileSize", 0) or 0),
                str(book.get("createdAt", "")), str(book.get("updatedAt", "")),
            ),
        )
        for bm in (book.get("bookmarks") or []):
            if not isinstance(bm, dict) or not bm.get("bookmarkId"):
                continue
            real_page = bm.get("realPage")
            try:
                real_page_val = int(real_page) if real_page not in (None, "") else None
            except (TypeError, ValueError):
                real_page_val = None
            conn.execute(
                "INSERT OR REPLACE INTO bookmarks("
                "bookmark_id, book_id, label, pdf_page, real_page, note, "
                "created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(bm["bookmarkId"]), str(book["bookId"]),
                    str(bm.get("label", "Bookmark")),
                    int(bm.get("pdfPage", 1) or 1),
                    real_page_val,
                    str(bm.get("note", "")),
                    str(bm.get("createdAt", "")), str(bm.get("updatedAt", "")),
                ),
            )
            for ev in (bm.get("history") or [])[:MAX_BOOKMARK_HISTORY]:
                if not isinstance(ev, dict) or not ev.get("eventId"):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO bookmark_history("
                    "event_id, bookmark_id, type, at, note) VALUES(?, ?, ?, ?, ?)",
                    (
                        str(ev["eventId"]), str(bm["bookmarkId"]),
                        str(ev.get("type", "updated")),
                        str(ev.get("at", "")), str(ev.get("note", "")),
                    ),
                )
            for s in (bm.get("summaries") or []):
                if not isinstance(s, dict) or not s.get("summaryId"):
                    continue
                duration_ms = s.get("durationMs")
                try:
                    duration_val = int(duration_ms) if duration_ms is not None else None
                except (TypeError, ValueError):
                    duration_val = None
                conn.execute(
                    "INSERT OR REPLACE INTO summaries("
                    "summary_id, bookmark_id, model, start_page, end_page, "
                    "is_incremental, based_on_summary_id, status, content, "
                    "chunk_meta, duration_ms, error, created_at, updated_at) "
                    "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        str(s["summaryId"]), str(bm["bookmarkId"]),
                        str(s.get("model", "")),
                        int(s.get("startPage", 1) or 1),
                        int(s.get("endPage", 1) or 1),
                        1 if s.get("isIncremental") else 0,
                        s.get("basedOnSummaryId") or None,
                        str(s.get("status", "ready")),
                        str(s.get("content", "")),
                        json.dumps(s.get("chunkMeta") or {}),
                        duration_val,
                        str(s.get("error", "")),
                        str(s.get("createdAt", "")), str(s.get("updatedAt", "")),
                    ),
                )


def _insert_log(conn, entry):
    conn.execute(
        "INSERT OR REPLACE INTO app_logs("
        "id, timestamp, level, component, operation, message, "
        "error_name, error_message, stack, context, run_id) "
        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            str(entry.get("id", "")),
            str(entry.get("timestamp", "")),
            str(entry.get("level", "info")),
            str(entry.get("component", "app")),
            str(entry.get("operation", "unknown")),
            str(entry.get("message", "")),
            str(entry.get("errorName", "")),
            str(entry.get("errorMessage", "")),
            str(entry.get("stack", "")),
            json.dumps(entry.get("context") or {}),
            str(entry.get("runId", "")),
        ),
    )


def trim_logs(conn):
    conn.execute(
        "DELETE FROM app_logs WHERE id NOT IN ("
        "SELECT id FROM app_logs ORDER BY timestamp DESC LIMIT ?)",
        (MAX_LOG_RECORDS,),
    )


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

STATIC_EXTS = {
    ".html", ".js", ".mjs", ".css", ".json", ".png", ".jpg", ".jpeg",
    ".svg", ".ico", ".webp", ".gif", ".woff", ".woff2", ".ttf",
}


def safe_static_path(url_path):
    rel = unquote(url_path).lstrip("/")
    if not rel:
        rel = "index.html"
    norm = os.path.normpath(rel)
    if norm.startswith("..") or os.path.isabs(norm):
        return None
    full = os.path.join(ROOT_DIR, norm)
    if not os.path.isfile(full):
        return None
    ext = os.path.splitext(full)[1].lower()
    if ext not in STATIC_EXTS:
        return None
    return full


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "HabitTracker/1.0"

    def log_message(self, fmt, *args):
        # Quieter than the default; one line per request.
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # --- helpers ---------------------------------------------------------

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, status, text, ctype="text/plain; charset=utf-8"):
        body = text.encode("utf-8") if isinstance(text, str) else text
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self, max_bytes=64 * 1024 * 1024):
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return None
        if length > max_bytes:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                            {"error": "payload_too_large"})
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
            return None

    # --- routing ---------------------------------------------------------

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/api/migration-status":
            return self._api_migration_status()
        if path == "/api/state":
            return self._api_get_state()
        if path == "/api/secure-settings":
            return self._api_get_secure_settings()
        if path == "/api/logs":
            return self._api_get_logs()
        if path == "/api/prefs":
            return self._api_get_prefs()

        m = re.match(r"^/api/pdf/([^/]+)$", path)
        if m:
            return self._api_get_pdf(m.group(1))

        if path.startswith("/api/"):
            return self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        return self._serve_static(path)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            return self._api_put_state()
        if path == "/api/secure-settings":
            return self._api_put_secure_settings()
        if path == "/api/prefs":
            return self._api_put_prefs()
        return self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/import-legacy":
            return self._api_import_legacy()
        if path == "/api/logs":
            return self._api_post_log()
        m = re.match(r"^/api/pdf/([^/]+)$", path)
        if m:
            return self._api_post_pdf(m.group(1))
        return self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_DELETE(self):
        path = urlparse(self.path).path
        m = re.match(r"^/api/pdf/([^/]+)$", path)
        if m:
            return self._api_delete_pdf(m.group(1))
        if path == "/api/logs":
            return self._api_clear_logs()
        return self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    # --- handlers --------------------------------------------------------

    def _api_migration_status(self):
        with DB_LOCK:
            conn = get_conn()
            try:
                imported = get_meta(conn, "legacy_imported", "0") == "1"
                schema_version = int(get_meta(conn, "schema_version", "1") or 1)
            finally:
                conn.close()
        self._send_json(HTTPStatus.OK, {
            "legacy_imported": imported,
            "schemaVersion": schema_version,
        })

    def _api_get_state(self):
        with DB_LOCK:
            conn = get_conn()
            try:
                state = get_state_blob(conn)
            finally:
                conn.close()
        self._send_json(HTTPStatus.OK, state if state is not None else {})

    def _api_put_state(self):
        body = self._read_json_body()
        if body is None:
            return
        with DB_LOCK:
            conn = get_conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                put_state_blob(conn, body)
                _decompose_state_into_tables(conn, body)
                conn.execute("COMMIT")
            finally:
                conn.close()
        self._send_json(HTTPStatus.OK, {"ok": True})

    def _api_get_secure_settings(self):
        with DB_LOCK:
            conn = get_conn()
            try:
                rows = conn.execute(
                    "SELECT key, value FROM secure_settings").fetchall()
            finally:
                conn.close()
        out = {r["key"]: r["value"] for r in rows}
        # Coerce kdfIterations to int when present (matches client expectation).
        if out.get("kdfIterations") is not None:
            try:
                out["kdfIterations"] = int(out["kdfIterations"])
            except (TypeError, ValueError):
                pass
        self._send_json(HTTPStatus.OK, out)

    def _api_put_secure_settings(self):
        body = self._read_json_body(max_bytes=256 * 1024)
        if not isinstance(body, dict):
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "expected_object"})
        with DB_LOCK:
            conn = get_conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                conn.execute("DELETE FROM secure_settings")
                for k in ("keyCiphertext", "saltBase64", "ivBase64",
                          "kdfIterations", "keyUpdatedAt"):
                    if k in body:
                        v = body[k]
                        conn.execute(
                            "INSERT INTO secure_settings(key, value) VALUES(?, ?)",
                            (k, None if v is None else str(v)),
                        )
                conn.execute("COMMIT")
            finally:
                conn.close()
        self._send_json(HTTPStatus.OK, {"ok": True})

    def _api_get_logs(self):
        with DB_LOCK:
            conn = get_conn()
            try:
                rows = conn.execute(
                    "SELECT id, timestamp, level, component, operation, message, "
                    "error_name AS errorName, error_message AS errorMessage, "
                    "stack, context, run_id AS runId FROM app_logs "
                    "ORDER BY timestamp ASC LIMIT ?",
                    (MAX_LOG_RECORDS,),
                ).fetchall()
            finally:
                conn.close()
        result = []
        for r in rows:
            entry = dict(r)
            try:
                entry["context"] = json.loads(entry["context"]) if entry["context"] else {}
            except (TypeError, ValueError):
                entry["context"] = {}
            result.append(entry)
        self._send_json(HTTPStatus.OK, result)

    def _api_post_log(self):
        entry = self._read_json_body(max_bytes=2 * 1024 * 1024)
        if not isinstance(entry, dict):
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "expected_object"})
        with DB_LOCK:
            conn = get_conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                _insert_log(conn, entry)
                trim_logs(conn)
                conn.execute("COMMIT")
            finally:
                conn.close()
        self._send_json(HTTPStatus.OK, {"ok": True})

    def _api_clear_logs(self):
        with DB_LOCK:
            conn = get_conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                conn.execute("DELETE FROM app_logs")
                conn.execute("COMMIT")
            finally:
                conn.close()
        self._send_json(HTTPStatus.OK, {"ok": True})

    def _api_get_prefs(self):
        with DB_LOCK:
            conn = get_conn()
            try:
                rows = conn.execute(
                    "SELECT key, value FROM prefs WHERE key NOT LIKE '\\_\\_%' ESCAPE '\\'"
                ).fetchall()
            finally:
                conn.close()
        out = {}
        for r in rows:
            try:
                out[r["key"]] = json.loads(r["value"])
            except (TypeError, ValueError):
                out[r["key"]] = r["value"]
        self._send_json(HTTPStatus.OK, out)

    def _api_put_prefs(self):
        body = self._read_json_body(max_bytes=512 * 1024)
        if not isinstance(body, dict):
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "expected_object"})
        with DB_LOCK:
            conn = get_conn()
            try:
                conn.execute("BEGIN IMMEDIATE")
                for k, v in body.items():
                    if str(k).startswith("__"):
                        continue  # reserved keys (e.g. __state__)
                    upsert_pref(conn, str(k), v)
                conn.execute("COMMIT")
            finally:
                conn.close()
        self._send_json(HTTPStatus.OK, {"ok": True})

    def _api_import_legacy(self):
        body = self._read_json_body(max_bytes=128 * 1024 * 1024)
        if not isinstance(body, dict):
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "expected_object"})
        force = bool(body.get("force"))
        with DB_LOCK:
            conn = get_conn()
            try:
                already = get_meta(conn, "legacy_imported", "0") == "1"
                if already and not force:
                    return self._send_json(
                        HTTPStatus.CONFLICT,
                        {"error": "already_imported"},
                    )
                import_legacy(conn, body)
            finally:
                conn.close()
        self._send_json(HTTPStatus.OK, {"ok": True})

    def _api_get_pdf(self, file_id):
        if not PDF_FILE_ID_RE.match(file_id):
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_file_id"})
        path = os.path.join(BOOKS_DIR, f"{file_id}.pdf")
        if not os.path.isfile(path):
            return self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        size = os.path.getsize(path)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(CHUNK)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def _api_post_pdf(self, file_id):
        if not PDF_FILE_ID_RE.match(file_id):
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_file_id"})
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_PDF_BYTES:
            return self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                                   {"error": "payload_too_large_or_empty"})
        os.makedirs(BOOKS_DIR, exist_ok=True)
        final = os.path.join(BOOKS_DIR, f"{file_id}.pdf")
        tmp = final + ".tmp"
        remaining = length
        try:
            with open(tmp, "wb") as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)
            if remaining != 0:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                return self._send_json(HTTPStatus.BAD_REQUEST,
                                       {"error": "incomplete_upload"})
            os.replace(tmp, final)
        except OSError as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            return self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR,
                                   {"error": "write_failed", "detail": str(e)})
        self._send_json(HTTPStatus.OK, {"ok": True, "sizeBytes": length})

    def _api_delete_pdf(self, file_id):
        if not PDF_FILE_ID_RE.match(file_id):
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_file_id"})
        path = os.path.join(BOOKS_DIR, f"{file_id}.pdf")
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError as e:
            return self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR,
                                   {"error": "delete_failed", "detail": str(e)})
        self._send_json(HTTPStatus.OK, {"ok": True})

    def _serve_static(self, url_path):
        full = safe_static_path(url_path)
        if not full:
            return self._send_text(HTTPStatus.NOT_FOUND, "Not found")
        ctype, _ = mimetypes.guess_type(full)
        if not ctype:
            ctype = "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript") or ctype.endswith("json"):
            ctype = ctype + "; charset=utf-8" if "charset" not in ctype else ctype
        size = os.path.getsize(full)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with open(full, "rb") as f:
            while True:
                chunk = f.read(CHUNK)
                if not chunk:
                    break
                self.wfile.write(chunk)


def main():
    init_db()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Habit Tracker server listening on http://{HOST}:{PORT}")
    print(f"  data.db: {DB_PATH}")
    print(f"  books/:  {BOOKS_DIR}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
