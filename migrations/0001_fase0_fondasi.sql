-- 0001_fase0_fondasi.sql — Simple-WMS-telegram Fase 0
-- Inti: users, scope gudang, sessions, auth_codes (OTP), audit, settings.
-- Konvensi (skill cloudflare-d1): prepared statements di kode, TEXT bukan
-- VARCHAR, INTEGER unixepoch untuk waktu, index untuk kolom filter/JOIN,
-- PRAGMA optimize di akhir. Password = PBKDF2-SHA256 (WebCrypto) di Worker.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,              -- format: pbkdf2$iter$salt_b64$hash_b64 (NULL = belum set)
  password_set_at INTEGER,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','admin','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  notify_problem INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_users_tg ON users(tg_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(id) WHERE active = 1;

CREATE TABLE IF NOT EXISTS user_warehouses (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_uw_warehouse ON user_warehouses(warehouse_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,     -- sha256 hex dari token opaque 32 byte
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ip TEXT,
  ua TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,          -- sha256 hex dari kode 6 digit
  purpose TEXT NOT NULL CHECK (purpose IN ('reset','link','otp')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_codes_tg ON auth_codes(tg_id, purpose, expires_at);

CREATE TABLE IF NOT EXISTS login_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  ip TEXT,
  ua TEXT,
  sukses INTEGER NOT NULL DEFAULT 0,
  alasan TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_tg ON login_audit(tg_id, at DESC);

-- Minimal Fase 0 agar scope gudang valid: 1 gudang ONLINE default.
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 1,
  urutan INTEGER NOT NULL DEFAULT 100,
  is_online INTEGER NOT NULL DEFAULT 0
);
INSERT INTO warehouses (code, nama, urutan, is_online)
  SELECT 'ONLINE','Gudang Online',0,1
  WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE code='ONLINE');

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);

PRAGMA optimize;
