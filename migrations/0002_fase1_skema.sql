-- 0002_fase1_skema.sql — Simple-WMS-telegram Fase 1 (paritas).
-- Pemetaan Firestore → D1 (lihat analisis mapping Fase 1):
--   stock → products (kolom stok) + stock_by_bin + stock_moves(OPENING)
--   products → products + product_variants + product_search_keywords + mp_products
--   stock_movements → stock_moves (immutable; id_movement → ref_client_id UNIQUE)
--   gudang → warehouses (id TEXT: 'ONLINE' + auto-ID; Fase 0 INTEGER di-rebuild)
--   permintaan_gudang → transfers + transfer_destinations + transfer_items + transfer_status_log
--   opname_gudang → stock_counts + count_lines + count_status_log (+freeze siap Fase 2)
--   daily_requests → daily_requests + daily_request_items + daily_request_changes
--   admins → users (+kolom audit) + user_warehouses (tg_id INTEGER)
--   access_requests → access_requests | sessions(bot) → bot_sessions
--   keyword_notes, product_changes, admin_role_changes → tabel sendiri
--   guards (draft_kirim_guard, form/guard v5) → tabel guards generik
-- Konvensi: TEXT bukan VARCHAR, INTEGER unixepoch detik, prepared di kode,
-- INDEX untuk kolom filter/JOIN, PRAGMA optimize di akhir.

-- ── warehouses: rebuild INTEGER → TEXT (Fase 0 masih kosong di prod) ──
CREATE TABLE IF NOT EXISTS warehouses_new (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0,1)),
  urutan INTEGER NOT NULL DEFAULT 0,
  is_online INTEGER NOT NULL DEFAULT 0 CHECK (is_online IN (0,1)),
  created_at INTEGER,
  created_by TEXT,
  updated_at INTEGER,
  updated_by TEXT,
  nonaktif_at INTEGER,
  nonaktif_by TEXT
);
INSERT INTO warehouses_new (id, code, nama, aktif, urutan, is_online)
  SELECT CAST(id AS TEXT), code, nama, aktif, urutan, is_online FROM warehouses;
DROP TABLE warehouses;
ALTER TABLE warehouses_new RENAME TO warehouses;
INSERT INTO warehouses (id, code, nama, aktif, urutan, is_online)
  SELECT 'ONLINE','ONLINE','Gudang Online',1,0,1
  WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE id='ONLINE' OR code='ONLINE');

-- ── users: kolom audit admins (Fase 1 paritas) ──
ALTER TABLE users ADD COLUMN jabatan TEXT;
ALTER TABLE users ADD COLUMN added_at INTEGER;
ALTER TABLE users ADD COLUMN approved_by TEXT;
ALTER TABLE users ADD COLUMN role_updated_at INTEGER;
ALTER TABLE users ADD COLUMN role_updated_by TEXT;
ALTER TABLE users ADD COLUMN gudang_updated_at INTEGER;
ALTER TABLE users ADD COLUMN gudang_updated_by TEXT;
ALTER TABLE users ADD COLUMN jabatan_updated_at INTEGER;
ALTER TABLE users ADD COLUMN jabatan_updated_by TEXT;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ── products + varian + keywords + marketplace ──
CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  nama_accurate TEXT NOT NULL,
  nama_accurate_normalized TEXT NOT NULL DEFAULT '',
  hpp INTEGER,
  hpp_baru INTEGER,
  is_online_product INTEGER NOT NULL DEFAULT 0 CHECK (is_online_product IN (0,1)),
  online_updated_by TEXT,
  updated_at INTEGER,
  stok_min INTEGER,
  last_stock_updated INTEGER,
  last_stock_updated_by TEXT,
  last_synced_at INTEGER,
  last_synced_value INTEGER
);
CREATE INDEX IF NOT EXISTS idx_products_online ON products(is_online_product);
CREATE INDEX IF NOT EXISTS idx_products_norm ON products(nama_accurate_normalized);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  variasi TEXT NOT NULL,
  UNIQUE(sku, variasi)
);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);

