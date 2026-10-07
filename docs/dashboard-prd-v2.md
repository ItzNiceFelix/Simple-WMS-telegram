# PRD Addendum v2 - Dashboard "Bot Admin Toko"

> Status: **ADDENDUM** untuk `docs/dashboard-prd.md` (v1, 1399 baris). Dokumen ini TIDAK menggantikan v1.
> Semua keputusan v1 tetap berlaku kecuali yang secara eksplisit diubah di sini.
> Referensi v1: §8 Persona & Peran, §8.1 Matriks izin, §9 JTBD, §11.4 pengecekan role server-side,
> §11.6 Security Rules, §13 aksi tulis stok, §15 halaman, §17 FR, §18 BR, §23 data, §24 API, §26 UX,
> §27 events, §34 monitoring, §36 DoD, §37 urutan implementasi, §38 testing mock-first.
>
> Bahasa produk: Bahasa Indonesia. Penulis: PRD specialist. Konsumen: agent server/model + agent UI/UX.

> **Changelog revisi 2026-09-15 (hasil review advers `docs/dashboard-prd-v2-review.md`).** Perubahan
> dari versi sebelumnya:
> - **B1 (bug produksi):** ditetapkan sebagai bagian WAJIB v2 — perbaiki `lib/reminder/cekReorderPoint.js:47`
>   dan `lib/reminder/reminderHarian.js:62` (`admin.id` -> `admin.telegram_user_id`). F2 hanya boleh
>   menjual `notifikasi_terkirim`/toast SETELAH bug ini diperbaiki. Tambah test yang gagal sebelum fix.
> - **B2:** hapus klaim salah "suite `npm test` sudah memuat test bot". Wajibkan test baru
>   `test/auditRole.test.js` (§8.2, §17 A10).
> - **B3:** koreksi klaim TypeScript — `dataKosong()` di-cast `as unknown as DataSource`, jadi compiler
>   TIDAK menagih method baru; lupa tambah = error RUNTIME. Fungsi baru wajib ditambah manual (§11).
> - **B4:** F5 menyentuh minimal 4 file (route auth, `real.ts`, `mock.ts`, `types.ts`), bukan "1 field".
> - **Opsi audit role:** diganti dari Opsi C ke **Opsi D** (`catatAudit` param, default true) (§8.2).
> - **Q1–Q7 diputuskan** (§16.2); **Q1**: risiko TOCTOU diterima sadar + kapan ditinjau ulang.
> - **Q2 terverifikasi:** bot memang memanggil `revokeAccessRequest` (`handleRevokeAdmin.js:78`); route
>   F4b wajib sama (§5.3, A8).
> - **N5:** urutan audit hapus admin dikoreksi jadi SESUDAH `hapusAdmin` sukses (§5.3).
> - **401 mid-write:** F1/F2/F3/F4 diselaraskan dengan v1 §11.2 (toast + tombol "Buka ulang" + form
>   DIPERTAHANKAN di memori; dialog TIDAK ditutup saat 401).
> - **N10:** matriks F5 §6.3 diselaraskan dengan keputusan Q3 (status-diri, bukan daftar env).
> - **Promosi ke owner:** boleh tanpa guard, wajib AlertDialog konfirmasi ekstra (§4.6).

---

## 1. Ringkasan

v2 memperluas dashboard dari **read-only + koreksi stok** menjadi **operasi tulis administratif**:
owner/admin bisa mengubah data master produk (HPP, reorder point) dan owner bisa mengelola
whitelist admin (ubah role, tambah, hapus) langsung dari dashboard, tanpa lewat bot. Semua tulis
tetap lewat route server `/api/*` (v1 §11.4: role dari `ambilAdmin`, bukan dari body), dengan audit
wajib. v2 juga menutup **kebocoran audit** yang ditemukan pada `lib/models/admins.js::updateRoleAdmin`
(tidak menulis `admin_role_changes`) dengan kontrak eksplisit: route server wajib memanggil
`catatPerubahanRole` setelah `updateRoleAdmin` sukses.

### 1.1 Daftar fitur v2 (scope disetujui, tidak lebih)

| # | Fitur | Role | Halaman | Route baru |
|---|---|---|---|---|
| F1 | Edit HPP produk (`hpp`, `hpp_baru`) | owner | `/produk/[kode]` | `POST /api/produk/hpp` |
| F2 | Edit reorder point (`reorder_point`) | owner + admin | `/produk/[kode]` | `POST /api/stok/reorder-point` |
| F3 | Ubah role admin | owner | `/admin` | `POST /api/admin/role` |
| F4 | Kelola admin: tambah & hapus | owner | `/pengaturan` | `POST /api/admin/tambah`, `POST /api/admin/hapus` |
| F5 | Kelola super admin (`SUPER_ADMIN_ID`) | owner | `/pengaturan` | read-only; lihat §6 |

**Non-goals v2** (dikonfirmasi user, jangan diimplementasikan): role baru / permission custom
(role tetap union `"owner" | "admin" | "guest"`, `lib/dashboard/types.ts:5`), theme per-user
(theme tetap per-device via `localStorage.tema`, `components/dashboard/theme-toggle.tsx`),
tulis Firestore langsung dari client SDK.

### 1.2 Prinsip yang diwarisi dari v1 (tidak diubah)

- Klien tidak dipercaya; role selalu dibaca ulang server-side via `ambilAdmin(sesi.uid)`.
- Semua halaman tetap **statis** (v1 §12) — tidak ada SSR baru.
- Tulis HANYA lewat route server + admin SDK; Rules Firestore tetap `allow write: if false`.
- Audit dulu, kenyamanan kemudian (v1 §16 prinsip 1).
- Pola route teladan: `tolakOrigin(request)` -> cookie sesi -> `verifikasiTokenSesi` -> `cekRateLimit`
  -> parse body -> `ambilAdmin(sesi.uid)` -> model -> `console.info` log. Salinan persis
  `app/api/stok/mutasi/route.ts` dan `app/api/pengaturan/ai/route.ts`.

---

## 2. Fitur F1 - Edit HPP Produk (owner only)

### 2.1 User story

> Sebagai **owner**, saya mau memperbarui HPP dan HPP baru sebuah produk dari dashboard, supaya
> data harga pokok akurat tanpa membuka bot atau mengedit Firestore manual.

JTBD turunan J1/J2 v1 (§9): owner butuh jalur tulis data master yang teraudit.

### 2.2 Izin per role

| Owner | Admin | Guest | Non-admin |
|---|---|---|---|
| **ya** (ubah `hpp` + `hpp_baru`) | tidak (lihat saja) | tidak | tidak (401/403) |

Guest & admin tetap dapat **membaca** `products` (v1 §11.6 `allow read: if authed()`).

### 2.3 Kontrak route server

- **Path:** `POST /api/produk/hpp`
- **Method:** `POST` (tidak ada `PUT`/`PATCH`; konsisten pola v1)
- **Auth:** cookie sesi (`dat_sesi`), role dari `ambilAdmin(sesi.uid)`.

**Body:**

```json
{
  "kode_barang": "BRG-001",
  "hpp": 90000,
  "hpp_baru": 92000
}
```

- `kode_barang`: string non-kosong, wajib.
- `hpp`: integer >= 0, wajib.
- `hpp_baru`: integer >= 0 ATAU `null` (menghapus HPP baru), opsional. Field tidak dikirim = tidak diubah.
- Minimal salah satu `hpp`/`hpp_baru` harus ada.

**Validasi berurutan + kode status + pesan (Bahasa Indonesia):**

| Cek | Status | `error` |
|---|---|---|
| `tolakOrigin` gagal | 403 | `"Origin tidak diizinkan."` |
| cookie sesi tidak ada / `verifikasiTokenSesi` null | 401 | `"Sesi kedaluwarsa. Buka ulang dari Telegram."` |
| rate limit (`hpp:{uid}`, 20/menit) | 429 | `"Terlalu banyak permintaan. Coba lagi sebentar lagi."` |
| body bukan JSON | 400 | `"Body tidak valid."` |
| `kode_barang` kosong / bukan string | 400 | `"Kode barang wajib diisi."` |
| `hpp` ada tapi bukan integer >= 0 | 400 | `"HPP harus bilangan bulat >= 0."` |
| `hpp_baru` ada tapi bukan integer >= 0 dan bukan null | 400 | `"HPP baru harus bilangan bulat >= 0."` |
| tidak ada field yang dikirim | 400 | `"Tidak ada perubahan yang dikirim."` |
| `ambilAdmin` null | 403 | `"Akses ditolak. Hubungi owner."` |
| role !== `"owner"` | 403 | `"Hanya owner yang dapat mengubah HPP."` |
| `ambilProdukByKode` null | 404 | `"Produk tidak ditemukan."` |
| gagal Firestore (model throw) | 500 | `"Gagal memperbarui HPP."` |

**Sukses 200:** `{ ok: true, produk: { kode_barang, hpp, hpp_baru, updated_at } }`.

**Edge case:**

- `hpp` baru === `hpp` lama dan `hpp_baru` tidak berubah -> tetap 200 (idempoten), **tidak** menulis
  baris audit `product_changes` (BR-F1-4).
- `hpp_baru` diset `null` -> dokumen menyimpan `hpp_baru: null`; audit mencatat `nilai_lama` -> `null`.
- `hpp` = 0 (produk gratis / belum diisi) -> sah, bukan error.
- Nilai dikirim sebagai string `"90000"` -> 400 (route TIDAK melakukan `Number()` implisit).
- `kode_barang` = produk non-online -> tetap boleh (HPP relevan untuk semua produk). Tidak ada cek
  `is_online_product` (berbeda dari stok).

### 2.4 Fungsi model dipakai / baru

| Fungsi | Lokasi | Status | Catatan |
|---|---|---|---|
| `ambilProdukByKode(kode)` | `lib/models/produk.js:71` | ada | cek 404 + ambil nilai lama |
| `updateProduk(kode, partial)` | `lib/models/produk.js:88` | ada | sudah invalidasi cache; tambah `updated_at` otomatis |
| `catatPerubahanProduk({...})` | **`lib/models/productChanges.js` (perlu dibuat)** | baru | tulis `product_changes` |

`updateProduk` TIDAK boleh diubah signature-nya.

**`catatPerubahanProduk` (perlu dibuat di `lib/models/productChanges.js`):**

```
catatPerubahanProduk({
  kodeBarang,    // string
  field,         // "hpp" | "hpp_baru" | "reorder_point"
  nilaiLama,     // number | null
  nilaiBaru,     // number | null
  changedBy      // string (sesi.uid)
}) -> Promise<{ id, kode_barang, field, nilai_lama, nilai_baru, changed_by, created_at }>
```

Satu baris per field yang berubah (HPP dan HPP baru = 2 baris terpisah bila keduanya berubah).

### 2.5 Halaman UI + komponen

