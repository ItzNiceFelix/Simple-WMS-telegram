# Riset Tarif Shopee Indonesia (2026) — Dasar Seed Preset Laba

Tanggal riset: 9 Oktober 2026
Tujuan: menjadi seed awal `seed/shopee_fees_id.json` dan dasar desain rule engine. Agent riset (lihat §8) wajib memverifikasi ulang setiap angka dengan `verifikasi = belum` atau `sekunder` sebelum dianggap final.

---

## 1. Ringkasan

1. **Biaya administrasi** bergantung pada **sub-kategori produk**, bukan hanya nama grup A–E. Angka 2026 yang tersebar di media: 10%, 9,5%, 9%, 8,25%, 6,75%, 6,5%, 5,25%, 4,25%, dan 2,5% (khusus). Sumber resmi menyatakan tarif Star/Star+ dihitung dari tarif dasar 12,50% dengan diskon 20%. Beberapa sumber menyatakan tarif Non-Star 2026 sama dengan Star/Star+.
2. **Biaya Gratis Ongkir XTRA** adalah biaya layanan terpisah, dihitung per kategori dengan **plafon per kuantitas produk**. Aturan plafon Rp40.000 (ukuran biasa) dan Rp60.000 (ukuran khusus) berasal dari syarat dan ketentuan resmi. Persentase per kategori berubah pada **2 Mei 2026**. Ada juga tarif lebih rendah untuk penjual yang memenuhi syarat biaya iklan bersih minimum.
3. **Biaya proses pesanan** Rp1.250 per transaksi berhasil, berlaku sejak 20 Juli 2025. Dikenakan per order, bukan per item.
4. **Biaya administrasi sudah termasuk PPN** menurut keterangan Shopee yang dikutip media. Jangan menambahkan PPN atas biaya platform.
5. **Biaya komisi dinamis 3–8% dengan plafon Rp650.000 (18 Mei 2026) bukan milik Shopee.** Sumber yang saya gunakan sebelumnya membahas skema tersebut untuk TikTok Shop dan Tokopedia. **Jangan dimasukkan ke seed Shopee.**

---

## 2. Metode dan Keterbatasan

| Sumber | Status | Catatan |
|---|---|---|
| `help.shopee.co.id/portal/4/article/71196` (Syarat & Ketentuan Gratis Ongkir XTRA, terakhir diubah 31 Juli 2026) | Resmi, dibaca penuh | Sumber paling kuat. Berisi plafon, aturan kuota gratis, dan rumus. Tarif persen per kategori hanya ditautkan. |
| `seller.shopee.co.id/edu/article/*` | **Tidak terbaca** dengan pengambilan biasa. Halaman dirender JavaScript. | Hanya cuplikan dari pencarian yang bisa dipakai. Agent perlu merender halaman dengan Playwright (repo sudah memakai Playwright). |
| Media (Metro TV, Bisnis.com, Kontan, Katadata, DealPOS, Everpro, Digifolium, Argia, Sotagle, dll.) | Sekunder | Dipakai untuk melengkapi tarif. Angka antar sumber sering tidak konsisten, lihat §7. |
| `finansial.kontan.co.id` | Diblokir | Tidak bisa dibaca penuh. |

Tingkat verifikasi yang dipakai di seed:
- `resmi` — dibaca dari halaman resmi Shopee dan konsisten.
- `resmi_cuplikan` — hanya cuplikan halaman resmi dari hasil pencarian.
- `sekunder` — dari media atau blog, konsisten di beberapa sumber.
- `belum` — konflik antar sumber, tidak ditemukan, atau tidak bisa diverifikasi.

---

## 3. Biaya Administrasi (Admin Fee)

### 3.1 Tarif per sub-kategori (2026)

