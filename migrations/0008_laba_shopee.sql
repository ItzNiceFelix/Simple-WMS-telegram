-- 0008_laba_shopee.sql — Snapshot agregat laba harian estimasi Shopee (standalone, tak sentuh stok).
-- Satu baris per tanggal Jakarta (YYYY-MM-DD); hitung ulang di tanggal sama = timpa (REPLACE).
CREATE TABLE IF NOT EXISTS laba_harian (
  tanggal TEXT PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'shopee',
  jml_order INTEGER NOT NULL DEFAULT 0,
  jml_baris INTEGER NOT NULL DEFAULT 0,
  omzet INTEGER NOT NULL DEFAULT 0,
  hpp INTEGER NOT NULL DEFAULT 0,
  biaya INTEGER NOT NULL DEFAULT 0,
  laba INTEGER NOT NULL DEFAULT 0,
  tolak_json TEXT NOT NULL DEFAULT '[]',
  file TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  by TEXT
);
PRAGMA optimize;