CREATE TABLE IF NOT EXISTS product_search_keywords (
  sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  PRIMARY KEY (sku, keyword)
);

CREATE TABLE IF NOT EXISTS mp_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  marketplace TEXT NOT NULL DEFAULT 'shopee',
  nama_mp TEXT,
  harga_jual_mp INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mp_sku ON mp_products(sku, marketplace);

-- ── stok per gudang + ledger immutable ──
CREATE TABLE IF NOT EXISTS stock_by_bin (
  sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sku, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_sbb_sku ON stock_by_bin(sku);
CREATE INDEX IF NOT EXISTS idx_sbb_wh ON stock_by_bin(warehouse_id);

CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_client_id TEXT UNIQUE,
  sku TEXT NOT NULL REFERENCES products(sku),
  nama_terbaca TEXT,
  variasi TEXT,
  qty INTEGER,
  jenis TEXT NOT NULL CHECK (jenis IN ('keluar_resi','opname','restock','koreksi_manual','sync_confirmed','OPENING','TRANSFER_IN','TRANSFER_OUT')),
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
CREATE INDEX IF NOT EXISTS idx_moves_sku ON stock_moves(sku, at DESC);
CREATE INDEX IF NOT EXISTS idx_moves_pending ON stock_moves(status) WHERE status != 'processed';
CREATE INDEX IF NOT EXISTS idx_moves_gudang ON stock_moves(gudang_id, at DESC);

-- ── transfer antar-gudang (ganti permintaan_gudang) ──
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  dari_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu','disetujui','ditolak','dibatalkan','dikirim','selesai')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT,
  catatan TEXT
);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);

CREATE TABLE IF NOT EXISTS transfer_destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  idx_tujuan INTEGER NOT NULL,
  tipe TEXT NOT NULL DEFAULT 'gudang',
  dest_warehouse_id TEXT REFERENCES warehouses(id),
  nama_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu','diterima','tidak_terima','ditolak','ditutup')),
  status_kirim TEXT NOT NULL DEFAULT 'menunggu' CHECK (status_kirim IN ('menunggu','disetujui','dikirim')),
  user_penerima_id TEXT,
  user_penerima_nama TEXT,
  notifikasi_terkirim INTEGER CHECK (notifikasi_terkirim IN (0,1)),
  disetujui_at INTEGER, disetujui_oleh TEXT,
  dikirim_at INTEGER, dikirim_oleh TEXT,
  ditolak_at INTEGER, ditolak_oleh TEXT,
  diterima_at INTEGER, diterima_oleh TEXT,
  tidak_terima_at INTEGER, tidak_terima_oleh TEXT,
  ditutup_at INTEGER, ditutup_oleh TEXT,
  catatan_alasan TEXT,
  UNIQUE(transfer_id, idx_tujuan)
);
CREATE INDEX IF NOT EXISTS idx_dest_wh ON transfer_destinations(dest_warehouse_id, status_kirim);
CREATE INDEX IF NOT EXISTS idx_dest_transfer ON transfer_destinations(transfer_id);

CREATE TABLE IF NOT EXISTS transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  destination_id INTEGER NOT NULL REFERENCES transfer_destinations(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES products(sku),
  nama TEXT,
  variasi TEXT,
  qty INTEGER NOT NULL CHECK (qty >= 1)
);
CREATE INDEX IF NOT EXISTS idx_titem_dest ON transfer_items(destination_id);

CREATE TABLE IF NOT EXISTS transfer_status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  oleh TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tlog_transfer ON transfer_status_log(transfer_id);

