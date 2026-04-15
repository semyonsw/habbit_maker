# Habit Maker

![Status](https://img.shields.io/badge/status-production--ready-1f9d55)
![Local First](https://img.shields.io/badge/storage-local--first-0b7285)
![Stack](https://img.shields.io/badge/stack-vanilla%20JS%20%7C%20HTML%20%7C%20CSS-f59f00)
![License](https://img.shields.io/badge/license-MIT-2b8a3e)

Habit Maker is a local-first web app for tracking daily habits and managing PDF books in one place.
No backend. No account. All your data stays in your browser.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Who It Is For](#who-it-is-for)
- [Features](#features)
- [Quick Start](#quick-start)
- [How to Use](#how-to-use)
- [Storage and Privacy](#storage-and-privacy)
- [Limits](#limits)
- [Auto Sync Script](#auto-sync-script)
- [Troubleshooting](#troubleshooting)
- [Code Quality](#code-quality)
- [Tech Stack](#tech-stack)
- [Browser Support](#browser-support)
- [Project Structure](#project-structure)
- [Habit Maker - HY](#habit-maker---hy)
- [Contributing, Security, Conduct, License](#contributing-security-conduct-license)

---

## What It Does

- Tracks your daily habits in a monthly grid with checkboxes.
- Shows your progress with summary cards, charts, and analytics.
- Lets you upload PDF books, create page bookmarks, and read them inside the app.
- Optionally generates AI summaries of your bookmarked pages using the Gemini API.
- Keeps everything local in your browser. Nothing is sent to a server unless you use AI summaries.

## Who It Is For

- Anyone who wants a simple habit tracker without signing up for anything.
- Students or professionals who read PDFs and want to save page bookmarks with notes.
- Developers who want to see a clean vanilla JavaScript project with no build tools.

---

## Features

### Habit Tracking

- Monthly grid where each row is a habit and each column is a day.
- Create categories with custom name, emoji, and color.
- Set monthly goals for each habit.
- Add notes to any habit on any day.
- Weekly summary cards show your progress at a glance.
- Analytics page with charts and monthly review notes (wins, blockers, focus).
- The app always opens on today's month automatically.

### Books and PDF Workspace

- Upload PDF files (up to 70 MB each).
- Create bookmarks with a page number and a short note.
- Open any bookmark in Reader Mode to read the PDF right inside the app.
- Jump to any page directly.
- Dark mode for reading (two styles: full invert or text-only).
- Book Finisher Helper: calculates how many pages per day you need to finish a book by a target date.
- Bookmark event history (keeps up to 200 events).

### AI Summary (Optional)

- Uses the Gemini API to summarize text from your bookmarked PDF pages.
- Pick a Gemini model from a built-in list.
- Your API key is encrypted and stored on your device with a passphrase you choose.
- Summary output is formatted in Markdown.
- Requires internet access and a valid Gemini API key.

### Export and Import

- Export your full app state as a JSON file.
- Choose whether to include PDF files in the export or keep it lightweight (metadata only).
- Import a backup JSON file to restore everything.

### Logs

- In-app log viewer for debugging.
- Export logs as JSON or CSV.
- Optional live `.log` file writing (requires a browser that supports the File System Access API).

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/semyonsw/habbit_maker.git
cd habbit_maker
```

### 2. Run the app

#### Option A: Double-click `start.bat` (Windows, easiest)

Just double-click `start.bat` in the project folder. It will:

1. Start a local server on port 3000.
2. Wait a couple of seconds for the server to be ready.
3. Open `http://localhost:3000` in your default browser automatically.
4. Keep the terminal open so you can see what is happening.
5. Press any key in the terminal to stop the server when you are done.

> **Tip:** You can create a desktop shortcut to `start.bat` so you can launch the app from your desktop without opening the project folder.

> **Requirement:** Python must be installed on your system. You can download it from [python.org](https://www.python.org/downloads/).

#### Option B: Start a server manually

If you are on Mac, Linux, or prefer to run things from the terminal:

**Python (Mac/Linux):**

```bash
python3 -m http.server 3000
```

**Python (Windows terminal):**

```bash
py -m http.server 3000
```

**Node.js (any platform):**

```bash
npx serve . -l 3000
```

Then open `http://localhost:3000` in your browser.

---

## How to Use

### Step 1: Set Up Your Habits

1. Open the **Manage** tab.
2. Create categories first (for example: Health, Study, Work). Each category has a name, emoji, and color.
3. Add daily habits and assign each one to a category.
4. Set a monthly goal for any habit if you want (optional).
5. Go back to **Dashboard** to see your month grid.

### Step 2: Track Your Progress

1. On the **Dashboard**, check the box for each habit you completed on that day.
2. Click the note button on any cell to add a note for that day.
3. Summary cards at the top update automatically as you check things off.
4. Open **Analytics** to see charts and write monthly review notes.

### Step 3: Work with Books

1. Open the **Books** tab.
2. Click "Add Book" and upload a PDF file.
3. Add bookmarks: pick a page number and write a short note about what is there.
4. Click a bookmark to open it in **Reader Mode**. You can navigate pages, jump to a specific page, and turn on dark mode.
5. Use the **Book Finisher Helper** to calculate how many pages per day you need to finish the book by a specific date.

### Step 4: AI Summaries (Optional)

1. In the Books section, open **Summary AI** settings.
2. Paste your Gemini API key.
3. Create a passphrase to encrypt and save the key on your device.
4. Pick a Gemini model from the list.
5. Select a bookmark range and run the summary.
6. Read the generated Markdown summary.

### Step 5: Backup Your Data

1. Use **Export** in the sidebar to download your app state as a JSON file.
2. Leave "Include PDFs" unchecked for a small backup (just metadata and habits).
3. Turn on "Include PDFs" for a full backup that includes your book files.
4. Use **Import** to restore from a saved JSON file.

---

## Storage and Privacy

| What                             | Where                                             |
| -------------------------------- | ------------------------------------------------- |
| Habits, categories, goals, notes | localStorage                                      |
| PDF book files                   | IndexedDB (database: `habitTracker_books_pdf_v1`) |
| Reader and analytics preferences | localStorage                                      |
| App logs                         | localStorage (capped at 1000 entries)             |
| Encrypted API key                | localStorage                                      |

**Privacy:** Everything stays in your browser by default. The only time data leaves your device is if you use the AI summary feature, which sends extracted PDF text to the Gemini API.

## Limits

| Limit                       | Value |
| --------------------------- | ----- |
| Max PDF file size           | 70 MB |
| Max bookmark history events | 200   |
| Max stored log entries      | 1000  |

---

## Auto Sync Script

The repository includes `auto-sync.sh` for automatic git add, commit, and push on a timer.

```bash
./auto-sync.sh 20
```

- `20` means 20 seconds between sync cycles.
- The script checks that you are in a git repository before running.
- Stop it with `Ctrl+C`.

---

## Troubleshooting

### The app does not load after double-clicking `start.bat`

- Make sure Python is installed. Open a terminal and run `py --version`. If it says "not recognized", install Python from [python.org](https://www.python.org/downloads/).
- If port 3000 is already in use, close the other program using it, or edit `start.bat` and change `3000` to another number like `8080`.

### PDF upload does not work

- Make sure the file is actually a PDF (correct extension and type).
- Make sure it is under 70 MB.
- Make sure your browser supports IndexedDB.

### Charts are not showing

- The app loads Chart.js from a CDN. Make sure you have internet access.
- Try refreshing the page and reopening Analytics.

### Reader Mode is broken

- Reload the page and reopen Reader Mode.
- Check that the PDF file still exists in your browser storage (clearing browser data removes it).

### AI summary fails

- Check that your API key is correct.
- Unlock the encrypted key in Summary AI settings.
- Make sure you have internet access to reach the Gemini API.

---

## Code Quality

ESLint is configured for `src/**/*.js` to catch unused imports/variables and other basic safety issues.

```bash
npm install
npm run lint
```

Use this before commits to keep the codebase clean.

---

## Tech Stack

- **HTML5, CSS3, Vanilla JavaScript** - no framework, no build step, no dependencies to install.
- **Chart.js** (loaded from CDN) - for analytics charts.
- **PDF.js 3.11.174** (loaded from CDN) - for rendering PDFs in Reader Mode.
- **Gemini API** - for optional AI summaries.
- **ESLint** (dev dependency) - for static quality checks.

## Browser Support

- Chrome, Edge, Firefox, and Safari (modern versions).
- Requires ES6+ module support, localStorage, and IndexedDB.
- Live `.log` file writing requires a secure context and the File System Access API (Chrome/Edge only).

---

## Project Structure

```
habbit_maker/
|-- index.html              Main app page
|-- styles.css              All styles
|-- start.bat               Double-click to start the app (Windows)
|-- debug.html              Debug/diagnostics page
|-- restore.html            Data restore page
|-- auto-sync.sh            Auto git sync script
|-- src/
|   |-- app.js              App entry point and initialization
|   |-- state.js            Global state and shared variables
|   |-- constants.js        Shared constants (month names, defaults, etc.)
|   |-- utils.js            Utility functions (date helpers, formatting, etc.)
|   |-- persistence.js      Save/load state to localStorage, migrations
|   |-- habits.js           Habit logic (sorting, scheduling, month navigation)
|   |-- books.js            Book and bookmark logic
|   |-- events.js           DOM event listeners
|   |-- modals.js           Modal dialogs (habit editor, notes, confirmations)
|   |-- layout.js           Sidebar, top bar, and layout management
|   |-- preferences.js      User preferences and display settings
|   |-- render-registry.js  View rendering coordinator
|   |-- render-dashboard.js Dashboard view (habit grid, summary cards)
|   |-- render-analytics.js Analytics view (charts, monthly review)
|   |-- render-books.js     Books view (book list, bookmarks, finisher helper)
|   |-- render-logs.js      Logs view
|   |-- pdf-reader.js       PDF Reader Mode (page rendering, navigation)
|   |-- ai-summary.js       AI summary generation with Gemini
|   |-- encryption.js       API key encryption/decryption
|   |-- model-picker.js     Gemini model selection UI
|   |-- data-io.js          Export/import functionality
|   |-- idb.js              IndexedDB operations for PDF storage
|   |-- logging.js          In-app logging system
|-- .editorconfig
|-- .gitignore
|-- README.md
|-- CONTRIBUTING.md
|-- CODE_OF_CONDUCT.md
|-- SECURITY.md
|-- LICENSE
```

---

## Habit Maker - HY

Habit Maker-y local-first veb havelvats e, vory miavorum e amenorya sovorytneri karavarume yev PDF grqeri ashkhatanqayin mijavayre mek teghum.

### Arag meknark

1. Clone ara repository-n yev mtir tghthapanak.

```bash
git clone https://github.com/semyonsw/habbit_maker.git
cd habbit_maker
```

2. Windows-um krknakit sxmir `start.bat` fayli vra. Ayn kkancharkvi servery yev kbatsi browsery avtomatkoren.

3. Kam gortsarqir local server dzernarkoren:

```bash
py -m http.server 3000
```

4. Batsir havelvatsn: `http://localhost:3000`

### Sovorytneri flow

1. Batsir Manage bajiny.
2. Avelatsru category-ner (anun, emoji, guyn).
3. Steghtsir daily habits yev kapir category-neri het.
4. Dashboard-um nshir katarvatsor orery yev hetevir summary qarterine.

### PDF yev bookmark flow

1. Books bajnum upload ara PDF (minchev 70MB).
2. Avelatsru bookmark: eji hamarov yev karts note-ov.
3. Batsir Reader Mode yev ashkhatir ejeri navigation-ov.
4. Anhraqeshtutyan depqum miatsru dark mode (full/text).

### AI ampopum (yst tsankutyan)

1. Books-um mtir Summary AI settings.
2. Mutsqagrir Gemini API key.
3. Steghtsir passphrase, vorpeszy key-y encrypted pahvi ays sarqum.
4. Yntrir model yev gortsarqir summary bookmark range-i hamar.

### Export / Import

1. Export-ov pahir state-y JSON faylum.
2. Yete uzum es poqr backup, pahir Include PDFs yntranqy anjatvatsor.
3. Yete petq e amboghchakan backup, miatsru Include PDFs.
4. Import-ov verakangrir backup-y.

---

## Contributing, Security, Conduct, License

- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- License: [LICENSE](LICENSE)

Built by Semyon.
