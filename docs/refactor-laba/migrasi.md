# Catatan Migrasi Laba Multi-Preset (X2)

Berlaku sejak commit Fase 0–5 (migrasi `0013_laba_multi_preset.sql`, `0014_kategori_program.sql`).

## 1. Cara menambah preset, status toko, seed
1. Buka **Pengaturan → Preset Toko** (owner).
2. **Tambah**: isi nama + status toko (`Non Star | Star | Star+`) → preset dibuat dengan toggle program default dari katalog.
3. **Kelola**: tombol Kelola → tab Program (toggle aktif + tanggal) → tabel Aturan (tambah/ubah/hapus, filter jenis + verifikasi, badge syarat) → tombol Verifikasi (isi URL resmi) → tombol Reset seed (hanya `sumber LIKE 'seed:%'`, konfirmasi jumlah).
4. **Duplikat**: salin nama + status + seluruh aturan + toggle (id baru).
5. **Ubah status**: segmented control tidak mengubah aturan; aturan `status_toko` spesifik mengikuti status aktif. Isi `status_berlaku_sejak` untuk riwayat.
6. **Hapus**: tanpa snapshot = hapus keras; dengan snapshot = soft delete (`dihapus_at`, sembunyi dari /laba).
7. **Seed awal**: `bundle/seed/shopee_fees_id.json` (v0.1, 23 rules) dimuat via `muatSeed` (idempoten, hanya timpa `seed:`). Verifikasi ulang: `docs/riset-shopee/verifikasi.md` (13 resmi pasca R-R3). Tarif Des 2026 di `docs/riset-shopee/render/go-tarif.json` masuk sebagai rule `valid_from=2026-12-01`.

## 2. Perbedaan rumus v2 vs v1 (wajib dibaca sebelum bandingkan angka lama)
- **Dasar admin resmi**: `Harga Awal − diskon penjual − voucher penjual` per baris (dulu `Subtotal` + biaya file → diskon double-count, lihat `docs/refactor-laba/kolom-order-shopee.md`).
- **Status `Perlu Dikirim` ikut dihitung** (dulu dibuang).
- **PPh 0,5% configurable** dari `fee_rules` (dulu hardcode di order).
- **Snapshot per `(preset_id, tanggal)`**, tidak saling timpa antar preset.
- **Produk belum terpetakan**: peringatan + admin 0, bukan tolak.

## 3. Tabel lama (deprecated, belum di-drop)
- `laba_harian` → `laba_snapshot` (migrasi D2, `preset_id` = Shopee Utama). Drop migrasi terpisah setelah verifikasi staging (X1).
- `mp_fee_presets` → `fee_rules` (kategori `*`, `valid_from 1970-01-01`). Drop menyusul.
- `lib/d1/labaShopee.ts` (hitung lama) tetap untuk baca snapshot lama; hapus setelah cutover UI zweryfikowan.
- `lib/d1/rekapPdf.ts` + test: DIHAPUS (PDF rekap order). `components/dashboard/biaya-mp.tsx`: DIHAPUS (ganti `preset-toko.tsx`).

## 4. Template impor produk (kolom baru, semua opsional)
`Kategori` (path persis `kategori_tarif`) · `Tier Override` (salah satu `tier_admin.tier`, salah = baris ditolak) · `Pre-Order` / `Ukuran Khusus` (`ya/tidak`, case-insensitive). **Kolom kosong = tidak diubah** (tak menimpa master). Kategori tak dikenal = baris tetap diimpor + badge belum terpetakan + peringatan preview.

## 5. Iklan harian
Pengaturan → Kelola preset → Biaya iklan harian: pilih tanggal + rupiah (≥ 0), bisa ubah/hapus. Ringkasan bulanan: total iklan vs omzet `laba_snapshot` + rasio (acuan ambang 3%/4% program pengguna iklan). Tanpa impor Shopee Ads di v1 (K-2).
