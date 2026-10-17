-- 0041_performa_periode.sql — Rapikan periode legacy + kunci lookup performa produk per periode.
--
-- KENAPA PERLU:
--   performa_produk menyimpan kunjungan/keranjang/konversi per (preset_id, periode, sku) —
--   lihat PK-nya di 0027. Impor lama bisa menulis periode kosong (''), yang membuat baris itu
--   tidak bisa dicari per periode mana pun dan bertabrakan dengan '' lain bila SKU-nya sama.
--   Satu D1 dipakai beberapa toko, jadi preset_id wajib ikut di setiap kunci lookup.
--
-- KENAPA '' → 'legacy' dan bukan dihapus:
--   '' tidak berarti "tidak ada periode"; itu jejak impor yang tidak mencatat periode, tapi
--   angkanya tetap berasal dari laporan nyata. Menghapusnya membuang data yang tak bisa dibuat
--   ulang tanpa berkas sumber. Label 'legacy' menyimpan datanya sambil membebaskan '' untuk
--   pemakaian yang benar. Idempoten: baris yang sudah 'legacy' tidak cocok dengan `periode = ''`.
UPDATE performa_produk SET periode = 'legacy' WHERE periode = '';

-- Index unik ini mencerminkan PK lama (preset_id, periode, sku). PK tabel SQLite sudah unik, jadi
-- index ini tidak menambah kendala baru; gunanya memastikan jalur lookup (preset, periode, sku)
-- tetap punya index yang jelas namanya meski tabel dibangun ulang kelak (PK baru tidak otomatis
-- mewarisi bentuk itu), dan menegakkannya bila ada duplikat sisa data lama.
CREATE UNIQUE INDEX IF NOT EXISTS idx_performa_preset_periode_sku ON performa_produk (preset_id, periode, sku);

-- Daftar performa terbaru satu toko: WHERE preset_id = ? ORDER BY at DESC.
CREATE INDEX IF NOT EXISTS idx_performa_preset ON performa_produk (preset_id, at DESC);

PRAGMA optimize;
