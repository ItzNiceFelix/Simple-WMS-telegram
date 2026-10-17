-- 0043_sinkron_log.sql — Riwayat impor per jenis berkas, per toko.
--
-- KENAPA PERLU TABEL SENDIRI:
--   Impor Order mencatat riwayatnya di `import_batches`, tetapi Laba, Performa Produk, dan
--   Iklan TIDAK mencatat apa pun. Akibatnya halaman Sinkronisasi hanya bisa menebak "terakhir
--   diimpor kapan" dari `laba_snapshot.at`/`performa_produk.at` — dan tebakan itu salah saat
--   impor gagal atau saat satu berkas menghasilkan banyak baris. Satu baris ringkas per impor
--   menjawab pertanyaan yang sebenarnya: berkas apa, kapan, berapa baris, berapa gagal.
--
-- KENAPA TIDAK MEMAKAI `import_batches`:
--   Tabel itu milik alur Excel stok (payload_json, gudang_id, mode bertahap). Menumpangkan
--   impor analisa ke sana akan memaksa kolom yang tidak relevan dan mengaburkan arti `tipe`.
CREATE TABLE IF NOT EXISTS sinkron_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id INTEGER NOT NULL,
  /** order | laba | performa | iklan */
  jenis TEXT NOT NULL,
  file TEXT NOT NULL DEFAULT '',
  baris INTEGER NOT NULL DEFAULT 0,
  gagal INTEGER NOT NULL DEFAULT 0,
  /** Catatan bebas hasil impor (mis. rentang tanggal yang terbentuk). */
  ringkas TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  oleh TEXT
);

-- Halaman Sinkronisasi selalu menanyakan "impor terakhir per jenis untuk toko ini".
CREATE INDEX IF NOT EXISTS idx_sinkron_preset_jenis_at ON sinkron_log (preset_id, jenis, at DESC);

PRAGMA optimize;
