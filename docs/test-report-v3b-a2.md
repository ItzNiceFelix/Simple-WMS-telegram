# Test Report - A2 Paritas Data/UI-Gerbang (v3b Fase B)

Tanggal: 2026-09-16
Test engineer independen. Ruang lingkup: mengunci logika A2 yang TIDAK bisa
diuji e2e, khususnya regresi E-3 "sebagian" dan rumus ringkasan batch
"N siap / M dilewati".

Aturan keras dipatuhi: tidak ada file produksi yang disentuh; hanya 1 file
test baru. Tidak ada dependency baru. Tidak ada proses node/next/playwright
yang dijalankan atau dimatikan.

## 1. Keputusan: file test baru DIBUAT

File: `test/paritasA2Data.test.js` (7 test).

Alasan: ada celah NYATA dan bisa diuji CJS yang BELUM tertutup, sementara
beberapa celah lain sudah tertutup dan TIDAK diduplikasi (lihat §4).

## 2. Test yang dijalankan

Gate:
- `npm test` -> `node --test test/*.test.js`
- `npx tsc --noEmit`
- cek encoding file baru

Test baru (`test/paritasA2Data.test.js`) - 7 test:

1. `ringkasan batch: N siap = movement ber-kode_barang, M dilewati = sisanya
   (batch campuran)` - mengunci rumus N/M pada data CAMPURAN (2 ber-kode + 2
   kosong). Bukti lewat jalur CJS produksi `konfirmasiPickingList.js:101-102`
   (aturan identik dengan `mock.ts`/`real.ts`). Juga memastikan movement
   "dilewati" TIDAK ikut di-`processed`.
2. `ringkasan batch: semua tanpa kode_barang -> N=0, M=len` - batas bawah.
3. `ringkasan batch: kode_barang falsy (kosong/undefined/null/0) DILEWATI;
   truthy (P1) diproses` - mengunci truthiness `m.kode_barang` (bukan
   `!= null`). `""`, `undefined`, `null`, `0` -> dilewati; `"   "` truthy ->
   diproses (perilaku JS/produksi nyata).
4. `E-3 (kunci regresi): batch campuran processed+pending -> 409 'sebagian',
   bukan 'siap'` - **test pengikat regresi utama**. Lihat §3.
5. `E-3 (kunci regresi): movement processed milik owner LAIN tidak mengotori
   status batch ini` - mengunci pemisahan per-owner (batch 222 murni pending
   tetap boleh lanjut walau owner 111 punya movement processed).
6. `E-3 (kunci regresi): semua pending -> 'siap' (jalur sukses tetap terbuka)`
   - penjaga arah sebaliknya (jangan over-block).
7. `E-3 (kunci regresi): semua processed -> 409 'sudah diproses sebelumnya'`.

Semua memakai jalur produksi nyata: `konfirmasiPickingList` (bot handler CJS)
dan `siapkanKonfirmasiDraft` (`lib/dashboard/aksiDraft.js`) dengan
`installMockFirestore()`. Stub `kirimPesan` + `lib/sheets/client` lewat
`require.cache` mengikuti pola `test/draftKonfirmasiV3b.test.js`. `beforeEach`
reset store.

## 3. Hasil mutation test (WAJIB) - test benar-benar mengikat

### Mutasi A: `sebagian` dihitung dari daftar pending saja (bug E-3 asli)

Tempel `.filter((m) => m.status === "pending_confirmation")` pada
`ambilBatchPicking` (`lib/dashboard/aksiDraft.js`), lalu jalankan test baru.

Hasil SEBELUM restore:
```
✖ E-3 (kunci regresi): batch campuran processed+pending -> 409 'sebagian', bukan 'siap'
  AssertionError: batch setengah jadi TIDAK boleh lanjut (fail-closed)
  true !== false
✖ E-3 (kunci regresi): semua processed -> 409 'sudah diproses sebelumnya'
  404 !== 409
pass 5, fail 2
```
Interpretasi: tepat seperti yang diminta tugas - kalau `sebagian` dihitung
dari daftar pending saja, movement `processed` tak terlihat -> status "siap"
-> `r.ok===true` -> test GAGAL. Test MENGIKAT regresi.

### Mutasi B: rumus N/M (hapus filter `kode_barang`)

Ganti `const bisaDiproses = movements.filter((m) => m.kode_barang);` menjadi
`movements.slice()` di `konfirmasiPickingList.js`, lalu jalankan test baru.

Hasil SEBELUM restore:
```
pass 4, fail 3
```
Interpretasi: 3 test rumus ringkasan GAGAL. Test MENGIKAT rumus N/M.

### Restore

Kedua file produksi dipulihkan dari backup. Dibuktikan dengan:
```
git diff --quiet -- lib/dashboard/aksiDraft.js            -> exit 0 (tidak ada perubahan)
git diff --quiet -- lib/handlers/konfirmasiPickingList.js -> exit 0 (tidak ada perubahan)
```

## 4. Celah yang SUDAH tertutup (tidak diduplikasi)

