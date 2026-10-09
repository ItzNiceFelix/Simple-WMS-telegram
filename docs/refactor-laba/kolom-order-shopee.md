# Verifikasi Kolom Export Order.all — T-V1 (Fase 0)

Sumber data nyata (bukan tebakan):
1. `/sdcard/Download/Telegram/tes order.xlsx` — sheet `orders`, 49 kolom, 146 order (2 multi-item). Contoh baris §2.
2. `/sdcard/Download/Telegram/Order.toship.20260505_20260604 (1).xlsx` — sheet `orders` 48 kolom + `Advance Fulfilment` 11 kolom, 72 order (4 multi-item). Memuat status `Perlu Dikirim`.
3. D1 remote `simple-wms.laba_harian` — snapshot `2026-10-08` dari file `Order.all.20261008_20261008.xlsx`: 230 order, 238 baris, omzet 6.776.739, HPP 3.951.280, biaya 2.054.740, laba 770.719. `tolak_json` berisi penolakan `SKU 100300/100098/100101 tak cocok master stok` (bukti file Order.all asli memakai `Nomor Referensi SKU` dan master D1 belum lengkap).

File `Order.all.20261008_20261008.xlsx` sendiri tidak ada di storage — verifikasi kolom memakai dua file di atas (format export Shopee identik: sheet `orders`, nama kolom sama persis).

## 1. Jawaban empat cek T-V1

### Cek 1 — Apakah `Subtotal Pesanan` sudah dikurangi diskon penjual? YA.
Bukti baris `2605019JTE451Y` (`tes order.xlsx`):
- `Harga Awal` = 18.000, `Harga Setelah Diskon` = 16.000, `Jumlah` = 7
- `Subtotal Pesanan` = 112.000 = 7 × 16.000 (harga SETELAH diskon)
- `Total Diskon` = 14.000 = `Diskon Dari Penjual` = 14.000 = 7 × (18.000 − 16.000)

Jadi `Subtotal Pesanan = Jumlah × Harga Setelah Diskon`, sudah neto dari diskon produk penjual.
Konsekuensi untuk E2 (§4.1 v2): kode v1 (`labaShopee.ts` L152 + L157–165) menjumlah `Subtotal` sebagai omzet LALU menambahkan `Diskon Dari Penjual + Voucher Ditanggung Penjual + Paket Diskon (Diskon dari Penjual)` sebagai biaya — diskon penjual dihitung dua kali (sekali menekan omzet, sekali menaikkan biaya). v2 WAJIB pakai dasar resmi `harga_asli − diskon_penjual − voucher_penjual` per baris, bukan `Subtotal` + biaya file.

### Cek 2 — Apakah `Subtotal Pesanan` berulang per baris item? TIDAK. Per-baris, aman dijumlah.
Bukti multi-item:
- Order `2606022BXJ1SU3` (toship): baris1 `Subtotal` 23.547 (qty 1 × 23.547) + baris2 `Subtotal` 6.998 (qty 2 × 3.499). Bukan total diulang.
- Order `260505HWJ4XA8D` (tes order): `2.000` + `87.475`.
- Order `26060351V6Y0KP` (toship): `23.547` + `17.862`, `Total Pembayaran` 58.309 (= 41.409 + ongkir pembeli 18.400 − potongan, kolom total diulang per baris dan TIDAK boleh dijumlah — kode v1 benar tidak memakainya).

Pertanyaan terbuka v1 §10.1 terjawab: tidak ada double-count omzet. `omzet_order = Σ Subtotal` per baris sudah benar.

### Cek 3 — Kolom harga/diskon/voucher yang konsisten? YA, nama persis di bawah.
- `Harga Awal` (kotor per unit, cth `18.000`, `23.547`, `3.499`) — format ribuan titik.
- `Harga Setelah Diskon` (neto per unit, cth `16.000`) — selalu ada.
- `Jumlah` (qty kotor), `Returned quantity` (retur, `0` di semua sampel; kode `qty = Jumlah − Returned` sudah benar).
- `Subtotal Pesanan` (= `Jumlah × Harga Setelah Diskon`, sudah dikurangi retur? TIDAK — kode mengurangi qty untuk HPP tapi memakai subtotal penuh; retur parsial tak mengurangi subtotal — perilaku dipertahankan per §10.2, diperbaiki di v1.1).
- `Total Diskon` (= `Diskon Dari Penjual + Diskon Dari Shopee`, cth 14.000 = 14.000 + 0).
- `Diskon Dari Penjual` (cth `14.000`), `Diskon Dari Shopee` (cth `0`).
- `Voucher Ditanggung Penjual` (cth `0`), `Voucher Ditanggung Shopee` (cth `0`/`3.600` — baris 3 tes order: voucher Shopee 3.600 menekan `Total Pembayaran` 15.400, bukan Subtotal).
- `Paket Diskon` (`Y`/`N`), `Paket Diskon (Diskon dari Shopee)`, `Paket Diskon (Diskon dari Penjual)` (keduanya `0` di sampel).
- `Cashback Koin`, `Potongan Koin Shopee`, `Diskon Kartu Kredit` (ada, `0` di sampel — bukan biaya penjual, abaikan).
- `Total Pembayaran` (total order diulang per baris — JANGAN dijumlah), `Ongkos Kirim Dibayar oleh Pembeli`, `Estimasi Potongan Biaya Pengiriman`, `Perkiraan Ongkos Kirim` (info ongkir, bukan dasar admin).

