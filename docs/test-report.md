# Laporan Test - Bugfix Sheets Grid + Paritas Stok Online

Tanggal: 2026-09-23
Lingkup: 5 file test baru + 3 file sumber/helper diubah.
Metode: verifikasi independen - jalankan test nyata, syntax check, dan MUTATION TESTING
di salinan repo terpisah (`%TEMP%\opencode\bat-mut`) untuk membuktikan tiap test benar-benar
mengeksekusi jalur produksi (bukan trivially passing). Sumber asli di workspace tidak diubah.

File diubah/dibuat yang diperiksa:
- `lib/sheets/client.js` (grid-expand via spreadsheets.get + batchUpdate appendDimension; throw bila sheet tak ada)
- `lib/sheets/syncStokDuaArah.js` (bacaParitasOnline; kolom A No; idempotensi pushed_items)
- `test/helpers/mockFirestore.js` (FieldValue.arrayUnion)
- `test/sheetsClientKolom.test.js`, `test/syncStokParitas.test.js`, `test/syncStokProdukBaru.test.js`,
  `test/syncStokIdempoten.test.js`, `test/backfillLastSyncedValue.test.js`, `scripts/backfillLastSyncedValue.js`

---

## 1. Perintah yang dijalankan & hasil

| # | Perintah | Hasil |
|---|---|---|
| 1 | `npm test` | **602 pass, 0 fail**, 0 skipped/cancelled/todo. Duration 24058 ms. |
| 2 | `node -c` pada 9 file berubah/baru | **Sintaks OK semua** (`True` untuk tiap file). |
| 3 | Mutation test 5 skenario (di salinan) | **Semua mutasi terdeteksi** (test gagal saat logika produksi dikembalikan/dirusak). |

### 1.1 `npm test` - output aktual (tail)

```
ℹ tests 602
ℹ suites 0
ℹ pass 602
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 24058.4304
```

Tidak ada test lama yang pecah. 14 test baru (T1-T5) semuanya hijau.

### 1.2 Syntax check `node -c` (exit code / output `bool`)

| File | Hasil |
|---|---|
| `lib/sheets/client.js` | True |
| `lib/sheets/syncStokDuaArah.js` | True |
| `test/helpers/mockFirestore.js` | True |
| `test/sheetsClientKolom.test.js` | True |
| `test/syncStokParitas.test.js` | True |
| `test/syncStokProdukBaru.test.js` | True |
| `test/syncStokIdempoten.test.js` | True |
| `test/backfillLastSyncedValue.test.js` | True |
| `scripts/backfillLastSyncedValue.js` | True |

---

## 2. Verdict per acceptance criteria

| Req | Verdict | Bukti |
|---|---|---|
| **2.1** `npm test` hijau, no old test broken | **PASS** | 602/602 pass, 0 fail (bagian 1.1). |
| **2.2** `node -c` semua file berubah | **PASS** | 9/9 True (bagian 1.2). |
| **3.1 T1** grid-expand ordering + no-batchUpdate saat lebar + throw sheet hilang | **PASS** | 3 test `sheetsClientKolom.test.js`. Urutan `["values.get","get","batchUpdate","values.update"]` diassert persis. |
| **3.2 T2** paritas ONLINE preferred + fallback dokumen lama | **PASS** | `syncStokParitas.test.js` 3 test lewat jalur nyata `mulaiSyncStok`. |
| **3.3 T3** kolom A No = count+1 | **PASS** | `syncStokProdukBaru.test.js` lewat `konfirmasiSyncStok`. |
| **3.4 T4** idempotensi pushed_items skip + no duplicate movements | **PASS** | `syncStokIdempoten.test.js` lewat `konfirmasiSyncStok`. |
| **3.5 T5** pilihKodeBackfill pure function | **PASS** | `backfillLastSyncedValue.test.js` 6 test langsung. |

---

## 3. Falsifikasi - MUTATION TESTING (bukti test tidak trivially passing)

Salinan repo di temp, satu perubahan produksi di-revert per skenario, lalu test terkait dijalankan.

