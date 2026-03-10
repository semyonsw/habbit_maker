# Habit Maker

Habit Maker is a local-first web app for tracking daily habits and managing personal PDF books with bookmark workflows. It is built with plain HTML, CSS, and JavaScript, and runs fully in the browser without a backend.

## Project Snapshot

- Name: `Habit Maker`
- Type: Browser-only client app
- Status: Active
- License: MIT
- Author: Semyon
- Main languages: JavaScript, HTML, CSS

## What It Does

### Habit Tracking

- Monthly habit dashboard with summary cards and progress charts.
- Daily grid with per-day completion toggles.
- Categories with custom emoji and color.
- Monthly review notes (`wins`, `blockers`, `focus`).
- Local data persistence and import/export for backup.

### Books + PDF Module

- Upload and store PDF books locally (max file size: `40MB` each).
- Track book metadata (`title`, `author`, filename, size).
- Create, edit, and delete bookmarks:
  - `label`
  - `pdfPage`
  - `realPage` (optional)
  - `note`
- Open any bookmark in Reader Mode in a new tab.
- Reader Mode includes:
  - previous/next navigation
  - direct page jump
  - add bookmark on current page
  - dark reading mode toggle (`full` and `text` styles)

### Bookmark History (Current Behavior)

- Every bookmark stores history events with timestamp metadata.
- History is capped at `200` events per bookmark in stored state.
- Books panel displays the latest `8` events per bookmark for readability.
- History events can be:
  - appended from reader actions
  - edited (event title/type and note)
  - deleted
- Reader actions now update the bookmark's active `pdfPage`, so "Open at Bookmark" tracks the latest reader-fixed page.

## Data Model and Storage

- App metadata key in `localStorage`: `habitTracker_v1`
- Sidebar state key: `habitTracker_sidebarCollapsed_v1`
- Reader dark-mode keys:
  - `habitTracker_readerDarkEnabled_v1`
  - `habitTracker_readerDarkMode_v1`
- PDF binaries in IndexedDB:
  - DB: `habitTracker_books_pdf_v1`
  - Store: `pdfFiles`

### Important Nuance

- JSON export/import includes habits and books metadata only.
- PDF binary files are not embedded in exported JSON.
- After import on another browser/device, books may show metadata but require re-uploading PDFs.

## Validation and Limits

- PDF upload accepts only valid `.pdf` files with MIME `application/pdf`.
- Maximum PDF size is enforced in code as `40 * 1024 * 1024` bytes.
- Bookmark and import payloads are shape-validated before state migration.

## Tech Stack

- `index.html`: structure, views, and modal markup
- `styles.css`: visual system, responsive layout, components
- `app.js`: state, rendering, reader logic, data persistence
- `Chart.js` (CDN): dashboard charts
- `pdf.js` (CDN fallback chain): in-browser PDF rendering

## Run Locally

1. Clone this repository.
2. Start a local server (recommended):

```bash
python3 -m http.server 8080
```

3. Open `http://localhost:8080`.

You can also open `index.html` directly, but a local server is more reliable for browser features.

## Repository Structure

```text
habbit_maker/
|- app.js
|- auto-sync.sh
|- index.html
|- styles.css
|- README.md
|- CONTRIBUTING.md
|- CODE_OF_CONDUCT.md
|- SECURITY.md
`- LICENSE
```

## Automation Script

`auto-sync.sh` can run periodic git add/commit/push cycles.

```bash
./auto-sync.sh 15
```

- Argument `15` means 15 seconds between sync attempts.
- Stop with `Ctrl+C`.

## Open Source Docs

- Contribution guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Security policy: `SECURITY.md`
- License text: `LICENSE`

## Roadmap Ideas

- Streak tracking and milestone badges
- Notifications/reminders
- PWA install and offline polish
- Optional cloud sync profile

## Acknowledgements

- Charts by [Chart.js](https://www.chartjs.org/)
