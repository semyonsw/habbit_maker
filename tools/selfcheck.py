"""End-to-end self-check for Habit Maker.

Proves, on this machine, that:

  1. this Python has a working sqlite3 with the features the app needs,
  2. the schema in server/migrations.sql applies cleanly,
  3. the server starts, serves the app shell and answers its own API.

Nothing here touches your real data.db: it runs against a throwaway database
in a temp folder and a port nobody else is using.

Run it directly any time:

    python tools/selfcheck.py

Exit code 0 means everything works.  Every line is prefixed PASS / FAIL / INFO
so the installer can read it, and so can you.
"""

from __future__ import annotations

import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "server" / "app.py"
MIGRATIONS = ROOT / "server" / "migrations.sql"

failures: list[str] = []


def ok(msg: str) -> None:
    print(f"PASS {msg}", flush=True)


def bad(msg: str) -> None:
    failures.append(msg)
    print(f"FAIL {msg}", flush=True)


def info(msg: str) -> None:
    print(f"INFO {msg}", flush=True)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def check_python() -> None:
    if sys.version_info < (3, 10):
        bad(f"Python {sys.version.split()[0]} is too old - 3.10 or newer is needed")
    else:
        ok(f"Python {sys.version.split()[0]}")


def check_files() -> None:
    for path in (APP, MIGRATIONS, ROOT / "index.html", ROOT / "styles.css"):
        if not path.exists():
            bad(f"missing file: {path.relative_to(ROOT)} - the download is incomplete")
    if not failures:
        ok("every file the server needs is present")


def check_sqlite(tmp: Path) -> None:
    ok(f"sqlite3 {sqlite3.sqlite_version}")
    db = tmp / "selfcheck.db"
    try:
        conn = sqlite3.connect(db, isolation_level=None)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(MIGRATIONS.read_text(encoding="utf-8"))
        tables = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        ]
        conn.close()
    except Exception as err:  # noqa: BLE001 - the message is the whole point
        bad(f"the database schema would not apply: {err}")
        return
    if not tables:
        bad("the schema applied but created no tables")
    else:
        ok(f"database schema applies cleanly ({len(tables)} tables)")


def get(url: str, timeout: float = 5.0) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def check_server(tmp: Path) -> None:
    port = free_port()
    env = dict(os.environ)
    env["HABIT_PORT"] = str(port)
    env["HABIT_HOST"] = "127.0.0.1"
    env["HABIT_DB_PATH"] = str(tmp / "server.db")
    env["HABIT_BOOKS_DIR"] = str(tmp / "books")

    proc = subprocess.Popen(
        [sys.executable, str(APP)],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(60):
            if proc.poll() is not None:
                out = (proc.stdout.read() if proc.stdout else "") or "(no output)"
                bad("the server stopped immediately. Its output was:\n" + out.strip())
                return
            try:
                status, _ = get(base + "/api/state", timeout=1.0)
                if status:
                    break
            except OSError:
                time.sleep(0.25)
        else:
            bad(f"the server never answered on port {port}")
            return

        status, body = get(base + "/")
        if status != 200 or b"<html" not in body.lower():
            bad(f"the app page did not load (HTTP {status})")
        else:
            ok("the app page loads")

        status, body = get(base + "/api/state")
        if status != 200:
            bad(f"GET /api/state returned HTTP {status}")
        else:
            try:
                json.loads(body.decode("utf-8"))
                ok("the API answers with valid JSON")
            except Exception:  # noqa: BLE001
                bad("GET /api/state did not return JSON")

        status, _ = get(base + "/styles.css")
        if status != 200:
            bad(f"the stylesheet did not load (HTTP {status})")
        else:
            ok("static files are served")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> int:
    info(f"project: {ROOT}")
    check_python()
    check_files()
    if failures:
        return 1
    with tempfile.TemporaryDirectory(prefix="habit-selfcheck-") as td:
        tmp = Path(td)
        check_sqlite(tmp)
        check_server(tmp)
    if failures:
        print(f"\n{len(failures)} check(s) failed.", flush=True)
        return 1
    print("\nAll checks passed.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