| Mutasi (produksi dikembalikan/dirusak) | Test | Hasil mutan | Kesimpulan |
|---|---|---|---|
| A. `bacaParitasOnline(stokFirestore)` -> `stokFirestore.stok_gudang_online` | `syncStokParitas.test.js` | **FAIL** `1 !== 0` (draft dibuat utk map 7 vs basi 3) | Test 1 benar-benar memverifikasi paritas map. |
| B. Hapus `row[0] = nomorBerikut++` | `syncStokProdukBaru.test.js` | **FAIL** `'' !== 3` | Test 3 benar-benar memverifikasi kolom A. |
| C. Hapus `if (sudahDipush.has(...)) continue;` | `syncStokIdempoten.test.js` | **FAIL** `3 !== 2` (K1 dobel movement) | Test 4 benar-benar membuktikan K1 di-skip. |
| D. Nonaktifkan blok `batchUpdate` expand | `sheetsClientKolom.test.js` | **FAIL** (batchUpdate absen dari urutan) | Test T1 benar-benar memverifikasi expand. |
| E. Hapus `throw` sheet-tak-ditemukan | `sheetsClientKolom.test.js` | **FAIL** (reject error beda: `TypeError reading 'gridProperties'`) | Test T1 throw benar-benar memverifikasi error path. |

Semua 5 mutasi terdeteksi -> test baru menguji jalur kode nyata, bukan tautologis.

### 3.1 Isu isolation yang diminta diverifikasi

- **T2 product cache (`syncStokParitas.test.js`)**: `beforeEach()` memanggil `invalidasiCacheProduk()`
  (baris 65) dan `berishakan` seluruh koleksi mock. `listSemuaProduk({hanyaOnline:true})` memakai
  `_cacheProdukOnline` module-level di `lib/models/produk.js`. Tanpa invalidasi, test 2/3 akan baca
  produk dari test sebelumnya. Test "sanity" (test 3) membuktikan cache TIDAK bocor: ia mengharapkan
  1 draft dari produk K3 yang baru di-seed (bila cache bocor ke data lama, hasilnya beda).
  **Verdict: isolasi benar, invalidasi dipanggil.**
- **T4 (`syncStokIdempoten.test.js`)**: benar-benar membuktikan K1 di-skip. Bukti: baseline 1 movement
  lama untuk K1; setelah apply, total 2 movement (K1 tetap 1, K2 +1). Mutasi C memberi 3 -> guard-lah
  yang mencegah. Assertion `draft.pushed_items.sort() == ["K1","K2"]` juga mengecek akumulasi arrayUnion.
  **Verdict: bukan false-positive.**

### 3.2 Helper mock `FieldValue.arrayUnion`

Mock meniru semantik Firestore (dedupe via `Set`, merge dengan nilai lama). Paritas perilaku dengan
Firestore asli memadai untuk kontrak yang diuji (akumulasi idempoten). Tidak ada assertion yang
diperlemah.

---

## 4. Kekhawatiran assertion lemah / residual risk

1. **T2 fallback test (test 2)** mengharapkan `0 draft`. Assertion "0" bisa lolos bila produk sama sekali
   tak ditemukan (query kosong) tanpa benar-benar menguji fallback. Mitigasi: test 3 "sanity" pada file yang
   sama membuktikan query mengembalikan produk & draft terbentuk saat ada beda. Mutasi A menunjukkan test 1
   sensitif. Risiko rendah, tapi test 2 sendiri tidak mengisolasi specifically fallback dari "produk tak
   ketemu".
2. **Mock Firestore tidak menolak `undefined`** (real Firestore menolak nilai `undefined` nested). Perbaikan
   `last_synced_value ?? null` di `bandingkanNilai` karenanya tidak diuji lewat mock; ia hanya diuji tidak
   langsung (test takkan menangkap regresi `undefined` bila dikembalikan). Ini gap mock, bukan regresi baru.
3. **T3 race comment**: `applyDraftProdukBaru` membaca kolom A lalu append non-atomik (dokumentasikan sebagai
   ponytail). Tidak ada test untuk append paralel -> nomor bisa dobel. Diterima sebagai kosmetik per komentar.
4. **`pushNilaiKeSheet` baca ulang `A2:B` per draft**: bila draft besar, N call. Di luar scope bugfix.
5. **`test/helpers/mockFirestore.js`** diubah untuk arrayUnion; test lama tetap 602 hijau -> tidak ada regresi.

---

## 5. Kesimpulan

- `npm test`: **602 pass / 0 fail**. Semua test lama tetap hijau.
- Syntax `node -c`: **9/9 OK**.
- T1-T5: **semua PASS** dan **falsifiable** (5/5 mutation test terdeteksi).
- Tidak ditemukan test yang hanya lolos karena assertion lemah untuk requirement inti (T1, T3, T4 kuat;
  T2 sedikit lemah pada jalur fallback murni tapi ditopang test sanity).
- Tidak ada blocker merge dari sisi test.
