# Rencana Implementasi Teknis - Dashboard v2

> Turunan dari `docs/dashboard-prd-v2.md` (kontrak, sudah lolos review) dan
> `docs/dashboard-prd-v2-review.md` (temuan yang ditutup).
> Dokumen ini = URUTAN KERJA + GATE + PEMBAGIAN AGENT. Bukan pengganti spec.

---

## 0. Fakta terverifikasi (koreksi klaim sumber)

| Klaim sumber | Aktual di repo | Verdict |
|---|---|---|
| "10 function, sisa 2" (brief awal) | 3 route + `api/webhook.js` = **4**; +5 = **9**. Sisa margin **3** | SALAH |
| `docs/dashboard-deploy.md:9` "Total function bersama webhook: 5" | Aktual **4** | SALAH |
| `AlertDialog` dipakai spec Q5 | **TIDAK ADA** di `components/ui/` (hanya `dialog.tsx`) | temuan baru |
| mock cukup "tambah 5 fungsi" | store `mock.ts` belum punya `admins`/`produk` mutable | temuan baru |
| `setReorderPoint` aman pakai `merge` | `set(...,{merge:true})` MEMBUAT dokumen bila belum ada -> langgar E13 spec | temuan baru |
| nuansa ambang reorder | `stok.js:138` pakai `<`, `cekReorderPoint.js:30` pakai `>`. Stok == reorder: notif KIRIM, listing TIDAK tampil | temuan baru |
| B1 `admin.id` | terkonfirmasi `cekReorderPoint.js:47`, `reminderHarian.js:62` | BENAR |
| `dataKosong` cast baris 215 | terkonfirmasi `sumber-data.tsx:215` | BENAR |
| `isSuperAdminDariEnv` tak diekspor | terkonfirmasi `admins.js:115-127` | BENAR |
| Opsi D blast radius 1 caller | terkonfirmasi (`handleSetRole.js:20`): nol test existing | BENAR |
| `hapusAdmin` tanpa guard | terkonfirmasi `admins.js:111` | BENAR |
| `tambahAdmin` `set()` tanpa merge | terkonfirmasi `admins.js:56` | BENAR |
| `revokeAccessRequest` dipanggil bot saat revoke | terkonfirmasi `handleRevokeAdmin.js:78` | BENAR |

Budget function Vercel (Hobby, batas 12):

```
sekarang : /api/auth/telegram, /api/pengaturan/ai, /api/stok/mutasi, api/webhook.js  = 4
sesudah  : + /api/produk/hpp, /api/stok/reorder-point, /api/admin/role,
             /api/admin/tambah, /api/admin/hapus                                    = 9
margin   : 3
```

---

## 1. Gelombang implementasi

### Wave 1 - Fondasi server (TIDAK paralel dengan UI)

Isi: fix B1 + `setReorderPoint` + `catatPerubahanProduk` + Opsi D audit + ekspor
`isSuperAdminDariEnv` + seluruh test model.

| File | Aksi |
|---|---|
| `lib/reminder/cekReorderPoint.js` | baris 47 -> `admin.telegram_user_id`; bersihkan komentar usang baris 44-46 |
| `lib/reminder/reminderHarian.js` | baris 62 idem |
| `lib/models/productChanges.js` | **baru**: `catatPerubahanProduk` |
| `lib/models/stok.js` | **tambah** `setReorderPoint` + ekspor |
| `lib/models/admins.js` | Opsi D (`{ catatAudit = true }`) + ekspor `isSuperAdminDariEnv` |
| `lib/handlers/handleSetRole.js` | **hapus** panggilan audit manual baris 26-32 |
| `test/reorderPoint.test.js` | **baru** (termasuk test B1 yang gagal sebelum fix) |
| `test/auditRole.test.js` | **baru** |
| `test/reminderHarian.test.js` | diperluas (B1) |

Dependency: tidak ada.
Paralel: TIDAK dengan UI (kontrak belum stabil). Internal bisa dikerjakan berurutan oleh 1 agent.
Gate: `npm test` hijau; test B1 + auditRole **GAGAL sebelum fix, HIJAU sesudah** (bukti output).

### Wave 2 - Route server

