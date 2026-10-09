# R-R1 — Render Halaman Seller Education (Playwright)

Tanggal: 2026-10-10. Output: `docs/riset-shopee/render/{7882,24877,2037,27367,6922}.{html,txt}`, `hasil.json`, `go-tarif.json`.
Metode: Chromium headless Playwright repo, `domcontentloaded` + tunggu body >500 char (networkidle GAGAL semua 5 URL — halaman edu long-poll; retry ringan sukses 5/5 status 200).

| ID | URL | HTML | Teks | Isi kunci |
|---|---|---|---|---|
| 7882 | Rincian Biaya Penjual per Kategori Produk | 411KB | 43KB, 2383 baris | Tabel KATEGORI > SUB > JENIS PRODUK > tarif admin Non Star/Star/Star+ (kolom tunggal — tarif SAMA semua status). Tier: 10,00% ×21, 9,50% ×19, 9,00% ×26, 8,25% ×15, 6,75% ×6, 6,50% ×6, 5,25% ×3, 4,25% ×2, 2,50% ×2 (+12,5% dasar ×4). Catatan: final 10% = 20% di bawah dasar 12,5%. |
| 24877 | Kategori Produk GO XTRA | 623KB | 93KB | 9 tabel quill: tabel 0–4 = tarif efektif 2 Mei 2026 (berlaku kini), tabel 5–8 = tarif 1 Des 2026 / 1 Jan 2027 (mendatang). Rumus: `(Harga Asli − Diskon/Voucher penjual) × % kategori`. Contoh ilustrasi: Pelindung Matras ukuran khusus 8%. `go-tarif.json` berisi 30 baris Mei (grup A–H) + 28 baris Des. |
| 2037 | Biaya Administrasi Star/Star+ | 124KB | 3,9KB | Navi + judul; tarif detail mengacu 7882. Rumus dasar resmi (harga asli − diskon − voucher) terkonfirmasi di cuplikan pra-riset. |
| 27367 | Promo Khusus Pengguna Iklan | 156KB | 6,1KB | 2 tabel: tarif iklan 3% (kini) + 4% (Des 2026). Ads Take Rate = biaya iklan bersih ÷ total penjualan 30 hari. Syarat: min 3% (min 4% per Des 2026), atau min 0,5% bila ≥50% penjualan dari HP/Tablet/Desktop/Laptop/Monitor/Logam Mulia/Perhiasan. Promo: hemat s.d 1,5%. |
| 6922 | Kriteria GO XTRA | 201KB | 15KB | Kriteria peserta, pemberhentian otomatis bila tak memenuhi, pendaftaran opsional, biaya dikenakan SEMUA pesanan terselesaikan (pakai/tidak voucher), jasa kirim syarat, manfaat voucher + minimum belanja. |

Keterbatasan: render hanya memuat KATEGORI PRODUK tingkat atas per baris tarif (bukan path sub-kategori penuh seperti `Fashion > Tas Wanita > Aksesoris Tas`). Untuk `kategori_tarif` path-lengkap, R-R2 memetakan manual dari kolom SUB KATEGORI + JENIS PRODUK di 7882 (lihat `kategori-tarif.md` §metode).
