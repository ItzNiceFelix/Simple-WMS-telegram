-- 0047_ads_tak_terpetakan.sql — biaya iklan yang TIDAK bisa dilekatkan ke SKU.
--
-- KENAPA PERLU:
--   Ekspor Shopee Ads memuat baris iklan grup/GMV Max dengan `Kode Produk` = "-". Baris itu
--   bukan milik satu produk, jadi `ads_produk` (yang `sku`-nya NOT NULL) tidak bisa
--   menampungnya dan impor melewatinya. Akibatnya total biaya iklan yang dipakai halaman
--   Analisa LEBIH KECIL daripada yang benar-benar dibelanjakan — pada berkas contoh
--   22–28 Okt 2026 selisihnya Rp 50.228 dari Rp 649.998 (7,73%). Laba toko jadi terlihat
--   lebih baik daripada kenyataan tanpa ada satu pun angka yang menunjuk ke sebabnya.
--
-- KENAPA TABEL SENDIRI, BUKAN `sku = '-'`:
--   Satu sentinel di `ads_produk` akan ikut terjumlah pada setiap `SUM(biaya)` per SKU,
--   muncul sebagai SKU palsu di daftar produk, dan membuat JOIN ke `products` gagal.
--   Tabel terpisah menjaga `ads_produk` tetap berarti "biaya per SKU".
--
-- Kunci unik per (preset, tanggal, nama iklan): ekspor tidak punya ID kampanye yang stabil,
-- dan nama iklan adalah satu-satunya penanda yang terbaca manusia saat peringatan ditampilkan.
CREATE TABLE IF NOT EXISTS ads_tak_terpetakan (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,
  nama_iklan TEXT NOT NULL,
  biaya INTEGER NOT NULL DEFAULT 0,
  dilihat INTEGER,
  klik INTEGER,
  omzet_iklan INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (preset_id, tanggal, nama_iklan)
);
CREATE INDEX IF NOT EXISTS idx_ads_tak_terpetakan_tgl ON ads_tak_terpetakan(preset_id, tanggal);
PRAGMA optimize;
