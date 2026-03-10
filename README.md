# Habit Maker

Habit Maker is a local-first web app for tracking daily habits and managing personal PDF books with bookmark history. It is built with plain HTML, CSS, and JavaScript, and runs directly in the browser with no backend required.

## Project Information

- Name: `Habit Maker`
- Type: Client-side web application
- Status: Active
- License: MIT
- Author: Semyon
- Repository language: JavaScript, HTML, CSS

## Core Features

- Monthly dashboard with completion summary and progress visuals
- Daily habit tracking grid (day-by-day checkboxes)
- Category management with emoji and color support
- JSON import/export for backup and restore
- Local persistence via browser `localStorage` for app metadata
- IndexedDB persistence for PDF binaries
- Books module:
- Upload PDF (max 40MB)
- Track per-book metadata (`title`, `author`, file metadata)
- Create/edit/delete bookmarks (`label`, `pdfPage`, `realPage`, `note`)
- Automatic immutable bookmark history events with ISO timestamps
- Open bookmark in a new tab reader at exact page
- Reader mode with previous/next page and direct page jump
- Responsive layout optimized for desktop and mobile
- Visual analytics via Chart.js:
- Daily completion bar chart
- Category completion stacked bar chart
- Summary donut chart

## Tech Stack

- `index.html`: app structure and semantic layout
- `styles.css`: component styling, layout, and responsive behavior
- `app.js`: state management, rendering, and interactions
- `Chart.js` (CDN): dashboard data visualization

## Quick Start

1. Clone this repository.
2. Open `index.html` in your browser.

Recommended for local development:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Project Structure

```text
habbit_maker/
|- .editorconfig
|- .gitignore
|- CODE_OF_CONDUCT.md
|- CONTRIBUTING.md
|- LICENSE
|- SECURITY.md
|- README.md
|- index.html
|- styles.css
|- app.js
`- auto-sync.sh
```

## Data and Privacy

- Metadata is stored locally in your browser under key `habitTracker_v1`.
- PDF binaries are stored separately in IndexedDB (`habitTracker_books_pdf_v1`).
- No server-side storage is used by default.
- JSON export/import includes habits and books metadata only.
- JSON export/import does not include PDF binaries; after restore, books may require PDF re-upload.
- Clearing browser data removes both metadata and PDF binaries.

## Automation Script

The repository includes `auto-sync.sh` for optional periodic commit and push.

```bash
./auto-sync.sh 15
```

- The argument (`15`) is the sync interval in seconds.
- Stop the script with `Ctrl+C`.

## Open Source Guidelines

- Contributing guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Security policy: `SECURITY.md`
- License: `LICENSE` (MIT)

## Roadmap

- Streak tracking and milestone badges
- Optional reminders and notification support
- PWA install/offline enhancements
- Optional account-based cloud sync

## Acknowledgements

- Charts powered by [Chart.js](https://www.chartjs.org/)
