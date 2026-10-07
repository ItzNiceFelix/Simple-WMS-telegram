# Impact Map v4 — Multi-Gudang, RBAC Berlapis, Integrasi Kledo

> Dibuat dengan pemindaian langsung (`lib/`, `app/`, `components/`, `api/`, `test/`, `e2e/`, `scripts/`).
> Explorer agent pertama GAGAL menulis file ini dan mengembalikan klaim yang salah (lihat §11).
> Angka di bawah diverifikasi ulang oleh orchestrator.

## 0. Fakta dasar (terverifikasi)

| Item | Nilai | Cara verifikasi |
|---|---|---|
| Route API | **10** `app/api/**/route.ts` + 1 `api/webhook.js` = **11 function** | `Get-ChildItem app/api -Recurse -Filter route.ts` |
| Batas 12 | **Kebijakan internal**, bukan batas Vercel | `docs/dashboard-deploy.md` §0 |
| `stok_gudang_online` | **26 file**, 56 baris | scan regex |
| `is_online_product` | **18 file**, 42 baris | scan regex |
| `gudang_id` / `warehouse` / `kledo` di kode | **0 kemunculan** | scan regex |
| Koleksi Firestore | 15+ (lihat §4) | `collection("` scan |
| Index komposit ter-deploy | 5 di `stock_movements` | `firestore.indexes.json` |

---

## 1. `stok_gudang_online` — 26 file

### 1A. Penulis (WRITER) — yang WAJIB diubah
| File | Baris | Peran |
|---|---|---|
| `lib/models/stok.js` | 26, 60, 89 | `buatStokAwal`, `kurangiStok`/`tambahStok`, `timpaStokOpname` menulis field ini |
| `lib/dashboard/data/mock.ts` | 929, 990, 999-1005 | Mock writer (harus paritas dengan real) |

### 1B. Pembaca (READER) — perlu tahu gudang mana
| File | Baris | Peran |
|---|---|---|
| `lib/models/stok.js` | 7, 55, 137-138 | Baca + banding reorder point |
| `lib/dashboard/data/real.ts` | 174, 180, 282 | Map Firestore → `StockRow` |
| `lib/dashboard/data/mock.ts` | 328, 334, 459, 1101 | Map mock → `StockRow` |
| `lib/dashboard/data/index.ts` | 62 | Interface `StockDoc` |
| `lib/dashboard/types.ts` | 32, 64 | `StockDoc` + `StockRow` |
| `lib/sheets/syncStokDuaArah.js` | 73, 154, 485-486, 534 | Sync ke Sheets |
| `lib/reminder/reminderHarian.js` | 39, 44 | Hitung hari habis |
| `lib/reminder/cekReorderPoint.js` | 30, 41 | Cek reorder |
| `lib/handlers/handleOpname.js` | 130 | Qty sistem saat opname |
| `lib/gemini/tools.js` | 292 | Snapshot untuk Gemini |
| `lib/gemini/chatHandler.js` | 412 | Tampilkan ke user |
| `app/api/stok/mutasi/route.ts` | 114-160 | Mutasi stok |
| `app/api/admin/route.ts` | 269 | Tambah produk |
| `app/page.tsx` | 63, 189 | Ringkasan (stok minus) |
| `app/stok/page.tsx` | 101, 243, 267, 311, 334 | Tabel stok |
| `app/permintaan/page.tsx` | 74 | Map untuk permintaan |
| `app/produk/[kode]/page.tsx` | 136 | Detail produk |

### 1C. Seed / test — akan rusak
| File | Baris |
|---|---|
| `lib/dashboard/data/mock-data.ts` | 4, 143-150 (8 baris `MOCK_STOCK`) |
| `test/adminRouteV3b.test.js` | 137, 143, 282, 292, 299, 332 |
| `test/draftKonfirmasiV3b.test.js` | 226-381 (banyak) |
| `test/gapV3b.test.js` | 154, 205, 215 |
| `test/konfirmasiBotV3b.test.js` | 114-413 |
| `test/mutasiStok.test.js` | 31, 62, 75, 87 |
| `test/paritasA2Data.test.js` | 96-175 |
| `test/reminderHarian.test.js` | 84 |
| `test/reorderPoint.test.js` | 48 |

