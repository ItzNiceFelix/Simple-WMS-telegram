# PRD v2 Addendum — Kategori Shopee, Program Multi-Level, dan Syarat Aturan

Mengganti / melengkapi bagian berikut di `PRD-laba-multi-preset.md`:
- §5.3 (biaya per baris) → §4.3 di sini
- §6.1 (skema D1) → §3 di sini
- §7.1 (UI Pengaturan) → §5 di sini
- §7.3 (baru) UI /stok → §6 di sini
- §8 (seed) → §7 di sini
- §9 (task) → §8 di sini

Bagian lain PRD v1 tetap berlaku (§4 perilaku perhitungan, §5.1 status pesanan, §5.2 multi-preset dan upload per preset, §6.3 pembersihan modul order, §11 kriteria penerimaan, §12 batasan agent).

Sumber fakta: `riset-shopee-seed.md` dan `seed/shopee_fees_id.json`.

---

## 1. Keputusan Desain

| # | Keputusan | Alasan |
|---|---|---|
| D-1 | Kategori internal di template = **path kategori Shopee** (contoh: `Fashion > Tas Wanita > Aksesoris Tas`). | Pemetaan ke tarif Shopee jadi langsung, tidak perlu dua tingkat kategori. Dikonfirmasi pemilik produk. |
| D-2 | Tarif admin ditentukan per **tier persen** (T10, T9_5, T9, T8_25, T6_75, T6_5, T5_25, T4_25, T2_5). Tier diambil dari tabel `kategori_tarif` berdasarkan path. | Tarif Shopee bergantung pada sub-kategori, bukan hanya grup A–E. |
| D-3 | Program Shopee (GO XTRA, Promo XTRA, pre-order, dll.) diperlakukan sebagai **program terpisah** dengan toggle per preset. | Mencegah tabrakan jenis `program` seperti pada v1. |
| D-4 | Setiap aturan punya **syarat** (JSON) yang dievaluasi saat hitung. | Ambang pengguna iklan, kuota pesanan gratis, dan ambang Non-Star. |
| D-5 | Plafon GO XTRA dihitung **per kuantitas produk**, bukan per baris. | Sesuai syarat dan ketentuan resmi: "Rp40.000 per kuantitas produk". |
| D-6 | Biaya proses pesanan adalah aturan `per_order`. | Sesuai sumber. |
| D-7 | Tidak ada PPN tambahan atas biaya Shopee. Pajak penjual (PPh) dikonfigurasi terpisah. | Biaya administrasi sudah termasuk PPN menurut sumber resmi dan media. |
| D-8 | Verifikasi aturan memakai **empat tingkat**: `resmi`, `resmi_cuplikan`, `sekunder`, `belum`. | Lebih akurat daripada dua tingkat v1. |
| D-9 | Komisi dinamis 3–8% **tidak** masuk seed Shopee. | Milik TikTok Shop dan Tokopedia. |

---

## 2. Model Kategori

### 2.1 Alur pemetaan

```
products.kategori (path Shopee, mis. "Fashion > Tas Wanita > Aksesoris Tas")
   │
   ├─ products.tier_override (opsional, per SKU)      ← owner bisa override
   │
   └─ kategori_tarif[path].tier                       ← master pemetaan
          │
          └─ fee_rules (jenis='admin', kategori=tier) → persen
```

Pencarian tarif: `tier_override` (jika ada) → `kategori_tarif` berdasarkan path persis → `kategori_tarif` berdasarkan path induk (prefix terpanjang) → **belum terpetakan**.

Produk belum terpetakan:
- Diberi status `belum_terpetakan` di /stok.
- Saat hitung laba, baris dihitung dengan tier `T_UNKNOWN` dan **diberi peringatan**, bukan ditolak. Peringatan ditampilkan di preview /laba dan dihitung di agregat (`jml_baris_belum_terpetakan`).

### 2.2 Kolom produk di template

Template Excel sudah punya kolom `Kategori`. Mulai v2, nilai kolom tersebut **harus** berupa path Shopee. Validasi impor:
- Path harus ada di `kategori_tarif`, atau ditandai `belum_terpetakan` dengan peringatan (tidak menolak baris).
- Kolom opsional `Tier Override` (dari daftar tier).
- Kolom opsional `Pre-Order` (ya/tidak) dan `Ukuran Khusus` (ya/tidak), keduanya default tidak.

