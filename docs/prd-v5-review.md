# Review Adversarial PRD v5

Reviewer: senior product reviewer (adversarial).
Tanggal: 2026-09-16.
Objek: `docs/prd-v5.md` (644 baris).
Pembanding: `docs/discovery-v5.md`, `docs/research-dashboard-wms.md`, `firestore.rules`,
`firestore.indexes.json`, `lib/models/stok.js`, `lib/models/admins.js`,
`lib/dashboard/data/index.ts`, `lib/dashboard/data/real.ts`, `lib/dashboard/data/mock.ts`,
`app/api/admin/route.ts`, `app/api/stok/mutasi/route.ts`, `test/indexFirestore.test.js`,
`docs/learnings.md`.

Metode: baca dokumen + verifikasi klaim ke kode nyata (bukan percaya dokumen). Angka test/e2e
dihitung langsung dari working tree.

Ringkasan severity: blocker 6, major 18, minor 6.

---

## A. Kontradiksi & inkonsistensi

### T1 [blocker] Skema dokumen memakai `dibuat_at`, tapi SEMUA index & query memakai `created_at`

- Lokasi: `prd-v5.md:489-493`, `prd-v5.md:503` (index) vs `prd-v5.md:350-361` (skema
  `permintaan_gudang`), `prd-v5.md:370-378` (skema `opname_gudang`).
- Masalah: Tabel index 9 mendefinisikan index pada field `created_at` untuk
  `permintaan_gudang` dan `opname_gudang`. Namun skema 6.2/6.3 tidak punya field
  `created_at` sama sekali - hanya `dibuat_at`. PRD juga tidak pernah menyebut query yang
  memakai `created_at`. Nama field ini berbeda dari `created_at` yang dipakai
  `stock_movements` existing dan melanggar BR12 (snake_case konsisten).
- Bukti: `grep created_at docs/prd-v5.md` hanya menemukan 6 kemunculan, semuanya di 9.
  6.2/6.3 hanya memuat `dibuat_at`. `real.ts:301` memakai `orderBy("created_at")` untuk
  koleksi lain, bukan alasan memilih nama itu.
- Perbaikan: putuskan satu nama field waktu (`dibuat_at` atau `created_at`) dan pakai
  konsisten di skema, index, dan query. Bila `dibuat_at` dipilih, semua index 9 diubah.
  Tambahkan AC eksplisit "nama field waktu urutan = X" + test index yang membaca nama field
  dari skema (bukan hardcode).

### T2 [major] `listStock()` mengubah signature (argumen filter) tapi 12 tidak menyebut migrasi tipe UI

- Lokasi: `prd-v5.md:248` (F9), `prd-v5.md:254` (StockRow + field baru), `prd-v5.md:570`.
- Masalah: Kontrak `DataSource.listStock(): Promise<StockRow[]>` saat ini TANPA argumen
  (`index.ts:68`). PRD mengubahnya jadi `listStock({gudang_id?, is_online?, sertakan_tanpa_gudang?})`
  dan menambah field `StockRow`. `listStock` dipakai di 2 titik UI nyata dan 1 stub
  (`listStock: tolak`). Mengubah signature tanpa menyebut file konsumen = risiko `tsc`
  merah / UI diam-diam kehilangan argumen default.
- Bukti: `index.ts:68` `listStock(): Promise<import("../types").StockRow[]>`; grep
  `listStock` menemukan 3 titik pemakaian. `StockRow` didefinisikan di
  `lib/dashboard/types.ts`, bukan di `index.ts`.
- Perbaikan: tambah sub-bagian "migrasi kontrak DataSource" yang mendaftar (a) file
  `types.ts` yang menambah field `StockRow`, (b) semua pemanggil `listStock`, (c) argumen
  default agar pemanggil lama tidak error. Jadikan AC `tsc`.

### T3 [major] Klaim jumlah test/e2e tidak akurat dan tidak bisa direproduksi dari repo

- Lokasi: `prd-v5.md:555` (`316 pass`), `prd-v5.md:557` (`601 pass`), `prd-v5.md:632`.
- Masalah: `316` unit test cocok dengan hitungan `test(` di `test/*.test.js` (316). Tapi
  `601` e2e TIDAK cocok: hitungan blok `test(` di `e2e/*.spec.ts` = 150, dan
  `playwright.config.ts` punya 3 project (mobile/tablet/desktop), sehingga angka realistis =
  450 (tanpa retry), bukan 601. Angka 601 kemungkinan dari retry/run lama. AC "601+ pass"
  tidak dapat diverifikasi apa adanya.
- Bukti: `(Select-String -Path test/*.test.js -Pattern "^\s*test\(").Count` = 316.
  `(Select-String -Path e2e/*.spec.ts -Pattern "^\s*test\(").Count` = 150;
  `playwright.config.ts:18-23` = 3 projects.
