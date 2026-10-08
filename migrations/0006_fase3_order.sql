-- 0006_fase3_order.sql — Store pesanan MP + fee + preset (Fase 3a).
CREATE TABLE IF NOT EXISTS orders (
  marketplace TEXT NOT NULL,
  no_pesanan TEXT NOT NULL,
  tanggal INTEGER NOT NULL,
  buyer TEXT NOT NULL DEFAULT '',
  status_fulfill TEXT NOT NULL DEFAULT 'pending'
    CHECK (status_fulfill IN ('pending','pack','kirim','selesai','batal')),
  pajak_pph INTEGER NOT NULL DEFAULT 1 CHECK (pajak_pph IN (0,1)),
  pajak_ppn_persen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (marketplace, no_pesanan)
);
CREATE INDEX IF NOT EXISTS idx_orders_tgl ON orders(tanggal);
CREATE INDEX IF NOT EXISTS idx_orders_mp ON orders(marketplace, tanggal);

CREATE TABLE IF NOT EXISTS order_items (
  marketplace TEXT NOT NULL,
  no_pesanan TEXT NOT NULL,
  sku TEXT NOT NULL REFERENCES products(sku),
  qty INTEGER NOT NULL CHECK (qty >= 1),
  harga_satuan INTEGER NOT NULL CHECK (harga_satuan >= 0),
  hpp_snapshot INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (marketplace, no_pesanan, sku),
  FOREIGN KEY (marketplace, no_pesanan) REFERENCES orders(marketplace, no_pesanan) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_items_sku ON order_items(sku);

CREATE TABLE IF NOT EXISTS order_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace TEXT NOT NULL,
  no_pesanan TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('admin','service','komisi','ongkir','voucher','affiliate','iklan','lain')),
  basis TEXT NOT NULL CHECK (basis IN ('flat','persen')),
  nilai INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (marketplace, no_pesanan) REFERENCES orders(marketplace, no_pesanan) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mp_fee_presets (
  marketplace TEXT NOT NULL,
  jenis TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('flat','persen')),
  nilai INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (marketplace, jenis)
);
-- Seed generik CONTOH (owner sesuaikan di Pengaturan):
INSERT OR IGNORE INTO mp_fee_presets (marketplace, jenis, basis, nilai) VALUES
  ('shopee','admin','persen',4), ('shopee','service','persen',3),
  ('tokopedia','service','persen',6), ('tiktok','komisi','persen',5),
  ('lazada','komisi','persen',4);

-- stock_moves.jenis += jual_mp/retur_mp (SQLite: recreate, data ikut pindah):
PRAGMA foreign_keys=off;
ALTER TABLE stock_moves RENAME TO stock_moves_lama;
CREATE TABLE stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_client_id TEXT UNIQUE,
  sku TEXT NOT NULL REFERENCES products(sku),
  nama_terbaca TEXT,
  variasi TEXT,
  qty INTEGER,
  jenis TEXT NOT NULL CHECK (jenis IN ('keluar_resi','opname','restock','koreksi_manual','sync_confirmed','OPENING','TRANSFER_IN','TRANSFER_OUT','jual_mp','retur_mp')),
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
