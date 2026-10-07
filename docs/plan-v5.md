# Rencana Implementasi v5 - Dashboard Multi-Gudang, Permintaan Antar-Gudang, Opname ber-Approval, Is-Online

Status: rencana eksekusi task-level. Tanggal: 2026-09-16.
Sumber utama: `docs/architecture-v5.md` (808 baris, revisi 2), `docs/prd-v5.md` (1262 baris, revisi 4).
Sumber pendukung: `docs/learnings.md`, `package.json:12-19`, `e2e/histori.spec.ts`, `e2e/ringkasan.spec.ts`, `e2e/stok.spec.ts`.
DILARANG membaca/mengubah `docs/arsip-v4/`.

Dokumen ini RENCANA. Tidak ada kode sumber yang diubah. Setiap klaim kode existing memakai `file:baris`. ASCII saja, tanpa em-dash.

---

## 1. Tujuan

Menghasilkan daftar task kecil yang dapat diverifikasi sendiri untuk mengimplementasikan v5 mengikuti 6 wave di `docs/architecture-v5.md:647-702`.
Rencana ini memetakan setiap requirement PRD (F1-F10), aturan bisnis (BR1-BR16), dan 36 AC global (`docs/prd-v5.md:1021-1060`) ke task konkret dengan bukti selesai.

## 2. Aturan pengerjaan (berlaku SEMUA task)

1. **Gate CEPAT per task** (dipakai tiap iterasi): `npm test` (`node --test test/*.test.js`, `package.json:12`) 0 fail + `npx tsc --noEmit` exit 0 bila menyentuh `.ts`/`.tsx`. Unit run ~6 detik - ini gate utama, dipakai paling sering.
2. **Gate CEPAT per wave**: gate cepat per task + `npm run e2e:fast` (project `desktop` + `desktop-viewport`, ~155s). HANYA untuk wave yang menyentuh UI.
3. **Gate PENUH sebelum rilis** (terakhir saja, sekali): `npm run e2e:full` (~205s) + 3 spec COUNT.
4. **e2e pengunci COUNT dijalankan SEBELUM menambah seed apa pun**: `npx playwright test --project=desktop e2e/histori.spec.ts e2e/ringkasan.spec.ts e2e/stok.spec.ts`.
   Penjaga angka: `e2e/histori.spec.ts:50` dan `:135` (`toHaveCount(12)`), `e2e/ringkasan.spec.ts:67` (`toHaveCount(10)`), `e2e/stok.spec.ts` (jumlah baris tabel).
5. **File baru wajib UTF-8 tanpa BOM** (`docs/learnings.md:27`). Scan `git status` sebelum commit; byte 0xEF 0xBB 0xBF = BOM.
6. **Setiap task tulis STATUS**: `[ ]` belum / `[x]` selesai di baris judul task.
7. **Test route wajib memanggil `POST()` asli**, bukan mirror helper (`docs/learnings.md:24`). Tapi ini HANYA untuk route baru; jangan bikin test route untuk route lama yang tidak diubah.
8. **Nama field snake_case** (BR12, `docs/prd-v5.md:495-498`); waktu = `created_at`/`updated_at`, BUKAN `dibuat_at`.
9. **Verifikasi index** sebelum klaim query aman: `firebase firestore:indexes --project bot-admin-toko-a0c47` (`docs/learnings.md:35`).
10. **PRINSIP TEST RINGAN** (lihat bagian 2b): unit test murni adalah gate utama. E2e seminimal mungkin. Jangan test hal yang sama dua kali. Mock dipisah agar tidak membengkak.

---

## 2b. Strategi Test - Ringan, Cepat, Akurat

Proyek dikejar deadline. Test harus menangkap bug logika dengan cepat, bukan menghabiskan waktu.

### Piramida test

| Lapis | Jumlah | Waktu | Peran |
|---|---|---|---|
| Unit (`npm test`) | ~350-380 | ~6 detik | **GATE UTAMA.** Panggil fungsi, cek input/output. Tanpa browser/Firestore/network. |
| E2e cepat (`e2e:fast`) | per-wave | ~155 detik | Render + alur UI yang tidak bisa diuji unit. |
| E2e penuh (`e2e:full`) | rilis | ~205 detik | Sekali sebelum rilis. |

### Aturan kapan sesuatu LAYAK jadi e2e

| Kondisi | Test yang tepat |
|---|---|
| Logika fungsi (hitung, validasi, transisi status, filter) | **UNIT.** Jangan e2e. |
| Perilaku route (status code, urutan guard) | **UNIT** yang memanggil `POST()`. |
| Transaksi/CAS | **UNIT model** (`mockFirestore.js`). Bukan Firestore nyata. |
| Komponen render, navigasi halaman, interaksi user | **E2E** (minimal). |
| Layout responsif | **E2E** 1-2 test batas viewport saja. |

### Anti-redundansi

- Kalau logika sudah diuji unit, e2e TIDAK menguji ulang. Contoh: filter histori sudah di unit -> e2e histori cukup cek render tabel + 1 interaksi.
- Jangan buat test yang cuma membuktikan hal yang sama dengan test lain di file berbeda.
- Test `POST()` cukup SATU per route baru, tidak perlu per-aksi.

### Konfigurasi Playwright (task `W0-T1`)

- **Buang project `tablet`** - ganti 1 test batas 768px di `e2e/responsif.spec.ts`.
- **Pecah project via `testMatch`**: `desktop` (mayoritas spec, logika-identik), `desktop-viewport` + `mobile` (spec layout-sensitif saja: `responsif`, `stok`, `tambah-produk`, `histori`, `kata-kunci`).
- **Reporter**: `line` di lokal, `html` hanya CI.
- **Script baru** di `package.json`: `e2e:fast` (`playwright test --project=desktop --project=desktop-viewport`), `e2e:full` (`node scripts/e2e-build.mjs && playwright test`).

### Target angka (dipakai di semua task test di dokumen ini)

| File test | Target jumlah test |
|---|---|
| `test/stokGudangQty.test.js` | 12-16 |
| `test/gudangMaster.test.js` | 12-15 |
| `test/adminGudangJabatan.test.js` | 8-10 |
| `test/guardV5.test.js` | 6-8 |
| `test/stockFilter.test.js` | 10-12 |
| `test/indexFirestoreV5.test.js` | 8-10 |
| `test/mockParitas.test.js` (perluas) | +8-10 |
| `test/permintaanGudang.test.js` | 18-22 |
| `test/opnameGudang.test.js` | 10-12 |
| `test/casModelFirestore.test.js` | 3 |
| `test/urutanGuardV5.test.js` | 6-8 |
| `test/produkOnline.test.js` | 5-6 |
| **E2e baru TOTAL** | **<= 20** |
| `e2e/gudang-v5.spec.ts` | 6 |
| `e2e/permintaan-gudang.spec.ts` | 8 |
| `e2e/opname-gudang.spec.ts` | 5 |

---

## 2c. Wave 0 - Prasyarat: konfigurasi e2e (dikerjakan PALING AWAL)

### [ ] W0-T1 - Ringankan konfigurasi Playwright + script e2e

**File**: `playwright.config.ts` (ubah), `package.json` (ubah).

**Kerja** (rujuk `docs/audit-e2e.md`):
- Buang project `tablet` (768x1024). Ganti dengan 1 test batas viewport di `e2e/responsif.spec.ts` (assert tidak overflow pada 768px).
- Pecah project via `testMatch`:
  - `desktop` (1280x800): semua spec KECUALI daftar layout-sensitif di bawah.
  - `desktop-viewport` (1280x800) dan `mobile` (360x640): hanya `responsif.spec.ts`, `stok.spec.ts`, `tambah-produk.spec.ts`, `histori.spec.ts`, `kata-kunci.spec.ts`.
- Reporter: `line` saat lokal, `html` hanya bila `process.env.CI`.
- `package.json`: tambah `"e2e:fast": "playwright test --project=desktop --project=desktop-viewport"` dan `"e2e:full": "node scripts/e2e-build.mjs && playwright test"`.

**Bukti selesai**: `npm run e2e:fast` selesai < 180s, 0 fail; jumlah eksekusi turun dari 450 ke ~190 (lihat `docs/audit-e2e.md`).
**Dependency**: tidak ada. **Kompleksitas**: KECIL.

---
## 3. Wave 1 - Fondasi model stok & paritas

Rujukan: `docs/architecture-v5.md:248-330` (bagian 4), `docs/architecture-v5.md:651-658` (Wave 1).
Tidak ada dependency. Wave 1 dapat dimulai segera.

### [ ] W1-T1 - Helper paritas murni di `lib/models/stok.js`

**File**: `lib/models/stok.js` (ubah).

**Kerja**:
- Tambah `normalisasiQtyPerGudang(data)` (`docs/architecture-v5.md:252-255`): in = data dokumen `stock` mentah, out = `Record<string, number>`. Absen `qty_per_gudang` -> fallback `{ "ONLINE": data.stok_gudang_online ?? 0 }`. Nilai non-angka dibuang. Ini SATU-SATUNYA fungsi pembentuk map dari bahan mentah.
- Tambah `_bacaParitasOnline(data)` = `normalisasiQtyPerGudang(data)["ONLINE"] ?? 0` (`docs/architecture-v5.md:257-258`).
- Faktanya kode existing `lib/models/stok.js:55` membaca `stok_gudang_online || 0` langsung; itu diganti pemakaian `_bacaParitasOnline(doc.data())` supaya satu jalur baca.

**Bukti selesai**: unit test `test/stokGudangQty.test.js` (W1-T3) memverifikasi fallback; `npm test` hijau.
**Dependency**: tidak ada.
**Kompleksitas**: KECIL

### [ ] W1-T2 - Paritas BR3 di 3 fungsi tulis lama

**File**: `lib/models/stok.js` (ubah `buatStokAwal`, `_ubahStokRelatif`, `timpaStokOpname`).

