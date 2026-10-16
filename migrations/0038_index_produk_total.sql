-- 0038_index_produk_total.sql — indeks untuk halaman "Produk Total" (/produk-total).
--
-- MASALAH YANG DIPERBAIKI (calon):
--   Scope `produk-total` (app/api/baca/route.ts) mengurutkan katalog di SQL dengan
--   tiebreaker `p.sku`. Urutan default-nya `p.nama_accurate COLLATE NOCASE ASC, p.sku ASC`.
--   Tabel `products` baru punya `idx_products_online` dan `idx_products_norm`
--   (migrations/0002_fase1_skema.sql:68-69); `nama_accurate` TIDAK terindeks untuk
--   pengurutan collate-insensitive, jadi setiap halaman = full scan + sort 1174 baris.
--
-- KENAPA INI MIGRASI TERPISAH, BUKAN DIEDIT KE 0002:
--   0002 sudah diterapkan di produksi; menambah index di sana tidak akan jalan pada DB yang
--   sudah ada (migrasi hanya sekali pakai), sehingga dev dan prod akan berbeda diam-diam.
--
-- KENAPA SATU INDEX GABUNGAN, BUKAN TIGA:
--   Hanya dua kunci urut yang benar-benar berbeda ekspresinya:
--     - nama  -> p.nama_accurate COLLATE NOCASE, p.sku
--     - sku   -> p.sku (primary key, sudah terurut — TIDAK butuh index tambahan)
--   `lokasi` dan `qty` diurutkan dari agregat stock_by_bin, bukan dari kolom `products`;
--   keduanya tetap butuh agregasi per SKU halaman, jadi scan 1174 produk jauh lebih murah
--   daripada menyimpan total_qty yang harus di-invalidate tiap mutasi stok (dan tabel
--   simpanan akan basi tanpa ada yang menyadarinya — prinsip yang sama dengan scope
--   `kekurangan` di app/api/baca/route.ts).
--
-- CATATAN: D1/SQLite menolak `CREATE INDEX IF NOT EXISTS` pada kolom dengan COLLATE
--   berbeda lewat ADD COLUMN, tapi index ekspresi biasa di sini sah. Dijalankan dengan
--   `wrangler d1 execute` seperti migrasi lain — TIDAK dijalankan oleh agen ini.

CREATE INDEX IF NOT EXISTS idx_products_nama_sku
  ON products (nama_accurate COLLATE NOCASE, sku);

-- stock_by_bin sudah punya idx_sbb_sku (0002:101) untuk agregat per SKU + pencarian
-- gudang dominan; tidak perlu index baru.