- **Halaman:** `app/produk/[kode]/page.tsx` (H3, sudah ada) — tambah aksi owner.
- **Komponen baru:** `components/dashboard/dialog-edit-hpp.tsx`.
  - Trigger: tombol "Edit HPP" (`data-testid="buka-dialog-hpp"`) dirender HANYA bila `role === "owner"`.
  - Isi form: `Input` `hpp` (inputMode numeric) + `Input` `hpp_baru` (opsional, boleh dikosongkan = null).
  - Preview nilai lama di `KartuInfo` (sudah ada) tetap.
  - Sama pola dengan `components/dashboard/dialog-koreksi-stok.tsx`: submit disabled saat `mengirim`,
    toast sukses/gagal, refetch setelah sukses.

### 2.6 State UI

| State | Perilaku |
|---|---|
| Loading | Skeleton H3 seperti sekarang; tombol tidak dirender sebelum data siap |
| Kosong / produk tidak ada | Empty "Produk tidak ditemukan" (sudah ada, tidak diubah); tombol tidak dirender |
| Error muat | Alert "Gagal memuat detail produk." + tombol "Coba lagi" (sudah ada) |
| Admin/guest | Tombol "Edit HPP" **tidak dirender**; nilai HPP tetap terlihat |
| Submit | Tombol "Simpan" disabled + spinner; dialog terkunci (tidak bisa ditutup saat mengirim) |
| Sukses | Toast `"HPP diperbarui"`; dialog tutup; H3 refetch; HPP baru terlihat |
| Error 400 | Error field inline (pesan dari server), dialog tetap terbuka, nilai input dipertahankan |
| Error 401 | Toast `"Sesi kedaluwarsa. Buka ulang dari Telegram."` + tombol "Buka ulang" (v1 §11.2); dialog TIDAK ditutup; isian form DIPERTAHANKAN di memori (tidak direset) |
| Error 500/network | Toast `"Gagal menyimpan. Coba lagi."`; dialog tetap terbuka |

### 2.7 Test yang membuktikan

**`test/editProduk.test.js` (baru, `node:test` + `test/helpers/mockFirestore.js`):**

1. owner mengubah `hpp` 85000 -> 90000 -> dokumen `products` terupdate, `hpp_baru` tidak berubah.
2. owner mengubah `hpp_baru` menjadi `null` -> dokumen menyimpan `hpp_baru: null`.
3. owner mengirim `hpp: "90000"` (string) -> ditolak (validasi `Number.isInteger`), tidak ada tulis.
4. non-owner (admin) -> 403, tidak ada tulis.
5. produk tidak ada -> 404.
6. sukses -> tepat 1 baris `product_changes` dengan `field: "hpp"`, `nilai_lama`, `nilai_baru`, `changed_by`.
7. dua field berubah sekaligus -> tepat 2 baris `product_changes`.
8. nilai tidak berubah -> 200, 0 baris `product_changes` (BR-F1-4).
9. `updateProduk` dijalankan -> `invalidasiCacheProduk` terpanggil (assert cache kosong setelah tulis).

**Playwright (mode mock):** tombol "Edit HPP" tampil untuk owner dan tidak tampil untuk admin/guest;
dialog sukses mengubah nilai yang dirender.

---

## 3. Fitur F2 - Edit Reorder Point (owner + admin)

### 3.1 User story

> Sebagai **owner atau admin**, saya mau menyetel reorder point sebuah produk dari dashboard,
> supaya reminder stok menipis relevan dengan laju penjualan tanpa menunggu bot.

### 3.2 Izin per role

| Owner | Admin | Guest | Non-admin |
|---|---|---|---|
| **ya** | **ya** | tidak | tidak (401/403) |

### 3.3 Kontrak route server

- **Path:** `POST /api/stok/reorder-point`
- **Method:** `POST`
- **Auth:** cookie sesi; role dari `ambilAdmin(sesi.uid)`; `owner` atau `admin` (bukan guest).

**Body:**

```json
{ "kode_barang": "BRG-001", "reorder_point": 15 }
```

- `kode_barang`: string non-kosong, wajib.
- `reorder_point`: integer >= 0 ATAU `null` (menghapus reorder point), wajib dikirim
  (beda dari F1: di sini `null` adalah nilai sah yang eksplisit, bukan "tidak diubah").

**Validasi + status + pesan:**

| Cek | Status | `error` |
|---|---|---|
| origin | 403 | `"Origin tidak diizinkan."` |
| sesi | 401 | `"Sesi kedaluwarsa. Buka ulang dari Telegram."` |
| rate limit (`reorder:{uid}`, 20/menit) | 429 | `"Terlalu banyak permintaan. Coba lagi sebentar lagi."` |
| body bukan JSON | 400 | `"Body tidak valid."` |
| `kode_barang` kosong | 400 | `"Kode barang wajib diisi."` |
| `reorder_point` tidak ada di body (undefined) | 400 | `"Reorder point wajib diisi."` |
| `reorder_point` bukan integer >= 0 dan bukan `null` | 400 | `"Reorder point harus bilangan bulat >= 0."` |
| `ambilAdmin` null | 403 | `"Akses ditolak. Hubungi owner."` |
| role `guest` | 403 | `"Akses ditolak. Hubungi owner."` |
| produk tidak ada | 404 | `"Produk tidak ditemukan."` |
| tidak ada dokumen `stock/{kode}` | 404 | `"Data stok produk belum ada."` |
| model throw | 500 | `"Gagal memperbarui reorder point."` |

**Sukses 200:** `{ ok: true, reorder_point: 15, notifikasi_terkirim: boolean }`.
`notifikasi_terkirim` = hasil `cekDanNotifikasiReorderPoint` (true bila stok saat ini <= reorder point baru).