**Kerja** (`docs/architecture-v5.md:269-275`):
- `buatStokAwal` (`lib/models/stok.js:24-42`): payload tambah `qty_per_gudang: { "ONLINE": stokAwal }`.
- `_ubahStokRelatif` (`lib/models/stok.js:51-67`): `trx.set` tambah `qty_per_gudang` key `"ONLINE"` = `nilaiBaru`, merge. `stok_gudang_online` tetap ditulis. Pakai spread map lama bila ada (`{...normalisasiQtyPerGudang(doc.data()), "ONLINE": nilaiBaru}`) supaya key gudang lain tidak hilang.
- `timpaStokOpname` (`lib/models/stok.js:86-103`): idem, tulis `qty_per_gudang["ONLINE"]` = `qtyFisikBaru`.
- `tandaiTersinkron` (`lib/models/stok.js:107-117`) TIDAK disentuh (`docs/architecture-v5.md:274-275`, bagian 4.5).

**Bukti selesai**: `test/stokGudangQty.test.js` assert `stok_gudang_online === qty_per_gudang["ONLINE"]` setelah tiap mutasi, DAN assert `tandaiTersinkron` TIDAK mengubah keduanya (`docs/architecture-v5.md:654-656`).
**Dependency**: W1-T1.
**Kompleksitas**: KECIL

### [ ] W1-T3 - `test/stokGudangQty.test.js`

**File**: `test/stokGudangQty.test.js` (baru), pakai `test/helpers/mockFirestore.js` (`installMockFirestore()` sebelum `require` modul).

**Kerja**: uji paritas + isolasi key:
- `normalisasiQtyPerGudang` fallback `{"ONLINE": stok_gudang_online}` saat `qty_per_gudang` absen.
- `buatStokAwal` / `_ubahStokRelatif` / `timpaStokOpname` menulis `qty_per_gudang["ONLINE"]` + `stok_gudang_online` nilai sama.
- `_ubahStokRelatif` TIDAK menghapus key gudang lain dalam `qty_per_gudang`.
- `tandaiTersinkron` TIDAK menyentuh `stok_gudang_online` maupun `qty_per_gudang` (`docs/architecture-v5.md:318-321`).
- Nilai non-angka di `qty_per_gudang` dibuang/di-null-kan.

**Bukti selesai**: test file hijau via `npm test`; **target 12-16 test**; mutation: hapus tulis paritas -> test merah.
**Dependency**: W1-T1, W1-T2.
**Kompleksitas**: SEDANG
### [ ] W1-T4 - `lib/models/stokGudang.js` helper transaksi

**File**: `lib/models/stokGudang.js` (baru, CJS).

**Kerja** (`docs/architecture-v5.md:190, 265-266`):
- Ekspor `normalisasiQtyPerGudang(data)`, `bacaParitasOnline(data)` (re-export atau implementasi bersama `stok.js` - SATU sumber kebenaran).
- `tambahQtyPerGudang(trx, ref, gudangId, delta)`: baca `trx.get(ref)`, tulis `{ qty_per_gudang: {...map, [gudangId]: nilai+delta}, stok_gudang_online: gudangId==="ONLINE" ? nilai+delta : map.stok_gudang_online }` merge.
- `kurangiQtyPerGudang(trx, ref, gudangId, delta)`: idem; TETAP menulis paritas bila `gudangId === "ONLINE"`.
- `setQtyPerGudangDalamTransaksi(...)`: set nilai absolut.
- ATURAN: `stokGudang.js` TIDAK mengimpor `db` dan TIDAK mengekspor `setQtyGudang` (`docs/architecture-v5.md:194-199`).

**Bukti selesai**: file require bersih; dipakai W1-T5 + W4 model; `npm test` hijau.
**Dependency**: W1-T1.
**Kompleksitas**: KECIL

### [ ] W1-T5 - `setQtyGudang` + `tambahStokGudang`/`kurangiStokGudang` di `stok.js`

**File**: `lib/models/stok.js` (ubah).

**Kerja** (`docs/architecture-v5.md:260-266`):
- `setQtyGudang(kodeBarang, gudangId, qty, oleh)`: `runTransaction`; doc `stock` tidak ada -> return null (route 404). Tulis `qty_per_gudang[gudangId]` + `last_updated` + `last_updated_by`; bila `gudangId === "ONLINE"` tulis juga `stok_gudang_online` = qty DALAM TRANSAKSI SAMA (BR3). `invalidasiCacheStok()` setelah commit.
- `tambahStokGudang` / `kurangiStokGudang`: wrapper tipis ke helper `stokGudang.js` (dipakai `permintaanGudang.js`).
- Tambah kelima nama ke `module.exports` (`lib/models/stok.js:178-189`).
- Klaim C2 ditutup: `setQtyGudang` HANYA di `stok.js` (`docs/architecture-v5.md:196-199`).

**Bukti selesai**: `test/stokGudangQty.test.js` uji `setQtyGudang`: null bila kode tak ada; isolasi antar key; paritas bila `"ONLINE"`. Bagian dari target 12-16 test file itu.
**Dependency**: W1-T1, W1-T2, W1-T4.
**Kompleksitas**: SEDANG

### [ ] W1-T6 - Gate Wave 1

**Kerja**: jalankan `npm test` + `npx tsc --noEmit`; jalankan `npx playwright test e2e/histori.spec.ts e2e/ringkasan.spec.ts e2e/stok.spec.ts` (baseline, sebelum seed apa pun); catat hasil.

**Bukti selesai**: `npm test` 0 fail; `tsc` exit 0; 3 spec e2e 0 fail; `test/indexFirestore.test.js` existing tetap hijau (`docs/architecture-v5.md:657`).
**Dependency**: W1-T1..W1-T5.
**Kompleksitas**: KECIL

---

## 4. Wave 2 - Master gudang + admin/jabatan + validator dispatcher

Rujukan: `docs/architecture-v5.md:660-667` (Wave 2), `docs/prd-v5.md:79-164` (F1, F3, F4).
Dependency: Wave 1.

### [ ] W2-T1 - `lib/models/gudang.js`

**File**: `lib/models/gudang.js` (baru, CJS).

**Kerja** (`docs/architecture-v5.md:189`, `docs/prd-v5.md:517-533`):
- `listGudang({semua})`: `aktif:true` default; pola full scan + filter client `real.ts:380-396`; urut `urutan` lalu `nama` asc.
- `ambilGudang(id)`.
- `tambahGudang({nama,oleh})`: trim 1-60 char; duplikat case-insensitive antar `aktif:true` -> error `"Nama gudang sudah dipakai."`; jumlah dokumen (aktif+nonaktif) sudah 50 -> error `"Maksimal 50 gudang."` (BR15, `docs/prd-v5.md:89`); `urutan` = maks+1; `aktif:true`, `created_at`, `created_by`.
- `editGudang({gudang_id,nama,oleh})`: 404 bila tak ada; 409 duplikat; tulis `nama` + `updated_at` + `updated_by`.
- `nonaktifkanGudang`: set `aktif:false` + `nonaktif_at` + `nonaktif_by`; hitung `peringatan_referensi = adminCount + stockKeyCount` (`docs/prd-v5.md:93-94`).
- `aktifkanGudang`.
- Tolak `gudang_id` berpath `/` (400 `"ID gudang tidak valid."`).

**Bukti selesai**: `test/gudangMaster.test.js` hijau.
**Dependency**: Wave 1.
**Kompleksitas**: SEDANG

### [ ] W2-T2 - Perluasan `lib/models/admins.js`

**File**: `lib/models/admins.js` (ubah).

**Kerja** (`docs/prd-v5.md:690-692`):
- `setGudangUser(targetUserId, gudangId, oleh)`: `update` field `gudang_id` (boleh `null`); TIDAK mengubah `role`; validasi target ada (`ambilAdmin`) -> error `"User belum terdaftar."`.
- `setJabatan(targetUserId, jabatan, oleh)`: `jabatan` string 0-40 char atau null; TIDAK mengubah `role`; > 40 -> error `"Jabatan maksimal 40 karakter."` (hitung per code point).
- Catat audit lewat `catatPerubahanRole` dengan `catatan` (`"set_gudang"` / `"set_jabatan"`), `old_role`/`new_role` = role tidak berubah; gagal audit -> `peringatan_audit:true`, tidak rollback (BR10).
- Tambah kedua nama ke `module.exports` (`lib/models/admins.js:142-155`).

**Bukti selesai**: `test/adminGudangJabatan.test.js` hijau (bagian W2-T7).
**Dependency**: W2-T1.
**Kompleksitas**: KECIL

### [ ] W2-T3 - `catatan` opsional di `lib/models/adminRoleChanges.js` (B3)

**File**: `lib/models/adminRoleChanges.js` (ubah).

**Kerja** (`docs/architecture-v5.md:228`, `docs/prd-v5.md:139`):
- `catatPerubahanRole({..., catatan = null})`: tambah field `catatan` ke payload (`lib/models/adminRoleChanges.js:5-14`).
- Backward-compatible: absen -> `null`.

**Bukti selesai**: test audit di `test/adminGudangJabatan.test.js`; `test/adminRole.test.js` + `test/auditRole.test.js` existing tetap hijau.
**Dependency**: tidak ada (dapat paralel W2-T2).
**Kompleksitas**: KECIL

### [ ] W2-T4 - `lib/dashboard/validasiGudangV5.js`

**File**: `lib/dashboard/validasiGudangV5.js` (baru, CJS).

**Kerja** (`docs/architecture-v5.md:206`, `docs/prd-v5.md:685`): ekspor `validasiAksiGudang` (aksi `tambah`/`edit`/`nonaktif`/`aktifkan`), `validasiGudangId` (tolak `/`), `validasiNamaGudang` (trim 1-60). Pesan PERSIS PRD (`"Nama gudang wajib diisi."`, dst).

**Bukti selesai**: dipakai route W2-T8; unit test lewat `test/gudangMaster.test.js` (panggil `POST()`).
**Dependency**: tidak ada.
**Kompleksitas**: KECIL

### [ ] W2-T5 - Perluasan `validasiAksiAdmin` (Z1)

**File**: `lib/dashboard/validasiTulisV3a.js` (ubah).

**Kerja** (`docs/prd-v5.md:1212-1225`):
- Tambah cabang `set-gudang-user`: validasi `target_user_id` pola `^\d+$` (`"User ID Telegram tidak valid."`) + `gudang_id` string atau `null`; return `{ok:true, status:200, aksi:"set-gudang-user", targetUserId, gudangId}`.
- Tambah cabang `set-jabatan`: `target_user_id` pola `^\d+$` + `jabatan` string 0-40 char atau null/absen; > 40 -> `"Jabatan maksimal 40 karakter."`; return `{ok:true, status:200, aksi:"set-jabatan", targetUserId, jabatan}`.
- Kedua cabang DITARUH SEBELUM fallback `if (b.aksi !== "kata-kunci")` (`lib/dashboard/validasiTulisV3a.js:248-249`).
- Ekspor helper bila perlu; jangan ubah cabang lama.

