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
src/reorder.js      hold-and-drag to reorder habits on Today
android/.../FileSaverPlugin.java   local plugin: Android's file-save browser
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
- **A local Capacitor plugin must be registered by hand.** `cap sync` only wires
  up npm plugins, so `MainActivity.onCreate()` calls
  `registerPlugin(FileSaverPlugin.class)` **before** `super.onCreate()` — that is
  where the bridge is built, and a later call is silently too late.
- **JS reaches a plugin as `Capacitor.Plugins.<Name>`, never through
  `Capacitor.registerPlugin`.** The WebView injects one ready-made object per
  registered plugin, each `@PluginMethod` already a promise-returning function.
  `registerPlugin` comes from the `@capacitor/core` npm module, and with no
  bundler nothing puts that in the page — so asking for it returns `null` for
  *every* plugin, silently: Export announced a file saved to Downloads that the
  Android WebView never wrote, and reminders dropped to in-page timers.
  `plugin()` in [src/native.js](src/native.js) is the only place that resolves
  one; keep it that way.
- **On Android, Export must never fall through to `<a download>`.** Capacitor
  wires up no `DownloadListener`, so an anchor download does nothing whatsoever
  and reports nothing. Every native route ends the export — with the truth if
  no file was written.
- **`habit.startDate` empty means "no start date on record".** Never backfill one
  onto an existing habit: it would either erase the history before it or invent
  one. Only the add sheet sets it, to today.
- **Never put `--` inside a comment in `AndroidManifest.xml`.** XML forbids it
  and the manifest merger's error names no line.
- **Two press-and-hold gestures share the habit row.** Holding the *checkbox*
  skips the day (`render-today.js`); holding the *row body* picks it up to drag
  (`reorder.js`). Each handler ignores what is not its own — keep it that way.
  Both timings live in `constants.js`.
- **A gesture that suppresses a later click must do it on a timer, not a flag.**
  Dropping a drag re-renders the list, so the click the browser queued may never
  reach the delegated handler — and a flag nothing clears stays armed and eats
  the user's next unrelated tap.

## Testing

Six suites, all under plain `node --test`:

- `tests/scoring.test.mjs` — the pure maths.
- `tests/render.test.mjs` — every screen rendered against the real
  `index.html` via linkedom.
- `tests/interaction.test.mjs` — the app's real handlers driven by real clicks.
- `tests/data-io.test.mjs` — export/import, with the File System Access API
  stubbed rather than mocked away, asserting on what reached the file.
- `tests/reorder.test.mjs` — the drag, with real rectangles fed to the rows so
  the midpoint arithmetic is actually exercised.
- `tests/notifications.test.mjs` — reminders: the permission negotiation, what
  reaches Android's scheduler, and how a web notification is delivered. The
  Capacitor bridge and `Notification` are stubbed the way the real platforms
  behave — Android's fourth permission state, and a page `Notification`
  constructor that throws the way Chrome-on-Android's does.

`tests/dom.mjs` models `inert`, `history`, `location.hash` and a **deferred**
`requestAnimationFrame` (a synchronous one turns any self-scheduling animation
loop into infinite recursion), and its `click()`
**refuses to dispatch on anything a browser would not route a pointer event
to** (`inert`, `disabled`). Keep that: asserting markup *exists* says nothing
about whether it *works*, and the render suite was green throughout the release
where the Add-habit sheet could not be touched. When fixing an interaction bug,
add the case here.

There is no browser in most working environments, so CSS changes can be
reasoned about but not seen. Say which is which when reporting.
