-- 0003_fase1_seed_demo.sql — Data demo Simple-WMS (opsional, dev/e2e saja).
-- JANGAN terapkan di produksi berisi data migrasi. Produk + stok ONLINE contoh.
INSERT OR IGNORE INTO products (sku, nama_accurate, nama_accurate_normalized, hpp, is_online_product, updated_at) VALUES
  ('DEMO-001', 'Kemeja Lengan Panjang', 'kemeja lengan panjang', 75000, 1, unixepoch()),
  ('DEMO-002', 'Celana Chino Slim', 'celana chino slim', 95000, 1, unixepoch()),
  ('DEMO-003', 'Kaos Polos Hitam', 'kaos polos hitam', 35000, 0, unixepoch());
INSERT OR IGNORE INTO stock_by_bin (sku, warehouse_id, qty) VALUES
  ('DEMO-001', 'ONLINE', 25),
  ('DEMO-002', 'ONLINE', 8),
  ('DEMO-003', 'ONLINE', 0);
UPDATE products SET stok_min = 10 WHERE sku = 'DEMO-002';
INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, created_by, at, by)
  SELECT 'DEMO-001', 25, 'OPENING', 'ONLINE', 'sync', 'processed', 'seed', unixepoch(), 'seed'
  WHERE NOT EXISTS (SELECT 1 FROM stock_moves WHERE sku = 'DEMO-001' AND jenis = 'OPENING');
INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, created_by, at, by)
  SELECT 'DEMO-002', 8, 'OPENING', 'ONLINE', 'sync', 'processed', 'seed', unixepoch(), 'seed'
  WHERE NOT EXISTS (SELECT 1 FROM stock_moves WHERE sku = 'DEMO-002' AND jenis = 'OPENING');
PRAGMA optimize;
