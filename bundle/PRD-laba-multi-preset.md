# PRD — Laba Multi-Preset Toko & Biaya Configurable

Repo: `ItzNiceFelix/Simple-WMS-telegram`
Status: DRAFT v1 · Dokumen ini ditujukan untuk agent harness (implementasi bertahap, dengan task ID).

---

## 1. Latar Belakang

Saat ini perhitungan laba ada di dua tempat: `lib/d1/labaShopee.ts` (halaman `/laba`, per tanggal, preset fee global per marketplace) dan `lib/d1/order.ts` → `hitungLaba` (rekap order, fee per baris `FeeJenis`). Kedua mesin memakai definisi omzet dan pajak yang berbeda, dan PPh 0,5% di-hardcode.

Masalah yang harus diselesaikan:
1. Laba terduplikasi di dua modul. Perhitungan laba harus hanya di `/laba`. Modul `/order` hanya untuk stok.
2. Semua biaya hardcoded (PPh, struktur fee). Biaya harus configurable dari UI, seperti preset biaya yang sudah ada di Pengaturan, tetapi lebih lengkap.
3. Satu toko tidak cukup. Pengguna punya beberapa akun seller, dan setiap akun punya status toko dan tarif yang bisa berbeda.
4. Tarif Shopee perlu di-seed dari hasil riset, dan harus bisa disesuaikan ketika Shopee mengubah kebijakan.

## 2. Tujuan dan Non-Tujuan

**Tujuan**
- Satu mesin laba (`/laba`), dengan perhitungan yang sama persis seperti `labaShopee.ts` untuk data order.all, kecuali bagian yang disebut eksplisit di §5.
- Preset toko (akun seller) tanpa batas jumlah. Setiap preset punya nama, status toko, dan daftar biaya sendiri.
- Upload file dilakukan per preset, dengan tag nama preset agar tidak salah akun.
- Biaya bisa ditambah, diubah, dihapus, dan diduplikasi, seperti preset biaya yang sudah ada, tetapi dengan dimensi kategori, status toko, dan tanggal berlaku.
- Seed awal dari riset Shopee, dengan sumber dan status verifikasi yang tercatat.

**Non-Tujuan (v1)**
- Integrasi API Shopee.
- Marketplace selain Shopee (field `marketplace` disiapkan, tetapi hanya `shopee` yang punya seed dan parser).
- Ongkir sebenarnya, biaya layanan pembayaran (SPayLater), dan biaya Shopee Ads per pesanan. Keduanya bisa dimodelkan sebagai biaya manual per tanggal di versi berikutnya.
- Menghapus tabel lama dalam v1. Tabel lama dibiarkan (deprecated) sampai migrasi tervalidasi.

## 3. Glosarium

- **Preset toko**: profil akun seller. Punya `nama` (bebas, misalnya nama akun), `status_toko` (`non_star`, `star`, `star_plus`), dan daftar aturan biaya.
- **Aturan biaya (fee rule)**: satu baris tarif dengan jenis, kategori, status toko (opsional), basis (`persen`/`flat`), nilai, plafon (opsional), dan periode berlaku.
- **Kategori**: kategori Shopee (A–E, Mall, dan lainnya sesuai riset). Dipetakan dari SKU.
- **Snapshot laba**: hasil perhitungan satu file untuk satu preset dan satu tanggal.

## 4. Perilaku yang Dipertahankan (Sama Persis)

Perhitungan tetap mengikuti `labaShopee.ts`:
- Input: file **Order.all** Shopee (sheet `orders`), dibaca di klien dengan SheetJS.
- Pengelompokan per `No. Pesanan`.
- SKU = `Nomor Referensi SKU`, jika kosong `SKU Induk`. Di-uppercase.
- HPP = HPP master per SKU. SKU tidak dikenal → **tolak seluruh order** dengan alasan.
- Retur: `qty = Jumlah − Returned quantity`. Baris retur penuh dilewati tanpa ditolak.
- Omzet order = Σ `Subtotal Pesanan` (lihat pertanyaan terbuka §10.1).
- HPP order = Σ qty × HPP.
- Biaya file: `Voucher Ditanggung Penjual + Diskon Dari Penjual + Paket Diskon (Diskon dari Penjual)`, dijumlahkan per baris.
- Biaya dari aturan: dihitung dari aturan biaya preset (lihat §5.3). Ini menggantikan preset global.
- Laba order = omzet − HPP − biaya.
- Agregat per SKU: biaya dialokasikan proporsional ke subtotal baris, lalu dijumlahkan.
- Batas baris: 10.000 per hitung.

