-- 0010_laba_rincian.sql — Rincian SKU per snapshot laba harian (revisi Order.all).
-- Kolom baru rincian_json: array RincianSku (sku, unit, hppSatuan, hargaJual, marginSatuan, marginPersen, kontribusi).
ALTER TABLE laba_harian ADD COLUMN rincian_json TEXT NOT NULL DEFAULT '[]';
PRAGMA optimize;