- Perbaikan: ganti dengan angka yang bisa direproduksi (mis. "150 spec x 3 project = 450
  pass") atau nyatakan metrik sebagai "0 fail", bukan angka absolut dari satu run.

### T4 [major] 14.2 menjadikan temuan migrasi sebagai AC selesai tanpa langkah verifikasi yang dijalankan gate

- Lokasi: `prd-v5.md:619`.
- Masalah: AC global #2 berbunyi "selisih 0 pada seluruh koleksi". Ini hanya bisa dibuktikan
  dengan query ke Firestore nyata (`count(...)`), sementara gate otomatis (`npm test`,
  `tsc`, e2e mock) tidak menyentuh Firestore. Tidak ada test atau script yang dijanjikan
  menjalankan verifikasi ini.
- Bukti: 10 langkah 2 menyebut query verifikasi tetapi menentukan script di luar repo
  ("script di luar repo", `prd-v5.md:509`), jadi tidak ada artefak yang bisa dijalankan CI.
- Perbaikan: tentukan perintah verifikasi konkret yang dapat dijalankan ulang (mis.
  `scripts/verify-backfill.mjs` read-only yang mencetak count selisih dan exit non-zero bila
  != 0), atau turunkan AC ini menjadi "manual, dicatat di PR".

### T5 [major] Kontradiksi istilah dengan discovery: discovery menyebut `stok_gudang_online` "agregat/total", PRD menyebut "salah satu key"

- Lokasi: `prd-v5.md:273-275` (BR2) vs `docs/discovery-v5.md:96-99`.
- Masalah: Discovery 5 (sebelum Q4 dijawab) menyebut `stok_gudang_online` sebagai
  "agregat/total". PRD menegaskan ia = key `"ONLINE"` (Q4a). Ini memang mengikuti keputusan
  terkunci Q4a dan SAH. Namun discovery TIDAK direvisi, sehingga dua dokumen yang PRD klaim
  saling mendukung saling bertentangan bila dibaca tanpa tahu urutan Q&A. PRD tidak menandai
  bahwa discovery 5 sudah kedaluwarsa.
- Bukti: `discovery-v5.md:97` "dipertahankan sebagai agregat/total untuk backward-compat";
  `prd-v5.md:274` "`stok_gudang_online` BUKAN total lintas gudang".
- Perbaikan: tambahkan catatan bahwa discovery 5 digantikan Q4a (tandai di discovery atau
  kutip eksplisit di PRD). Bukan pelanggaran keputusan terkunci, tapi jebakan review.

---

## B. Celah & lubang

### T6 [blocker] F5 tidak mendokumentasikan transisi `ditolak -> *`, dan tidak ada jalur membatalkan dokumen `menunggu`/`disetujui` yang salah

- Lokasi: `prd-v5.md:142-177` (F5), `prd-v5.md:348` (status enum).
- Masalah: State machine hanya menuliskan jalur sukses `menunggu -> disetujui|ditolak ->
  dikirim -> diterima`. Tidak ada (a) perilaku dokumen `ditolak` (terminal? boleh `buat`
  ulang? boleh `ubah-item`?); (b) aksi `batal` untuk `menunggu` yang salah input; (c) jalan
  keluar untuk `disetujui` yang tidak akan pernah dikirim. Edge case `ubah-item`
  (`prd-v5.md:174`) hanya menyebut status `menunggu`, tanpa menyebut apakah `ditolak` bisa
  diubah.
- Bukti: Tidak ada baris AC yang mendefinisikan `ditolak -> *` atau aksi `batal` di F5/F6/enum
  6.2. `riwayat_status` hanya append transisi yang ada.
- Perbaikan: definisikan tabel transisi eksplisit `dari -> aksi -> ke -> efek stok` (termasuk
  semua jalur ilegal -> 409 dengan pesan), dan tambahkan minimal aksi `batal`
  (dari `menunggu`/`ditolak`) atau nyatakan tegas "dokumen terminal, buat dokumen baru"
  sebagai keputusan.

### T7 [blocker] Q1a konsekuensi multi-tujuan: status akhir `diterima` vs sebagian tujuan, dan aksi penutup tidak ada

- Lokasi: `prd-v5.md:146`, `prd-v5.md:162-164`, `prd-v5.md:195`, `prd-v5.md:286-288` (BR5).
- Masalah: PRD menetapkan status tetap `dikirim` sampai SEMUA tujuan `diterima_at` non-null.
  Lubang yang tidak ditutup: (a) Apa status yang DILIHAT admin gudang tujuan A yang sudah
  terima? Apakah ia melihat `dikirim` padahal barang sudah masuk? UI-nya tidak dijelaskan.
  (b) Bila ada tujuan bertipe user tanpa `gudang_id`, entri itu "tetap butuh `diterima_at`"
  (`prd-v5.md:164`) - tetapi user tanpa gudang tidak punya pemicu, sehingga dokumen bisa
  nyangkut `dikirim` selamanya. `prd-v5.md:195` menyebut owner "dapat menutup dokumen dengan
  entri `diterima_at` manual", namun aksi ini TIDAK ADA di endpoint 7 (tidak ada aksi
  `tutup-tujuan`/`terima-manual`). (c) Tidak ada timeout/auto-expire, tidak ada daftar
  antrian "dokumen nyangkut" untuk owner.