**Bukti selesai**: test dispatcher (bagian `test/adminGudangJabatan.test.js`) dengan body valid -> `ok:true` (bukan 400 `"Aksi tidak dikenal."`); body invalid -> 400 pesan validator.
**Dependency**: tidak ada.
**Kompleksitas**: KECIL

### [ ] W2-T6 - `lib/dashboard/guardV5.js`

**File**: `lib/dashboard/guardV5.js` (baru, CJS).

**Kerja** (`docs/architecture-v5.md:209, 541-566`):
- `tulisGuardV5(namaKoleksi, uid, payload)`: `get` dokumen `{namaKoleksi}/{uid}`; bila ada & `Date.now() - at <= 10_000` & seluruh key payload sama -> `{duplikat:true}`; else `set(payload + {at: Date.now()}, {merge:false})`.
- Error I/O -> TIDAK memblokir, log `[guard_v5_failed]` (`docs/architecture-v5.md:544`).
- Ekspor `GUARD_V5` = peta nama koleksi (`permintaan_gudang_guard`, `opname_gudang_guard`, `gudang_guard`, `stok_gudang_guard`, `produk_online_guard`).
- Bandingkan KEY YANG SAMA dengan tabel bagian 6 (bukan subset), karena `{merge:false}` menimpa (E1).

**Bukti selesai**: `test/guardV5.test.js` hijau.
**Dependency**: tidak ada.
**Kompleksitas**: SEDANG
### [ ] W2-T7 - `test/gudangMaster.test.js`, `test/adminGudangJabatan.test.js`, `test/guardV5.test.js`

**File**: 3 file test baru.

**Kerja**:
- `test/gudangMaster.test.js`: CRUD, duplikat 409, batas 50 (ke-51 -> 400), owner-only 403, `peringatan_referensi` = adminCount + stockKeyCount (T11c). Minimal satu test meng-import dan memanggil `POST()` dari `app/api/gudang/route.ts`.
- `test/adminGudangJabatan.test.js`: `set-gudang-user`/`set-jabatan` lewat `POST()` `app/api/admin/route.ts`; `jabatan` > 40 -> 400; `jabatan` tidak mengubah `role`; `jabatan:"owner"` pada guest -> 403 (T12, `docs/prd-v5.md:943`); body invalid -> 400 validator.
- `test/guardV5.test.js`: tiap guard BR11 kategori A menolak duplikat < 10s dengan 409 dan TIDAK memanggil model (spy); kategori B (`set-jabatan`/`set-gudang-user`) boleh diulang (`docs/prd-v5.md:960`).

**Bukti selesai**: 3 file hijau `npm test`; `tsc` exit 0.
**Dependency**: W2-T1..W2-T6.
**Kompleksitas**: SEDANG

### [ ] W2-T8 - `app/api/gudang/route.ts`

**File**: `app/api/gudang/route.ts` (baru, `runtime="nodejs"`, `dynamic="force-dynamic"`).

**Kerja** (`docs/architecture-v5.md:214`, `docs/prd-v5.md:649-660`):
- URUTAN GUARD BARU: `tolakOrigin` -> sesi cookie -> `cekRateLimit` 20/menit -> role dari `admins` -> validasi body (`docs/prd-v5.md:649`). Guest 403 SEBELUM validasi body.
- Role owner-only; admin/guest -> 403 `"Hanya owner yang dapat mengelola gudang."`.
- Panggil `tulisGuardV5("gudang_guard", uid, {aksi, nama})`; duplikat -> 409.
- Dispatch dari `validasiAksiGudang` ke `lib/models/gudang.js`; petakan error model -> status/pesan (pola `app/api/permintaan/route.ts:38-46`).
- Log `[gudang_v5_reject]`/`[gudang_v5_success]` `{uid, aksi, alasan}`.

**Bukti selesai**: `test/gudangMaster.test.js` memanggil `POST()`; status 200/400/403/409 sesuai.
**Dependency**: W2-T1, W2-T4, W2-T6.
**Kompleksitas**: SEDANG

### [ ] W2-T9 - Perluasan `app/api/admin/route.ts` (2 cabang dispatch)

**File**: `app/api/admin/route.ts` (ubah).

**Kerja** (`docs/prd-v5.md:696-700`, `docs/architecture-v5.md:237`):
- Tambah 2 cabang dispatch pola baris `app/api/admin/route.ts:95-112`: `set-gudang-user` -> `setGudangUser`; `set-jabatan` -> `setJabatan`.
- Owner-only (`"Hanya owner yang dapat mengatur lokasi user."` untuk set-gudang-user); rate limit bucket `aksi` 40/menit sudah ada (`app/api/admin/route.ts:74-79`) - aksi baru ikut bucket itu (`docs/prd-v5.md:913`).
- Urutan route existing (validasi -> rate limit -> role) TIDAK diubah (T18 hanya untuk route BARU).

**Bukti selesai**: `test/adminGudangJabatan.test.js` memanggil `POST()`; `test/adminRoute.test.js`/`test/adminRouteV3b.test.js` existing tetap hijau.
**Dependency**: W2-T2, W2-T3, W2-T5.
**Kompleksitas**: KECIL

### [ ] W2-T10 - Gate Wave 2

**Kerja**: `npm test` + `npx tsc --noEmit`. Jalankan ulang 3 e2e pengunci COUNT (belum ada seed baru, harus tetap hijau).

**Bukti selesai**: 0 fail semua; 3 spec e2e 0 fail.
**Dependency**: W2-T1..W2-T9.
**Kompleksitas**: KECIL

---

## 5. Wave 3 - DataSource migration

Rujukan: `docs/architecture-v5.md:601-643, 669-678` (bagian 8, Wave 3), `docs/prd-v5.md:395-421` (F10), `:947-958` (F9).
Dependency: Wave 1, Wave 2.
URUTAN DALAM WAVE WAJIB (bukan paralel): `types.ts` -> `index.ts` -> `real.ts` -> `mock-v5.ts` (BARU, domain v5) -> `mock.ts` (delegasi tipis) -> `sumber-data.tsx` -> `mock-data.ts` -> `mock-paritas.js` (`docs/architecture-v5.md:603-614`).

### [ ] W3-T1 - `lib/dashboard/types.ts` tipe baru

**File**: `lib/dashboard/types.ts` (ubah).

**Kerja** (`docs/architecture-v5.md:631-638`):
- `StockRow` (`types.ts:60-69`) + `qty_per_gudang: Record<string, number>` + `qty_gudang_terpilih: number | null`.
- `RoleChangeDoc` (`types.ts:213`) + `catatan?: string | null`.
- Tipe baru: `GudangDoc`, `TujuanEntri`, `PermintaanGudangDoc`, `OpnameGudangDoc`, `UserTujuanDoc` (`docs/prd-v5.md:517-592`).
- Request/Response v5 pola `types.ts:287-523`: `TambahGudangRequest`, `SetQtyGudangRequest`, `BuatPermintaanRequest`, `KirimPermintaanRequest`, `TerimaTujuanRequest`, `TutupTujuanRequest`, `BuatOpnameRequest`, `SetujuiOpnameRequest`, `ToggleOnlineRequest`, `SetGudangUserRequest`, `SetJabatanRequest` + pasangan Response `{ok:true,...} | {ok:false,error}`.
- SEMUA tipe di file ini, TIDAK inline di `index.ts` (`docs/architecture-v5.md:604`).

**Bukti selesai**: `npx tsc --noEmit` exit 0 (setelah W3-T2).
**Dependency**: Wave 1/2 (tidak butuh, tapi wave gate).
**Kompleksitas**: SEDANG

### [ ] W3-T2 - `lib/dashboard/data/index.ts` kontrak DataSource

**File**: `lib/dashboard/data/index.ts` (ubah).

**Kerja** (`docs/architecture-v5.md:605-628`, daftar KONTRAK BEKU):
- Ubah signature `listStock` (baris 68) -> `listStock(filter?: StockFilter)` (argumen OPSIONAL -> pemanggil lama kompilasi, `app/stok/page.tsx:74`).
- Export `interface StockFilter { gudang_id?: string | null; is_online?: boolean | "semua"; sertakan_tanpa_gudang?: boolean }` (`docs/architecture-v5.md:364-371`).
- Tambah 20 method ke `interface DataSource` (nama PERSIS `docs/architecture-v5.md:618-625`): `listGudang`, `listPermintaanGudang`, `listOpnameGudang`, `listUserTujuan`, `buatPermintaanGudang`, `setujuiPermintaanGudang`, `tolakPermintaanGudang`, `batalPermintaanGudang`, `kirimPermintaanGudang`, `terimaPermintaanGudang`, `tidakTerimaPermintaanGudang`, `tutupTujuanPermintaan`, `ubahItemPermintaan`, `buatOpnameGudang`, `setujuiOpnameGudang`, `tolakOpnameGudang`, `toggleOnline`, `setQtyGudang`, `setGudangUser`, `setJabatan`.

**Bukti selesai**: `tsc` exit 0 setelah W3-T3/T4/T5 lengkap (satisfies menagih).
**Dependency**: W3-T1.
**Kompleksitas**: KECIL

### [ ] W3-T3 - `lib/dashboard/data/real.ts` filter + method baru

**File**: `lib/dashboard/data/real.ts` (ubah).

