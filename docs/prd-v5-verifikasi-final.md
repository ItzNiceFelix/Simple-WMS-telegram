# Verifikasi Final PRD v5

Tanggal: 2026-09-16
Verifier: independent final verification authority
Objek: `docs/prd-v5.md` (1155 baris, revisi 3)
Pembanding: `docs/prd-v5-review.md` (T1-T30), `docs/prd-v5-review-2.md` (V1-V15), kode nyata di working tree.
Metode: baca PRD penuh, verifikasi sendiri tiap klaim ke kode nyata (bukan percaya tabel revisi di PRD).

---

## 1. Ringkasan

PRD v5 revisi 3 sudah menyelesaikan seluruh 6 blocker pass-1 (T1-T30) dan 4 blocker pass-2 (V1-V15)
yang ditemukan dua putaran review sebelumnya. Verifikasi langsung ke dokumen menunjukkan V1-V4
benar-benar tertutup (bukan cuma diklaim). Struktur internal PRD konsisten: F1-F10 punya AC yang
dapat diuji, endpoint bagian 7 memetakan ke requirement, koleksi bagian 6 punya model/handler,
guard bagian 6.4 cocok dengan BR11, dan index bagian 9 dipetakan ke query konkret.

Ditemukan 4 temuan baru (Z1-Z4), tidak ada yang berstatus blocker. Satu berstatus major (Z1),
sisanya minor. Semua dapat diselesaikan saat implementasi tanpa mengubah keputusan terkunci.

Verdict: SIAP DENGAN CATATAN.

---

## 2. Verifikasi F1-F10 (satu per satu)

Status: LENGKAP / ADA CELAH.

### F1 - Master gudang
Status: LENGKAP
- AC dapat diuji: aksi tambah/edit/nonaktif/aktifkan, batas 50 (BR15), duplikat nama 409,
  `peringatan_referensi = adminCount + stockKeyCount`, owner-only 403. Semua punya status HTTP,
  pesan literal, dan syarat terukur (panjang 1-60, integer).
- Endpoint `/api/gudang` (bagian 7) merujuk F1. Test `test/gudangMaster.test.js` (bagian 12).
- Trace kode: `admins.role` di `lib/models/admins.js`, pola full scan `real.ts:380-396` untuk
  `peringatan_referensi` cocok dengan kode.

### F2 - Flag gudang per item (qty_per_gudang)
Status: LENGKAP
- AC: set-qty integer >= 0, isolasi antar key, paritas `stok_gudang_online` <-> `qty_per_gudang["ONLINE"]`
  (BR3), 404 kode tanpa stok, 403 gudang luar scope, audit `action_type:"set_qty_gudang"`.
- Endpoint `/api/stok/gudang` merujuk F2. Test `test/stokGudangQty.test.js`.
- Trace kode: `lib/models/stok.js:51-67` `_ubahStokRelatif` memang menulis `stok_gudang_online`;
  paritas BR3 sah dan dibutuhkan oleh F2.

### F3 - Flag gudang per user
Status: LENGKAP
- AC: `set-gudang-user`, `gudang_id:null` menghapus penetapan, 404 user, 400 gudang nonaktif,
  owner-only, audit `admin_role_changes` catatan `set_gudang`, admin bergudang nonaktif ->
  0 baris + `gudang_nonaktif:true` (T11a).
- Test `test/adminGudangJabatan.test.js`.
- Catatan: lihat Z1 (validator `/api/admin` tidak disebut).

### F4 - Jabatan editable
Status: LENGKAP
- AC: 0-40 char, kosong -> null, > 40 -> 400, owner-only, `jabatan` tidak mengubah `role`,
  AC negatif `jabatan:"owner"` pada guest -> tetap 403 + negative-grep (T12).
- Test `test/adminGudangJabatan.test.js`.

### F5 - Permintaan antar-gudang
Status: LENGKAP
- F5.1 mendefinisikan 4 status entri tujuan (`menunggu`/`diterima`/`tidak_terima`/`ditutup`) dan
  6 status dokumen turunan. Tujuan `ditutup` dinyatakan TERMINAL.