- Bukti: 7 (`prd-v5.md:434`) mendaftar aksi `buat|ubah-item|setujui|tolak|kirim|terima` -
  tidak ada aksi penutup. R10 (`prd-v5.md:602`) mengakui risiko lalu mitigasinya hanya
  "owner dapat menutup entri" tanpa route.
- Perbaikan: tambahkan aksi `terima-manual`/`tutup-tujuan` (owner-only) ke endpoint F5 lengkap
  dengan AC + audit, atau hapus klaim mitigasi dan nyatakan dokumen `dikirim` selamanya
  sebagai konsekuensi yang diterima (dan tampilkan di UI sebagai "menunggu tujuan X"). Juga
  definisikan status turunan yang ditampilkan per tujuan (`diterima_at` per entri).

### T8 [blocker] Q4a migrasi: PRD tidak menyelesaikan konflik nilai saat `qty_per_gudang.ONLINE` sudah ada tapi BEDA dari `stok_gudang_online`

- Lokasi: `prd-v5.md:513-517` (langkah #2), `prd-v5.md:606` (R14).
- Masalah: Rumus backfill `{ ...(doc.qty_per_gudang || {}), "ONLINE": doc.stok_gudang_online ?? 0 }`
  MENIMPA nilai `ONLINE` yang sudah ada dengan `stok_gudang_online`. PRD mengklaim idempoten
  ("jalan dua kali hasil sama") - itu BENAR. Tapi PRD tidak menjawab "mana yang menang" bila
  keduanya sudah ada dan beda (mis. key `"ONLINE"` = 5, `stok_gudang_online` = 12). Setelah
  backfill, 5 hilang tanpa jejak: kehilangan data senyap. Ini berlawanan dengan R14 yang
  justru memilih `qty_per_gudang["ONLINE"] ?? stok_gudang_online` (prioritas `qty_per_gudang`).
  Dua arah prioritas berbeda antara migrasi dan boundary baca. Race: bila ada tulis stok
  BERBARENGAN migrasi, transaksi `_ubahStokRelatif` (`stok.js:51-67`) tidak menulis
  `qty_per_gudang`, sehingga backfill bisa memakai `stok_gudang_online` yang sudah bergeser.
- Bukti: `prd-v5.md:514` menimpa `ONLINE`; `prd-v5.md:606` membaca `ONLINE` lebih dulu.
- Perbaikan: tetapkan aturan tunggal sebagai AC: "bila `qty_per_gudang.ONLINE` sudah ada,
  nilai itu MENANG dan `stok_gudang_online` diselaraskan ke nilai itu; bila hanya
  `stok_gudang_online` ada, backfill dari situ". Tambah langkah pra-migrasi (hentikan tulis /
  catat waktu cutover) atau backfill dalam transaksi per dokumen.

### T9 [major] F7 Opname: `qty_sistem` basi antara `buat` dan `setujui` tidak ditangani

- Lokasi: `prd-v5.md:203-206`, `prd-v5.md:222`.
- Masalah: `qty_sistem` dihitung saat `buat` dan disimpan. Bila `qty_per_gudang` berubah (via
  F2 set-qty, `kirim`/`terima` F5, atau opname lain) ANTARA `buat` dan `setujui`, maka saat
  owner menyetujui PRD menulis `qty_per_gudang[gudang_id] = qty_fisik` - menimpa semua
  perubahan sesudahnya. Tidak ada validasi "sistem masih == saat opname dibuat", tidak ada
  refresh, tidak ada peringatan.
- Bukti: `prd-v5.md:206` "menulis `qty_per_gudang[gudang_id] = qty_fisik` untuk SETIAP item";
  edge case `prd-v5.md:222` justru menormalkan dua opname bersamaan dengan last-write-wins.
- Perbaikan: definisikan perilaku: (a) saat `setujui`, bandingkan `qty_sistem` tersimpan dengan
  nilai saat ini; bila beda -> 409 "Stok berubah sejak opname dibuat. Buat ulang." atau
  (b) recompute `selisih` saat setujui + catatan audit. Pilih satu + AC.

### T10 [major] F6 "Kirim ke user": user pindah gudang setelah permintaan dibuat - stok tujuan tidak deterministik

- Lokasi: `prd-v5.md:164`, `prd-v5.md:188`, skema `tujuan[]` di `prd-v5.md:347`.
- Masalah: Tujuan bertipe user di-resolve ke `admins.gudang_id` PADA SAAT `terima`, bukan
  disimpan saat `buat`. Bila user pindah gudang antara `buat` dan `terima`, stok masuk ke
  gudang BARU, bukan gudang yang dimaksud saat permintaan dibuat. Tidak ada snapshot
  `gudang_id` di entri `tujuan[]` (hanya menyimpan `nama/jabatan`), tidak ada AC.
- Perbaikan: simpan snapshot `gudang_id` di entri `tujuan` saat `buat`, dan `terima` memakai
  snapshot itu (validasi gudang masih ada). Tambahkan AC "user pindah gudang setelah buat ->
  stok masuk gudang snapshot".

