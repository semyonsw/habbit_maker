#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Starts Habit Maker and opens it in your browser. Press Ctrl+C to stop.
#
#      ./start.sh                 default port 3000
#      HABIT_PORT=4000 ./start.sh  another port
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT="${HABIT_PORT:-3000}"
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
    for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
fi

if [ -z "$PY" ]; then
    printf '\n  Python 3.10+ was not found. Run ./install.sh - it explains how to get it.\n\n'
    exit 1
fi

if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
    printf '\n  Port %s is already in use.\n\n' "$PORT"
    printf '  Either close the program using it, or pick another port:\n'
    printf '      HABIT_PORT=4000 ./start.sh\n\n'
    exit 1
fi

# Open the browser once the server actually answers - not before.
(
    for _ in $(seq 1 90); do
        if "$PY" - "$PORT" <<'PROBE' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen("http://127.0.0.1:%s/" % sys.argv[1], timeout=2)
PROBE
        then
            for opener in xdg-open open wslview; do
                command -v "$opener" >/dev/null 2>&1 && { "$opener" "http://localhost:$PORT" >/dev/null 2>&1; break; }
            done
            exit 0
        fi
        sleep 0.5
    done
) &

printf '\n  Habit Maker on http://localhost:%s   (Ctrl+C to stop)\n\n' "$PORT"
HABIT_PORT="$PORT" exec "$PY" server/app.py
