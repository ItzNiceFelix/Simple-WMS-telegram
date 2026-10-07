# Code Review - Follow-up /sync_stok (id_movement deterministik + idempotensi produk_baru)

Tanggal: 2026-09-23
Reviewer: independent senior code reviewer (tanpa mengubah source)
Scope yang direview (perubahan uncommitted, hanya 2 file yang diklaim):
- `lib/models/stockMovements.js`
- `lib/sheets/syncStokDuaArah.js`

Context: follow-up `/sync_stok` bugfix. Plan requirement:
- R1: id movement deterministik -> retry overwrite, bukan duplikat, walau marker absen.
- R2: `applyDraftProdukBaru` idempoten via `pushed_items[]`.
- R3: baca ulang kolom A sebelum tiap append, fallback `nomor=""` saat gagal baca.
- Signature publik `konfirmasiSyncStok`/`mulaiSyncStok` TIDAK berubah. `catatPergerakanStok` boleh tambah param opsional.

Metode: baca diff aktual + source penuh, lacak SEMUA caller `catatPergerakanStok`, jalankan `npm test` nyata.

**Konteks penting:** working tree punya **file test baru untracked** yang menargetkan perubahan ini
(`test/syncStokMovementIdempotensi.test.js`, `test/syncStokReplay.test.js`), walau tidak disebut di daftar file
yang diklaim. `npm test`: **607 pass / 0 fail**.

---

## Verdict per requirement

| Req | Verdict | Bukti |
|---|---|---|
| R1 id deterministik -> retry overwrite | **TERPENUHI** | `stockMovements.js:79-84` (`doc(id).set`); id `sync_${draft.id}_${item.kode_barang}` di `syncStokDuaArah.js:510,596`; test `syncStokMovementIdempotensi.test.js:70-86` (marker absen -> tetap 1 movement). |
| R2 produk_baru idempoten via pushed_items | **TERPENUHI** | `syncStokDuaArah.js:539,543,608`; test `syncStokReplay.test.js:181-206` (retry tidak tambah baris). |
| R3 baca ulang kolom A + fallback | **TERPENUHI** | `syncStokDuaArah.js:551-558` try/catch -> `nomor=""`; test `syncStokReplay.test.js:159-179`. |
| Signature `konfirmasiSyncStok`/`mulaiSyncStok` tetap | **TERPENUHI** | `konfirmasiSyncStok:342` signature sama; return `{ok,diproses,sisa}` di `:425`; `mulaiSyncStok:42` sama. |
| `catatPergerakanStok` backward-compatible | **TERPENUHI** | Param baru default `null` (`stockMovements.js:37`); 15+ call site lain omit -> jalur lama `.add` (`:85`). Tidak ada yang berubah. |

---

## Findings

### BLOCKER
Tidak ada.

### IMPORTANT

**I1. Retry `applyDraft` menulis ulang movement dengan `created_at` baru, dan `qty` delta dihitung ulang
dari paritas SAAT ITU.** `syncStokDuaArah.js:495-511`.
Skenario: attempt 1 sukses tulis movement + `tandaiTersinkron`, lalu crash sebelum marker `pushed_items`.
Attempt 2 (marker absen): `tandaiTersinkron` jalan lagi (idempoten, set abs `last_synced_value`), `stokSebelum`
= paritas yang **tidak berubah** oleh `tandaiTersinkron`, jadi `qty` delta identik -> overwrite semantik sama.
**Tidak ada korupsi stok.** Yang berubah hanya `created_at` movement (di-refresh). Ini konsekuensi desain yang
diterima, dan `app-level` id deterministik justru yang membuatnya aman. Bukan bug, tapi perlu dicatat:
jika di antara dua attempt ada mutasi stok lain pada kode yang sama, `qty` movement ter-overwrite jadi delta
baru — masih benar secara nilai, tapi audit trail "delta saat pertama sync" hilang. Dampak: audit-only.
Rekomendasi: tidak wajib; kalau audit historis penting, skip overwrite saat dok sudah ada (`create` bukan `set`).

**I2. `applyDraftProdukBaru` masih bisa duplikasi baris Sheets pada retry crash-window.**
`syncStokDuaArah.js:568-572` (komentar `ponytail` di kode sudah jujur mengakui ini).
Crash setelah `tambahBarisBaru` tapi sebelum marker `pushed_items` (`:602-609`) -> retry membuat baris ganda.
`id_movement` deterministik hanya menyelamatkan `stock_movements`, **bukan** baris Sheets (append tanpa key natural).
Diterima sebagai ceiling scope bugfix dan sudah didokumentasikan. Bukan blocker.
Catatan konsistensi: R2 secara literal ("idempoten via pushed_items") **terpenuhi untuk retry normal**, tapi
klaim di komentar `:537-538` ("retry 'ya produk_baru' tidak bikin baris ganda") sedikit overstate — hanya benar
selama marker sempat tertulis. Komentar `:568-571` sudah mengoreksi ini, jadi net-nya jujur.

### MINOR

**M1. `pushNilaiKeSheet` tetap dipanggil walau `nilaiSheetBaru` kosong (semua item di-skip).**
`syncStokDuaArah.js:517`. Saat retry penuh, array kosong -> tetap 1 round-trip `bacaRange(A2:B)` sia-sia.
Bukan bug, hanya pemborosan latensi kecil. Bisa di-guard `if (nilaiSheetBaru.length)`. Tidak wajib.