### T11 [major] F1 gudang nonaktif: item/user/permintaan yang menunjuk gudang nonaktif hanya ditangani sebagian

- Lokasi: `prd-v5.md:77` (`peringatan_referensi`), `prd-v5.md:80`, `prd-v5.md:175`,
  `prd-v5.md:220`, `prd-v5.md:249`, `prd-v5.md:300-301` (BR9).
- Masalah: BR9 menyatakan "referensi lama tetap valid". Konsekuensi yang tidak ditutup:
  (a) Admin yang `gudang_id`-nya menunjuk gudang nonaktif: F9 (`prd-v5.md:249`) memfilter
  berdasarkan `gudang_id` - apakah ia melihat baris gudang nonaktif itu? Bila tidak,
  akunnya kosong permanen tanpa pesan. (b) `listGudang()` default hanya `aktif:true`
  (`prd-v5.md:80`) sehingga filter UI user bergudang nonaktif tidak punya opsi, tapi
  `gudang_id`-nya masih menunjuk ke sana. (c) `peringatan_referensi:<jumlah>` hanya
  menghitung `admins.gudang_id`, TIDAK menghitung `stock.qty_per_gudang` yang mungkin punya
  key gudang itu (data stok yatim setelah nonaktif).
- Bukti: `prd-v5.md:77` menyebut hanya `admins.gudang_id`; tidak ada AC untuk admin bergudang
  nonaktif.
- Perbaikan: tambah AC "admin dengan `gudang_id` nonaktif -> `listStock()` 0 baris +
  `gudang_nonaktif:true` + pesan eksplisit" dan sertakan hitungan
  `stock.qty_per_gudang[gudang_id]` dalam `peringatan_referensi`.

### T12 [major] F4 Jabatan: tidak ada AC/test yang mengunci bahwa `jabatan` TIDAK dipakai di jalur otorisasi

- Lokasi: `prd-v5.md:41`, `prd-v5.md:136-137`, `prd-v5.md:190`, `prd-v5.md:297-298` (BR8).
- Masalah: BR8 berbunyi "`admins.jabatan` tidak pernah dibaca di jalur otorisasi". F4 AC
  `prd-v5.md:137` menuntut `jabatan` muncul "di daftar pilihan Kirim ke: User", dan
  `prd-v5.md:190` menampilkannya di UI. `jabatan` ditulis oleh aksi owner-only `set-jabatan`.
  Tidak ada AC yang mengunci bahwa route admin TIDAK membaca `jabatan` dari body sebagai
  pengganti role (validator baru `validasiAksiAdmin` menerima `jabatan`). Risiko: implementasi
  "mudah" memakai `jabatan` sebagai key permission karena ada di dokumen yang sama dengan
  `role`.
- Bukti: Tidak ada AC/test yang mengirim `jabatan:"owner"`/`"admin"` lalu assert hasil
  otorisasi tidak berubah. `prd-v5.md:136` hanya menguji "role sebelum == sesudah".
- Perbaikan: tambahkan AC + test: kirim `jabatan:"owner"` pada user guest, assert tetap 403;
  dan negative-grep `jabatan` di `app/api/**/route.ts` + `lib/dashboard/auth/**`.

### T13 [major] Celah self-target via tujuan bertipe user: `terima` bisa "mengembalikan" stok ke gudang asal

- Lokasi: `prd-v5.md:153`, `prd-v5.md:164`, `prd-v5.md:188`, `prd-v5.md:267-271` (BR1).
- Masalah: `buat` mencegah `dari_gudang_id` == tujuan bertipe gudang (`prd-v5.md:153`). Tapi
  tujuan bertipe user di-resolve ke `admins.gudang_id` saat terima, dan PRD tidak melarang
  `gudang_id` user target == `dari_gudang_id`. Akibatnya `kirim` mengurangi asal, lalu
  `terima` menambah asal yang sama => net nol, tapi `stock_movements` mencatat dua mutasi
  palsu. Tidak ada invariant "total lintas gudang tetap" yang bisa diuji.
- Bukti: `prd-v5.md:188` mencegah user target tanpa `gudang_id`, tapi tidak mencegah
  `gudang_id` user target == `dari_gudang_id`. Tidak ada AC untuk ini.
- Perbaikan: tambahkan validasi saat `buat`/`terima`: resolve tujuan bertipe user -> bila
  `gudang_id` == `dari_gudang_id` -> 400 "Tujuan sama dengan gudang asal". Tambahkan AC.

### T14 [minor] `qty_sistem = qty_per_gudang[gudang_id] ?? 0` memicu selisih palsu pada opname pertama

- Lokasi: `prd-v5.md:203`, `prd-v5.md:259`.
- Masalah: Bila `qty_per_gudang[gudang_id]` absen, PRD memakai `?? 0`. Maka item yang BELUM
  pernah diisi di gudang itu terlihat selisih = qty_fisik, memicu approval owner untuk data
  yang sebenarnya "belum diisi" - antrian approval palsu massal pada opname pertama.
