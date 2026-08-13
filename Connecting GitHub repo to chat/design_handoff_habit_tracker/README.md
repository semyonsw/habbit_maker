# Handoff: Habit Tracker — feature strip + design alignment

## Overview
The upstream app `semyonsw/habbit_maker` has grown a set of side features (PDF book
reader, AI summaries, bookmarks/books, model picker, report/log views) that are not part
of the intended product. This handoff covers two jobs:

1. Remove those features and every variable, file, style and dead reference they pull in.
2. Bring the five remaining screens in line with the design in `design/`.

Target output: a Capacitor Android debug APK the user can sideload.

## About the design files
`design/Habit Tracker.dc.html` is a **design reference created in HTML** — a prototype
showing intended look and behaviour, not production code to copy. Open it directly in a
browser (Chrome/Edge; the sibling `support.js` and `android-frame.jsx` must stay next to
it) and it renders as an interactive phone mockup: tap habits, open a detail view, add a
habit, switch tabs. Use it as the visual and behavioural spec.

The real app is vanilla ES-module JavaScript in `src/*.js` with a single `styles.css`.
Implement the design in **that** existing environment — do not introduce React, a
bundler, or the design file's inline-style approach. Move the values into `styles.css`.

## Fidelity
**High-fidelity.** Colours, type, spacing and radii below are final. Match them.

## Screens

### 1. Today (default route)
Header: date line `Wednesday, 13 August` at 11px/600/uppercase, letter-spacing .14em,
colour #6e7488; below it the greeting at 27px/600, letter-spacing -.03em. Right-aligned
completion figure in JetBrains Mono 22px/500 #2ec4a6 with an 11px #6e7488 caption.
Body: a vertical list of habit rows, gap 8px. Row = 13px 14px padding, radius 15px,
background #14161f, 1px border rgba(255,255,255,.06); hover #181b25.
Row contents: 36×36 radius-11 #1c2030 initial tile (JetBrains Mono 13px), then name at
15px/500 (-.012em, line-height 1.25), then an 11.5px #6e7488 meta line joining category,
streak and reminder time with #3a3f4e middot separators. Right edge is either a 60×36
radius-12 counter button (count habits) or a check control (binary habits).
Floating add button opens the add sheet.

### 2. Habit detail
Back link ("Today", 13px #8d94ab, 16px chevron). Category eyebrow, then name at 25px/600.
Three-up stat grid (gap 8px, radius 14, #14161f): current streak in #2ec4a6, best streak,
month goal — all JetBrains Mono 21px with 10.5px #6e7488 captions.
Month calendar: 7-column grid, gap 6px, square cells at radius 8, JetBrains Mono 10.5px.
Tracking section: segmented control (Done / not done | Count) in a #0f1119 track, radius
13, 3px padding, inner buttons radius 10, 13px. Count mode reveals a −/＋ target stepper
(30×30 radius-9 buttons).
Reminder section: label + 46×27 radius-99 toggle; when on, reveals a repeat segmented
control, a custom-day 7-button row, and a `<input type="time">` styled to match.
Footer: outlined Edit button + filled #2ec4a6 Done button (text #08120f), both 14px
padding, radius 14, 14px/600.

### 3. Add / edit habit (bottom sheet)
Scrim rgba(6,8,12,.66). Sheet #14161f, top radius 22, top border rgba(255,255,255,.09),
max-height 82%, 38×4 grab handle. Title 19px/600. Sections labelled 11px/600 uppercase
.12em #6e7488: Name (text input, radius 13, #0f1119, 15px), Category (wrapping chip row,
gap 7, chips 9px 14px radius 11 13px), Tracking (segmented + stepper as above),
Schedule (3-way segmented).

### 4. Analytics
Two-up KPI grid (radius 15, #14161f): month completion in JetBrains Mono 26px #2ec4a6,
perfect days in the same size, captions 11px #6e7488.
Bar chart: flex row, bars radius 6, height transition .4s cubic-bezier(.2,.9,.3,1),
labels JetBrains Mono 10px #565c6e.
Per-habit progress list: name 13px #c9cddb, right-aligned JetBrains Mono 11px #6e7488
figure, 5px radius-99 track #1a1d27 with a filled bar.

### 5. Settings
Title 27px/600. Grouped cards (radius 16, #14161f, 1px rgba(255,255,255,.06), rows
separated by 1px rgba(255,255,255,.06) dividers, rows 15px 16px, labels 14.5px).
- Appearance: Theme (Light | Dark | Auto pill group, active #2c3145) and Week starts on.
- Reminders: Daily reminder toggle + Reminder time (JetBrains Mono 13.5px), the time row
  dimmed while the toggle is off.
- Data: Export data (JSON), Import data (JSON), Reset all data in #e06a5f.
Version line centred, JetBrains Mono 11.5px #4d5364: `Habit Tracker 1.0.0`.

There is **no** Books tab, no reader, no summary view, no bookmarks, and no model picker
anywhere in the design. Settings has exactly the three groups above.

### Bottom navigation
Three tabs only — Today, Analytics, Settings. Container: 8px 12px 12px padding,
background #101219, 1px top border rgba(255,255,255,.07). Each tab is a column, gap 5px,
21px stroke-1.8 line icon over a 10.5px/500 label. Active #eceef4 / #2ec4a6 accent,
inactive #6e7488.

## Interactions
- Tapping a habit row opens detail; back link returns to Today.
- Binary habit: tap toggles done. Count habit: tap increments; tapping past target resets to 0.
- Add button opens the sheet; scrim tap closes it; save writes the habit and closes.
- Screen enter animation: `rise` .28s ease. Sheet: `sheetup` .3s cubic-bezier(.2,.9,.3,1).
- Toggles animate background .2s ease.
- Reminder time row is disabled/dimmed when the daily reminder toggle is off.

## State
Per habit: id, name, category, type (binary|count), target, schedule, reminder {on,
repeat, days[], time}, and a date-keyed completion log. Plus UI state: active route,
selected habit id, sheet open + draft habit, and preferences (theme, week start, daily
reminder + time).

## Design tokens
Colours: page #0d0f14 · surface #14161f · sunken #0f1119 · tile #1c2030 · nav #101219 ·
active pill #2c3145 · accent #2ec4a6 · on-accent #08120f · danger #e06a5f ·
text #eceef4 · secondary #c9cddb · muted #8d94ab · dim #6e7488 · faint #565c6e ·
disabled #4d5364 · divider rgba(255,255,255,.06) · border rgba(255,255,255,.09) ·
scrim rgba(6,8,12,.66).
Type: Public Sans (UI) + JetBrains Mono (all numerals). Sizes 10 / 10.5 / 11 / 11.5 /
12 / 12.5 / 13 / 13.5 / 14 / 14.5 / 15 / 19 / 21 / 25 / 26 / 27px.
Radii: 6 · 8 · 9 · 10 · 11 · 12 · 13 · 14 · 15 · 16 · 22 (sheet top) · 99 (pill).
Spacing: 3 · 5 · 6 · 7 · 8 · 10 · 12 · 13 · 14 · 16 · 18 · 22 · 26px.

## Assets
No new assets. Existing `icons/*` stay. Nav and back-arrow icons are inline stroked SVG
paths — lift them from the design file. Fonts are already vendored in `vendor/fonts/`.

## Files
- `design/Habit Tracker.dc.html` — the design (open in a browser)
- `design/support.js`, `design/android-frame.jsx` — runtime for the design file only; never ship these
- `PROMPT.md` — the prompt to paste into Claude Code
