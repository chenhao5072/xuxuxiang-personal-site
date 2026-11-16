CREATE TABLE IF NOT EXISTS guestbook_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  visible_total INTEGER NOT NULL DEFAULT 0 CHECK (visible_total >= 0)
);
INSERT OR IGNORE INTO guestbook_stats (id, total) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS guestbook_messages (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))
);
CREATE INDEX IF NOT EXISTS guestbook_visible_recent ON guestbook_messages(hidden, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS guestbook_ip_recent ON guestbook_messages(ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS guestbook_recent ON guestbook_messages(created_at DESC);

CREATE TRIGGER IF NOT EXISTS guestbook_count_insert AFTER INSERT ON guestbook_messages
BEGIN
  UPDATE guestbook_stats SET total = total + 1, visible_total = visible_total + (NEW.hidden = 0) WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS guestbook_count_delete AFTER DELETE ON guestbook_messages
BEGIN
  UPDATE guestbook_stats SET total = total - 1, visible_total = visible_total - (OLD.hidden = 0) WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS guestbook_count_visibility AFTER UPDATE OF hidden ON guestbook_messages
BEGIN
  UPDATE guestbook_stats SET visible_total = visible_total + (NEW.hidden = 0) - (OLD.hidden = 0) WHERE id = 1;
END;