**Kerja** (`docs/architecture-v5.md:332-383, 607`):
- `rowsStok(opts: StockFilter = {})` (`real.ts:164-187`): baca SEMUA produk (bukan hanya `semuaProdukOnline()`, `real.ts:143-162`), join `stock`, isi `qty_per_gudang` (via `normalisasiQtyPerGudang`) + `qty_gudang_terpilih` null; filter `is_online` (default true, `"semua"` = tanpa filter), `gudang_id`, `sertakan_tanpa_gudang`.
- `getRingkasan()` (`real.ts:228-255`): panggil `rowsStok({ is_online: true })` - arti `totalProdukOnline`/`itemMenipis`/`itemMinus` TIDAK berubah (B2, AC global #26).
- `status`/`kekurangan` dihitung dari `qty_gudang_terpilih` bila gudang dipilih, dari `stok_gudang_online` bila tidak (`docs/prd-v5.md:387`).
- Semua 20 method baru: client SDK read + `fetch` POST ke route untuk tulis (pola `kirimTulis`, `real.ts:120-133`).
- Flag `perlu_gudang:true` / `gudang_nonaktif:true` + pesan (`docs/prd-v5.md:382-383`).
- Query `listPermintaanGudang` pakai index #1-#4, `listOpnameGudang` #5-#6, `listUserTujuan` #7 (`docs/prd-v5.md:751-759`).

**Bukti selesai**: `test/stockFilter.test.js` (W3-T8) dan `test/indexFirestoreV5.test.js` (W3-T9) hijau; `tsc` exit 0.
**Dependency**: W3-T1, W3-T2.
**Kompleksitas**: BESAR

### [ ] W3-T4 - `lib/dashboard/data/mock.ts` filter + method baru

**File**: `lib/dashboard/data/mock.ts` (ubah).

**Kerja** (`docs/architecture-v5.md:608, 673-675`):
- `listStock(filter?)` (`mock.ts:442-447`): aturan bisnis SAMA dengan real (default online, filter gudang, `sertakan_tanpa_gudang`, flag admin).
- `getRingkasan()` (`mock.ts:420-425`): paritas B2 - hanya online.
- 20 method baru dengan aturan BR1/BR5/BR6 sama (`docs/prd-v5.md:978`).
- **PECAH SEJAK AWAL (revisi 2)**: logika domain v5 (`listStock` filter, `getRingkasan` paritas, ~20 method baru, aturan bisnis v5) MASUK ke `lib/dashboard/data/mock-v5.ts` (file baru), BUKAN menumpuk di `mock.ts`. `mock.ts` hanya: import dari `mock-v5.ts` + delegasi tipis. Target `mock.ts` < 1400 baris. Alasan: baseline sudah 1165 baris; menambah 20 method + aturan akan membengkak dan memperlambat iterasi.

**Bukti selesai**: `test/mockParitas.test.js` (perluas) hijau; `tsc` exit 0; keputusan ukuran file dicatat.
**Dependency**: W3-T3.
**Kompleksitas**: BESAR

### [ ] W3-T5 - `lib/dashboard/sumber-data.tsx` stub `dataKosong()`

**File**: `lib/dashboard/sumber-data.tsx` (ubah).

**Kerja**: tambah `tolak` untuk 20 method baru di `dataKosong()` (`sumber-data.tsx:196-235`) supaya `satisfies DataSource` (`sumber-data.tsx:234`) kompilasi.

**Bukti selesai**: `tsc` exit 0.
**Dependency**: W3-T2.
**Kompleksitas**: KECIL

### [ ] W3-T6 - `lib/dashboard/data/mock-data.ts` seed store terpisah

**File**: `lib/dashboard/data/mock-data.ts` (ubah).

**Kerja** (`docs/architecture-v5.md:611-612`): seed ke store TERPISAH: `store.gudang`, `store.permintaanGudang`, `store.opnameGudang`. TIDAK ke `store.movements`/`store.stock` bersama (`mock.ts:80-102`). Ekspor `MOCK_GUDANG`, `MOCK_PERMINTAAN_GUDANG`, `MOCK_OPNAME_GUDANG`; tambah ke `store` di `mock.ts:80-102`. Ini menutup AR7/R2 (seed v5 tidak merusak e2e COUNT).

**Bukti selesai**: 3 e2e pengunci COUNT tetap hijau setelah seed; `npm test` hijau.
**Dependency**: W3-T4.
**Kompleksitas**: SEDANG

### [ ] W3-T7 - `lib/dashboard/data/mock-paritas.js` guard aksi v5

**File**: `lib/dashboard/data/mock-paritas.js` (ubah).

**Kerja** (`docs/architecture-v5.md:613`): tambah guard mock untuk aksi v5 (paritas guard server). Pola existing `mock-paritas.js:36-60`. CJS murni supaya bisa di-`require` `node --test`.

**Bukti selesai**: `test/mockParitas.test.js` hijau.
**Dependency**: W3-T6.
**Kompleksitas**: KECIL
### [ ] W3-T8 - `test/stockFilter.test.js`

**File**: `test/stockFilter.test.js` (baru, Z3).

**Kerja** (`docs/prd-v5.md:947-958`): satu test per cabang: default online; `is_online:"semua"`; `is_online:false`; filter gudang; kombinasi gudang+online; `sertakan_tanpa_gudang:true` -> `qty_gudang_terpilih:null`; admin tanpa gudang -> semua + `perlu_gudang:true`; admin gudang nonaktif -> 0 baris + `gudang_nonaktif:true` + pesan; `status`/`kekurangan` dari `qty_gudang_terpilih`; `qty_per_gudang` non-angka -> null.

**Bukti selesai**: semua cabang hijau; `tsc` exit 0.
**Dependency**: W3-T3, W3-T4.
**Kompleksitas**: SEDANG

### [ ] W3-T9 - `test/indexFirestoreV5.test.js` (pemilik awal, kunci `getRingkasan`)

**File**: `test/indexFirestoreV5.test.js` (baru).

**Kerja** (`docs/architecture-v5.md:378-383`, `docs/prd-v5.md:961`):
- Untuk SETIAP query konkret tabel `docs/prd-v5.md:751-759`, assert ada composite index di `firestore.indexes.json` (pakai helper `adaIndexPendukung` SAMA dengan `test/indexFirestore.test.js:38-50`, bukan salin).
- Assert bentuk query di `real.ts`.
- **FIXTURE WAJIB MEMUAT PRODUK NON-ONLINE**: assert `getRingkasan().totalProdukOnline === fixture.filter(p => p.is_online_product).length` DAN `totalProdukOnline !== fixture.length` (C5).

**Bukti selesai**: file hijau; `test/indexFirestore.test.js` existing (T29) tetap hijau.
**Dependency**: W3-T3.
**Kompleksitas**: SEDANG

### [ ] W3-T10 - Perluasan `test/mockParitas.test.js`

**File**: `test/mockParitas.test.js` (ubah).

**Kerja** (`docs/prd-v5.md:976-979`): untuk setiap method baru DataSource, assert SHAPE identik mock vs real (kunci + tipe; nilai boleh beda).

**Bukti selesai**: file hijau.
**Dependency**: W3-T4, W3-T7.
**Kompleksitas**: SEDANG

### [ ] W3-T11 - Gate Wave 3 (cepat)

**Kerja**: `npm test` + `npx tsc --noEmit`; jalankan 3 e2e pengunci COUNT (`--project=desktop`); ukur `mock.ts` dan `mock-v5.ts` (target `mock.ts` < 1400 baris).

**Bukti selesai**: 0 fail semua; `mock.ts` < 1400 baris; `mock-v5.ts` ada.
**Dependency**: W3-T1..W3-T10.
**Kompleksitas**: KECIL

---

## 6. Wave 4 - Permintaan + opname (model + route)

Rujukan: `docs/architecture-v5.md:386-535, 679-686` (bagian 5, Wave 4), `docs/prd-v5.md:166-354` (F5/F6/F7).
Dependency: Wave 3 (model pakai `stokGudang.js` + `guardV5.js`).

### [ ] W4-T1 - `lib/models/permintaanGudang.js` (bagian 1: `buat`/`ubah-item`/`setujui`/`tolak`/`batal`)

**File**: `lib/models/permintaanGudang.js` (baru, CJS).

**Kerja** (`docs/architecture-v5.md:406-421`, `docs/prd-v5.md:226-239`):
- `buatPermintaan`: validasi `dari_gudang_id` aktif; `tujuan` 1..20 unik `tipe:id`, tidak resolve ke asal; `items` 1..200, tiap `kode_barang` ADA di `stock` (A2). Snapshot `{nama, jabatan, gudang_id_snapshot}` (`tipe:"user"` -> `admins[id].gudang_id ?? null`). `add()` dokumen `status:"menunggu"`, `tujuan[i].status:"menunggu"`, `tujuan_ids`, `created_at`, `created_by`, `riwayat_status`. Bukan transaksi.
- `ubahItemPermintaan`: hanya dari `menunggu`; pembuat atau admin/owner; push `riwayat_status` `ubah_item`.
- `setujuiPermintaan`: `runTransaction`; `menunggu` -> `disetujui`; TIDAK menyentuh `stock` (`docs/architecture-v5.md:417-420`).
- `tolakPermintaan`: idem -> `ditolak`.
- `batalPermintaan`: dari `menunggu` ATAU `disetujui` (R1); pembuat atau admin/owner; -> `dibatalkan`; stok TIDAK berubah.
- `_cariTujuan(tujuan, k)`.
- Semua pesan error PERSIS tabel F5.2 (`docs/prd-v5.md:193-218`).

**Bukti selesai**: `test/permintaanGudang.test.js` (W4-T9) hijau untuk jalur ini.
**Dependency**: W1-T4, W1-T5.
**Kompleksitas**: SEDANG

### [ ] W4-T2 - `lib/models/permintaanGudang.js` (bagian 2: `kirim`/`terima`/`tidak-terima`/`tutup-tujuan`/recompute)

**File**: `lib/models/permintaanGudang.js` (lanjut W4-T1).

**Kerja** (`docs/architecture-v5.md:422-497`):
- `kirimPermintaan`: transaksi; CAS dokumen; cek `disetujui`; baca N `stock`; `totalQty`; `normalisasiQtyPerGudang`; `sekarang < totalQty` -> throw `STOK_TIDAK_CUKUP` (BR1); tulis `qty_per_gudang[dari]` turun + paritas bila `"ONLINE"` (BR14); reset tiap `tujuan[i].status:"menunggu"`; `status:"dikirim"`. Setelah commit `catatPergerakanStok` per item (`action_type:"mutasi_gudang"`, arah keluar, `gudang_id:dari`).
- `terimaPermintaan(k)`: transaksi; matriks V11 (`tipe` x kondisi gudang, `docs/architecture-v5.md:451-458`); stok tujuan NAIK; `tujuan[k].status="diterima"`; `_hitungStatusDokumen`; `selesai_at` tepat sekali.
- `tidakTerimaPermintaan(k)`: stok ASAL NAIK; `action_type:"pengembalian_gudang"`; HANYA bila entri `menunggu` (V3); gudang tujuan nonaktif TIDAK menghalangi.
- `tutupTujuanPermintaan(k)` (owner-only): TIDAK menyentuh `stockRef` (V4b); `tujuan[k]="ditutup"`; `_hitungStatusDokumen`; `catatPergerakanStok` `{type:"koreksi_manual", action_type:"tutup_tujuan", gudang_id:dari_gudang_id (B1), qty = qty ASLI, catatan_alasan}`; respons `qty_hilang`.
- `_hitungStatusDokumen(tujuan)` (`docs/architecture-v5.md:529-534`): ada `menunggu` -> `dikirim`; else `selesai`.
- Perhitungan batas 500 ops/transaksi: maks 402 (`docs/architecture-v5.md:389-395`).

**Bukti selesai**: `test/permintaanGudang.test.js` tabel transisi F5.2 lengkap; recompute V2/V32.
**Dependency**: W4-T1.
**Kompleksitas**: BESAR

### [ ] W4-T3 - `lib/models/opnameGudang.js`

**File**: `lib/models/opnameGudang.js` (baru, CJS).

**Kerja** (`docs/architecture-v5.md:509-526`, `docs/prd-v5.md:324-354`):
- `buatOpname`: `qty_sistem = map[gudang_id] ?? null`; `selisih = qty_fisik - qty_sistem`; `qty_sistem === null` -> `selisih:0`, `belum_terdaftar:true`, TIDAK memicu approval (T14). Selisih 0 semua -> langsung `disetujui` + tulis qty (hanya item `belum_terdaftar:false`); ada selisih != 0 -> `menunggu_approval` + qty TIDAK berubah.
- `setujuiOpname`: `runTransaction`; owner-only; `_cocokkanQtySistem` bandingkan `item.qty_sistem` tersimpan vs nilai sekarang -> beda -> throw `STOK_BERUBAH` (409 `"Stok berubah sejak opname dibuat. Buat ulang."`) TANPA menulis (T9); else tulis `qty_per_gudang[gudang_id]` per item + `status:"disetujui"`.
- `tolakOpname`.
- `catatPergerakanStok` per item `{type:"opname", qty_sistem, qty_fisik, selisih, gudang_id}`.

**Bukti selesai**: `test/opnameGudang.test.js` (W4-T10) hijau.
**Dependency**: W1-T4, W1-T5.
**Kompleksitas**: SEDANG

### [ ] W4-T4 - `lib/dashboard/validasiPermintaanGudangV5.js` + `lib/dashboard/validasiOpnameGudangV5.js`

**File**: 2 file validator baru (CJS).

**Kerja**:
- `validasiPermintaanGudangV5.js`: `validasiAksiPermintaanGudang` (9 aksi), `validasiTujuan` (1..20, unik, tipe valid), `validasiItems` (1..200, qty integer >= 1, `kode_barang` non-kosong). Pesan PERSIS `docs/prd-v5.md:227-230`.
- `validasiOpnameGudangV5.js`: `validasiAksiOpnameGudang`, `validasiItemsOpname` (bukan 0 item, tidak duplikat `kode_barang`, `qty_fisik` integer >= 0).

**Bukti selesai**: dipakai route W4-T6/W4-T7; test route meng-import `POST()`.
**Dependency**: W2-T5 (pola).
**Kompleksitas**: SEDANG

### [ ] W4-T5 - Perluasan `test/helpers/mockFirestore.js` (semantik CAS)

**File**: `test/helpers/mockFirestore.js` (ubah).

**Kerja** (T27, `docs/prd-v5.md:970-974`):
- Tambah simulasi versi dokumen per `get`; commit hanya bila versi masih sama; transaksi kedua yang membaca versi lama -> throw (`ABORT`). Route memetakan ke 409.
- Pola existing `mockFirestore.js:128-150` meniru serialisasi transaksi; semantik versi harus ditambah supaya skenario CAS bermakna deterministik.
- TIDAK merusak test existing yang memakai helper ini (`backfillQtyStockMovements.test.js`).

**Bukti selesai**: `test/casModelFirestore.test.js` (W4-T11) hijau; `npm test` existing hijau.
**Dependency**: tidak ada (dapat paralel W4-T1..T4).
**Kompleksitas**: BESAR

### [ ] W4-T6 - `app/api/permintaan-gudang/route.ts`

**File**: `app/api/permintaan-gudang/route.ts` (baru).

**Kerja** (`docs/architecture-v5.md:216`, `docs/prd-v5.md:649-660`):
- URUTAN GUARD BARU (T18): `tolakOrigin` -> sesi cookie -> `cekRateLimit` 30/menit -> role dari `admins` -> validasi body.
- Aksi `buat`/`ubah-item`/`setujui`/`tolak`/`batal`/`kirim`/`terima`/`tidak-terima` (admin); `tutup-tujuan` owner-only (403).
- `tulisGuardV5("permintaan_gudang_guard", uid, {kunci})`; duplikat -> 409 `"duplikat"`.
- Petakan throw `STOK_TIDAK_CUKUP` -> 409, `GUDANG_TUJUAN_NONAKTIF`/`GUDANG_TUJUAN_TIDAK_ADA` -> 409, `STOK_BERUBAH` (bila ada) -> 409. Pesan PERSIS PRD.
- Log `[gudang_v5_reject]`/`[gudang_v5_success]`.

**Bukti selesai**: `test/permintaanGudang.test.js` + `test/urutanGuardV5.test.js` memanggil `POST()`; status sesuai.
**Dependency**: W4-T1, W4-T2, W4-T4, W2-T6.
**Kompleksitas**: BESAR

### [ ] W4-T7 - `app/api/opname-gudang/route.ts` + `app/api/stok/gudang/route.ts`

**File**: 2 route baru.

**Kerja**:
- `opname-gudang`: `buat`/`setujui`/`tolak`; `setujui`/`tolak` owner-only; guard `opname_gudang_guard`; rate limit 20/menit.
- `stok/gudang`: aksi `set-qty` (F2); admin; guard `stok_gudang_guard`; rate limit 30/menit; BR7 write-scope: admin `gudang_id` != target -> 403, owner bebas (`docs/architecture-v5.md:499-507`); `ambilGudang` ada & aktif else 400 `"Gudang tidak dikenal."`; `stok.setQtyGudang` null -> 404 `"Stok produk tidak ditemukan."`; audit `action_type:"set_qty_gudang"`; respons `qty_per_gudang` utuh.

**Bukti selesai**: test route memanggil `POST()`; `test/stokGudangQty.test.js` route-level + `test/opnameGudang.test.js`; `test/urutanGuardV5.test.js`.
**Dependency**: W4-T3, W4-T4, W2-T6.
**Kompleksitas**: SEDANG
### [ ] W4-T9 - `test/permintaanGudang.test.js`

**File**: `test/permintaanGudang.test.js` (baru).

**Kerja** (`docs/prd-v5.md:944`): uji tabel transisi F5.2 (semua jalur legal + ilegal 409), `kirim` turun SEKALI, `terima` per tujuan, `tidak-terima` kembali ke asal, `tutup-tujuan` owner-only tanpa ubah saldo + wajib alasan + movement qty ASLI + `gudang_id:dari_gudang_id`, `batal` dari `menunggu`/`disetujui`, stok asal tidak cukup -> 409 tanpa tulis, self-target -> 400, V10 (snapshot hilang), V11 (matriks), V2/V32 recompute, `selesai_at` sekali.

**Bukti selesai**: file hijau; mutation test: hapus guard atau buat `kirim` menambah stok tujuan -> merah (`docs/prd-v5.md:990`).
**Dependency**: W4-T1, W4-T2, W4-T6.
**Kompleksitas**: BESAR

### [ ] W4-T10 - `test/opnameGudang.test.js`

**File**: `test/opnameGudang.test.js` (baru).

**Kerja** (`docs/prd-v5.md:945`): selisih 0 -> langsung `disetujui`; selisih != 0 -> `menunggu_approval` + qty tidak berubah; item tanpa key gudang -> `belum_terdaftar:true`, selisih 0; `setujui` owner menulis qty; `setujui` dengan qty berubah -> 409 `"Stok berubah sejak opname dibuat. Buat ulang."`; `setujui` admin -> 403; `setujui` ganda -> 409; item duplikat -> 400; audit per item.

**Bukti selesai**: file hijau.
**Dependency**: W4-T3, W4-T7.
**Kompleksitas**: SEDANG

### [ ] W4-T11 - `test/casModelFirestore.test.js`

**File**: `test/casModelFirestore.test.js` (baru), pakai `test/helpers/mockFirestore.js` (W4-T5).

**Kerja** (`docs/prd-v5.md:970-974`): 3 skenario deterministik:
- (a) DUA `terima` tujuan BERBEDA, BERURUTAN: kedua entri tercatat, `riwayat_status` 2 entri, tidak ada duplikasi, status dokumen benar (AC global #30 - TIDAK boleh manual).
- (b) `terima` vs `tutup-tujuan` tujuan SAMA: tepat satu menang, kalah 409, stok konsisten.
- (c) DUA `tidak-terima` tujuan SAMA: pertama sukses sekali, kedua 409, stok asal tidak naik dua kali.

**Bukti selesai**: 3 skenario hijau.
**Dependency**: W4-T5, W4-T2.
**Kompleksitas**: BESAR

### [ ] W4-T12 - `test/urutanGuardV5.test.js`

**File**: `test/urutanGuardV5.test.js` (baru).

**Kerja** (`docs/prd-v5.md:962`, T18/E4): import dan panggil `POST()` tiap route v5 dengan sesi guest + body INVALID -> 403 (guest menang sebelum validasi body); kasus admin + rate limit terlampaui -> 429 SEBELUM role. Urutan: `tolakOrigin` -> sesi -> rate limit -> role -> validasi.

**Bukti selesai**: file hijau; tiap route v5 punya minimal satu test `POST()` (`docs/learnings.md:24`).
**Dependency**: W4-T6, W4-T7.
**Kompleksitas**: SEDANG

### [ ] W4-T13 - Gate Wave 4

**Kerja**: `npm test` + `npx tsc --noEmit`; 3 e2e pengunci COUNT; e2e relevan. Verifikasi perhitungan 402 ops < 500 di test model bila memungkinkan.

**Bukti selesai**: 0 fail semua.
**Dependency**: W4-T1..W4-T12.
**Kompleksitas**: KECIL

---

## 7. Wave 5 - Is-online + UI + e2e

Rujukan: `docs/architecture-v5.md:688-695` (Wave 5), `docs/prd-v5.md:355-372` (F8), `:981-984` (e2e).
Dependency: Wave 3, Wave 4.

### [ ] W5-T1 - `lib/models/produk.js` `setOnlineProduk`

**File**: `lib/models/produk.js` (ubah).

**Kerja** (`docs/architecture-v5.md:641, 692`): `setOnlineProduk(kodeBarang, nilai, oleh)`: cek produk ada (else null -> 404); tulis `is_online_product` + `updated_at`; panggil `invalidasiCacheProduk()` (`lib/models/produk.js:52-57`); TIDAK ada dependency baru (C4). Tambah ke `module.exports` (`lib/models/produk.js:164-173`).

**Bukti selesai**: `test/produkOnline.test.js` hijau; `test/editProduk.test.js` existing hijau.
**Dependency**: Wave 3.
**Kompleksitas**: KECIL

### [ ] W5-T2 - `app/api/produk/online/route.ts` + `test/produkOnline.test.js`

**File**: `app/api/produk/online/route.ts` (baru), `test/produkOnline.test.js` (baru).

**Kerja**: route toggle `is_online_product` (F8); admin; guard `produk_online_guard` `{kode_barang, nilai}`; rate limit 40/menit; urutan guard baru; 404 bila produk tak ada; 400 non-boolean; 403 guest. Test meng-import `POST()` + invalidasi cache + toggle.

**Bukti selesai**: `test/produkOnline.test.js` hijau; `test/urutanGuardV5.test.js` mencakup route ini.
**Dependency**: W5-T1, W2-T6.
**Kompleksitas**: SEDANG

### [ ] W5-T3 - Blok TERPISAH di `test/indexFirestoreV5.test.js`

**File**: `test/indexFirestoreV5.test.js` (tambah blok; pemilik file = Wave 3, urutan SERI - C6, `docs/architecture-v5.md:692-693`).

**Kerja**: tambah assert untuk query/route Wave 5 (bila ada index terpakai); tidak mengubah blok W3-T9.

**Bukti selesai**: file hijau.
**Dependency**: W3-T9.
**Kompleksitas**: KECIL

### [ ] W5-T4 - Page baru `app/gudang/page.tsx`

**File**: `app/gudang/page.tsx` (baru).

**Kerja** (`docs/architecture-v5.md:243-244`): pola page existing (`app/stok/page.tsx:74`); READ lewat `useData()`/DataSource, BUKAN route server. Master gudang CRUD (owner), filter stok per gudang, toggle is-online mengubah baris tabel.

**Bukti selesai**: `e2e/gudang-v5.spec.ts` (W5-T7) hijau.
**Dependency**: W3-T4, W5-T1.
**Kompleksitas**: BESAR

### [ ] W5-T5 - Page baru `app/opname-gudang/page.tsx`

**File**: `app/opname-gudang/page.tsx` (baru).

**Kerja**: halaman opname ber-approval; selisih 0 langsung `disetujui`; selisih != 0 tampil antrian approval; tombol setujui hanya owner.

**Bukti selesai**: `e2e/opname-gudang.spec.ts` (W5-T9) hijau.
**Dependency**: W3-T4, W4-T3.
**Kompleksitas**: SEDANG

### [ ] W5-T6 - Halaman permintaan antar-gudang (UI)

**File**: `app/permintaan-gudang/page.tsx` (baru).

**Kerja**: alur buat -> setujui -> kirim -> terima multi-tujuan; `tidak-terima`; `batal`; `tutup-tujuan` (tombol owner-only); daftar dokumen nyangkut (`listPermintaanGudang({status:"dikirim"})`, AC global #36).

**Bukti selesai**: `e2e/permintaan-gudang.spec.ts` (W5-T8) hijau.
**Dependency**: W4-T6.
**Kompleksitas**: BESAR

### [ ] W5-T7 - `e2e/gudang-v5.spec.ts`

**File**: `e2e/gudang-v5.spec.ts` (baru).

**Kerja** (`docs/prd-v5.md:982`): master gudang CRUD; filter stok per gudang (default admin G1 = G1, dapat diganti ke G2 karena R5); toggle is-online mengubah baris tabel.

**Bukti selesai**: spec hijau di 3 project (`playwright.config.ts`).
**Dependency**: W5-T4.
**Kompleksitas**: SEDANG

### [ ] W5-T8 - `e2e/permintaan-gudang.spec.ts` (termasuk V14)

**File**: `e2e/permintaan-gudang.spec.ts` (baru).

**Kerja** (`docs/prd-v5.md:983`): buat -> setujui -> kirim -> terima multi-tujuan; `tidak-terima` mengembalikan stok; status akhir `selesai`; angka stok asal/tujuan berubah; PLUS langkah `batal` (V14) dan `tutup-tujuan` (tombol hanya owner, stok tidak berubah).

**Bukti selesai**: spec hijau.
**Dependency**: W5-T6.
**Kompleksitas**: BESAR

### [ ] W5-T9 - `e2e/opname-gudang.spec.ts`

**File**: `e2e/opname-gudang.spec.ts` (baru).

**Kerja** (`docs/prd-v5.md:984`): selisih 0 langsung `disetujui`; selisih != 0 tampil antrian approval; tombol setujui hanya owner.

**Bukti selesai**: spec hijau.
**Dependency**: W5-T5.
**Kompleksitas**: SEDANG

### [ ] W5-T10 - Gate Wave 5

**Kerja**: `npm test` + `npx tsc --noEmit` + `npm run e2e` (0 fail); 3 e2e pengunci COUNT dijalankan lebih dulu.

**Bukti selesai**: 0 fail semua.
**Dependency**: W5-T1..W5-T9.
**Kompleksitas**: KECIL

---

## 8. Wave 6 - Rules + index + migrasi + verifikasi

Rujukan: `docs/architecture-v5.md:697-702` (Wave 6), `docs/prd-v5.md:704-907`.
Dependency: semua wave sebelumnya.

### [ ] W6-T1 - `firestore.rules`

**File**: `firestore.rules` (ubah).

**Kerja** (`docs/prd-v5.md:709-726`): tambah match `gudang` (`allow read: authed()`, write false), `permintaan_gudang`/`opname_gudang` (`staff()`, write false), 5 guard (`read, write: if false`). Pertahankan default deny dan definisi `authed()`/`staff()` existing (`firestore.rules:5-15, 38`). TIDAK memakai `get()`/`exists()`.

**Bukti selesai**: `firebase deploy --only firestore:rules` sukses; koleksi baru terbaca sesuai role (manual, dicatat PR).
**Dependency**: Wave 5.
**Kompleksitas**: SEDANG

### [ ] W6-T2 - `firestore.indexes.json` +7 index

**File**: `firestore.indexes.json` (ubah).

**Kerja** (`docs/prd-v5.md:751-863`): tambah 7 index (4 `permintaan_gudang`, 2 `opname_gudang`, 1 `admins`) dalam format JSON final. JANGAN hapus 5 index `stock_movements` existing (`firestore.indexes.json:2-110`).

**Bukti selesai**: `test/indexFirestoreV5.test.js` (7 index) hijau; `test/indexFirestore.test.js` existing hijau; `firebase firestore:indexes --project bot-admin-toko-a0c47` mencocokkan (`docs/learnings.md:35`).
**Dependency**: W3-T3 (query nyata), W3-T9.
**Kompleksitas**: KECIL

### [ ] W6-T3 - `scripts/verify-backfill.mjs` (READ-ONLY)

**File**: `scripts/verify-backfill.mjs` (baru).

**Kerja** (`docs/architecture-v5.md:595-598`, `docs/prd-v5.md:897-906`): HANYA `get` (TIDAK ada `set`/`update`/`delete`, invariant sebagai komentar header + grep saat PR); cetak jumlah `stock` dengan `qty_per_gudang.ONLINE != stok_gudang_online` dan jumlah tanpa key `ONLINE`; exit 1 bila salah satu > 0, exit 0 bila keduanya 0. TIDAK menyentuh koleksi lain.

**Bukti selesai**: `node scripts/verify-backfill.mjs` exit 0 setelah migrasi (W6-T4); grep `set|update|delete` bersih.
**Dependency**: tidak ada (dapat dikerjakan awal Wave 6).
**Kompleksitas**: KECIL

### [ ] W6-T4 - Migrasi manual: buat gudang `"ONLINE"` + backfill 33 dokumen `stock`

**File**: tidak ada file repo (skrip di luar repo runtime, `docs/prd-v5.md:879`). Prosedur aman di bagian 13 dokumen ini.

**Kerja** (`docs/prd-v5.md:881-895`):
- Langkah #1 DULU: tulis `gudang/"ONLINE"` `{nama:"ONLINE", aktif:true, urutan:0, created_at, created_by:"migrasi"}` (doc id literal).
- Langkah #2: untuk setiap `stock/{kode}`, `db.runTransaction` per dokumen, aturan pemenang tunggal: `qty_per_gudang["ONLINE"]` menang; bila absen pakai `stok_gudang_online`; bila keduanya absen -> 0; tulis keduanya seragam. Idempoten.
- Rekomendasi operasional: jalankan saat trafik bot sepi (`docs/prd-v5.md:889`).

**Bukti selesai**: `node scripts/verify-backfill.mjs` exit 0; AC global #2.
**Dependency**: W6-T3.
**Kompleksitas**: BESAR (destruktif - lihat bagian 13)

### [ ] W6-T5 - Gate Wave 6 / gate akhir

**Kerja**: jalankan gate akhir 7 langkah (bagian 10 dokumen ini).

**Bukti selesai**: 7 langkah hijau.
**Dependency**: W6-T1..W6-T4.
**Kompleksitas**: KECIL
---

## 9. Urutan eksekusi ringkas

Urutan SERI (dependency):

1. W1-T1
2. W1-T2, W1-T4 (PARALEL: keduanya bergantung W1-T1, tidak saling bergantung)
3. W1-T3, W1-T5
4. W1-T6 (gate)
5. W2-T1, W2-T3, W2-T4, W2-T5, W2-T6 (PARALEL: tidak saling bergantung)
6. W2-T2 (butuh W2-T1)
7. W2-T7 (butuh semua W2-T1..W2-T6)
8. W2-T8 (butuh W2-T1/W2-T4/W2-T6), W2-T9 (butuh W2-T2/T3/T5) - PARALEL
9. W2-T10 (gate)
10. W3-T1
11. W3-T2
12. W3-T3
13. W3-T4
14. W3-T5 (butuh W3-T2) dan W3-T6 (butuh W3-T4) - PARALEL
15. W3-T7, W3-T8, W3-T9 (PARALEL: file test berbeda)
16. W3-T10
17. W3-T11 (gate cepat + ukuran mock)
18. W4-T5 (helper CAS, PARALEL dengan W4-T1..T4), W4-T1, W4-T3, W4-T4
19. W4-T2 (butuh W4-T1)
20. W4-T6 (butuh W4-T1/T2/T4 + guard W2-T6), W4-T7 (butuh W4-T3) - PARALEL
21. W4-T9, W4-T10, W4-T11, W4-T12 (PARALEL: file test berbeda)
22. W4-T13 (gate)
23. W5-T1, W5-T3 (PARALEL)
24. W5-T2, W5-T4, W5-T5, W5-T6 (PARALEL: file berbeda; W5-T4/5/6 = UI)
25. W5-T7, W5-T8, W5-T9 (PARALEL: spec berbeda)
26. W5-T10 (gate)
27. W6-T2, W6-T3 (PARALEL)
28. W6-T1
29. W6-T4 (destruktif - bagian 13)
30. W6-T5 (gate akhir)

Daftar task yang DAPAT PARALEL:
- W1-T2 + W1-T4
- W2-T1 + W2-T3 + W2-T4 + W2-T5 + W2-T6
- W2-T8 + W2-T9
- W3-T5 + W3-T6
- W3-T7 + W3-T8 + W3-T9
- W4-T5 + W4-T1 + W4-T3 + W4-T4
- W4-T6 + W4-T7
- W4-T9 + W4-T10 + W4-T11 + W4-T12
- W5-T1 + W5-T3
- W5-T2 + W5-T4 + W5-T5 + W5-T6
- W5-T7 + W5-T8 + W5-T9
- W6-T2 + W6-T3

---

## 10. Gate akhir (urutan benar)

### 10a. Gate CEPAT (dipakai tiap task/wave - 80% waktu)

1. `npm test` - target 0 fail (~6 detik).
2. `npx tsc --noEmit` - exit 0 (bila menyentuh TS).
3. `npm run e2e:fast` - 0 fail (~155 detik). HANYA bila wave menyentuh UI.

### 10b. Gate PENUH (sekali sebelum rilis)

1. **e2e pengunci COUNT DIJALANKAN LEBIH DULU** (sebelum menambah seed v5, di gate cepat sudah dijalankan): `npx playwright test --project=desktop e2e/histori.spec.ts e2e/ringkasan.spec.ts e2e/stok.spec.ts`. Target 0 fail. Bila gagal -> seed v5 bocor ke koleksi bersama.
2. `npm test` - target 0 fail.
3. `npx tsc --noEmit` - exit 0.
4. `npm run e2e:full` - target 0 fail (~205 detik).
5. `node scripts/verify-backfill.mjs` - exit 0 (setelah migrasi manual W6-T4).
6. `firebase firestore:indexes --project bot-admin-toko-a0c47` - 7 index v5 ter-deploy.
7. `firebase deploy --only firestore:rules` - rules bagian 8 ter-deploy; koleksi baru terbaca sesuai role.

---

## 11. Checklist AC global (36 AC, `docs/prd-v5.md:1021-1060`)

| AC | Ringkas | Task pembukti |
|---|---|---|
| 1 | Master gudang CRUD; ke-51 400; duplikat 409 | W2-T1, W2-T7, W2-T8, W5-T7 |
| 2 | Semua `stock` punya `qty_per_gudang.ONLINE == stok_gudang_online`; verify exit 0 | W1-T2, W1-T3, W6-T3, W6-T4 |
| 3 | Tulis qty satu gudang tidak mengubah gudang lain | W1-T5, W4-T7, W3-T8 |
| 4 | Admin hanya TULIS gudangnya; read lintas gudang diizinkan | W4-T7, W3-T8, W4-T6 |
| 5 | Field waktu = `created_at`, tidak ada `dibuat_at` | W2-T1, W4-T1, W4-T3, W6-T1 |
| 6 | Satu dokumen banyak tujuan status per-tujuan | W4-T1, W4-T2, W4-T9, W5-T8 |
| 7 | Tabel F5.2 lengkap (legal + 409 spesifik) | W4-T1, W4-T2, W4-T9 |
| 8 | `kirim` stok asal kurang -> 409 tanpa tulis | W4-T2, W4-T9 |
| 9 | `setujui` oleh admin/owner mana pun | W4-T1, W4-T9 |
| 10 | `batal` dari `menunggu`/`disetujui` tanpa ubah stok | W4-T1, W4-T9, W5-T8 |
| 11 | Opname selisih 0 langsung; != 0 approval; CAS basi 409 | W4-T3, W4-T10, W5-T9 |
| 12 | Item opname tanpa key gudang tidak memicu approval | W4-T3, W4-T10 |
| 13 | Admin tidak setujui opname; guest 403 sebelum validasi body | W4-T3, W4-T7, W4-T12 |
| 14 | Toggle is-online bekerja; invalidasi cache; guest 403 | W5-T1, W5-T2 |
| 15 | `jabatan` tidak memengaruhi otorisasi; `jabatan:"owner"` guest 403 | W2-T2, W2-T5, W2-T7, W2-T9 |
| 16 | "Kirim ke: User" hanya user `gudang_id` terisi; guest tidak muncul | W3-T3, W5-T6 |
| 17 | Default filter gudang dari `gudang_id` user; bisa ganti; pesan admin tanpa/nonaktif gudang | W3-T3, W3-T8, W5-T7 |
| 18 | User tujuan pindah gudang: stok masuk snapshot | W4-T1, W4-T2, W4-T9 |
| 19 | `tutup-tujuan` tanpa ubah stok + alasan + movement qty ASLI + `gudang_id:dari` | W4-T2, W4-T9, W5-T8 |
| 20 | Tidak ada BOM/mojibake; snake_case; dokumen byte pertama `#` | W1-T6, W2-T10, W3-T11, W4-T13, W5-T10 (scan tiap gate) |
| 21 | Gate `npm test`/`tsc`/e2e 0 fail dengan 3 spec COUNT dulu | W1-T6, W2-T10, W3-T11, W4-T13, W5-T10, W6-T5 |
| 22 | 7 index ada + ter-deploy; tidak ada query tanpa index | W6-T2, W3-T9 |
| 23 | Rules ter-deploy; koleksi baru sesuai role; guard read/write false | W6-T1 |
| 24 | Tiap route baru punya test `POST()` | W2-T7, W4-T9, W4-T10, W4-T12, W5-T2 |
| 25 | `listStock()` 1107 produk < 500 KiB | W3-T8 (assert `JSON.stringify(rows).length < 512000`) |
| 26 | `getRingkasan()` tetap hanya produk online | W3-T9 (kunci `getRingkasan`), W3-T4 |
| 27 | Semua aksi tulis v5 masuk guard BR11 atau idempoten | W2-T6, W2-T7, W4-T6, W4-T7, W5-T2 |
| 28 | Batas `items <= 200`, `tujuan <= 20` | W4-T4, W4-T9 |
| 29 | `test/indexFirestore.test.js` existing tetap hijau | W3-T9, W6-T2, W1-T6 |
| 30 | Dua `terima` tujuan berbeda -> dua entri, tanpa duplikasi (deterministik) | W4-T5, W4-T11 |
| 31 | Tidak ada file `docs/arsip-v4/` diubah/dirujuk | semua task (pemeriksaan diff) |
| 32 | Recompute kombinasi V2 + `selesai_at` sekali | W4-T2, W4-T9 |
| 33 | V3: `tidak-terima` pada `ditutup` -> 409, stok tetap | W4-T2, W4-T9 |
| 34 | V5: `terima` vs `tutup-tujuan` -> tepat satu menang | W4-T5, W4-T11 |
| 35 | V10 snapshot hilang + V11 matriks `tipe` x kondisi gudang | W4-T2, W4-T9 |
| 36 | V8: daftar nyangkut `status:"dikirim"` + AC UI | W3-T3 (query), W3-T9 (index #1), W5-T6, W5-T8 |

---

## 12. Risiko eksekusi

1. **Perubahan destruktif pada data stok roda 4 tempat.** Setiap tulis stok harus melalui `_ubahStokRelatif` (`lib/models/stok.js:51-67`); perubahan kontrak field harus grep SEMUA konsumen (`docs/learnings.md:20`). Bila ada konsumen yang menulis `stok_gudang_online` langsung tanpa helper, paritas bocor. Mitigasi: grep `stok_gudang_online` sebelum W1-T2 selesai; fallback `normalisasiQtyPerGudang` menutup dokumen lama.
2. **Mock membengkak dan memperlambat iterasi.** `mock.ts` baseline 1165 baris. Mitigasi (revisi 2): domain v5 dipisah ke `mock-v5.ts` SEJAK W3-T4, `mock.ts` hanya delegasi tipis (< 1400 baris), dicek di W3-T11.
3. **e2e rapuh karena seed bocor.** Seed v5 ke `store.movements`/`store.stock` bersama akan merusak `toHaveCount(12)`/`toHaveCount(10)` (`e2e/histori.spec.ts:50,135`, `e2e/ringkasan.spec.ts:67`). Mitigasi: wajib store terpisah (W3-T6); jalankan 3 spec COUNT lebih dulu tiap wave.
4. **Migrasi mengubah data produksi.** Backfill 33 dokumen `stock` menulis `qty_per_gudang` + `stok_gudang_online`; aturan pemenang salah bisa menggeser angka stok nyata (R14). Mitigasi: bagian 13.
5. **Composite index tidak terlihat gate** (`docs/learnings.md:35`). Query produksi bisa gagal padahal semua test hijau karena mock tidak menyentuh Firestore. Mitigasi: `test/indexFirestoreV5.test.js` (W3-T9, W6-T2) + verifikasi deploy nyata.
6. **Test route "mirror" tidak membuktikan handler** (`docs/learnings.md:24`). Mitigasi: minimal satu test `POST()` per route baru (W4-T12, W4-T9, W4-T10, W2-T7, W5-T2).
7. **Urutan guard baru beda dari route existing** (T18). Route existing memvalidasi body dulu (`app/api/stok/mutasi/route.ts:67-103`); route v5 harus role dulu. Salah urutan = pesan validasi bocor ke guest. Mitigasi: `test/urutanGuardV5.test.js` (W4-T12) mengunci urutan + kasus 429 sebelum role.
8. **Semantik CAS mock tidak setara Firestore nyata** (T27). Bila `mockFirestore.js` tidak mensimulasikan versi dokumen, skenario race lolos palsu. Mitigasi: W4-T5 wajib menambah versi dokumen; 3 skenario W4-T11 deterministik; verifikasi staging dicatat PR.
9. **Batas 500 operasi per transaksi** bisa terlampaui bila batas item dinaikkan (AR2). Mitigasi: BR16 `items<=200` + `tujuan<=20`; perhitungan 402 < 500 didokumentasikan (`docs/architecture-v5.md:389-395`).
10. **Perubahan `getRingkasan` mengubah arti `totalProdukOnline`** (B2). Bila `rowsStok` membaca semua produk tanpa filter online, angka berubah dan `e2e/ringkasan.spec.ts` merah. Mitigasi: `getRingkasan` memanggil `rowsStok({is_online:true})` (W3-T3) + assert C5 di W3-T9.
11. **BOM/mojibake dari tooling agent** (`docs/learnings.md:27`). Mitigasi: scan `git status` tiap gate; byte 0xEF 0xBB 0xBF = BOM.
12. **Laporan reviewer/tester tertinggal dari working tree** (`docs/learnings.md:26,28`). Mitigasi: verifier mengeksekusi gate sendiri, bukan percaya angka laporan.

---


### Skrip migrasi (pakai Firebase CLI, TIDAK butuh ADC/gcloud)

Semua skrip di bawah memakai token dari Firebase CLI (`~/.config/configstore/firebase-tools.json`)
lewat helper `scripts/lib/firebaseCli.mjs`. Tidak butuh firebase-admin, ADC, atau gcloud.
Bila token kedaluwarsa: `npx firebase login:ci`.

| Skrip | Fungsi | Sifat |
|---|---|---|
| `scripts/backup-stock-v5.mjs` | ekspor koleksi `stock` ke JSON di tmp | read-only |
| `scripts/verify-backfill.mjs` | cek paritas `qty_per_gudang.ONLINE` vs `stok_gudang_online` | read-only, exit 1 bila ada selisih |
| `scripts/ensure-gudang-online-v5.mjs` | buat gudang `ONLINE` bila belum ada | idempoten |
| `scripts/migrate-backfill-v5.mjs` | migrasi aturan pemenang T8, transaksi per dokumen | DRY RUN default; butuh `--apply` |

Urutan eksekusi:
```
node scripts/backup-stock-v5.mjs
node scripts/verify-backfill.mjs
node scripts/ensure-gudang-online-v5.mjs
node scripts/migrate-backfill-v5.mjs          # dry run dulu
node scripts/migrate-backfill-v5.mjs --apply  # baru tulis
node scripts/verify-backfill.mjs              # harus exit 0
```

Status 2026-09-17: migrasi SUDAH dijalankan (33/33 dokumen, 0 selisih, nilai stok utuh).
Skrip tetap berguna untuk verifikasi ulang dan lingkungan lain.

## 13. Urutan aman untuk perubahan destruktif (migrasi backfill)

Backfill W6-T4 menyentuh data produksi (33 dokumen `stock`). Ikuti urutan ini:

1. **Backup dulu.** Ekspor koleksi `stock` (dan `gudang` bila ada) sebelum perubahan, mis. `gcloud firestore export` atau ekspor konsol. Simpan timestamp + jumlah dokumen (harus 33).
2. **Verifikasi sebelum.** Jalankan `node scripts/verify-backfill.mjs` (W6-T3) SEBELUM migrasi. Catat baseline: jumlah dokumen dengan selisih `!= 0` dan jumlah tanpa key `ONLINE` (justru inilah yang akan diperbaiki). Script READ-ONLY, aman dijalankan kapan pun.
3. **Jalankan saat trafik bot sepi** (`docs/prd-v5.md:889`). Tujuannya menutup race `_ubahStokRelatif` (`lib/models/stok.js:51-67`) yang menulis `stok_gudang_online` tanpa `qty_per_gudang`; transaksi per dokumen mengunci dokumen, tetapi trafik sepi mengurangi retry.
4. **Urutan wajib**: langkah #1 (buat `gudang/"ONLINE"`) SEBELUM langkah #2 (backfill `stock`), supaya key `ONLINE` punya dokumen gudang dan filter tidak memunculkan id yatim (`docs/prd-v5.md:894`).
5. **Jalankan per dokumen dalam satu transaksi** (`db.runTransaction`), aturan pemenang tunggal: `qty_per_gudang["ONLINE"]` menang; absen -> pakai `stok_gudang_online`; absen keduanya -> 0; tulis keduanya seragam (`docs/prd-v5.md:882-888`).
6. **Idempoten**: jalankan ulang aman. Setelah run 1 kedua nilai sama; run 2 memilih nilai itu lagi.
7. **Verifikasi sesudah.** Jalankan `node scripts/verify-backfill.mjs` lagi; target exit 0 (selisih 0, semua dokumen punya key `ONLINE`). Cek jumlah dokumen tetap 33. Bila > 0 -> JANGAN lanjut; restore dari backup dan investigasi.
8. **Rollback**: hapus key `qty_per_gudang` saja; `stok_gudang_online` TIDAK pernah dihapus sehingga nilai asli tetap utuh (`docs/prd-v5.md:895`).
9. **Catat di PR**: perintah verifikasi + output sebelum/sesudah, waktu eksekusi, jumlah dokumen.

Migrasi manual lain (bagian 10 PRD): #3 `products` (tidak ada aksi), #4 `admins` (tidak ada aksi wajib; `jabatan`/`gudang_id` absen = null), #5 `stock_movements` (tidak ada backfill).

Deploy `firestore.rules` (W6-T1) dan index (W6-T2) dilakukan BERSAMAAN rilis, bukan setelahnya (`docs/prd-v5.md:1002`).

---

## 14. Rekap task per wave

| Wave | Jumlah task | Rentang ID |
|---|---|---|
| Wave 0 | 1 | W0-T1 (konfigurasi e2e) |
| Wave 1 | 6 | W1-T1..W1-T6 |
| Wave 2 | 10 | W2-T1..W2-T10 |
| Wave 3 | 11 | W3-T1..W3-T11 |
| Wave 4 | 12 | W4-T1..W4-T7, W4-T9..W4-T13 (W4-T8 tidak dibuat; digabung ke W4-T11 + W4-T13) |
| Wave 5 | 10 | W5-T1..W5-T10 |
| Wave 6 | 5 | W6-T1..W6-T5 |
| TOTAL | 55 | - |

Catatan: penomoran task monoton; lompatan W4-T8..W4-T9 disengaja (nomor T8 dihindari agar T9 = test permintaan tetap sesuai urutan logis). Wave 0 (W0-T1) ditambahkan di revisi 2 untuk merampingkan konfigurasi e2e. Jumlah task total = 55.

---

## 15. Perubahan Revisi 2 (Test Ringan, Cepat, Akurat)

Revisi ini menjawab permintaan user: proyek dikejar deadline, test tidak boleh berat/lama, fokus logika fungsi, mock jangan membengkak.

| # | Perubahan | Alasan |
|---|---|---|
| 1 | **Bagian 2 ditulis ulang**: gate CEPAT vs gate PENUH dipisah | E2e penuh (~205s) tidak perlu tiap iterasi; unit (~6s) cukup jadi gate utama |
| 2 | **Bagian 2b baru**: strategi test (piramida, tabel layak-e2e-vs-unit, anti-redundansi, target angka) | Aturan jelas kapan sesuatu jadi unit vs e2e |
| 3 | **W0-T1 baru**: ringankan `playwright.config.ts` + `package.json` | Buang 3-project blanket (450 eksekusi -> ~190); script `e2e:fast`/`e2e:full` |
| 4 | **Tabel target angka test** ditambahkan untuk semua file test | Mencegah test membengkak (mis. `permintaanGudang` 18-22, bukan 40+) |
| 5 | **E2e baru dibatasi <= 20 test** (`gudang-v5` 6, `permintaan-gudang` 8, `opname-gudang` 5) | Plan lama membayangkan jauh lebih banyak; UI hanya butuh bukti render + alur utama |
| 6 | **Mock dipisah sejak Wave 3** ke `lib/dashboard/data/mock-v5.ts` | `mock.ts` sudah 1165 baris; menambah 20 method + aturan v5 akan membengkak dan melambatkan |
| 7 | Gate per wave: `npm run e2e` -> `npm run e2e:fast` | E2e penuh hanya di gate akhir |
| 8 | Aturan test `POST()` dibatasi: hanya route BARU | Test mirror untuk route lama yang tidak diubah = buang waktu |
| 9 | E2e pengunci COUNT dijalankan dengan `--project=desktop` | Menghemat waktu; perilaku sama |

### Prinsip yang berlaku mulai revisi ini

1. **Unit test adalah gate utama.** ~6 detik, dan hampir semua test repo ini sudah murni logika (tidak menyentuh Firestore/network). Pertahankan sifat itu.
2. **E2e hanya untuk yang tidak bisa diuji unit.** Render, navigasi, interaksi. Bukan logika.
3. **Jangan test hal yang sama dua kali.** Kalau unit sudah membuktikan logika, e2e tidak mengulang.
4. **Mock dipisah.** Tambahan domain v5 ke `mock-v5.ts`; `mock.ts` hanya delegasi tipis (< 1400 baris).
5. **Deterministik dan murah.** CAS pakai model test, bukan Firestore nyata.