| Tarif | Contoh produk (dari cuplikan resmi/media) | Tingkat verifikasi |
|---|---|---|
| 10% | Tas duffel, kaos kaki pria/wanita, makanan ringan tertentu, hand sanitizer, inflatable mainan bayi | `resmi_cuplikan` (cuplikan edu/7882 dan media) |
| 9,5% | Keamanan bayi, obat-obatan dan alat kesehatan (OTC, tradisional, medis), permen dan cokelat | `sekunder` |
| 9% | Aksesoris rambut, jam tangan, tas pria dan wanita, aksesoris tas, perawatan diri tertentu, popok | `resmi_cuplikan` (cuplikan edu/7882) |
| 8,25% | Atasan pria dan wanita, mukena, kamar bayi, kesehatan bayi (skincare dan grooming) | `sekunder` |
| 6,75% | Susu formula dan makanan bayi non-vitamin | `sekunder` |
| 6,5% | Vitamin dan suplemen bayi | `sekunder` |
| 5,25% | Elektronik high-end (laptop, HP, tablet) | `sekunder` |
| 4,25% | Logam mulia dan perhiasan berharga | `sekunder` |
| 2,5% | Kategori khusus (e-money, tiket) | `sekunder` |

Tabel di atas diambil dari beberapa sumber yang tidak sepenuhnya cocok. Pemetaan sub-kategori ke tarif tidak boleh dianggap final. **Sumber resmi untuk pemetaan lengkap adalah `seller.shopee.co.id/edu/article/7882` (Rincian Biaya Penjual per Kategori Produk).**

### 3.2 Tarif dasar dan diskon (resmi, cuplikan)

Halaman resmi "Biaya Administrasi Penjual Star dan Star+" (`seller.shopee.co.id/edu/article/2037`) menyatakan:
- Tarif final = (Harga asli produk − Diskon produk dan/atau voucher ditanggung penjual) × {10,00% / 9,50% / 9,00% / 8,25% / 6,75% / 6,50% / 5,25% / 4,25% / 2,50%} sesuai kategori.
- Tarif tersebut **20% lebih rendah dari tarif dasar 12,50%**.
- Tidak ada batas maksimal per kuantitas produk.
- Tidak dikenakan pada ongkir, diskon produk, atau voucher yang ditanggung penjual.
- Dipotong otomatis saat dana dilepas ke saldo.
- Belum termasuk biaya proses pesanan dan biaya program yang diikuti.

Implikasi: model rule sebaiknya menyimpan `persen_dasar` dan `diskon_persen` agar perubahan kebijakan bisa dilacak. Nilai final dihitung sebagai `persen_dasar × (1 − diskon_persen)`. Ini cocok dengan pola perubahan kebijakan Shopee.

### 3.3 Non-Star dan Star/Star+

- Media 2026 (Metro TV, dikutip dari Shopee Indonesia) menyatakan tarif yang sama untuk Non-Star, Star, dan Star+. Sumber lain juga menyebut hal serupa. **Seed memakai tarif yang sama untuk ketiganya**, tetapi kolom `status_toko` tetap disediakan.
- **Penjual Non-Star** dikenai biaya admin setelah memenuhi syarat tertentu. Sumber resmi 2025 yang dikutip media menyebut: 50 pesanan terselesaikan, atau 6 bulan sejak upload produk pertama untuk toko yang dibuka mulai 3 November 2025. Sumber lain menyebut 100 pesanan. **Status: `belum`, konflik.**
- **Star/Star+ yang tidak lagi tergabung** dan telah mencapai minimal 50 pesanan terselesaikan dikenai tarif Non-Star, mulai hari Selasa pukul 00.00 WIB (sumber 2025). Kriteria ini perlu dicek ulang.

### 3.4 Shopee Mall

- Tarif admin Mall berbeda: sekitar 2,5% sampai 11,7% menurut media, dengan biaya promosi Mall tambahan sekitar 1,8% dengan batas Rp20.000 per produk (sumber 2024). **Status: `belum`.**
- Di luar cakupan seed v1 karena preset Anda hanya memakai status Non Star, Star, dan Star+. Skema tetap disiapkan.