- Perbaikan: definisikan item tanpa key `gudang_id` dikecualikan atau ditandai "belum
  terdaftar" (selisih dianggap 0), atau beri catatan di UI.

---

## C. Keamanan

### T15 [blocker] Rules 8 membuka baca `permintaan_gudang`/`opname_gudang` ke SEMUA admin lintas gudang

- Lokasi: `prd-v5.md:459-460`.
- Masalah: `match /permintaan_gudang/{id} { allow read: if staff(); }` memberi hak baca SEMUA
  dokumen ke SEMUA admin (dan owner). Untuk koleksi berisi data operasional lintas gudang,
  admin gudang A bisa membaca permintaan/opname gudang B langsung via Firestore client SDK -
  menembus BR7 (scope gudang di server). PRD berargumen "rules are not filters"
  (`prd-v5.md:476`), tetapi itu menjelaskan kenapa rules membatasi QUERY, bukan kenapa read
  langsung `get()` ke dokumen gudang lain diizinkan. `get()` by ID tidak kena "rules are not
  filters".
- Bukti: `prd-v5.md:459-460`; tidak ada constraint `resource.data.dari_gudang_id` atau
  `get()` ke `admins`. `firestore.rules:23-31` memang memakai pola "staff() bisa baca semua"
  untuk koleksi existing, tetapi koleksi itu tidak punya model scope gudang; koleksi baru ini
  punya.
- Perbaikan: batasi read dengan rules berbasis dokumen (mis. `allow get: if staff() &&
  (resource.data.dari_gudang_id == get(...).data.gudang_id || token role owner)`)
  dengan memperhitungkan limit 10 `get()`, atau - lebih murah - jangan izinkan client baca
  koleksi ini sama sekali dan sajikan lewat route server ber-scope. Jika tetap dibuka,
  tambahkan AC negatif: admin G1 `getDoc` permintaan G2 -> denied.

### T16 [major] Koleksi guard baru tidak dijanjikan TTL policy, hanya `at` yang dibaca kode

- Lokasi: `prd-v5.md:380-390`, `prd-v5.md:463-467`.
- Masalah: Guard memakai dokumen `/{uid}` yang ditulis ulang tiap aksi. Karena write client
  dilarang (`if false`), dokumen guard menumpuk satu per uid (jumlah kecil, tidak masalah).
  Namun 5 koleksi guard baru tidak dijanjikan TTL policy dan tidak ada AC pembersihan.
- Perbaikan: sebut eksplisit bahwa guard overwrite (`{merge:false}`) membatasi dokumen per uid
  sehingga tidak perlu TTL policy; atau tambahkan TTL policy.

### T17 [major] `stock` read `authed()` membocorkan seluruh `qty_per_gudang` lintas gudang, klaim scope PRD tidak menutup ini

- Lokasi: `prd-v5.md:449`, `prd-v5.md:473`, `firestore.rules:18`.
- Masalah: PRD benar bahwa semua write via admin SDK. Namun `stock/{kode}` punya
  `allow read: if authed()` (`firestore.rules:18`), sehingga SEMUA role termasuk guest bisa
  membaca `qty_per_gudang` utuh (semua gudang). Admin G1 dan guest bisa melihat qty gudang G2
  di dalam map. PRD tidak menyebut ini, padahal 8 mengklaim scope gudang ditegakkan.
- Bukti: `firestore.rules:18`; `qty_per_gudang` akan berisi semua gudang.
- Perbaikan: terima sebagai konsekuensi (semua staff boleh lihat semua stok) dan hapus klaim
  implisit bahwa map per-gudang ter-scope; ATAU sajikan stok per gudang lewat route server
  yang memfilter key. Harus dinyatakan eksplisit.

### T18 [major] Tidak ada AC bahwa endpoint baru menolak guest SEBELUM validasi body, dan tidak dikunci per-route

- Lokasi: `prd-v5.md:169`, `prd-v5.md:436-437`, `prd-v5.md:578-580`.
- Masalah: PRD menyebut guest 403, tetapi test strategy 12 tidak mewajibkan test guest untuk
  SETIAP route baru (hanya "satu test per route" tanpa skenario guest). Pola
  `mutasi/route.ts:100-103` menegakkan guest SETELAH validasi body; urutan ini penting (guest
  tidak boleh membocorkan pesan validasi). Tidak ada AC urutan untuk route baru.
- Perbaikan: tambah AC: untuk setiap route baru, test memverifikasi urutan
  `tolakOrigin -> sesi -> rate limit -> role -> validasi` dan guest -> 403 sebelum validasi
  body.

### T19 [minor] Matrix permission 3 tidak punya baris "lihat master gudang", tapi rules membuka read ke guest

- Lokasi: `prd-v5.md:43-46` (matrix), `prd-v5.md:456`.
- Masalah: Matrix tidak punya baris "lihat master gudang". Rules `prd-v5.md:456` membuka read
  untuk `authed()` (termasuk guest). Kontradiksi kecil.
- Perbaikan: tambah baris eksplisit di matrix (guest: read-only gudang) atau persempit rules
  ke `staff()`.

---

## D. Kelayakan teknis

