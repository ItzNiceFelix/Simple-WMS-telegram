# Bundle Handover — Laba Multi-Preset Shopee

Urutan membaca untuk agent harness:

1. PRD-laba-multi-preset.md — PRD v1: tujuan, perilaku perhitungan yang dipertahankan, skema awal, daftar task fase 0–6.
2. PRD-v2-addendum.md — PRIORITAS: menggantikan bagian terkait di v1 (§5.3, §6.1, §7.1, §8, §9). Berisi model kategori Shopee, program multi-level dengan toggle, syarat aturan, perhitungan admin dan GO XTRA, UI /stok, master produk, input iklan manual, dan task tambahan. Keputusan final ada di §11.
3. riset-shopee-seed.md — laporan riset tarif Shopee 2026, tingkat verifikasi, konflik sumber, daftar verifikasi.
4. seed/shopee_fees_id.json — seed aturan awal (23 aturan, 4 tingkat verifikasi). Dimuat oleh task D-R2.

Keputusan yang sudah final:
- Kategori internal = path kategori Shopee. Tier admin lewat tabel kategori_tarif.
- Pre-order dan ukuran khusus diisi dari master produk (UI + template opsional).
- Biaya iklan harian input manual.
- Shopee Mall di luar cakupan v1.
- Komisi dinamis 3–8% BUKAN Shopee (TikTok/Tokopedia), tidak masuk seed.
- Biaya admin sudah termasuk PPN; tidak ada PPN tambahan atas biaya Shopee.

Pertanyaan yang diverifikasi agent dari D1 (bukan dari user):
- Apakah Subtotal Pesanan sudah dikurangi diskon penjual (T-V1).
- Apakah Subtotal Pesanan berulang per baris item.
- Nilai dan nama kolom persis.

Keterbatasan riset:
- Halaman seller.shopee.co.id/edu/* dirender JavaScript; agent perlu Playwright untuk membacanya (R-R1).
- Banyak angka masih sekunder atau belum; jangan diaktifkan sebelum diverifikasi.
