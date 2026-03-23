# Habit Maker

![Status](https://img.shields.io/badge/status-production--ready-1f9d55)
![Local First](https://img.shields.io/badge/storage-local--first-0b7285)
![Stack](https://img.shields.io/badge/stack-vanilla%20JS%20%7C%20HTML%20%7C%20CSS-f59f00)
![License](https://img.shields.io/badge/license-MIT-2b8a3e)

Habit Maker is a local-first web app that combines a daily habit tracker with a personal PDF workspace.
You can plan routines, track progress, upload books, create page bookmarks, and generate optional AI summaries.

No backend. No account. Your data stays in your browser.

## Table of Contents

- [Project Presentation (EN)](#project-presentation-en)
- [Features (EN)](#features-en)
- [Quick Start (EN)](#quick-start-en)
- [Tutorials (EN)](#tutorials-en)
- [Storage, Privacy, and Limits (EN)](#storage-privacy-and-limits-en)
- [Auto Sync Script (EN)](#auto-sync-script-en)
- [Troubleshooting (EN)](#troubleshooting-en)
- [Tech Stack and Compatibility (EN)](#tech-stack-and-compatibility-en)
- [Project Presentation (HY)](#project-presentation-hy)
- [Guides and Tutorials (HY)](#guides-and-tutorials-hy)
- [Project Structure](#project-structure)
- [Contributing, Security, Conduct, License](#contributing-security-conduct-license)

---

## Project Presentation (EN)

Habit Maker is built for people who want one focused workspace for both routine tracking and reading workflow.

What this project solves:

- Keeps habit planning and execution in one monthly dashboard.
- Keeps reading notes and PDF bookmarks in the same app.
- Adds optional AI-assisted summaries for faster review of long documents.
- Preserves privacy with local-only storage by default.

Who it is for:

- Users who want to track habits without creating online accounts.
- Students and professionals who read PDFs and need structured bookmarks.
- Developers who want a clean vanilla JavaScript project with zero build tools.

## Features (EN)

### Habit Tracking

- Daily habit grid for the current month.
- Categories with custom name, emoji, and color.
- Weekly summary cards and monthly totals.
- Monthly review notes for wins, blockers, and focus.
- Dashboard and analytics charts.

### Books and PDF Workspace

- Upload PDF files up to 70 MB each.
- Create bookmarks with page number and note text.
- Open bookmarked pages in Reader Mode.
- Page navigation and direct page jump.
- Reader dark mode in two styles: full and text.
- Bookmark event history (capped for performance).

### Optional AI Summary

- Gemini model selection from predefined model list.
- Bookmark-based summary generation from extracted PDF text.
- Markdown-formatted summary output.
- Encrypted API key storage on device with passphrase unlock flow.

### Reliability and Logs

- In-app logs with export to JSON/CSV.
- Optional live .log writing for supported secure browser contexts.
- Error-safe flow for PDF extraction and AI calls.

## Quick Start (EN)

### 1. Clone

```bash
git clone https://github.com/semyonsw/habbit_maker.git
cd habbit_maker
```

### 2. Start a local server

If you use Python:

```bash
python3 -m http.server 8080
```

On Windows (Python launcher):

```bash
py -m http.server 8080
```

### 3. Open in browser

```text
http://localhost:8080
```

## Tutorials (EN)

### Tutorial 1: Create Your Habit System

1. Open the Manage tab.
2. Add categories first (example: Health, Study, Work).
3. Add daily habits and assign each to a category.
4. Set monthly goals where needed.
5. Return to Dashboard to see the month grid populated.

### Tutorial 2: Track Daily Progress and Review Results

1. Open Dashboard.
2. Tick habit cells for each completed day.
3. Watch summary cards update automatically.
4. Open Analytics and add monthly review notes: wins, blockers, and focus.
5. Compare category performance in Analytics charts.

### Tutorial 3: Add a Book and Build Smart Bookmarks

1. Open Books.
2. Upload a PDF file (must be valid PDF, max 70 MB).
3. Add bookmarks with real page numbers and concise notes.
4. Open a bookmark in Reader Mode.
5. Use page jump and dark mode when reading long documents.

### Tutorial 4: Generate AI Summary (Optional)

1. Open Books and go to Summary AI settings.
2. Paste your Gemini API key.
3. Create a passphrase to encrypt and save the key on this device.
4. Select a Gemini model.
5. Run summary from a selected bookmark range.
6. Review generated markdown summary and save it in your workflow.

Note: AI summary requires internet access and a valid Gemini key.

### Tutorial 5: Export and Import Your Data

1. Use Export in the sidebar to save your current app state.
2. Leave Include PDFs unchecked for a lightweight metadata backup.
3. Enable Include PDFs when you need a full backup that can restore book binaries too.
4. Use Import to restore a saved JSON backup.

Reason: metadata-only export stays smaller, while full export embeds PDF binaries from IndexedDB into JSON.

## Storage, Privacy, and Limits (EN)

### Storage model

- Main app state: localStorage.
- PDF binaries: IndexedDB database habitTracker_books_pdf_v1, store pdfFiles.
- Reader/analytics preferences: localStorage.
- Logs: localStorage with capped record size.

### Privacy model

- Local-first by default.
- No mandatory cloud sync.
- No required account.

### Implemented limits

- Max PDF file size: `70 * 1024 * 1024` bytes (70 MB).
- Max bookmark history events: 200.
- Max retained log records: 1000.

## Auto Sync Script (EN)

The repository includes auto-sync.sh for periodic git add/commit/push.

```bash
./auto-sync.sh 20
```

- 20 means 20 seconds between sync cycles.
- Script validates interval and git repository before running.
- Stop with Ctrl+C.

## Troubleshooting (EN)

### PDF upload fails

- Confirm file extension and MIME are PDF.
- Confirm file size is not above 70 MB.
- Confirm browser supports IndexedDB.

### Charts do not render

- Confirm network access to Chart.js CDN.
- Refresh the page and reopen Analytics.

### Reader mode issues

- Reload page and reopen Reader Mode.
- Re-check whether the PDF blob exists in current browser storage.

### AI summary fails

- Verify API key and selected model.
- Unlock encrypted API key in Summary AI settings.
- Confirm internet access to Gemini API endpoint.

## Tech Stack and Compatibility (EN)

### Stack

- HTML5, CSS3, Vanilla JavaScript (no framework, no build step).
- Chart.js (CDN).
- PDF.js 3.11.174 (CDN sources with fallback URL list).
- Gemini API integration for optional summary features.

### Browser compatibility

- Modern Chrome, Edge, Firefox, and Safari are recommended.
- Requires ES6+, localStorage, and IndexedDB.
- Live .log writing requires secure context and File System Access API support.

---

## Project Presentation (HY)

Habit Maker-ը local-first վեբ հավելված է, որը միավորում է ամենօրյա սովորությունների կառավարումը և PDF գրքերի աշխատանքային միջավայրը մեկ տեղում։

Այս նախագիծը օգնում է քեզ՝

- օրական սովորությունները պլանավորել և հետևել ամսական աղյուսակում,
- PDF գրքերի համար պահել էջային bookmark-ներ և նոթեր,
- ցանկության դեպքում ստանալ AI ամփոփումներ,
- պահել տվյալները քո բրաուզերում առանց պարտադիր հաշվի կամ backend-ի։

## Guides and Tutorials (HY)

### Արագ մեկնարկ

1. Clone արա repository-ն և մտիր թղթապանակ։

```bash
git clone https://github.com/semyonsw/habbit_maker.git
cd habbit_maker
```

2. Գործարկիր local server.

```bash
python3 -m http.server 8080
```

Windows-ի համար կարող ես օգտագործել.

```bash
py -m http.server 8080
```

3. Բացիր հավելվածը.

```text
http://localhost:8080
```

### Սովորությունների flow

1. Բացիր Manage բաժինը։
2. Ավելացրու category-ներ (անուն, emoji, գույն)։
3. Ստեղծիր daily habits և կապիր category-ների հետ։
4. Dashboard-ում նշիր կատարված օրերը և հետևիր summary քարտերին։

### PDF և bookmark flow

1. Books բաժնում upload արա PDF (մինչև 70MB)։
2. Ավելացրու bookmark՝ էջի համարով և կարճ note-ով։
3. Բացիր Reader Mode և աշխատիր էջերի navigation-ով։
4. Անհրաժեշտության դեպքում միացրու dark mode (full/text)։

### AI ամփոփում (ըստ ցանկության)

1. Books-ում մտիր Summary AI settings։
2. Մուտքագրիր Gemini API key։
3. Ստեղծիր passphrase, որպեսզի key-ը encrypted պահվի այս սարքում։
4. Ընտրիր model և գործարկիր summary bookmark range-ի համար։

### Export / Import

1. Export-ով պահիր state-ը JSON ֆայլում։
2. Եթե ուզում ես փոքր backup, պահիր Include PDFs ընտրանքը անջատված։
3. Եթե պետք է ամբողջական backup, միացրու Include PDFs, որպեսզի PDF-ներն էլ ներառվեն։
4. Import-ով վերականգնիր backup-ը։

## Project Structure

```text
habbit_maker/
|- .editorconfig
|- app.js
|- index.html
|- styles.css
|- auto-sync.sh
|- README.md
|- CONTRIBUTING.md
|- CODE_OF_CONDUCT.md
|- SECURITY.md
|- exported-data/
`- LICENSE
```

## Contributing, Security, Conduct, License

- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- License: [LICENSE](LICENSE)

Built by Semyon.