---

## 3. Skema D1 (revisi)

Hanya bagian yang berubah atau baru. Tabel `seller_presets`, `laba_snapshot`, dan `products` tetap seperti v1, dengan tambahan di bawah.

```sql
-- Master pemetaan kategori Shopee → tier admin
CREATE TABLE kategori_tarif (
  kategori_path TEXT PRIMARY KEY,         -- "Fashion > Tas Wanita > Aksesoris Tas"
  tier TEXT NOT NULL,                     -- T10, T9_5, T9, ..., T2_5
  grup_go TEXT,                           -- A..F untuk tarif GO XTRA, NULL bila belum
  sumber TEXT,
  verifikasi TEXT NOT NULL DEFAULT 'belum'
    CHECK (verifikasi IN ('resmi','resmi_cuplikan','sekunder','belum')),
  diubah_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tier admin (satu baris per tier)
CREATE TABLE tier_admin (
  tier TEXT PRIMARY KEY,
  persen_dasar REAL,                      -- mis. 12.5 (dasar resmi), NULL bila tidak ada
  diskon_persen REAL NOT NULL DEFAULT 0,  -- mis. 20 untuk Star/Star+ 2026
  persen_final REAL NOT NULL,             -- disimpan; dihitung ulang bila basis berubah
  verifikasi TEXT NOT NULL DEFAULT 'belum'
);

-- Program opsional (katalog global)
CREATE TABLE program_katalog (
  kode_program TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  opsional INTEGER NOT NULL DEFAULT 1,
  catatan TEXT
);

-- Toggle program per preset
CREATE TABLE preset_program (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id),
  kode_program TEXT NOT NULL REFERENCES program_katalog(kode_program),
  aktif INTEGER NOT NULL DEFAULT 0,
  aktif_sejak TEXT,                       -- YYYY-MM-DD (WIB)
  aktif_sampai TEXT,
  PRIMARY KEY (preset_id, kode_program)
);

-- Biaya iklan harian per preset (untuk syarat pengguna iklan)
CREATE TABLE ads_harian (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id),
  tanggal TEXT NOT NULL,
  biaya_iklan_bersih INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (preset_id, tanggal)
);

-- Penghitung pesanan kumulatif per preset (untuk kuota gratis)
-- Dihitung dari laba_snapshot / import, bukan diisi manual.
CREATE TABLE preset_penghitung (
  preset_id INTEGER PRIMARY KEY REFERENCES seller_presets(id),
  pesanan_selesai_kumulatif INTEGER NOT NULL DEFAULT 0,
  bergabung_sejak TEXT,                   -- YYYY-MM-DD, input owner
  upload_produk_pertama TEXT              -- YYYY-MM-DD, input owner
);

-- Status toko dengan tanggal berlaku
ALTER TABLE seller_presets ADD COLUMN status_berlaku_sejak TEXT;   -- YYYY-MM-DD (WIB)

-- Rule engine (revisi fee_rules)
ALTER TABLE fee_rules ADD COLUMN kode_program TEXT;                  -- NULL untuk admin, pajak, proses
ALTER TABLE fee_rules ADD COLUMN ukuran TEXT;                        -- NULL | 'biasa' | 'khusus'
ALTER TABLE fee_rules ADD COLUMN plafon_per_qty INTEGER;             -- Rupiah per kuantitas produk
ALTER TABLE fee_rules ADD COLUMN syarat_json TEXT;                   -- JSON, NULL = tanpa syarat
ALTER TABLE fee_rules ADD COLUMN verifikasi TEXT NOT NULL DEFAULT 'belum'
  CHECK (verifikasi IN ('resmi','resmi_cuplikan','sekunder','belum'));
-- kolom 'kategori' tetap dipakai sebagai tier (admin) atau grup (program)

-- Produk
ALTER TABLE products ADD COLUMN kategori TEXT;                       -- path Shopee
ALTER TABLE products ADD COLUMN tier_override TEXT;                  -- opsional
ALTER TABLE products ADD COLUMN pre_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN ukuran_khusus INTEGER NOT NULL DEFAULT 0;
```

