# Review Adversarial PRD v5 - PASS 2

Reviewer: senior product reviewer (adversarial).
Tanggal: 2026-09-16.
Objek: `docs/prd-v5.md` (revisi 2, 1024 baris).
Pembanding: `docs/prd-v5-review.md` (pass-1, T1-T30), plus verifikasi ke kode nyata:
`firestore.rules`, `firestore.indexes.json`, `lib/dashboard/data/real.ts`,
`lib/dashboard/data/mock.ts`, `lib/dashboard/data/index.ts`,
`lib/dashboard/sumber-data.tsx`, `test/indexFirestore.test.js`, `playwright.config.ts`.

Metode: verifikasi T1-T30 SATU PER SATU ke isi dokumen (tabel bagian 16 TIDAK dipercaya).
Fokus tambahan: R2 (status per-tujuan) karena mengubah desain inti, plus R1/R3/R4/R5.

Ringkasan severity: blocker 4, major 7, minor 4.
Status T1-T30: 27 benar tertutup, 2 masih terbuka, 1 hanya diklaim.

---

## A. Verifikasi T1-T30 (cek sendiri ke isi dokumen)

| Temuan | Status | Bukti / catatan |
|---|---|---|
| T1 nama field waktu | BENAR TERTUTUP | Skema 6.1/6.2/6.3 memakai `created_at`/`updated_at` (baris 463-528). `dibuat_at` hanya muncul di konteks larangan (436, 901, 925, 972, 1022). AC global #5 (925). |
| T2 migrasi kontrak DataSource | BENAR TERTUTUP | F10 (342-365) daftar file + pemanggil `app/stok/page.tsx:74`, `app/permintaan/page.tsx:72`, `app/page.tsx:45`, `sumber-data.tsx:203`. Verifikasi: `index.ts:68` memang `listStock()` tanpa argumen; 3 pemanggil dikonfirmasi ada. AC tsc (362). |
| T3 angka test | BENAR TERTUTUP | 12a (847-851) memakai metodologi hitung. Verifikasi sendiri: unit 316, e2e 150 spec, 3 project (mobile/tablet/desktop), `retries: CI ? 1 : 0`. Angka cocok. Klaim "601" dihapus. |
| T4 verifikasi migrasi | BENAR TERTUTUP | 10a (810-819) `scripts/verify-backfill.mjs` read-only + exit code; AC global #2 (922). |
| T5 discovery "agregat" | BENAR TERTUTUP | BR2 catatan T5 (379-381) menyatakan discovery digantikan Q4a. |
| T6 state machine transisi | BENAR TERTUTUP | F5.2 tabel (187-204) memuat jalur legal + ilegal. `batal`/`ditolak`/`dibatalkan`/`selesai` terdefinisi. CACAT RESIDU: tabel TIDAK lengkap untuk R2 (lihat V1, V2). |
| T7 aksi penutup multi-tujuan | BENAR TERTUTUP | Status per-tujuan (R2) + `tutup-tujuan` masuk F5.2 (197) + endpoint bagian 7 (595) + skema TujuanEntri (497-513). |
| T8 aturan pemenang migrasi | BENAR TERTUTUP | Bagian 10 #2 (795-802) aturan pemenang tunggal + transaksi per dokumen. Prioritas selaras R14 (908). |
| T9 opname CAS | BENAR TERTUTUP | F7 langkah 1 (282) CAS `qty_sistem` vs nilai kini -> 409. |
| T10 snapshot gudang user | BENAR TERTUTUP | `gudang_id_snapshot` (505), dipakai saat terima (233, 255, 269). |
| T11 gudang nonaktif | BENAR TERTUTUP | F3 edge (142), F9 (330), `peringatan_referensi` admin + key stock (90-91, 854). |
| T12 jabatan bukan otorisasi | BENAR TERTUTUP | F4 AC negatif (154) import POST + assert 403 + negative-grep. |
| T13 self-target user | BENAR TERTUTUP | F5 (216), F6 (261) -> 400. |
| T14 opname item belum terdaftar | BENAR TERTUTUP | F7 (278), skema `belum_terdaftar` (521). |
| T15 read lintas gudang | BENAR TERTUTUP | Rules 8 (623) `staff()`; keputusan R5 diadopsi, klaim scope-read dihapus. |
| T16 TTL guard | BENAR TERTUTUP | 6.4 (544-546) `{merge:false}` per uid, tidak butuh TTL. |
| T17 `qty_per_gudang` terlihat | BENAR TERTUTUP | Bagian 8 KONSEKUENSI EKSPLISIT (641-645). |
| T18 urutan guard | BENAR TERTUTUP | Bagian 7 (587-589) + test `urutanGuardV5.test.js` (862). |
| T19 matrix lihat gudang | BENAR TERTUTUP | Matrix (50) baris "Lihat master gudang" guest read-only. |
| T20 format index | BENAR TERTUTUP | Bagian 9 (677-781) JSON final + pemetaan query + buang index mati. CACAT RESIDU: index #8 dipasang walau halaman belum ada (V9). |
| T21 index tujuan_ids | BENAR TERTUTUP | Field `tujuan_ids` (264, 480) + index #4 (718-728). |
| T22 daftar guard | HANYA DIKLAIM | BR11 (416-431) daftar lengkap TAPI kontradiksi internal: `batal` dan `tutup-tujuan` muncul di "Guard WAJIB" (423) SEKALIGUS di "TIDAK butuh guard" (430-431). Lihat V6. |
| T23 batas 1 MiB | BENAR TERTUTUP | BR15 50 gudang (445), BR16 200 item (448), AC F5 (211, 213), bagian 11 (830). |
| T24 file kontrak DataSource | BENAR TERTUTUP | F10 daftar file lengkap (346-353). Verifikasi: `sumber-data.tsx:196-235` memang `dataKosong()` dengan stub `tolak` untuk tiap method (satisfies DataSource). |
| T25 stok.spec gate awal | BENAR TERTUTUP | Bagian 12 #1 (842) + AC global #21 (941). |
| T26 klaim platform | BENAR TERTUTUP | Bagian 7 (602) klaim 2048 dihapus. Verifikasi: 10 `route.ts` di `app/api/**`, cocok. |
| T27 CAS testability | BENAR TERTUTUP | Bagian 12 "Uji CAS/concurrency" (864-870) + `casModelFirestore.test.js`. |
| T28 AC payload terukur | BENAR TERTUTUP | Bagian 11 (831-832) `< 500 KiB` + dampak `getRingkasan`. |
| T29 index lama hijau | BENAR TERTUTUP | Bagian 12 "Regresi index lama" (882). |
| T30 concurrency tujuan berbeda | BENAR TERTUTUP (manual) | F5 edge (247) + AC #30 (950). TAPI diakui manual-only; lihat V7. |

