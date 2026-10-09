-- 0014_kategori_program.sql — Kategori Shopee + program multi-level (PRD v2 §3).
-- Revisi fee_rules + seller_presets + products dari 0013. Idempoten (IF NOT EXISTS).

-- Master pemetaan kategori Shopee → tier admin
CREATE TABLE IF NOT EXISTS kategori_tarif (
  kategori_path TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  grup_go TEXT,
  sumber TEXT,
  verifikasi TEXT NOT NULL DEFAULT 'belum'
    CHECK (verifikasi IN ('resmi','resmi_cuplikan','sekunder','belum')),
  diubah_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tier admin (satu baris per tier; persen_final = dasar × (1 − diskon))
CREATE TABLE IF NOT EXISTS tier_admin (
  tier TEXT PRIMARY KEY,
  persen_dasar REAL,
  diskon_persen REAL NOT NULL DEFAULT 0,
  persen_final REAL NOT NULL,
  verifikasi TEXT NOT NULL DEFAULT 'belum'
);

-- Katalog program opsional global
CREATE TABLE IF NOT EXISTS program_katalog (
  kode_program TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  opsional INTEGER NOT NULL DEFAULT 1,
  catatan TEXT
);

-- Toggle program per preset
CREATE TABLE IF NOT EXISTS preset_program (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  kode_program TEXT NOT NULL REFERENCES program_katalog(kode_program),
  aktif INTEGER NOT NULL DEFAULT 0,
  aktif_sejak TEXT,
  aktif_sampai TEXT,
  PRIMARY KEY (preset_id, kode_program)
);

-- Biaya iklan harian per preset (syarat pengguna iklan, input manual K-2)
CREATE TABLE IF NOT EXISTS ads_harian (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,
  biaya_iklan_bersih INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (preset_id, tanggal)
);

-- Penghitung pesanan kumulatif per preset (kuota gratis, ambang Non-Star)
CREATE TABLE IF NOT EXISTS preset_penghitung (
  preset_id INTEGER PRIMARY KEY REFERENCES seller_presets(id) ON DELETE CASCADE,
  pesanan_selesai_kumulatif INTEGER NOT NULL DEFAULT 0,
  bergabung_sejak TEXT,
  upload_produk_pertama TEXT
);

-- Kolom baru (satu ADD per pernyataan, SQLite).
ALTER TABLE seller_presets ADD COLUMN status_berlaku_sejak TEXT;
ALTER TABLE fee_rules ADD COLUMN kode_program TEXT;
ALTER TABLE fee_rules ADD COLUMN ukuran TEXT;
ALTER TABLE fee_rules ADD COLUMN plafon_per_qty INTEGER;
ALTER TABLE fee_rules ADD COLUMN syarat_json TEXT;
ALTER TABLE fee_rules ADD COLUMN verifikasi TEXT NOT NULL DEFAULT 'belum';
ALTER TABLE products ADD COLUMN kategori TEXT;
ALTER TABLE products ADD COLUMN tier_override TEXT;
ALTER TABLE products ADD COLUMN pre_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN ukuran_khusus INTEGER NOT NULL DEFAULT 0;
PRAGMA optimize;