Catatan migrasi:
- `mp_fee_presets` dan `fee_rules` dari v1 dimigrasikan ke model ini. Data v1 yang `kategori = '*'` tetap berlaku sebagai fallback.
- `programs` dari seed dipetakan ke `program_katalog`. Toggle default dari seed (`default_aktif`) dipakai saat preset baru dibuat.
- `tier_admin` diisi dari `tier` di seed. Nilai `persen_dasar` dan `diskon_persen` belum final, jadi biarkan `NULL` dan `0` sampai verifikasi.

---

## 4. Perhitungan (revisi §5.3 PRD v1)

### 4.1 Dasar perhitungan admin

Rumus resmi (`seller.shopee.co.id/edu/article/2037`):
```
dasar_admin = harga_asli − diskon_produk_penjual − voucher_penjual
```

Kode v1 memakai `Subtotal Pesanan` sebagai dasar persen dan menambahkan diskon/voucher penjual sebagai biaya terpisah. Ini mengurangi selisih kecil. **Versi v2 memakai dasar resmi.** Verifikasi kolom export dulu (lihat §8, T-V1).

### 4.2 Biaya per baris

```
untuk setiap baris b:
  dasar_b  = harga_asli_b − diskon_produk_b − voucher_penjual_b     (kolom export, lihat T-V1)
  tier_b   = products.tier_override ?? kategori_tarif[kategori_b].tier ?? T_UNKNOWN
  persen_b = tier_admin[tier_b].persen_final   (berlaku pada tanggal pesanan + status preset)

  biaya_admin_b = dasar_b × persen_b / 100                         (tanpa plafon)

  untuk setiap program p aktif di preset pada tanggal pesanan:
     jika syarat_p terpenuhi:
        biaya_p_b = min(dasar_b × persen_p / 100, plafon_per_qty_p × qty_b)   bila plafon ada
                    (untuk GO XTRA: pilih tarif sesuai grup_go dan ukuran_khusus)
```

### 4.3 Biaya per order

```
biaya_proses = Σ aturan per_order yang aktif (Rp1.250)
```

### 4.4 Evaluasi syarat

`syarat_json` dievaluasi terhadap konteks preset dan tanggal:

| Kunci | Arti | Sumber data |
|---|---|---|
| `min_iklan_bersih_persen` | biaya iklan bersih ÷ total penjualan ≥ nilai (tanggal atau bulan) | `ads_harian` |
| `kuota_pesanan_gratis` | pesanan kumulatif ≤ kuota | `preset_penghitung` |
| `bergabung_sebelum` / `bergabung_antara` | tanggal bergabung preset | `preset_penghitung.bergabung_sejak` |
| `min_pesanan_terselesaikan` | jumlah pesanan kumulatif ≥ nilai | `preset_penghitung` |
| `atau_bulan_sejak_upload_pertama` | bulan sejak upload pertama | `preset_penghitung.upload_produk_pertama` |
| `tenor_bulan` | untuk SPayLater | input per preset |
| `kecuali_kategori` | dikecualikan dari pre-order | `products.kategori` |

Jika syarat tidak dapat dievaluasi (data belum ada), aturan **tidak diterapkan** dan preview menampilkan peringatan `syarat tidak dapat dihitung: <kunci>`. Tidak boleh diasumsikan terpenuhi.

### 4.5 Pemilihan tier dan status

- `status_toko` preset menentukan rule admin jika rule memiliki `status_toko` spesifik. Jika `NULL`, berlaku untuk semua status.
- Rule dipilih menurut `valid_from ≤ tanggal_order ≤ valid_to` dan `priority` tertinggi.
- Perubahan status preset memakai `status_berlaku_sejak`. Order sebelum tanggal tersebut memakai status sebelumnya. Ini menyimpan riwayat status per preset dengan satu baris per perubahan (tabel `preset_status_riwayat`, opsional di v1.1; di v1 cukup satu tanggal).

### 4.6 Laba

```
laba_baris = dasar_b − Σ biaya_admin_b − Σ biaya_program_b − hpp_b − pajak_b
laba_order = Σ laba_baris − biaya_proses
```

Retur, status pesanan, dan kolom tanggal tetap mengikuti PRD v1 (§4, §5.1).

---

## 5. UI Pengaturan — Preset Toko (revisi §7.1)

