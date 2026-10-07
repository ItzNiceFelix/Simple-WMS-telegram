# Audit Efisiensi E2E Playwright

Tanggal: 2026-09-17
Auditor: test engineer independen
Repo: Bot-Admin-Toko
Aturan: tidak ada file produksi/test yang diubah. Hanya file ini dibuat.

Basis pengukuran (dijalankan nyata, build mock yang sudah ada, `.next/BUILD_ID` = b6nTF93P5vUlaF8ZeguwL):

| Skenario | Test | Hasil | Wall time |
|---|---|---|---|
| `--project=desktop` | 205 | 199 pass, 6 skip | 226 s (3,8 mnt) |
| `--project=mobile` | 205 | 203 pass, 2 skip | 204 s (3,4 mnt) |
| full (3 project) | 615 | 601 pass, 14 skip | 617 s (10,3 mnt) |

Rata-rata ~1,1 s/test desktop. Full run = 3x per-test karena setiap spec dijalankan ulang di 3 project.

---

## 1. Kondisi awal

`playwright.config.ts`:
- 3 project: `mobile` 360x640, `tablet` 768x1024, `desktop` 1280x800.
- `fullyParallel: true`, `workers: undefined` (default CPU lokal), `retries: 0` lokal / 1 CI.
- `reporter: [list, html]`.
- `expect.timeout: 15s`, `timeout: 60s`.
- 19 spec, 205 test unik, x3 project = 615 test per run.
- Mode selalu mock (`NEXT_PUBLIC_DASHBOARD_DATA=mock`, delay 0).

Temuan cepat: suite ini mayoritas MENGUJI RENDER dan MATRIKS IZIN, bukan alur browser yang benar-benar butuh 3 viewport. Hampir semua spec dijalankan 3x dengan assertion identik di ketiga viewport. Itu sumber pemborosan terbesar, bukan jumlah test per spec.

---

## 2. Klasifikasi per spec

Kode kelas:
- VA = menangkap bug nyata yang unit test tidak bisa (butuh DOM/browser/event).
- HAMPARAN = mengulang jaminan unit test atau cuma cek render.
- LEBIH BAIK UNIT = logika yang tidak butuh browser.

### 2.1 boot.spec.ts (3 test)
- Kelas: VA (jalur race boot: data source dipanggil sebelum siap -> flash "Gagal memuat" + reload). Bug produksi nyata tercatat di komentar.
- Contoh bug lolos tanpa spec: halaman render splash lalu auto-refresh karena DataSource belum sinkron.
- Rekomendasi: PERTAHANKAN, tapi desktop saja. Tidak ada interaksi layout. Lihat bagian 3.

### 2.2 routing.spec.ts (10 test)
- Kelas: 8 test "buka /x sebagai owner" = HAMPARAN murni render + heading ada. 1 test detail produk = HAMPARAN. 1 test "navigasi utama berpindah halaman" = VA lemah (klik link + URL berubah).
- Bug yang bisa lolos tanpa 8 test ini: hampir tidak ada; route yang rusak juga ketahuan di `izin.spec.ts` dan spec halaman masing-masing.
- Redundan dengan: `izin.spec.ts` (admin membuka kelima halaman staff), `boot.spec.ts` (semua halaman boot), `a11y.spec.ts` (setiap halaman dirender).
- Rekomendasi: POTONG 8 test "buka /x sebagai owner" menjadi 1 test loop internal ATAU HAPUS (sudah tertutup). Pertahankan 2 test halaman detail produk + navigasi klik. Pindah ke project desktop saja.

### 2.3 izin.spec.ts (7 test)
- Kelas: VA. Ini matriks izin role -> akses. Contoh bug lolos: guest bisa membuka /admin (regresi gerbang akses), admin bisa ubah provider AI.
- Catatan: sebagian diulang di spec lain (guest ditolak /admin di `admin-akses.spec.ts`, guest ditolak /draft di `draft-konfirmasi.spec.ts`, guest ditolak /kata-kunci di `kata-kunci.spec.ts`, admin read-only /kata-kunci di `kata-kunci.spec.ts`, guest /permintaan di `permintaan.spec.ts`).
- Rekomendasi: PERTAHANKAN (ini spec izin terpusat) tapi GABUNG semua pengecekan "guest ditolak /x" yang tersebar di spec fitur ke sini, hapus duplikatnya di spec fitur. Desktop saja.