- F5.2 tabel transisi memuat jalur legal + semua jalur ilegal 409 (lihat verifikasi V1 di bagian 3).
- F5.3 AC lengkap: `buat`, `setujui`, `tolak`, `batal` (R1), `kirim` (BR1 stok cukup), `terima`,
  `tidak-terima` (kembali ke asal, R2), `tutup-tujuan` (owner, qty ASLI), recompute kombinasi (V2),
  race (V5), matriks tipe x kondisi gudang (V11), jalur pemulihan snapshot hilang (V10).
- Endpoint `/api/permintaan-gudang` merujuk F5/F6/R1/R2/T7. Test `test/permintaanGudang.test.js`.
- Semua baris 409 tabel punya AC padanan di F5.3 dan sebaliknya (bagian 18.4 butir 4).

### F6 - "Kirim ke" multiple
Status: LENGKAP
- AC: entri `{tipe,id}`, snapshot `{tipe,id,nama,jabatan,gudang_id_snapshot}` (T10), dedup,
  self-target 400 (T13), maks 20 tujuan, `tujuan_ids` untuk `array-contains` (T21).
- Endpoint `/api/permintaan-gudang`.

### F7 - Opname dengan approval owner
Status: LENGKAP
- AC: `qty_sistem = qty_per_gudang[gudang_id] ?? null`, item tanpa key -> `belum_terdaftar:true`
  selisih 0 (T14), selisih 0 semua -> langsung `disetujui`, selisih != 0 -> `menunggu_approval`
  tanpa ubah qty, `setujui` CAS nilai sistem -> 409 (T9), tolak, 403 admin, 404 kode, 400 duplikat item.
- Endpoint `/api/opname-gudang`. Test `test/opnameGudang.test.js`.

### F8 - Toggle is-online
Status: LENGKAP
- AC: tulis boolean, 404, 400 non-boolean, 403 guest, `invalidasiCacheProduk()` dipanggil,
  `listStock()` baca semua item. Endpoint `/api/produk/online`. Test `test/produkOnline.test.js`.

### F9 - Filter stok (gudang + online)
Status: ADA CELAH (minor)
- AC: `listStock(filter?)`, default filter `gudang_id` user, boleh ganti gudang (R5), owner semua,
  `gudang_id:null` -> `perlu_gudang:true`, gudang nonaktif -> `gudang_nonaktif:true`, `is_online`
  default true, `StockRow` + `qty_per_gudang` + `qty_gudang_terpilih`, `status`/`kekurangan` dari qty terpilih.
- Celah: bagian 12 tidak punya unit test khusus F9 untuk logika filter `listStock`
  (`sertakan_tanpa_gudang`, `is_online:"semua"`, perhitungan `status`/`kekurangan`). Hanya ada e2e
  `e2e/gudang-v5.spec.ts`. E2E mode mock memang menguji jalur tampilan, tetapi logika filter di
  `mock.ts`/`real.ts` tidak dikunci unit test. Lihat Z3.

### F10 - Migrasi kontrak DataSource
Status: LENGKAP
- AC: `npx tsc --noEmit` exit 0, `listStock()` tanpa argumen setara versi lama, setiap method baru
  punya stub `dataKosong()` (kalau tidak `satisfies DataSource` gagal), semua tipe di `types.ts`.
- Trace kode: `index.ts:68` memang `listStock()` tanpa argumen; `sumber-data.tsx:196-235`
  `dataKosong()` dengan `satisfies DataSource` terkonfirmasi; pemanggil `app/stok/page.tsx:74`,
  `app/permintaan/page.tsx:72`, `app/page.tsx:45` terkonfirmasi ada persis.

---

## 3. Verifikasi V1-V4 (blocker pass-2, dicek sendiri ke PRD)

### V1 - F5.2 semua kombinasi ilegal
Status: TERTUTUP (terverifikasi).
Bukti: tabel F5.2 baris 191-216. Kombinasi kritis ada sebagai baris eksplisit:
- baris 202: status entri `diterima` + `terima`/`tidak-terima`/`tutup-tujuan` -> 409 `"Tujuan ini sudah diterima."`
- baris 203: status entri `tidak_terima` + ketiganya -> 409 `"Tujuan ini sudah tidak diterima."`
- baris 204: status entri `ditutup` + ketiganya -> 409 `"Tujuan ini sudah ditutup."`
- baris 205: indeks di luar `tujuan[]` -> 409 `"Tujuan tidak ditemukan."`
- baris 206: `dikirim` + `kirim` ulang -> 409; baris 207: `dikirim` + setujui/tolak/batal/ubah-item -> 409
- baris 208-213: `disetujui`/`menunggu` x aksi -> 409; baris 214-216: terminal `ditolak`/`dibatalkan`/`selesai`
Aturan umum (baris 218-220) menegaskan legalitas ditentukan status ENTRI, bukan hanya status dokumen.
AC F5.3 baris 262-277 memuat padanan tiap baris 409. Korespondensi dua arah dikunci AC global #7.
Kesimpulan: bukan cuma diklaim, benar ada.

