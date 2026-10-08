-- 0004_fase2_notify.sql — Notify queue + grup Telegram (port scaFlow, Fase 2).
-- Pola: notify_queue(kind, payload, target, sent_at, attempts, last_error)
-- + groups lifecycle (detected/active/left) + migrasi supergroup.
CREATE TABLE IF NOT EXISTS notify_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('problem','report','info')),
  payload TEXT NOT NULL,
  target_user INTEGER,
  target_group INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_pending ON notify_queue(sent_at, created_at);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER UNIQUE NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  chat_type TEXT NOT NULL DEFAULT 'group',
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected','active','left')),
  notify_problem INTEGER NOT NULL DEFAULT 0 CHECK (notify_problem IN (0,1)),
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  enabled_by TEXT,
  enabled_at INTEGER,
  last_ok_at INTEGER,
  last_error TEXT,
  last_error_at INTEGER
);

-- users: kolom notifikasi (notify_problem sudah ada dari 0001; pastikan).
-- groups.enabled_by merujuk tg_id (TEXT) — tanpa FK keras agar fleksibel.
PRAGMA optimize;
