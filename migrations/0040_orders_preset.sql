-- 0040_orders_preset.sql — Orders milik toko mana: kolom preset_id + index untuk daftar per toko.
--
-- KENAPA PERLU:
--   Satu D1 dipakai BEBERAPA toko (seller_presets). Fee, pajak, dan laba berbeda per akun —
--   lihat fee_rules/laba_snapshot yang sudah membawa preset_id sejak 0013. `orders` belum:
--   tanpa penanda toko, order dari dua akun yang kebetulan punya no_pesanan sama tidak bisa
--   dibedakan sumbernya, dan daftar order satu toko tidak bisa dipisahkan dari toko lain.
--
-- KENAPA NULLABLE (tanpa NOT NULL):
--   Baris lama diimpor sebelum kolom ini ada. SQLite tidak bisa menambah kolom NOT NULL tanpa
--   DEFAULT, dan mengisi DEFAULT toko tertentu akan MENEBak pemilik data historis yang tidak
--   pernah dicatat. NULL = "belum diketahui", bukan "tanpa toko"; pengisian ulang dilakukan
--   lewat impor ulang atau pemetaan manual, bukan lewat migrasi ini.
--
-- Index (preset_id, tanggal DESC): daftar order per toko selalu disaring preset_id lalu
-- diurutkan tanggal menurun (lihat FilterOrder.presetId + urutOrder di lib/d1/order.ts).
-- Tiebreaker (marketplace, no_pesanan) tidak ikut: filter tanggal + preset sudah menyisir
-- himpunan kecil, sisanya dijawab temp B-tree.
ALTER TABLE orders ADD COLUMN preset_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_orders_preset_tgl ON orders (preset_id, tanggal DESC);

PRAGMA optimize;