Kesimpulan verifikasi: 27 benar tertutup, T22 hanya diklaim (kontradiksi internal),
T30 terbuka secara praktis (hanya manual, tanpa test deterministik).

---

## B. Temuan baru (V)

### V1 [blocker] Tabel F5.2 tidak mendefinisikan semua kombinasi `dari_status x aksi` untuk R2

- Lokasi: `prd-v5.md:187-204`.
- Masalah: tabel memuat baris untuk precondition "tujuan ke-k masih `menunggu`"
  (195-197) tetapi TIDAK memuat baris eksplisit untuk aksi `tutup-tujuan` pada tujuan
  yang SUDAH `diterima`/`tidak_terima`/`ditutup`. Kombinasi yang TIDAK terdefinisi:
  - `dikirim` x `tutup-tujuan` (tujuan ke-k sudah bukan `menunggu`).
  - `dikirim` x `tidak-terima` (tujuan ke-k sudah `diterima`).
  - `dikirim` x `kirim` (di-klik ulang).
  - `disetujui` x `tutup-tujuan` / `terima` (hanya `setujui/tolak/terima` di baris 202, `tutup-tujuan` absen).
  - `menunggu` x `terima`/`tidak-terima`/`tutup-tujuan`.
- Mengapa penting: F5.3 (226) hanya bilang "status dokumen `dikirim` DAN entri tujuan
  ke-k masih `menunggu`; selain itu -> 409" - ini menutup `terima`, tetapi `tidak-terima`
  dan `tutup-tujuan` TIDAK punya pernyataan setara. Implementasi bisa gagal membedakan
  "tujuan sudah ditutup lalu di-`tidak-terima`" (harus 409) dari "tujuan masih menunggu".
  Tanpa baris eksplisit, `tidak-terima` pada tujuan yang sudah `ditutup` bisa lolos dan
  mengembalikan stok DUA KALI (sekali lewat `tutup-tujuan` tak ubah stok, lalu tambah asal).
