-- 0013_laba_multi_preset.sql — Laba multi-preset toko (PRD v1 §6.1).
-- Baru: seller_presets, fee_rules, laba_snapshot. Lama dibiarkan (deprecated).
-- Konvensi: IF NOT EXISTS, TEXT tanggal WIB YYYY-MM-DD, INTEGER rupiah, unixepoch waktu.

CREATE TABLE IF NOT EXISTS seller_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'shopee',
  status_toko TEXT NOT NULL CHECK (status_toko IN ('non_star','star','star_plus')),
  aktif INTEGER NOT NULL DEFAULT 1,
  dibuat_at INTEGER NOT NULL DEFAULT (unixepoch()),
  diubah_at INTEGER NOT NULL DEFAULT (unixepoch()),
  dihapus_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_presets_aktif ON seller_presets(aktif) WHERE dihapus_at IS NULL;

CREATE TABLE IF NOT EXISTS fee_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  jenis TEXT NOT NULL,
  kategori TEXT NOT NULL DEFAULT '*',
  status_toko TEXT,
  basis TEXT NOT NULL CHECK (basis IN ('persen','flat')),
  unit TEXT NOT NULL DEFAULT 'per_baris' CHECK (unit IN ('per_baris','per_order')),
  nilai REAL NOT NULL CHECK (nilai >= 0),
  plafon INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  aktif INTEGER NOT NULL DEFAULT 1,
  sumber TEXT,
  status_verifikasi TEXT NOT NULL DEFAULT 'belum_diverifikasi'
    CHECK (status_verifikasi IN ('terverifikasi','belum_diverifikasi')),
  catatan TEXT,
  dibuat_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_fee_rules_preset ON fee_rules(preset_id, jenis, kategori);

CREATE TABLE IF NOT EXISTS laba_snapshot (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,
  jml_order INTEGER NOT NULL DEFAULT 0,
  jml_baris INTEGER NOT NULL DEFAULT 0,
  omzet INTEGER NOT NULL DEFAULT 0,
  hpp INTEGER NOT NULL DEFAULT 0,
  biaya INTEGER NOT NULL DEFAULT 0,
  laba INTEGER NOT NULL DEFAULT 0,
  tolak_json TEXT NOT NULL DEFAULT '[]',
  rincian_json TEXT NOT NULL DEFAULT '[]',
  peringatan_json TEXT NOT NULL DEFAULT '[]',
  file TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  by TEXT,
  PRIMARY KEY (preset_id, tanggal)
);
CREATE INDEX IF NOT EXISTS idx_laba_snapshot_tgl ON laba_snapshot(tanggal);

-- Kolom kategori Shopee di master produk (nullable, diisi U-M1/impor).
-- SQLite: ADD COLUMN satu per pernyataan.
ALTER TABLE products ADD COLUMN kategori_shopee TEXT;
PRAGMA optimize;