### V2 - AC recompute kombinasi
Status: TERTUTUP (terverifikasi).
Bukti: F5.3 baris 251-257 memuat 6 AC eksplisit: (a) 3 tujuan `diterima`+`tidak_terima`+`ditutup`
-> `selesai`; (b) `diterima`+`menunggu` -> `dikirim`; (c) `ditutup`+`menunggu` -> `dikirim`;
(d) `diterima`+`diterima`+`tidak_terima` -> `selesai`; (e) semua `ditutup` -> `selesai`;
(f) `selesai_at` terisi sekali. Diuji di `test/permintaanGudang.test.js` (bagian 12 baris 909)
dan AC global #32. Dapat diuji eksak (assert status dokumen per kombinasi).

### V3 - Larangan aksi pada tujuan `ditutup`
Status: TERTUTUP (terverifikasi).
Bukti: F5.3 baris 246: "`tidak-terima` HANYA valid bila status ENTRI masih `menunggu`; pada tujuan
`ditutup` -> 409 `"Tujuan ini sudah ditutup."` dan `qty_per_gudang[dari_gudang_id]` TIDAK berubah
(assert sebelum == sesudah)". F5.1 baris 185 + 219 menyatakan tujuan `ditutup` terminal. F5.2 baris 204
menambah baris 409 untuk ketiga aksi. AC global #33. Test urutan `tutup-tujuan` lalu `tidak-terima`.
Jalur penciptaan stok dari "barang hilang" tertutup.

### V4 - `tutup-tujuan` mencatat qty ASLI
Status: TERTUTUP (terverifikasi).
Bukti: F5.2 baris 201: `stock_movements` `type:"koreksi_manual"`, `action_type:"tutup_tujuan"`,
`gudang_id:<dari_gudang_id>`, `qty` = qty ASLI (BUKAN 0). F5.3 baris 248 mengulang dan menambah
respons `qty_hilang` + jalur rekonsiliasi query `stock_movements where action_type == "tutup_tujuan"`.
Bagian 19 (V4b) merinci field movement termasuk `created_at`/`created_by`. R17 (baris 967) dan
AC global #19. Grep literal qty nol bersih (bagian 18.4 butir 1). Bukan 0.

---

## 4. Cek konsistensi lintas bagian

### A. Konsistensi struktur
- F1-F10 punya AC yang dapat diuji (status HTTP, pesan literal, batas angka, syarat terukur).
  F1-F8 punya unit test di bagian 12; F9 lewat e2e; F10 lewat gate tsc. Tidak ada requirement
  tanpa test sama sekali; F9 hanya tanpa unit test khusus (Z3).
- Endpoint bagian 7 -> requirement: `/api/gudang`->F1, `/api/stok/gudang`->F2,
  `/api/permintaan-gudang`->F5/F6, `/api/opname-gudang`->F7, `/api/produk/online`->F8,
  `/api/admin`->F3/F4. Semua endpoint dirujuk requirement. Tidak ada endpoint yatim.
- Koleksi bagian 6 -> model/handler: `gudang`->F1, `permintaan_gudang`->F5/F6, `opname_gudang`->F7,
  5 guard->BR11/6.4, `stock.qty_per_gudang`->F2, `admins.jabatan/gudang_id`->F3/F4. Semua terpanggil.
  Catatan: file model server-side untuk koleksi baru tidak didaftar (lihat Z2).
- Guard bagian 6.4 vs BR11: 5 koleksi guard (`permintaan_gudang_guard`, `opname_gudang_guard`,
  `gudang_guard`, `stok_gudang_guard`, `produk_online_guard`) semuanya muncul di BR11 Kategori A.
  Kategori B (`set-jabatan`, `set-gudang-user`) tanpa guard dan tidak ada di 6.4. Konsisten.
