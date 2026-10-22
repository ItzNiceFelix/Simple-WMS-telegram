# Patch Notes

## [Unreleased] — analisa: rentang bebas, delta harian, cakupan data, biaya per jenis

**Tanggal:** 2026-10-22
**Commit:** 9f37acf
**Klasifikasi:** fitur analisa + perbaikan bug data-kosong (bukan keamanan)

### Gejala

1. Halaman Analisa sering tampak "tidak ada data" walau D1 berisi. Pada preset baru
   (mis. `hanif_grosir`) halaman menampilkan **skeleton selamanya** — empty state
   "Belum ada data" tak pernah muncul.
2. Memilih periode Detail Produk yang lama tetap menampilkan angka impor terbaru,
   sehingga delta antar periode selalu nol.
3. Grafik per jam kosong pada rentang yang baru berjalan, dan selalu berupa profil
   gabungan — satu hari yang jatuh tak terlihat.
4. Rentang terkunci 7/14/30; "hari ini saja" dan rentang bebas tidak bisa dipilih.
5. Tidak ada delta hari-ke-hari; hanya delta antar-jendela.
6. Komposisi biaya hanya 3 kelompok karena `laba_snapshot.biaya` satu angka.
7. Angka ROAS memakai penyebut hari iklan yang berbeda dari hari laba tanpa
   pemberitahuan.

### Akar masalah

- `app/analisa/page.tsx` memulai `memuat = true`; `muatAnalisa` `return` lebih awal
  saat `tanggal` kosong tanpa mematikan `memuat` → skeleton permanen.
- `performaPerSku` men-`void periode` sehingga `periode = ?` tidak pernah dipakai.
- `orderPerJam` menjumlahkan seluruh hari menjadi satu profil 24 jam.
- `aksi=tren` memaksa `rentang ∈ {14,30}`, sisanya 7.
- Engine laba tidak menyimpan pecahan biaya per jenis.

### Perbaikan

**Data / mesin**
- `migrations/0046_snapshot_biaya_jenis.sql`: kolom `biaya_jenis_json`.
- `hitungLabaPreset`: mengisi pecahan biaya di tempat biaya dihasilkan
  (`admin`, `program:<kode>`, `proses`, `pajak_*`, jenis lain) dan menyimpannya per
  order supaya mode gabung tidak menghitung ulang order lama.
- `performaPerSku`: memakai periode; tanpa periode sah → periode terbaru; preset
  `legacy` tetap terbaca lewat jalur cadangan.
- `orderPerJamPerTanggal`: seri 24 jam per tanggal.
- `cakupanData`: hari snapshot/iklan/performa yang benar-benar ada.
- `trenSkuRentang`: unit per tanggal dari `rincian_json` untuk sparkline.

**Rumus murni (`lib/analisa/tren.ts`)**
- `deltaHarian`, `jumlahBiayaJenis`, `komposisiBiayaJenis` (label kode → teks).
- `delta()` membulatkan selisih 2 desimal — artefak float `1.4499999999999993` tidak
  lagi tampil di UI.

**API**
- `aksi=tren`: `rentang=1|3|7|14|30` atau `dari=` bebas; respons + `deltaHarian`,
  `perJamPerTanggal`, `komposisiJenis`, `cakupan`.
- `aksi=detail-produk`: `tanggalTren` + `ranking[].trenSku`.

**UI**
- Ringkasan: tombol 1/3/7/14/30, dua input tanggal bebas, kartu cakupan data,
  pemilih tanggal untuk grafik per jam, grafik delta harian, komposisi per jenis
  dengan keterangan saat snapshot lama.
- Detail Produk: label periode+pembanding eksplisit, alert kegagalan dengan tombol
  "Coba lagi", kolom sparkline Tren.
- Halaman: skeleton tidak lagi abadi; empty state menyebut nama preset.

### Verifikasi

- D1 remote diekspor ke D1 lokal (13 snapshot, 3.479 order, 239 baris iklan) dan
  seluruh alur diuji di preview lokal: kelima rentang, rentang bebas 13–15,
  pemilih jam per tanggal, sparkline (81/265 SKU), preset kosong.
- `npx tsc --noEmit` bersih; 58/58 berkas uji lulus.

