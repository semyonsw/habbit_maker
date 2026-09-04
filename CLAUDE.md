# Working in this repo

Habit Maker: a local-first habit tracker. Vanilla ES modules, no bundler, no
build step for the web app. Runs three ways from one source tree — desktop
(Python + SQLite), installable PWA (IndexedDB), and an Android APK (Capacitor).

See [README.md](README.md) for what the app does and
[ANDROID.md](ANDROID.md) for the Android specifics.

---

## Always finish a change by rebuilding the APK

**After every completed change, rebuild the APK and leave it in the repo root.**
This is not optional and does not need to be asked for — the phone is the
primary way this app gets used, and a change that has not been packaged has not
been delivered.

```bash
npm run android:build
```

That produces **`habit-maker.apk` in the repo root** — the file to copy to the
phone, replacing the previous one. The filename is deliberately stable so it
overwrites cleanly every time; the build prints the version it just made
(`v1.1.1 (versionCode 3)`) so you can tell one from the next.

Then say plainly, in the summary, that `habit-maker.apk` in the root is updated
and what version it is.

Rules that go with it:

- **Bump the version** when the change is user-visible: `versionCode` **and**
  `versionName` in [android/app/build.gradle](android/app/build.gradle),
  `APP_VERSION` in [src/constants.js](src/constants.js), and `version` in
  `package.json`. Android refuses to install over a higher `versionCode`.
- **Bump `CACHE_VERSION` in [sw.js](sw.js)** whenever anything in `src/`,
  `index.html` or `styles.css` changes. Miss this and an installed PWA keeps
  serving the old cached JavaScript — the fix ships and nothing changes.
- **Add any new `src/*.js` file to the `PRECACHE` list in `sw.js`.**
- `habit-maker.apk` is gitignored (~10MB; git would keep every version for
  ever). Build it, do not commit it.

If a build cannot be run in the current environment, say so explicitly rather
than reporting the change as done.

---

## Commands

```bash
npm run check           # lint + tests — run before every commit
npm test                # node --test, no browser needed
npm run lint
npm run android:build   # stage www/ -> cap sync -> gradlew -> copy to root
npm run android:build -- --verify-only   # is the APK current? (no rebuild)
python3 server/app.py   # desktop build on http://127.0.0.1:3000
```

`android:build` runs all three packaging stages every time on purpose. Stopping
after `cap sync` leaves the assets on disk current while the APK still holds an
older copy — gradle reports success and the app on the phone is simply stale.
Every build ends by CRC-checking each file inside the APK against `www/`.

Needs JDK 21+ (Capacitor's Android library is compiled at 21; a 17 first on
`PATH` fails deep in the gradle output).

---

## Where things live

```
src/scoring.js      PURE maths: schedules, streaks, strength, roll-ups
src/habits.js       stateful reads/writes + the memo cache
src/persistence.js  schema migration, load/save, defaults
src/db.js           picks db-rest.js (desktop/SQLite) or db-idb.js (phone)
src/notifications.js reminders: native alarms, or web timers
src/render-*.js     one file per screen, each registering named renderers
src/sheet.js        overlay mechanics: scroll lock, focus trap, drag, keyboard
tests/              node --test; see the testing notes below
```

## Invariants worth not breaking

- **`src/scoring.js` imports no DOM, no database and no `state`.** That is what
  makes it testable, and it is the part that fails quietly and wrongly rather
  than loudly.
- **Every write to `state` goes through `saveState()`**, which bumps the
  revision counter that invalidates the memo cache in `habits.js`. A write that
  skips it leaves stale streaks and strengths on screen.
- **Reading a month uses `getViewedMonthData()`** (returns `null` when there is
  no record); only code about to store something uses `getCurrentMonthData()`,
  which creates. Rendering a month must never record that the month happened.
- **The overlays live inside `#app`, not `<body>`.** Anything that walks the DOM
  to disable "everything else" must walk the ancestor chain — inerting
  `<body>`'s children inerts `#app`, and `#app` contains the dialog being
  opened. That is what made "Add habit" freeze the screen.
- **`sanitize()` is used in attribute position**, so it escapes quotes too. Do
  not replace it with a `textContent`/`innerHTML` round-trip, which does not.
- **`server.hostname` in `capacitor.config.json` is the IndexedDB origin.**
  Changing it orphans every phone install's data. Treat it as permanent.
- **Never put `--` inside a comment in `AndroidManifest.xml`.** XML forbids it
  and the manifest merger's error names no line.

## Testing

Three suites, all under plain `node --test`:

- `tests/scoring.test.mjs` — the pure maths.
- `tests/render.test.mjs` — every screen rendered against the real
  `index.html` via linkedom.
- `tests/interaction.test.mjs` — the app's real handlers driven by real clicks.

`tests/dom.mjs` models `inert`, `history` and `location.hash`, and its `click()`
**refuses to dispatch on anything a browser would not route a pointer event
to** (`inert`, `disabled`). Keep that: asserting markup *exists* says nothing
about whether it *works*, and the render suite was green throughout the release
where the Add-habit sheet could not be touched. When fixing an interaction bug,
add the case here.

There is no browser in most working environments, so CSS changes can be
reasoned about but not seen. Say which is which when reporting.
