#!/usr/bin/env bash
set -euo pipefail


INTERVAL="${1:-20}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]] || [[ "$INTERVAL" -lt 1 ]]; then
  echo "Error: interval must be a positive integer (seconds)"
  echo "Usage: ./auto-sync.sh [interval_seconds]"
  exit 1
fi

cd "$REPO_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: $REPO_DIR is not a git repository"
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Auto-sync started for branch '$BRANCH' with interval ${INTERVAL}s"
echo "Press Ctrl+C to stop"

while true; do
  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A

    if ! git diff --cached --quiet; then
      git commit -m "chore: auto-sync $(date '+%Y-%m-%d %H:%M:%S')"
      git push origin "$BRANCH"
      echo "Synced at $(date '+%Y-%m-%d %H:%M:%S')"
    fi
  fi

  sleep "$INTERVAL"
done
