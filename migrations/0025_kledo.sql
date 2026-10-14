-- 0025_kledo.sql — Integrasi Kledo (TARIK SATU ARAH: Kledo → D1).
--
-- BATAS MUTLAK: sistem ini HANYA MEMBACA dari Kledo. Tidak ada POST/PUT/DELETE ke Kledo,
-- dalam keadaan apa pun. Tabel di bawah semuanya milik D1.
--
-- Pemetaan yang WAJIB dipahami (hasil penyelidikan live 2026-10-14, bukan asumsi):
--   * products.sku      = Product.code Kledo   (482/482 cocok; bukan Product.id)
--   * products.hpp      = Product.avg_base_price (BUKAN field `hpp`; 61 nilai desimal -> Math.round)
--   * warehouses        TIDAK boleh dipetakan lewat id. `warehouses.id` D1 ('GMV0LJYS5')
--                       BUKAN id Kledo (2/3/4). Pemetaan lewat NAMA, `code` sebagai cadangan.
--   * gudang virtual 'ONLINE' milik WMS -> TIDAK PERNAH dipetakan/disentuh.
--
-- TIDAK ada perubahan pada stock_moves: tabel itu sudah punya
--   jenis='sync_confirmed', source='sync', serta kolom qty_sistem/qty_fisik/selisih/penanda/catatan.
-- Rebuild tabel ledger 1008 baris dibatalkan — risikonya tidak sebanding manfaatnya.

-- ── Kredensial Kledo (pola sama ai_kredensial: AES-GCM, kunci dari secret AI_KEY_ENCRYPTION_KEY). ──
CREATE TABLE IF NOT EXISTS kledo_kredensial (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subdomain   TEXT NOT NULL,                 -- {subdomain}.api.kledo.com, mis. cv-hanaa-jaya
  label       TEXT NOT NULL DEFAULT '',      -- nama bebas, mis. "Kledo produksi"
  ciphertext  TEXT NOT NULL,                 -- base64
  iv          TEXT NOT NULL,                 -- base64, 12 byte
  tag         TEXT NOT NULL,                 -- base64, 16 byte
  ujung       TEXT NOT NULL DEFAULT '',      -- 4 karakter terakhir plaintext untuk mask
  aktif       INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0,1)),
  dibuat_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  dibuat_oleh TEXT,
  uji_at      INTEGER,                       -- terakhir diuji
  uji_ok      INTEGER CHECK (uji_ok IN (0,1)), -- hasil uji terakhir
  uji_pesan   TEXT,                          -- pesan hasil uji (mis. "3 gudang" atau alasan gagal)
  UNIQUE(subdomain)
);

-- ── Pemetaan ID Kledo -> kunci lokal D1. Sumber tunggal kebenaran pemetaan. ──
-- PK (jenis, kledo_id): dua id Kledo dengan satu code akan menghasilkan DUA baris peta yang
-- menunjuk lokal_id sama -> terdeteksi sebagai bentrok (dilaporkan, tidak ditimpa otomatis).
CREATE TABLE IF NOT EXISTS kledo_map (
  jenis           TEXT NOT NULL CHECK (jenis IN ('produk','gudang')),
  kledo_id        TEXT NOT NULL,
  lokal_id        TEXT NOT NULL,             -- products.sku atau warehouses.id
  nama_snapshot   TEXT,                      -- nama saat terakhir dilihat (untuk diagnosis)
  terakhir_dilihat INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (jenis, kledo_id)
);
CREATE INDEX IF NOT EXISTS idx_kledo_map_lokal ON kledo_map(lokal_id);

-- ── Riwayat sinkronisasi (pola import_batches, tabel sendiri agar tidak mengganggu impor Excel). ──
CREATE TABLE IF NOT EXISTS kledo_sync (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mulai_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  selesai_at     INTEGER,
  jenis          TEXT NOT NULL DEFAULT 'semua',   -- gudang|produk|stok|semua
  pemicu         TEXT NOT NULL DEFAULT 'manual' CHECK (pemicu IN ('manual','jadwal')),
  status         TEXT NOT NULL DEFAULT 'jalan' CHECK (status IN ('jalan','sukses','sebagian','gagal')),
  gudang_baru    INTEGER NOT NULL DEFAULT 0,
  gudang_ubah    INTEGER NOT NULL DEFAULT 0,
  produk_baru    INTEGER NOT NULL DEFAULT 0,
  produk_ubah    INTEGER NOT NULL DEFAULT 0,
  hpp_dipertahankan INTEGER NOT NULL DEFAULT 0,  -- HPP D1 dibiarkan krn Kledo 0/kosong
  stok_baris     INTEGER NOT NULL DEFAULT 0,     -- baris stock_by_bin yang ditulis
  stok_drift     INTEGER NOT NULL DEFAULT 0,     -- produk yang qty-nya berbeda dari D1
  galat          INTEGER NOT NULL DEFAULT 0,
  durasi_ms      INTEGER,
  pesan          TEXT,
  oleh           TEXT
);
CREATE INDEX IF NOT EXISTS idx_kledo_sync_mulai ON kledo_sync(mulai_at DESC);

CREATE TABLE IF NOT EXISTS kledo_sync_galat (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id  INTEGER NOT NULL REFERENCES kledo_sync(id) ON DELETE CASCADE,
  bagian   TEXT NOT NULL,      -- kredensial|gudang|produk|stok
  ref      TEXT,               -- kledo_id / sku / nama gudang
  pesan    TEXT NOT NULL,
  at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_kledo_galat_sync ON kledo_sync_galat(sync_id);

-- ── Kolom penanda pada tabel yang sudah ada (aditif, aman untuk data berjalan). ──
-- kledo_id pada warehouses EKSPLISIT: memisahkan "id kita" dari "id Kledo" sehingga gudang
-- virtual ONLINE tidak pernah tertukar dengan gudang Kledo mana pun.
ALTER TABLE warehouses ADD COLUMN kledo_id INTEGER;
ALTER TABLE warehouses ADD COLUMN kledo_synced_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wh_kledo ON warehouses(kledo_id) WHERE kledo_id IS NOT NULL;

-- Kapan Kledo terakhir mengubah/menyentuh produk ini (untuk tahu seberapa segar datanya).
ALTER TABLE products ADD COLUMN kledo_synced_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_products_kledo_sync ON products(kledo_synced_at);
