# Review Adversarial Arsitektur v5

Status: review pass-1 (adversarial).
Tanggal: 2026-09-16.
Dokumen yang direview: `docs/architecture-v5.md` (669 baris).
Pembanding: `docs/prd-v5.md` (1155 baris), kode existing (`lib/models/stok.js`,
`lib/dashboard/data/index.ts`, `lib/dashboard/data/real.ts`,
`lib/dashboard/data/mock.ts`, `app/api/admin/route.ts`,
`app/api/stok/mutasi/route.ts`, `lib/sheets/syncStokDuaArah.js`,
`lib/models/adminRoleChanges.js`, `firestore.rules`, `firestore.indexes.json`,
`docs/learnings.md`).

## Ringkasan eksekutif

Arsitektur v5 secara struktural sudah mengikuti PRD: ADR terkunci, domain model,
DataSource, guard, wave, dan gate test semua ada. Namun ada 3 blocker yang membuat
implementasi langsung dari dokumen ini akan menghasilkan perilaku yang BERTENTANGAN
dengan PRD atau GAGAL memenuhi AC global. Sebagian besar sisanya adalah kelalaian
enumerasi dan satu klaim faktual tentang kode sync yang tidak benar.

Verdict: `LAYAK DENGAN PERBAIKAN`. 3 blocker WAJIB ditutup sebelum eksekusi wave.

---

## A. Kelengkapan vs PRD

