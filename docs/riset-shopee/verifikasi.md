# R-R3 — Verifikasi Entri `sekunder` dan `belum` (seed v0.1, 23 rules)

Tanggal: 2026-10-10. Metode: render Playwright 5 halaman edu + ringkasan 3489 + `help.shopee.co.id` 71196 + pajak.go.id + media sekunder.
Hasil: `resmi`: 2 → **13** · `resmi_cuplikan`: 2 → 0 · `sekunder`: 16 → 7 · `belum`: 3 → 3 (tetap nonaktif).

## 1. Naik ke `resmi` (sumber primer dibaca penuh)
| Rule seed | Bukti resmi |
|---|---|
| `proses` Rp1.250 per_order | Ringkasan 3489: "Biaya Proses Pesanan … Rp1.250 … biaya per pesanan terselesaikan". Berlaku 20 Juli 2025 (Kontan/Bisnis, konsisten). |
| 9 tier admin T10..T2_5 (nilai persen) | 7882 render penuh: 312 baris, 9 tingkat cocok persis dengan seed. |
| GO `gratis_ongkir_xtra` grup A biasa 7,5%/khusus 9% (seed: kategori T10) | 24877: Fashion Muslim, Tas, Koper = grup G 7,5%/9% (Mei 2026, plafon 40rb/60rb). **Koreksi**: label seed `T10` untuk GO salah — GO memakai grup huruf (G), bukan tier admin. D-R2: ganti `kategori` → `G`. |
| GO grup E biasa 6%/khusus 7,5% | 24877: Makanan & Minuman, Hobi = grup E 6%/7,5%. Cocok. |
| 2 kuota gratis (500/1000 pesanan Rp0) | 71196 resmi + 3489: 500 (gabung <1 Agu 2026) / 1000 (gabung 1 Mei–30 Jun 2026) + varian upload 1 Feb–31 Jul 2026 + misi khusus. Cocok. |
| `pajak_pph` 0,5% | pajak.go.id: PPh 22 marketplace 0,5% peredaran bruto; PP 23/2018 + PP 55/2022 + PP 20/2026 (UMKM ≤500jt/thn bebas). **Naik ke `resmi`** (rujukan primer pajak.go.id, bukan Investortrust). |
| Ambang Non-Star 50 pesanan / 6 bulan | 3489 resmi: `TOTAL PESANAN SELESAI ≤50 atau ≤6 BULAN = BEBAS BIAYA (admin + proses + GO)`; `>50 atau >6 bulan = tarif penuh`. **Konflik 50-vs-100 SELESAI: 50 resmi.** Rule placeholder Non-Star tetap nonaktif (perlu bentuk rule bebas-biaya, bukan tarif 10%). |
| `pre_order` 3% | 3489: "Biaya Layanan Produk Pre Order 3,00% … kecuali kategori tertentu". **Naik ke `resmi`** (nilai + pengecualian terkonfirmasi; basis per kuantitas tetap perlu pastikan). |
| `spaylater_xtra` 2,5%/4% tenor 3/6 | 3489: "2.5% tenor 3 bulan, 4,0% tenor 6 bulan". **Naik ke `resmi`** (tambah rule tenor-6 di D-R2). |
| `promo_xtra` | 3489: Promo XTRA **4,50%** (plafon 60rb/kqty) + Promo XTRA+ 6,50% (plafon 80rb) + Live XTRA 3% (2% bila ikut Promo) + Video XTRA 3% (2% bila ikut Promo). **Konflik 2%-vs-4–5% SELESAI: 4,5% resmi.** Seed 2%/10rb SALAH — D-R2: ganti 4,5%/60rb + tambah 4 rule baru. |

## 2. Tetap `sekunder` (7, konsisten multi-sumber, belum ada halaman primer)
- 7 tier admin non-cuplikan (T9_5, T8_25, T6_75, T6_5, T5_25, T4_25, T2_5): nilai cocok 7882 (resmi) tetapi kutipan seed dari media — naik ke `resmi` otomatis via D-R2 karena sumber render 7882 resmi (tanpa perlu verifikasi ulang).
- `asuransi_pengiriman` 0,5% (satu sumber Bisnis.com) — tetap sekunder + nonaktif.

## 3. Tetap `belum` + nonaktif (3)
- Ambang Non-Star (dipakai sebagai rule, bukan fakta — fakta sudah resmi, lihat §1).
- GO pengguna-iklan 3% (27367 ter-render: tabel 11 baris; kolom per-kategori perlu ekstraksi lanjut — angkanya ada, pemetaan kolom biasa/khusus vs program perlu pastikan).
- `promo_xtra` lama (diganti rule resmi §1).

## 4. Perubahan seed yang diusulkan (D-R2, bukan di file seed — seed v0.1 dibiarkan sebagai arsip riset)
1. `verifikasi`: 11 entri → `resmi` (proses, 9 tier via 7882, 2 kuota GO, PPh via pajak.go.id, pre-order, spaylater-3bln, promo-4,5%).
2. GO T10 (7,5%/9%) → grup `G`; tambah grup B/C/D/F/H Mei 2026 (30 baris `go-tarif.json`) sebagai rule program nonaktif-kecuali-dipakai.
3. `promo_xtra` 2%/10rb → 4,5%/60rb + tambah `promo_xtra_plus` 6,5%/80rb, `live_xtra` 3%/2%/20rb, `video_xtra` 3%/2%/20rb, `spaylater_xtra` tenor-6 4%.
4. Non-Star: ganti placeholder tarif-10% dengan rule `bebas_biaya` (syarat kuota 50/6bln) + dokumentasikan di U-R1.
5. Tarif Des 2026 (`go-tarif.json` des + 27367 tabel-1): masuk sebagai rule `valid_from=2026-12-01`, nonaktif sampai tanggal berlaku.
6. `dikeluarkan_dari_seed` tetap 4 (komisi dinamis, GO 4%, Non-Star 2025, Mall) + tambah catatan "Promo 2% diganti 4,5% resmi".

## 5. Konflik diputuskan
| Topik | A | B | Putusan |
|---|---|---|---|
| Kategori A admin | 8% (2025) | 10% (2026) | 10% resmi (7882) |
| Ambang Non-Star | 50/6bln | 100 | **50/6bln resmi (3489)** |
| GO D | 5,5% | 4% iklan | 5,5% resmi; 4%-iklan belum |
| GO umum | 4% | per-kategori | per-kategori resmi (Mei 2026) |
| Komisi dinamis | Shopee | TikTok/Tokopedia | bukan Shopee (tetap dikeluarkan) |
| Promo XTRA | 2% | 4–5% | **4,5% resmi (3489)** + XTRA+ 6,5% |
| Mall | A–G | A–E | tetap out-of-scope v1 |