### 2.4 a11y.spec.ts (26 test)
- Kelas: 9 owner "bersih" + 3 guest "bersih" + 9 "aturan wajib" + 3 guest "aturan wajib" = 24 test axe. SISANYA 2 test struktur (`html lang`, tombol punya nama).
- Overlap internal besar: 4 describe menjalankan axe pada himpunan halaman yang sama dengan subset aturan berbeda -> sebenarnya 1 analisa axe sudah mencakup semuanya. `pelanggaranBerat` (semua aturan, filter critical/serious) adalah superset dari `ATURAN_WAJIB` (6 aturan). Jadi 24 test bisa jadi ~12 (owner+guest, pakai axe penuh saja).
- Contoh bug VA: label form hilang, html tanpa lang, kontras gagal, landmark ganda.
- Rekomendasi: GABUNG. Jalankan 1 test per halaman (axe penuh, critical+serious) untuk owner dan guest = 12 test. HAPUS 12 test "aturan wajib" yang subset. Pindah ke desktop saja; axe tidak berubah per viewport kecuali kontras akibat layout - untuk itu cukup 1x mobile smoke di `/` dan `/stok`.

### 2.5 offline.spec.ts (21 test)
- Kelas: VA (isolasi jaringan; memastikan mock tidak menembak Firestore/Telegram) + 1 regresi SDK Telegram dimuat.
- 9 test "tidak menembak" + 9 test "tetap tampil saat diblokir" = 18 test, dua himpunan halaman SAMA, dua pendekatan yang tumpang tindih. "tidak menembak" saja sudah cukup untuk membuktikan isolasi; "tetap tampil saat diblokir" menambah pembuktian resilience (bernilai, tapi tidak butuh 9 halaman x 3 viewport).
- Contoh bug VA: mock diam-diam fallback ke Firestore nyata; SDK Telegram tidak dimuat -> Mini App blank.
- Rekomendasi: POTONG. Gabung jadi: 9 halaman x 1 test "tidak menembak + tetap render" (hilangkan himpunan kedua, atau sisakan 2-3 halaman kunci untuk "tetap tampil saat diblokir"). Simpan interaksi tulis + filter. Desktop saja. 21 -> 12.

### 2.6 smoke.spec.ts (1 test)
- Kelas: HAMPARAN / DUPLIKAT. Persis subset `offline.spec.ts` (cek request firestore/googleapis/identitytoolkit/api.telegram) pada `/` saja.
- Redundan sepenuhnya dengan `offline.spec.ts` baris 52 untuk `/`.
- Rekomendasi: HAPUS.

### 2.7 responsif.spec.ts (20 test)
- Kelas: VA per-viewport. Ini satu-satunya spec yang WAJIB mobile+tablet+desktop.
- Contoh bug lolos: scroll horizontal di 360px, bottom nav bocor >=768px, target sentuh < 44px.
- Catatan: 3 test target sentuh memakai `test.skip(width >= 768)` -> di tablet/desktop SKIP (bagian dari 14 skip). 8 test overflow berjalan di 3 viewport (bermakna semua). 3 test overflow filter/dialog + 2 nav.
- Rekomendasi: PERTAHANKAN seluruhnya, tapi:
  - Kalau mau hemat, tablet hanya perlu 1 test "shell breakpoint" (tablet dan desktop sama-sama >= 768 -> logika shell identik). 20 tablet -> kecilkan.
  - Target sentuh wajib mobile; biarkan skip di lain (sudah begitu).

### 2.8 tema.spec.ts (9 test)
- Kelas: VA (localStorage, colorScheme, class dark, teks transparan).
- Contoh bug lolos: preferensi tema hilang setelah reload, teks jadi transparan di mode gelap.
- 3 test "tidak ada teks hilang" di `/` dan `/stok` + 1 test token warna. Sisanya preferensi.
- Rekomendasi: PERTAHANKAN, desktop saja (tema tidak bergantung viewport kecuali class dark pada html). Menghemat 2/3.

