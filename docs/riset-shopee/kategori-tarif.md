# R-R2 — Pemetaan `kategori_tarif` path → tier (dari render resmi 7882)

Tanggal: 2026-10-10. Sumber: `docs/riset-shopee/render/7882.{html,txt}` (render Playwright, status 200).
Artefak mesin: `render/admin-tarif.json` (312 baris KAT/SUB/JENIS/tarif), `render/kategori-tarif.json` (276 path unik + tier + grup_go), `render/go-tarif.json` (30 kategori GO Mei 2026 + 28 Des 2026), `render/go-grup.json`.

## 1. Metode
Grid HTML diurai dengan rowspan (312 baris). Tarif hanya tercetak di baris pertama tiap kelompok; baris lanjutan mewarisi tarif kelompoknya. Hasil: 276 pasangan `(KATEGORI, SUB)` unik. 248 path punya tarif tunggal; **28 path multi-tarif** (sementara pakai tarif tertinggi = aman, tak meremehkan biaya; kolom `multi_tarif` menandai butuh rincian per JENIS PRODUK di D-R2 lanjutan).

## 2. Tier resmi (9 tingkat, cocok dengan seed v0.1 — tidak ada perubahan nilai)
T10 ×34 · T9_5 ×56 · T9 ×106 · T8_25 ×73 · T6_75 ×14 · T6_5 ×14 · T5_25 ×10 · T4_25 ×3 · T2_5 ×2. Dasar 12,5% + diskon 20% → final 10% terkonfirmasi di catatan 7882 dan ringkasan 3489.

## 3. Path rumah tangga untuk katalog ini (T-V2: 482 SKU, 0% cocok → target pemetaan)
| Path Shopee | Tier | GO | Untuk produk |
|---|---|---|---|
| `Perlengkapan Rumah > Peralatan Makan` | T10 | D (5,5%/7%) | piring, mangkok, gelas, sendok, lunch box, rice bucket, tudung saji, toples, dispenser air, termos |
| `Perlengkapan Rumah > Perlengkapan Dapur` | T10 (Sealer T6_5 — override per jenis) | D | rak dapur, cetakan, wajan, kompor, regulator, selang |
| `Perlengkapan Rumah > Perawatan Rumah` | T10 | D | sapu, pel, keset, sikat, ember, gayung, tempat sampah |
| `Perlengkapan Rumah > Furniture` | T10 | D | lemari, rak sepatu/TV, meja, kursi, box container |
| `Perlengkapan Rumah > Kamar Tidur` | T10 | D | kasur, matras, sprei |
| `Perlengkapan Rumah > Kamar Mandi` | T10 | D | gayung, sikat mandi |
| `Perlengkapan Rumah > Organizer Rumah` | T10 | D | keranjang, box penyimpanan |
| `Perlengkapan Rumah > Dekorasi` | T10/T9 (multi) | D | tikar, karpet, vas |
| `Elektronik > Perangkat Dapur` | T6_5 | D | dispenser/filter air elektrik, kompor elektrik |
| `Kesehatan > Obat-obatan & Alat Kesehatan` / `Ibu & Bayi > ...` | per jenis | D | sabun, catok LPG, regulator gas |

GO XTRA Mei 2026 (berlaku kini): `Perlengkapan Rumah` = grup D (biasa 5,5% / khusus 7%, plafon 40rb/60rb per qty). Tarif Des 2026 (grup D → 8,5%/10,5%) dicatat di `go-tarif.json`, belum dipakai di seed (berlaku via `valid_from` di D-R2).

## 4. Yang belum (bukan tebakan)
- 28 path multi-tarif butuh rincian per JENIS PRODUK (contoh: `Perlengkapan Dapur`: Sealer 6,5% vs lainnya 10%) — D-R2 lanjutan atau `tier_override` per SKU.
- Path tingkat JENIS (3 tingkat) belum dimasukkan — prefix-terpanjang di E-R1 menutupi (path 2 tingkat cocok sebagai induk).
- Tarif iklan 3%/4% (27367) dan kriteria 6922 sudah dirender; entri seed iklan tetap `belum` + nonaktif sampai kolom biasa/khusus per kategori dipastikan dari tabel 27367 (11 baris per periode, sudah tersimpan di render).