---

## 4. Gratis Ongkir XTRA (Program Opsional)

### 4.1 Rumus dan plafon (resmi)

Sumber: `help.shopee.co.id/portal/4/article/71196`, bagian II poin 5 dan 6.

```
Biaya Layanan GO XTRA = (Harga original produk − total diskon/voucher yang disediakan peserta program) × persentase kategori
Plafon = Rp40.000 per kuantitas produk (ukuran biasa), Rp60.000 per kuantitas produk (ukuran khusus)
```

- Biaya dikenakan **untuk setiap transaksi berhasil**, baik pembeli memakai Gratis Ongkir maupun tidak. Syarat: penjual peserta program dan pesanan memakai jasa kirim yang diaktifkan.
- Biaya ini **di luar** biaya administrasi.
- Shopee dapat mengubah plafon sewaktu-waktu dengan pemberitahuan.

### 4.2 Kuota gratis untuk penjual baru (resmi)

Sumber: poin 5 catatan syarat dan ketentuan.
- Penjual yang bergabung sebelum 1 Agustus 2026: biaya layanan Rp0 untuk **500 pesanan pertama** terselesaikan, dihitung dari bergabung atau 6 bulan sejak upload produk pertama (mana yang lebih dahulu).
- Penjual yang bergabung 1 Mei 2026 sampai 30 Juni 2026: Rp0 untuk **1.000 pesanan pertama**, dalam 1 tahun sejak bergabung atau upload produk pertama.
- Penjual yang upload pertama 1 Februari sampai 31 Juli 2026 harus menyelesaikan misi khusus.

Implikasi: butuh penghitung pesanan kumulatif per preset. Ini disimpan sebagai `syarat.kuota_pesanan_gratis`.

### 4.3 Persentase per kategori (sekunder, konflik)

| Kategori | Ukuran biasa | Ukuran khusus | Tingkat verifikasi |
|---|---|---|---|
| A (fashion, pakaian, tas) | 7,5% | 9,0% | `sekunder` (dua sumber sepakat) |
| E | 6,0% | 7,5% | `sekunder` |
| F | 6,5% sampai 8,0% | — | `sekunder` |
| D | 5,5% (sumber lain menyebut 4% untuk pengguna iklan) | 7,0% | `belum`, konflik |
| B, C | tidak ditemukan | tidak ditemukan | `belum` |

Sumber sebelumnya menyebut "4% kecuali kategori D" dan "0,5% sampai 6%". **Angka tersebut sudah tidak berlaku dan tidak dipakai di seed.** Persentase per kategori 2026 harus dibaca dari halaman edu/24877 melalui Playwright.

### 4.4 Tarif untuk pengguna iklan (belum diverifikasi)

Ada tarif lebih rendah jika penjual memiliki biaya iklan bersih minimal 3% dari total penjualan (berlaku untuk non-Mall sampai 1 Desember 2026, lalu minimal 4%). Cuplikan resmi `seller.shopee.co.id/edu/article/27367` menampilkan angka berpasangan, tetapi kolomnya tidak jelas. **Status: `belum`.** Pola yang saya temukan:
- Tarif iklan 3%: kategori A sekitar 1,00% sampai 0,50%, kategori B sekitar 2,00% sampai 1,50%, kategori D sekitar 5,50% sampai 4,00%, kategori E sekitar 6,00% sampai 4,50%. Kolom yang mana untuk biasa dan khusus belum jelas.
- Tarif iklan 4%: kategori A sekitar 1,50% sampai 1,00%, kategori B sekitar 5,00% sampai 4,50%.

Desain: rule dengan `syarat = {"min_iklan_persen": 3}`. Agar bisa dihitung, dibutuhkan input **biaya iklan harian** dari penjual. Ini perlu keputusan produk.

---

## 5. Program dan Biaya Lain

