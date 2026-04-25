-- Habit Tracker SQLite schema (v1)
-- Applied idempotently at server boot via executescript().

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
  category_id TEXT,
  month_goal INTEGER NOT NULL DEFAULT 20,
  schedule_mode TEXT NOT NULL DEFAULT 'fixed',
  active_weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  active_month_days TEXT NOT NULL DEFAULT '[]',
  emoji TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_completions (
  month_key TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month_key, habit_id, day)
);
CREATE INDEX IF NOT EXISTS idx_completions_month ON daily_completions(month_key);

CREATE TABLE IF NOT EXISTS daily_notes (
  month_key TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  note_text TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (month_key, habit_id, day)
);

CREATE TABLE IF NOT EXISTS monthly_review (
  month_key TEXT PRIMARY KEY,
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
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bookmarks (
  bookmark_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Bookmark',
  pdf_page INTEGER NOT NULL DEFAULT 1,
  real_page INTEGER,
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
  start_page INTEGER NOT NULL DEFAULT 1,
  end_page INTEGER NOT NULL DEFAULT 1,
  is_incremental INTEGER NOT NULL DEFAULT 0,
  based_on_summary_id TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  content TEXT NOT NULL DEFAULT '',
  chunk_meta TEXT NOT NULL DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS prefs (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS secure_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO schema_meta(key, value) VALUES('schema_version', '1');
INSERT OR IGNORE INTO schema_meta(key, value) VALUES('legacy_imported', '0');
