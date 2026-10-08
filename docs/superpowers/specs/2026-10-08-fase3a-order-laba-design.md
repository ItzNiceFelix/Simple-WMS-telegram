# Spec Fase 3a — E-commerce: Order Keluar + Laba (satu store, dua wajah)

Tanggal: 2026-10-08 · Status: disetujui owner · PRD acuan: §F5, §5 (skema), §7 risiko.

## 1. Tujuan
Dua halaman terpisah di atas satu store `orders`:
- **Order Keluar** (fulfillment): daftar kerja pesanan MP, stok ONLINE berkurang saat Pack/Kirim, kembali saat Batal.
- **Laba** (analisa): omzet/HPP/biaya/pajak/laba per pesanan + agregat periode/MP/SKU. Tanpa sentuh stok.

## 2. Skema (migrasi 0006_fase3_order.sql)
- `orders(marketplace TEXT, no_pesanan TEXT, tanggal INTEGER, buyer TEXT,
  status_fulfill TEXT DEFAULT 'pending' CHECK (pending|pack|kirim|selesai|batal),
  pajak_pph INTEGER DEFAULT 1, pajak_ppn_persen INTEGER DEFAULT 0,
  PRIMARY KEY (marketplace, no_pesanan))`
- `order_items(marketplace, no_pesanan, sku, qty INTEGER, harga_satuan INTEGER,
  hpp_snapshot INTEGER, subtotal INTEGER,
  PRIMARY KEY (marketplace, no_pesanan, sku),
  FOREIGN KEY (marketplace, no_pesanan) REFERENCES orders ON DELETE CASCADE)`
- `order_fees(id, marketplace, no_pesanan, jenis CHECK (admin|service|komisi|ongkir|voucher|affiliate|iklan|lain),
  basis CHECK (flat|persen), nilai INTEGER, amount INTEGER,
  FOREIGN KEY (marketplace, no_pesanan) REFERENCES orders ON DELETE CASCADE)`
- `mp_fee_presets(marketplace, jenis, basis, nilai, PRIMARY KEY (marketplace, jenis))`
  Seed generik Shopee/Tokopedia/TikTok/Lazada (angka contoh, owner ubah di Pengaturan).
- Index: `idx_orders_tgl (tanggal)`, `idx_orders_mp (marketplace, tanggal)`, `idx_items_sku (sku)`.

## 3. Rumus (per 1 No. Pesanan, berapa pun itemnya)
- `Omzet = Σ(qty × harga_satuan)`
- `HPP = Σ(qty × hpp_snapshot)` (snapshot dari `products.hpp` saat konfirmasi import)
- `Biaya = Σ(persen × Omzet + flat)` dari `order_fees.amount`
- `PPh = 0,5% × Omzet kotor` bila `pajak_pph=1` (aturan Shopee, per no. pesanan)
- `PPN = pajak_ppn_persen% × Omzet` bila > 0 (opsional)
- `Laba = Omzet − HPP − Biaya − PPh − PPN`; `Margin = Laba / Omzet × 100%`
- Laba per SKU = alokasi proporsional `subtotal / Omzet` atas biaya+ pajak level order.

## 4. Import 2-fase (pola Excel Fase 2)
- Template sheet `Pesanan`: `NoPesanan* | Marketplace* | Tanggal* | SKU* | Qty* | HargaSatuan* | Buyer | FeeJenis | FeeBasis | FeeNilai | PPh(YA/TIDAK) | PPN%`.
- Upload → validasi per baris (SKU harus ada di `products`, qty ≥ 1, tanggal valid,
  duplikat `(MP, NoPesanan, SKU)` dalam file) → preview → konfirmasi:
  preset fee diterapkan otomatis bila baris tak bawa fee sendiri;
  `hpp_snapshot` dibekukan; tipe batch `pesanan` di `import_batches`.
- Satu No. Pesanan boleh multi-item multi-qty (satu header + N baris item).

## 5. Fulfillment (Order Keluar)
- Transisi: `pending → pack → kirim → selesai`; `batal` dari pending/pack/kirim.
- `pack`: kurangi `stock_by_bin` ONLINE per item via `ubahRelatif` + `stock_moves`
  jenis `jual_mp` (perlu tambah ke CHECK `stock_moves.jenis` via migrasi).
- `batal` setelah pack/kirim: kembalikan stok (movement lawan `retur_mp`).
- Hard-block stok negatif (pola Kledo, konsisten F4).

## 6. Laba (analisa + export)
- Rekap per pesanan + agregat filter periode/MP/SKU; export Excel (round-trip header sama).
- PDF via `pdf-lib` di route (pure JS, pola PRD); JPG render client-side (Fase 4 bila sempat, else tunda eksplisit).
- Bot: `/laba [periode]` ringkasan omzet/laba per MP (teks, pola `bangunLaporanHarian`).

## 7. Kriteria sukses
- Import 5 pesanan multi-item → preview benar → konfirmasi → HPP snapshot beku
  (ubah `products.hpp` setelahnya tak ubah laba lama).
- Pack → stok ONLINE berkurang + movement `jual_mp`; Batal → kembali.
- Laba per pesanan = Omzet − HPP − Biaya − PPh(0,5%×Omzet) − PPN; agregat cocok.
- Unit `node:test` rumus + transisi; typecheck 0; e2e import pesanan hijau.
- YAGNI: sinkron API MP otomatis, rekonsiliasi dana MP, multi-gudang fulfill, FIFO (3b).

## 8. Risiko
- Preset fee generik bisa beda dari tarif akun aktual → label JELAS "contoh, sesuaikan";
  override per order selalu bisa.
- `stock_moves.jenis` CHECK perlu migrasi tambah `jual_mp`/`retur_mp` (alter table recreate
  atau CHECK longgar — putuskan saat implementasi, pola termurah menang).
- D1 Free write-limit saat import massal → chunk batch pola Excel (50–200 stmt).