**Perubahan status yang diminta:** status `Perlu Dikirim` ikut dihitung. Lihat §5.1.

## 5. Perubahan Perilaku

### 5.1 Status pesanan yang dihitung

| Status | Dihitung? |
|---|---|
| Perlu Dikirim | **Ya (baru)** |
| Telah dikirim | Ya |
| Sedang dikirim | Ya |
| Selesai | Ya |
| Batal | Tidak |
| Belum Bayar | Tidak |
| Retur penuh (qty bersih 0) | Tidak (dilewati) |

Allowlist: `["perlu dikirim", "telah dikirim", "sedang dikirim", "selesai"]`, dicocokkan dengan `includes` setelah lowercase. Test `allowlist: Batal + Belum Bayar + Perlu Dikirim dibuang` harus diubah: `Perlu Dikirim` sekarang dihitung, sedangkan `Batal` dan `Belum Bayar` tetap dibuang.

### 5.2 Multi-preset dan upload per preset

- Satu hitung = satu file = satu preset. Preset dipilih dari kartu upload, bukan dropdown terpisah.
- Snapshot disimpan per `(preset_id, tanggal)`. Upload ulang di tanggal sama untuk preset yang sama menimpa snapshot itu saja (perilaku REPLACE yang sudah ada, tetapi per preset).
- Preset lain di tanggal yang sama tidak terpengaruh.

### 5.3 Biaya per baris berdasarkan kategori dan status toko

Biaya tidak lagi satu persentase per order. Setiap baris dihitung dengan aturan yang cocok dengan kategori SKU-nya:

```
untuk setiap baris b dalam order:
  subtotal_b = Subtotal Pesanan (baris)
  untuk setiap aturan r yang cocok (jenis, kategori(b), status_toko(preset), tanggal):
    jika r.basis = persen:  fee_r = subtotal_b × r.nilai / 100   (dibatasi r.plafon bila ada, per baris)
    jika r.basis = flat:    fee_r = r.nilai  (per order, dihitung sekali; lihat unit)
biaya_order = Σ fee_r (per baris) + Σ fee_r (per order) + biaya file (voucher/diskon penjual)
```

**Unit aturan:**
- `per_baris`: dihitung per baris, untuk persen atau flat.
- `per_order`: dihitung sekali per order, misalnya biaya proses Rp1.250.

**Pencocokan aturan:**
1. Aturan wajib cocok dengan `jenis`, `tanggal` (dalam `valid_from ≤ tanggal ≤ valid_to`), dan `status_toko` (kosong = berlaku untuk semua status).
2. Kategori: aturan dengan kategori spesifik didahulukan; `*` adalah fallback.
3. Jika beberapa aturan cocok untuk jenis dan kategori yang sama, pilih `priority` tertinggi, lalu `valid_from` terbaru.
4. Jika SKU tidak punya kategori, pakai aturan `*`. Baris tersebut diberi peringatan `tanpa kategori` di hasil, tetapi tidak ditolak.

### 5.4 Pajak configurable

PPh 0,5% tidak lagi hardcoded. Ia adalah aturan `jenis = pajak_pph`, `basis = persen`, dengan `kategori = *`, dan dapat dinonaktifkan. PPN diperlakukan sama dengan `jenis = pajak_ppn`.

## 6. Model Data

### 6.1 Tabel baru (migrasi `0011_multi_preset.sql`)

