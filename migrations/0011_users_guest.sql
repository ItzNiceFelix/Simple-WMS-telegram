-- 0011_users_guest.sql — Role 'guest' dipakai runtime (auth.ts, tambahAdmin) tapi CHECK skema menolak.
-- SQLite tak bisa ubah CHECK inline: buat ulang tabel users dengan CHECK baru, pindahkan data.
-- user_warehouses ikut dibackup/restore karena FK ke users(id).
PRAGMA foreign_keys = OFF;
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  password_set_at INTEGER,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','admin','staff','guest')),
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
    CASE WHEN role NOT IN ('owner','admin','staff','guest') THEN 'staff' ELSE role END,
    active, notify_problem, created_at, jabatan, added_at, approved_by, role_updated_at, role_updated_by, gudang_updated_at, gudang_updated_by, jabatan_updated_at, jabatan_updated_by
  FROM users;
CREATE TABLE user_warehouses_backup AS SELECT * FROM user_warehouses;
DROP TABLE user_warehouses;
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
CREATE INDEX IF NOT EXISTS idx_users_tg ON users(tg_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(id) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_uw_warehouse ON user_warehouses(warehouse_id);
PRAGMA foreign_keys = ON;
PRAGMA optimize;