| File | Aksi |
|---|---|
| `app/api/produk/hpp/route.ts` | baru |
| `app/api/stok/reorder-point/route.ts` | baru |
| `app/api/admin/role/route.ts` | baru |
| `app/api/admin/tambah/route.ts` | baru |
| `app/api/admin/hapus/route.ts` | baru |
| `app/api/auth/telegram/route.ts` | tambah `superAdmin` |
| `test/editProduk.test.js` | baru |
| `test/adminRole.test.js` | baru |
| `test/adminKelola.test.js` | baru |
| `test/superAdmin.test.js` | baru |

Dependency: Wave 1.
Paralel: BISA dengan Wave 3 - syarat `lib/dashboard/data/index.ts` + `types.ts` sudah beku (Wave 3a).
Gate: `npm test` hijau; `npx tsc --noEmit` exit 0.

### Wave 3 - Kontrak data + UI

| Sub | File |
|---|---|
| 3a beku | `lib/dashboard/data/index.ts`, `lib/dashboard/types.ts` |
| 3b data | `lib/dashboard/data/mock.ts`, `lib/dashboard/data/mock-data.ts`, `lib/dashboard/data/real.ts`, `lib/dashboard/sumber-data.tsx` |
| 3c UI | `components/dashboard/dialog-edit-hpp.tsx`, `dialog-edit-reorder.tsx`, `aksi-role-admin.tsx`, `kelola-admin.tsx`, `dialog-tambah-admin.tsx`, `konfirmasi-hapus-admin.tsx`, `components/ui/alert-dialog.tsx` (semua baru); `app/produk/[kode]/page.tsx`, `app/admin/page.tsx`, `app/pengaturan/page.tsx` |
| 3d e2e | `e2e/*.spec.ts` baru |

Dependency: 3a tidak ada; 3b & 3c setelah 3a; 3d setelah 3c.
Paralel: 3b || 3c setelah 3a. 3c || Wave 2 (kontrak route beku di PRD).
Gate: `npx tsc --noEmit` exit 0; `npm run e2e` hijau; cek key `dataKosong` lengkap.

### Wave 4 - Rules + deploy + integrasi

| File | Aksi |
|---|---|
| `firestore.rules` | `match /product_changes/{id} { allow read: if staff(); allow write: if false; }` |
| `docs/dashboard-deploy.md` | koreksi budget function (4 -> 9), tandai `SUPER_ADMIN_ID` wajib, smoke v2 |
| e2e 401 mid-write | spec baru |
| smoke manual Mini App | checklist |

Dependency: Wave 2 + 3.
Gate akhir: lihat §4.

---

## 2. Kontrak per file (ringkas)

**`lib/models/productChanges.js` (baru)**

```
catatPerubahanProduk({ kodeBarang, field, nilaiLama, nilaiBaru, changedBy })
  -> { id, kode_barang, field, nilai_lama, nilai_baru, changed_by, created_at }
```

`db.collection("product_changes").add(...)`, `created_at: new Date()`.
Satu baris per field yang berubah.

**`lib/models/stok.js`**

```
setReorderPoint(kodeBarang, nilai, oleh) -> { stok, notifikasi } | null
```

WAJIB:
1. `ambilStok` lebih dulu. Null bila dokumen tidak ada -> route 404. JANGAN menciptakan dokumen via merge (langgar E13 spec).
2. `set({ reorder_point, last_updated, last_updated_by }, { merge: true })`.
3. `invalidasiCacheStok()` setelah tulis.
4. `cekDanNotifikasiReorderPoint` dalam try/catch, kembalikan boolean `notifikasi`.
5. Tambah ke `module.exports` (baris 148-158).

**`lib/models/admins.js`**

```
updateRoleAdmin(telegramUserId, roleBaru, diubahOleh, { catatAudit = true } = {})
```

Setelah `update()` sukses -> `catatPerubahanRole({ targetUserId, targetName: admin.name, roleLama, roleBaru, changedBy: diubahOleh })` bila `catatAudit` true.
Return `{ adminLama, adminBaru }` TETAP (bot butuh `adminLama.name`).
Ekspor `isSuperAdminDariEnv` (baris 115-127).

**`lib/handlers/handleSetRole.js`** - hapus baris 26-32 (audit manual). Bot panggil tanpa opsi -> default true.

