# Android app (Capacitor)

The same web app, packaged into a sideloadable APK. The web assets are copied
into the APK, so the phone app is fully offline from the moment it installs and
does not depend on GitHub Pages being up.

This does **not** replace the PWA or the PC/SQLite build — all three run from
this one source tree.

## Build

```bash
npm run android:build
```

**APK: `habit-maker.apk`, in the repo root.** That is the copy to put on the
phone -- gradle's own output stays at
`android/app/build/outputs/apk/debug/app-debug.apk`, six directories down and
named after nothing in particular.

The filename is stable on purpose, so it overwrites the previous one on the
phone cleanly; the build prints the version it just made (`v1.1.1 (versionCode
3)`) so two builds can be told apart. It is gitignored: ~10MB, and git would
keep every release of it for ever.

That is the whole thing. It finds a JDK 21 itself (`JAVA_HOME` wins if set) and
prints the size and version of what it produced.

**Use it rather than the steps by hand.** The build is three stages and the APK
holds a *copy* of the web assets, not a reference to them:

| | |
|---|---|
| `node scripts/build-www.mjs` | stage web assets into `www/` |
| `npx cap sync android` | copy `www/` into `android/app/src/main/assets/public` + register plugins |
| `cd android && ./gradlew assembleDebug` | package that directory into the APK |

Stop after stage 2 — which `npm run android:sync` does, and which reads like a
complete step — and the assets on disk are current while the APK still holds
whatever was there at the last gradle run. Nothing reports an error; you install
it and the app is simply an old build. Running all three every time is the only
reliable way to avoid that, which is what `android:build` does.

**JDK 21, not 17** — Capacitor's Android library is compiled at Java 21, and a
17 that happens to be first on `PATH` fails deep in the gradle output with a
class-file-version error. `scripts/build-apk.mjs` checks the version up front
and says so instead.

`android/local.properties` (gitignored) points gradle at the SDK; Capacitor
writes it on `cap add android`.

### Is the APK I have current?

```bash
node scripts/build-apk.mjs --verify-only
```

Every build ends with this check, and it can be run on its own. It compares the
CRC-32 of each entry in the APK's central directory against the staged file in
`www/` — so it reads what is actually inside the APK rather than trusting the
timestamp, which lies: when the merged inputs have not changed gradle leaves the
existing file alone, so a perfectly current APK can carry an hours-old mtime.
Exits non-zero and names the stale files if anything does not match.

## Pinned versions

| | |
|---|---|
| Capacitor | 8.5.0 (core / cli / android) |
| AGP | 8.13.2 |
| Gradle | 8.14.3 |
| compileSdk / targetSdk | 36 |
| minSdk | 34 |
| JDK | 21 |

## Install

`adb install -r habit-maker.apk`

The APK is on the Windows drive, so it can also be copied over and opened from a
file manager -- which is the usual route here: replace the previous
`habit-maker.apk` on the phone and open it. Nothing here uses Accessibility or Notification Listener, so the
"restricted settings" flag that file-manager installs set does not matter.

To install an update over an existing install, `versionCode` in
`android/app/build.gradle` must be **≥** the installed one, otherwise Android
rejects it. It is currently `1`.

## Things that are load-bearing

**`server.hostname` in `capacitor.config.json` is the IndexedDB origin.**
Changing `habitmaker.app` to anything else orphans all on-device data — the new
origin gets an empty database and the old one becomes unreachable. Treat it as
permanent.

**`src/db.js` must never resolve to the REST backend on the phone.** Capacitor's
default hostname is `localhost`, which is exactly what `detectMode()` uses to
select the Python/SQLite backend. There is no server on the phone, so that would
brick the app on launch. Two independent guards prevent it: the `Capacitor`
global check in `db.js`, and the custom hostname above.

**Never set `launchAutoHide: false` on the SplashScreen plugin.** It ANRs the app
on launch. The plugin's Android 12+ path installs an `OnPreDrawListener` whose
`onPreDraw()` returns `false` unconditionally, and it is only removed by
auto-hide or by an explicit `SplashScreen.hide()`. With auto-hide off, every draw
pass is cancelled while the view tree keeps re-requesting traversals, so the UI
thread spins. Cold-start boot here (33 ES modules + IndexedDB open + first full
render) comfortably exceeds Android's 5s ANR window, so "hide it from JS when the
app is ready" is not a workable strategy — you get "Habit Maker isn't responding"
before the JS ever runs. `hideNativeSplash()` in `src/native.js` is an early-
dismiss optimisation only; auto-hide is what guarantees the splash goes away.

**Reminders need three manifest permissions, and one of them is revocable.**
`POST_NOTIFICATIONS` is the Android 13+ runtime permission -- the plugin
requests it itself, but only if it is declared. `SCHEDULE_EXACT_ALARM` is what
stops a 21:00 reminder arriving at 23:40 under Doze; the user can turn it off in
system settings, and doing so **deletes every alarm already scheduled**. That is
why `src/notifications.js` re-schedules the whole set on every resume rather
than once at install, and why `checkExactAlarms()` exists.
`RECEIVE_BOOT_COMPLETED` re-registers them after a reboot.

**Never put `--` inside a comment in `AndroidManifest.xml`.** XML forbids it, and
the manifest merger's error is `MergeFailureException: Error parsing ...` with no
line number, which reads like a plugin conflict rather than a typo.


**No service worker in the APK.** `sw.js` is not staged into `www/`, and
`index.html` skips registration when the `Capacitor` global exists. Assets are
already local; a service worker would only add a stale cache layer over them.

**Safe-area insets go through `--safe-t/b/l/r` in `styles.css`.** targetSdk 36
forces edge-to-edge and cannot opt out, so the status/navigation bars overlap the
WebView by design. Capacitor's SystemBars injects `--safe-area-inset-*`, which
those four vars prefer over `env()`. Do not reintroduce bare
`env(safe-area-inset-*)` anywhere else in the stylesheet.

## Not available in the APK (vs the browser)

- **Data does not carry over from the PWA.** The GitHub Pages install and the APK
  are different origins with separate IndexedDB stores. Move data with the app's
  own Export (in the PWA) → Import (in the APK). One-time, manual.
- **Saving files goes through the share sheet, not a download.** The Android
  WebView has no download manager wired up, so `<a download>` does nothing.
  `src/native.js` intercepts Export / log export / feedback screenshots, writes
  the file to the app cache and opens the system share sheet instead. There is no
  "Downloads" folder result — pick a destination in the sheet.
- **`showSaveFilePicker` (live log streaming to a file) is unavailable.** It is a
  desktop-Chrome API; `logging.js` already feature-detects it and falls back.
- **No install prompt / no "Add to Home Screen"** — it is a real app now.
- **Nothing needs internet.** The APK makes no network requests at runtime at
  all; the `INTERNET` permission is only there because the Capacitor bridge
  declares it.

## Battery optimisation

The app runs no background service and no `WorkManager`, but it **does** schedule
notifications now, and those are alarms the OS can throttle.

`allowWhileIdle: true` on every scheduled notification is what gets them through
Doze. Aggressive OEM battery managers (One UI's "put unused apps to sleep",
Xiaomi's autostart restrictions) can still delay or drop them; there is no API
that fixes this from inside the app, and the honest answer to "my reminder came
an hour late" is to exempt Habit Maker from battery optimisation in system
settings.

Because a revoked `SCHEDULE_EXACT_ALARM` silently deletes pending alarms, the
app re-schedules on `visibilitychange` and on window focus. Opening the app is
always enough to repair the schedule.
