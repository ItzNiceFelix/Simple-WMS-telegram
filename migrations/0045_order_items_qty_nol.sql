-- 0045_order_items_qty_nol.sql — izinkan qty 0 untuk baris yang diretur penuh.
--
-- KENAPA PERLU:
--   `order_items.qty` dikunci `CHECK (qty >= 1)` sejak 0006 (dan dipertahankan di 0019).
--   Impor Shopee menghitung qty bersih = Jumlah − Returned quantity. Baris yang diretur
--   PENUH menghasilkan 0 — dan dengan CHECK lama, D1 menolak baris itu. Akibatnya baris
--   hilang dari order (padahal ada di berkas), atau impor gagal sebagian.
--
-- KENAPA 0 DISIMPAN, BUKAN BARISNYA DIBUANG:
--   Biaya per order dialokasikan proporsional ke seluruh baris. Membuang baris retur
--   membuat alokasi biaya bocor ke baris lain, sehingga laba per SKU bergeser padahal
--   omzet ordernya benar. Baris qty 0 tetap bukti "produk ini ada di pesanan, tapi
--   dikembalikan", dan itu informasi yang berguna saat menelusuri selisih.
--
-- KENAPA REBUILD: SQLite tidak bisa mengubah CHECK lewat ALTER TABLE.

PRAGMA foreign_keys = OFF;

ALTER TABLE order_items RENAME TO order_items_lama;

CREATE TABLE order_items (
  marketplace TEXT NOT NULL,
  no_pesanan TEXT NOT NULL,
  sku TEXT NOT NULL REFERENCES products(sku),
  variasi TEXT DEFAULT '',
  nama_shopee TEXT DEFAULT '',
  -- 0 sah: seluruh qty baris ini dikembalikan pembeli.
  qty INTEGER NOT NULL CHECK (qty >= 0),
  harga_satuan INTEGER NOT NULL CHECK (harga_satuan >= 0),
  hpp_snapshot INTEGER DEFAULT 0,
  subtotal INTEGER DEFAULT 0,
  PRIMARY KEY (marketplace, no_pesanan, sku, variasi),
  FOREIGN KEY (marketplace, no_pesanan) REFERENCES orders(marketplace, no_pesanan) ON DELETE CASCADE
);

INSERT INTO order_items (marketplace, no_pesanan, sku, variasi, nama_shopee, qty, harga_satuan, hpp_snapshot, subtotal)
  SELECT marketplace, no_pesanan, sku, variasi, nama_shopee, qty, harga_satuan, hpp_snapshot, subtotal
  FROM order_items_lama;

DROP TABLE order_items_lama;

CREATE INDEX IF NOT EXISTS idx_items_sku ON order_items(sku);

PRAGMA foreign_keys = ON;
PRAGMA optimize;
