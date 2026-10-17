-- 0042_order_cetak.sql — Catat resi yang SUDAH DICETAK per order.
--
-- KENAPA PERLU:
--   Halaman Order perlu menjawab "resi ini sudah dicetak atau belum". Itu fakta
--   operasional, bukan turunan data impor: `orders.no_resi` hanya berarti "nomor resi
--   sudah dibuat", BUKAN "label sudah keluar dari printer". Tanpa tabel ini, satu-satunya
--   cara mengetahuinya adalah membuka PDF — dan PDF tidak disimpan di server (file
--   diproses di browser, tidak pernah diunggah).
--
-- KENAPA UPSERT (PK preset_id, no_pesanan), BUKAN RIWAYAT:
--   Yang dibutuhkan adalah "kapan TERAKHIR dicetak". Mencatat setiap klik Cetak akan
--   membuat tabel tumbuh tanpa batas untuk pertanyaan yang jawabannya satu baris.
--
-- KENAPA preset_id di PK:
--   Satu D1 dipakai beberapa toko; nomor pesanan antar toko bisa bertabrakan tanpa
--   preset, dan status cetak satu toko tidak boleh menimpa toko lain.
--
-- no_resi disimpan walau sudah ada di `orders`: resi bisa berubah (ganti kurir), dan
-- baris cetak harus mencerminkan resi yang BENAR-BENAR dicetak, bukan resi terkini.
CREATE TABLE IF NOT EXISTS order_cetak (
  preset_id INTEGER NOT NULL,
  no_pesanan TEXT NOT NULL,
  no_resi TEXT NOT NULL DEFAULT '',
  dicetak_at INTEGER NOT NULL DEFAULT (unixepoch()),
  oleh TEXT,
  file TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (preset_id, no_pesanan)
);

-- Dipakai saat menyocokkan nomor resi di PDF ke order yang dikenal.
CREATE INDEX IF NOT EXISTS idx_order_cetak_resi ON order_cetak (no_resi);

PRAGMA optimize;