### A1 [major] - Daftar method DataSource baru tidak dienumerasi
- Lokasi: `docs/architecture-v5.md:209`, `docs/architecture-v5.md:515-516`.
- Masalah: arsitektur hanya menulis "~20 method baru" tanpa daftar. PRD bagian 12
  (`docs/prd-v5.md:929`) mengeNUMERASI 20 method. Beberapa method kritis BAHKAN TIDAK
  DISEBUT namanya di arsitektur: `listUserTujuan` (dipakai F6 "Kirim ke: User" dan
  index #7), `toggleOnline`, `batalPermintaanGudang`, `tolakPermintaanGudang`,
  `ubahItemPermintaan`, `setGudangUser`, `setJabatan` tidak muncul sebagai anggota
  `DataSource`.
- Bukti: `docs/prd-v5.md:929` mendaftar 20 method; grep `listUserTujuan` pada
  `docs/architecture-v5.md` = 0 hit.
- Perbaikan: salin daftar 20 method PRD ke bagian 8 arsitektur sebagai kontrak beku,
  atau rujuk eksplisit "daftar method = PRD bagian 12 paritas mock".
- Catatan: `listUserTujuan` juga butuh index #7 (`admins.gudang_id ASC, name ASC`).

### A2 [major] - Validasi `buat` permintaan tidak menyebut cek kode_barang ada di `stock`
- Lokasi: `docs/architecture-v5.md:160`, `docs/architecture-v5.md:171-174`.
- Masalah: PRD F5.3 (`docs/prd-v5.md:224`) mensyaratkan "tiap `kode_barang` ada di
  `stock`" saat `buat`. Arsitektur `buatPermintaan` hanya menyebut validasi snapshot
  `TujuanEntri`, dedup tujuan, dedup item. Tidak ada langkah cek keberadaan stok.
- Bukti: `docs/prd-v5.md:224` vs `docs/architecture-v5.md:160`.
- Perbaikan: tambah langkah validasi "kode_barang ada di `stock` -> 400/404" di
  `validasiItems` atau `buatPermintaan`.

### A3 [minor] - `batal` otorisasi pembuat vs staff tidak eksplisit
- Lokasi: `docs/architecture-v5.md:164`.
- Masalah: PRD F5.3 (`docs/prd-v5.md:236`) mewajibkan pemanggil BUKAN pembuat DAN BUKAN
  admin/owner -> 403. Arsitektur hanya menulis "otorisasi pembuat ATAU staff (R1)"
  pada model, dan tidak menjelaskan di route siapa yang dievaluasi (role mana, field
  pembuat mana).
- Perbaikan: sebut predikat `oleh == created_by || role in {owner,admin}` di model,
  route memetakan gagal -> 403.

### A4 [minor] - `verify-backfill.mjs` disebut, tapi tidak ada kontrak output eksplisit
- Lokasi: `docs/architecture-v5.md:213`, `docs/architecture-v5.md:572`.
- Masalah: arsitektur menyebut read-only + exit code, tetapi tidak menyatakan sifat
  "read-only" secara eksplisit sebagai invariant (tidak boleh menulis `stock`). PRD
  bagian 10a (`docs/prd-v5.md:862-871`) menekankan read-only.
- Perbaikan: tambah satu kalimat: "script hanya `get`, tidak ada `set`/`update`,
  exit 1 bila selisih > 0".

---

## B. Kelayakan terhadap kode nyata

### B1 [blocker] - `tutup-tujuan` salah mencatat `gudang_id` (tujuan vs asal)
- Lokasi: `docs/architecture-v5.md:122` (ADR-6), `docs/architecture-v5.md:372`.
- Masalah: arsitektur menulis `gudang_id` = **tujuan**. PRD MENEGASKAN
  `gudang_id:<dari_gudang_id>` (gudang ASAL) di 4 tempat. Ini bukan detail kosmetik:
  rekonsiliasi "barang hilang" dihitung dari `stock_movements where
  action_type=="tutup_tujuan"` yang di-`gudang_id` asal, karena stok asal yang sudah
  turun dan tidak kembali. Memakai gudang tujuan membuat audit nyangkut salah gudang.
- Bukti: `docs/prd-v5.md:201`, `docs/prd-v5.md:248`, `docs/prd-v5.md:279`,
  `docs/prd-v5.md:1144` semua `gudang_id:<dari_gudang_id>`. Bandingkan
  `docs/architecture-v5.md:122` "`gudang_id` tujuan" dan `:372` "`gudang_id`" (lanjut
  baris 373 "tujuan").
- Perbaikan: ubah ADR-6 dan langkah 5.4 menjadi `gudang_id: dari_gudang_id` + `qty`
  ASLI barang tujuan. Test `test/permintaanGudang.test.js` WAJIB assert nilai ini.

### B2 [blocker] - `getRingkasan()` tidak bisa "tetap hitung baris online" setelah `rowsStok()` jadi semua produk
- Lokasi: `docs/architecture-v5.md:517-523`.
- Masalah: arsitektur mengubah `rowsStok()` (baris 164-187 `real.ts`) untuk membaca
  SELURUH produk (bukan hanya online) lalu memfilter di jalur data. Tetapi di baris 523
  arsitektur menuntut `getRingkasan()` "tetap menghitung dari baris ONLINE saja".
  `getRingkasan()` existing memanggil `rowsStok()` dan memakai `rows.length` sebagai
  `totalProdukOnline`. Setelah perubahan, `rows.length` = semua produk (1107), bukan
  online. Arsitektur TIDAK menjelaskan mekanisme pemisahan (parameter `rowsStok`?
  filter internal? `listStock` vs helper terpisah?).
- Bukti: `lib/dashboard/data/real.ts:228-255` (`getRingkasan` -> `rowsStok()` ->
  `totalProdukOnline: rows.length`); `docs/prd-v5.md:884` (T28b) menuntut arti
  `getRingkasan` TIDAK berubah; AC global #26 `docs/prd-v5.md:1002`.
- Perbaikan: tetapkan salah satu: (a) `rowsStok(opsi?)` dengan default online untuk
  `getRingkasan` dan default semua untuk `listStock`; atau (b) `getRingkasan`
  memfilter `rows.filter(is_online_product)`. Tulis di bagian 8 dan kunci dengan test.

### B3 [major] - Audit `set-gudang-user` memakai field `catatan` yang tidak ada di model
- Lokasi: `docs/architecture-v5.md:199`.
- Masalah: arsitektur menuntut audit ke `admin_role_changes` "dengan
  `catatan:"set_gudang"`". Fungsi existing `catatPerubahanRole` TIDAK menerima parameter
  `catatan` dan tidak menulis field itu; `RoleChangeDoc` di `real.ts` juga tidak
  memetakan `catatan`. Arsitektur tidak menyebut modifikasi
  `lib/models/adminRoleChanges.js` atau `lib/dashboard/types.ts` RoleChangeDoc.
  Akibatnya AC F3 "dicatat dengan `catatan:"set_gudang"`" tidak tercapai.
- Bukti: `lib/models/adminRoleChanges.js:4-18` (payload tanpa `catatan`),
  `lib/dashboard/data/real.ts:398-412` (RoleChangeDoc tanpa `catatan`);
  `docs/prd-v5.md:139`.
- Perbaikan: tambahkan `catatan` ke signature `catatPerubahanRole` (opsional,
  backward compatible) + ke `RoleChangeDoc`/mapping `listRoleChanges`, dan sebut file
  ini di daftar "DIUBAH" arsitektur.

### B4 [blocker] - Klaim A10 tentang sync salah faktual
- Lokasi: `docs/architecture-v5.md:257` (tabel 4.2, `tandaiTersinkron`), `docs/architecture-v5.md:628` (A10).
- Masalah: arsitektur dua kali menyatakan `lib/sheets/syncStokDuaArah.js` menulis stok
  lewat `tambahStok`/`kurangiStok` SEBELUM `tandaiTersinkron`, dan menjadikan itu
  mitigasi risiko paritas. FAKTA: `syncStokDuaArah.js` TIDAK memanggil
  `tambahStok`/`kurangiStok` sama sekali. Ia hanya `tandaiTersinkron` (tidak menulis
  stok) + `catatPergerakanStok` + `pushNilaiKeSheet` (menulis ke Google Sheets).
  Stok Firestore TIDAK berubah oleh sync pada kedua arah (firestore-menang maupun
  produk-baru).
- Bukti: `lib/sheets/syncStokDuaArah.js:19` hanya import `{ ambilStok, tandaiTersinkron }`;
  `lib/sheets/syncStokDuaArah.js:481`, `:530` panggil `tandaiTersinkron`;
  `lib/sheets/syncStokDuaArah.js:506`, `:558-566` tulis ke Sheets. Tidak ada
  `tambahStok`/`kurangiStok`.
- Dampak: karena premisnya salah, risiko "sync menimpa map" yang diklaim A10 TIDAK ADA;
  tetapi sebaliknya, `tandaiTersinkron` di dokumen yang belum backfill akan membuat
  `last_synced_value` ada tanpa `qty_per_gudang["ONLINE"]` sampai backfill jalan.
  Arsitektur harus meralat klaim dan memastikan urutan migrasi (bagian 10 PRD) tetap
  sebelum sync dipakai.
- Perbaikan: hapus kalimat "lewat `tambahStok`/`kurangiStok`" di baris 257 dan 628;
  ganti reason yang benar (sync tidak menulis stok Firestore sehingga tidak ada risiko
  timpa map; risiko sebenarnya = dokumen belum backfill -> fallback baca menutup).

### B5 [minor] - `lib/reminder/*` diklaim konsumen tulis `_ubahStokRelatif`
- Lokasi: `docs/architecture-v5.md:306`.
- Masalah: arsitektur mendaftar `lib/reminder/*` sebagai konsumen `_ubahStokRelatif`
  yang harus tetap hijau. Faktanya `lib/reminder/cekReorderPoint.js` dan
  `lib/reminder/reminderHarian.js` hanya MEMBACA `stok_gudang_online` via `ambilStok` /
  cache; tidak memanggil `_ubahStokRelatif`.
- Bukti: `lib/reminder/cekReorderPoint.js:11,30,41`; `lib/reminder/reminderHarian.js:14,39,44`.
- Perbaikan: pindahkan `lib/reminder/*` dari daftar "konsumen signature" ke daftar
  "konsumen baca yang dipastikan tidak rusak".

### B6 [minor] - `mock.ts` 1165 baris: ambang >1800 masuk akal, tetapi hitungan tidak diproyeksikan
- Lokasi: `docs/architecture-v5.md:210`, `docs/architecture-v5.md:629` (A11).
- Masalah: arsitektur menyebut "1165 baris + ~20 method + aturan BR" dan ambang >1800.
  Verifikasi: `mock.ts` = 1165 baris. Klaim awal benar. Namun penambahan 20 method
  dengan aturan bisnis (BR1/BR5/BR6) + store baru mudah melewati 1800; kondisional
  "hanya bila > 1800" tidak memberi sinyal kapan harus memutuskan.
- Bukti: `Get-Content lib/dashboard/data/mock.ts` = 1165 baris.
- Perbaikan: biarkan ambang, tetapi tetapkan titik keputusan di Wave 3 (setelah
  DataSource selesai) untuk mengukur ulang, bukan di akhir.

---

## C. Konsistensi internal arsitektur

### C1 [major] - Jumlah index tidak konsisten (7 vs 8)
- Lokasi: `docs/architecture-v5.md:214`, `docs/architecture-v5.md:622`.
- Masalah: arsitektur dua kali menyatakan "8 index baru" / "mengunci 8 index". PRD
  bagian 9 (`docs/prd-v5.md:716-724`) menetapkan 7 index (#1-#7) dan hanya menulis 7
  blok JSON. Tidak ada index ke-8 yang dijelaskan.
- Bukti: `docs/prd-v5.md:718-724` (7 baris tabel), `docs/prd-v5.md:739-828` (7 blok JSON).
- Perbaikan: selaraskan angka menjadi 7, atau sebutkan index ke-8 yang dimaksud
  (mis. jika arsitektur menghitung `admins` #7 sebagai dua varian, nyatakan eksplisit).

### C2 [major] - Penempatan `setQtyGudang` dan helper qty gudang tidak konsisten
- Lokasi: `docs/architecture-v5.md:151-155` vs `docs/architecture-v5.md:262-284`.
- Masalah: bagian 3 menaruh `setQtyGudang` di `lib/models/stokGudang.js`, sedangkan
  bagian 4.3 menaruh `setQtyGudang` di `lib/models/stok.js`. Bagian 3 menaruh
  `tambahQtyPerGudang` (helper transaksi) di `stokGudang.js`, sedangkan 4.3 menamai
  `tambahStokGudang`/`kurangiStokGudang` di `stok.js`. Arsitektur memberi catatan
  rekonsiliasi di baris 271-283, tetapi bagian 3 belum diedit -> implementer membaca
  dua daftar bertentangan.
- Bukti: `docs/architecture-v5.md:151` vs `:271`.
- Perbaikan: perbaiki bagian 3 agar sinkron dengan bagian 4.3 (satu sumber kebenaran
  lokasi fungsi).

### C3 [minor] - `_bacaParitasOnline` vs `normalisasiQtyPerGudang` relasi tidak jelas
- Lokasi: `docs/architecture-v5.md:154`, `:239`, `:287`, `:293`.
- Masalah: arsitektur mendefinisikan `_bacaParitasOnline(data)` dan
  `normalisasiQtyPerGudang(data)` dengan perilaku mirip (keduanya fallback online +
  buang non-angka). Relasi (satu memakai yang lain?) tidak dinyatakan.
- Perbaikan: nyatakan `_bacaParitasOnline = normalisasiQtyPerGudang(data).ONLINE ?? 0`.

### C4 [minor] - Wave 3 menyentuh `produk.js` tetapi dependency model `produk` tidak disebut
- Lokasi: `docs/architecture-v5.md:574-584`.
- Masalah: Wave 3 menyentuh `lib/models/produk.js` (`setOnlineProduk`) dan
  `app/api/produk/online/route.ts`, tetapi dependency hanya menyebut "Wave 1, Wave 2".
  `setOnlineProduk` memakai `invalidasiCacheProduk` yang ada di `produk.js`; tidak ada
  dependency baru, jadi ini hanya catatan konsistensi. Tidak blocker.
- Perbaikan: tidak wajib, cukup pastikan urutan file dalam wave sama.

### C5 [minor] - Gate wave ada, tetapi Wave 3 tidak mengunci `getRingkasan` (terkait B2)
- Lokasi: `docs/architecture-v5.md:580-584`.
- Masalah: gate Wave 3 menyebut "shape paritas identik" dan e2e lama, tetapi tidak
  menyebut test yang mengunci arti `getRingkasan` (AC global #26). Bila B2 tidak
  diperbaiki, gate Wave 3 tetap hijau sementara AC #26 gagal.
- Perbaikan: tambah assert `getRingkasan().totalProdukOnline == count(is_online)` di
  `test/indexFirestoreV5.test.js` atau test paritas Wave 3.

### C6 [minor] - Wave 4 dan 5 "bisa paralel" menyentuh `test/indexFirestoreV5.test.js` sama (sudah disebut "perluas")
- Lokasi: `docs/architecture-v5.md:599`.
- Masalah: Wave 5 menyebut "`test/indexFirestoreV5.test.js` (perluas)", Wave 3 juga
  menyentuh file itu. Bila Wave 4 dan 5 paralel di worktree terpisah, konflik file test
  muncul. Arsitektur tidak menetapkan pemilik file.
- Perbaikan: tetapkan Wave 3 sebagai pemilik awal; Wave 5 menambah blok terpisah,
  urutan seri untuk file test bersama.

---

## D. Blocker implementasi (Firebase/Firestore)

### D1 [major] - Batas 500 dokumen/transaksi tidak dihitung eksplisit
- Lokasi: `docs/architecture-v5.md:627` (A9), `:394` (5.6).
- Masalah: arsitektur mengakui risiko A9 sebagai "bila melebihi batas SDK, pecah" tanpa
  menghitung. Aksi yang menyentuh banyak dokumen:
  - `setujui` opname 200 item: 200 `trx.get(stock)` + 200 `trx.set(stock)` + 1 `trx.set(opname)` = 401 operasi dokumen (baca+tulis).
  - `terima` 200 item tujuan: 200 `trx.get(stock)` + 200 `trx.set(stock)` + 1 `trx.set(permintaan)` = 401.
  Keduanya MASIH di bawah batas 500, tetapi arsitektur tidak menyatakan angka ini,
  sehingga tidak terbukti "aman" maupun punya rencana bila batas diturunkan / item
  dinaikkan.
- Bukti: batas Firestore 500 dokumen per transaksi; `docs/prd-v5.md:962` (R12) juga
  hanya kualitatif; `docs/architecture-v5.md:394` (satu `trx.set` per dokumen).
- Perbaikan: hitung eksplisit di A9: "maks 200 item -> maks 401 operasi < 500; batas
  `items<=200` WAJIB dipertahankan; bila dinaikkan, pecah batch".

### D2 [major] - CAS + recompute di dokumen LAIN dijelaskan, tetapi tidak ada catatan apakah SDK firebase-admin mendukungnya
- Lokasi: `docs/architecture-v5.md:320-324`, `docs/architecture-v5.md:344-356`.
- Masalah: 5.2/5.6 membaca `permintaanRef`/`opnameRef` + banyak `stockRef` dalam satu
  `runTransaction`, lalu menulis keduanya. Ini DIDUKUNG Firestore (`runTransaction` multi
  dokumen), tetapi arsitektur menyatakan "CAS pada `status` + `tujuan[i].status`" tanpa
  menyebut bahwa `tujuan[]` adalah array dalam SATU dokumen -> CAS sesungguhnya hanya
  pada field `status` dokumen (versi dokumen). Retry SDK menjamin serialisasi. Ini
  perlu dinyatakan supaya test model (V7) mensimulasikan semantik yang benar (bukan
  per-elemen array).
- Perbaikan: tambah kalimat "CAS = optimistik pada seluruh dokumen
  (`permintaan_gudang`); `tujuan[i]` ikut karena transaksi menulis ulang seluruh array;
  SDK retry otomatis".

### D3 [minor] - Hotspot `stock/{kode}` diakui, tetapi tidak ada mitigasi kontensi untuk `terima` bersamaan multi-tujuan ke produk sama
- Lokasi: `docs/architecture-v5.md:73` (ADR-1), `:619` (A1).
- Masalah: ADR-1 mengakui hotspot, A1 menyebut "operasi 200 item menyentuh 200 dokumen".
  Namun kontensi yang lebih halus: dua `terima` bersamaan menulis `stock/{kode}` yang
  SAMA untuk gudang BERBEDA -> keduanya konflik pada satu dokumen dan salah satu
  retry. Ini benar secara konsistensi, tetapi memperbesar latency/ABORT; arsitektur
  tidak menyebut.
- Perbaikan: catat di A1 bahwa retry SDK menangani, dan operasi massal di luar jam
  sibuk (sudah ada) berlaku juga untuk `terima`.

### D4 [minor] - `verify-backfill.mjs` dinyatakan read-only, tidak ada jaminan tidak menulis pada koleksi lain
- Lokasi: `docs/architecture-v5.md:213`.
- Perbaikan: sama dengan A4, tegaskan hanya `get`.

---

## E. Guard dan keamanan

### E1 [minor] - Guard `{merge:false}` per uid: ukuran dokumen dibatasi, benar; `payload` berbeda per aksi tidak dibahas
- Lokasi: `docs/architecture-v5.md:417-425`.
- Masalah: desain guard benar (ID=uid, `{merge:false}`, TTL 10s, best-effort). Untuk
  `permintaan_gudang_guard`, field dibandingkan `kunci` per aksi; `{merge:false}`
  menimpa seluruh dokumen sehingga field aksi lama hilang. Ini disengaja. Tidak ada
  temuan blocking; cukup catat bahwa `tulisGuardV5` harus menyimpan field pembanding
  yang berbeda per koleksi di payload agar perbandingan "SELURUH field payload cocok"
  bekerja.
- Perbaikan: contoh payload per koleksi ditulis eksplisit (sudah ada tabel), cukup
  pastikan implementasi membandingkan key yang disebut tabel.

### E2 [minor] - READ lintas-scope vs TULIS terbatas: konsisten dengan R5, tetapi route baru harus memastikan TIDAK ada read data lintas-scope yang mem-bypass scope tulis
- Lokasi: `docs/architecture-v5.md:53-54`, `:463-464`.
- Masalah: arsitektur konsisten R5 (read terbuka, tulis dibatasi). Namun `listStock({gudang_id})`
  read lintas gudang sengaja diizinkan; `set-qty`/`buat` tulis di-scope. Tidak ada
  temuan. Satu hal yang perlu dipastikan: respons route TULIS (`kirim`/`terima`) memuat
  `qty_per_gudang` gudang yang berubah; ini read lintas-scope lewat route server, tetapi
  konsisten R5. Tidak blocker.
- Perbaikan: tidak ada; catat sebagai keputusan sadar (sudah ada).

### E3 [minor] - `verify-backfill.mjs` sifat read-only disebut, tanpa test yang mengunci
- Lokasi: `docs/architecture-v5.md:213`, `docs/architecture-v5.md:668-669`.
- Masalah: tidak ada test yang memastikan script tidak menulis. Karena script berada di
  luar gate unit, ini hanya bisa diverifikasi review kode.
- Perbaikan: tambah komentar read-only di file + review grep `set|update` saat PR.

### E4 [minor] - `tolakOrigin` -> sesi -> rate limit -> role -> validasi urutan baru diuji hanya untuk guest + body invalid
- Lokasi: `docs/architecture-v5.md:657-661`.
- Masalah: `test/urutanGuardV5.test.js` mengunci guest menang sebelum validasi. Urutan
  untuk authenticated admin (rate limit sebelum atau sesudah role) tidak dijelaskan
  apakah diuji. PRD T18 (`docs/prd-v5.md:646`) melock urutan lengkap.
- Perbaikan: tambah kasus admin + rate limit terlampaui -> 429 sebelum role, agar
  urutan penuh terkunci.

---

## F. Matriks temuan per severity

| Severity | Jumlah | ID |
|---|---|---|
| blocker | 3 | B1, B2, B4 |
| major | 7 | A1, A2, B3, C1, C2, D1, D2 |
| minor | 13 | A3, A4, B5, B6, C3, C4, C5, C6, D3, D4, E1, E2, E3, E4 |

---

## G. Verdict

`LAYAK DENGAN PERBAIKAN`.

Blocker yang WAJIB ditutup sebelum eksekusi:

1. B1 - `tutup-tujuan` `gudang_id` harus `dari_gudang_id` (bukan gudang tujuan).
2. B2 - tetapkan mekanisme `getRingkasan()` tetap menghitung baris online setelah
   `rowsStok()` membaca semua produk.
3. B4 - ralat klaim A10/baris 257: `syncStokDuaArah.js` tidak memanggil
   `tambahStok`/`kurangiStok`; mitigasi paritas tidak boleh bersandar pada klaim palsu.

Setelah 3 blocker ditutup, arsitektur layak dieksekusi sesuai wave.