- Index bagian 9 -> query: #1 `status`+created_at -> `listPermintaanGudang({status})` (termasuk
  daftar nyangkut V8); #2 `dari_gudang_id`; #3 `created_by`; #4 `tujuan_ids` ARRAY_CONTAINS;
  #5 `opname_gudang.status`; #6 `opname_gudang.gudang_id`; #7 `admins.gudang_id` -> `listUserTujuan`.
  Tiap index dipetakan ke fungsi konkret. Index mati (`stock.kode_barang`, `gudang.aktif`,
  `stock_movements.gudang_id`) sudah dibuang (T20/V9). Format JSON final cocok dengan pola
  `test/indexFirestore.test.js:24-50` (collectionGroup + fields[].fieldPath/order).

### B. Konsistensi lintas bagian
- Bagian 3 (matrix) vs bagian 7 vs bagian 14: matrix menandai owner/admin/guest per aksi; bagian 7
  level minimal cocok (gudang owner-only, opname setujui owner, dll); AC global #1/#4/#9/#10/#13/#16
  cocok. Tidak ada kontradiksi.
- Bagian 11 vs 6.5: `items <= 200` muncul konsisten di F5.2 (baris 228), BR16 (baris 507), skema 6.2
  (baris 541), bagian 11 (baris 882), AC global #28. `tujuan <= 20` konsisten di F5.3 (baris 226),
  F6 (baris 314), skema 6.2 (baris 538), bagian 11 (baris 882), AC global #28. Batas 50 gudang
  konsisten di F1, BR15, 6.5, bagian 11, AC global #1. Perhitungan 1 MiB 6.5 (baris 621-623) selaras.
- Bagian 13 (risiko) vs bagian 14 (AC): R1->AC#4, R2->AC#21, R3->AC#2, R4->AC#23, R5->AC#22,
  R9->paritas BR3, R10->AC#36, R14->AC#2, R15->AC#21, R16->AC#4/#23, R17->AC#19. Tiap risiko
  punya mitigasi yang jadi AC atau test. Tidak ada risiko tanpa AC.
- BR1-BR16: tidak ada kontradiksi. BR4 (qty per gudang integer >= 0) konsisten F2/F7; BR5 (status
  per tujuan) konsisten F5; BR7 (scope hanya tulis) konsisten F9/8; BR10 (audit tidak rollback)
  konsisten F2/F5; BR11 (dua kategori) konsisten 6.4; BR12 (snake_case + created_at) konsisten 6.1-6.3.
- R1-R5 + V4b: R1 (`batal`) konsisten matrix/F5.2/F5.3/6.2/7/BR11; R2 konsisten F5.1/BR5/6.2/12/14;
  R3 konsisten F1/BR15/6.5/11; R4 konsisten 6.1-6.3/BR12/AC#5; R5 konsisten 1/3/8/BR7/F9/R16/AC#4/#17/#23;
  V4b konsisten F5.1/F5.2/F5.3/R17/bagian 19/AC#19. Diterapkan konsisten.

