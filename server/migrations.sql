-- Habit Tracker SQLite schema (v2)
-- Applied idempotently at server boot via executescript().
--
-- Notes for maintainers:
-- * `CREATE TABLE IF NOT EXISTS` only takes effect on first install. If you
--   change a column or add a CHECK / FOREIGN KEY to an existing table,
--   existing data.db files will NOT pick it up. Constraint additions made in
--   v2 are documented at the bottom of this file with rebuild SQL kept
--   commented out -- run it manually when you want to upgrade an existing DB.
-- * New indexes (`CREATE INDEX IF NOT EXISTS`) DO apply to existing DBs and
--   are safe to add here.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS habits_daily (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  month_goal INTEGER NOT NULL DEFAULT 20 CHECK (month_goal >= 1),
  schedule_mode TEXT NOT NULL DEFAULT 'fixed'
    CHECK (schedule_mode IN ('fixed','specific_weekdays','specific_month_days')),
  active_weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]'
    CHECK (json_valid(active_weekdays)),
  active_month_days TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(active_month_days)),
  emoji TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_habits_order ON habits_daily(order_index);

CREATE TABLE IF NOT EXISTS daily_completions (
  month_key TEXT NOT NULL CHECK (month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  habit_id TEXT NOT NULL REFERENCES habits_daily(id) ON DELETE CASCADE,
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  PRIMARY KEY (month_key, habit_id, day)
);
CREATE INDEX IF NOT EXISTS idx_completions_month ON daily_completions(month_key);
CREATE INDEX IF NOT EXISTS idx_completions_habit_month ON daily_completions(habit_id, month_key);

CREATE TABLE IF NOT EXISTS daily_notes (
  month_key TEXT NOT NULL CHECK (month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  habit_id TEXT NOT NULL REFERENCES habits_daily(id) ON DELETE CASCADE,
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
  note_text TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (month_key, habit_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_notes_month ON daily_notes(month_key);

CREATE TABLE IF NOT EXISTS monthly_review (
  month_key TEXT PRIMARY KEY
    CHECK (month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  wins TEXT NOT NULL DEFAULT '',
  blockers TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS books (
  book_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bookmarks (
  bookmark_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Bookmark',
  pdf_page INTEGER NOT NULL DEFAULT 1 CHECK (pdf_page >= 1),
  real_page INTEGER CHECK (real_page IS NULL OR real_page >= 1),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);

CREATE TABLE IF NOT EXISTS bookmark_history (
  event_id TEXT PRIMARY KEY,
  bookmark_id TEXT NOT NULL REFERENCES bookmarks(bookmark_id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'updated',
  at TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_history_bookmark ON bookmark_history(bookmark_id, at DESC);

CREATE TABLE IF NOT EXISTS summaries (
  summary_id TEXT PRIMARY KEY,
  bookmark_id TEXT NOT NULL REFERENCES bookmarks(bookmark_id) ON DELETE CASCADE,
  model TEXT NOT NULL DEFAULT '',
  start_page INTEGER NOT NULL DEFAULT 1 CHECK (start_page >= 1),
  end_page INTEGER NOT NULL DEFAULT 1 CHECK (end_page >= 1),
  is_incremental INTEGER NOT NULL DEFAULT 0 CHECK (is_incremental IN (0, 1)),
  based_on_summary_id TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'running', 'failed')),
  content TEXT NOT NULL DEFAULT '',
  chunk_meta TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(chunk_meta)),
  duration_ms INTEGER,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_summaries_bookmark ON summaries(bookmark_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  component TEXT NOT NULL DEFAULT 'app',
  operation TEXT NOT NULL DEFAULT 'unknown',
  message TEXT NOT NULL DEFAULT '',
  error_name TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  stack TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '{}',
  run_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON app_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_component_ts ON app_logs(component, timestamp DESC);

CREATE TABLE IF NOT EXISTS prefs (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS secure_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO schema_meta(key, value) VALUES('schema_version', '2');
INSERT OR IGNORE INTO schema_meta(key, value) VALUES('legacy_imported', '0');

-- ----------------------------------------------------------------------------
-- v1 -> v2 upgrade notes
-- ----------------------------------------------------------------------------
-- v2 added CHECK constraints and FOREIGN KEYs that v1 lacked. Existing
-- databases continue to work, but they will not enforce the new constraints
-- until rebuilt. To upgrade an existing data.db in place, stop the server,
-- back it up, then run the snippet below in `sqlite3 data.db`:
--
--   PRAGMA foreign_keys = OFF;
--   BEGIN;
--   -- Repeat for each constrained table: rename, recreate from this file,
--   -- then `INSERT INTO new SELECT * FROM old;` and `DROP TABLE old;`
--   COMMIT;
--   PRAGMA foreign_keys = ON;
--   VACUUM;
--
-- If you'd rather start fresh: export your data via the in-app JSON export,
-- delete data.db, restart the server, and import.
