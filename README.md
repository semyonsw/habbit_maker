# Habit Maker

Habit Maker is a local-first habit tracker with a built-in PDF workspace. It runs entirely in your browser with no backend and keeps your data on your device.

![Status](https://img.shields.io/badge/status-active-0ea5e9)
![License](https://img.shields.io/badge/license-MIT-22c55e)
![Stack](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20HTML%20%2B%20CSS-f59e0b)

## Preview

Add your real screenshots/GIFs to make this page shine on GitHub:

- Hero demo GIF placeholder: `docs/media/habit-maker-demo.gif`
- Dashboard screenshot placeholder: `docs/media/dashboard.png`
- Books + reader screenshot placeholder: `docs/media/books-reader.png`
- Analytics screenshot placeholder: `docs/media/analytics.png`

Example markdown when assets are ready:

```md
![Habit Maker Demo](docs/media/habit-maker-demo.gif)
```

## Why This Project

- Track daily routines with an easy month grid.
- Keep book/PDF notes and bookmarks in the same app.
- Summarize PDF sections with optional Gemini AI integration.
- Stay private: local-first storage by default.

## Feature Highlights

### Habit Tracker

- Daily checkbox grid across the month
- Category tags with emoji and color
- Weekly/monthly summaries
- Review notes: wins, blockers, focus
- Charts for progress and category analysis

### Books + PDF Reader

- Upload PDFs (up to `40MB` each)
- Create and manage bookmarks with notes
- Reader mode with page navigation and direct page jump
- Reader dark mode options (`full` and `text`)
- Bookmark history with edit/delete actions

### AI Summary (Optional)

- Generate bookmark-oriented PDF summaries
- Gemini model selection support
- Secure API key flow with encrypted on-device settings
- Markdown-formatted summary rendering

## Quick Start

1. Clone the repo.

```bash
git clone <your-repo-url>
cd habbit_maker
```

2. Run a local server.

```bash
python3 -m http.server 8080
```

3. Open in your browser.

```text
http://localhost:8080
```

## Tutorial

### 1) Set up habits

1. Open `Manage`.
2. Add categories (name, emoji, color).
3. Add daily habits linked to categories.

### 2) Track daily progress

1. Go to `Dashboard`.
2. Mark completed habits in the day columns.
3. Review completion cards and charts.

### 3) Add books and bookmarks

1. Go to `Books`.
2. Upload a PDF.
3. Add bookmarks with page + note.
4. Open a bookmark in Reader Mode.

### 4) Use AI summary (optional)

1. In `Books`, configure your Gemini API key.
2. Pick a model.
3. Run summary up to a selected bookmark.
4. Save and review generated markdown summaries.

## Data and Storage

Habit Maker is local-first.

- App state in `localStorage`:
  - `habitTracker_v1`
  - `habitTracker_sidebarCollapsed_v1`
  - `habitTracker_readerDarkEnabled_v1`
  - `habitTracker_readerDarkMode_v1`
- PDF binary files in IndexedDB:
  - DB: `habitTracker_books_pdf_v1`
  - Store: `pdfFiles`

Important: JSON export/import includes metadata and state, but not embedded PDF binaries. Re-upload PDFs after importing on a different browser/device.

## Limits and Validation

- PDF MIME must be `application/pdf`
- Max PDF size: `40 * 1024 * 1024` bytes
- Bookmark history capped per bookmark
- Import payload is validated before migration

## Project Structure

```text
habbit_maker/
|- app.js
|- index.html
|- styles.css
|- auto-sync.sh
|- README.md
|- CONTRIBUTING.md
|- CODE_OF_CONDUCT.md
|- SECURITY.md
`- LICENSE
```

## Auto Sync Script

Run periodic git add/commit/push cycles:

```bash
./auto-sync.sh 15
```

- `15` means 15 seconds between sync attempts
- Stop with `Ctrl+C`

## Troubleshooting

- PDF not opening:
  - Check file type and size
  - Confirm browser IndexedDB availability
- Charts missing:
  - Check internet access for Chart.js CDN
- Reader issues:
  - Refresh and reopen Reader Mode
- AI summary errors:
  - Validate API key, model name, and network access

## Tech Stack

- Frontend: HTML, CSS, JavaScript (no framework)
- Charts: Chart.js
- PDF rendering: pdf.js (CDN fallback)
- Markdown rendering: marked

## Contributing and Community

- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Code of Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security Policy: [SECURITY.md](SECURITY.md)
- License: [LICENSE](LICENSE)

## Roadmap

- Streak badges and milestones
- Better reminders/notifications
- PWA install/offline polish
- Optional sync profile

Built by Semyon.
