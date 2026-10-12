-- 0017_laba_registry.sql — Registry per-order anti dobel hitung laba (Lapis 1).
-- Satu baris per (preset_id, no_pesanan): No. Pesanan yang sama tak kehitung dua kali
-- walau file upload overlap antar tanggal. Snapshot laba_snapshot tetap sebagai arsip
-- per (preset_id, tanggal); total periode dihitung dari registry (COUNT DISTINCT).
-- Konvensi: IF NOT EXISTS, TEXT tanggal WIB YYYY-MM-DD, INTEGER rupiah, unixepoch waktu.
CREATE TABLE IF NOT EXISTS laba_order (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  no_pesanan TEXT NOT NULL,
  tanggal_snapshot TEXT NOT NULL,
  tanggal_pesanan TEXT,
  status_pesanan TEXT NOT NULL DEFAULT '',
  omzet INTEGER NOT NULL DEFAULT 0,
  hpp INTEGER NOT NULL DEFAULT 0,
  biaya INTEGER NOT NULL DEFAULT 0,
  pajak INTEGER NOT NULL DEFAULT 0,
  laba INTEGER NOT NULL DEFAULT 0,
  hash_baris TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (preset_id, no_pesanan)
);
CREATE INDEX IF NOT EXISTS idx_laba_order_tgl ON laba_order(preset_id, tanggal_snapshot);
CREATE INDEX IF NOT EXISTS idx_laba_order_pesanan ON laba_order(preset_id, tanggal_pesanan);
PRAGMA optimize;