Tambahan dibanding v1:

**a. Toggle program per preset.** Setiap program di `program_katalog` tampil sebagai grup dengan:
- Switch aktif/nonaktif (menulis `preset_program.aktif`).
- Tanggal aktif sejak dan sampai (opsional).
- Matriks **Kategori × Status toko** untuk aturan program. Setiap sel menampilkan persen dan plafon, dapat diubah.
- Dua mode: `Tabel` (default) dan `Ringkas` (hanya grup).

**b. Ukuran biasa dan khusus.** Untuk GO XTRA, matriks dibagi dua: biasa dan khusus.

**c. Syarat.** Setiap aturan yang punya `syarat_json` menampilkan badge syarat dan tooltip. Form syarat memakai kunci dari §4.4 saja. Tidak ada input JSON bebas.

**d. Status verifikasi.** Setiap aturan menampilkan badge: `Resmi` (hijau), `Cuplikan resmi` (biru), `Sekunder` (kuning), `Belum` (merah). Ada filter per status verifikasi dan tombol "Tandai terverifikasi" (owner, dengan kolom sumber wajib diisi).

**e. Reset seed.** Hanya mengganti aturan dengan `sumber` berawalan `seed:`. Konfirmasi wajib menampilkan jumlah aturan yang akan berubah.

**f. Biaya iklan harian.** Halaman kecil untuk input atau impor `ads_harian` per preset. Dibutuhkan jika ada program dengan syarat iklan.

**g. Penghitung pesanan.** Input `bergabung_sejak` dan `upload_produk_pertama` per preset (owner). `pesanan_selesai_kumulatif` dihitung otomatis dari hasil impor.

---

## 6. UI /stok — Kategori (baru, U5)

Permintaan pemilik: kategori harus tampil di /stok agar owner tahu produk mana yang belum punya kategori untuk pemetaan biaya Shopee.

- **Kolom Kategori** di listing produk (path Shopee, dapat dipotong tampilannya dengan tooltip untuk path panjang).
- **Badge** `Belum terpetakan` (kuning) bila path tidak ada di `kategori_tarif` dan tidak ada `tier_override`. Badge `Kosong` (merah) bila kolom kategori kosong.
- **Filter** di atas tabel: `Semua`, `Belum terpetakan`, `Kategori kosong`, dan dropdown per grup Shopee.
- **Ringkasan** di kartu atas: jumlah produk belum terpetakan dan link ke daftar tersebut.
- **Edit cepat** kategori dari baris (dropdown dari `kategori_tarif`). Hanya owner.
- Filter dan badge juga berlaku di halaman stok per gudang. Jika /stok memakai komponen tabel bersama, tambahkan kolom di komponen itu, bukan di halaman.

---

## 7. Seed (revisi §8 PRD v1)

- Seed resmi ada di `seed/shopee_fees_id.json` (23 aturan, 4 tingkat verifikasi).
- Komisi dinamis 3–8% **dihapus** dari seed dan dari PRD. Lihat riset §10.
- Tarif GO XTRA 2026 menggunakan sumber sekunder. Plafon menggunakan sumber resmi.
- Entri `belum` dan `nonaktif` tidak boleh diaktifkan sampai diverifikasi.
- Agent riset memverifikasi ulang seluruh entri `sekunder` dan `belum` menggunakan Playwright pada halaman `seller.shopee.co.id/edu/*` (lihat riset §8).

---

## 8. Task Tambahan dan Revisi untuk Agent Harness

Task v1 yang tetap: T0.1, T0.2, D1 (direvisi), D2 (direvisi), E1–E3 (direvisi), A1–A4, U1–U4, X1–X2. Task berikut ditambahkan atau diubah.

### Fase 0 — Verifikasi data nyata (wajib sebelum E2)

**T-V1 — Verifikasi kolom export Order.all**
- Sumber: data contoh di Cloudflare D1 (diakses via `wrangler d1 execute --remote`). Tidak perlu meminta file dari user.
- Cek:
  - Apakah `Subtotal Pesanan` sudah dikurangi diskon penjual atau belum.
  - Apakah `Subtotal Pesanan` berulang di setiap baris item (berdampak ke omzet dobel).
  - Apakah ada kolom `Harga Awal`, `Diskon Produk`, `Voucher Ditanggung Penjual`, dan `Harga Setelah Diskon` yang konsisten.
  - Nama kolom persis untuk tiap nilai di §4.2.