**5 route** - ikuti persis pola `app/api/stok/mutasi/route.ts`:
`tolakOrigin` -> cookie -> `verifikasiTokenSesi` -> `cekRateLimit` -> parse body -> validasi -> `ambilAdmin(sesi.uid)` -> model -> `console.info`.
`runtime="nodejs"`, `dynamic="force-dynamic"`.

Rate limit per menit: `hpp:{uid}` 20, `reorder:{uid}` 20, `adminrole:{uid}` 10,
`admintambah:{uid}` 10, `adminhapus:{uid}` 10.

Detail kritis:
- F1: bedakan "tidak dikirim" vs `null` -> `Object.prototype.hasOwnProperty.call(body, "hpp")`. Minimal satu dari `hpp`/`hpp_baru` ada. Nilai wajib `Number.isInteger`; string `"90000"` ditolak 400.
- F2: `reorder_point` wajib ada sebagai key (`undefined` -> 400); `null` sah. Nilai sama dengan lama -> 200 tanpa audit & tanpa notif.
- F3: error guard model -> **400**. Audit gagal setelah role sukses -> 200 + `peringatan_audit`, log `[audit_write_failed]`, TANPA rollback.
- F4a: `ambilAdmin(id)` dulu -> 409 bila sudah ada (`tambahAdmin` pakai `set()` tanpa merge).
- F4b: urutan `hapusAdmin` -> `revokeAccessRequest` -> `catatPerubahanRole({ roleBaru: "dihapus" })`. Hapus gagal -> 0 audit.
- Auth: `superAdmin = isSuperAdminDariEnv(String(hasil.user.id)) || role === "owner"`.

**`lib/dashboard/data/index.ts`** - 5 method tulis ke `DataSource`:
`ubahHpp`, `ubahReorderPoint`, `ubahRoleAdmin`, `tambahAdmin`, `hapusAdmin`.

**`lib/dashboard/types.ts`** - `ProductChangeDoc`, `SessionInfo.superAdmin: boolean`.

**`lib/dashboard/data/mock.ts`** - 5 method + guard tiruan SAMA PERSIS server
(owner-only HPP/role/tambah/hapus; owner+admin reorder; 409 duplikat; tolak diri sendiri &
owner terakhir). Perlu store mutable baru: `admins`, `produk`, `roleChanges`.

**`lib/dashboard/data/real.ts`** - 5 `fetch` + `superAdmin` di sesi real.

**`lib/dashboard/sumber-data.tsx`** - 5 method ke `dataKosong()` manual; HAPUS cast
`as unknown as DataSource` (baris 215) agar `tsc` menagih method yang hilang.

**`components/ui/alert-dialog.tsx`** - BARU (tidak ada di repo). Basis `@base-ui/react` seperti `dialog.tsx`.

**3 halaman** - `[kode]` tambah 2 tombol (HPP owner, reorder owner+admin);
`/admin` kolom aksi untuk owner; `/pengaturan` seksi Kelola Admin + status superAdmin.

**`firestore.rules`** - tambah `product_changes` (staff read, write false).

---

## 3. Urutan test (TDD)

| Kapan | Test | Rujukan spec |
|---|---|---|
| SEBELUM fix B1 | `test/reorderPoint.test.js` #9: assert `kirimPesan` dipanggil dengan `"111"`/`"222"` (bukan `undefined`) | §3.7 #9 |
| SEBELUM fix Opsi D | `test/auditRole.test.js`: (a) `updateRoleAdmin` -> 1 baris; (b) `handleSetRole` -> 1 baris (bukan 2); (c) guard gagal -> 0 baris | B2, A10 |
| Wave 1 selesai | model: `setReorderPoint` (doc ada, invalidasi cache, null bila tak ada, notif, no-op, `catatAudit:false`) | §3.7 #1-9, §8.2 |
| Wave 2 | `editProduk` (9 kasus), `adminRole` (8), `adminKelola` (10), `superAdmin` | §2.7, §4.7, §5.7, §6.5 |
| Wave 3 | paritas mock-vs-server; key `dataKosong`; Playwright matriks izin + dialog + 401 | §11, §12, v1 §11.2 |
| Wave 4 | e2e 401 mid-write (form dipertahankan, dialog tidak tutup) | v1 §11.2 |

Bukti TDD wajib: simpan output MERAH sebelum fix, HIJAU sesudah.

