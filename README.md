# Habit Maker

![Status](https://img.shields.io/badge/status-production--ready-1f9d55)
![Local First](https://img.shields.io/badge/storage-local--first-0b7285)
![Stack](https://img.shields.io/badge/stack-vanilla%20JS%20%7C%20HTML%20%7C%20CSS-f59f00)
![License](https://img.shields.io/badge/license-MIT-2b8a3e)

Habit Maker is a local-first web app for two things in one place:

- Tracking daily habits in a monthly grid.
- Managing PDF books with bookmarks, reader mode, and optional AI summaries.

No account, no backend, no cloud database by default.
Your data stays in your browser unless you choose to use AI summaries.

---

## Table of Contents

- [What You Get](#what-you-get)
- [60-Second Quick Start](#60-second-quick-start)
- [Install and Run (From Zero)](#install-and-run-from-zero)
- [First 10 Minutes in the App](#first-10-minutes-in-the-app)
- [Feature Guide](#feature-guide)
- [Backup, Restore, and Migration](#backup-restore-and-migration)
- [Storage, Privacy, and Security](#storage-privacy-and-security)
- [Limits](#limits)
- [Troubleshooting](#troubleshooting)
- [Developer Notes](#developer-notes)
- [Project Structure](#project-structure)
- [Useful Utility Files](#useful-utility-files)
- [Contributing, Security, Conduct, License](#contributing-security-conduct-license)

---

## What You Get

### Habit Tracking

- Daily habit grid for each month.
- Categories with custom name, emoji, and color.
- Monthly goal per habit.
- Daily notes per habit/day cell.
- Habit scheduling modes:
  - Fixed (every day)
  - Specific weekdays
  - Specific month days
- Weekly summary cards and dashboard donut summary.

### Books + PDF Workspace

- Upload PDF books (stored locally in IndexedDB).
- Add bookmarks (PDF page + optional real page + note).
- Open bookmarks in Reader Mode.
- Reader controls: next/prev, jump to page, zoom, dark reading modes.
- Book Finisher Helper (pages/day plan to finish by a date).
- Bookmarks keep event history.

### Analytics + Review

- Habit charts (daily, weekly, monthly trends, category performance).
- Books analytics (pace, trends, heatmaps, per-book comparisons).
- Monthly review notes:
  - wins
  - blockers
  - focus for next month

### Optional AI Summaries

- Uses Gemini API to summarize bookmarked PDF ranges.
- Incremental summary flow supported.
- Markdown summary rendering with math support.
- Model picker + language selection.
- API key can be encrypted locally with your passphrase.

### Logs + Diagnostics

- In-app log viewer with filters.
- Export logs as JSON/CSV.
- Optional live `.log` file append (browser support required).

---

## 60-Second Quick Start

If you already have Git + Python installed:

```bash
git clone https://github.com/semyonsw/habbit_maker.git
cd habbit_maker
python3 -m http.server 3000
```

Then open `http://localhost:3000`.

On Windows, you can simply double-click `start.bat`.

---

## Install and Run (From Zero)

This section assumes you are starting from scratch.

### 1) Install prerequisites

You need:

- A modern browser (Chrome, Edge, Firefox, Safari).
- Git (to clone the repo).
- One local static server option:
  - Python 3 (recommended), or
  - Node.js (optional alternative).

### Quick install references

- Git: https://git-scm.com/downloads
- Python: https://www.python.org/downloads/
- Node.js (optional): https://nodejs.org/

### Optional install commands (if useful)

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y git python3 python3-pip
```

macOS (Homebrew):

```bash
brew install git python
```

Windows (PowerShell with winget):

```powershell
winget install --id Git.Git -e
winget install --id Python.Python.3 -e
```

### Verify installs

Run these in a terminal:

```bash
git --version
```

For Python:

```bash
python3 --version
```

On Windows, this can be:

```bash
py --version
```

Optional Node.js check:

```bash
node --version
npm --version
```

### 2) Clone the project

```bash
git clone https://github.com/semyonsw/habbit_maker.git
cd habbit_maker
```

### 3) Start the app

Important: do **not** open `index.html` directly via `file://`.
Use a local HTTP server.

### Windows easiest (double-click)

Double-click `start.bat`.

What it does:

1. Starts `py -m http.server 3000`
2. Opens `http://localhost:3000`
3. Waits until you press a key to stop

Note: this script ends by stopping `python.exe` processes.

### Manual start (all platforms)

Python (macOS/Linux):

```bash
python3 -m http.server 3000
```

Python (Windows terminal):

```bash
py -m http.server 3000
```

Node.js alternative:

```bash
npx serve . -l 3000
```

Then open:

- `http://localhost:3000`

If port 3000 is busy, use another port (for example `8080`) and open that URL.

---

## First 10 Minutes in the App

### 1) Create categories

- Open **Manage**.
- Click **Add Category**.
- Add name, emoji, and color.

### 2) Add habits

- In **Manage**, click **Add Daily Habit**.
- Pick category, emoji, monthly goal.
- Choose schedule mode (fixed / weekdays / month days).

### 3) Track today

- Go to **Dashboard**.
- Check completed habits for today.
- Add note on any day cell when needed.

### 4) Add first PDF book

- Open **Books**.
- Enter title (required) and choose a PDF.
- Click **Upload PDF Book**.

### 5) Add bookmarks and read

- Select a book.
- Click **Add Bookmark**.
- Set page and note.
- Click **Open at Bookmark** to enter Reader Mode.

### 6) (Optional) Configure AI summary

- In **Books > Summary AI Settings**:
  - paste Gemini API key
  - choose model
  - choose summary language
  - save settings
- Use **Summarize up to Bookmark** on a bookmark.

### 7) Make a backup

- Use **Export** in sidebar.
- Metadata-only export is default (small file).
- Enable **Include PDFs in export** for full backup.

---

## Feature Guide

### Habits

- Monthly grid with one row per habit.
- Weekly cards and summary donut update automatically.
- Habit order can be changed.
- Reset current month clears only that month's completions/notes.
- Clear all data resets full app state.

### Books and Reader

- PDF upload validation:
  - must be `.pdf`
  - MIME type `application/pdf`
  - max file size 70MB
- Reader Mode opens in a separate tab with URL query params.
- Reader can add bookmark/history from current page.

### Book Finisher Helper

- Choose book, target date, start page, and reading weekdays.
- App calculates required pages per selected reading day.
- Includes a weekly load plan chart.

### AI Summary (optional)

- Uses Gemini endpoint only when you run summaries.
- Supports regeneration and full rebuild from Summary modal.
- Consolidation mode:
  - ON: merges old + new summary intelligently
  - OFF: appends new segment under separator
- Summary output renders Markdown, with math fallback support.

### Analytics

- Habit analytics with percentage/raw display mode toggle.
- Books analytics range filters: 7d, 30d, 90d, all.
- Monthly review text fields saved per month.

### Logs

- Filter by level, component, text.
- Export JSON/CSV.
- Live `.log` file writing supported only where File System Access API is available in secure context.

---

## Backup, Restore, and Migration

### Export

- Sidebar **Export** downloads a JSON backup of app state.
- If **Include PDFs in export** is ON:
  - PDF blobs are embedded as base64
  - backup can become very large
- If OFF (default):
  - habits/books metadata exported
  - PDFs are not embedded

### Import

- Sidebar **Import** accepts exported JSON.
- State is validated before import.
- If embedded PDFs exist, app restores them to IndexedDB.

### Legacy API key migration

If old plaintext key data is detected, app prompts to migrate it into encrypted storage.

### Auto-restore behavior

On startup, if no real habit data exists, app tries to fetch `habit-tracker-backup-2026-03.json` from project root.
If file does not exist, app starts fresh.

---

## Storage, Privacy, and Security

### Where data is stored

| Data                                | Storage        | Key / DB                                                                      |
| ----------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| Habits/categories/month data        | `localStorage` | `habitTracker_v1`                                                             |
| Encrypted API key material          | `localStorage` | `habitTracker_secure_settings_v1`                                             |
| Optional API key cache (plain text) | `localStorage` | `habitTracker_summary_api_key_cache_v1`                                       |
| Logs                                | `localStorage` | `habitTracker_logs_v1`                                                        |
| Reader theme preferences            | `localStorage` | `habitTracker_readerDarkEnabled_v1`, `habitTracker_readerDarkMode_v1`         |
| Analytics preferences               | `localStorage` | `habitTracker_analyticsDisplayMode_v1`, `habitTracker_booksAnalyticsRange_v1` |
| PDF files                           | `IndexedDB`    | DB: `habitTracker_books_pdf_v1`, Store: `pdfFiles`                            |

### Privacy model

- Local-first by default.
- Data leaves your device only when you use Gemini summaries.
- Clearing browser data removes localStorage + IndexedDB (permanent local data loss).

### API key security

- Encrypted storage uses Web Crypto (`AES-GCM` + `PBKDF2` with high iteration count).
- You choose the passphrase.
- Passphrase is not stored by the app.
- Optional "remember on device" cache stores API key locally for convenience.

---

## Limits

| Limit                                     | Value |
| ----------------------------------------- | ----- |
| Max PDF file size                         | 70MB  |
| Max bookmark history entries per bookmark | 200   |
| Max log records kept in app               | 1000  |
| Live `.log` safety cutoff                 | 10MB  |
| Schema version                            | 4     |

Notes:

- Summary chunk/page limits are dynamic by model and document characteristics.
- Browser storage quota depends on browser/device.

---

## Troubleshooting

### App does not open

- Make sure you started a local server (not `file://`).
- Check Python/Node install.
- Check terminal output for port errors.

### `start.bat` does nothing

- Ensure Python launcher `py` is installed/available.
- Try manual server command in terminal.

### Port already in use

Use another port:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

### PDF upload fails

- Confirm file is real PDF.
- Confirm size <= 70MB.
- Confirm browser supports IndexedDB.

### Reader Mode says PDF missing

- PDF blob is not in this browser profile's IndexedDB.
- Re-upload PDF or import a backup containing embedded PDFs.

### Charts are empty

- Chart.js is CDN-loaded.
- Check internet connection and refresh.

### AI summary fails

- Verify Gemini API key.
- Unlock saved encrypted key if needed.
- Check internet access.
- Try a different model.

### Live `.log` file unavailable

- Requires secure context and File System Access API support.
- Best support is Chrome/Edge.

### Data disappeared

- Browser storage may have been cleared.
- Restore from exported backup JSON if available.

---

## Developer Notes

Runtime requirements:

- No build step.
- No npm install required to run app.

Code quality tooling (dev only):

```bash
npm install
npm run lint
npm run lint:fix
```

Current npm scripts:

- `lint`
- `lint:fix`
- `test` (placeholder)

---

## Project Structure

```text
habbit_maker/
|-- index.html
|-- styles.css
|-- start.bat
|-- debug.html
|-- restore.html
|-- auto-sync.sh
|-- src/
|   |-- app.js
|   |-- state.js
|   |-- constants.js
|   |-- utils.js
|   |-- persistence.js
|   |-- habits.js
|   |-- books.js
|   |-- events.js
|   |-- modals.js
|   |-- layout.js
|   |-- preferences.js
|   |-- render-registry.js
|   |-- render-dashboard.js
|   |-- render-analytics.js
|   |-- render-books.js
|   |-- render-logs.js
|   |-- pdf-reader.js
|   |-- ai-summary.js
|   |-- encryption.js
|   |-- model-picker.js
|   |-- data-io.js
|   |-- idb.js
|   |-- logging.js
```

---

## Useful Utility Files

- `debug.html`: quick localStorage inspector for `habitTracker_v1`.
- `restore.html`: restore helper that attempts to import a specific backup filename.
- `auto-sync.sh`: optional Git auto add/commit/push loop:

```bash
./auto-sync.sh 20
```

Stop with `Ctrl+C`.

---

## Contributing, Security, Conduct, License

- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- License: [LICENSE](LICENSE)

Built by Semyon.