| Program / biaya | Nilai | Unit | Tingkat | Catatan |
|---|---|---|---|---|
| Biaya proses pesanan | Rp1.250 | per transaksi berhasil | `sekunder` (berlaku sejak 20 Juli 2025) | Per order, bukan per item. Verifikasi di halaman resmi. |
| Pre-order | +3% | per kuantitas (basis belum jelas) | `sekunder` (sejak Januari 2026) | Dikecualikan untuk barang custom dan kerajinan tangan. Basis perlu dipastikan. |
| Promo XTRA | 2% (atau 4–5% tergantung sumber) | dari nilai produk | `belum` | Batas Rp10.000 per produk menurut dua sumber. Konflik. |
| Gratis Ongkir XTRA | lihat §4 | per kuantitas | `resmi` (rumus, plafon) + `sekunder` (persen) | |
| SPayLater Xtra 0% | 2,5% (3 bulan), 4% (6 bulan) | dari penjualan | `sekunder` | Opsional. |
| Asuransi pengiriman | 0,5% | — | `sekunder` | Opsional. |
| Growth Xtra | 2–4% | dari penjualan | `belum` | Disebut satu sumber (Bisnis.com) dan tidak ditemukan di sumber resmi. Mungkin nama lain dari program yang sudah ada. |
| Cashback XTRA | tidak diketahui | — | `belum` | Sumber lama (2022). Perlu dicek apakah masih berlaku. |
| Biaya pembayaran (ShopeePay, transfer, SPayLater) | 1% sampai 1,5% | dari transaksi | `belum` | Hanya dari satu blog. |
| Komisi dinamis 3–8% (plafon Rp650.000, 18 Mei 2026) | — | — | **Bukan Shopee** | Milik TikTok Shop dan Tokopedia. **Dikeluarkan dari seed.** |
| PPh final UMKM | 0,5% | dari omzet | `sekunder` | Dasar regulasi PP 55/2022 (perlu dirujuk). Ini pajak penjual, bukan biaya Shopee. |

---

## 6. Status Toko dan Syarat

- **Non Star**: biaya admin berlaku setelah syarat tertentu (lihat §3.3). Status 2026 `belum`.
- **Star / Star+**: kriteria performa mengacu pada Kesehatan Toko (Sangat Baik, Baik, Perlu Ditingkatkan, Buruk). Metrik utama: tingkat pesanan tidak terselesaikan (target 20% atau 10% untuk toko di bawah 100 pesanan dalam 30 hari), tingkat keterlambatan pengiriman, respons chat dalam 12 jam, dan penilaian. Angka kriteria Star dari sumber sekunder bervariasi (rating 4,5, respons chat 70% sampai 80%). **Tidak dipakai di seed. Status: `belum`.**
- Karena status bisa berubah otomatis, preset perlu `status_berlaku_sejak`. Preset tidak boleh hanya memiliki status statis.

---

## 7. Konflik Sumber yang Tercatat

| Topik | Nilai A | Nilai B | Keputusan seed |
|---|---|---|---|
| Kategori A admin | 8% (2025, Non-Star) | 10% (2026) | Pakai 2026 (10%). Tandai `sekunder`. |
| Non-Star 2025 | 8,0 / 7,5 / 5,75 / 4,25 / 2,5 | 2026: 10 / 9,5 / 9 / ... | Tidak dipakai (historis). Disimpan untuk riwayat. |
| Ambang Non-Star | 50 pesanan atau 6 bulan (resmi 2025 via media) | 100 pesanan (media lain) | `belum`. Dibiarkan kosong sampai diverifikasi. |
| GO XTRA kategori D | 5,5% | 4% (pengguna iklan) | `belum`. |
| GO XTRA umum | 4% kecuali D | 7,5% (A) dan lainnya | Pakai tarif per kategori 2026, bukan 4%. |
| Komisi dinamis | disebut sebagai komisi Shopee | milik TikTok/Tokopedia | Pakai sumber asli: bukan Shopee. |
| Kategori Mall | A–G | A–E | `belum`. |