### 2.9 histori.spec.ts (11 test)
- Kelas: mayoritas HAMPARAN filter (logika filter sebenarnya di data layer) + 1-2 VA.
- Overlap dengan unit: `test/permintaanHarian.test.js`, `test/mutasiStok.test.js` dll menguji rumus filter/tanggal. Filter tanggal/kode/status di UI hanya meneruskan param.
- VA sesungguhnya: test pagination > 20 (mutasi lintas halaman via store in-memory + navigasi klien) dan panel filter mobile (toggle) -> butuh browser + viewport.
- Redundan dengan `responsif.spec.ts` untuk "filter histori dibuka di mobile".
- Rekomendasi: POTONG. Sisakan 3-4: pagination>20, kronologi render, empty state, filter mobile. Pindah sebagian besar filter type/status/kode/tanggal/kombinasi KE UNIT TEST (murni logika penyaringan) atau HAPUS karena duplikat. Desktop saja (kecuali 1 test toggle filter mobile).

### 2.10 stok.spec.ts (9 test)
- Kelas: VA karena tabel desktop vs kartu mobile (`baris()` helper viewport-agnostik). Butuh minimal 1 desktop + 1 mobile.
- Contoh bug lolos: card mobile kehilangan tombol Koreksi; filter minus salah.
- Redundan: "guest TIDAK melihat tombol Koreksi" overlap `izin.spec.ts`; "owner melihat tombol Koreksi" overlap matriks izin.
- Rekomendasi: PERTAHANKAN inti (render, cari, filter minus, empty state, dialog koreksi validasi + submit). Desktop+mobile. GABUNG dua test izin Koreksi ke `izin.spec.ts`. tablet tidak perlu.

### 2.11 tambah-produk.spec.ts (9 test)
- Kelas: VA (dialog, validasi klien, 409 duplikat, 401 mid-write) tapi tidak viewport-sensitif.
- Redundan: "guest tidak melihat tombol" overlap izin; "owner/admin melihat tombol" loop role = matriks izin.
- Rekomendasi: PERTAHANKAN inti (validasi, simpan, 409, 401). GABUNG test izin tombol ke `izin.spec.ts`. Desktop saja.

### 2.12 dashboard-v2.spec.ts (16 test)
- Kelas: VA kuat. F1-F5 + 401 mid-write + matriks izin tulis.
- Contoh bug lolos: isian form reset saat 401 (kehilangan input user), owner bisa ubah role diri sendiri, hapus owner terakhir.
- Redundan internal: 4 test "guest/admin tidak melihat kontrol" = matriks izin (bisa ke `izin.spec.ts`).
- Rekomendasi: PERTAHANKAN. Desktop saja. GABUNG 4 test izin kontrol ke `izin.spec.ts` bila ingin memusatkan.

### 2.13 admin-akses.spec.ts (8 test)
- Kelas: VA. A7 approve/reject + 409 + 401 + izin.
- Contoh bug lolos: tombol Setujui muncul untuk request non-pending; dialog tertutup padahal 401 sehingga user kehilangan konteks.
- Redundan: "guest ditolak halaman /admin" duplikat `izin.spec.ts`.
- Rekomendasi: PERTAHANKAN inti. GABUNG guest-ditolak ke `izin.spec.ts`. Desktop saja.

### 2.14 draft-konfirmasi.spec.ts (12 test, 1 skip)
- Kelas: VA (konfirmasi/batal draft, kelompok sync, batch sebagian E-3, 401). 1 test skip sadar (empty picking, seed tidak mendukung).
- Contoh bug lolos: batch sebagian masih bisa dikonfirmasi (E-3), sync satu kelompok menghapus kelompok lain.
- Catatan: logika E-3 / rumus N-M SUDAH diikat unit (`test/paritasA2Data.test.js`, `test/draftKonfirmasiV3b.test.js`). Test UI di sini membuktikan WIRING, bukan rumus.
- Redundan: "guest ditolak /draft" duplikat izin.
- Rekomendasi: PERTAHANKAN inti wiring (opname konfirmasi, batal, sync kelompok, sync semua, 401). POTONG/HAPUS test "badge sebagian" dan "tombol per kelompok tampil" yang murni render karena rumus sudah unit-tested -> atau pindahkan assertion badge ke unit. Gabung guest-ditolak ke izin. Desktop saja.