- Output: `docs/refactor-laba/kolom-order-shopee.md`.
- Selesai: setiap kolom yang dipakai memiliki contoh nilai dari data nyata.

**T-V2 — Inventaris kategori di D1**
- `SELECT kategori, COUNT(*) FROM products GROUP BY kategori;`
- Hitung produk yang kategorinya cocok dengan path Shopee dan yang tidak.
- Output: daftar kategori internal yang perlu dipetakan ke path Shopee, disimpan di `docs/refactor-laba/kategori-inventaris.md`.

### Fase 1 — Riset (lanjutan)

**R-R1 — Render halaman Seller Education dengan Playwright**
- Render `seller.shopee.co.id/edu/article/7882`, `24877`, `2037`, `27367`, `6922`.
- Simpan HTML dan teks ke `docs/riset-shopee/render/`.
- Selesai: setiap halaman terbaca penuh, atau dicatat sebagai gagal dengan alasan.

**R-R2 — Lengkapi `kategori_tarif`**
- Dari hasil R-R1, isi pemetaan path → tier untuk seluruh sub-kategori di 7882.
- Isi `grup_go` dari 24877.
- Selesai: pemetaan lengkap, setiap baris punya sumber dan verifikasi.

**R-R3 — Verifikasi entri `sekunder` dan `belum`**
- Untuk setiap entri di seed, cari sumber resmi. Naikkan verifikasi bila ditemukan. Jika tidak, biarkan dan catat.
- Selesai: laporan jumlah entri per tingkat verifikasi.

### Fase 2 — Database (revisi)

**D-R1 — Migrasi `0012_kategori_program.sql`**
- Buat tabel `kategori_tarif`, `tier_admin`, `program_katalog`, `preset_program`, `ads_harian`, `preset_penghitung`.
- Tambah kolom di `fee_rules`, `seller_presets`, dan `products` sesuai §3.
- Selesai: migrasi lolos di D1 lokal.

**D-R2 — Loader seed v0.1**
- Muat `seed/shopee_fees_id.json` ke `tier_admin`, `program_katalog`, `kategori_tarif` (dari `kategori_tarif_contoh` dan R-R2), dan `fee_rules`.
- Idempotent. Hanya menimpa aturan dengan `sumber` berawalan `seed:`.
- Selesai: test loader lulus dua kali berturut-turut tanpa duplikasi.

**D-R3 — Migrasi data v1**
- Pindahkan `fee_rules` v1 ke model v2 dengan `kode_program = NULL` untuk preset lama dan `verifikasi = 'belum'`.
- Selesai: total laba historis sama sebelum dan sesudah migrasi untuk data uji.

### Fase 3 — Mesin Laba (revisi)

**E-R1 — Resolver tier dan kategori**
- Fungsi `resolveTier(sku, kategori, overrideTier, tabelKategori)` dengan urutan dari §2.1.
- Selesai: unit test untuk: override menang, path persis, prefix terpanjang, dan belum terpetakan.

**E-R2 — Evaluasi syarat**
- Modul `lib/laba/syarat.ts` dengan fungsi per kunci di §4.4.
- Jika data tidak tersedia, hasilnya `tidak_dapat_dihitung`, bukan `true`.
- Selesai: unit test untuk setiap kunci, termasuk kasus data kosong.

**E-R3 — Perhitungan admin dan program**
- Ubah `hitungLabaPreset` sesuai §4.1–4.3 dan §4.6.
- Plafon per kuantitas produk: `min(persen × dasar, plafon × qty)`.
- Biaya proses sebagai aturan per order (tidak ditambahkan per baris).
- PPh tetap dari `fee_rules` jenis `pajak_pph`.
- Selesai: fixture dengan tiga kategori berbeda, satu order multi-item, satu retur parsial, satu produk belum terpetakan, dan dua program aktif. Hasil cocok dengan perhitungan manual.

### Fase 4 — API (revisi)

**A-R1 — `/api/preset/[id]/program`**
- `GET` daftar program dan toggle. `POST aksi: toggle | set-aktif-sejak | set-aturan`.
- Owner menulis, admin membaca.
- Selesai: test toggle dan perubahan matriks.

