# Installing Habit Maker

| Your machine | What to do |
|---|---|
| **Windows** | double-click **`Install.bat`** |
| **Linux / macOS / WSL** | `./install.sh` |

Everything below is only here for when that does not work.

---

## What the installer actually does

Habit Maker has **no runtime dependencies**: the server is Python standard
library only, and the interface is plain JavaScript. So the installer does not
download packages — it *verifies* and *proves*:

1. Finds a Python 3.10+ that is actually usable, rejecting one whose `sqlite3`,
   `ssl` or `venv` module is broken (a common state for Anaconda/Miniconda
   installs). On Windows it offers to install Python 3.12 for you via `winget`.
2. Imports the modules the server uses.
3. Runs [tools/selfcheck.py](tools/selfcheck.py), which:
   - applies the real schema from `server/migrations.sql` to a **throwaway**
     database in a temp folder,
   - starts the **real server** on a spare port against that throwaway database,
   - checks that the app page loads, `/api/state` returns valid JSON, and the
     stylesheet is served,
   - shuts it down again.
4. Warns if something else is already listening on port 3000.
5. Offers the optional developer tools (`npm install`: linter + Android build).
   Say no and nothing about the app changes.
6. Windows: writes `Start Habit Maker.bat` and puts a *Habit Maker* shortcut on
   the Desktop and in the Start menu.

Your real `data.db` is never touched by the installer. Everything is logged to
`install.log`, and re-running is always safe.

You can run the self-check yourself at any time — it is the fastest way to find
out whether a problem is the app or your machine:

```bash
python3 tools/selfcheck.py
```

---

## Troubleshooting

| Message | What it means | Fix |
|---|---|---|
| *Python 3.10 or newer was not found* | No usable Python | Windows: let the installer fetch 3.12. Linux: `sudo apt install python3` |
| *…but it is missing ssl/sqlite3/venv* | Incomplete Python (often conda) | `sudo apt install python3-venv`, or install a normal python.org Python |
| *the app did not pass its own self-check* | Something is genuinely broken | Read the FAIL lines; usually an incomplete download — re-clone |
| *the database schema would not apply* | `data.db`/schema mismatch or a corrupt file | The self-check uses a throwaway DB, so this points at `server/migrations.sql`; open an issue with `install.log` |
| *something is already listening on port 3000* | Another program owns the port | Close it, or `HABIT_PORT=4000 ./start.sh` (Windows: `set HABIT_PORT=4000 && start.bat`) |
| *Node.js 18+ is needed for the developer tools* | Only affects the linter/Android build | [nodejs.org](https://nodejs.org/en/download), or ignore it |
| *the Desktop shortcut could not be created* | Locked-down PC | Start the app from `Start Habit Maker.bat` |

### It starts, but the browser shows nothing

1. Give it a second and reload <http://localhost:3000> — the browser is opened
   as soon as the port answers.
2. If the launcher window printed `Address already in use`, port 3000 is taken.
3. `python3 tools/selfcheck.py` starts everything on a spare port. If that
   passes, the app is fine and the problem is the port or the browser.

### The app loads but my habits are gone

Your data is in `data.db` in the project folder — nothing else. Check that you
are running the app from the same folder as before, that `data.db` is still
there, and that you are not looking at a second clone of the project.

### Android build

The APK is a separate story with its own prerequisites (JDK, Android SDK). See
**[ANDROID.md](ANDROID.md)** — the installer does not attempt it.

---

## Uninstalling

Nothing is installed system-wide:

1. Delete the *Habit Maker* shortcuts from your Desktop and Start menu.
2. Copy `data.db` somewhere safe if you want to keep your history.
3. Delete this folder.