### Catatan

- `ads_harian` masih kosong → `iklanPersen` null dan syarat `min_iklan_bersih_persen`
  dilewati. Blok cakupan data sekarang menyatakan ini, tidak lagi diam.
- Snapshot lama ber-`biaya_jenis_json = '{}'`; perlu impor ulang laba agar pecahan
  per jenis terisi.

## [Unreleased] — fix boot: splash + hilangkan flash "Gagal memuat"

**Tanggal:** 2026-09-15
**Commit:** (diisi saat commit)
**Klasifikasi:** bug boot / race condition (bukan keamanan, bukan data)

### Gejala

Saat Mini App pertama dibuka, muncul sekejap layar error "Gagal memuat ringkasan…
Coba lagi." Lalu halaman memuat ulang sendiri dan berjalan normal.

### Akar masalah

Race antara *dynamic import* data source dan render pertama halaman:

1. `AppShell` render konten saat `statusAuth === "memuat"` (hanya
   `tanpa_telegram` dan `gagal` yang ditangani).
2. Halaman langsung memanggil `useData().getRingkasan()`.
3. Data source real belum dibangun (dynamic import masih jalan) → membuang error
   `"Sumber data sedang dimuat. Coba lagi."`
4. Halaman menangkap error itu dan menampilkan `Alert` "Gagal memuat…".
5. Inisialisasi selesai → status "siap" → halaman refetch → data tampil.

Jadi pesan error itu **bukan** kegagalan nyata, melainkan UI menembak sebelum siap.

### Perbaikan

**Tampilan**
- Komponen baru `components/dashboard/splash-awal.tsx`: splash minimal (ikon + judul
  "Admin Toko" + pesan "Menyiapkan dashboard…" + spinner + tombol "Coba lagi").
- `AppShell` menahan render konten selama `statusAuth === "memuat"` dan menampilkan
  splash. Halaman tidak pernah render sebelum data source siap.
- `LayarAuthError` menerima prop `onCoba`.

**Logika**
- `sumber-data.tsx`: `DataSource` real HANYA dibangun setelah `getSession()`
  berhasil, lalu disimpan di state (`dataReal`). Tidak ada lagi pembungkus
  `tungguAa()` yang membuang error "sedang dimuat".
- Batas waktu inisialisasi **10 detik**: lewat batas → status `gagal` dengan pesan
  "Waktu masuk habis. Periksa koneksi lalu coba lagi." + tombol "Coba lagi".
- `coba()` mengulang inisialisasi tanpa reload halaman.
- Status `gagal` sekarang **hanya** untuk kegagalan auth nyata (401/403/500) atau
  timeout. Error palsu tidak lagi mungkin muncul.
- Mode mock tidak berubah: siap sinkron, tanpa splash, tanpa jaringan.

### Berkas diubah

| Berkas | Perubahan |
|---|---|
| `components/dashboard/splash-awal.tsx` | baru — splash minimal |
| `components/dashboard/app-shell.tsx` | tahan render saat "memuat" |
| `components/dashboard/layar-auth-error.tsx` | prop `onCoba` |
| `lib/dashboard/sumber-data.tsx` | state machine + timeout 10 s + `coba()` |
| `e2e/boot.spec.ts` | baru — 3 test regresi boot (mode mock) |
| `scripts/cek-splash-real.mjs` | baru — uji boot mode real dengan initData tiruan |

### Verifikasi

| Uji | Hasil |
|---|---|
| `npm test` | **72 lulus / 0 gagal** |
| `npx playwright test` (3 viewport, mode mock) | **363 lulus / 9 skip** |
| `npm run typecheck` | bersih |
| `scripts/cek-splash-real.mjs` (mode real, initData tiruan) | **PASS** — splash muncul, `ada_gagal_memuat: false` |

### Catatan

- Bug ini **lolos** dari seluruh suite sebelumnya karena mode mock selalu siap
  sinkron. Celah itu kini ditutup: `cek-splash-real.mjs` menguji jalur mode real
  (splash → sesi → konten) dengan initData tiruan.
- Smoke manual di Telegram nyata tetap wajib sebelum rilis (lihat
  `docs/dashboard-deploy.md` §5).