**A-R2 — `/api/ads`**
- `POST` impor atau input `ads_harian` per preset. Validasi angka ≥ 0.
- Selesai: test impor dan validasi.

**A-R3 — `/api/produk/kategori`**
- `PATCH` kategori dan `tier_override` per SKU. Validasi path terhadap `kategori_tarif`.
- `GET ?belum_terpetakan=1` untuk filter /stok.
- Selesai: test validasi dan filter.

### Fase 5 — UI (revisi dan tambahan)

**U-R1 — Matriks program di Pengaturan**
- Implementasi §5 (a–g).
- Selesai: e2e: aktifkan GO XTRA, ubah tarif kategori A, tandai terverifikasi, lalu verifikasi tarif tersimpan.

**U5 — Kolom kategori dan filter di /stok (baru)**
- Implementasi §6.
- Selesai: e2e: produk tanpa kategori tampil dengan badge merah; filter `Belum terpetakan` menampilkan hanya produk yang sesuai; edit cepat mengubah badge.

### Fase 6 — Pembersihan (tambahan)

**X-R1 — Hapus komponen tarif hardcoded yang tersisa**
- Grep untuk `* 5 / 1000`, `1250`, dan `0.5` di `lib/` dan `components/`.
- Selesai: hanya nilai default nol yang tersisa.

---

## 9. Pertanyaan Terbuka (diperbarui; nomor 2–5 sudah dijawab, lihat §11)

1. **Dasar admin**: apakah `Subtotal Pesanan` sudah dikurangi diskon penjual? (T-V1.) Keputusan ini memengaruhi seluruh angka admin.
2. **Pre-order**: dari mana flag pre-order diambil? Export Order.all atau input manual di master produk? Usulan: input manual di master produk untuk v1.
3. **Ukuran khusus**: sumbernya dari mana? Usulan: input manual di master produk, karena export tidak menyediakan.
4. **Biaya iklan harian**: apakah pemilik ingin mengimpor dari laporan Shopee Ads atau input manual? Dibutuhkan untuk program pengguna iklan.
5. **Mall**: apakah tetap di luar cakupan v1?
6. **Retur parsial** (dari v1, §10.2): tetap dipertahankan sesuai permintaan, atau diperbaiki di v1.1?
7. **Tanggal snapshot** (dari v1, §10.3): tetap pilih tanggal, atau kelompokkan per `Waktu Pesanan Dibuat`?

---

## 10. Batasan Tambahan untuk Agent

- Jangan mengisi `persen_dasar` atau `diskon_persen` tanpa sumber resmi. Biarkan `NULL`.
- Jangan mengaktifkan aturan `verifikasi = 'belum'` secara default.
- Jangan memasukkan komisi dinamis atau tarif TikTok/Tokopedia ke seed Shopee.
- Jangan menebak pemetaan kategori. Jika tidak ada di `kategori_tarif`, tandai `belum_terpetakan`.
- Jangan menerapkan syarat yang datanya tidak tersedia. Tampilkan peringatan.

---

## 11. Keputusan Lanjutan (9 Oktober 2026)

Keputusan ini menggantikan pertanyaan terbuka 2–5 di §9.

| # | Topik | Keputusan |
|---|---|---|
| K-1 | Pre-order dan ukuran khusus | Diisi dari **master produk**, bukan dari export. Owner input manual di UI, atau impor dengan template. |
| K-2 | Biaya iklan harian | **Input manual** di UI. Tanpa impor laporan Shopee Ads di v1. |
| K-3 | Shopee Mall | **Di luar cakupan.** Tidak ada seed, tidak ada UI Mall di v1. Schema tetap menerima status Mall di masa depan. |

Keputusan lain yang masih berlaku dari §9: kategori dari master produk, tier admin dari `kategori_tarif`, dan tier override per SKU.

### 11.1 Master produk (perubahan dari §2 dan §6)

Setiap produk di master punya field berikut yang bisa diubah owner:
- `kategori` (path Shopee, pilih dari daftar `kategori_tarif`).
- `tier_override` (opsional, pilih dari `tier_admin`). Hanya dipakai bila pemetaan kategori tidak sesuai.
- `pre_order` (ya/tidak). Default tidak.
- `ukuran_khusus` (ya/tidak). Default tidak.

