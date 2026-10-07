# Verifikasi Akhir - Bugfix Sync Stok (T1..T6)

Tanggal: 2026-09-23
Verifier: final independent verification authority
Metode: bukti runtime nyata (git, node -c, npm test). Implementasi TIDAK diubah.

## Ringkasan

Semua acceptance criteria terpenuhi. `npm test` hijau 603/603, 0 fail.
Hanya file yang diharapkan berubah; tiga file terlarang tidak tersentuh.

## Kriteria & Bukti

### AC1 - `npm test` GREEN, no old test broken

- Criterion: suite penuh lulus, tidak ada test lama rusak.
- Evidence: `npm test` -> `tests 603`, `pass 603`, `fail 0`, `cancelled 0`,
  `skipped 0`, `todo 0`, `duration_ms 18909`.
  Test lama (mis. `konfirmasiBotV3b`, `draftKonfirmasiV3b`, `mutasiStok`,
  `stokGudangQty`, `paritasA2Data`) semua tampil `✔`.
- Status: PASS

Catatan: `docs/test-report.md` mencatat "602 pass" (drift dokumen). Hitungan
runtime otoritatif = 603. Ini drift dokumentasi, bukan kegagalan fungsional.

### AC2 - `node -c` syntax check semua file berubah

- Criterion: semua file berubah lolos syntax check.
- Evidence: `node -c` OK untuk:
  - `lib/sheets/client.js`
  - `lib/sheets/syncStokDuaArah.js`
  - `scripts/backfillLastSyncedValue.js`
  - `test/sheetsClientKolom.test.js`
  - `test/syncStokParitas.test.js`
  - `test/syncStokProdukBaru.test.js`
  - `test/syncStokIdempoten.test.js`
  - `test/backfillLastSyncedValue.test.js`
  - `test/helpers/mockFirestore.js`
- Status: PASS

### AC3 - Test baru meng-cover T1..T5

- Criterion: tiap tugas punya test yang mengeksekusi jalur produksi.
- Evidence (per-file run terpisah, semua `fail 0`):

  | File | Tugas | tests | pass | fail |
  |---|---|---|---|---|
  | `test/sheetsClientKolom.test.js` | T1 | 4 | 4 | 0 |
  | `test/syncStokParitas.test.js` | T2 | 3 | 3 | 0 |
  | `test/syncStokProdukBaru.test.js` | T3 | 1 | 1 | 0 |
  | `test/syncStokIdempoten.test.js` | T4 | 1 | 1 | 0 |
  | `test/backfillLastSyncedValue.test.js` | T5 | 6 | 6 | 0 |

  Test mem-require modul produksi nyata (`../lib/sheets/syncStokDuaArah`,
  `../scripts/backfillLastSyncedValue`, client asli via override `googleapis`),
  bukan stub trivially-passing.
- Status: PASS

### AC4 - File terlarang TIDAK berubah

- Criterion: `app/api/admin/route.ts`, `firestore.rules`,
  `scripts/cekStrukturSheets.js`, dan test lama tidak berubah.
- Evidence:
  - `git diff --name-only -- app/api/admin/route.ts firestore.rules` -> kosong.
  - `scripts/cekStrukturSheets.js` untracked (`??`), tidak ada di `git diff`,
    tidak staged, tidak punya riwayat git -> tidak dimodifikasi operasi git apa pun.
  - `git status --short -- test/` hanya menampilkan ` M test/helpers/mockFirestore.js`
    (helper, penambahan `arrayUnion` - disetujui) + 5 file test baru. Tidak ada test lama berubah.
- Status: PASS

## Pemeriksaan Tugas (substansi kode)

### T1 - `lib/sheets/client.js` harden `tambahKolomHeader`
- Evidence: `spreadsheets.get({fields:"sheets.properties"})` via `denganTimeout`;
  `find` by `properties.title`; throw `Sheet "..." tidak ditemukan...` bila absen;
  `indexKolomBaru >= columnCount` -> `batchUpdate appendDimension` (dimension COLUMNS,
  `length = indexKolomBaru - columnCount + 1`) SEBELUM `tulisRange` header.
  Signature/return tidak berubah (`(namaSheet, namaKolomBaru) -> Promise<number>`).