**PRASYARAT B1 (WAJIB — bug produksi, bagian dari v2):** `notifikasi_terkirim: true` HANYA sah bila
`cekDanNotifikasiReorderPoint` benar-benar mengirim pesan. Saat ini TIDAK: `lib/reminder/cekReorderPoint.js:47`
memanggil `kirimPesan(admin.id, ...)` sedangkan `ambilSemuaAdminByRole` (`lib/models/admins.js:99-102`)
mengembalikan field `telegram_user_id`, BUKAN `id` -> argumen SELALU `undefined` -> notifikasi tidak pernah
terkirim (dan `true` dikembalikan palsu, `lib/reminder/cekReorderPoint.js:50`). Bug identik di
`lib/reminder/reminderHarian.js:62`. Fix WAJIB sebelum F2 boleh menjual `notifikasi_terkirim`/toast:
- `lib/reminder/cekReorderPoint.js:47`: `admin.id` -> `admin.telegram_user_id`.
- `lib/reminder/reminderHarian.js:62`: `admin.id` -> `admin.telegram_user_id`.
- Komentar usang di `cekReorderPoint.js:44-46` (yang mengasumsikan `id` ada) diperbarui/dihapus.
Test wajib membuktikan `kirimPesan` dipanggil dengan id yang benar (bukan `undefined`); test ini GAGAL
sebelum fix dan HIJAU sesudah (lihat §3.7 #9). F2 tidak boleh di-merge tanpa fix ini.

**Edge case:**

- `reorder_point` = `null` -> menghapus reorder point; `cekDanNotifikasiReorderPoint` mengembalikan
  `false` (guard `stok.reorder_point === null` di `lib/reminder/cekReorderPoint.js:26`); audit mencatat
  transisi ke `null`.
- `reorder_point` = 0 -> valid; notifikasi dipicu bila stok <= 0.
- Nilai sama dengan nilai lama -> tetap 200 (idempoten), tidak ada baris `product_changes`, dan
  **tidak** memanggil `cekDanNotifikasiReorderPoint` (hindari spam notif tanpa perubahan).
- Stok produk sedang minus dan reorder point baru lebih kecil dari kekurangan -> notifikasi tetap
  terkirim (perilaku benar: item memang perlu dipantau).
- Notif gagal kirim -> TIDAK menggagalkan request: `cekDanNotifikasiReorderPoint` dibungkus try/catch
  di dalam model (pola `lib/models/stok.js:77-82`); log `[reorder_notif_failed]`.
- Dokumen `stock` tidak ada (produk online tapi belum pernah punya stok) -> 404 "Data stok produk
  belum ada." (route TIDAK membuat dokumen baru; beda dari `timpaStokOpname` yang membuat lewat `set merge`).

### 3.4 Fungsi model dipakai / baru

| Fungsi | Lokasi | Status | Catatan |
|---|---|---|---|
| `ambilProdukByKode(kode)` | `lib/models/produk.js:71` | ada | cek produk ada |
| `setReorderPoint(kode, nilai, oleh)` | **`lib/models/stok.js` (perlu dibuat)** | baru | invalidasi cache + pemicu notif |
| `catatPerubahanProduk({...})` | `lib/models/productChanges.js` (perlu dibuat, F1) | baru | `field: "reorder_point"` |

**Kontrak `setReorderPoint` (perlu dibuat di `lib/models/stok.js`):**

```
setReorderPoint(kodeBarang, nilai, oleh)
  -> Promise<{ stok, notifikasi } | null>
```

Wajib: (a) `doc.set({ reorder_point: nilai, last_updated, last_updated_by }, { merge: true })`;
(b) `invalidasiCacheStok()` **setelah** tulis; (c) panggil `cekDanNotifikasiReorderPoint(kodeBarang)`
dalam `try/catch` (pola persis `timpaStokOpname`, `lib/models/stok.js:86-103`) dan kembalikan
hasil boolean notif dalam bentuk `{ stok, notifikasi }` supaya route tidak perlu mengimpor
`cekReorderPoint` sendiri (jaga satu pintu model, prinsip v1 §16).

Tambahkan `setReorderPoint` ke `module.exports` (`lib/models/stok.js:148-158`).

### 3.5 Halaman UI + komponen

- **Halaman:** `app/produk/[kode]/page.tsx` (H3) — tombol "Edit Reorder" (`data-testid="buka-dialog-reorder"`)
  untuk owner+admin.
- Opsional (boleh didelegasikan terpisah): kolom aksi inline di `app/stok/page.tsx`. Bila dikerjakan,
  wajib memakai dialog yang sama, bukan form kedua.
- **Komponen baru:** `components/dashboard/dialog-edit-reorder.tsx`.
  - Input `reorder_point` (inputMode numeric), tombol "Hapus reorder point" (set null) untuk owner+admin.
  - Preview status setelah perubahan memakai `statusStok(stok, reorderBaru)` dari `lib/dashboard/format.ts`
    (badge Aman/Menipis/Stok Minus).

### 3.6 State UI

| State | Perilaku |
|---|---|
| Loading | Skeleton H3; tombol tidak dirender |
| Kosong (stok belum ada) | Tombol dirender tetapi submit -> error server "Data stok produk belum ada." |
| Error muat | Alert + "Coba lagi" (sudah ada) |
| Guest | Tombol tidak dirender |
| Submit | Disabled + spinner; dialog terkunci |
| Sukses | Toast `"Reorder point diperbarui"`; **hanya setelah fix B1**: jika `notifikasi_terkirim` true tambah toast info `"Notifikasi stok menipis terkirim ke owner & admin."` |
| Error 400/404 | Error inline memakai pesan server; dialog tetap terbuka |
| Error 401 | Toast `"Sesi kedaluwarsa. Buka ulang dari Telegram."` + tombol "Buka ulang"; dialog TIDAK ditutup; isian form DIPERTAHANKAN di memori (v1 §11.2) |

### 3.7 Test yang membuktikan

**`test/reorderPoint.test.js` (baru, `node:test` + mock Firestore):**

1. set reorder point 15 pada stok 10 -> dokumen `stock.reorder_point == 15`.
2. setelah set, `_cacheStok` invalid: `cariStokDiBawahReorderPoint()` mengembalikan produk tsb.
3. set `null` -> dokumen menyimpan `reorder_point: null`; `cariStokDiBawahReorderPoint()` tidak
   memuat produk itu.
4. notifikasi dipicu ketika stok (10) <= reorder baru (15) -> `notifikasi === true`
   (stub `kirimPesan`).
5. notifikasi TIDAK dipicu ketika stok (10) > reorder baru (5) -> `notifikasi === false`.
6. nilai sama -> tidak ada baris `product_changes`, tidak ada notifikasi.
7. `reorder_point` string `"15"` ditolak validasi route.
8. role guest -> 403; admin -> boleh.
9. **B1 (test regresi bug notifikasi, WAJIB gagal sebelum fix):** seed 1 owner (`telegram_user_id: "111"`)
   + 1 admin (`"222"`); stub `kirimPesan`; set reorder sehingga notif terpicu -> assert `kirimPesan`
   dipanggil 2x dengan argumen pertama `"111"` dan `"222"` (string, bukan `undefined`). Juga assert di
   `jalankanReminderHarian` (`test/reminderHarian.test.js` diperluas, atau kasus 9b di file ini) bahwa
   `kirimPesan` menerima `admin.telegram_user_id`. Sebelum fix B1, assert `!== undefined` GAGAL.

**Playwright (mock):** admin dapat membuka dialog dan menyimpan; badge status di H3 berubah
Menipis -> Aman sesuai nilai baru.

---

## 4. Fitur F3 - Ubah Role Admin (owner only)

### 4.1 User story

> Sebagai **owner**, saya mau mengubah role seorang admin (owner/admin/guest) dari halaman Admin,
> supaya promosi/demosi tidak bergantung pada bot, dan perubahan tetap masuk audit.

### 4.2 Izin per role

| Owner | Admin | Guest | Non-admin |
|---|---|---|---|
| **ya** | tidak (halaman tetap read-only untuk admin) | tidak | tidak (401/403) |

**Catatan penting (perubahan dari v1):** di v1 seluruh H7 `/admin` read-only untuk semua role
(`app/admin/page.tsx:5`). v2 mengubahnya menjadi: **admin tetap read-only**, **owner mendapat aksi
per baris**.

### 4.3 Kontrak route server

- **Path:** `POST /api/admin/role`
- **Method:** `POST`
- **Auth:** cookie sesi; role dari `ambilAdmin(sesi.uid)`; WAJIB `owner`.

**Body:**

```json
{ "target_user_id": "900002", "role_baru": "admin" }
```

- `target_user_id`: string digit (`/^\d+$/`), wajib.
- `role_baru`: salah satu dari `"owner" | "admin" | "guest"`, wajib (lowercase; route men-lowercase input).

**Validasi + status + pesan:**

| Cek | Status | `error` |
|---|---|---|
| origin / sesi / rate limit (`adminrole:{uid}`, 10/menit) | 403 / 401 / 429 | pesan standar v1 |
| body bukan JSON | 400 | `"Body tidak valid."` |
| `target_user_id` bukan string digit | 400 | `"User ID target tidak valid."` |
| `role_baru` bukan salah satu nilai valid | 400 | `"Role tidak dikenal."` |
| `ambilAdmin` null | 403 | `"Akses ditolak. Hubungi owner."` |
| role !== `"owner"` | 403 | `"Hanya owner yang dapat mengubah role."` |
| target = diri sendiri | 400 | `"Tidak boleh mengubah role diri sendiri."` (guard model) |
| target bukan admin | 400 | `"User belum terdaftar sebagai admin."` (guard model) |
| role sama | 400 | `"Role user sudah <role>."` (guard model) |
| target owner terakhir diturunkan | 400 | `"Owner terakhir tidak boleh diturunkan rolenya."` (guard model) |
| model throw | 500 | `"Gagal mengubah role."` |

Semua pesan guard di atas berasal dari `updateRoleAdmin` (`lib/models/admins.js:78-89`) — route
meneruskan `hasil.error` apa adanya dan memetakannya ke **400** (kesalahan input domain, bukan 500).

**Sukses 200:** `{ ok: true, target_user_id, role_lama, role_baru }`.

**Alur wajib (temuan kritis):**

1. `updateRoleAdmin(target, roleBaru, sesi.uid)` -> sukses `{ adminLama, adminBaru }`.
2. **WAJIB** catat audit `admin_role_changes` (lihat §8.2 untuk keputusan: di dalam model atau di route).
3. Baru balas 200.

**Urutan & kegagalan audit:**

- `updateRoleAdmin` sukses TAPI audit gagal -> role SUDAH berubah di Firestore.
  Keputusan: **jangan rollback**, tapi log `[audit_write_failed]` keras (pola v1 §13 &
  `app/api/stok/mutasi/route.ts:189-194`) dan tetap balas 200 dengan `{ ok: true, peringatan_audit: true }`.
  Alasan: rollback role berisiko lebih besar (state role tidak konsisten dengan guard owner-terakhir)
  dibanding audit gap yang terdokumentasi. UI menampilkan toast sukses + toast warning.
- Alternatif yang DITOLAK: mencatat audit SEBELUM `updateRoleAdmin`. Audit akan mencatat perubahan
  yang mungkin tidak terjadi (model menolak), menghasilkan timeline palsu.

**Edge case:**

- Owner menurunkan dirinya sendiri -> ditolak model (400) — **dan UI tidak merender aksi untuk baris sendiri**.
- Owner menurunkan owner terakhir (target lain, total owner = 1) -> ditolak model (400).
- Dua owner menurunkan satu sama lain bersamaan -> `updateRoleAdmin` tidak memakai transaksi.
  **KEPUTUSAN SADAR (Q1): terima risiko TOCTOU di v2, TIDAK membangun guard transaksional.** Mitigasi
  yang ada: rate limit ketat (10/menit per uid) + audit `admin_role_changes` memungkinkan pemulihan via
  `SUPER_ADMIN_ID` env. **Syarat operasional (jaring keselamatan): `SUPER_ADMIN_ID` WAJIB diset di
  produksi sebelum rilis** — tanpa itu, 0 owner = terkunci permanen (tidak ada jalur pemulihan).
  **Ditinjau ulang kapan:** bila jumlah owner tumbuh (> 1 owner aktif nyata) ATAU bila multi-owner
  mulai dipakai bersamaan; saat itu bangun `db.runTransaction` yang mengecek jumlah owner di dalam
  transaksi (§16.2 Q1 ditutup dengan keputusan ini).
- `role_baru` = role saat ini -> 400 (model), bukan no-op 200.
- Target = `SUPER_ADMIN_ID` dari env tapi tidak ada di `admins` -> target bukan admin -> 400. v2 tidak
  memberi kemampuan mengubah env; lihat F5.
- **Promosi ke owner (keputusan produk):** owner BOLEH mengangkat owner baru tanpa guard jumlah
  (guard model hanya berlaku untuk PENURUNAN owner, `lib/models/admins.js:86`). TAPI UI WAJIB memakai
  `AlertDialog` konfirmasi ekstra yang menyebutkan konsekuensinya ("menjadikan <nama> Owner dengan
  hak setara Anda, termasuk kemungkinan menurunkan/menghapus admin lain") sebelum mengirim.

### 4.4 Fungsi model dipakai / baru

| Fungsi | Lokasi | Status |
|---|---|---|
| `updateRoleAdmin(target, roleBaru, diubahOleh)` | `lib/models/admins.js:76` | ada (guard sudah lengkap) |
| `catatPerubahanRole({...})` | `lib/models/adminRoleChanges.js:4` | ada |
| `ambilAdmin(uid)` | `lib/models/admins.js:8` | ada (route auth) |

Tidak ada fungsi model baru untuk F3; keputusan penempatan audit ada di §8.2.

### 4.5 Halaman UI + komponen

- **Halaman:** `app/admin/page.tsx` (H7) — tabel "Daftar Admin" diberi kolom aksi untuk owner.
- **Komponen baru:** `components/dashboard/aksi-role-admin.tsx` — `Select` role + tombol "Simpan" per
  baris, dengan `AlertDialog` konfirmasi untuk perubahan berisiko (turunkan owner).
- Baris milik owner yang sedang login -> aksi disabled dengan tooltip "Tidak boleh mengubah role diri sendiri".
- `data-testid="aksi-role-{telegram_user_id}"`, `data-testid="pilih-role-{telegram_user_id}"`,
  `data-testid="simpan-role-{telegram_user_id}"`.

### 4.6 State UI

| State | Perilaku |
|---|---|
| Loading | Skeleton H7 (sudah ada) |
| Kosong | Empty "Belum ada admin terdaftar." (sudah ada) |
| Error muat | Alert + "Coba lagi" (sudah ada) |
| Admin/guest | Tidak ada kolom aksi sama sekali (tabel seperti v1) |
| Owner | Kolom aksi untuk semua baris kecuali baris sendiri |
| Konfirmasi (Q5) | `AlertDialog` untuk: (a) menurunkan owner -> "Turunkan <nama> dari Owner menjadi <role>?"; (b) promosi ke owner -> konfirmasi ekstra menyebut hak setara + risiko. Komponen: `AlertDialog` shadcn/base-ui |
| Submit | Dropdown + tombol baris disabled + spinner |
| Sukses | Toast `"Role <nama> diubah menjadi <role>."`; refetch `listAdmins()` + `listRoleChanges()` |
| Error 400 | Toast pesan server; dropdown kembali ke nilai lama |
| Error 401 | Toast `"Sesi kedaluwarsa. Buka ulang dari Telegram."` + tombol "Buka ulang"; isian form/Dropdown DIPERTAHANKAN di memori (v1 §11.2) |

### 4.7 Test yang membuktikan

**`test/adminRole.test.js` (baru) + `test/auditRole.test.js` (baru, B2 — lihat §8.2 & §17 A10):**

1. owner mengubah guest -> admin -> dokumen `admins` role `admin`; **tepat 1 baris `admin_role_changes`**
   dengan `old_role: "guest"`, `new_role: "admin"`, `changed_by` = uid owner. (Di `test/auditRole.test.js`:
   assert "tepat 1" ini untuk `updateRoleAdmin` DAN untuk `handleSetRole` — membuktikan tidak double-audit
   setelah Opsi D.)
2. non-owner (admin) -> 403, role tidak berubah, 0 baris `admin_role_changes`.
3. owner mengubah role dirinya sendiri -> 400, role tidak berubah, 0 baris.
4. owner menurunkan owner terakhir (bukan dirinya) -> 400, role tidak berubah, 0 baris.
5. role sama -> 400, 0 baris.
6. target tidak ada di `admins` -> 400, 0 baris.
7. audit di-stub melempar -> dokumen `admins` tetap berubah; log `[audit_write_failed]` terpanggil
   (assert via spy console).
8. **Regresi**: setelah sukses, `listRoleChanges()` memuat baris baru — membuktikan timeline `/admin`
   tidak bocor.

**Playwright (mock):** tabel admin owner punya kontrol role; menyimpan memperbarui badge role dan
menambah entri timeline; admin tidak melihat kontrol apa pun.

---

## 5. Fitur F4 - Kelola Admin: Tambah & Hapus (owner only)

### 5.1 User story

> Sebagai **owner**, saya mau menambahkan admin baru dan mencabut akses admin lama dari dashboard,
> supaya operasional tidak berhenti ketika bot sedang tidak bisa dipakai.

### 5.2 Izin per role

| Owner | Admin | Guest | Non-admin |
|---|---|---|---|
| **ya** (tambah + hapus) | tidak | tidak | tidak (401/403) |

### 5.3 Kontrak route server

#### F4a - Tambah admin

- **Path:** `POST /api/admin/tambah`
- **Body:**

```json
{ "telegram_user_id": "900123", "name": "Budi Baru", "telegram_username": "budi", "role": "guest" }
```

- `telegram_user_id`: string digit, wajib.
- `name`: string 1..80 karakter setelah trim, wajib.
- `telegram_username`: string opsional, tanpa `@`, tanpa spasi; `null` bila kosong.
- `role`: `"owner" | "admin" | "guest"`, default `"guest"` bila tidak dikirim.

**Validasi + status + pesan:**

| Cek | Status | `error` |
|---|---|---|
| origin / sesi / rate limit (`admintambah:{uid}`, 10/menit) | 403 / 401 / 429 | pesan standar |
| body bukan JSON | 400 | `"Body tidak valid."` |
| `telegram_user_id` bukan string digit | 400 | `"User ID Telegram tidak valid."` |
| `name` kosong / > 80 char | 400 | `"Nama wajib diisi (maks 80 karakter)."` |
| `telegram_username` memuat spasi atau `@` di depan | 400 | `"Username tidak valid."` |
| `role` di luar 3 nilai | 400 | `"Role tidak dikenal."` |
| `ambilAdmin` requester null / bukan owner | 403 | `"Akses ditolak. Hubungi owner."` / `"Hanya owner yang dapat menambah admin."` |
| target SUDAH ada di `admins` | 409 | `"User sudah terdaftar sebagai admin."` |
| model throw | 500 | `"Gagal menambah admin."` |

**Sukses 201:** `{ ok: true, admin: { telegram_user_id, name, telegram_username, role, added_at } }`.

**Catatan:** `tambahAdmin` (`lib/models/admins.js:48`) memakai `set()` TANPA merge -> menimpa dokumen
yang sudah ada. Karena itu route WAJIB cek `ambilAdmin(id)` dulu dan menolak dengan 409; route TIDAK
boleh mengandalkan model (guard tidak ada di model).

#### F4b - Hapus admin

- **Path:** `POST /api/admin/hapus`
- **Body:** `{ "telegram_user_id": "900123" }`

**Validasi + status + pesan:**

| Cek | Status | `error` |
|---|---|---|
| origin / sesi / rate limit (`adminhapus:{uid}`, 10/menit) | 403 / 401 / 429 | pesan standar |
| body bukan JSON | 400 | `"Body tidak valid."` |
| `telegram_user_id` bukan string digit | 400 | `"User ID Telegram tidak valid."` |
| requester bukan owner | 403 | `"Hanya owner yang dapat menghapus admin."` |
| target = requester sendiri | 400 | `"Tidak boleh menghapus akun sendiri."` |
| target bukan admin | 404 | `"User tidak ditemukan di daftar admin."` |
| target adalah **owner terakhir** | 400 | `"Owner terakhir tidak boleh dihapus."` |
| target ada di `SUPER_ADMIN_ID` env | 400 | `"Super admin (env) tidak dapat dihapus dari dashboard."` |
| model throw | 500 | `"Gagal menghapus admin."` |

**Guard eksplisit F4b (WAJIB, karena `hapusAdmin` tidak punya guard apa pun — `lib/models/admins.js:111`):**

1. Tolak hapus diri sendiri.
2. Tolak hapus bila target `role === "owner"` dan jumlah owner <= 1 (`ambilSemuaAdminByRole("owner")`).
3. Tolak hapus bila target cocok `isSuperAdminDariEnv(target)` (env adalah jalur pemulihan terakhir).
4. **Audit pencabutan (WAJIB, urutan dikoreksi N5):** SETELAH `hapusAdmin` SUKSES, tulis audit
   pencabutan lewat `catatPerubahanRole` dengan `roleLama: <role target>`, `roleBaru: "dihapus"` supaya
   pencabutan akses teraudit di timeline `/admin`. **Audit DULU lalu hapus DILARANG** — itu tidak
   konsisten dengan F3 yang menolak audit-sebelum karena bisa mencatat perubahan yang tidak terjadi
   (§4.3: "Audit akan mencatat perubahan yang mungkin tidak terjadi"). Bila `hapusAdmin` gagal, entri
   audit TIDAK ditulis. Bila audit gagal SETELAH hapus sukses: jangan rollback hapus, log keras
   `[audit_write_failed]`, tetap balas 200 + `peringatan_audit: true` (pola §4.3).

**Sukses 200:** `{ ok: true, telegram_user_id, nama }` (+ `peringatan_audit: true` bila audit gagal).

**Urutan hapus (final):** `hapusAdmin` -> `revokeAccessRequest` (WAJIB — Q2 terverifikasi) ->
`catatPerubahanRole` (audit pencabutan, `new_role: "dihapus"`). `revokeAccessRequest` WAJIB karena bot
memang memanggilnya setelah `hapusAdmin` di `lib/handlers/handleRevokeAdmin.js:78`; route F4b harus
berperilaku sama (jika tidak, user bisa langsung request ulang akses). Lihat §16.2 Q2.

**Edge case:**

- Di antara dua request hapus konkuren, `hapusAdmin` tidak transaksional -> dua owner bisa saling
  menghapus hingga 0 owner. Mitigasi sama seperti F3 (§16.2 Q1).
- Target dihapus tetapi user masih punya cookie sesi aktif -> tetap bisa **membaca** (klaim token
  lama) maksimum 1 jam; tulis langsung diblokir karena route selalu `ambilAdmin` ulang (v1 §11.7).
  UI menampilkan catatan ini di konfirmasi hapus.
- Menghapus admin tidak menghapus `access_requests` lama -> user bisa mengajukan ulang bila
  `revokeAccessRequest` tidak dipanggil. Lihat §16.2 Q2.

### 5.4 Fungsi model dipakai / baru

| Fungsi | Lokasi | Status |
|---|---|---|
| `ambilAdmin(id)` | `lib/models/admins.js:8` | ada |
| `tambahAdmin(id, {name, role, approvedBy, username})` | `lib/models/admins.js:48` | ada |
| `hapusAdmin(id)` | `lib/models/admins.js:111` | ada (TANPA guard) |
| `ambilSemuaAdminByRole("owner")` | `lib/models/admins.js:99` | ada |
| `isSuperAdminDariEnv(id)` | `lib/models/admins.js:21` | ada (**perlu diekspor**) |
| `catatPerubahanRole({...})` | `lib/models/adminRoleChanges.js:4` | ada |

**Perubahan model yang diperlukan:** tambahkan `isSuperAdminDariEnv` ke `module.exports`
(`lib/models/admins.js:115-127`) — saat ini fungsi ada tapi tidak diekspor. Tidak ada fungsi baru lain.

### 5.5 Halaman UI + komponen

- **Halaman:** `app/pengaturan/page.tsx` (H8) — seksi baru "Kelola Admin" di bawah kartu provider AI,
  dirender HANYA untuk owner.
- **Komponen baru:**
  - `components/dashboard/kelola-admin.tsx` — tabel ringkas admin (nama, username, role) + tombol
    "Tambah Admin" dan aksi hapus per baris.
  - `components/dashboard/dialog-tambah-admin.tsx` — form `telegram_user_id`, `name`,
    `telegram_username`, `Select` role.
  - `components/dashboard/konfirmasi-hapus-admin.tsx` — `AlertDialog` dengan teks risiko eksplisit.
- Data dibaca lewat `data.listAdmins()` yang sudah ada (tidak ada fungsi `DataSource` baru untuk baca).
- Hapus baris milik sendiri -> tombol disabled + tooltip "Tidak boleh menghapus akun sendiri".

### 5.6 State UI

| State | Perilaku |
|---|---|
| Loading | Skeleton tabel admin |
| Kosong | Empty "Belum ada admin terdaftar." + CTA "Tambah Admin" |
| Error muat | Alert "Gagal memuat daftar admin." + "Coba lagi" |
| Non-owner | Seluruh seksi "Kelola Admin" tidak dirender |
| Form tambah | Validasi klien: user id digit, nama non-kosong; submit disabled saat mengirim |
| Tambah sukses | Toast `"Admin <nama> ditambahkan."`; dialog tutup; daftar refetch |
| Tambah 409 | Error inline "User sudah terdaftar sebagai admin."; dialog tetap terbuka |
| Hapus konfirmasi | AlertDialog memuat: nama, user id, role, dan catatan "Akses baca berlaku sampai 1 jam; akses tulis berhenti seketika." |
| Hapus sukses | Toast `"Admin <nama> dihapus."`; daftar refetch |
| Hapus 400 (owner terakhir / diri sendiri) | Toast pesan server; tanpa perubahan |
| Error 401 | Toast `"Sesi kedaluwarsa. Buka ulang dari Telegram."` + tombol "Buka ulang"; dialog TIDAK ditutup; isian form DIPERTAHANKAN di memori (v1 §11.2) |

### 5.7 Test yang membuktikan

**`test/adminKelola.test.js` (baru):**

1. owner menambah user baru role `admin` -> dokumen `admins/{id}` ada, `approved_by` = uid owner.
2. user id sudah ada -> 409, dokumen lama TIDAK tertimpa (assert `name` lama utuh).
3. admin (non-owner) menambah -> 403, tidak ada dokumen.
4. owner menghapus guest -> dokumen `admins` hilang.
5. owner menghapus dirinya sendiri -> 400, dokumen tetap ada.
6. owner menghapus owner terakhir (target lain, total owner = 1) -> 400, dokumen tetap ada.
7. target di `SUPER_ADMIN_ID` -> 400 meskipun ada di `admins`.
8. target tidak ada -> 404.
9. hapus menulis 1 baris audit pencabutan dengan `new_role: "dihapus"`, DAN `revokeAccessRequest`
   terpanggil (assert `access_requests` target tidak lagi "pending"/tertutup) — membuktikan paritas
   dengan bot (`handleRevokeAdmin.js:78`).
9b. **Urutan (N5):** bila `hapusAdmin` di-stub throw, assert 0 baris `admin_role_changes` ditulis
   (audit pencabutan hanya SETELAH hapus sukses).
10. `isSuperAdminDariEnv` mendukung daftar dipisah koma (`"1, 2 ,3"` -> `2` true).

**Playwright (mock):** owner melihat seksi Kelola Admin; admin/guest tidak; alur tambah-hapus
di mock mengubah tabel.

---

## 6. Fitur F5 - Kelola Super Admin (owner only) - keputusan & keterbatasan

### 6.1 Analisis dan keputusan

`SUPER_ADMIN_ID` dibaca dari `process.env` (`lib/models/admins.js:21-27`). **Environment variable
TIDAK dapat diubah dari UI dashboard** pada runtime Vercel tanpa redeploy atau tanpa platform API —
dan memberi dashboard kemampuan menulis env adalah permukaan serangan yang tidak dapat diterima
(dashboard bisa mengangkat dirinya sendiri menjadi super admin permanen).

**KEPUTUSAN v2: F5 = READ-ONLY.**

- Dashboard **menampilkan** daftar super admin dari env (`SUPER_ADMIN_ID`, sudah siap dipisah koma)
  beserta penanda "Sumber: variabel lingkungan (tidak dapat diubah dari dashboard)".
- **Tidak ada route tulis** untuk super admin di v2. F5 tidak menambah route tulis.
- Perubahan daftar super admin dilakukan lewat konfigurasi deploy (env Vercel), di luar scope dashboard.

**Ini keputusan produk yang mengikat, bukan kerja sia-sia:** bila owner ingin daftar berwenang yang
dapat diubah-ubah, jalur yang benar adalah **mengelola `admins.role == "owner"`** (F3/F4), bukan
menambah tulis env. `isSuperAdminDariEnv` tetap ada sebagai jalur pemulihan cadangan (v1 §4H) dan
TIDAK boleh dapat dihapus dari UI.

### 6.2 Data super admin yang ditampilkan (KEPUTUSAN Q3 — read-only status-diri)

**KEPUTUSAN FINAL v2 (menggantikan "opsi tampilan" sebelumnya):** tampilkan **status super admin
untuk user yang sedang login saja** (`superAdmin: boolean`), lewat perluasan respons auth yang sudah
ada. **TIDAK ada route baca baru** -> 0 function tambahan (function budget tetap 9).

**B4 — perubahan ini TIDAK "cukup 1 field". Minimal 4 file (diperkirakan), masing-masing WAJIB diedit
atau field baru tidak akan pernah tampil:**
1. `app/api/auth/telegram/route.ts` (respons `json({...})` baris ~126-131) — tambah `superAdmin` =
   `isSuperAdminDariEnv(String(hasil.user.id)) || role === "owner"`. Route ini SUDAH bisa membaca
   `process.env` server-side; TIDAK perlu impor model baru bila `isSuperAdminDariEnv` diekspor (A3).
2. `lib/dashboard/data/real.ts` (`ambilSesiReal`, baris ~93-105) — perluas tipe respons + `SesiReal`
   dan teruskan `superAdmin` ke nilai balik sesi.
3. `lib/dashboard/data/mock.ts` — `makeMockDataSource().getSession()` (baris ~75-78) mengembalikan
   `MOCK_SESSION`; harus mengisi `superAdmin` (mis. `role === "owner"`).
4. `lib/dashboard/types.ts` — `SessionInfo` (baris 193-196) tambah `superAdmin: boolean`.

**Alasan pendekatan ini (paling sedikit menyentuh file):** alternatif (route baru `GET /api/admin/super`
atau `getStatusSuperAdminSaya()` di `DataSource`) menambah 1 function di budget DAN menambah
implementasi di ketiga tempat `DataSource`. Perluasan respons auth memakai jalur sesi yang sudah
ada, jadi hanya 4 file tipe/data — tanpa route & tanpa function baru.

**Keterbatasan yang WAJIB ditulis di UI copy (agar tidak jadi bug report):** nilai `superAdmin`
dihitung dari `SUPER_ADMIN_ID` env + role owner; **env TIDAK dapat diubah saat runtime dari
dashboard** (butuh redeploy). UI menampilkan teks: *"Status super admin berasal dari variabel
lingkungan (`SUPER_ADMIN_ID`) dan role owner. Tidak dapat diubah dari dashboard."* Bila user ingin
mengubah daftar berwenang, arahkan ke F3/F4 (kelola `admins.role`).

### 6.3 Izin (diselaraskan Q3/N10)

Karena keputusan Q3 = **status-diri** (bukan daftar env), admin TIDAK melihat daftar ID Telegram super
admin (mencegah kebocoran id). Penanda `superAdmin` milik user sendiri boleh terlihat oleh user itu.

| Owner | Admin | Guest | Non-admin |
|---|---|---|---|
| lihat status-diri | lihat status-diri | tidak | tidak |

### 6.4 State UI

| State | Perilaku |
|---|---|
| Loading | Skeleton baris |
| Kosong (env tidak diset) | Teks "Tidak ada super admin dari variabel lingkungan." (status-diri false) |
| Error | Alert "Gagal memuat status super admin." |
| Non-staff | Status tidak dirender |
| Keterbatasan | Teks tetap "tidak dapat diubah dari dashboard" selalu tampil di seksi ini |

### 6.5 Test

**`test/superAdmin.test.js` (baru):** `isSuperAdminDariEnv` true untuk id di daftar koma; false untuk
id lain; false saat env kosong; `isSuperAdmin` true bila role owner tanpa env. **B4:** assert
`getSession()` (mock DAN real) mengembalikan `superAdmin` bertipe boolean (bukan `undefined`).
Untuk endpoint baca
(bila dipilih): guest -> 403; owner/admin -> 200 dengan daftar.

---

## 7. Matriks Izin ADDENDUM (melengkapi v1 §8.1)

Tabel di bawah adalah **tambahan**; semua baris v1 §8.1 tetap berlaku kecuali yang diubah eksplisit
(pada H7, "admin tetap read-only", owner mendapat aksi).

### 7.1 Matriks aksi v2

| Halaman / Aksi | Owner | Admin | Guest | Non-admin |
|---|---|---|---|---|
| Edit HPP produk (F1) | **ya** | tidak (lihat) | tidak (lihat) | tidak |
| Edit reorder point (F2) | **ya** | **ya** | tidak (lihat) | tidak |
| Ubah role admin (F3) | **ya** | tidak (lihat H7) | tidak (H7 tersembunyi) | tidak |
| Tambah admin (F4a) | **ya** | tidak | tidak | tidak |
| Hapus admin (F4b) | **ya** | tidak | tidak | tidak |
| Lihat status super admin diri sendiri (F5) | lihat | lihat (diri sendiri) | tidak | tidak |
| Ubah daftar super admin env (F5) | **tidak ada di UI** (konfigurasi deploy) | tidak | tidak | tidak |

### 7.2 Matriks izin berisiko (guard wajib, semua server-side)

| Aksi berbahaya | Owner | Admin | Guard | Status bila dilanggar |
|---|---|---|---|---|
| Ubah role diri sendiri | dilarang | dilarang | model `updateRoleAdmin:79` | 400 |
| Turunkan owner terakhir | dilarang | dilarang | model `updateRoleAdmin:86` | 400 |
| Hapus diri sendiri | dilarang | dilarang | **route** (model tidak punya guard) | 400 |
| Hapus owner terakhir | dilarang | dilarang | **route** (model tidak punya guard) | 400 |
| Hapus super admin env | dilarang | dilarang | **route** (`isSuperAdminDariEnv`) | 400 |
| Menambah target yang sudah ada | dilarang | dilarang | **route** (`ambilAdmin` + 409) | 409 |
| Ubah HPP oleh non-owner | dilarang | - | route (`role !== "owner"`) | 403 |
| Ubah reorder point oleh guest | - | dilarang | route (`role === "guest"`) | 403 |

Sisi klien hanya menyembunyikan UI (v1 §8.1 catatan penutup) — **bukan pengaman**.

---

## 8. Audit Trail

### 8.1 Koleksi baru `product_changes` (keputusan user)

Menangkap perubahan data master produk (HPP, HPP baru, reorder point).

| Field | Tipe | Keterangan |
|---|---|---|
| (doc id) | auto-id | `add()` |
| `kode_barang` | string | kode produk |
| `field` | `"hpp" \| "hpp_baru" \| "reorder_point"` | field yang berubah |
| `nilai_lama` | number \| null | nilai sebelum |
| `nilai_baru` | number \| null | nilai sesudah |
| `changed_by` | string | `sesi.uid` (Telegram user id, selalu string) |
| `created_at` | Date | server-side |

**Siapa yang menulis:** HANYA route server (admin SDK) via
`lib/models/productChanges.js::catatPerubahanProduk` (perlu dibuat). Bot TIDAK menulis koleksi ini
di v2 (bot tidak mengubah HPP/reorder point). Rules: `allow read: if staff(); allow write: if false;`
(lihat §10).

**Satu baris per field yang berubah.** Dua field berubah = dua baris.

### 8.2 Audit perubahan role - TEMUAN KRITIS & rekomendasi

**Temuan:** `lib/models/admins.js::updateRoleAdmin` (baris 76-97) mengubah role **tanpa** mencatat
`admin_role_changes`. Bot mencatat audit secara **terpisah** di `lib/handlers/handleSetRole.js:26`,
setelah memanggil `updateRoleAdmin`. Akibatnya: memanggil `updateRoleAdmin` langsung (seperti yang
akan dilakukan route dashboard F3) menghasilkan perubahan role TANPA jejak di timeline `/admin` —
**audit bocor**. Ini melanggar prinsip v1 §16.1 ("Audit dulu, kenyamanan kemudian") dan metrik
v1 §28 ("rasio aksi tulis yang punya audit = 100%").

**Opsi:**

| Opsi | Deskripsi | Kelebihan | Kekurangan |
|---|---|---|---|
| A. Audit tetap di caller | Route dashboard memanggil `catatPerubahanRole` setelah `updateRoleAdmin` sukses (sama seperti bot) | Tanpa perubahan pada kode bot; diff kecil; bot tetap 1 baris audit | Kontrak tersembunyi: setiap caller baru bisa lupa -> audit bocor lagi. Bot & dashboard punya duplikasi logika |
| B. Pindahkan audit ke dalam model | `updateRoleAdmin` sendiri memanggil `catatPerubahanRole` | Tidak mungkin lupa; invariant ditegakkan di satu tempat | Bot (`handleSetRole.js:26`) sudah mencatat -> **double-catat**; wajib hapus panggilan di bot di perubahan yang sama |
| C. Model mencatat + hapus audit bot | = B + refactor bot di PR yang sama | Invariant kuat; tidak ada double-catat; timeline konsisten; 1 sumber kebenaran | Tidak ada escape hatch; caller non-audit masa depan (skrip/migrasi) tak punya jalan keluar |
| **D. Model mencatat (param opt-out)** | `updateRoleAdmin(target, roleBaru, diubahOleh, { catatAudit = true } = {})`; model memanggil `catatPerubahanRole` bila `catatAudit` true. Bot tetap panggil tanpa opsi (default true) -> hapus audit manual di bot | Invariant "tidak mungkin lupa" (default true) + escape hatch eksplisit untuk caller non-audit; mudah diuji (bisa matikan audit di test) | Satu param tambahan di signature model |

**REKOMENDASI FINAL: Opsi D.** Langkah:

1. Ubah signature `updateRoleAdmin` di `lib/models/admins.js:76` menjadi
   `updateRoleAdmin(telegramUserId, roleBaru, diubahOleh, { catatAudit = true } = {})`.
2. Setelah `update()` sukses (baris 91-96), bila `catatAudit === true`, panggil `catatPerubahanRole`
   memakai `adminLama`/`adminBaru` yang sudah tersedia. Karena ini model, hindari circular import:
   impor `catatPerubahanRole` dari `lib/models/adminRoleChanges.js`.
3. **Hapus** panggilan manual `catatPerubahanRole` di `lib/handlers/handleSetRole.js:26-32` dalam
   perubahan yang sama (wajib — kalau tidak, bot menulis 2 baris per perubahan role). Bot tetap
   memanggil `updateRoleAdmin(targetUserId, roleNormal, ctx.telegramUserId)` tanpa opsi -> default
   `catatAudit: true`. `hasil.adminLama.name` (dipakai pesan bot di baris 33) TETAP tersedia karena
   model tetap mengembalikan `{ adminLama, adminBaru }` (baris 96) — Opsi D tidak menghilangkan itu.
4. Route dashboard F3 memanggil `updateRoleAdmin` tanpa opsi (default audit aktif); TIDAK memanggil
   `catatPerubahanRole` sendiri.
5. **Test WAJIB (B2 — file baru `test/auditRole.test.js`, lihat §17 A10):** (a) `updateRoleAdmin`
   sukses -> tepat 1 baris `admin_role_changes`; (b) `handleSetRole` sukses -> tepat 1 baris (bukan 2);
   (c) guard gagal (role sama / turunkan owner terakhir / diri sendiri) -> 0 baris. File ini
   menggantikan klaim lama yang salah bahwa "suite `npm test` sudah memuat test bot".

**Alasan memilih D atas C:** blast radius sama-sama kecil (satu-satunya pemanggil `updateRoleAdmin`
adalah `handleSetRole.js:20`; tidak ada caller lain di repo), tetapi D memberi escape hatch eksplisit
(`catatAudit: false`) untuk skrip/migrasi masa depan tanpa melemahkan invariant default, dan lebih
mudah diuji. **Klaim lama "suite `npm test` sudah memuat test bot" SALAH** — grep di `test/` tidak
menemukan file apa pun yang mengimpor `handleSetRole`, `updateRoleAdmin`, atau `catatPerubahanRole`.
Tanpa `test/auditRole.test.js` baru, tidak ada bukti apa pun; regresi bot bisa lolos. Jadi test baru
itu WAJIB, bukan opsional, dan A4 tidak boleh di-merge tanpanya.

**Konsekuensi bila Opsi D TIDAK diambil (kembali ke Opsi A):** route F3 wajib memakai pola
"updateRoleAdmin -> catatPerubahanRole" dan §4.3 mengikat kontrak itu; bila ada caller dashboard baru
yang lupa, `admin_role_changes` kehilangan entri dan audit trail `/admin` tidak lengkap —
pelanggaran DoD v1 §36 ("tidak ada aksi tulis tanpa audit"). Opsi D diambil justru untuk menutup
risiko ini.

### 8.3 Perluasan semantik `admin_role_changes` untuk pencabutan

Audit pencabutan (F4b, WAJIB sesuai §5.3): `new_role: "dihapus"` (string di luar union role), ditulis SETELAH `hapusAdmin` sukses.
Koleksi `admin_role_changes` sudah menyimpan `old_role`/`new_role` sebagai string bebas
(`lib/dashboard/types.ts:168-169`), dan UI sudah menangani nilai tak dikenal
(`app/admin/page.tsx:263-266 labelRolePeran`). Tidak ada perubahan skema.

---

## 9. Guard Keamanan Eksplisit (aksi berbahaya)

Aturan berikut dikutip bulat-bulat untuk implementasi; tidak boleh dilemahkan:

1. **Hapus admin:** TIDAK boleh menghapus akun sendiri. (`hapusAdmin` tidak punya guard.)
2. **Hapus admin:** TIDAK boleh menghapus admin dengan `role === "owner"` jika itu owner terakhir
   (`ambilSemuaAdminByRole("owner").length <= 1`).
3. **Hapus admin:** TIDAK boleh menghapus user yang cocok `isSuperAdminDariEnv` (jalur pemulihan env).
4. **Hapus admin:** target harus ada di `admins` (404 bila tidak).
5. **Tambah admin:** tolak (409) bila target sudah ada, karena `tambahAdmin` memakai `set()` tanpa merge.
6. **Ubah role:** tolak mengubah role diri sendiri (guard model).
7. **Ubah role:** tolak menurunkan owner terakhir (guard model).
8. **Ubah role:** tolak role yang tidak berubah (400).
9. **Tulis HPP:** hanya `role === "owner"`; role diambil dari `ambilAdmin`, BUKAN dari body/sesi klaim.
10. **Tulis reorder point:** hanya owner/admin.
11. **Semua route tulis:** `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `tolakOrigin`,
    verifikasi cookie sesi, `cekRateLimit`, dan `console.info("[*_success]", ...)`.
12. **TIDAK ada route yang menerima `role`/`changed_by` dari body** — `changed_by` selalu `sesi.uid`.
13. **Rules Firestore:** seluruh koleksi baru (`product_changes`) `allow write: if false`; tulis hanya
    lewat admin SDK di route.
14. **Hapus admin (audit):** audit pencabutan ditulis SETELAH `hapusAdmin` sukses, dan
    `revokeAccessRequest` WAJIB dipanggil (paritas bot, `handleRevokeAdmin.js:78`). Audit gagal setelah
    hapus sukses -> jangan rollback hapus, log `[audit_write_failed]`, balas 200 + `peringatan_audit`.
15. **Notifikasi reorder (B1):** semua loop pengiriman ke admin WAJIB memakai `admin.telegram_user_id`
    (field dari `ambilSemuaAdminByRole`), BUKAN `admin.id`. Melanggar = notifikasi tidak pernah terkirim
    (argumen `undefined`) padahal fungsi mengembalikan `true`.

---

## 10. Security Rules - perubahan v2

Tambahan pada `firestore.rules` (v1 §11.6 tetap dipakai apa adanya):

```rules
// v2: audit perubahan data master produk
match /product_changes/{id} { allow read: if staff(); allow write: if false; }
```

- Dibaca oleh owner/admin (timeline perubahan produk bila UI ditambahkan; v2 hanya menulis).
- Guest tidak boleh membaca (data historis internal).
- Catch-all `match /{document=**} { allow read, write: if false; }` tetap menjadi jaring terakhir.
- Tidak ada koleksi lain yang berubah di v2. `admins`, `admin_role_changes`, `stock`, `products` tetap
  seperti v1.

---

## 11. Perubahan `DataSource` (interface + DUA implementasi)

Aturan proyek: setiap fungsi baru WAJIB ditambah ke `lib/dashboard/data/index.ts` **dan KE TIGA tempat
implementasi**: `real.ts`, `mock.ts`, dan `dataKosong()` di `lib/dashboard/sumber-data.tsx:196`.

**Konsekuensi TypeScript (koreksi B3 — JANGAN salah paham):**
- Interface `DataSource` (`lib/dashboard/data/index.ts`) MENAGIH: `real.ts` dan `mock.ts` yang
  bertipe `DataSource` akan GAGAL `tsc` bila method baru belum ada -> error build/type. Ini yang
  menangkap kelalaian di dua file itu.
- `dataKosong()` **TIDAK** ditangkap compiler. Fungsinya (`sumber-data.tsx:196-216`) diakhiri
  `as unknown as DataSource` (baris 215), yang mematikan pengecekan struktur. Jadi bila method baru
  lupa ditambahkan, TIDAK ada error build — kegagalan muncul sebagai **error RUNTIME** `"Sesi belum
  siap."` saat `value` dipakai di sesi yang belum siap.
- Karena itu: menambah method baru ke `dataKosong()` adalah langkah **manual wajib**, bukan gerakan
  yang "dipaksa" compiler. Dua pilihan verifikasi yang salah satunya WAJIB diambil:
  - (a) hapus cast `as unknown as DataSource`, ganti dengan objek literal bertipe `DataSource`
    (maka `tsc` ikut menagih); ATAU
  - (b) tambah test yang meng-assert setiap key `DataSource` ada di hasil `dataKosong()`.
- Gate §17.2 B5: BUKAN "typecheck bersih cukup" (typecheck memang tidak akan menangkap `dataKosong`);
  sertakan salah satu verifikasi (a)/(b) di atas.

**Fungsi tulis baru (semua `fetch` ke route server, `credentials: "include"`):**

| Fungsi | Route | Return |
|---|---|---|
| `ubahHpp(req: { kode_barang, hpp?, hpp_baru? })` | `POST /api/produk/hpp` | `{ ok: true, produk } \| { ok: false, error }` |
| `ubahReorderPoint(req: { kode_barang, reorder_point })` | `POST /api/stok/reorder-point` | `{ ok: true, reorder_point, notifikasi_terkirim } \| { ok: false, error }` |
| `ubahRoleAdmin(req: { target_user_id, role_baru })` | `POST /api/admin/role` | `{ ok: true, target_user_id, role_lama, role_baru } \| { ok: false, error }` |
| `tambahAdmin(req: { telegram_user_id, name, telegram_username?, role })` | `POST /api/admin/tambah` | `{ ok: true, admin } \| { ok: false, error }` |
| `hapusAdmin(req: { telegram_user_id })` | `POST /api/admin/hapus` | `{ ok: true, telegram_user_id, nama } \| { ok: false, error }` |

**Fungsi baca baru:** TIDAK ADA (Q3 diputuskan = perluasan `getSession()` dengan `superAdmin`, bukan fungsi/route baru).

**Aturan implementasi `real.ts`:**

- Mengikuti pola `mutasiStok`/`ubahProviderAi` (`lib/dashboard/data/real.ts:386-408`): `fetch`, parse
  JSON, kembalikan `{ ok: false, error }` bila `!res.ok`.
- `mock.ts` wajib menyimulasikan guard SAMA PERSIS dengan server: owner-only untuk HPP/role/hapus,
  owner+admin untuk reorder, 409 tambah duplikat, tolak hapus diri sendiri & owner terakhir. Mock yang
  lebih longgar dari server = test UI hijau palsu.

**Tipe baru (`lib/dashboard/types.ts`):**

```
export interface ProductChangeDoc {
  id: string;
  kode_barang: string;
  field: "hpp" | "hpp_baru" | "reorder_point";
  nilai_lama: number | null;
  nilai_baru: number | null;
  changed_by: string;
  created_at: string;
}
```

---

## 12. Non-Functional v2

- **Function budget (v1 §12):** v2 menambah **5 route handler** (produk/hpp, stok/reorder-point,
  admin/role, admin/tambah, admin/hapus). F5 = 0 route (keputusan Q3). Baseline route existing harus
  DIHITUNG AKTUAL dari `app/api/**/route.ts`, bukan diasumsikan. Per catatan reviewer (N9), route
  existing yang teridentifikasi saat review = `app/api/stok/mutasi/route.ts`,
  `app/api/pengaturan/ai/route.ts`, `app/api/auth/telegram/route.ts` (3; user menyebut "4" -> WAJIB
  dicek ulang saat implementasi). **Angka final = (jumlah route aktual) + 5.** Target <= 12. Bukti
  `vercel build` wajib dilampirkan di PR (bukan asumsi). **Setiap route tambahan berikutnya wajib
  menghitung ulang.**
- **Rate limit baru:** `hpp:{uid}` 20/menit; `reorder:{uid}` 20/menit; `adminrole:{uid}` 10/menit;
  `admintambah:{uid}` 10/menit; `adminhapus:{uid}` 10/menit. Semua soft-guard per instance (v1 §11.9).
- **Aksesibilitas:** dialog baru wajib: label form, `aria-invalid` saat error, fokus terlihat,
  kontras >= 4.5:1, `AlertDialog` untuk aksi destruktif (v1 §25).
- **Responsive:** dialog dan tabel aksi harus berfungsi pada 360 px (tabel -> kartu, v1 §26).
- **Audit:** 100% aksi tulis v2 menulis audit (`product_changes` atau `admin_role_changes`).

---

## 13. Analytics / Events v2

Tidak ada event klien baru (v1 §27: `page_view` dihapus). Log server baru pada route v2:

- `product_change_success` / `product_change_reject` (`/api/produk/hpp`)
- `reorder_point_success` / `reorder_point_reject` (`/api/stok/reorder-point`)
- `admin_role_success` / `admin_role_reject` (`/api/admin/role`)
- `admin_tambah_success` / `admin_tambah_reject`
- `admin_hapus_success` / `admin_hapus_reject`
- `audit_write_failed` (dipakai bersama v1)

Log memuat `uid` pelaku, target, dan alasan penolakan; **tidak** memuat token/`initData`.

---

## 14. User Flows

### 14.1 F1 Edit HPP

1. Owner membuka `/produk/[kode]`.
2. Tekan "Edit HPP" -> dialog tampil dengan nilai `hpp` & `hpp_baru` saat ini.
3. Ubah nilai -> tekan "Simpan".
4. Klien validasi (integer >= 0) -> `POST /api/produk/hpp`.
5. Server: origin -> sesi -> rate limit -> validasi -> `ambilAdmin` -> owner -> `ambilProdukByKode`
   -> `updateProduk` -> `catatPerubahanProduk` -> 200.
6. UI: toast sukses, tutup dialog, refetch H3.

### 14.2 F2 Edit Reorder Point

1. Owner/admin membuka `/produk/[kode]` -> "Edit Reorder".
2. Isi nilai (atau "Hapus reorder point" untuk `null`) -> "Simpan".
3. `POST /api/stok/reorder-point` -> validasi -> `setReorderPoint` -> invalidasi cache ->
   `cekDanNotifikasiReorderPoint` -> `catatPerubahanProduk` -> 200.
4. UI menampilkan badge status baru dan (bila ada) toast notifikasi terkirim.

### 14.3 F3 Ubah Role

1. Owner membuka `/admin` -> tabel admin dengan kolom aksi.
2. Pilih role baru pada baris target -> "Simpan" (AlertDialog bila menurunkan owner).
3. `POST /api/admin/role`.
4. Server: `updateRoleAdmin` (Opsi D, default `catatAudit: true` -> audit ditulis DI DALAM model, §8.2) -> 200.
5. UI refetch daftar admin + timeline perubahan peran.

### 14.4 F4 Tambah/Hapus Admin

1. Owner membuka `/pengaturan` -> seksi "Kelola Admin".
2. **Tambah:** "Tambah Admin" -> isi form -> Simpan -> `POST /api/admin/tambah` -> refetch.
3. **Hapus:** tekan ikon hapus pada baris -> AlertDialog konfirmasi -> `POST /api/admin/hapus` -> refetch.

---

## 15. Edge Cases Ringkasan v2

| # | Kasus | Perilaku |
|---|---|---|
| E1 | Dua request ubah role konkuren menurunkan owner terakhir | Terima risiko TOCTOU (§16.2 Q1); audit memungkinkan pemulihan via env |
| E2 | Audit role gagal setelah role berubah | 200 + `peringatan_audit`, log keras, tidak rollback |
| E3 | `catatPerubahanProduk` gagal setelah `updateProduk` sukses | 200 + `peringatan_audit`, log keras, tidak rollback (pola v1 E12) |
| E4 | `setReorderPoint` -> notif gagal | Tulis tetap sukses; `notifikasi_terkirim: false`; log |
| E5 | Tambah admin dengan id sudah ada | 409; dokumen lama tidak tertimpa |
| E6 | Hapus admin yang sedang memakai dashboard | Hapus sukses; user kehilangan tulis seketika, baca <= 1 jam |
| E7 | Owner menghapus dirinya sendiri | 400 |
| E8 | `reorder_point: null` | Sah; notif tidak dikirim; audit mencatat `nilai_baru: null` |
| E9 | HPP = 0 | Sah |
| E10 | Body berisi `changed_by`/`role` dari klien | Diabaikan total; server memakai `sesi.uid` / `ambilAdmin` |
| E11 | Cookie kedaluwarsa saat submit | 401 + toast "Sesi kedaluwarsa. Buka ulang dari Telegram." |
| E12 | Produk non-online diedit HPP | Sah (tidak ada cek `is_online_product`) |
| E13 | `stock/{kode}` belum ada saat set reorder | 404 "Data stok produk belum ada." |
| E14 | Nilai tidak berubah | 200 idempoten; 0 baris audit |

---

## 16. Risiko & Pertanyaan Terbuka

### 16.1 Risiko

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Double-audit role bila Opsi D diimplementasikan tetapi panggilan audit manual di bot tidak dihapus | Timeline `/admin` menampilkan 2 entri per perubahan | Wajib hapus `handleSetRole.js:26-32` pada perubahan yang sama + `test/auditRole.test.js` (B2) yang assert tepat 1 baris |
| R2 | Audit role bocor bila caller lupa (Opsi A, DITOLAK) | Audit 100% gagal; investigasi sulit | Opsi D menegakkan invariant di model (default `catatAudit: true`) + escape hatch eksplisit |
| R3 | TOCTOU owner terakhir (F3/F4) | Bisa mencapai 0 owner | Rate limit + audit + env `SUPER_ADMIN_ID` pemulihan; opsi transaksi (Q1) |
| R4 | Function budget bertambah 5-6 | Melewati batas Hobby bila bertambah lagi | Hitung ulang + bukti `vercel build`; target <= 10 |
| R5 | Mock lebih longgar dari server | Test UI hijau palsu | Mock wajib meniru guard server |
| R6 | `hapusAdmin` tidak memanggil `revokeAccessRequest` di dashboard | User bisa request ulang | Keputusan Q2 |
| R7 | Owner menghapus super admin env | Kehilangan jalur pemulihan | Guard eksplisit §5.3 |
| R8 | Tampilan super admin env bocor ke guest | Data id env terlihat guest | Rules/route staff-only; F5 hanya untuk staff |

### 16.2 Keputusan atas pertanyaan reviewer (Q1-Q7 DITUTUP)

**Q1. Guard transaksional owner-terakhir -> DIPUTUSKAN: TERIMA RISIKO di v2 (tidak ada transaksi).**
`updateRoleAdmin` dan `hapusAdmin` tetap non-transaksional. Risiko TOCTOU diterima sadar. Mitigasi:
rate limit 10/menit + audit `admin_role_changes` + **`SUPER_ADMIN_ID` env sebagai jaring pemulihan**.
**Syarat wajib:** `SUPER_ADMIN_ID` diset di produksi sebelum rilis (masuk DoD §18). Tanpa env, 0 owner
= terkunci permanen. **Ditinjau ulang bila:** jumlah owner aktif > 1 nyata / multi-owner dipakai
bersamaan -> bangun `db.runTransaction`. Lihat §4.3 edge case.

**Q2. Hapus admin -> `revokeAccessRequest` -> DIPUTUSKAN: YA (terverifikasi di kode).** Bot memang
memanggilnya setelah `hapusAdmin` di `lib/handlers/handleRevokeAdmin.js:78`. Route F4b WAJIB melakukan
hal yang sama (urutan: `hapusAdmin` -> `revokeAccessRequest` -> audit pencabutan). Lihat §5.3 & §5.7 #9.

**Q3. Tampilan super admin -> DIPUTUSKAN: read-only status-diri, 0 route baru.** Perluas respons auth
`POST /api/auth/telegram` dengan `superAdmin: boolean` (dari env + role owner), bukan daftar env.
Menyentuh minimal 4 file (B4, §6.2): route auth, `real.ts`, `mock.ts`, `types.ts`. Alasan: paling
sedikit menyentuh file + 0 function baru. Daftar env penuh ditunda; matriks §6.3/§7.1 diselaraskan
(N10) supaya admin tidak melihat id Telegram super admin.

**Q4. UI pembaca `product_changes` -> DIPUTUSKAN: TUNDA ke v3.** Audit `product_changes` TETAP
ditulis di v2 (data historis tidak hilang). UI timeline gabungan (`stock_movements` + `product_changes`)
di H3/`/histori` masuk v3.

**Q5. Konfirmasi aksi berisiko -> DIPUTUSKAN: `AlertDialog`** (komponen shadcn/base-ui). Diterapkan
ke: hapus admin (§5.5/§5.6), ubah role (menurunkan owner, §4.5/§4.6), dan promosi ke owner (konfirmasi
ekstra, §4.3/§4.6).

**Q6. `updated_at` produk saat edit reorder -> DIKONFIRMASI: reorder point HANYA menyentuh koleksi
`stock`.** `setReorderPoint` menulis `stock/{kode}` (`reorder_point`, `last_updated`,
`last_updated_by`); TIDAK memanggil `updateProduk` dan TIDAK mengubah `products.updated_at`.

**Q7. Penamaan field audit -> DIKONFIRMASI INTENTIONAL.** `product_changes` memakai
`nilai_lama`/`nilai_baru` (snake_case Indonesia, koleksi baru); `admin_role_changes` memakai
`old_role`/`new_role` (Inggris, koleksi lama dari bot). **Alasan:** `product_changes` adalah koleksi
baru sehingga bisa mengikuti konvensi penamaan Indonesia user; `admin_role_changes` sudah dipakai bot
dan dashboard `/admin` (`lib/dashboard/types.ts:168-169`) sehingga dipertahankan agar tidak memecah
konsumen. Jangan diseragamkan saat implementasi.

---

## 17. Urutan Implementasi yang Disarankan

Dipisah agar **server/model** dan **UI** bisa didelegasikan paralel. Server dulu (kontrak beku),
UI mock-first (v1 §37/§38). File sentuh minim di awal.

### 17.1 Jalur A - Server & Model (dapat dikerjakan paralel antar-item)

| Langkah | Pekerjaan | File |
|---|---|---|
| A1 | Buat `catatPerubahanProduk` | `lib/models/productChanges.js` (baru) |
| A2 | Buat `setReorderPoint` + ekspos | `lib/models/stok.js` |
| A3 | Ekspor `isSuperAdminDariEnv` | `lib/models/admins.js` |
| **A4 (Opsi D)** | Tambah param `{ catatAudit = true }` ke `updateRoleAdmin` + panggil `catatPerubahanRole` di dalam model; HAPUS audit manual di bot | `lib/models/admins.js`, `lib/handlers/handleSetRole.js` |
| **A4b (B1, WAJIB)** | Fix `admin.id` -> `admin.telegram_user_id` | `lib/reminder/cekReorderPoint.js:47`, `lib/reminder/reminderHarian.js:62` |
| A5 | Route F1 | `app/api/produk/hpp/route.ts` (baru) |
| A6 | Route F2 (BLOKIR oleh A4b) | `app/api/stok/reorder-point/route.ts` (baru) |
| A7 | Route F3 | `app/api/admin/role/route.ts` (baru) |
| **A8** | Route F4a + F4b (F4b: `hapusAdmin` -> `revokeAccessRequest` -> audit SETELAH sukses) | `app/api/admin/tambah/route.ts`, `app/api/admin/hapus/route.ts` (baru) |
| A9 | Rules v2 | `firestore.rules` |
| **A10** | Test server — **WAJIB termasuk `test/auditRole.test.js` baru** (B2) + `test/editProduk.test.js`, `test/reorderPoint.test.js`, `test/adminRole.test.js`, `test/adminKelola.test.js`, `test/superAdmin.test.js` (baru); perbarui `test/reminderHarian.test.js` untuk B1 | file test |

**Gate Jalur A:** `npm test` hijau; tiap route teruji tanpa UI. **Catatan A4/A4b:** test
`test/auditRole.test.js` dan test B1 di `test/reorderPoint.test.js`+`reminderHarian.test.js` WAJIB
GAGAL sebelum fix lalu HIJAU sesudah; A4/A4b tidak boleh di-merge tanpa bukti itu (tidak ada test bot
existing — klaim lama salah, lihat §8.2).

### 17.2 Jalur B - Kontrak Data & Mock (dapat dikerjakan paralel dengan A setelah kontrak §11 disepakati)

| Langkah | Pekerjaan | File |
|---|---|---|
| B1 | Tambah 5 fungsi tulis + `superAdmin` ke interface `DataSource` | `lib/dashboard/data/index.ts` |
| B2 | Implementasi mock + guard tiruan (+ `superAdmin` di `getSession`) | `lib/dashboard/data/mock.ts` |
| B3 | Implementasi real (`fetch` + `superAdmin` di `ambilSesiReal`) | `lib/dashboard/data/real.ts` |
| **B4 (B3)** | Tambah 5 fungsi ke `dataKosong()` — MANUAL, compiler TIDAK menagih (cast `as unknown as DataSource`) | `lib/dashboard/sumber-data.tsx` |
| B5 | Tipe `ProductChangeDoc` + `superAdmin` di `SessionInfo` | `lib/dashboard/types.ts` |
| **B6 (B4)** | Tambah `superAdmin` ke respons auth | `app/api/auth/telegram/route.ts` |

**Gate Jalur B:** `npx tsc --noEmit` bersih (menangkap `real.ts`/`mock.ts`, TIDAK menangkap
`dataKosong`) + verifikasi manual/test key `dataKosong` (§11) + Playwright mock lama tetap hijau.

### 17.3 Jalur C - UI (mulai setelah B1-B5 selesai; UI mock-first)

| Langkah | Pekerjaan | File |
|---|---|---|
| C1 | Dialog + tombol Edit HPP | `components/dashboard/dialog-edit-hpp.tsx`, `app/produk/[kode]/page.tsx` |
| C2 | Dialog + tombol Edit Reorder | `components/dashboard/dialog-edit-reorder.tsx`, `app/produk/[kode]/page.tsx` |
| C3 | Aksi role di H7 | `components/dashboard/aksi-role-admin.tsx`, `app/admin/page.tsx` |
| C4 | Seksi Kelola Admin di H8 | `components/dashboard/kelola-admin.tsx`, `components/dashboard/dialog-tambah-admin.tsx`, `app/pengaturan/page.tsx` |
| C5 | Seksi read-only status super admin (Q3 + copy keterbatasan env, B4) | `app/pengaturan/page.tsx` (+ komponen kecil) |
| C6 | Test Playwright v2 (matriks izin baru, dialog, error state) | `e2e/*.spec.ts` (baru) |

### 17.4 Urutan penggabungan

1. Jalur A selesai & `npm test` hijau.
2. Jalur B selesai & typecheck bersih.
3. Jalur C selesai & Playwright mock hijau.
4. Integrasi: set `NEXT_PUBLIC_DASHBOARD_DATA=real`, smoke manual Mini App (mengikuti v1 §37 C4)
   ditambah checklist v2: edit HPP, edit reorder (-> assert notifikasi benar terkirim, B1),
   ubah role (-> cek timeline `/admin` bertambah, TIDAK double), tambah admin, hapus admin (guard +
   `revokeAccessRequest`), cek status super admin tampil + copy keterbatasan env (B4), dan pastikan
   `SUPER_ADMIN_ID` diset di produksi (Q1).

---

## 18. Definition of Done v2

- Semua kontrak route §2.3, §3.3, §4.3, §5.3 diimplementasikan persis (path, status, pesan).
- `npm test` hijau termasuk test baru §2.7, §3.7, §4.7, §5.7, §6.5 **dan `test/auditRole.test.js`**.
- **B1 (bug notifikasi, WAJIB):** `lib/reminder/cekReorderPoint.js:47` dan
  `lib/reminder/reminderHarian.js:62` memakai `admin.telegram_user_id` (bukan `admin.id`); test yang
  assert `kirimPesan` menerima id valid GAGAL sebelum fix dan HIJAU sesudah.
- **Audit role (Opsi D):** `updateRoleAdmin` menghasilkan **tepat 1** baris `admin_role_changes`;
  `handleSetRole` juga **tepat 1** (tidak double); guard gagal -> 0 baris. Dibuktikan
  `test/auditRole.test.js` baru (test bot existing TIDAK ada — klaim lama salah).
- `product_changes` mencatat HPP/HPP baru/reorder point: 1 baris per field yang berubah, `changed_by`
  selalu `sesi.uid` (string).
- **F4b:** audit pencabutan ditulis SETELAH `hapusAdmin` sukses, dan `revokeAccessRequest` terpanggil
  (paritas bot); hapus gagal -> 0 baris audit (N5).
- **F5:** `getSession()` (mock & real) mengembalikan `superAdmin: boolean`; UI menampilkan copy
  keterbatasan env (B4).
- Guard eksplisit §9 terbukti dengan test: hapus diri sendiri, hapus owner terakhir, hapus super admin
  env, tambah duplikat, ubah role diri sendiri, turunkan owner terakhir.
- **401 mid-write (v1 §11.2):** minimal 1 route tulis v2 diuji e2e -> toast + tombol "Buka ulang" +
  isian form DIPERTAHANKAN di memori; dialog TIDAK ditutup.
- Semua route tulis: origin + sesi + rate limit + role dari `ambilAdmin` + log sukses/reject.
- Rules `product_changes` ter-deploy: guest `permission-denied`, tulis client ditolak.
- Playwright (mock) hijau: tombol aksi tampil sesuai role, dialog sukses (termasuk AlertDialog
  konfirmasi), error state terlihat.
- `vercel build` <= 12 function dengan bukti log (hitungan route aktual + 5).
- **`SUPER_ADMIN_ID` diset di produksi sebelum rilis** (syarat Q1).
- Smoke manual Mini App nyata lulus untuk kelima fitur.
- Tidak ada fitur non-goals v2 yang terimplementasi (role baru, theme per-user, tulis client SDK).

---

## 19. Daftar File (ringkas, untuk delegasi)

**Model / route server**
- `lib/models/productChanges.js` (baru)
- `lib/models/stok.js` (tambah `setReorderPoint`)
- `lib/models/admins.js` (Opsi D: param `{ catatAudit = true }` + panggil `catatPerubahanRole` di dalam
  `updateRoleAdmin`; ekspor `isSuperAdminDariEnv`)
- `lib/handlers/handleSetRole.js` (hapus `catatPerubahanRole` manual — Opsi D)
- `lib/reminder/cekReorderPoint.js`, `lib/reminder/reminderHarian.js` (**B1:** `admin.id` ->
  `admin.telegram_user_id`)
- `app/api/produk/hpp/route.ts` (baru)
- `app/api/stok/reorder-point/route.ts` (baru)
- `app/api/admin/role/route.ts` (baru)
- `app/api/admin/tambah/route.ts` (baru)
- `app/api/admin/hapus/route.ts` (baru)
- `app/api/auth/telegram/route.ts` (**B4:** tambah `superAdmin` ke respons)

**Kontrak data**
- `lib/dashboard/data/index.ts`, `lib/dashboard/data/mock.ts`, `lib/dashboard/data/real.ts`
- `lib/dashboard/types.ts` (`ProductChangeDoc` + `superAdmin` di `SessionInfo`)
- `lib/dashboard/sumber-data.tsx` (`dataKosong`, **B3:** tambah manual; compiler tidak menagih)

**UI**
- `app/produk/[kode]/page.tsx`, `app/admin/page.tsx`, `app/pengaturan/page.tsx`
- `components/dashboard/dialog-edit-hpp.tsx`, `dialog-edit-reorder.tsx`, `aksi-role-admin.tsx`,
  `kelola-admin.tsx`, `dialog-tambah-admin.tsx`, `konfirmasi-hapus-admin.tsx` (baru)
- `AlertDialog` konfirmasi (Q5) dipakai di aksi role + hapus admin + promosi owner

**Rules**
- `firestore.rules` (`product_changes`)

**Test**
- `test/editProduk.test.js`, `test/reorderPoint.test.js`, `test/adminRole.test.js`,
  `test/adminKelola.test.js`, `test/superAdmin.test.js`, **`test/auditRole.test.js`** (baru, B2)
- `test/reminderHarian.test.js` (diperbarui untuk B1)
- E2E Playwright v2 (baru; termasuk 401 mid-write)
