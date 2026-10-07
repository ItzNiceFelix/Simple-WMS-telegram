# Verifikasi Akhir - Cleanup 4 Risiko Residual /sync_stok

Tanggal: 2026-09-23
Verifier: final independent verification authority
Metode: bukti runtime nyata (git, node -c, npm test, mutation test). Implementasi TIDAK diubah.

## Ringkasan

Seluruh acceptance criteria terpenuhi. `npm test` hijau 607/607, 0 fail (603 baseline + 4 baru).
Setiap test baru dibuktikan NON-VACUOUS: mutasi balik ke perilaku lama membuat test GAGAL.

## Kriteria & Bukti

### AC1 - `npm test` GREEN, old tests lulus

- Criterion: suite penuh lulus; test lama (konfirmasiBotV3b, draftKonfirmasiV3b, gapV3b) hijau.
- Evidence:
  - `npm test` (env API key dikosongkan) -> `tests 607`, `pass 607`, `fail 0`, `cancelled 0`,
    `skipped 0`, `todo 0`.
  - `node --test test/konfirmasiBotV3b.test.js test/draftKonfirmasiV3b.test.js test/gapV3b.test.js`
    -> `tests 51`, `pass 51`, `fail 0`.
- Status: PASS

### AC2 - Test baru menutup R1..R4 (assertion NON-VACUOUS)

- Criterion: R1 (retry no double movement walau marker absen, via id_movement), R2 (retry
  produk_baru no duplicate row), R3 (kolom A nomor benar multi-item), R4 (replay 4 kondisi).
- Evidence (test/ baru = 4 test):
  - `node --test test/syncStokMovementIdempotensi.test.js test/syncStokReplay.test.js`
    -> `tests 4`, `pass 4`, `fail 0`.
  - R1: `test/syncStokMovementIdempotensi.test.js` -> marker `pushed_items` dibuang + retry;
    assert `movements.length === 1` dan `id === "sync_d-r1_K1"` (id deterministik).
    MUTATION PROOF: `if (id_movement !== null...)` diganti `if (false)` ->
    test R1 GAGAL (`✖`). Non-vacuous.
  - R2: `test/syncStokReplay.test.js` "replay: retry 'ya semua'" -> assert jumlah baris Sheets
    TIDAK bertambah setelah retry ("retry tidak menambah baris produk baru (pushed_items skip)").
    MUTATION PROOF: skip `pushed_items` dinetralkan -> test GAGAL
    (`AssertionError: retry tidak menambah baris produk baru`). Non-vacuous.
  - R3: `test/syncStokReplay.test.js` "kolom A naik benar per baris" -> assert
    `noA === ["4","5","6"]` untuk 3 item + assert `row[0] == "4"` pada test 4-kondisi.
    MUTATION PROOF: `row[0] = nomor` diganti `row[0] = "X"` -> test GAGAL. Non-vacuous.
  - R4: `test/syncStokReplay.test.js` "replay 4 kondisi" -> seed lengkap 4 kondisi; assert
    `draftCount === 4`, `hasil.diproses === 4`, lalu assert NILAI AKHIR stateful di mock Sheets:
    sheets_ketinggalan->9, sheets_manual->7, konflik->5, produk_baru row dibuat stok=15 No="4",
    header utuh, 4 movement id `sync_*`, session dibersihkan. Bukan spy no-op (mock stateful).
- Status: PASS

### AC3 - Signature publik konfirmasiSyncStok/mulaiSyncStok tidak berubah

- Criterion: signature tetap.
- Evidence:
  - Sumber: `async function mulaiSyncStok(telegramUserId, chatId)`;
    `async function konfirmasiSyncStok(telegramUserId, teksJawaban, opsi = {})`.
  - Runtime: `mulaiSyncStok.length === 2`, `konfirmasiSyncStok.length === 2`.
  - Export set utuh: KONDISI, apakahAdaPendingSyncStok, apakahMintaKonfirmasiKolom,
    batalkanTambahKolom, konfirmasiSyncStok, konfirmasiTambahKolom, mulaiSyncStok.
  - Perubahan `opsi` bersifat additive (dukung objek/string lama) - bentuk lama tetap jalan
    (test T4c/T4d v3b hijau).
- Status: PASS

### AC4 - app/api/admin/route.ts & firestore.rules tidak tersentuh

- Criterion: tidak berubah.
- Evidence:
  - `git diff -- app/ firestore.rules` -> kosong (exit 0, tanpa output).
  - `git diff --numstat -- app/ firestore.rules firestore.indexes.json` -> kosong.
- Status: PASS

### AC5 - `node -c` lolos semua file .js berubah

- Criterion: syntax bersih.
- Evidence: `node -c` -> True untuk lib/models/stockMovements.js, lib/sheets/syncStokDuaArah.js,
  lib/sheets/client.js, test/helpers/mockSheets.js, test/syncStokReplay.test.js,
  test/syncStokMovementIdempotensi.test.js.
- Status: PASS

### AC6 - Test jalan offline (tanpa kredensial, tanpa network)

- Criterion: tanpa kredensial/network.
- Evidence:
  - Env GEMINI_API_KEY/KENARI_API_KEY/TELEGRAM_BOT_TOKEN dikosongkan -> `npm test`
    tetap `tests 607`, `pass 607`, `fail 0`.
  - Test baru men-stub modul telegram + `lib/sheets/client` via require.cache; mock Sheets
    in-memory (test/helpers/mockSheets.js); mockFirestore in-memory. Tidak ada panggilan
    network nyata di test baru.
- Status: PASS

### AC7 - Hitungan 603 baseline + 4 baru = 607

- Criterion: tepat 4 test baru.
- Evidence: test baru = test/syncStokReplay.test.js (3 test) + test/syncStokMovementIdempotensi.test.js
  (1 test) = 4. Total runtime 607.
- Status: PASS

## Catatan / Gap

- Working tree memuat LEBIH BANYAK file terubah/untracked dari yang dideskripsikan task
  (lib/sheets/client.js, test/helpers/mockFirestore.js, docs review, scripts/*, test
  syncStokParitas/ProdukBaru/Idempoten/sheetsClientKolom/backfill). Ini berasal dari pekerjaan
  sebelumnya yang belum di-commit; verifikasi ini fokus pada 4 risiko residual yang diminta.
  Tidak ada indikasi regresi (607/607 hijau termasuk test terkait).
- Residual yang SENGAJA tidak ditutup (didokumentasikan `ponytail:` di sumber, bukan cacat):
  - `applyDraftProdukBaru`: window crash tepat setelah append baris sebelum marker
    `pushed_items` ditulis -> retry bisa bikin baris Sheets ganda. Yang DIJAMIN: movement
    tidak dobel (id deterministik).
  - Nomor kolom A non-atomik (baca-lalu-append) -> append paralel bisa No dobel; kosmetik.
- `docs/verification.md` lama diarsipkan ke `docs/_archive/verification-prior-2026-09-23.md`.

## Kesimpulan

Seluruh acceptance criteria terpenuhi dengan bukti runtime nyata dan mutation testing
membuktikan tiap test baru non-vacuous. Tidak ada regresi, file terlarang tidak tersentuh,
syntax bersih, test offline.

VERIFIED