- Gap 2 - E-3 lewat `siapkanKonfirmasiDraft` (409 + pesan "Batch picking ini
  diproses sebagian. Selesaikan lewat Telegram.") PERSIS lewat kode produksi:
  `test/draftKonfirmasiV3b.test.js:365-382` (test "E-3: siapkanKonfirmasiDraft()
  -> batch setengah jadi 409 fail-closed"). Sudah mengikat (mutasi A membuktikan).
- Gap 3 - batch semua processed -> "Batch picking ini sudah diproses
  sebelumnya.": `test/draftKonfirmasiV3b.test.js:384-394` ("E-3b") + test baru #7.
- Gap 4 - fail-closed owner null -> "Pemilik draft tidak dapat diverifikasi.
  Proses lewat Telegram." (owner TIDAK dikecualikan):
  `test/draftKonfirmasiV3b.test.js:130-137` (helper, loop owner+admin),
  `:356-363` (T5d lewat dokumen nyata), `:439-445` (validasiStatusDraft).
- `statusBatchPicking` murni (siap/sebagian/sudah):
  `test/draftKonfirmasiV3b.test.js:146-161`.

Test baru sengaja menguji yang BERBEDA dari yang di atas: rumus N/M dan
kombinasi owner-lain/pending-murni yang belum ada.

## 5. Celah yang TIDAK bisa ditutup CJS

- **Gap 1 (mock/real)**: `siap`/`dilewati`/`sebagian` di `lib/dashboard/data/
  mock.ts` dan `real.ts` adalah TypeScript dan TIDAK dapat di-`require` dari
  test CJS (konvensi repo). Yang dilakukan: mengunci ATURAN yang sama lewat
  jalur CJS bersama (`konfirmasiPickingList.js`) - tapi ini bukan paritas
  baris-per-baris mock.ts. Risiko: perubahan di `mock.ts`/`real.ts` yang
  MENYIMPANG dari aturan CJS tidak tertangkap unit test. Ditutup e2e:
  `e2e/draft-konfirmasi.spec.ts` test "batch siap tampil dengan ringkasan +
  tombol..." (`:63-74`) memverifikasi `"2 item siap diproses, 0 dilewati"` dan
  test "batch sebagian: badge Diproses sebagian + TANPA tombol (E-3)"
  (`:76-85`). Catatan: e2e memverifikasi batch 900001/900002 yang "sebagian"
  dan 900004 "2 siap / 0 dilewati"; kasus mock "2 siap / 1 dilewati" (owner
  900001) TIDAK diverifikasi eksplisit oleh e2e mana pun.
- **Gap 5 (`draftPending` ringkasan via `getRingkasan`)**: kini menambah
  jumlah batch picking (`mock.ts:420`, `real.ts:238-241`). Tidak ada test CJS
  karena keduanya TS dan `getRingkasan` hidup di sana. Tidak dipaksakan.
  Risiko: regresi hitungan `draftPending` tidak tertangkap unit test. Ditutup
  e2e: `e2e/ringkasan.spec.ts` (halaman ringkasan) - tapi test itu (dibuat v2)
  kemungkinan tidak menghitung tambahan batch picking v3b; ini residual risk.

## 6. Hasil gate

- `npm test`: **310 pass / 0 fail** (baseline 303 pass / 0 fail; +7 dari file baru).
  ```
  ℹ tests 310
  ℹ pass 310
  ℹ fail 0
  ```
- `npx tsc --noEmit`: **exit 0**.
- Encoding `test/paritasA2Data.test.js`: BOM = False, U+FFFD = 0.

## 7. Diff akhir (bukti tidak ada file produksi berubah)

`git status --short`:
```
 M app/draft/page.tsx            <- perubahan user (pre-existing)
 M lib/dashboard/data/index.ts   <- pre-existing
 M lib/dashboard/data/mock-data.ts <- pre-existing
 M lib/dashboard/data/mock.ts    <- pre-existing
 M lib/dashboard/data/real.ts    <- pre-existing
 M lib/dashboard/sumber-data.tsx <- pre-existing
 M lib/dashboard/types.ts        <- pre-existing
?? e2e/draft-konfirmasi.spec.ts  <- pre-existing (user)
?? test/paritasA2Data.test.js    <- BARU (saya)
```
Satu-satunya file yang saya tambahkan: `test/paritasA2Data.test.js`.
File produksi yang sementara dimutasi (`aksiDraft.js`, `konfirmasiPickingList.js`)
dipulihkan byte-identik (`git diff --quiet` exit 0).

## 8. Sisa risiko

1. Paritas baris-per-baris `mock.ts`/`real.ts` vs aturan CJS hanya terjaga
   secara aturan, bukan verifikasi langsung (TS tidak dapat di-require CJS).
   Bila mock/real diubah menyimpang, unit test tidak menangkap; andalkan e2e.
2. Kasus "sebagian" pada data seed mock 900001 (2 siap / 1 dilewati) tidak
   diverifikasi eksplisit e2e; ringkasan `draftPending` (Gap 5) tidak punya
   cakupan unit sama sekali.
3. `"   "` (spasi) dihitung truthy/diproses oleh `m.kode_barang` di semua
   lapisan - perilaku disengaja/tested, tapi bila produk mengirim
   kode_barang berisi spasi, item dianggap "siap". Bukan bug sekarang;
   dicatat sebagai asumsi kontrak.