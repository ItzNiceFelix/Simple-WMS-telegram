-- 0019_order_advance.sql — Pasokan ke Gudang Shopee (advance booking) + anti dobel impor
-- + tag baris tanpa SKU + resi gabungan (Pesanan Gabungan Shopee).
-- Konvensi: IF NOT EXISTS, TEXT tanggal WIB YYYY-MM-DD, INTEGER rupiah, unixepoch waktu.

-- ── advance_bookings: 1 baris = 1 Booking SN (qty 1) ──
CREATE TABLE IF NOT EXISTS advance_bookings (
  booking_sn TEXT PRIMARY KEY,
  no_resi TEXT DEFAULT '',
  sku TEXT NOT NULL REFERENCES products(sku),
  variasi TEXT DEFAULT '',
  nama_produk TEXT DEFAULT '',
  opsi_kirim TEXT DEFAULT '',
  antar_ke TEXT DEFAULT '',
  booking_at TEXT,
  batas_kirim TEXT,
  qty INTEGER DEFAULT 1,
  status TEXT DEFAULT 'menunggu'
    CHECK (status IN ('menunggu','terkirim','batal','timeout')),
  batch_import INTEGER,
  dikirim_at INTEGER,
  dikirim_oleh TEXT,
  at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_advance_status ON advance_bookings(status);
CREATE INDEX IF NOT EXISTS idx_advance_batch ON advance_bookings(batch_import);
CREATE INDEX IF NOT EXISTS idx_advance_resi ON advance_bookings(no_resi);

-- ── import_files: fingerprint file impor (anti dobel) ──
CREATE TABLE IF NOT EXISTS import_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipe TEXT NOT NULL,
  file TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  no_json TEXT DEFAULT '[]',
  batch_id INTEGER,
  at INTEGER DEFAULT (unixepoch()),
  by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_files_hash ON import_files(tipe, file_hash);

-- ── sku_belum_mp: tag baris order yang belum dipetakan ke SKU ──
CREATE TABLE IF NOT EXISTS sku_belum_mp (
  nama_shopee TEXT NOT NULL,
  variasi TEXT DEFAULT '',
  order_ref TEXT NOT NULL,
  sejak TEXT NOT NULL,
  at INTEGER DEFAULT (unixepoch()),
  by TEXT,
  PRIMARY KEY (nama_shopee, variasi)
);

-- ── resi_grup: satu no resi bisa memuat beberapa No. Pesanan (Pesanan Gabungan) ──
CREATE TABLE IF NOT EXISTS resi_grup (
  no_resi TEXT PRIMARY KEY,
  no_json TEXT NOT NULL DEFAULT '[]',
  jumlah_order INTEGER NOT NULL DEFAULT 1 CHECK (jumlah_order >= 1),
  tipe_pesanan TEXT NOT NULL DEFAULT 'tunggal'
    CHECK (tipe_pesanan IN ('tunggal','gabungan')),
  jasa_kirim TEXT NOT NULL DEFAULT '',
  tipe_layanan TEXT NOT NULL DEFAULT '',
  cod INTEGER NOT NULL DEFAULT 0,
  preorder INTEGER NOT NULL DEFAULT 0,
  sesuai_kriteria INTEGER NOT NULL DEFAULT 1,
  at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_resi_grup_jumlah ON resi_grup(jumlah_order);
CREATE INDEX IF NOT EXISTS idx_resigrup_tipe ON resi_grup(tipe_pesanan);

-- ── orders: kolom impor/pasokan Shopee (SQLite: ADD COLUMN satu per pernyataan) ──
ALTER TABLE orders ADD COLUMN asal_import TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN booking_sn TEXT;
ALTER TABLE orders ADD COLUMN opsi_kirim TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN antar_ke TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN status_mp TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN item_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE orders ADD COLUMN batch_import INTEGER;
ALTER TABLE orders ADD COLUMN jasa_kirim TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN tipe_layanan TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN cod INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN preorder INTEGER NOT NULL DEFAULT 0;

-- ── order_items: PK += variasi (satu No bisa memuat SKU sama variasi beda) ──
PRAGMA foreign_keys=off;
ALTER TABLE order_items RENAME TO order_items_lama;
CREATE TABLE order_items (
  marketplace TEXT NOT NULL,
  no_pesanan TEXT NOT NULL,
  sku TEXT NOT NULL REFERENCES products(sku),
  variasi TEXT DEFAULT '',
  nama_shopee TEXT DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty >= 1),
  harga_satuan INTEGER NOT NULL CHECK (harga_satuan >= 0),
  hpp_snapshot INTEGER DEFAULT 0,
  subtotal INTEGER DEFAULT 0,
  PRIMARY KEY (marketplace, no_pesanan, sku, variasi),
  FOREIGN KEY (marketplace, no_pesanan) REFERENCES orders(marketplace, no_pesanan) ON DELETE CASCADE
);
INSERT INTO order_items (marketplace, no_pesanan, sku, variasi, nama_shopee, qty, harga_satuan, hpp_snapshot, subtotal)
  SELECT marketplace, no_pesanan, sku, '', '', qty, harga_satuan, hpp_snapshot, subtotal FROM order_items_lama;
DROP TABLE order_items_lama;
CREATE INDEX IF NOT EXISTS idx_items_sku ON order_items(sku);
PRAGMA foreign_keys=on;

-- ── stock_moves.jenis += kirim_advance (SQLite: recreate, data ikut pindah) ──
PRAGMA foreign_keys=off;
ALTER TABLE stock_moves RENAME TO stock_moves_lama;
CREATE TABLE stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_client_id TEXT UNIQUE,
  sku TEXT NOT NULL REFERENCES products(sku),
  nama_terbaca TEXT,
  variasi TEXT,
  qty INTEGER,
  jenis TEXT NOT NULL CHECK (jenis IN ('keluar_resi','opname','restock','koreksi_manual','sync_confirmed','OPENING','TRANSFER_IN','TRANSFER_OUT','jual_mp','retur_mp','kirim_advance')),
  gudang_id TEXT REFERENCES warehouses(id),
  action_type TEXT,
  qty_sistem INTEGER,
  qty_fisik INTEGER,
  selisih INTEGER,
  penanda TEXT,
  catatan TEXT,
  source TEXT CHECK (source IN ('screenshot','manual_chat','manual_chat_batch','manual_chat_produk_baru','manual_chat_batch_produk_baru','sync','web_dashboard')),
  status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed','pending_request','pending_confirmation')),
  created_by TEXT,
  created_by_username TEXT,
  created_by_name TEXT,
  requested_by TEXT,
  requested_by_username TEXT,
  requested_by_name TEXT,
  confirmed_by TEXT,
  resolved_by TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  by TEXT,
  bin_id INTEGER,
  hpp_snapshot INTEGER
);
INSERT INTO stock_moves SELECT * FROM stock_moves_lama;
DROP TABLE stock_moves_lama;
CREATE INDEX IF NOT EXISTS idx_moves_sku ON stock_moves(sku, at DESC);
CREATE INDEX IF NOT EXISTS idx_moves_pending ON stock_moves(status) WHERE status != 'processed';
CREATE INDEX IF NOT EXISTS idx_moves_gudang ON stock_moves(gudang_id, at DESC);
PRAGMA foreign_keys=on;

PRAGMA optimize;