---

## 2. `is_online_product` — 18 file

| Kelompok | File (baris) |
|---|---|
| **Penulis** | `lib/models/produk.js` (101-105 `tandaiSebagaiProdukOnline`) |
| **Query** | `lib/models/produk.js` (149 `where("is_online_product","==",true)`) — cache terpisah |
| **Pembaca** | `lib/dashboard/data/real.ts` (145, 155, 274), `lib/dashboard/types.ts` (53, 477), `lib/gemini/chatHandler.js` (397-1078), `lib/gemini/promptSystem.js` (79), `lib/gemini/tools.js` (77), `lib/matching/cariProdukByNama.js` (36), `lib/matching/cariProdukPintar.js` (9), `lib/sheets/syncMasterData.js` (72-106), `lib/handlers/handleOpname.js` (100, 172) |
| **Route** | `app/api/admin/route.ts` (265, 331) — tambah produk + konfirmasi draft |
| **Seed/test** | `lib/dashboard/data/mock-data.ts` (54-131, 8 produk), `lib/dashboard/data/mock.ts` (326-971), `test/adminRouteV3b.test.js` (278-304), `test/konfirmasiBotV3b.test.js` (411), `test/mutasiStok.test.js` (37), `test/reminderHarian.test.js` (81), `test/reorderPoint.test.js` (54) |

**Catatan penting:** `is_online_product` saat ini **field di `products`** (global, bukan per gudang). Kalau "online" harus per gudang, ini perubahan skema produk.

---

## 3. Role — gerbang keamanan

### 3A. Server-side gate (FIRESTORE RULES)
| File | Baris | Isi |
|---|---|---|
| `firestore.rules` | 5-10 | Cek role dari token: `owner|admin|guest` |
| `firestore.rules` | 12-15 | `staff()` = owner ATAU admin (exclude guest) |

### 3B. Server-side gate (ROUTE)
| File | Baris | Level |
|---|---|---|
| `app/api/produk/hpp/route.ts` | 59-77 | **owner only** |
| `app/api/admin/tambah/route.ts` | 65-80 | **owner only** |
| `app/api/admin/hapus/route.ts` | 65-96 | **owner only** |
| `app/api/admin/role/route.ts` | 77-98 | **owner only** |
| `app/api/pengaturan/ai/route.ts` | 51-66 | **owner only** |
| `app/api/admin/route.ts` | 82-93 | staff (owner/admin) |
| `app/api/permintaan/route.ts` | 79-95 | staff |
| `app/api/stok/mutasi/route.ts` | 88-103 | staff |
| `app/api/stok/reorder-point/route.ts` | 65-73 | staff |
| `app/api/auth/telegram/route.ts` | 97-98 | Buat sesi + custom claims |

### 3C. Client-side (UI) gate
| File | Baris |
|---|---|
| `app/stok/page.tsx` | 60 |
| `app/draft/page.tsx` | 80, 118 |
| `app/produk/[kode]/page.tsx` | 48-49 |
| `app/pengaturan/page.tsx` | 48-49 |
| `app/kata-kunci/page.tsx` | 71 |
| `lib/models/admins.js` | 33 |
| `lib/dashboard/validasiTulisV2.js` | 101, 125 |
| `lib/dashboard/types.ts` | 247 |
| `lib/dashboard/draftOwner.js` | 40-41 |

**Pelajaran dari `docs/research-wms.md` §B:** bahaya RBAC multi-lokasi = filter scope diterapkan di UI/memori, bukan di server. Ada preseden nyata di proyek ini (`dashboard-prd-v3b.md:452`). Setiap gate scope gudang WAJIB di server.

---

## 4. Koleksi Firestore