### 2.15 permintaan.spec.ts (17 test)
- Kelas: campuran. Banyak alur tulis (ubah qty, kirim, barang datang, auto-selesai, desync, 401) = VA. Beberapa render/izin = HAMPARAN.
- Contoh bug lolos: qty invalid diterima, double-submit form terkirim dua kali, badge desync tidak muncul.
- Overlap unit: `test/permintaanHarian.test.js` + `test/permintaanRoute.test.js` menguji idempotensi guard, auto-selesai, format. UI di sini membuktikan wiring.
- Redundan: "draft: tombol Barang Datang tidak dirender" duplikat "badge status + tombol draft" (baris 39 dan 103). "guest ditolak" duplikat izin. "admin boleh beraksi" duplikat izin.
- Rekomendasi: PERTAHANKAN alur tulis (ubah qty, kirim, idempoten, desync, barang datang, auto-selesai, 409 item datang, 401). POTONG 2-3 test render duplikat + pindah izin ke izin.spec. Desktop saja.

### 2.16 staff.spec.ts (8 test)
- Kelas: HAMPARAN. Semua cuma cek render jumlah baris/teks dari mock.
- Contoh bug lolos tanpa spec ini: hampir tidak ada; konten mock dijamin `test/mockParitas.test.js`.
- Redundan besar: H5 Draft vs `draft-konfirmasi.spec.ts`, H6 Permintaan vs `permintaan.spec.ts`, H7 Admin vs `dashboard-v2.spec.ts` + `admin-akses.spec.ts`, H8 Pengaturan vs `izin.spec.ts` (provider).
- Rekomendasi: HAPUS sebagian besar. Sisakan 1 test "H7 Admin menampilkan perubahan peran" hanya jika belum ada di `admin-akses.spec.ts` (memang belum - `daftar-perubahan`). Selebihnya HAPUS. 8 -> 1.

### 2.17 ringkasan.spec.ts (7 test)
- Kelas: campuran. Render kartu + blok + urutan = HAMPARAN. Urutan kekurangan & tautan = VA lemah.
- Contoh bug lolos: urutan blok minus salah (dijamin unit? tidak eksplisit).
- Redundan: kartu statistik vs `routing.spec.ts` (heading Ringkasan).
- Rekomendasi: PERTAHANKAN hanya 2-3 bernilai: urutan blok minus, tautan kartu <-> /stok, guest tanpa kartu draft. HAPUS 4 render murni. Desktop saja. 7 -> 3.

### 2.18 kata-kunci.spec.ts (10 test)
- Kelas: VA (select + konfirmasi, disabled state, 401 mempertahankan pilihan) + HAMPARAN filter/render.
- Redundan: "guest ditolak" duplikat izin; "admin read-only" duplikat `izin.spec.ts` baris 76; "nav memuat Kata Kunci" duplikat `izin.spec.ts` nav.
- Rekomendasi: PERTAHANKAN 4 bernilai (tabel+badge, filter, konfirmasi sukses, 401). HAPUS/PINDAH 3 izin+nav ke izin.spec. Desktop saja. 10 -> 6.

### 2.19 real-r11.spec.ts (1 test, selalu skip di suite mock)
- Kelas: bukan beban mock (di-skip). Verifikasi dipindah ke `scripts/cek-real.mjs`.
- Rekomendasi: PERTAHANKAN (dokumentasi keputusan), tidak menghabiskan waktu, tapi tidak dihitung.

---

## 3. Masalah inti: 3 project untuk SEMUA spec

Dari 19 spec, hanya 6 yang benar-benar berubah perilaku antar viewport:
- `responsif.spec.ts` (wajib)
- `stok.spec.ts` dan `tambah-produk.spec.ts` (tabel vs kartu via helper `baris()`)
- `histori.spec.ts` (panel filter mobile + representasi)
- `kata-kunci.spec.ts` (nav sheet mobile)
- `a11y.spec.ts` (hanya kontras/layout - cukup sample kecil)
- `tema.spec.ts` (header toggle ada di semua, tapi tetap desktop cukuplah)