**Catatan ambang reorder:** `cariStokDiBawahReorderPoint` (`stok.js:138`) pakai `<`;
`cekDanNotifikasiReorderPoint` (`cekReorderPoint.js:30`) pakai `>` (artinya kirim saat `<=`).
Stok == reorder -> notif KIRIM, listing TIDAK tampil. Test harus assert sesuai masing-masing.
v2 TIDAK mengubah semantik ini.

---

## 4. Gate

| Wave | Perintah | Bukti |
|---|---|---|
| 1 | `npm test` | hijau; output merah->hijau B1 & auditRole |
| 2 | `npm test` + `npx tsc --noEmit` | hijau / exit 0 |
| 3 | `npx tsc --noEmit` + `npm run e2e` | exit 0; Playwright mock hijau; key `dataKosong` lengkap |
| 4 | semua + `vercel build` | jumlah function <= 12 (target 9), bukti log |

**Gate akhir (DoD):**
- `npm test` hijau (6 test baru + `auditRole` + `reminderHarian` diperluas).
- `npx tsc --noEmit` exit 0.
- `npm run e2e` hijau (mock).
- `vercel build` -> 9 function (<= 12).
- `isSuperAdminDariEnv` diekspor; `getSession()` (mock & real) `superAdmin: boolean`.
- `product_changes` 1 baris per field; `admin_role_changes` tepat 1 baris (Opsi D, tidak dobel).
- Rules siap deploy: guest `permission-denied`, tulis client ditolak.

---

## 5. Risiko (5 terbesar)

1. **Budget function Vercel** - total 9 (bukan 10/5). Mitigasi: hitung di `vercel build`; koreksi `dashboard-deploy.md:9`.
2. **`dataKosong` runtime gap** - cast `as unknown as DataSource` mematikan compiler. Mitigasi: hapus cast + assert key; gate bukan hanya "typecheck bersih".
3. **Regresi bot Opsi D** - double-audit bila baris 26-32 bot tidak dihapus; NOL test bot existing. Mitigasi: `test/auditRole.test.js` sebelum fix, hapus di commit yang sama, smoke `/set_role`.
4. **Race owner-terakhir (TOCTOU)** - `updateRoleAdmin`/`hapusAdmin` non-transaksional. Mitigasi: rate limit 10/menit + audit + `SUPER_ADMIN_ID` wajib diset di produksi.
5. **Mock vs real divergence** - store `mock.ts` belum mutable -> hijau palsu. Mitigasi: store `admins`/`produk` baru + test paritas guard.

Risiko tambahan: `AlertDialog` tidak ada -> tambah `components/ui/alert-dialog.tsx` sebelum UI.

---

## 6. Pembagian agent

**`build` (server/model/test) - Wave 1, 2, 4 rules:**
`lib/reminder/*`, `lib/models/*`, `lib/handlers/handleSetRole.js`, `app/api/**`,
`firestore.rules`, `test/*.test.js`, `lib/dashboard/data/index.ts` + `types.ts` (3a).

**`frontend-ui` (halaman/komponen/render) - Wave 3c/3d:**
`components/dashboard/*`, `components/ui/alert-dialog.tsx`,
`app/produk|admin|pengaturan`, `e2e/*`.

**Titik konflik:** `lib/dashboard/data/index.ts` + `types.ts` (3a), dan
`data/{mock,real}.ts` + `sumber-data.tsx` (3b).
Aturan: `build` menuntaskan 3a + 3b lebih dulu; `frontend-ui` hanya mengonsumsi.
`frontend-ui` TIDAK mengubah file di `lib/`.

---

## 7. Putaran implementasi (rekomendasi)

| Putaran | Isi | Gate |
|---|---|---|
| 1 | Wave 1 | `npm test` hijau + bukti TDD merah->hijau |
| 2 | Wave 2 + Wave 3a/3b | `npm test` + `tsc` exit 0 |
| 3 | Wave 3c/3d + Wave 4 | `tsc` + `e2e` + `vercel build` |

Putaran 1 murni server - tanpa itu route & UI tidak punya kontrak stabil.
Putaran 1 menyentuh BUG PRODUKSI (B1) + kode bot produksi (Opsi D) -> wajib review manual
sebelum produksi.