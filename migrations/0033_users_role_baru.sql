-- 0033_users_role_baru.sql — CHECK `users.role` masih hanya ('owner','admin','staff','guest'),
-- jadi INSERT role 'high_admin'/'designer' ditolak DB walau kode sudah menerimanya. SQLite tak
-- bisa ubah CHECK inline → bangun ulang tabel users dengan CHECK baru, pindahkan data.
--
-- `staff` TETAP ada di CHECK (bukan kelalaian): itu DEFAULT kolom, dan baris lama bisa
-- menyimpannya. Yang memutuskan baris 'staff' jadi apa adalah whitelist di lib/d1/auth.ts
-- (turun jadi 'guest'), bukan skema — skema hanya menjaga baris tak dikenal tak pernah masuk.
--
-- DUA tabel ber-FK ke users(id) dan keduanya ikut dibackup/dibangun ulang:
--   user_warehouses (migration 0011 sudah menangani ini) dan sessions (0001).
-- sessions WAJIB ikut: tanpa itu `DROP TABLE users` dijalankan dengan FK mati meninggalkan
-- baris sesi yang menunjuk user id yang sudah tak ada → semua user ter-logout paksa dan
-- token_hash yatim menumpuk. TABEL LAIN TIDAK BOLEH DIBANGUN ULANG — D1 menolak DROP/RENAME
-- pada tabel yang jadi target FK, jadi menyentuh tabel yang tak perlu = migrasi gagal total.
-- Wajib: migrasi ini dijalankan SENDIRIAN (wrangler d1 migrations apply 0033_users_role_baru.sql),
-- bukan dibundel bareng migrasi lain dalam satu batch.
PRAGMA foreign_keys = OFF;
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  password_set_at INTEGER,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','high_admin','admin','designer','staff','guest')),
  active INTEGER NOT NULL DEFAULT 1,
  notify_problem INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  jabatan TEXT,
  added_at INTEGER,
  approved_by TEXT,
  role_updated_at INTEGER,
  role_updated_by TEXT,
  gudang_updated_at INTEGER,
  gudang_updated_by TEXT,
  jabatan_updated_at INTEGER,
  jabatan_updated_by TEXT
);
INSERT INTO users_new (id, tg_id, username, display_name, password_hash, password_set_at, role, active, notify_problem, created_at, jabatan, added_at, approved_by, role_updated_at, role_updated_by, gudang_updated_at, gudang_updated_by, jabatan_updated_at, jabatan_updated_by)
  SELECT id, tg_id, username, display_name, password_hash, password_set_at,
    CASE WHEN role NOT IN ('owner','high_admin','admin','designer','staff','guest') THEN 'staff' ELSE role END,
    active, notify_problem, created_at, jabatan, added_at, approved_by, role_updated_at, role_updated_by, gudang_updated_at, gudang_updated_by, jabatan_updated_at, jabatan_updated_by
  FROM users;
CREATE TABLE user_warehouses_backup AS SELECT * FROM user_warehouses;
CREATE TABLE sessions_backup AS SELECT * FROM sessions;
DROP TABLE user_warehouses;
DROP TABLE sessions;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE TABLE user_warehouses (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, warehouse_id)
);
INSERT INTO user_warehouses (user_id, warehouse_id)
  SELECT user_id, warehouse_id FROM user_warehouses_backup;
DROP TABLE user_warehouses_backup;
-- Bentuk tabel disalin APA ADANYA dari 0001; hanya di sini `sessions` didefinisikan ulang.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ip TEXT,
  ua TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO sessions (token_hash, user_id, expires_at, revoked_at, ip, ua, created_at)
  SELECT token_hash, user_id, expires_at, revoked_at, ip, ua, created_at FROM sessions_backup;
DROP TABLE sessions_backup;
CREATE INDEX IF NOT EXISTS idx_users_tg ON users(tg_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(id) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_uw_warehouse ON user_warehouses(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at) WHERE revoked_at IS NULL;
PRAGMA foreign_keys = ON;
PRAGMA optimize;