13 spec lain LOGIKANYA IDENTIK di ketiga viewport. Menjalankannya 3x mengulang assertion yang sama persis (matriks izin, dialog, 401, filter data) 3 kali => ~2/3 waktu suite terbuang.

Jumlah test yang sebenarnya menguji hal sama 3x:
- Desktop-only layak: admin-akses 8 + boot 3 + dashboard-v2 16 + draft-konfirmasi 11 + izin 7 + offline 12 + permintaan 14 + ringkasan 3 + routing 2 + staff 1 + tema 9 + a11y 12 = 98 test unik.
  Dijalankan 3x sekarang = 294 eksekusi; cukup 98 (desktop) => hemat 196 eksekusi.
- Viewport-sensitif (mobile + desktop, tablet opsional): responsif 20 + stok 9 + tambah-produk 9 + histori 4 + kata-kunci 6 = 48 test unik.
  Sekarang 3x = 144; usul mobile + desktop = 96; tablet hanya responsif breakpoint (1) + stok render (1) = 2 => 98 eksekusi => hemat ~46.

Estimasi total unik setelah pemangkasan konten: 98 (desktop) + 48 (viewport-sensitif) = 146 test unik (dari 205). Eksekusi ~196 (dari 615).

---

## 4. Rancangan konfigurasi efisien

### 4.1 Project: selective, bukan blanket

Ganti 3 project blanket dengan pemisahan lewat `testMatch` (tanpa menambah dependency, pakai nama file):

```
projects: [
  // 13 spec logika-identik -> desktop saja
  {
    name: "desktop",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    testMatch: /e2e[\\/](admin-akses|boot|dashboard-v2|draft-konfirmasi|izin|offline|permintaan|ringkasan|routing|staff|tema|a11y|smoke)\.spec\.ts/,
  },
  // spec viewport-sensitif -> desktop penuh
  {
    name: "desktop-viewport",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    testMatch: /e2e[\\/](responsif|stok|tambah-produk|histori|kata-kunci)\.spec\.ts/,
  },
  // spec viewport-sensitif -> mobile penuh
  {
    name: "mobile",
    use: { ...devices["Mobile Chrome"], viewport: { width: 360, height: 640 } },
    testMatch: /e2e[\\/](responsif|stok|tambah-produk|histori|kata-kunci)\.spec\.ts/,
  },
]
```

Catatan penting: tablet penuh tidak menambah nilai. `responsif.spec.ts` sudah menguji logika `<768` vs `>=768`; 768 tepat di batas dan desktop sudah mewakili `>=768`. Cara paling hemat: hapus project `tablet` sepenuhnya, dan di `responsif.spec.ts` tambah SATU test yang memaksa `page.setViewportSize({ width: 768, height: 1024 })` untuk cek batas. Ini menghilangkan ~203 eksekusi tablet.

Alternatif minimal (paling sedikit diff): tetap 2 project (desktop + mobile saja), buang tablet, tambahkan override viewport 768 di 1 test responsif.

### 4.2 Gate cepat vs full

Tambah script package.json:
```
"e2e:fast": "playwright test --project=desktop --project=desktop-viewport",
"e2e:full": "node scripts/e2e-build.mjs && playwright test"
```
Gate cepat (desktop saja, tanpa mobile/tablet): ~142 test, estimasi ~2,6 menit. Cukup untuk mayoritas regresi logika.

Aturan rilis: `e2e:full` (desktop + mobile untuk spec viewport-sensitif) hanya sebelum rilis. Mobile hanya pada gate rilis, bukan tiap commit.

`--project=desktop` di CLI tetap bisa dipakai tanpa ubah config (sudah terverifikasi: 226 s). Tapi karena spec dibagi `testMatch`, gate cepat sebaiknya `--project=desktop --project=desktop-viewport`.

### 4.3 Reporter