- Bukti: baris 195-197 precondition "masih `menunggu`"; baris 198-203 tidak memuat
  `dikirim x tutup-tujuan` maupun `dikirim x tidak-terima (sudah bukan menunggu)`.
  AC 230 hanya menutup `tidak-terima` GANDA (status sama), bukan `tidak-terima` setelah
  `ditutup`.
- Perbaikan: tambahkan baris F5.2 eksplisit untuk SETIAP aksi x status tujuan:
  `dikirim | tutup-tujuan (tujuan sudah bukan menunggu) | 409 "Tujuan ini sudah diproses."`,
  dan analog untuk `terima`/`tidak-terima`. Tambah AC global + test.

### V2 [blocker] Recompute `selesai` tidak punya contoh kasus 3-tujuan campuran, dan tidak ada AC test-nya

- Lokasi: `prd-v5.md:232`, `prd-v5.md:950`.
- Masalah: aturan recompute (232) benar secara naratif (`selesai` bila semua tujuan
  `diterima`/`tidak_terima`/`ditutup`). Tetapi skenario campuran
  "t1 `diterima`, t2 `tidak_terima`, t3 `ditutup` -> `selesai`" TIDAK muncul sebagai AC
  maupun test. Bagian 12 (857) hanya menulis "status dokumen turunan benar (`dikirim`/`selesai`)"
  tanpa memerinci kombinasi.
- Mengapa penting: ini justru kombinasi yang PRD sendiri sebut penting. Bug recompute
  (mis. lupa `ditutup` dihitung) lolos karena tidak ada test eksak. Recompute adalah
  operasi paling rawan di R2.