- Test membuktikan urutan: columnCount=7 -> metadata, batchUpdate, lalu values.update;
  cukup lebar -> tanpa batchUpdate; gap>1 -> length=3; sheet absen -> throw.
- Status: PASS

### T2 - `syncStokDuaArah.js` pakai `bacaParitasOnline`
- Evidence: import `bacaParitasOnline` dari `../models/stok`; dipakai di
  `bandingkanNilai` (line ~151), `applyDraft` (stokSebelum), `applyDraftProdukBaru`.
- Grep `stok_gudang_online` tinggal 2 baris, keduanya KOMENTAR (line 154-155).
  Tidak ada pembacaan field mentah di jalur kode.
- Status: PASS

### T3 - `applyDraftProdukBaru` nomor urut
- Evidence: `bacaRange(`${NAMA_SHEET_STOK}!A2:A`)` sekali;
  `nomorBerikut = count(non-empty) + 1`; `row[0] = nomorBerikut++`;
  `panjangBaris = Math.max(item.index_kolom + 1, 4)` dipertahankan;
  ada `ponytail:` comment menandai non-atomik + jalur upgrade.
- Test: `row[0]` nomor lanjut, kode & stok posisi benar, last_synced ter-set.
- Status: PASS

### T4 - `applyDraft` idempoten
- Evidence: `sudahDipush = new Set(draft.pushed_items || [])`; `continue` bila sudah ada;
  `kodeBaruDipush.push` setelah sukses; satu `update` menulis
  `FieldValue.arrayUnion(...kodeBaruDipush)` + `status:"processed"`;
  `return kodeBaruDipush.length`.
- Return publik `konfirmasiSyncStok` TIDAK berubah bentuk:
  `{ok:true, diproses, sisa}` (line 425), `mulaiSyncStok` juga tidak berubah.
  Hanya nilai `diproses` yang kini akurat (skip item sudah-push).
- `test/helpers/mockFirestore.js` ditambah dukungan `arrayUnion` agar test jalur produksi nyata.
- Test: `pushed_items ['K1']` -> retry K1 tidak digandakan, K2 diproses, pushed_items bertambah.
- Status: PASS

### T5 - `scripts/backfillLastSyncedValue.js`
- Evidence: `APPLY = process.argv.includes("--apply")` -> default DRY-RUN (tidak menulis);
  menulis hanya bila `--apply`; idempoten (`if (stok.last_synced_value === h.nilai) continue`);
  `module.exports = { pilihKodeBackfill, cariIndexKolomStok, normalisasiHeader }`;
  `pilihKodeBackfill` MURNI tanpa jaringan.
- Status: PASS

## Langkah Verifikasi yang Diminta

1. `git status --short` / `git diff --stat`: hanya file diharapkan berubah
   (docs review, client.js, syncStokDuaArah.js, mockFirestore.js) + file baru
   (script backfill, 5 test). Terlarang tidak berubah. PASS
2. `npm test`: 603 pass / 0 fail. PASS
3. `node -c`: 9 file OK. PASS
4. Grep `stok_gudang_online`: hanya komentar, tidak ada baca mentah. PASS
5. File test ada + tiap berisi test T1..T5 (4/3/1/1/6 test). PASS

## Risiko Residual

- `applyDraftProdukBaru` (T3) sengaja TIDAK idempoten terhadap retry "ya produk_baru"
  (bisa baris ganda). Sudah didokumentasikan `ponytail:` dan diterima dalam scope bugfix.
- Pengisian kolom A (No) non-atomik -> append paralel bisa nomor dobel. Kosmetik,
  didokumentasikan `ponytail:`.
- Drift dokumen: `docs/test-report.md` menulis 602, runtime 603. Bukan kegagalan gate,
  tapi laporan sebaiknya disinkronkan.
- `scripts/cekStrukturSheets.js` untracked sehingga tidak bisa di-diff; integritas
  dikonfirmasi hanya dari status git (tidak tersentuh).

## Kesimpulan

Seluruh acceptance criteria terpenuhi dengan bukti runtime nyata. Tidak ada regresi
(603 test lama + baru hijau), file terlarang tidak tersentuh, syntax bersih, dan tiap
tugas T1..T5 punya test yang mengeksekusi jalur produksi.

VERIFIED
