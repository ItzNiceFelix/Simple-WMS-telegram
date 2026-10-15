-- 0032_picklist_ekspor.sql — Catat picklist yang PERNAH dicetak, satu baris per (pesanan, mode).
--
-- KENAPA PER MODE, bukan satu baris per pesanan:
--   Pesanan yang sama bisa dicetak dengan cara berbeda — per paket (satu lembar per resi),
--   pisah (agregat per SKU), gabung, gabung-order. Picker perlu tahu mode MANA yang sudah
--   dijalankan, bukan sekadar "pesanan ini pernah dicetak": kalau ditandai satu kolom saja,
--   mencetak mode lain akan tampak seperti cetak ulang padahal itu pekerjaan yang berbeda
--   (dan sebaliknya: mengira sudah per-paket padahal baru pernah dicetak agregat).
--   Karena itu kunci utamanya (marketplace, no_pesanan, mode): satu pesanan sah punya
--   sampai 4 baris.
--
-- KENAPA `jumlah_cetak` dicatat, bukan hanya `at`:
--   Angka > 1 membedakan cetakan pertama dari cetak ulang. Itu yang dipakai saat ada
--   sengketa "sudah saya cetak kok" — kita bisa menunjukkan kapan dan berapa kali, bukan
--   sekadar "pernah". Menyimpan hanya stempel waktu terakhir akan menghapus jejak cetakan
--   pertama, tepat ketika jejak itu paling dibutuhkan.
--
-- Tag ditulis OTOMATIS dari server saat PDF benar-benar terbentuk (lihat blok picklist-pdf
-- di app/api/order/route.ts). Cetak yang gagal (400/409) TIDAK menandai apa pun: tag berarti
-- "sudah dicetak", bukan "sempat dicoba".
--
-- CHECK mode dipagari di skema, bukan hanya di TypeScript, supaya baris salah tidak bisa
-- masuk lewat jalur lain (skrip, impor manual) — daftarnya harus sama dengan MODE_PICKLIST
-- di app/api/order/route.ts.
CREATE TABLE IF NOT EXISTS picklist_ekspor (
  marketplace  TEXT NOT NULL,
  no_pesanan   TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('per_paket','pisah','gabung','gabung-order')),
  at           INTEGER NOT NULL DEFAULT (unixepoch()),  -- unixepoch detik; diperbarui tiap cetak ulang
  oleh         TEXT,                                    -- id user pencetak terakhir; NULL = jalur tanpa user
  jumlah_cetak INTEGER NOT NULL DEFAULT 1,              -- >1 = cetak ulang; bukti saat sengketa
  PRIMARY KEY (marketplace, no_pesanan, mode)
);

-- Baca banyak pesanan sekaligus (halaman order menandai ratusan baris sekali muat).
-- Mode tidak ikut di index karena justru seluruh mode per pesanan yang dibaca.
CREATE INDEX IF NOT EXISTS idx_picklist_ekspor_order ON picklist_ekspor (marketplace, no_pesanan);