- Bukti: 232 (aturan), 857 (test generik), 950 (AC #30 hanya dua `terima`).
- Perbaikan: tambah AC eksplisit "3 tujuan: diterima + tidak_terima + ditutup -> `selesai`"
  + test di `test/permintaanGudang.test.js`. Tambah juga kombinasi "2 tujuan, 1 ditutup, 1 menunggu -> `dikirim`".

### V3 [blocker] Jalur stok asal bisa naik DUA KALI untuk satu `kirim` lewat `tidak-terima` setelah `tutup-tujuan`

- Lokasi: `prd-v5.md:196-197`, `prd-v5.md:229-231`, `prd-v5.md:395`.
- Masalah: `tutup-tujuan` TIDAK mengubah stok (barang dianggap hilang). `tidak-terima`
  MENAMBAH stok asal. Bila urutan aksi `tutup-tujuan` lalu `tidak-terima` pada tujuan
  yang SAMA diizinkan (karena V1: tidak ada 409 eksplisit untuk `tutup-tujuan` sebagai
  precondition), maka stok asal naik padahal `tutup-tujuan` tidak menurunkan apa pun -
  bukan pengembalian ganda literal, tetapi menciptakan stok dari "barang hilang".
- Mengapa penting: invariant BR4/BR5 ("tidak boleh menciptakan barang") bisa dilanggar.
  Jalur tunggal yang menambah asal harusnya HANYA `tidak-terima` dari status tujuan
  `menunggu`, sekali per tujuan.
- Bukti: 197 (`tutup-tujuan` tak ubah stok) + 196 (`tidak-terima` tambah asal). Tidak ada
  AC yang mengunci "`tidak-terima` hanya sah bila tujuan masih `menunggu`".
- Perbaikan: AC tegas "`tidak-terima` hanya valid bila `tujuan[k].status == "menunggu"`;
  setelah `ditutup`/`diterima`/`tidak_terima` -> 409, stok TIDAK berubah". Tambah test
  urutan `tutup-tujuan` -> `tidak-terima` assert 409.

### V4 [blocker] `tutup-tujuan` menghilangkan stok asal secara permanen tanpa AC kuantitatif

- Lokasi: `prd-v5.md:171`, `prd-v5.md:197`, `prd-v5.md:911`, `prd-v5.md:1017`.
- Masalah: `kirim` mengurangi gudang asal sebesar total qty. Bila SEMUA tujuan ditutup
  (`tutup-tujuan`), stok asal TIDAK pernah kembali. PRD menyebut "barang dianggap hilang"
  (1017) tetapi tidak ada AC yang mengukur/mencatat berapa unit hilang, dan tidak ada
  invariant "total lintas gudang + hilang = konstan". R17 (911) hanya mewajibkan
  `catatan_alasan`.
- Mengapa penting: sumber kebocoran stok senyap. Owner bisa menutup 20 tujuan dan
  menghapus stok asal tanpa angka yang bisa direkonsiliasi. Untuk toko, ini kerugian nyata
  yang tidak terdeteksi gate apa pun.
- Bukti: 171 "TIDAK mengubah stok"; 197 efek stok "TIDAK"; 1017 "dianggap hilang".
- Perbaikan: tambah AC "respons `tutup-tujuan` memuat `qty_hilang` (total qty tujuan itu)
  + `stock_movements` `action_type:"tutup_tujuan"` mencatat qty (bukan 0) di field
  `qty`/`catatan` untuk rekonsiliasi". Ini juga memperbaiki klaim `qty 0` di 197 yang
  saat ini tidak bisa direkonsiliasi.

### V5 [major] Race `terima` vs `tutup-tujuan` untuk tujuan yang SAMA tidak punya AC

- Lokasi: `prd-v5.md:247`, `prd-v5.md:828`.
- Masalah: bagian 11 (828) menyebut CAS pada `status` dokumen + `tujuan[i].status` untuk
  `terima`/`tidak-terima`/`setujui`/`tutup-tujuan`. AC F5 edge (247) HANYA menutup
  "dua `terima` tujuan BERBEDA". Tidak ada AC untuk "`terima` dan `tutup-tujuan`
  bersamaan pada tujuan SAMA" - pemenang tidak didefinisikan.
- Mengapa penting: dua aksi ini punya efek stok BERLAWANAN (`terima` naik gudang tujuan,
  `tutup-tujuan` tak ubah stok). Bila keduanya lolos CAS, stok bisa masuk DAN ditutup.
  CAS pada `tujuan[i].status` seharusnya mencegah, tapi tidak ada AC yang menguncinya.
- Bukti: 247 (dua terima tujuan berbeda), 828 (CAS generik).
- Perbaikan: tambah AC "`terima` dan `tutup-tujuan` bersamaan untuk tujuan yang sama ->
  tepat satu menang; yang kedua 409; stok konsisten (naik ATAU tidak, tidak keduanya)".
  Tandai manual/produksi-only bila tak dapat dimock, seperti T30.

### V6 [major] BR11 kontradiksi diri: `batal` dan `tutup-tujuan` di dua daftar sekaligus

- Lokasi: `prd-v5.md:423`, `prd-v5.md:430-431`.
- Masalah: baris 423 menempatkan `batal` dan `tutup-tujuan` di daftar "Guard WAJIB".
  Baris 430-431 menempatkan keduanya di "TIDAK butuh guard (alami idempoten)". Tidak
  jelas mana yang mengikat.
- Mengapa penting: T22 (guard lengkap) diklaim tertutup, tetapi kontradiksi ini membuat
  test `guardV5.test.js` (860) ambigu: apakah `batal` wajib menolak duplikat < 10s atau
  tidak. Implementasi bisa memilih salah dan test bisa merah/hijau keliru.
- Bukti: 423 vs 430-431. Baris 430 justru eksplisit "GUARD tetap dipasang untuk
  keseragaman tetapi bukan pengaman utama" - jadi statusnya sebenarnya "dipasang".
- Perbaikan: pindahkan `batal`/`tutup-tujuan` ke SATU kategori. Bila guard tetap dipasang,
  tulis di "Guard WAJIB" dan hapus dari "idempoten", atau sebaliknya. Selaraskan
  6.4 (536) yang sudah memuat keduanya di guard.

### V7 [major] AC global #30 (dua `terima` bersamaan) diakui manual-only tanpa test deterministik

- Lokasi: `prd-v5.md:950`, `prd-v5.md:864-870`.
- Masalah: AC #30 adalah AC global (harus terverifikasi untuk rilis) tetapi 12
  (865-869) menandainya "MANUAL/PRODUKSI-ONLY". `casModelFirestore.test.js` (870) hanya
  satu skenario "transaksi kedua baca versi lama -> throw". Tidak ada skenario dua
  `terima` tujuan berbeda.
- Mengapa penting: R2 mengubah desain inti. AC global yang tidak bisa lulus gate otomatis
  berarti "selesai" menurut #30 bisa diklaim tanpa bukti. Pelajaran `learnings.md:35`
  (bug CAS tak terlihat gate) justru berlaku.
- Bukti: 950 (AC #30), 865-870.
- Perbaikan: perluas `casModelFirestore.test.js` menjadi minimal 3 skenario:
  (a) dua `terima` tujuan berbeda, (b) `terima` vs `tutup-tujuan` tujuan sama (V5),
  (c) dua `tidak-terima` tujuan sama. Bila helper mock Firestore tidak sanggup, turunkan
  #30 jadi "manual, wajib diuji di staging sebelum rilis, dicatat di PR".

### V8 [major] Query "daftar dokumen nyangkut `dikirim`" untuk owner tidak dipetakan ke index/fungsi

- Lokasi: `prd-v5.md:904`, `prd-v5.md:659`.
- Masalah: R10 (904) mitigasinya "aksi `tutup-tujuan` tersedia + status per tujuan
  terlihat di UI". Tetapi tidak ada query/fungsi yang didefinisikan untuk owner menemukan
  dokumen `dikirim` yang nyangkut. Index #1 (659) `status ASC + created_at DESC` bisa
  melayani, tetapi tidak ada baris fungsi `listPermintaanGudang({status:"dikirim"})`
  sebagai query konkret (hanya "antrian approval owner" yang disebut).
- Mengapa penting: tanpa daftar, `tutup-tujuan` tak bisa ditemukan owner. Fitur penutup
  jadi mati secara praktis meski endpoint ada. Ini gap operasional R10.
- Bukti: 659 memetakan index #1 ke "antrian approval owner"; 904 mitigasi tanpa query.
- Perbaikan: tambah baris pemetaan eksplisit "index #1 juga melayani
  `listPermintaanGudang({status:"dikirim"})` - daftar dokumen nyangkut owner" + AC UI.

### V9 [major] Index #8 `stock_movements.gudang_id` dipasang meski halaman histori belum tentu ada

- Lokasi: `prd-v5.md:770-781`, `prd-v5.md:959`, `prd-v5.md:942`.
- Masalah: bagian 15 #2 (959) menyatakan "bila halaman tidak dibuat di v5, JANGAN pasang
  index ke-8". Tetapi bagian 9 (770-781) menulisnya sebagai index WAJIB dan AC global #22
  (942) menuntut "semua composite index bagian 9 ada di `firestore.indexes.json`".
- Mengapa penting: kontradiksi ini membuat AC #22 bisa memaksa memasang index yang bagian
  15 bilang jangan. `listMovements({gudang_id})` juga belum ada di F-list v5 (hanya
  ditandai "opsional v5" di 666). Index tanpa query = biaya tulis sia-sia.
- Bukti: 666 "opsional v5", 770-781 (index ditulis), 942 (AC wajib), 959 (default jangan).
- Perbaikan: putuskan satu. Bila `listMovements({gudang_id})` bagian v5 -> tambahkan
  fungsi + AC; bila tidak -> hapus index #8 dari bagian 9 dan dari AC #22.

### V10 [major] `gudang_id_snapshot` yang dihapus/nonaktif -> 409 tetapi jalur pemulihan tidak ber-AC

- Lokasi: `prd-v5.md:267`, `prd-v5.md:233`, `prd-v5.md:244`.
- Masalah: 267 menyebut dua perilaku berbeda dalam satu kalimat: (a) tujuan user dihapus
  dari `admins` -> `terima` tetap sukses; (b) gudang snapshot tidak ada -> 409. Tidak ada
  AC yang mengunci urutan pengecekan ini, dan tidak ada AC yang memverifikasi
  `tutup-tujuan` MEMANG menyelesaikan dokumen yang nyangkut karena 409 tadi.
- Mengapa penting: inilah jalur "dokumen nyangkut" utama R2. Bila `tutup-tujuan` tidak
  bisa dijalankan pada tujuan yang `gudang_id_snapshot`-nya hilang (karena guard/V1),
  dokumen nyangkut `dikirim` selamanya - persis T7 yang diklaim tertutup.
- Bukti: 267 (409 + "owner menutup entri dengan `tutup-tujuan`"), tanpa AC.
- Perbaikan: tambah AC "tujuan dengan `gudang_id_snapshot` hilang -> `tutup-tujuan`
  owner sukses menutup (tak ubah stok), dokumen jadi `selesai` bila itu terakhir" + test.

### V11 [major] `terima`/`tidak-terima` pada tujuan `tipe:"gudang"` nonaktif tidak simetris dengan tujuan `user`

- Lokasi: `prd-v5.md:244`, `prd-v5.md:233`, `prd-v5.md:267`.
- Masalah: 244 bilang "`terima` ke gudang nonaktif -> 409"; 267 bilang "tujuan user
  dengan `gudang_id_snapshot` null -> `terima` TIDAK menambah stok, entri tetap selesai".
  Dua aturan ini bisa bertabrakan untuk `tipe:"gudang"` yang dinonaktifkan setelah `buat`:
  apakah `terima` 409 atau selesai-tanpa-stok?
- Mengapa penting: determinisme aksi inti. Owner/admin gudang tujuan tidak tahu apakah
  barang masuk atau tidak.
- Bukti: 233 vs 244 vs 267.
- Perbaikan: tetapkan satu matriks "jenis tujuan x kondisi gudang saat terima" dan
  jadikan AC. Minimal: `tipe:"gudang"` nonaktif -> 409 (seperti 244); `tipe:"user"`
  snapshot null -> selesai tanpa stok (seperti 267). Tulis eksplisit pemisahnya.

### V12 [minor] Tanggal PRD salah: header menyebut 2026-09-16, review juga 2026-09-16, tapi klaim "revisi 2"

- Lokasi: `prd-v5.md:4`, `prd-v5.md:6`.
- Masalah: tidak ada jejak tanggal versi 1 vs revisi 2. Minor, tapi menyulitkan penelusuran
  audit perubahan.
- Perbaikan: cantumkan tanggal revisi 2 terpisah.

### V13 [minor] 6.4 memuat `tutup-tujuan` di header "Dipakai" tapi BR11 bilang bukan pengaman utama

- Lokasi: `prd-v5.md:536`, `prd-v5.md:430`.
- Masalah: sama dengan V6 versi skema; guard dicantumkan tanpa catatan "best-effort".
- Perbaikan: konsisten dengan keputusan V6.

### V14 [minor] Bagian 12 menyebut `batalPermintaanGudang`/`tidakTerimaPermintaanGudang` di paritas tapi e2e baru tidak menguji `batal`/`tutup-tujuan`

- Lokasi: `prd-v5.md:873`, `prd-v5.md:878-880`.
- Masalah: e2e baru (`permintaan-gudang.spec.ts`, 879) menguji buat/setujui/kirim/terima/
  tidak-terima, tetapi TIDAK menguji `batal` dan `tutup-tujuan`. Unit test (857) memuat
  keduanya.
- Perbaikan: tambahkan langkah e2e `batal` dan `tutup-tujuan` atau nyatakan eksplisit
  cukup unit test.

### V15 [minor] Matrix 3 tidak punya baris "Lihat permintaan/opname" yang konsisten dengan guest

- Lokasi: `prd-v5.md:51`, `prd-v5.md:961`.
- Masalah: matrix (51) bilang guest TIDAK boleh lihat permintaan/opname; bagian 15 #4 (961)
  juga default TIDAK. Konsisten. Namun bagian 8 (623-624) memakai `staff()` - konsisten.
  Catatan: R5 menyebut "semua staff"; guest bukan staff, jadi benar. Tidak ada masalah,
  hanya ditandai agar tidak diperdebatkan ulang.
- Perbaikan: tidak ada (catatan saja).

---

## C. Konsistensi internal setelah R1-R5

- R4 (nama field waktu): BERSIH. `dibuat_at` hanya di konteks larangan/riwayat. Tidak ada
  sisa referensi aktif.
- R5 (cross-gudang read): KONSISTEN. Bagian 1 (19), 3 (52-53, 71), 8 (641-645), BR7
  (401-404), F9 (327), R16 (910), AC #4/#17/#23. Tidak ditemukan sisa klaim "scope
  membatasi read".
- R2 (status per-tujuan): SEBAGIAN. Definisi (F5.1, BR5, skema) konsisten, tetapi tabel
  transisi tidak lengkap (V1), recompute tanpa AC (V2), stok hilang tanpa cacah (V4).
- R1 (`batal`): KONSISTEN antara matrix (57), R1 (1009), F5.2 (191, 194), F5.3 (221-222),
  skema (489-490). Kontradiksi hanya di BR11 (V6).
- R3 (50 gudang): KONSISTEN (F1 86/95, BR15 445, bagian 11 830, AC #1 921).
- Q1a lama: TIDAK lagi disebut sebagai desain aktif. Baris 6 dan 1011 menyatakan R2
  MENGUBAH Q1a. Bagian 16 T7/T30 menyebut R2. Tidak ada sisa klaim "satu status".
- Bagian 3 (matrix), 8 (rules), 13 (risiko), 14 (AC): konsisten dengan R2/R5 kecuali
  butir V8 (R10 query) dan V9 (index #8).

---

## D. Kelayakan teknis (fokus perubahan)

- Index `tujuan_ids` ARRAY_CONTAINS (718-728): FORMAT BENAR. `test/indexFirestore.test.js:38-50`
  (`adaIndexPendukung`) memakai aturan "equality/array-contains sebagai prefix, orderBy
  sesudah". Posisi `tujuan_ids` sebagai field pertama + `created_at` DESC + `__name__` DESC
  cocok. Query `where("tujuan_ids","array-contains",x).orderBy("created_at","desc")` bisa
  dilayani. OK.
- Index #1/#2/#3 (681-716): format cocok. Query "permintaan saya" (`created_by`) +
  `dari_gudang_id` + `status` OK.
- `tutup-tujuan`: TIDAK butuh index/query baru (aksi pada dokumen existing).
- `opname_gudang` per-tujuan: opname TIDAK per-tujuan; field `status` dokumen sudah benar
  (522) dan index #5/#6 (731-755) cocok dengan query. OK.
- Gap index: TIDAK ada query yang tidak terlayani, kecuali V8 (daftar nyangkut belum
  dipetakan fungsi) dan V9 (index #8 tanpa fungsi).

---

## E. Testability

- AC R1 (`batal`): TERUJI. F5.3 (221-222) + unit (857).
- AC R2 (`terima`/`tidak-terima`/`tutup-tujuan`): TERUJI SEBAGIAN. Unit (857) memuat
  `tidak-terima`, `tutup-tujuan`, `batal`, recompute. TAPI: tidak ada test kombinasi
  3-tujuan (V2), tidak ada test `terima` vs `tutup-tujuan` same-target (V5), tidak ada
  test `tidak-terima` setelah `ditutup` (V3).
- Bagian 12 memuat aksi `batal`, `tidak-terima`, `tutup-tujuan` di unit test (857).
  E2E hanya `tidak-terima` (879); `batal`/`tutup-tujuan` absen e2e (V14).
- AC #30 (V7): manual-only, tanpa test deterministik.

---

## Verdict

LAYAK DENGAN PERBAIKAN

PRD revisi 2 menutup 27 dari 30 temuan pass-1 secara nyata. R1/R3/R4/R5 konsisten dan
layak. Namun R2 (perubahan desain inti) meninggalkan lubang state machine dan invariant
stok yang HARUS ditutup sebelum implementasi.

Daftar blocker:

1. V1 - F5.2 tidak mendefinisikan semua kombinasi `dari_status x aksi` untuk R2; aksi
   `tutup-tujuan`/`tidak-terima` pada tujuan yang sudah bukan `menunggu` tidak punya 409.
2. V2 - Recompute `selesai` tanpa AC/test kombinasi 3-tujuan (diterima + tidak_terima + ditutup).
3. V3 - Jalur `tidak-terima` setelah `tutup-tujuan` bisa menaikkan stok asal dari "barang
   hilang" (melanggar invariant tidak menciptakan barang).
4. V4 - `tutup-tujuan` menghilangkan stok asal permanen tanpa AC kuantitatif/cacah rekonsiliasi.

Setelah 4 blocker ditutup, V5-V15 dapat diselesaikan sebagai revisi non-blocking.