**UI master produk:**
- Form edit per SKU menampilkan keempat field di atas.
- Aksi massal (pilih beberapa SKU, lalu set kategori, pre-order, atau ukuran khusus).
- Filter `Belum terpetakan`, `Kategori kosong`, `Pre-order`, dan `Ukuran khusus`.
- Kolom kategori dan badge di /stok sesuai §6 PRD v2.

**Template Excel (opsional, tambahan):**

Kolom baru di template produk. Semua opsional. Kolom kosong berarti nilai default.

| Kolom | Isi | Default |
|---|---|---|
| `Kategori` | path Shopee persis seperti di `kategori_tarif` | kosong (tandai belum terpetakan) |
| `Tier Override` | salah satu nilai `tier_admin.tier` | kosong |
| `Pre-Order` | `ya` / `tidak` | `tidak` |
| `Ukuran Khusus` | `ya` / `tidak` | `tidak` |

Validasi impor:
- `Kategori` harus ada di `kategori_tarif`. Jika tidak, baris tetap diimpor dengan badge belum terpetakan dan peringatan di preview.
- `Tier Override` harus ada di `tier_admin`. Jika tidak, baris ditolak dengan pesan jelas.
- `Pre-Order` dan `Ukuran Khusus` hanya menerima `ya` atau `tidak` (tidak case sensitive).
- Impor tidak menimpa field yang kolomnya kosong. Kolom kosong berarti tidak diubah. Ini penting agar impor stok tidak menghapus kategori yang sudah diisi.

### 11.2 Input biaya iklan harian (perubahan dari §5 f)

- Halaman kecil di Pengaturan atau di /laba, per preset.
- Form: pilih tanggal, isi biaya iklan bersih (Rupiah, ≥ 0). Bisa diubah dan dihapus.
- Ada tampilan ringkas: total penjualan dari `laba_snapshot` dan total biaya iklan per bulan, supaya owner bisa melihat rasio terhadap ambang 3% atau 4%.
- Tanpa impor dari laporan Shopee Ads di v1.
- Jika tanggal tidak ada datanya, syarat pengguna iklan tidak dapat dihitung dan preview menampilkan peringatan (sesuai §4.4).

### 11.3 Perubahan task

Tambahan atau penyesuaian pada §8:

**U-M1 — Form master produk: kategori, tier override, pre-order, ukuran khusus**
- Implementasi §11.1 (UI).
- Selesai: e2e: ubah pre-order satu SKU, lalu cek preview hitung laba memakai biaya pre-order.

**U-M2 — Aksi massal master produk**
- Pilih banyak SKU, set kategori, pre-order, atau ukuran khusus sekaligus.
- Selesai: e2e: 3 SKU diset ke kategori yang sama dan hasilnya tampil di /stok.

**U-M3 — Template produk dengan kolom opsional**
- Tambahkan kolom `Kategori`, `Tier Override`, `Pre-Order`, dan `Ukuran Khusus` ke template produk.
- Validasi dan aturan tidak menimpa kolom kosong (§11.1).
- Selesai: unit test impor dengan kolom kosong (tidak mengubah data lama), kategori tidak valid (baris diimpor dengan badge), dan tier override tidak valid (baris ditolak).

**U-M4 — Input biaya iklan harian**
- Implementasi §11.2.
- Selesai: e2e: input biaya iklan tiga hari, lalu ringkasan bulanan menampilkan total yang benar.

**A-M1 — API produk**
- Perluas `/api/produk/kategori` (A-R3) menjadi `PATCH /api/produk/:sku` untuk field pre-order dan ukuran khusus, serta `POST /api/produk/massal` untuk aksi massal.
- Selesai: test validasi dan aksi massal.

**A-M2 — API iklan harian**
- Sudah ada sebagai A-R2. Tambahkan `GET ?bulan=YYYY-MM` untuk ringkasan bulanan.
- Selesai: test ringkasan.

### 11.4 Batasan

- Jangan menambahkan impor laporan Shopee Ads di v1.
- Jangan menambahkan seed atau UI untuk Shopee Mall di v1.
- Impor template tidak boleh menghapus kategori, pre-order, atau ukuran khusus yang sudah diisi jika kolomnya kosong.