`html` reporter menambah overhead tulis file (dan folder `playwright-report/`). Rekomendasi:
- Lokal: `[["line"]]` saja (paling cepat, output ringkas).
- CI: `[["line"], ["html", { open: "never" }]]` atau `["blob"]` untuk sharding.
Config saat ini memasang `html` SELALU. Ganti jadi kondisional:
```
reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : [["line"]],
```
Tidak ada skenario yang butuh HTML report dari run lokal berulang.

### 4.4 Retry/trace

`trace: "on-first-retry"` tidak menghasilkan apa-apa lokal karena `retries: 0` lokal (tidak ada "first retry"). Jadi trace tidak pernah tersimpan lokal. Biarkan (hanya overhead CI). `fullyParallel` + workers default sudah benar; jangan set workers rendah.

---

## 5. Rekomendasi ringkas per spec

| Spec | Test skrg | Rekomendasi | Test usul | Project |
|---|---|---|---|---|
| a11y.spec.ts | 26 | GABUNG (axe penuh saja, buang subset "aturan wajib") | 12 | desktop |
| admin-akses.spec.ts | 8 | PERTAHANKAN; pindah guest-ditolak ke izin | 7 | desktop |
| boot.spec.ts | 3 | PERTAHANKAN | 3 | desktop |
| dashboard-v2.spec.ts | 16 | PERTAHANKAN; opsional pindah 4 test izin | 16 | desktop |
| draft-konfirmasi.spec.ts | 12 | POTONG render-murni (rumus sudah unit) | 9 | desktop |
| histori.spec.ts | 11 | POTONG + sebagian PINDAH KE UNIT TEST | 4 | desktop+mobile |
| izin.spec.ts | 7 | PERTAHANKAN (jadi pusat izin, terima gabungan) | 12 | desktop |
| kata-kunci.spec.ts | 10 | POTONG; pindah 3 izin/nav ke izin | 6 | desktop+mobile |
| offline.spec.ts | 21 | POTONG (gabung dua himpunan) | 12 | desktop |
| permintaan.spec.ts | 17 | POTONG render duplikat + izin | 13 | desktop |
| real-r11.spec.ts | 1(skip) | PERTAHANKAN (skip, nol biaya) | 1 | - |
| responsif.spec.ts | 20 | PERTAHANKAN (tambah 1 test batas 768) | 21 | desktop+mobile |
| ringkasan.spec.ts | 7 | POTONG render murni | 3 | desktop |
| routing.spec.ts | 10 | HAPUS 8 render / POTONG jadi 2 | 2 | desktop |
| smoke.spec.ts | 1 | HAPUS (duplikat offline) | 0 | - |
| staff.spec.ts | 8 | HAPUS mayoritas | 1 | desktop |
| stok.spec.ts | 9 | PERTAHANKAN; pindah izin Koreksi | 7 | desktop+mobile |
| tambah-produk.spec.ts | 9 | PERTAHANKAN; pindah izin tombol | 7 | desktop+mobile |
| tema.spec.ts | 9 | PERTAHANKAN | 9 | desktop |
| **Total unik** | **205** | | **~142** | |

Spec HAPUS total: `smoke.spec.ts` (duplikat `offline.spec.ts`).
Spec paling banyak dipotong: `staff.spec.ts` (8->1), `routing.spec.ts` (10->2), `offline.spec.ts` (21->12), `a11y.spec.ts` (26->12).
Spec GABUNG ke `izin.spec.ts`: pengecekan izin/gerbang yang tersebar di admin-akses, draft-konfirmasi, kata-kunci, permintaan, stok, dashboard-v2.
Spec PINDAH KE UNIT TEST: `histori.spec.ts` (filter type/status/kode/tanggal/kombinasi = murni logika penyaringan), sebagian `draft-konfirmasi.spec.ts` (badge sebagian = rumus sudah di `test/paritasA2Data.test.js`).

---

## 6. Estimasi penghematan

Asumsi waktu rata-rata per test tetap ~1,1 s (desktop), ~1,0 s (mobile), dan tablet dihapus.

Sekarang:
- 615 eksekusi, 617 s (10,3 mnt) full; 226 s (3,8 mnt) desktop-saja.