-- ── opname (ganti opname_gudang; freeze siap Fase 2) ──
CREATE TABLE IF NOT EXISTS stock_counts (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'menunggu_approval' CHECK (status IN ('menunggu_approval','disetujui','ditolak')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT,
  catatan TEXT,
  disetujui_oleh TEXT,
  disetujui_at INTEGER,
  ditolak_oleh TEXT,
  ditolak_at INTEGER,
  freeze INTEGER NOT NULL DEFAULT 0 CHECK (freeze IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_counts_status ON stock_counts(status, warehouse_id);

CREATE TABLE IF NOT EXISTS count_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES products(sku),
  qty_sistem INTEGER,
  qty_fisik INTEGER NOT NULL,
  selisih INTEGER NOT NULL,
  belum_terdaftar INTEGER NOT NULL DEFAULT 0 CHECK (belum_terdaftar IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_clines_count ON count_lines(count_id);

CREATE TABLE IF NOT EXISTS count_status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  oleh TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── permintaan harian (ganti daily_requests) ──
CREATE TABLE IF NOT EXISTS daily_requests (
  tanggal TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diproses','selesai')),
  created_at INTEGER,
  form_dibuat_at INTEGER,
  form_dibuat_by TEXT,
  selesai_at INTEGER,
  selesai_by TEXT,
  updated_at INTEGER,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS daily_request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal TEXT NOT NULL REFERENCES daily_requests(tanggal) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES products(sku),
  nama TEXT,
  variasi TEXT NOT NULL DEFAULT '-',
  qty INTEGER NOT NULL,
  buffer INTEGER NOT NULL DEFAULT 0 CHECK (buffer IN (0,1)),
  status TEXT NOT NULL DEFAULT 'diminta' CHECK (status IN ('diminta','datang')),
  qty_diminta INTEGER,
  qty_datang INTEGER,
  datang_at INTEGER,
  datang_by TEXT,
  UNIQUE(tanggal, sku, variasi, buffer, status)
);
CREATE INDEX IF NOT EXISTS idx_dritem_tanggal ON daily_request_items(tanggal);

CREATE TABLE IF NOT EXISTS daily_request_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal TEXT NOT NULL REFERENCES daily_requests(tanggal) ON DELETE CASCADE,
  key_item TEXT NOT NULL,
  qty_lama INTEGER,
  qty_baru INTEGER,
  oleh TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_drch_tanggal ON daily_request_changes(tanggal, id DESC);

-- ── akses + sesi bot + kamus + audit ──
CREATE TABLE IF NOT EXISTS access_requests (
  tg_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
  requested_at INTEGER,
  telegram_username TEXT,
  telegram_display_name TEXT,
  rejected_until INTEGER,
  resolved_by TEXT,
  resolved_at INTEGER,
  revoked_by TEXT,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_access_status ON access_requests(status);

CREATE TABLE IF NOT EXISTS bot_sessions (
  tg_id INTEGER PRIMARY KEY,
  history_json TEXT NOT NULL DEFAULT '[]',
  last_updated INTEGER,
  pending_action_json TEXT,
  pending_batch_action_json TEXT,
  pending_opname_json TEXT,
  pending_picking_list_json TEXT,
  pending_sync_stok_json TEXT,
  pending_konfirmasi_cakupan_json TEXT
);

CREATE TABLE IF NOT EXISTS keyword_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_text TEXT NOT NULL UNIQUE COLLATE NOCASE,
  interpreted_as TEXT NOT NULL CHECK (interpreted_as IN ('STOK','MINTA','MINTA_SISA')),
  confidence TEXT NOT NULL DEFAULT 'guessed' CHECK (confidence IN ('guessed','confirmed')),
  usage_count INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER,
  last_used INTEGER,
  confirmed_by TEXT,
  confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_keyword_last_used ON keyword_notes(last_used DESC);

CREATE TABLE IF NOT EXISTS product_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL REFERENCES products(sku),
  field TEXT NOT NULL,
  lama TEXT,
  baru TEXT,
  oleh TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_pch_sku ON product_changes(sku, at DESC);

CREATE TABLE IF NOT EXISTS admin_role_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  role_lama TEXT,
  role_baru TEXT,
  catatan TEXT,
  oleh TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_arch_tg ON admin_role_changes(tg_id, at DESC);

-- ── guard idempotensi generik (draft_kirim_guard, form/guard v5) ──
CREATE TABLE IF NOT EXISTS guards (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  payload_json TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (scope, key)
);

PRAGMA optimize;
