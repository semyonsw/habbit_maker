# Habit Maker

A modern, local-first habit tracking web app built with plain HTML, CSS, and JavaScript.

It helps you track daily and weekly habits, view progress with charts, and manage your routines month by month without any backend setup.

## Features

- Dashboard with monthly overview and progress summary
- Daily habit grid with per-day checkboxes
- Weekly habit tracking view
- Category-based habit organization
- Visual analytics with Chart.js
  - Daily completion bar chart
  - Category completion bar chart
  - Summary donut chart
- Drag-and-drop habit reordering
- Import and export your data as JSON
- Local persistence via browser `localStorage`
- Responsive layout with mobile sidebar support

## Tech Stack

- `index.html` for structure
- `styles.css` for styling and responsive layout
- `app.js` for all app logic and state management
- `Chart.js` (CDN) for charts

## Getting Started

No build tools or package manager are required.

1. Clone or download this repository.
2. Open `index.html` directly in your browser.

Optional (recommended): run a local static server for a smoother dev workflow.

Example with Python:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Project Structure

```text
habbit_maker/
|- index.html
|- styles.css
|- app.js
|- auto-sync.sh
`- README.md
```

## GitHub Auto Sync

This repository is connected to GitHub and includes `auto-sync.sh` to automatically commit and push changes.

Run it from the project root:

```bash
./auto-sync.sh 15
```

The `15` means it checks for changes every 15 seconds (you can change this value).

To stop it, press `Ctrl+C` in the terminal where it is running.

## Data Storage

App data is stored in your browser under the key:

- `habitTracker_v1`

Use the in-app **Export** button to back up your progress and **Import** to restore it.

## Notes

- This is a client-side app; data stays in your browser unless you export it.
- Clearing browser storage will remove local progress unless you have exported backups.

## Future Ideas

- Add streak tracking
- Add habit reminders
- Add PWA support for install/offline behavior
- Add optional cloud sync

## License

You can add your preferred license here (for example, MIT).