| Koleksi | File akses | Query khusus |
|---|---|---|
| `stock` | `app/api/admin/route.ts`, `lib/models/stok.js` | `ambilStok` by doc id |
| `products` | `app/api/admin/route.ts`, `lib/models/produk.js` | `where(is_online_product==true)` |
| `stock_movements` | `lib/dashboard/aksiDraft.js`, `lib/handlers/konfirmasiPickingList.js`, `lib/reminder/reminderHarian.js`, `lib/models/stockMovements.js` | where+orderBy (5 index) |
| `sessions` | 5 file handler/router | doc id |
| `admins` | `lib/models/admins.js` | `where(role==)` |
| `admin_role_changes` | `lib/models/adminRoleChanges.js` | - |
| `product_changes` | `lib/models/productChanges.js` | - |
| `opname_drafts` | `lib/handlers/handleOpname.js` | status+created_at |
| `sync_stok_drafts` | `lib/sheets/syncStokDuaArah.js` | status+created_at |
| `sync_stok_state` | `lib/sheets/syncStokDuaArah.js` | - |
| `daily_requests` | `lib/models/dailyRequests.js` | by tanggal |
| `access_requests` | `lib/models/accessRequests.js` | `where(status==)` |
| `keyword_notes` | `lib/models/keywordNotes.js` | - |
| `system_settings` | `lib/models/aiSettings.js` | - |
| `draft_kirim_guard` | `lib/dashboard/draftGuard.js` | write-only |
| `permintaan_form_guard` | `app/api/permintaan/route.ts` | write-only |
| `stock_write_guard` | `app/api/stok/mutasi/route.ts` | write-only |

**Koleksi baru yang akan dibutuhkan v4:** `gudang` (lokasi), `permintaan_kirim` (permintaan antar-gudang), `role_definisi` (role editable), `kledo_cache`, `kledo_sync_state`, `webhook_events` (idempotensi).

---

## 5. Route API — inventaris

| Path | Method | runtime | dynamic |
|---|---|---|---|
| `/api/auth/telegram` | POST | nodejs | force-dynamic |
| `/api/pengaturan/ai` | POST | nodejs | force-dynamic |
| `/api/admin/tambah` | POST | nodejs | force-dynamic |
| `/api/admin/hapus` | POST | nodejs | force-dynamic |
| `/api/admin/role` | POST | nodejs | force-dynamic |
| `/api/admin` | POST | nodejs | force-dynamic |
| `/api/produk/hpp` | POST | nodejs | force-dynamic |
| `/api/stok/reorder-point` | POST | nodejs | force-dynamic |
| `/api/stok/mutasi` | POST | nodejs | force-dynamic |
| `/api/permintaan` | POST | nodejs | force-dynamic |
| `api/webhook.js` | POST | Vercel function | maxDuration 300 |

**Pola guard standar:** tolakOrigin → cookie → sesi → rate limit → validasi → ambilAdmin → model → audit.
**Catatan:** route TIDAK diuji langsung oleh `npm test` (test memanggil helper/duplikasi urutan). Hanya e2e yang menyentuh route, dan e2e pakai mock. Lihat `docs/learnings.md` baris 24.

---

## 6. DataSource interface

`lib/dashboard/data/index.ts` — method yang ada:
`getSession`, `getRingkasan`, `listStock`, `getProduk`, `listMovements`, `listOpnameDrafts`, `listSyncDrafts`, `listDailyRequests`, `listAdmins`, `listRoleChanges`, `listAccessRequests`, `getAiSettings`, `mutasiStok`, `ubahProviderAi`, `ubahHpp`, `ubahReorderPoint`, `ubahRoleAdmin`, `tambahAdmin`, `hapusAdmin`, `sesuaikanQtyPermintaan`, `kirimFormPermintaan`, `tandaiPermintaanDatang`, `selesaikanPermintaan`, `listKeywordNotes`, `konfirmasiKeywordNote`, `setujuiAkses`, `tolakAkses`, `tambahProduk`, `listPickingDrafts`, `konfirmasiDraft`.

**~30 method.** Implementasi: `real.ts` (Firestore) + `mock.ts` (deterministik) + `sumber-data.tsx` (stub `dataKosong()`).

**Untuk v4, method baru yang kira-kira dibutuhkan:** `listGudang`, `tambahGudang`, `ubahGudang`, `hapusGudang`, `listPermintaanKirim`, `buatPermintaanKirim`, `setujuiPermintaanKirim`, `tolakPermintaanKirim`, `terimaPermintaanKirim`, `flagOnlineProduk`, `listRoleDefinisi`, `simpanRoleDefinisi`, `setLokasiUser`, `sinkronKledo`.

