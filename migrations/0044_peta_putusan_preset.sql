-- 0044_peta_putusan_preset.sql — Peta SKU per toko + bersihkan baris yatim.
--
-- KENAPA PERLU:
--   `peta_putusan` dibuat tanpa `preset_id` (0027). Satu D1 dipakai beberapa toko, jadi
--   pertanyaan "produk Shopee X ini SKU apa?" milik toko A tampil di toko B. Lebih buruk:
--   jawaban "bukan produk kita" (diputuskan_sku = '') dari toko A MENYEMBUNYIKAN pertanyaan
--   yang sama di toko B selamanya, karena filter daftar hanya `diputuskan_at IS NULL`.
--
-- KENAPA REBUILD, BUKAN ALTER + UNIQUE BARU:
--   SQLite tidak bisa menambah UNIQUE lewat ALTER TABLE. Kunci lama (jenis, acuan) harus
--   diganti (preset_id, jenis, acuan); tanpa rebuild, upsert `ON CONFLICT(preset_id, jenis,
--   acuan)` tidak punya index yang cocok dan impor gagal.
--
-- KENAPA preset_id NULLABLE:
--   Baris lama tidak menyimpan asal toko. Menebak toko pertama berarti memindahkan data ke
--   pemilik yang belum tentu benar. NULL = "belum diketahui", ditampilkan di semua toko
--   sampai ada yang menjawabnya; jawaban pertama mengisi preset_id (lihat jawabPertanyaan).

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS peta_putusan_baru (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  /** NULL = baris lama sebelum 0044; tidak diketahui milik toko mana. */
  preset_id INTEGER REFERENCES seller_presets(id) ON DELETE CASCADE,
  jenis TEXT NOT NULL CHECK (jenis IN ('tanpa_sku','sku_tak_ada_master')),
  acuan TEXT NOT NULL,
  nama_shopee TEXT,
  pesanan INTEGER NOT NULL DEFAULT 0,
  omzet INTEGER NOT NULL DEFAULT 0,
  kandidat_json TEXT NOT NULL DEFAULT '[]',
  diputuskan_sku TEXT,
  diputuskan_at INTEGER,
  diputuskan_oleh TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Satu pertanyaan per toko. NULL tidak bentrok dengan NULL di SQLite (NULL != NULL), jadi
  -- baris warisan tetap boleh duplikat sampai dijawab.
  UNIQUE (preset_id, jenis, acuan)
);

INSERT INTO peta_putusan_baru
  (id, preset_id, jenis, acuan, nama_shopee, pesanan, omzet, kandidat_json,
   diputuskan_sku, diputuskan_at, diputuskan_oleh, at)
SELECT id, NULL, jenis, acuan, nama_shopee, pesanan, omzet, kandidat_json,
       diputuskan_sku, diputuskan_at, diputuskan_oleh, at
FROM peta_putusan;

DROP TABLE peta_putusan;
ALTER TABLE peta_putusan_baru RENAME TO peta_putusan;

-- Daftar pertanyaan belum dijawab untuk SATU toko, terbesar dulu. Index parsial: yang dicari
-- hanya baris tanpa keputusan, jadi index penuh akan memuat riwayat jawaban yang tak dipakai.
CREATE INDEX IF NOT EXISTS idx_peta_belum_per_preset
  ON peta_putusan(preset_id, pesanan DESC) WHERE diputuskan_at IS NULL;

PRAGMA foreign_keys = ON;
PRAGMA optimize;

-- Baris performa tanpa toko tidak bisa dibaca toko mana pun (PK diawali preset_id) dan hanya
-- menambah berat index. Sumbernya impor yang menerima presetId 0 sebelum validasi ditambahkan.
DELETE FROM performa_produk WHERE preset_id = 0;
