# Habit Tracker 2.0 — repo migration

Everything in this `repo/` folder is written against your existing repository
layout. Copy the files over the ones in `semyonsw/habbit_maker`, delete the
files listed below, commit, push.

## 1. Replace

| From here | Goes to |
| --- | --- |
| `repo/index.html` | `index.html` |
| `repo/styles.css` | `styles.css` |
| `repo/sw.js` | `sw.js` |
| `repo/manifest.webmanifest` | `manifest.webmanifest` (new — the old build referenced it but the file was missing) |
| `repo/src/*.js` | `src/` (adds `reminders.js`, `render-today.js`, `render-detail.js`, `render-settings.js`; replaces the rest) |

## 2. Keep, unchanged

`src/db.js`, `src/db-idb.js`, `src/db-rest.js`, `server/app.py`,
`server/migrations.sql`, `icons/`, `package.json`, `eslint.config.*`, the
GitHub templates and the licence.

Both storage backends stay live: localhost still persists through the Python
REST server into SQLite, everything else persists on-device in IndexedDB.
`src/constants.js` keeps every key those modules import (`IDB_*`,
`LOGS_STORAGE_KEY`, `MAX_LOG_RECORDS`, `PDF_DB_*`), and `src/logging.js` keeps
`appendLogEntry` / `loadLogs` / `maybeAutoDownloadLogs`, so nothing in the data
layer breaks.

## 3. Delete

Feature code for everything that was cut:

```
src/ai-summary.js        src/books.js           src/pdf-reader.js
src/render-books.js      src/render-report.js   src/render-logs.js
src/render-dashboard.js  src/render-day-focus.js
src/feedback.js         src/model-picker.js    src/encryption.js
src/modals.js           src/events.js          src/layout.js
src/ui-prefs.js         src/preferences.js     src/idb.js
debug.html               restore.html           auto-sync.sh
vendor/pdfjs/            vendor/katex/          vendor/marked/
vendor/chartjs/          vendor/fonts/
```

`vendor/` goes entirely — the new UI draws its charts with plain CSS and uses
the system font stack, so there is nothing left to vendor. That is roughly
900 KB of JavaScript off the install.

Optional: `server/app.py` still exposes `/api/pdfs` and `/api/files` endpoints
that nothing calls now. They are harmless; delete those routes when convenient.

## 4. What changed in the data
Schema version goes 5 → 6. `migrateState()` in `src/persistence.js` does it in
place on first load, so existing data survives:

- Each habit gains `trackType` (`"check"` or `"count"`), `countTarget`, and
  `reminder` (`{enabled, time, repeat, days}`).
- `emoji` is dropped from habits and categories; the UI derives a two-letter
  mark from the habit name instead.
- Daily completions become numbers rather than booleans (`true` → `1`), which
  is what count habits need.
- `custom_sequence` schedules collapse to `fixed`. If you rely on a repeating
  cycle, convert it to chosen weekdays before upgrading.
- `books`, `reports` and `pdfBlobs` are removed from state. **Export a backup
  before upgrading if you want to keep your book and bookmark data** — after
  the first save it is gone from the store.

## 5. Reminders — what they can and cannot do

Each habit carries its own reminder: on/off, a time, and a repeat rule (every
day, weekdays, or chosen days). `src/reminders.js` computes the next occurrence
and arms one timer per habit, re-arming on fire and whenever the app becomes
visible again.

A PWA with no push server cannot wake itself once the OS has killed the page,
so reminders fire while the app is open or still resident in the background. If
you later want reminders that always fire, that needs either a push server
(Web Push + VAPID) or the TWA/native wrapper below with a native alarm plugin.

## 6. Testing on your phone

Fastest path, no APK:

1. Commit and push. GitHub Pages serves it at
   `https://semyonsw.github.io/habbit_maker/`.
2. Open that URL in Chrome on the phone, then menu → **Add to home screen**.
3. Launch from the home-screen icon; it runs standalone and offline.
4. Grant notifications when the reminder toggle asks.

Because `sw.js` bumped to `v8`, the old cache is dropped on first load. If you
see the old UI, pull to refresh once or close and reopen the app.

## 7. Building an APK (optional)

Only needed if you want it in an installer file or on the Play Store.

**PWABuilder (no local setup):**
1. Push first, so the PWA is live at the Pages URL.
2. Go to `pwabuilder.com`, enter the Pages URL, run the report.
3. Package for Android → Signed APK/AAB → download the zip.
4. The zip contains `app-release-signed.apk` and `signing.keystore`. Keep the
   keystore forever; you need it for every future update.

**Bubblewrap (local, more control):**
```
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://semyonsw.github.io/habbit_maker/manifest.webmanifest
bubblewrap build
```

Both produce a Trusted Web Activity — a thin Android wrapper around the same
web app, so every future change is just a push, no rebuild. The one thing a
wrapper does need is `assetlinks.json`: PWABuilder/Bubblewrap generate it, and
it has to be served at `https://semyonsw.github.io/.well-known/assetlinks.json`.
On a project-subpath Pages site that path belongs to your user site
(`semyonsw.github.io`), not to this repo — so either add it to that repo, or
accept the browser address bar showing in the wrapper.