```sql
CREATE TABLE seller_presets (
  id INTEGER PRIMARY KEY,
  nama TEXT NOT NULL,                      -- nama bebas, mis. nama akun seller
  marketplace TEXT NOT NULL DEFAULT 'shopee',
  status_toko TEXT NOT NULL CHECK (status_toko IN ('non_star','star','star_plus')),
  aktif INTEGER NOT NULL DEFAULT 1,
  dibuat_at INTEGER NOT NULL DEFAULT (unixepoch()),
  diubah_at INTEGER NOT NULL DEFAULT (unixepoch()),
  dihapus_at INTEGER                       -- soft delete bila sudah ada snapshot
);

CREATE TABLE fee_rules (
  id INTEGER PRIMARY KEY,
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id),
  jenis TEXT NOT NULL,                     -- admin, komisi, program, proses, layanan, pajak_pph, pajak_ppn, voucher, iklan, ongkir, lain
  kategori TEXT NOT NULL DEFAULT '*',      -- A..E, Mall, ..., atau '*'
  status_toko TEXT,                        -- NULL = semua status
  basis TEXT NOT NULL CHECK (basis IN ('persen','flat')),
  unit TEXT NOT NULL DEFAULT 'per_baris' CHECK (unit IN ('per_baris','per_order')),
  nilai REAL NOT NULL CHECK (nilai >= 0),
  plafon INTEGER,                          -- Rupiah, opsional
  priority INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT NOT NULL,                -- YYYY-MM-DD (WIB)
  valid_to TEXT,
  aktif INTEGER NOT NULL DEFAULT 1,
  sumber TEXT,                             -- URL/rujukan resmi
  status_verifikasi TEXT NOT NULL DEFAULT 'belum_diverifikasi'
    CHECK (status_verifikasi IN ('terverifikasi','belum_diverifikasi')),
  catatan TEXT,
  dibuat_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_fee_rules_preset ON fee_rules(preset_id, jenis, kategori);

CREATE TABLE laba_snapshot (
  preset_id INTEGER NOT NULL REFERENCES seller_presets(id),
  tanggal TEXT NOT NULL,
  jml_order INTEGER NOT NULL DEFAULT 0,
  jml_baris INTEGER NOT NULL DEFAULT 0,
  omzet INTEGER NOT NULL DEFAULT 0,
  hpp INTEGER NOT NULL DEFAULT 0,
  biaya INTEGER NOT NULL DEFAULT 0,
  laba INTEGER NOT NULL DEFAULT 0,
  tolak_json TEXT NOT NULL DEFAULT '[]',
  rincian_json TEXT NOT NULL DEFAULT '[]',
  peringatan_json TEXT NOT NULL DEFAULT '[]',
  file TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  by TEXT,
  PRIMARY KEY (preset_id, tanggal)
);
```

### 6.2 Perubahan tabel yang ada

- `products`: tambah `kategori_shopee TEXT` (nullable). Diisi dari import data produk Shopee atau input manual.
- `laba_harian` (lama): **tidak dihapus**. Data dimigrasikan ke `laba_snapshot` dengan `preset_id` = preset seed "Shopee Utama". Tabel lama di-drop pada migrasi terpisah setelah verifikasi.
- `mp_fee_presets` (lama): dimigrasikan ke `fee_rules` dengan `kategori = '*'`, `status_toko = NULL`, `valid_from = '1970-01-01'`, `unit = 'per_baris'` untuk persen dan `per_order` untuk flat, `status_verifikasi = 'belum_diverifikasi'`, `sumber = 'migrasi preset lama'`. Tabel lama dibiarkan sampai migrasi tervalidasi.

### 6.3 Bagian yang dihapus dari modul order (stok tetap)

- Kolom template impor `FeeJenis, FeeBasis, FeeNilai, PPh, PPN%` dan logikanya di `app/api/order/route.ts`.
- Aksi rekap yang menghasilkan laba (`rekap`, `pdf` yang memuat laba) dan `hitungLaba`, `alokasiLabaSku`, `porsiSku` di `lib/d1/order.ts`.
- Peringatan `fee per order` pada `preview`.
- Aksi `preset`, `preset-tambah`, `preset-hapus` di `/api/order` (dipindah ke `/api/preset`).
- Kolom laba pada UI order (agen harus mencari dengan `grep -rn "laba\|hitungLaba\|porsiSku\|rekap" app components lib`).

Yang **tetap** di modul order: impor pesanan untuk pengurangan stok, picklist, transisi fulfillment, konfirmasi, dan histori stok.

## 7. Spesifikasi UI

### 7.1 Pengaturan → Preset Toko (owner menulis, admin membaca)

Komponen baru menggantikan `components/dashboard/biaya-mp.tsx`.

- **Daftar preset**: kartu per preset, menampilkan nama, status toko, jumlah aturan, dan status verifikasi (`N terverifikasi / M belum`).
- **Tambah preset**: input nama + pilih status toko. Baru dibuat dengan seed default untuk status yang dipilih (lihat §8).
- **Duplikat preset**: menyalin nama (dengan sufiks ` (salinan)`), status toko, dan seluruh aturan. Tanggal berlaku ikut disalin.
- **Ubah nama**: inline edit.
- **Hapus preset**: konfirmasi dialog. Jika sudah ada snapshot, lakukan soft delete (`dihapus_at`) dan sembunyikan dari `/laba`.
- **Tidak ada batas jumlah preset.**