### T20 [blocker] Index 9: format tidak cocok dengan file, ada index tak berguna, dan tidak dipetakan ke query

- Lokasi: `prd-v5.md:487-496`, `firestore.indexes.json`.
- Masalah:
  (a) 9 menulis "Fields" sebagai `status ASC, created_at DESC, __name__ DESC`. Format existing
      (`firestore.indexes.json:2-110`) memakai array `fields` objek `{fieldPath, order}` +
      `collectionGroup` + `queryScope` + `density`. Untuk `admins`/`gudang` (bukan
      `stock_movements`), `collectionGroup` = nama koleksi; ini tidak ditulis di 9.
  (b) `stock.kode_barang ASC, last_updated DESC` (`prd-v5.md:496`) - `kode_barang` adalah DOC
      ID `stock`, bukan field. Index mensyaratkan field ada. Index ini tidak berguna dan
      ditandai "opsional; jangan pasang bila tidak dipakai" - kalau begitu, JANGAN masukkan
      ke tabel (mengundang pembaca memasangnya).
  (c) `gudang.aktif ASC, urutan ASC` (`prd-v5.md:494`) - query `listGudang()` default mengikuti
      pola existing (full scan + filter client, spt `listAdmins` `real.ts:382` tanpa filter).
      Bila begitu, index ini TIDAK dipakai dan menjadi biaya tulis.
  (d) `admins.gudang_id ASC, name ASC` (`prd-v5.md:495`) - `name` bisa null; pengurutan dengan
      null perlu perilaku eksplisit.
- Bukti: `firestore.indexes.json:2-110`; `test/indexFirestore.test.js:24-31` membaca
  `collectionGroup` + `fields[]`, bukan format 9.
- Perbaikan: tulis index 9 dalam bentuk JSON final siap-tempel (dengan
  `collectionGroup`/`queryScope`/`density`), buang index yang tidak akan dipakai, dan pastikan
  tiap index dipetakan ke SATU query konkret di `real.ts` (nama fungsi + baris). Sertakan
  `kode_barang` sebagai `__name__` bila memang maksudnya doc id.

### T21 [major] Index hilang untuk query inti: menemukan permintaan yang MENUNJUK gudang/user sebagai tujuan

- Lokasi: `prd-v5.md:487-496`, skema `tujuan[]` `prd-v5.md:347`.
- Masalah: F5/F6 memerlukan UI "antrian approval owner" (`prd-v5.md:492`), "permintaan saya"
  (`prd-v5.md:491`), "riwayat per gudang". Tetapi tidak ada query untuk "permintaan yang
  MENUNJUK gudang/user saya sebagai tujuan" - dengan `tujuan[]` array of maps, Firestore butuh
  `array-contains` yang tidak bisa memfilter `id` saja di dalam map. PRD tidak mendefinisikan
  cara menemukan permintaan yang ditujukan ke gudang/user tertentu, padahal itu inti fitur.
- Bukti: `tujuan` adalah `array<{tipe,id,...}>`; tidak ada index untuk itu, dan
  `array-contains` pada map tidak bisa memfilter `id` saja.
- Perbaikan: tambahkan field bantu (mis. `tujuan_ids: string[]` = `["gudang:G1","user:900002"]`)
  agar `array-contains` + index komposit bisa dipakai, lalu cantumkan index-nya. Atau
  definisikan query lain (filter status + filter client) dan buktikan cukup.

### T22 [major] BR11 menjanjikan guard untuk "semua aksi tulis" tapi daftar guard tidak menutup `tolak`, `ubah-item`, `aktifkan`/`edit`, `set-jabatan`, `set-gudang-user`

- Lokasi: `prd-v5.md:306-308` (BR11), `prd-v5.md:384`, `prd-v5.md:386-388`.
- Masalah: BR11 mendaftar "buat permintaan, setujui, kirim, terima, buat opname, approve
  opname, set qty, toggle online". Aksi yang DILUPAKAN: `tolak` permintaan, `ubah-item`,
  `tolak` opname, `aktifkan`/`edit` gudang, `set-jabatan`, `set-gudang-user`. `prd-v5.md:384`
  hanya menulis guard dipakai untuk "buat/setujui/kirim/terima". Jadi `tolak`/`ubah-item`
  tidak ter-guard, padahal bisa double-submit.
- Bukti: `prd-v5.md:384,386` vs `prd-v5.md:306-308`.
- Perbaikan: tambahkan `tolak`, `ubah-item`, `aktifkan`/`edit` gudang, `set-jabatan`,
  `set-gudang-user` ke daftar guard + AC test masing-masing, atau nyatakan eksplisit aksi mana
  yang idempoten secara alami dan tidak butuh guard.

### T23 [major] Batas 1 MiB: asumsi "~40 key aman" bertabrakan dengan "tanpa batas jumlah gudang" dan `items <= 200`