---

## 8. Daftar Verifikasi untuk Agent Riset

Gunakan Playwright untuk merender halaman `seller.shopee.co.id/edu/*` dan simpan hasilnya di `docs/riset-shopee/render/`.

Prioritas:
1. `seller.shopee.co.id/edu/article/7882` — pemetaan lengkap sub-kategori ke tarif admin. **Ini menentukan kualitas seluruh seed.**
2. `seller.shopee.co.id/edu/article/24877` — persentase GO XTRA per kategori dan ukuran (biasa dan khusus).
3. `seller.shopee.co.id/edu/article/2037` — tarif Star/Star+ dan teks lengkap syarat.
4. `seller.shopee.co.id/edu/article/27367` — tarif pengguna iklan (kolom biasa dan khusus, syarat 3% dan 4%).
5. `seller.shopee.co.id/edu/article/6922` — kriteria GO XTRA dan nilai manfaat biaya kirim.
6. Halaman resmi biaya proses pesanan, pre-order, promo XTRA, dan SPayLater Xtra.
7. Halaman resmi kriteria Non-Star dan Star, termasuk ambang pesanan.

Untuk setiap angka hasil riset, simpan:
- URL, tanggal akses, kutipan singkat (maks. 15 kata per sumber), dan `verifikasi`.
- Nilai yang tidak ditemukan dibiarkan `null`. **Jangan menebak.**

---

## 9. Implikasi untuk Desain

1. **Kategori internal = kategori Shopee (jalur sub-kategori).** Setiap produk menyimpan path lengkap (misalnya `Fashion > Tas Wanita > Aksesoris Tas`). Lookup tarif memakai path ke tabel `kategori_tarif`. Tabel ini perlu diisi dari edu/7882.
2. **Tarif admin disimpan per tier persen** (10, 9,5, 9, 8,25, 6,75, 6,5, 5,25, 4,25, 2,5). Tier dapat dinonaktifkan atau diubah dari UI, dan setiap perubahan punya `valid_from`.
3. **GO XTRA memakai tier grup berbeda** (A–F dan ukuran biasa/khusus) dengan plafon per kuantitas.
4. **Dasar perhitungan admin perlu dikoreksi:** rumus resmi memakai (harga asli − diskon penjual − voucher penjual), sedangkan kode saat ini memakai Subtotal Pesanan. Perlu diverifikasi dengan file contoh. Ini mengubah angka admin sedikit.
5. **Syarat rule**: `min_iklan_persen`, `kuota_pesanan_gratis`, `min_pesanan`, dan `status_berlaku_sejak`. Syarat ini menuntut data tambahan dari penjual (biaya iklan harian dan jumlah pesanan kumulatif).
6. **Biaya proses** adalah rule per_order.
7. **Pajak** dan PPN di biaya admin tidak ditambahkan karena sudah termasuk. Semua pajak penjual dikonfigurasi terpisah.

---

## 10. Koreksi terhadap Pesan Sebelumnya

- Saya sebelumnya memasukkan "komisi dinamis 3–8% dengan plafon Rp650.000 per 18 Mei 2026" ke PRD sebagai biaya Shopee. **Itu keliru.** Sumber menyebut skema itu untuk TikTok Shop dan Tokopedia.
- Saya sebelumnya menyebut "Gratis Ongkir XTRA 4% kecuali kategori D". **Itu sudah tidak akurat.** Tarif 2026 bervariasi per kategori dan memiliki plafon.
- Saya sebelumnya menyebut "Growth Xtra 2–4%" sebagai biaya Shopee. **Belum terverifikasi.**
- Saya sebelumnya memakai tarif Non-Star 2025 (8% untuk kategori A) sebagai acuan. **Sudah diganti tarif 2026.**