Di dalam satu preset (drawer atau halaman detail):
- **Toggle status toko**: segmented control `Non Star | Star | Star+`. Mengubah status **tidak** mengubah aturan yang sudah ada. Aturan yang punya `status_toko` spesifik akan diikuti sesuai status yang dipilih.
- **Tabel aturan biaya**: kolom jenis, kategori, status toko, basis, unit, nilai, plafon, berlaku mulai, berlaku sampai, status verifikasi, sumber. Filter per jenis dan kategori.
- **Aksi per aturan**: tambah, ubah, hapus (soft, dengan `aktif = 0` bila ada snapshot), dan nonaktifkan.
- **Reset ke seed**: mengembalikan aturan ke seed riset untuk status toko yang dipilih. Dengan konfirmasi, dan menimpa hanya aturan yang berasal dari seed (`sumber` berawalan `seed:`).
- Validasi: nilai ≥ 0; persen ≤ 100; `valid_to` ≥ `valid_from`; kategori dari daftar yang dikenal atau `*`.

### 7.2 /laba → Upload per preset

- Setiap preset aktif ditampilkan sebagai **kartu upload** dengan:
  - **Tag nama preset** dan status toko di bagian atas kartu, selalu terlihat.
  - Tombol **Pilih file** yang hanya berlaku untuk preset tersebut.
  - Pesan konfirmasi sebelum simpan: `Simpan ke preset "<nama>" tanggal <tgl>?`.
- Alur per kartu: pilih file → hitung (`aksi: "hitung"`) → preview ringkasan → pilih tanggal → simpan (`aksi: "simpan"`).
- Pilihan tanggal default memakai tanggal WIB (`tanggalJakarta`), bukan UTC.
- Riwayat tanggal dapat difilter per preset, dan setiap entri menampilkan nama preset.
- Opsional (v1.1): ringkasan total semua preset untuk tanggal yang sama.
- Jika belum ada preset, tampilkan empty state dengan tautan ke Pengaturan.

## 8. Seed Riset Shopee (Preset Pertama)

Seed dihasilkan oleh **harness riset** (Task R1–R4), bukan ditulis manual. Seed disimpan sebagai `seed/shopee_fees_id.json` dan dimuat oleh Task D2.

Riset harus mencakup, minimal:
- Admin/komisi per kategori (A, B, C, D, E, dan Mall jika berbeda) untuk status Non Star, Star, dan Star+.
- Biaya proses pesanan (Rp1.250 per pesanan selesai, sejak 20 Juli 2025; verifikasi apakah berlaku per order atau per item).
- Komisi dinamis platform (dilaporkan 3–8% dengan plafon Rp650.000, berlaku 18 Mei 2026; sumber sekunder, perlu verifikasi resmi).
- Program opsional: Growth Xtra (2–4%, tergantung kategori), Gratis Ongkir Xtra (dilaporkan 4%, kecuali kategori D), Live Xtra, dan lainnya.
- Biaya pre-order (3% per kuantitas untuk kategori tertentu; ada pengecualian kategori custom, kerajinan, souvenir).
- Asuransi pengiriman (dilaporkan 0,5%).
- Aturan ambang Non Star (dilaporkan: tanpa biaya admin bila kurang dari 50 pesanan; perlu verifikasi tanggal berlaku).
- PPh final UMKM (dilaporkan 0,5% dari omzet; rujukan regulasi perlu dilampirkan).

**Catatan konflik yang sudah diketahui** (harus ditampilkan di laporan riset):
- Kategori A: satu sumber lama menyebut 8%, sumber Januari 2026 menyebut 10%.
- Kategori fee Shopee Mall: sumber menyebut kategori A–G, sumber lain menyebut kategori A–E untuk Non-Star/Star/Star+.
- Komisi dinamis: sumber berita menyebut kenaikan plafon, tanpa rincian tarif resmi.

