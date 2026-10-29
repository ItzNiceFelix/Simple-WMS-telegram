-- 0049_ads_langsung_periode.sql — omzet iklan LANGSUNG + periode laporan iklan.
--
-- KENAPA `omzet_langsung`:
--   Ekspor Shopee Ads memuat dua omzet yang berbeda: `Omzet Penjualan` (semua penjualan yang
--   tersentuh iklan, termasuk yang dibeli belakangan) dan `Penjualan Langsung (GMV Langsung)`
--   (hanya yang dibeli dari iklan itu juga). `ads_produk.omzet_iklan` selama ini menyimpan
--   yang LUAS. ROAS dari kedua angka itu berbeda, dan pada berkas contoh selisihnya sampai
--   Rp 16.500 dari Rp 412.595 (4%) — cukup untuk membalik putusan "hentikan".
--   Default tetap omzet LUAS (keputusan pemilik); kolom ini hanya menambah pembanding.
--
-- KENAPA `ads_periode`:
--   `ads_produk.tanggal` = AWAL periode laporan (satu tanggal untuk semua baris), sehingga
--   rentang laporan yang sebenarnya hilang setelah impor. Akibatnya halaman Analisa bisa
--   membandingkan biaya iklan 22–28 Okt dengan produk 21–27 Okt tanpa satu pun peringatan.
--   Tabel ini menyimpan rentang itu apa adanya supaya tumpang tindihnya bisa dihitung.
CREATE TABLE IF NOT EXISTS ads_periode (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  dari TEXT NOT NULL,
  sampai TEXT NOT NULL,
  baris INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (preset_id, dari, sampai)
);

-- NULL untuk baris lama: belum pernah dibaca dari berkas. BUKAN 0 (yang berarti
-- "terukur nol penjualan langsung").
ALTER TABLE ads_produk ADD COLUMN omzet_langsung INTEGER;
PRAGMA optimize;