- Lokasi: `prd-v5.md:81`, `prd-v5.md:108`, `prd-v5.md:540-541`.
- Masalah: 11 menetapkan `items.length <= 200` per `permintaan_gudang`, tapi F5/F6 tidak
  memasukkan batas 200 ini sebagai AC (`prd-v5.md:149` hanya ">=1 item"). F2 edge
  (`prd-v5.md:108`) menyatakan ">30 key ... route tetap sukses; tidak ada guard khusus",
  bertabrakan dengan klaim 11 "~40 key aman (<10 gudang)". `prd-v5.md:81` mengizinkan
  "Menambah 20 gudang berturut-turut sukses ... (tidak ada batas jumlah)", padahal 11/Asumsi
  mengandaikan <10 gudang. Tidak ada AC yang menahan penambahan gudang tanpa batas maupun
  menghitung kombinasi map + items terhadap 1 MiB.
- Bukti: `prd-v5.md:81` "tidak ada batas jumlah"; `prd-v5.md:108` "tidak ada guard khusus";
  `prd-v5.md:540` "~40 key aman".
- Perbaikan: tetapkan batas atas gudang (mis. 50) sebagai business rule + AC, atau buktikan
  secara kuantitatif batas aman (hitung byte map + items). Selaraskan 11 dan 6.5; tambahkan
  batas `items <= 200` sebagai AC F5.

### T24 [major] DataSource: daftar file kontrak tidak lengkap (types.ts, mock-data.ts, mock-paritas.js)

- Lokasi: `prd-v5.md:570` (F9), `prd-v5.md:598`, `prd-v5.md:571`.
- Masalah: Discovery R6 (`discovery-v5.md:170-171`) menyebut "3x + test paritas"
  (`index.ts`/`real.ts`/`mock.ts`). PRD 12 memperluas daftar method tapi tidak menyebut:
  (a) tipe request/response baru harus didefinisikan di `lib/dashboard/types.ts` (pola
  existing semua tipe tulis ada di sana); (b) data seed mock harus masuk `mock-data.ts` dan
  store terpisah; (c) `mock-paritas.js` untuk guard mock. Tanpa itu, paritas mock/real tidak
  lengkap.
- Bukti: `index.ts:4-46` mengimpor tipe dari `../types`; `mock-data.ts` memuat seed
  `MOCK_STOCK`/`MOVEMENT_SEEDS`. PRD hanya menyebut 3 file.
- Perbaikan: daftarkan file wajib: `index.ts`, `real.ts`, `mock.ts`, `types.ts`,
  `mock-data.ts`, `mock-paritas.js`, + test paritas. Jadikan AC "jumlah method baru x file
  yang disentuh konsisten".

### T25 [minor] Risiko e2e `stok.spec.ts` disebut di R15 tapi tidak masuk daftar spec yang dijalankan lebih dulu

- Lokasi: `prd-v5.md:607`, `prd-v5.md:551`.
- Masalah: 12 gate hanya menjalankan `histori.spec.ts` + `ringkasan.spec.ts` lebih dulu. R15
  mengakui `stok.spec.ts` existing bisa rusak karena perubahan default filter, tetapi
  `stok.spec.ts` TIDAK masuk daftar dan tidak ada AC untuk memperbaruinya.
- Perbaikan: tambahkan `stok.spec.ts` ke gate awal + AC eksplisit jumlah baris tabel stok
  default tidak berubah / spec diperbarui.

### T26 [minor] Klaim "batas platform 2048" dan "15 + 1 webhook" tidak akurat dengan working tree

- Lokasi: `prd-v5.md:439`.
- Masalah: Working tree punya 10 `route.ts`. 10 + 5 = 15, jadi klaim "total 15" benar, TAPI
  tidak ada `route.ts` webhook di `app/api` (webhook di luar `app/api`). Ambigu "webhook" bukan
  `route.ts`. Selain itu "Batas platform 2048" tidak berdasar: repo ini bukan Firebase
  Functions (tidak ada config functions), dan Vercel Next.js punya batas berbeda.
- Bukti: 10 route.ts ditemukan; tidak ada config Firebase Functions di repo.
- Perbaikan: hapus/betulkan klaim batas platform atau cantumkan sumber batas yang benar.

---

## E. Testability

### T27 [major] AC bergantung transaksi Firestore nyata (CAS, concurrency, backfill count) tidak punya jalur uji

- Lokasi: `prd-v5.md:619`, `prd-v5.md:537` (CAS transaksi), `prd-v5.md:177` (dua `kirim`
  bersamaan), `prd-v5.md:222` (last-write-wins opname).
- Masalah: AC yang bergantung pada perilaku transaksi Firestore tidak dapat diuji dengan mock
  (`mock.ts` tidak menyentuh Firestore) dan tidak masuk test strategy 12. PRD mengandalkan mock
  "menerapkan aturan bisnis yang sama", tetapi CAS/concurrency tidak disimulasikan.
- Bukti: 12 hanya `mockParitas.test.js` (shape, bukan perilaku tulis); `learnings.md:35`
  mencatat kelas bug ini.
- Perbaikan: tandai AC yang manual/produksi-only, dan tambahkan test model (bukan route)
  dengan Firestore emulator atau `test/helpers/mockFirestore.js` untuk CAS. Minimal: satu test
  yang mensimulasikan `runTransaction` gagal kedua.