**Aturan seed:**
1. Hanya sumber resmi yang boleh menghasilkan `status_verifikasi = 'terverifikasi'`: `seller.shopee.co.id` atau halaman bantuan Shopee Seller Center yang dapat diakses.
2. Sumber sekunder (berita, blog, kalkulator) menghasilkan `belum_diverifikasi`, dengan kolom `sumber` berisi URL dan tanggal akses.
3. Nilai yang tidak bisa ditemukan **tidak boleh ditebak**. Tulis `null` dan catat di laporan.
4. Setiap aturan seed diberi `valid_from` sesuai tanggal berlaku resmi. Jika tanggal tidak ditemukan, pakai `2026-01-01` dan beri catatan.
5. Seed harus tetap bisa diubah dari UI (§7.1). Seed hanya nilai awal.

**Format seed (contoh satu baris):**
```json
{
  "jenis": "admin",
  "kategori": "A",
  "status_toko": "non_star",
  "basis": "persen",
  "unit": "per_baris",
  "nilai": 10,
  "plafon": null,
  "valid_from": "2026-01-01",
  "sumber": "seed:https://seller.shopee.co.id/... (diakses 2026-10-09)",
  "status_verifikasi": "belum_diverifikasi",
  "catatan": "Dilaporkan media Desember 2025 sebagai biaya admin Kategori A 2026; belum dicek ke halaman resmi"
}
```

## 9. Rencana Task untuk Agent Harness

Format: `ID — judul` · file utama · kriteria selesai. Task dikerjakan berurutan kecuali disebut paralel. Jalankan `npm test` dan e2e relevan setelah setiap fase.

### Fase 0 — Baseline

**T0.1 — Inventaris laba di modul order dan UI**
- Jalankan: `grep -rn "laba\|hitungLaba\|porsiSku\|alokasiLabaSku\|FeeJenis\|mp_fee_presets\|rekap" app components lib e2e test`
- Hasil: daftar file dan baris yang harus diubah di Fase 4, disimpan di `docs/refactor-laba/inventaris.md`.
- Selesai: daftar lengkap, belum ada perubahan kode.

**T0.2 — Baseline test**
- Jalankan `npm test` dan e2e `order-laba.spec.ts`, `order-picklist.spec.ts`.
- Selesai: catat hasil awal. Kegagalan yang sudah ada didokumentasikan, bukan diperbaiki di fase ini.

### Fase 1 — Riset Seed (harness riset, paralel dengan Fase 2)

**R1 — Kumpulkan sumber resmi**
- Telusuri `seller.shopee.co.id` (halaman biaya, biaya admin, komisi, program, pre-order, biaya proses pesanan, dan Non-Star/Star/Star+).
- Simpan setiap URL, tanggal akses, dan kutipan singkat ke `docs/riset-shopee/sumber.md`.
- Selesai: setiap topik di §8 punya minimal satu sumber, atau ditandai `tidak ditemukan`.

**R2 — Ekstrak ke format seed**
- Hasilkan `seed/shopee_fees_id.json` sesuai format §8.
- Selesai: JSON valid, setiap entri punya `sumber` dan `status_verifikasi`, dan nilai tidak ditebak.

**R3 — Verifikasi silang dan catat konflik**
- Bandingkan dengan sumber sekunder (artikel Desember 2025 hingga Mei 2026).
- Hasilkan `docs/riset-shopee/konflik.md` dengan kolom: topik, nilai A, nilai B, keputusan seed, alasan.
- Selesai: semua konflik di §8 tercatat dengan keputusan.

**R4 — Laporan riset**
- Ringkasan di `docs/riset-shopee/README.md`: apa yang terverifikasi, apa yang belum, dan apa yang perlu ditanyakan ke pemilik produk.
- Selesai: laporan bisa dibaca tanpa membuka file lain.

### Fase 2 — Database

**D1 — Migrasi `0011_multi_preset.sql`**
- Buat tabel `seller_presets`, `fee_rules`, `laba_snapshot` (§6.1).
- Tambah `products.kategori_shopee`.
- Selesai: migrasi lolos di D1 lokal, dan tabel lama tidak berubah.

**D2 — Loader seed dan migrasi data lama**
- Buat preset `Shopee Utama` (`status_toko = non_star`), muat seed R2 sebagai `fee_rules` dengan `sumber` berawalan `seed:`.
- Migrasikan `mp_fee_presets` ke `fee_rules` (§6.2).
- Migrasikan `laba_harian` ke `laba_snapshot` dengan `preset_id` = Shopee Utama.
- Loader **idempotent**: jalankan dua kali tidak menggandakan aturan.
- Selesai: test migrasi memastikan jumlah baris dan total laba tidak berubah.