**Risiko:** setiap method baru harus diimplementasi 3x (real, mock, stub) + test paritas. Ini pekerjaan besar — pertimbangkan pecah interface per domain.

---

## 7. Test & e2e rapuh

**Test unit:** 34 file. Yang menyentuh stok/online/role: 9 file (lihat §1C dan §2).

**E2E:** 19 spec. Yang mengunci COUNT baris (paling rapuh, lihat `docs/learnings.md` baris 31):
- `e2e/histori.spec.ts` — `toHaveCount(12)`
- `e2e/ringkasan.spec.ts` — 10 baris teratas
- `e2e/smoke.spec.ts`

Lainnya yang akan terdampak: `stok.spec.ts`, `staff.spec.ts`, `routing.spec.ts`, `responsif.spec.ts`, `izin.spec.ts`, `dashboard-v2.spec.ts`.

**Aturan dari learnings:** sebelum menambah seed koleksi bersama, jalankan e2e yang mengunci COUNT LEBIH DULU.

---

## 8. `lib/models/` — refactor surface kalau pindah Kledo REST

| File | Koleksi |
|---|---|
| `lib/models/stok.js` | `stock` |
| `lib/models/produk.js` | `products` |
| `lib/models/admins.js` | `admins` |
| `lib/models/stockMovements.js` | `stock_movements` |
| `lib/models/sessions.js` | `sessions` |
| `lib/models/dailyRequests.js` | `daily_requests` |
| `lib/models/accessRequests.js` | `access_requests` |
| `lib/models/keywordNotes.js` | `keyword_notes` |
| `lib/models/aiSettings.js` | `system_settings/ai` |
| `lib/models/adminRoleChanges.js` | `admin_role_changes` |
| `lib/models/productChanges.js` | `product_changes` |
| `lib/firebase.js` | Inisialisasi `firebase-admin` |

**11 file + `lib/firebase.js`** yang bergantung pada `firebase-admin`. Ini yang harus di-refactor kalau Workers native (bukan OpenNext).

---

## 9. Integrasi Kledo yang sudah ada

**NOL.** `kledo-api-reference.md` (1.3 MB) ada di root, tapi tidak ada satu pun import/kode Kledo. Verifikasi: scan `kledo` di `lib/`, `app/`, `components/`, `api/` = 0 hit.

---

## 10. Composite index — yang sudah ada vs yang akan dibutuhkan

**Ter-deploy (5, semua di `stock_movements`):** kombinasi `action_type`, `created_by`, `kode_barang`, `status`, `type` — masing-masing dengan `created_at DESC`.

**Belum ada di `firestore.indexes.json` tapi dipakai kode:** query `opname_drafts` dan `sync_stok_drafts` dengan `status` + `created_at` (dipakai `lib/dashboard/data/real.ts`). **PERLU VERIFIKASI** apakah sudah ter-deploy (tidak muncul di `firestore.indexes.json`). Ini persis pola bug commit `097b43c`.

**Akan dibutuhkan v4:** `(gudang_id, status, created_at)` untuk permintaan kirim; `(gudang_id, is_online_product)` untuk stok per gudang.

---

## 11. Koreksi terhadap output explorer pertama

Explorer mengembalikan teks dengan klaim yang salah dan TIDAK menulis file. Yang salah:
1. "3 function guard terpisah (`guard`, `role`, `permission`)" — TIDAK ADA; hanya 11 function total (10 route + webhook).
2. "Index baru: `stock_movements: {kode_barang, created_at}`" — index ini SUDAH ADA.
3. "`opname_drafts`/`sync_stok_drafts` butuh komposit" — kode memang memakainya, tapi status deployment belum diverifikasi.
4. Beberapa nomor baris salah/tidak akurat (mis. menyebut `lib/models/admins.js:33` sebagai `isOwnerAdmin()` — sebenarnya `isSuperAdmin`).
5. Format output: teks, bukan file.

**Pelajaran:** agent explorer bisa gagal menulis artifact dan tetap melaporkan seolah selesai. Verifikasi `git status` setelah setiap delegasi (pola ini sudah tercatat di `docs/learnings.md` baris 34).