### C. Migrasi/backfill
Aturan pemenang tunggal T8 (bagian 10 langkah #2) selaras boundary baca R14
(`qty_per_gudang["ONLINE"] ?? stok_gudang_online ?? 0`). Transaksi per dokumen menutup race
`_ubahStokRelatif`. Verifikasi dapat dijalankan ulang: `scripts/verify-backfill.mjs` (bagian 10a) +
AC global #2. Tidak ada kontradiksi migrasi vs baca.

---

## 5. Temuan baru

### Z1 [major] Aksi baru `/api/admin` tidak menyebut file validator `validasiTulisV3a.js`
- Lokasi: PRD bagian 7 baris 657, F3 baris 134, F4 baris 152.
- Masalah: PRD menyatakan `/api/admin` adalah "route existing, bukan route baru" dengan aksi baru
  `set-gudang-user` + `set-jabatan`. Namun route existing memanggil `validasiAksiAdmin` di
  `lib/dashboard/validasiTulisV3a.js:224-259`, yang dispatcher-nya HANYA mengenal `approve-akses`,
  `tolak-akses`, `tambah-produk`, `konfirmasi-draft`, `kata-kunci`. Aksi di luar daftar jatuh ke
  HTTP 400. Agar `set-gudang-user`/`set-jabatan` berfungsi, `validasiTulisV3a.js` WAJIB diperluas.
  File ini tidak muncul di F10 (daftar file wajib hanya DataSource), tidak muncul di bagian 12
  (test), dan tidak muncul di bagian 7.
- Bukti kode: `app/api/admin/route.ts:65` memanggil `validasiAksiAdmin(body)`;
  `lib/dashboard/validasiTulisV3a.js:248-249` menolak aksi selain daftar.
- Dampak: implementator bisa lupa memperluas validator; AC F3/F4 gagal tanpa pesan yang menjelaskan.
  Bukan blocker desain (mudah diperbaiki), tetapi harus tertulis agar tidak ditemukan terlambat.
- Rekomendasi: tambahkan `validasiTulisV3a.js` ke daftar file wajib (F10 atau bagian 7) + baris test
  di `test/adminGudangJabatan.test.js` yang memastikan aksi baru diterima dispatcher.

### Z2 [minor] File model/handler server untuk koleksi baru tidak didaftar
- Lokasi: PRD bagian 7, F10, bagian 12.
- Masalah: PRD menyebut route tulis via firebase-admin tetapi tidak menyebut file model/handler
  server (mis. helper tulis `gudang`, `permintaan_gudang`, `opname_gudang` di `lib/models/` atau
  `lib/dashboard/`). F10 hanya mendaftar file DataSource dashboard. Implementator harus menebak
  struktur handler server. Kode existing memakai pola `lib/dashboard/aksiDraft.js` untuk logika tulis.
- Dampak: tidak memblokir, tetapi menambah risiko file tidak konsisten dengan pola existing.
- Rekomendasi: cantumkan nama file model/handler server yang akan dibuat/diubah.

### Z3 [minor] F9 tidak punya unit test khusus logika filter `listStock`
- Lokasi: F9 baris 375-391, bagian 12 baris 905-914.
- Masalah: bagian 12 tidak mencantumkan unit test untuk F9 (filter `gudang_id`, `sertakan_tanpa_gudang`,
  `is_online:"semua"`, perhitungan `status`/`kekurangan` dari `qty_gudang_terpilih`). Hanya e2e
  `e2e/gudang-v5.spec.ts`. E2E mode mock tidak mengunci setiap cabang filter.
- Dampak: cabang filter (mis. `sertakan_tanpa_gudang`, item tanpa dokumen stock) tidak dikunci test
  eksak; regresi halus bisa lolos.
- Rekomendasi: tambahkan test unit F9 (mis. `test/stockFilter.test.js`) untuk cabang filter dan
  perhitungan status.

### Z4 [minor] Nomor AC global tidak berurutan (#31 muncul setelah #36)
- Lokasi: bagian 14 baris 1012.
- Masalah: AC #31 ditulis setelah #36 sehingga urutan nomor tidak monoton.
- Dampak: kosmetik, mempersulit referensi silang saat implementasi.
- Rekomendasi: urutkan ulang (cosmetic), tanpa perubahan isi.

---

## 6. Verdict

SIAP DENGAN CATATAN

Alasan:
1. Semua 6 blocker pass-1 (T1-T30) dan 4 blocker pass-2 (V1-V15) tertutup secara nyata, bukan
   hanya diklaim. V1, V2, V3, V4 diverifikasi langsung ke isi PRD dan cocok.
2. Struktur internal PRD konsisten: F1-F10 ber-AC teruji, endpoint/koleksi/guard/index terpetakan,
   matrix vs endpoint vs AC global cocok, batas 200/20/50 konsisten di semua tempat, R1-R5 + V4b
   diterapkan konsisten, tidak ada kontradiksi antar BR.
3. Tidak ada temuan blocker baru. Temuan baru Z1 (major) dan Z2/Z3/Z4 (minor) bersifat melengkapi
   daftar file dan test, bukan mengubah desain atau keputusan terkunci.

Langkah wajib sebelum/saat implementasi:
- Sertakan `lib/dashboard/validasiTulisV3a.js` sebagai file yang WAJIB diubah (Z1).
- Tambahkan unit test F9 untuk cabang filter (Z3).
- Cantumkan file model/handler server (Z2).
- Rapikan nomor AC global (Z4).

Setelah catatan Z1-Z4 dimasukkan ke rencana implementasi, PRD dapat dijadikan dasar implementasi.

VERIFIED