### Fase 3 — Mesin Laba (pure, tanpa D1)

**E1 — Resolver aturan biaya**
- File: `lib/laba/aturanBiaya.ts`.
- Fungsi `pilihAturan(rules, { jenis, kategori, status_toko, tanggal })` sesuai §5.3 (pencocokan, prioritas, fallback `*`).
- Selesai: unit test untuk: kategori spesifik menang atas `*`, `status_toko` NULL berlaku semua status, periode berlaku, priority, dan plafon.

**E2 — Hitung laba per preset**
- File: `lib/laba/hitungLabaPreset.ts`.
- Fungsi murni: `hitungLabaPreset(rows, { preset, rules, hppResolver, kategoriResolver, tanggal })`.
- Mengikuti §4 (perilaku tetap) dan §5.1–5.4 (perubahan).
- Output: sama dengan `AgregatLaba` lama, ditambah `peringatan[]` (misalnya `tanpa kategori`).
- Selesai: fixture dari test lama (`labaShopee.test.ts`) lulus dengan pengecualian yang diubah sesuai §5.1; test baru untuk `Perlu Dikirim`, `Batal`, `Belum Bayar`, retur parsial, dan pajak configurable.

**E3 — Hapus hardcode**
- Tidak boleh ada angka tarif di kode selain default aman (0). Cari dengan `grep -rn "\* 5\|/ 1000\|1250\|0\.5" lib components app`.
- Selesai: grep bersih untuk tarif; PPh dan biaya proses hanya datang dari `fee_rules`.

### Fase 4 — API

**A1 — `/api/preset` (baru)**
- `GET` daftar preset (termasuk `dihapus_at IS NULL`).
- `POST` `aksi`: `tambah`, `duplikat`, `ubah-nama`, `ubah-status`, `hapus` (soft jika ada snapshot).
- Tulis: hanya owner. Baca: admin.
- Selesai: test untuk setiap aksi, dan duplikat menyalin seluruh aturan dengan `id` baru.

**A2 — `/api/preset/[id]/aturan` (baru)**
- `GET`, `POST` (tambah), `PUT` (ubah), `DELETE` (soft jika ada snapshot).
- `POST aksi: reset-seed` (dengan konfirmasi di UI): hanya mengganti aturan dengan `sumber` berawalan `seed:`.
- Validasi sesuai §7.1.
- Selesai: test validasi, termasuk nilai negatif, persen > 100, dan `valid_to < valid_from`.

**A3 — `/api/laba` (ubah)**
- Parameter baru `presetId` wajib untuk `hitung` dan `simpan`.
- `simpan` memakai `laba_snapshot (preset_id, tanggal)`.
- `GET ?aksi=list&presetId=` dan `GET ?aksi=muat&presetId=&tanggal=`.
- Default tanggal: `tanggalJakarta()` di server bila `tanggal` tidak diberikan.
- Selesai: test bahwa simpan ke preset A tidak mengubah snapshot preset B di tanggal yang sama.

**A4 — Pembersihan `/api/order`**
- Hapus aksi `preset`, `preset-tambah`, `preset-hapus`.
- Hapus kolom fee dan logika laba dari `preview`, `rekap`, `pdf` (§6.3).
- Pastikan impor stok, picklist, transisi, dan konfirmasi tidak berubah.
- Selesai: test order (`order.test.ts`) lulus setelah penyesuaian; tidak ada referensi `hitungLaba` tersisa.

### Fase 5 — UI

**U1 — Komponen Preset Toko di Pengaturan**
- Ganti `components/dashboard/biaya-mp.tsx` dengan komponen baru (misalnya `preset-toko.tsx` dan `editor-preset.tsx`).
- Implementasi §7.1, termasuk toggle status toko dan tabel aturan.
- Selesai: e2e: tambah preset, duplikat, ubah status, tambah aturan, hapus aturan, reset seed.

**U2 — Kartu upload per preset di /laba**
- Ubah `app/laba/page.tsx` dan `components/dashboard/dialog-laba-shopee.tsx`.
- Kartu per preset dengan tag nama dan status toko (§7.2).
- Selesai: e2e: dua preset, upload ke preset kedua, verifikasi snapshot preset pertama tidak berubah.

