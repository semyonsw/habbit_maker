# Claude Code task — Habit Tracker: strip hidden features, match the design, ship an APK

You are working in the `semyonsw/habbit_maker` repository (branch `main`). It is a
vanilla ES-module web app (`index.html`, `src/*.js`, `styles.css`) wrapped as an Android
app with Capacitor (`capacitor.config.json`, `android/`, `src/native.js`).

## First: look at the design
Open `design_handoff_habit_tracker/design/Habit Tracker.dc.html` in a browser. It renders
an interactive phone mockup of the intended app — tap habit rows, open a habit, add one,
switch tabs. That file plus `design_handoff_habit_tracker/README.md` is the spec. Read
both before editing anything. The design file is a reference prototype: it uses React and
inline styles, the real app must not. Recreate the design using the repo's own vanilla JS
modules and `styles.css`.

## Job 1 — remove the hidden features
Delete these features completely, along with every variable, function, style rule, string,
route, nav entry, event, preference key, DB table/field, migration and asset that exists
only to serve them:

- PDF book reading (`src/pdf-reader.js`, `vendor/pdfjs/`)
- Books / library (`src/books.js`, `src/render-books.js`)
- AI summaries (`src/ai-summary.js`, `src/model-picker.js`, and `vendor/katex/`,
  `vendor/marked/` if nothing else uses them)
- Bookmarks (wherever they live — they may be entangled with books)
- Report and log views (`src/render-report.js`, `src/render-logs.js`) **only if** they exist
  solely for the features above; keep them if the core app uses them

Rules for this pass:
- Work feature by feature, not file by file. After each removal, grep the whole repo
  (including `index.html`, `styles.css`, `sw.js`, `src/render-registry.js`,
  `src/router.js`, `src/constants.js`, `src/state.js`, `server/app.py`,
  `server/migrations.sql`) for the identifiers you just deleted and clean up every hit.
- Remove now-unused imports, exports, constants, CSS rules, service-worker precache
  entries, `package.json` dependencies and vendored directories.
- Do not delete anything the five core screens depend on. If a module is shared
  (`modals.js`, `persistence.js`, `db*.js`, `encryption.js`, `events.js`,
  `feedback.js`, `logging.js`), surgically remove the feature's parts and keep the rest.
- Preserve existing user data. If a stored habit record carries book/bookmark fields,
  migrate by ignoring them — never drop or rewrite a user's habit history.
- Load the app in a browser after each feature removal and confirm the console is clean
  and all five screens still work. Do not batch all removals and test once at the end.

## Job 2 — align the five screens with the design
Screens: Today, Habit detail, Add/edit habit sheet, Analytics, Settings, plus the
three-tab bottom nav. `README.md` gives exact colours, type, radii, spacing, animations
and per-screen layout. Match it to the pixel. Keep the app's existing module structure,
naming conventions and state patterns — this is a restyle and a prune, not a rewrite.
Settings must end up with exactly three groups: Appearance, Reminders, Data.

## Job 3 — build the APK
```
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```
The artifact lands at `android/app/build/outputs/apk/debug/app-debug.apk`. Bump the
version name in `android/app/build.gradle` to `1.0.0` so it matches the version line in
Settings. Tell me the APK path and its size when it succeeds. If the Android SDK or a
Gradle dependency is missing, stop and report exactly what is missing rather than
guessing at a fix.

## Job 4 — commit and push
Commit in logical steps, not one giant commit:
1. one commit per removed feature (`remove PDF book reader`, `remove AI summaries`, …)
2. one commit for dependency and vendor cleanup
3. one commit per redesigned screen
4. one commit for the version bump

Then push to `main` and report the commit range. Do not force-push, do not rewrite
existing history, and do not commit the APK or `android/app/build/` — check
`.gitignore` covers them first.

## Constraints
- No new frameworks, no bundler, no npm packages beyond what already exists.
- No new features. Nothing beyond the four jobs above.
- If a removal decision is genuinely ambiguous — a module that is half core, half hidden
  feature — leave it, finish everything else, and list the ambiguities for me at the end.
