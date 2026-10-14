-- 0027_analisa.sql — Halaman /analisa: peta produk Shopee -> SKU, iklan, dan performa.
--
-- Kenapa halaman ini ada: ekspor `parentskudetail*.xlsx` menyebut variasi Shopee
-- memakai ID Shopee sendiri (contoh `138333482525`), BUKAN SKU kita. Tanpa peta, omzet
-- hanya bisa ditaksir lewat dugaan nama. Tabel di bawah menyimpan peta itu apa adanya,
-- termasuk KEPUTUSAN MANUSIA untuk produk yang tidak bisa dipetakan mesin.
--
-- Dua fakta yang membentuk skema ini (penyelidikan file nyata, bukan asumsi):
--   1. Satu Kode Produk Shopee bisa punya BANYAK SKU kita -> `shopee_produk` tidak
--      boleh ber-PK tunggal di kode_produk. PK (kode_produk, sku) menjaga itu sekaligus
--      membuat impor ulang idempoten (INSERT OR REPLACE).
--   2. Produk yang tidak punya SKU kita sama sekali TIDAK boleh ditebak diam-diam.
--      Pertanyaannya masuk `peta_putusan` dan MENUNGGU jawaban manusia. Tabel itu
--      menyimpan siapa yang memutuskan dan kapan — supaya peta yang salah bisa ditelusuri.

-- ── Peta produk Shopee: baris mentah hasil impor ekspor Shopee. ──
-- tingkat='induk'/'variasi' disimpan eksplisit karena asal kolomnya berbeda dan
-- pesanan/omzet HANYA sah dibaca dari baris induk (baris variasi membuatnya berlipat).
CREATE TABLE IF NOT EXISTS shopee_produk (
  kode_produk TEXT NOT NULL,
  sku TEXT NOT NULL,
  tingkat TEXT NOT NULL CHECK (tingkat IN ('variasi','induk')),
  variasi TEXT,
  kode_variasi_shopee TEXT,
  nama_shopee TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (kode_produk, sku)
);
CREATE INDEX IF NOT EXISTS idx_shopee_produk_sku ON shopee_produk(sku);
CREATE INDEX IF NOT EXISTS idx_shopee_produk_tingkat ON shopee_produk(kode_produk, tingkat);

-- ── Pertanyaan yang menunggu jawaban manusia + keputusannya. ──
-- UNIQUE (jenis, acuan) membuat impor berulang TIDAK menumpuk pertanyaan duplikat;
-- jawaban (diputuskan_*) sengaja dibiarkan bila sudah ada — keputusan manusia tidak
-- boleh tertimpa oleh impor berikutnya.
CREATE TABLE IF NOT EXISTS peta_putusan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  UNIQUE (jenis, acuan)
);
-- Index parsial: yang dicari halaman adalah pertanyaan BELUM dijawab, diurut omzet/pesanan
-- terbesar. Index penuh akan memuat keputusan lama yang tidak pernah ditanyakan lagi.
CREATE INDEX IF NOT EXISTS idx_peta_putusan_belum ON peta_putusan(pesanan DESC) WHERE diputuskan_at IS NULL;

-- ── Biaya iklan per produk per hari (impor manual dari Shopee Ads). ──
-- preset_id = toko; satu D1 dipakai beberapa toko, jadi angka iklan tidak boleh tercampur.
CREATE TABLE IF NOT EXISTS ads_produk (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,
  sku TEXT NOT NULL,
  biaya INTEGER NOT NULL DEFAULT 0,
  klik INTEGER,
  dilihat INTEGER,
  omzet_iklan INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (preset_id, tanggal, sku)
);
CREATE INDEX IF NOT EXISTS idx_ads_produk_tgl ON ads_produk(preset_id, tanggal);

-- ── Performa produk per periode (kunjungan, keranjang, konversi). ──
-- Dipisah dari ads_produk karena sumbernya beda (Performa Produk vs Shopee Ads) dan
-- periode bisa bulanan/kuartalan, bukan harian.
CREATE TABLE IF NOT EXISTS performa_produk (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id) ON DELETE CASCADE,
  periode TEXT NOT NULL,
  sku TEXT NOT NULL,
  dilihat INTEGER NOT NULL DEFAULT 0,
  klik INTEGER NOT NULL DEFAULT 0,
  kunjungan INTEGER NOT NULL DEFAULT 0,
  keranjang INTEGER NOT NULL DEFAULT 0,
  pesanan INTEGER NOT NULL DEFAULT 0,
  omzet INTEGER NOT NULL DEFAULT 0,
  melihat_tanpa_beli INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (preset_id, periode, sku)
);

PRAGMA optimize;
