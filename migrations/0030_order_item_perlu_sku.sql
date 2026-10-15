-- 0030_order_item_perlu_sku.sql — Baris order yang SKU-nya belum/tidak ada di master.
--
-- MASALAH: `order_items.sku` punya FK ke `products(sku)`. Akibatnya baris yang SKU-nya
-- tidak ada di master MUSTAHIL disimpan. Selama ini "solusinya" adalah membuang barisnya
-- (atau seluruh ordernya) saat impor, sehingga:
--   1. Picklist memakai INNER JOIN ke products → barang yang dibuang tidak pernah tercetak,
--      dan tidak ada pesan apa pun. Checker menerima lembar yang tidak lengkap.
--   2. Order tampil normal di /order dengan 0 item, tanpa penanda.
--   3. User tidak punya tempat untuk memperbaiki — datanya memang sudah tidak tersimpan.
--
-- SOLUSI: baris bermasalah TETAP disimpan, tapi ditandai. `sku` diisi penanda yang diawali
-- "+" sehingga TIDAK BENTROK dengan SKU asli (SKU riil tidak pernah diawali "+").
--
-- KOREKSI PENTING (dulu komentar di sini SALAH): awalan "+" mencegah BENTROK, tetapi TIDAK
-- memenuhi FK `order_items.sku → products(sku)`. FK tetap menuntut barisnya ADA di `products`.
-- Tidak pernah ada kode yang menyisipkan penanda ke `products`, jadi setiap kali fitur ini
-- dipakai, `db.batch()` melanggar FK dan SELURUH konfirmasi gagal 500. Produksi membuktikan
-- itu: `SELECT COUNT(*) FROM products WHERE sku LIKE '+%'` = 0 dan
-- `SELECT COUNT(*) FROM order_items WHERE perlu_sku=1` = 0 — fitur ini tidak pernah sekali pun
-- berhasil menyimpan baris.
--
-- Cara baris bertanda disimpan sekarang ada di `app/api/order/route.ts`: tiap penanda juga
-- DISISIPKAN ke `products` (INSERT OR IGNORE, nama diawali "[PERLU SKU]"/"[BELUM DI MP]")
-- sehingga FK terpenuhi. Lihat kode terbaru, bukan berkas migrasi ini, untuk perilaku terkini.
--
--   - Baris ikut tercetak di picklist dengan kolom pembeda, jadi checker tahu.
--   - Bisa diperbaiki nanti: SKU penanda diganti SKU sebenarnya, atau dihapus.
--
-- Tidak mengubah `order_items.sku` menjadi NOT NULL REFERENCES products(sku) karena FK itu
-- yang selama ini membuat baris raib tanpa jejak. Penandaan lebih jujur daripada pembuangan.

-- `sku_asal`: SKU yang tertulis di file marketplace, apa adanya. Kosong bila file memang
-- tidak menuliskan SKU. Dipakai UI untuk menampilkan "file bilang X, master tidak punya".
ALTER TABLE order_items ADD COLUMN sku_asal TEXT DEFAULT '';

-- `perlu_sku`: 1 bila baris ini belum punya SKU sah. Sengaja kolom sendiri, bukan disimpulkan
-- dari awalan "+", supaya perubahan format penanda tidak mengubah arti data lama.
ALTER TABLE order_items ADD COLUMN perlu_sku INTEGER NOT NULL DEFAULT 0 CHECK (perlu_sku IN (0,1));

-- Wadah "belum ada SKU di MP" juga perlu menyimpan dari jalur mana dan SKU asalnya,
-- supaya daftar tunggu bisa ditampilkan dan dibersihkan (sebelumnya write-only).
ALTER TABLE sku_belum_mp ADD COLUMN sumber TEXT DEFAULT 'order';
ALTER TABLE sku_belum_mp ADD COLUMN sku_asal TEXT DEFAULT '';
ALTER TABLE sku_belum_mp ADD COLUMN qty_total INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_items_perlu_sku ON order_items(perlu_sku) WHERE perlu_sku = 1;