Tidak ada kolom bernama `Diskon Produk` — diskon produk = `Harga Awal − Harga Setelah Diskon` (atau `Diskon Dari Penjual` bila sama).

### Cek 4 — Nama kolom persis untuk §4.2 v2.
| Nilai §4.2 | Kolom export persis | Contoh |
|---|---|---|
| `harga_asli_b` | `Harga Awal` | `18.000` |
| `diskon_produk_b` | `Harga Awal − Harga Setelah Diskon` (derivasi; cek silang `Diskon Dari Penjual`) | 18.000 − 16.000 = 2.000/unit |
| `voucher_penjual_b` | `Voucher Ditanggung Penjual` + `Paket Diskon (Diskon dari Penjual)` | `0` (di sampel; kolom ada) |
| `dasar_b` | `Jumlah × Harga Setelah Diskon − voucher_penjual_b` | 112.000 − 0 |
| `qty_b` | `Jumlah − Returned quantity` | 7 − 0 |
| `subtotal_b` (legacy v1) | `Subtotal Pesanan` | `112.000` |
| `tanggal_order` | `Waktu Pesanan Dibuat` (cth `2026-05-01 07:45`) — alternatif tanggal snapshot v1.1 | `2026-06-02 13:39` |
| `status` | `Status Pesanan` (`Selesai`, `Perlu Dikirim` — terbukti ada di file toship) | `Perlu Dikirim` |
| `sku` | `Nomor Referensi SKU` → fallback `SKU Induk` (keduanya KOSONG di 2 file sampel — bukan file Order.all produksi; snapshot D1 membuktikan file produksi berisi ref SKU seperti `100300`) | `0649` (satu baris toship) |

## 2. Header lengkap (agar E2 tak salah nama)
Sheet `orders` Order.all/Order.toship (48–49 kolom, varian `Shipped by Advance Fulfilment` hanya di tes order):
`No. Pesanan | Status Pesanan | Status Pembatalan/ Pengembalian | No. Resi | Opsi Pengiriman | Antar ke counter/ pick-up | Pesanan Harus Dikirimkan Sebelum… | Waktu Pengiriman Diatur | Waktu Pesanan Dibuat | Waktu Pembayaran Dilakukan | Metode Pembayaran | SKU Induk | Nama Produk | Nomor Referensi SKU | Nama Variasi | Harga Awal | Harga Setelah Diskon | Jumlah | Returned quantity | Subtotal Pesanan | Total Diskon | Diskon Dari Penjual | Diskon Dari Shopee | Berat Produk | Jumlah Produk di Pesan | Total Berat | Voucher Ditanggung Penjual | Cashback Koin | Voucher Ditanggung Shopee | Paket Diskon | Paket Diskon (Diskon dari Shopee) | Paket Diskon (Diskon dari Penjual) | Potongan Koin Shopee | Diskon Kartu Kredit | Ongkos Kirim Dibayar oleh Pembeli | Estimasi Potongan Biaya Pengiriman | Ongkos Kirim Pengembalian Barang | Total Pembayaran | Perkiraan Ongkos Kirim | Catatan dari Pembeli | Catatan | Username (Pembeli) | Nama Penerima | No. Telepon | Alamat Pengiriman | Kota/Kabupaten | Provinsi | Waktu Pesanan Selesai`

Sheet `Advance Fulfilment` (11 kolom, info booking — bukan dasar laba):
`Booking SN | No. Resi | Opsi Pengiriman | Antar ke counter/ pick-up | Pesanan Harus Dikirimkan… | Booking Creation Date | Waktu Pembayaran Dilakukan | Nama Produk | Nomor Referensi SKU | Nama Variasi | Alamat Pengiriman`

Sheet `Income` (`tes.xlsx`) adalah laporan pendapatan (44 kolom, `Username (Penjual) | Dari | ke…`) — bukan input E2.

## 3. Keputusan untuk E2 (blokir dibuka dengan catatan)
1. `Subtotal` per-baris → agregasi omzet v1 aman; tidak ada perubahan penjumlahan.
2. `Subtotal` sudah neto diskon → E2/E-R3 WAJIB dasar resmi (`Harga Awal − diskon − voucher`), dan biaya file v1 (voucher/diskon penjual sebagai biaya) DIHAPUS dari rumus (diganti komponen dasar). Selisih vs snapshot lama = tepat sebesar diskon penjual yang dulu double-count — dokumentasikan di U2 sebagai "perubahan rumus v2", bukan bug migrasi.
3. `Waktu Pesanan Dibuat` tersedia → siapkan pengelompokan tanggal v1.1 tanpa mengubah default tanggal-user v1.
4. `Perlu Dikirim` terbukti nilai status nyata → allowlist §5.1 valid.
