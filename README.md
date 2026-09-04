# Habit Maker

A local-first habit tracker that does not punish you for missing a day.

Your data lives on your machine — a SQLite file on the PC, IndexedDB on the
phone. There is no account, no server to sign up to, and nothing leaves the
device. It runs three ways from one codebase: as a desktop app behind a small
Python server, as an installable PWA, and as an Android APK.

<p align="center">
  <img src="icons/icon-192.png" width="96" alt="" />
</p>

---

## Why another habit tracker

Most trackers are built around the streak, and the streak is a fragile thing to
hang a habit on: it is worth 40 one day and 0 the next. Losing a long run hurts
far more than extending it rewards, so one bad day is where people quit
entirely.

Habit Maker keeps the streak — it is genuinely motivating while it lasts — but
it leads with a **strength score** instead:

- Every completion pushes it up; every miss decays it; nothing resets it to zero.
- A day you **skip on purpose** counts as neither. Rest days, illness and travel
  are not failures, and you should not have to lie to the app about them.
- Reminders **ease off** as a habit gets stronger, instead of nagging forever
  about something you now do automatically.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [How it works](#how-it-works)
- [Reminders](#reminders)
- [Habit strength](#habit-strength)
- [Architecture](#architecture)
- [Data model](#data-model)
- [HTTP API](#http-api)
- [Environment variables](#environment-variables)
- [Android](#android)
- [Development](#development)
- [Storage and privacy](#storage-and-privacy)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Features

**Tracking**

- Checkbox habits, or count habits with a per-day target (`3/5`).
- Three completion states: done, missed, and **skipped** — skipped is neutral to
  both the streak and the strength score.
- Four schedules: every day, chosen weekdays, chosen days of the month, or a
  repeating custom cycle ("every third day" from a start date).
- Per-habit monthly goal, current streak, best streak and strength.
- **Month navigation** on Today, the habit calendar and Analytics — every month
  you have ever recorded is reachable.
- Per-day notes, prompted by what happened: *"What got in the way?"* after a
  miss, *"Why did you skip?"* after a skip.
- Undo on the two taps that can lose work.

**Habit design**

- An optional **implementation intention** per habit — the "after X, I will do Y,
  in Z" sentence. It shows on the habit row, and it becomes the text of that
  habit's reminder.
- Nine built-in categories.

**Reminders that actually fire**

- Per-habit reminders (every day / weekdays / chosen days, at a chosen time) and
  one optional global daily nudge.
- Real OS alarms on Android, including while the app is closed.
- **Fading**: as a habit's strength climbs past 75%, its reminders thin out —
  and past 90% they drop to a single weekly nudge. Never to zero.
- Settings states plainly whether background delivery is available on the build
  you are running, rather than implying it.

**Analytics**

- Average strength, month completion and perfect days.
- A seven-day bar chart.
- A **year heatmap** — the whole year, one cell per day.
- A **weekday breakdown**: which day of the week you actually fail on.
- **Usual time**: the hour you normally do a habit, from your own completion
  times, averaged circularly so 23:50 and 00:10 land on midnight and not noon.

**Data**

- One-file JSON export and import. **Export opens a real save dialog** where
  the browser has one — you pick the folder, and it reopens there next time.
  On Android it goes through the system share sheet; on Firefox and Safari it
  falls back to the downloads folder. Settings says which you will get before
  you tap.
- Light / dark / auto theme, Monday- or Sunday-first weeks.
- Fully offline. Installable. No telemetry of any kind.

---

## Prerequisites

| Tool | Minimum | Why |
|---|---|---|
| Python | 3.10+ | The desktop server uses `http.server` + `sqlite3` from the standard library. |
| Node.js | 18+ | Only for development: linting, tests, and building the APK. The app has no build step and needs no Node at runtime. |
| A modern browser | Chrome 110+, Firefox 110+, Edge 110+, Safari 16.4+ | ES modules, IndexedDB, and the Notification API. |
| JDK | 21+ | Only to build the Android APK. |

No Docker, no bundler, no `npm install` required just to run it.

---

## Installation

### One click

**Windows** — double-click `Install.bat`, then `Start Habit Maker.bat`.

**macOS / Linux**

```bash
./install.sh
./start.sh
```

The installer checks for Python, creates `data.db` on first run, and writes
`install.log`. `tools/selfcheck.py` reports on an existing install.

### By hand

```bash
python3 server/app.py
# then open http://127.0.0.1:3000
```

### As a PWA

Open the GitHub Pages deployment (or any static host serving the repo root) and
use your browser's **Install** / **Add to Home Screen**. The service worker
caches the shell for offline use; data goes to IndexedDB.

> The desktop build and the phone build are **separate stores**. Move data
> between them with Export / Import. See [Architecture](#architecture).

---

## How it works

**Today** is the working screen. Pick a day from the strip, tap a habit to check
it off. Tap a count habit to add one; tap it past its target to reset (with an
undo). **Hold** any habit for half a second to mark that day skipped — the toast
confirms it, and the streak and strength are left alone. On a keyboard, press
`s` with the control focused.

Tap a habit's name to open its **detail** screen: strength, streaks, the month
calendar (tap a day to cycle *done → skipped → clear*), the note for the
selected day, its patterns, and its tracking and reminder settings.

**Analytics** rolls everything up. **Settings** holds the theme, the global
reminder and Export / Import.

The back button (and Escape) closes an open sheet or dialog rather than leaving
the screen, so a half-written habit is never lost to a stray back press. Month
navigation stops a year before your first record — far enough to back-fill,
close enough that you cannot walk into an endless empty past. Simply *looking*
at a month records nothing; only entering something does.

---

## Reminders

Reminders behave differently on each build, because the platforms genuinely
differ. The app says which one you are on rather than pretending.

| Build | Mechanism | Fires when the app is closed |
|---|---|---|
| Android APK | `@capacitor/local-notifications` → real OS alarms | **Yes** |
| PWA / browser | `Notification` + timers, re-armed on every wake | No — only while a tab is open |

There is no cross-browser API for scheduling a notification for later
(Notification Triggers never shipped past an origin trial), so the web ceiling
really is "while the page is alive". Install the APK if you need reminders that
survive a closed app.

**On Android**, the manifest declares:

- `POST_NOTIFICATIONS` — the Android 13+ runtime permission. The app requests it
  the moment you switch a reminder on, not at launch.
- `SCHEDULE_EXACT_ALARM` — without it a 21:00 reminder can arrive at 23:40 once
  the device is in Doze. It is user-revocable, and revoking it *deletes*
  already-scheduled alarms, which is why the app re-schedules on every resume.
- `RECEIVE_BOOT_COMPLETED` — so reminders survive a reboot.

---

## Habit strength

Strength is an exponentially weighted moving average over a habit's **scheduled**
days — not calendar days, so a 3×/week habit is judged on the three chances it
actually had:

```
score ← score × k  +  credit × (1 − k)        k = 0.5 ^ (1 / halfLife)
```

- `credit` is 1 for a completed day, `value / target` for a partly-done count
  habit, and 0 for a miss.
- A **skipped** day is not scored at all — it is as if it never came.
- **Today** is not scored until it is done. An empty box in the morning is not
  yet a miss.
- `halfLife` is 21 scheduled days ([`SCORE_HALF_LIFE_DAYS`](src/constants.js)):
  the number of consecutive misses that halves the score, and symmetrically how
  long a perfect run takes to close half the remaining gap to 100%.

Because it is smoothed, 100% is unreachable and 80–90% is what a genuinely
consistent habit looks like. One bad day costs a couple of points, which is the
point.

The maths lives in [src/scoring.js](src/scoring.js) — no DOM, no database, no
globals — and is covered by [tests/scoring.test.mjs](tests/scoring.test.mjs).

---

## Architecture

Vanilla ES modules loaded straight from `src/`. No bundler, no framework, no
build step for the web app.

```
index.html ──┬── src/app.js            boot: migrate → load → render → router
             │
             ├── state.js              the single mutable state + a revision counter
             ├── persistence.js        schema migration, load/save, defaults
             ├── db.js ────┬── db-rest.js   PC: SQLite over HTTP
             │             └── db-idb.js    phone/PWA: IndexedDB
             │
             ├── scoring.js            PURE maths: schedules, streaks, strength
             ├── habits.js             stateful reads/writes + a memo cache
             ├── notifications.js      reminders (native alarms / web timers)
             │
             ├── render-shell.js       view switching, renderAll()
             ├── render-today.js       ├─ Today
             ├── render-detail.js      ├─ one habit
             ├── render-analytics.js   ├─ roll-ups
             ├── render-settings.js    └─ settings
             ├── month-nav.js          shared prev/next month control
             ├── modals.js  sheet.js  toast.js
             └── router.js  events.js  logging.js  utils.js
```

**Two backends, one codebase.** [src/db.js](src/db.js) picks an implementation
at boot by hostname: `localhost` → the Python/SQLite REST backend; anything else
(including the Capacitor WebView) → IndexedDB. Every other module imports from
`db.js` and never knows which is live.

They are **independent stores**. This is the app's biggest structural
limitation: your desktop history and your phone history are separate universes
joined only by Export / Import. Real sync would need per-day records rather than
one whole-state blob, and is not implemented.

**Renderer registry.** Modules register named renderers with
[render-registry.js](src/render-registry.js) and call each other through it, so
`habits.js` can trigger a re-render or a reminder reschedule without importing
the render or notification layer and creating a cycle.

---

## Data model

The client state is one JSON object:

```jsonc
{
  "currentYear": 2026,
  "currentMonth": 8,
  "categories": [{ "id": "cat_health", "name": "Health", "emoji": "❤️", "color": "#3E85B5" }],
  "habits": {
    "daily": [{
      "id": "dh_1",
      "name": "Morning reading",
      "cue": "After I pour my coffee, I will read in the kitchen",
      "categoryId": "cat_health",
      "monthGoal": 30,
      "scheduleMode": "fixed",        // fixed | specific_weekdays
                                      // specific_month_days | custom_sequence
      "activeWeekdays": [0,1,2,3,4,5,6],
      "activeMonthDays": [],
      "trackType": "check",           // check | count
      "countTarget": 1,
      "reminder": { "enabled": true, "repeat": "daily", "days": [], "time": "08:00" },
      "mark": "MR",
      "order": 0
    }]
  },
  "months": {
    "2026-09": {
      "dailyCompletions": { "dh_1": { "1": true, "2": 3, "3": -1 } },
      "dailyNotes":       { "dh_1": { "3": "travelling" } },
      "dailyTimes":       { "dh_1": { "1": "07:12" } },
      "monthlyReview":    { "wins": "", "blockers": "", "focus": "" }
    }
  },
  "meta": { "schemaVersion": 7 }
}
```

A day's value is one of:

| Value | Meaning |
|---|---|
| `true` / `false` | a checkbox habit, done or not |
| a number ≥ 0 | a count habit's progress toward its target |
| `-1` (`SKIPPED`) | deliberately skipped — neutral to streak and strength |

`SKIPPED` is negative on purpose: an older build coercing with `>= target` reads
it as "not done" rather than as a completion.

`migrateState()` in [persistence.js](src/persistence.js) upgrades every earlier
schema in place on load, so an old export always opens.

### SQLite

The desktop backend stores the whole client state as one JSON blob in
`prefs.__state__`. [server/migrations.sql](server/migrations.sql) also creates
normalized tables (`categories`, `habits_daily`, `daily_completions`,
`daily_notes`, `monthly_review`) — **nothing writes to them yet**; they are
staged for a future normalization pass. `app_logs` and `prefs` are live.

---

## HTTP API

Localhost only, single user, no auth. Only the desktop build uses it.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/migration-status` | Schema version + whether the legacy import has run |
| `GET` / `PUT` | `/api/state` | The whole client state blob |
| `GET` / `PUT` | `/api/prefs` | Theme, week start, reminder prefs |
| `GET` / `POST` / `DELETE` | `/api/logs` | Activity log |
| `POST` | `/api/import-legacy` | One-shot import of pre-SQLite localStorage data |

Everything else is served as a static file from the repo root.

```bash
curl -s localhost:3000/api/migration-status
curl -s localhost:3000/api/state | head -c 400
```

---

## Environment variables

No `.env` file. Configuration lives in [src/constants.js](src/constants.js) and
at the top of [server/app.py](server/app.py); these three can be overridden at
launch.

| Variable | Description | Default |
|---|---|---|
| `HABIT_HOST` | Bind host | `127.0.0.1` |
| `HABIT_PORT` | TCP port | `3000` |
| `HABIT_DB_PATH` | Path to the SQLite file | `<repo>/data.db` |

```bash
HABIT_PORT=4000 python3 server/app.py
```

---

## Android

See [ANDROID.md](ANDROID.md) for the full setup. In short:

```bash
npm install
npm run android:build      # stage www/ → cap sync → gradlew → copy to root
```

The installable APK lands in the repo root as **`habit-maker.apk`**. Stable
filename, so it replaces the previous one on the phone cleanly; the build prints
the version it just made. Gitignored — build it rather than committing 10MB per
release.

The build script does all three steps every time and then **CRC-checks every
file inside the APK against `www/`**, because gradle will happily report
`BUILD SUCCESSFUL` for an APK whose assets are several edits old.

```bash
npm run android:build -- --verify-only   # is the APK I have current?
adb install -r habit-maker.apk
```

---

## Development

```bash
npm install
npm run lint      # eslint over src/, tests/, scripts/
npm test          # node --test, no browser needed
npm run check     # both
```

Tests are in two halves:

- [tests/scoring.test.mjs](tests/scoring.test.mjs) — the pure maths. Streaks,
  strength, schedules, roll-ups, escaping.
- [tests/render.test.mjs](tests/render.test.mjs) — every screen rendered against
  the **real** `index.html` under [linkedom](https://github.com/WebReflection/linkedom),
  so a renamed mount point or a throwing render fails here instead of on a phone.
- [tests/interaction.test.mjs](tests/interaction.test.mjs) — the app's real
  handlers, driven by real clicks. `click()` in `tests/dom.mjs` refuses to
  dispatch on anything a browser would not route a pointer event to (`inert`,
  `disabled`), and the harness models `inert`, `history` and `location.hash`.
  Asserting that markup *exists* says nothing about whether it *works*: the
  render tests were green while the Add-habit sheet could not be touched.

[CI](.github/workflows/ci.yml) runs both on every push and pull request.

**Guidelines**

- `src/scoring.js` must stay free of DOM, database and `state` imports — that is
  what keeps it testable.
- Every write to `state` goes through `saveState()`, which bumps the revision
  counter that invalidates the memo cache in `habits.js`.
- Reading a month uses `getViewedMonthData()` (returns `null` if there is no
  record); only code that is about to store something uses
  `getCurrentMonthData()`, which creates. Rendering a month must never record
  that the month happened.
- The overlays live inside `#app`, not `<body>`. Anything that walks the DOM to
  disable "everything else" has to walk the ancestor chain — inerting `<body>`'s
  children inerts `#app`, and that contains the dialog you just opened.
- Bump `CACHE_VERSION` in [sw.js](sw.js) and add any new module to its
  `PRECACHE` list when you add a file to `src/`.

---

## Storage and privacy

Nothing leaves your device. There is no analytics, no crash reporting, no remote
config and no network call of any kind at runtime.

| Build | Where your data lives |
|---|---|
| Desktop | `data.db` (SQLite) next to the repo, served only on `127.0.0.1` |
| PWA / Android | IndexedDB (`habitTracker_store_v1`), on-device |

The PWA asks for persistent storage (`navigator.storage.persist()`) so the
browser will not evict it under pressure. Export regularly anyway. Export writes a
single JSON file:

| Where you are running it | What happens |
|---|---|
| Chromium desktop (incl. the local Python build) | A save dialog — you choose the folder and filename, and it reopens there next time |
| Android APK | The system share sheet — Files, Drive, anywhere |
| Firefox / Safari | Straight to the downloads folder |

Import mirrors it, starting in the same remembered folder. Backups are named
`habit-maker-backup-YYYY-MM-DD.json` for the day they were taken.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Run `npm run check` before opening a
pull request.

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
