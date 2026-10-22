-- 0046_snapshot_biaya_jenis.sql — Rincian biaya per jenis di snapshot laba.
--
-- KENAPA: `laba_snapshot.biaya` hanya satu angka. Halaman Analisa karena itu hanya bisa
-- memisahkan HPP / biaya operasional / pajak — admin, program, dan proses menyatu, sehingga
-- pertanyaan "biaya apa yang naik bulan ini" tidak bisa dijawab tanpa menghitung ulang.
--
-- Bentuk JSON: objek `{ "<label>": <rupiah bulat> }` dengan label stabil:
--   "admin"                 — biaya administrasi (per baris, dari tier)
--   "program:<kode>"        — biaya program (GO XTRA, Promo XTRA+, dst.)
--   "proses"                — biaya proses pesanan (per order)
--   "pajak_pph"/"pajak_ppn" — pajak (juga tetap dicatat di kolom `pajak`)
--   "<jenis>"               — jenis lain apa adanya (lain, layanan, voucher, …)
--
-- Kosong (`{}`) untuk snapshot lama: pembaca WAJIB fallback ke pengelompokan 3 bagian.
-- Menebak pecahan biaya lebih buruk daripada mengaku belum tahu.
ALTER TABLE laba_snapshot ADD COLUMN biaya_jenis_json TEXT NOT NULL DEFAULT '{}';
PRAGMA optimize;
