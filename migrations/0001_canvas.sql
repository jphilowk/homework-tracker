CREATE TABLE IF NOT EXISTS canvas_sync (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  snapshot TEXT,
  last_success TEXT,
  last_attempt INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO canvas_sync (id) VALUES (1);