### T28 [major] AC tidak terukur: estimasi payload dan "tanpa SLA"

- Lokasi: `prd-v5.md:541`, `prd-v5.md:542`, `prd-v5.md:248`.
- Masalah:
  (a) `prd-v5.md:541` "diperkirakan ~220 KiB" - tidak ada AC yang mengukur ukuran respons nyata,
      sedangkan `listStock()` kini mengembalikan SEMUA 1107 produk (bukan hanya online) +
      `qty_per_gudang` utuh + `stok_gudang_online` per baris (`prd-v5.md:248,251`). Estimasi
      ini kemungkinan meleset.
  (b) `prd-v5.md:542` "Tidak ada SLA baru" - sehingga perubahan ke full-scan 1107 produk tanpa
      paginasi tidak diuji.
- Perbaikan: ubah estimasi menjadi AC terukur (mis. "respons `listStock()` < 500 KiB pada 1107
  produk; bila lebih -> paginasi wajib"). Catat bahwa `getRingkasan()` memanggil `rowsStok()`
  (`real.ts:230`) sehingga ikut terkena dampak full-scan; AC harus menyebut `getRingkasan`
  tetap hanya produk online atau ikut berubah.

### T29 [minor] Test strategy tidak menyebut `test/indexFirestore.test.js` existing tetap harus hijau

- Lokasi: `prd-v5.md:567`, `test/indexFirestore.test.js:71-84`.
- Masalah: `test/indexFirestore.test.js` mengunci bentuk query `listMovements`. PRD menambah
  halaman/query baru; tidak ada jaminan test lama tidak ikut berubah.
- Perbaikan: sebutkan test lama harus tetap hijau dan test v5 memakai helper yang sama.

### T30 [minor] Tidak ada AC untuk concurrency `diterima_oleh` antar tujuan berbeda

- Lokasi: `prd-v5.md:358`, `prd-v5.md:162-163`.
- Masalah: `diterima_oleh` adalah array `{tipe,id,oleh,at}`. AC `prd-v5.md:163` hanya mencegah
  double `terima` untuk tujuan SAMA. Tidak ada AC dua tujuan berbeda menerima bersamaan.
- Perbaikan: tambah AC: dua `terima` tujuan berbeda bersamaan -> kedua entri tercatat,
  `diterima_at` terisi sekali, tidak ada duplikasi entri.

---

## Verifikasi kepatuhan keputusan terkunci

Semua keputusan D1a-D5c + Q1a-Q5a dipatuhi secara literal di PRD:
- Q1a (satu dokumen, satu status, stok asal turun sekali): `prd-v5.md:146,159,286-288` -
  patuh, tapi konsekuensi multi-tujuan belum lengkap (T7).
- Q2a (admin/owner mana pun setujui): `prd-v5.md:59,156,624` - patuh.
- Q3a (filter default `gudang_id`): `prd-v5.md:249,630` - patuh.
- Q4a (`ONLINE` key + backfill 33): `prd-v5.md:275,398,513` - patuh, tapi konflik nilai belum
  ditutup (T8); discovery 5 masih menyebut "agregat" (T5).
- Q5a ("Kirim ke User" hanya user ber-`gudang_id`): `prd-v5.md:185,629` - patuh.

TIDAK ditemukan requirement yang secara eksplisit melanggar keputusan terkunci.

---

## Verdict

LAYAK DENGAN PERBAIKAN

PRD arahnya benar, mengikuti keputusan terkunci, dan pola (route server + admin SDK + guard +
rules default-deny) konsisten dengan kode existing. Tetapi ada 6 blocker yang harus diperbaiki
sebelum implementasi dimulai.

Daftar blocker:

1. T1 - Nama field waktu kontradiktif: skema `dibuat_at` vs index/query `created_at`.
2. T6 - State machine F5 tidak lengkap: `ditolak -> *`, `batal`, jalan keluar `disetujui` yang
   tak akan dikirim tidak didefinisikan.
3. T7 - Konsekuensi Q1a multi-tujuan: aksi "tutup tujuan manual" yang diklaim di
   `prd-v5.md:195` TIDAK ada di endpoint 7; status per tujuan tidak didefinisikan.
4. T8 - Migrasi Q4a tidak menetapkan pemenang saat `qty_per_gudang.ONLINE` dan
   `stok_gudang_online` sudah beda; prioritas migrasi berlawanan dengan boundary baca (R14).
5. T15 - Rules 8 membuka baca `permintaan_gudang`/`opname_gudang` ke SEMUA admin lintas gudang
   (menembus BR7 lewat `get()` by ID).
6. T20 - Index 9 salah format untuk `firestore.indexes.json`, memuat index tak berguna
   (`stock.kode_barang` = doc id), dan tidak memetakan tiap index ke query konkret.

Setelah 6 blocker ditutup, T2, T3, T4, T5, T9, T10, T11, T12, T13, T16, T17, T18, T21, T22,
T23, T24, T25, T26, T27, T28, T29, T30 dapat diselesaikan sebagai revisi non-blocking.