Usul A (hapus tablet + desktop-only untuk 13 spec logika + mobile untuk spec viewport):
- desktop: 142 test (semua unik sekali)
- mobile: ~48 test (spec viewport-sensitif)
- tablet: 0 (diganti 1 test batas di responsif)
- Total eksekusi: ~190 (dari 615) => turun 69 persen.
- Estimasi wall time: desktop ~155 s + mobile ~50 s = ~205 s (3,4 mnt) full. Turun dari 617 s ke ~205 s => hemat ~67 persen (~6,9 menit per run).

Usul B (gate cepat harian, desktop + desktop-viewport saja):
- ~142 test, estimasi ~155 s (2,6 mnt). Turun 75 persen dari full sekarang.

Frekuensi: gate cepat tiap commit (~2,6 mnt), full (desktop+mobile, ~3,4 mnt) sebelum rilis. Tambahan hemat dari reporter `line` saja lokal (menghilangkan tulis `playwright-report/`): perkiraan 5-15 s per run.

Catatan: setelah konten dipangkas, per-test bisa naik sedikit karena worker startup tetap, tapi jumlah eksekusi turun jauh lebih besar dari efek tersebut. Angka di atas konservatif.

---

## 7. Risiko yang tersisa

1. Tablet (768x1024) dihapus. Risiko: bug spesifik tepat di breakpoint 768 tidak terlihat. Mitigasi: 1 test di `responsif.spec.ts` dengan `page.setViewportSize({ width: 768, height: 1024 })` memverifikasi shell breakpoint. Karena Tailwind `md:` = 768, nilai ini penting.
2. Memindahkan filter `histori.spec.ts` ke unit test mengasumsikan logika filter di layer data. WAJIB verifikasi jalur: bila filter disusun di komponen React, pindah ke unit test justru MENURUNKAN cakupan. Cek dulu sumber logika sebelum eksekusi rekomendasi ini.
3. Menggabungkan test izin ke `izin.spec.ts` memusatkan banyak assertion pada satu file. Bila `izin.spec.ts` flaky, banyak gerbang jatuh bersamaan. Mitigasi: pecah menjadi beberapa test per role, bukan satu test raksasa.
4. `a11y.spec.ts` mengurangi cakupan aturan dari daftar `ATURAN_WAJIB` ke "semua aturan axe critical/serious". Ini justru memperluas (superset), jadi tidak ada kehilangan; risiko yang benar adalah test gagal karena aturan baru di luar daftar lama. Justru bagus, tapi siapkan waktu triage.
5. Penghematan mengandalkan banyak worker. Di CI dengan `workers: 1` (config sekarang), wall time turun sebanding jumlah test (615->190 = ~69 persen), bukan berdasarkan paralelisme. Verifikasi ulang di CI.
6. Beberapa test yang diusul HAPUS (`staff.spec.ts`, `routing.spec.ts`) menguji konten seed mock. `test/mockParitas.test.js` diduga menutup ini, tapi belum diverifikasi dalam audit ini. Bila tidak, pertahankan 2-3 test konten seed.

---

## 8. Langkah eksekusi yang disarankan (urutan aman)

1. Ubah reporter jadi kondisional (`line` lokal). Dampak kecil, risiko nol.
2. Hapus project `tablet`; tambah 1 test batas 768 di `responsif.spec.ts`.
3. Hapus `smoke.spec.ts` (duplikat).
4. Pangkas `staff.spec.ts` dan `routing.spec.ts` (hapus render murni).
5. Gabung pengecekan izin tersebar ke `izin.spec.ts`, hapus di spec fitur.
6. Pangkas `a11y.spec.ts` (buang describe "aturan wajib" subset) dan `offline.spec.ts` (gabung himpunan).
7. Pisahkan `testMatch` project desktop (logika-identik) vs viewport-sensitif untuk mobile.
8. Setelah stabil, baru pertimbangkan memindahkan filter `histori.spec.ts` ke unit test (butuh verifikasi sumber logika lebih dulu).

Jangan kerjakan semua sekaligus. Tiap langkah harus lulus `npx playwright test` penuh sebelum lanjut, agar regresi akibat pemangkasan tertangkap.