**M2. `nomor` fallback `""` disimpan sebagai string kosong di kolom A yang formatnya angka.**
`syncStokDuaArah.js:557,562`. Sesuai requirement R3 ("fallback nomor=''"). Aman, tapi baris berikutnya
yang dihitung dari `A2:A` akan tetap benar karena filter `trim() !== ""` (`:554`) mengabaikan sel kosong.
Konsisten. Tidak ada aksi.

**M3. `id_movement` tidak mencegah bentrok lintas koleksi/kode dengan karakter `_` di `draft.id`.**
`syncStokDuaArah.js:510`. ID = `sync_${draft.id}_${kode}`. Bila ada kombinasi `draft.id`/`kode` berbeda yang
menghasilkan string sama (mis. draft.id berakhiran `_K1` + kode `K2` vs draft.id lain + kode `K1_K2`), id
bertabrakan. `draft.id` Firestore acak 20 char (aman), dan kode tidak boleh mengandung `_` bebas di praktik.
Risiko teoretis rendah. Kalau mau kaku: pakai separator yang tidak mungkin muncul, atau `draft.id + ":" + kode`.

### NIT

**N1.** `id_movement` dibungkus `String(...)` (`stockMovements.js:81`) padahal sudah template string. Redundan
tapi harmless/defensif.

**N2.** `stockMovements.js:79` cek `!== null && !== undefined` — konsisten dengan gaya file lain. OK.

---

## Verifikasi regresi & backward compatibility

- **15+ call site lain `catatPergerakanStok`** (`permintaanGudang.js:914`, `opnameGudang.js:360`,
  `handleScreenshotPickingList.js:117`, `handleOpname.js:272`, `gemini/chatHandler.js:583,602,633,961,999`,
  test). Semua omit `id_movement` -> `null` -> jalur lama `db.collection.add` (`stockMovements.js:85`).
  **Tidak ada perubahan perilaku.** Return shape `{ id, ...payload }` tetap sama di kedua jalur (`:83` vs `:86`).
- **`applyDraft` return value** berubah dari `void` -> `number`, tapi hanya 1 caller (`:406`) dan sudah
  diperbarui. Tidak ada breaking change eksternal (`applyDraft` tidak diekspor, `module.exports:652-660`).
- **produk_baru**: `applyDraft` sekarang `return applyDraftProdukBaru(...)` (`:470`) dan TIDAK lagi memanggil
  `.update({status})` setelahnya (dihapus). `applyDraftProdukBaru` kini melakukan update status+pushed_items
  sendiri (`:603-609`). **Tidak ada double-write, tidak ada status yang hilang.** Verifikasi jalur: draft
  produk_baru tetap berakhir `status:"processed"`.
- **`applyDraft` non-produk_baru menulis `pushed_items`** (`:519-525`) — dicek: ya, `arrayUnion` di-guard
  `kodeBaruDipush.length > 0`, jadi draft yang semua item sudah di-skip hanya menulis `status`. Benar.
- **`bacaParitasOnline` dipakai di 3 titik** (`:73,156,495,580`) menggantikan baca mentah `stok_gudang_online`.
  Ini perubahan di luar scope R1-R3 yang diklaim, tapi **konsisten** dengan basis kanonik paritas v5
  (`stokGudang.js:40-43`). Untuk dokumen lama tanpa `qty_per_gudang`, fallback ke `stok_gudang_online` ->
  perilaku identik. Untuk dokumen v5 dengan map, kini benar (dulu baca field yang bisa basi). **Tidak ada regresi**,
  tapi perlu diakui sebagai perubahan perilaku tambahan yang tidak disebut di daftar file/requirement.

---

## Test quality (file test terkait, walau untracked)

- `syncStokMovementIdempotensi.test.js:70-86` menguji **inti R1**: marker dibuang (`pushed_items:null`) +
  status direset -> retry -> assert `movements.length === 1` dan `id === "sync_d-r1_K1"`. Menguji jalur
  produksi nyata via `konfirmasiSyncStok`. **Kuat.**
- `syncStokReplay.test.js:181-206` menguji **R2** end-to-end (retry tidak tambah baris). **Kuat.**
- `syncStokIdempoten.test.js:74-122` menguji skip item sudah-push + akumulasi `pushed_items`. **Kuat.**
- Gap: **tidak ada test** untuk M3 (tabrakan id teoritis) dan untuk I1 (perubahan `qty` pada retry setelah
  mutasi paralel). Coverage crash-window I1/I2 diakui absen (`docs/code-review.md:80`). Diterima.

---

## Kesimpulan

Tidak ada BLOCKER. R1, R2 (retry normal), R3 semuanya terpenuhi dan terverifikasi test yang mengeksekusi
jalur produksi. Backward compatibility `catatPergerakanStok` dan signature publik terjaga. Residual risk
(produk_baru crash-window, movement audit refresh) sudah didokumentasikan dan berada dalam batas scope.

Temuan I1/I2 adalah catatan audit-trail/edge-case yang diterima, bukan regresi fungsional.

**APPROVED**