**U3 — Riwayat per preset**
- Filter dropdown preset di riwayat tanggal.
- Setiap entri menampilkan nama preset.
- Selesai: e2e: filter menampilkan hanya snapshot preset terpilih.

**U4 — Tanggal WIB**
- Hapus `new Date().toISOString().slice(0, 10)` di dialog. Gunakan tanggal WIB dari server atau helper klien `tanggalJakarta`.
- Selesai: unit test helper pada jam 00.00–06.59 WIB menghasilkan tanggal hari itu.

### Fase 6 — Pembersihan dan Dokumentasi

**X1 — Hapus komponen dan kode lama**
- Hapus `biaya-mp.tsx` jika tidak lagi dipakai, dan `labaShopee.ts` jika sudah digantikan `hitungLabaPreset`.
- Drop `laba_harian` dan `mp_fee_presets` hanya setelah migrasi D2 terverifikasi di staging, dengan migrasi terpisah.
- Selesai: `npm test` dan semua e2e hijau.

**X2 — Dokumentasi**
- Perbarui `README.md` (bagian laba dan preset), `docs/` (desain dan operasional), dan catatan migrasi.
- Selesai: README menjelaskan cara menambah preset, status toko, dan menjalankan seed.

## 10. Pertanyaan Terbuka

Keputusan ini perlu dikonfirmasi pemilik produk sebelum Fase 3:

1. **Subtotal double-count.** Kode menjumlahkan `Subtotal Pesanan` per baris. Jika kolom itu berisi total order yang diulang di setiap baris item, omzet pesanan multi-item terhitung berlebih. Verifikasi dengan satu file Order.all asli sebelum E2. Rekomendasi: uji dulu di fixture nyata.
2. **Retur parsial.** Kode mengurangi qty untuk HPP, tetapi tidak mengurangi subtotal. Permintaan "sama persis" dipertahankan dalam PRD ini. Rekomendasi: perbaiki di v1.1 setelah keputusan.
3. **Tanggal snapshot.** Saat ini tanggal dipilih user. Alternatif: mengelompokkan per `Waktu Pesanan Dibuat`. Rekomendasi: tetap pilih tanggal di v1, tambah pengelompokan di v1.1.
4. **Upload ulang.** Saat ini upload ulang menimpa seluruh tanggal untuk preset itu. Rekomendasi: tetap menimpa di v1 (jelas dan sesuai perilaku lama), dan pertimbangkan merge di v1.1.
5. **Sumber kategori.** Kolom kategori dari export data produk Shopee perlu dipastikan nama kolomnya sebelum D1. Jika tidak tersedia, kategori diisi manual di master produk.
6. **Ongkir dan Ads.** Tidak masuk v1, tetapi jenis `ongkir` dan `iklan` sudah disiapkan agar bisa diisi sebagai aturan `per_order` atau nilai manual.

## 11. Kriteria Penerimaan Keseluruhan

- Laba hanya dihitung di `/laba`. Modul order tidak menampilkan laba.
- Tidak ada angka tarif hardcoded di `lib/` dan `components/` (kecuali nilai nol default).
- Owner dapat membuat, menduplikasi, mengganti nama, dan menghapus preset tanpa batas. Setiap preset punya status toko dan daftar aturan biaya sendiri.
- Upload di `/laba` selalu ditujukan ke preset yang tag-nya terlihat di kartu tersebut.
- Snapshot per `(preset_id, tanggal)` tidak saling menimpa antar preset.
- Seed Shopee memiliki sumber dan status verifikasi untuk setiap aturan, serta laporan konflik.
- Hasil perhitungan untuk data order.all yang sama dengan sebelumnya tetap sama, kecuali perubahan status `Perlu Dikirim` dan keputusan dari §10.
- `npm test` dan e2e yang relevan lulus.

## 12. Batasan untuk Agent

- Jangan mengubah logika stok (`stock_moves`, picklist, transisi, konfirmasi).
- Jangan menghapus tabel atau data produksi dalam v1. Penghapusan hanya di X1, dengan migrasi terpisah.
- Jangan menebak tarif. Jika sumber tidak ditemukan, gunakan `null` dan catat.
- Jangan mengubah formula di §4 selain perubahan yang tercantum di §5.
- Setiap perubahan UI harus menjaga pola yang sudah ada: `bolehUbah` untuk owner, pesan Bahasa Indonesia, dan `data-testid` untuk e2e.
