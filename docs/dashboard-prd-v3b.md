# PRD Addendum v3b - Dashboard Bot Admin Toko (Sinkron Dua Arah Bot <-> Dashboard: A7 + A5 + A2)

> Status: **ADDENDUM** untuk `docs/dashboard-prd.md` (v1), `docs/dashboard-prd-v2.md` (v2), dan
> `docs/dashboard-prd-v3a.md` (v3a, SUDAH RILIS). Dokumen ini TIDAK menggantikan v1/v2/v3a. Semua
> keputusan v1/v2/v3a tetap berlaku kecuali yang diubah eksplisit di sini. Pola v3a (route gabungan
> diskriminator `aksi`, state UI, matriks izin, audit) **diacu**, tidak diulang.
>
> Referensi acuan (dibaca, bukan disalin): v3a S5 (kontrak route + auth), v3a S6.4/S6.5 (route
> gabungan `/api/admin` + trade-off budget), v3a S7 (matriks izin addendum), v3a S9 (audit),
> v3a S13/S14 (wave/DoD), v2 S11 (data-access), v2 S12 (state UI/401).
>
> Bahasa produk: Bahasa Indonesia. Penulis: PRD specialist. Konsumen: agent server/model + agent UI/UX.
>
> **Lingkup tunggal dokumen ini: v3b.** 3 fitur: A7 (approve/tolak permintaan akses),
> A5 (tambah produk baru), A2 (konfirmasi draft bot dari dashboard). A2 menempati **FASE TERPISAH**
> (lihat S13) dan WAJIB dieksekusi setelah A7+A5 stabil. **Picking list dikonfirmasi PER BATCH**
> (satu sesi `pendingPickingList` = satu unit), bukan per-draft (S5.4/S8.2).

---

## 0. Changelog revisi (v3b -> v3b-r1, 2026-09-16)

Revisi berdasarkan `docs/dashboard-prd-v3b-review.md`. **6 blocking ditutup.** Semua klaim reviewer
diverifikasi ulang ke kode; temuan reviewer AKURAT.

| # | Blocking | Perbaikan | Section |
|---|---|---|---|
| B1 | Picking list per-draft salah; sesi menyimpan BANYAK movement (`konfirmasiPickingList.js:44,70,100`) | Model UI = **batch picking list**; konfirmasi memproses seluruh batch; hapus klaim guard per-movement | S5.4, S8.2, S10.3 |
| B2 | Bot tidak membaca guard; race dashboard<->Telegram tidak tertutup | **Bot WAJIB baca guard** `draft_kirim_guard` sebelum apply; guard 10s jadi lintas-jalur | S8.2, S8.5, S6 |
| B3 | Fungsi bot early-return SENYAP -> 200 palsu | Return eksplisit `{ ok, alasan }` di 3 fungsi + pemanggil disesuaikan | S6.1, S6.6 |
| B4 | A7 409 non-atomik (TOCTOU) | `runTransaction` compare-and-set di model `accessRequests` | S5.2 |
| B5 | A5 `simpanProduk` merge menimpa | **Create-only transaksional** di route | S5.3 |
| B6 | State 401 mid-write tanpa mekanisme | Tabel state UI + helper `tampilkanGagalTulis` + acceptance 401 | S10.4, S19 |

Non-blocking sekalian: N1 (buang `owner_user_id` dari body), N2 (jangan ubah call site lama),
N4 (rate limit bucket dipisah), N5 (`resolved_via` ditunda), N7 (filter picking di memori),
aturan draft LAMA fail-closed, skenario balasan Telegram atas draft yang sudah dashboard-proses.

---

## 1. Ringkasan

v3b menutup 3 lubang alur yang saat ini hanya bisa diselesaikan lewat bot Telegram, dengan tetap
mematuhi **BATASAN KERAS budget function = 11/12 (sisa margin 1)**. Karena margin hanya 1, SELURUH
aksi v3b dititipkan ke route gabungan `POST /api/admin` yang **sudah ada** (`app/api/admin/route.ts`,
112 baris, komentar baris 3: "Aksi v3b menyusul di route yang sama"). **TIDAK ADA route baru.**

| # | Fitur | Role (S5) | Halaman | Route | Prioritas |
|---|---|---|---|---|---|
| F1 | A7 - Setujui/Tolak permintaan akses | owner only | `/admin` (seksi Permintaan Akses) | aksi `approve-akses`/`tolak-akses` di `POST /api/admin` | 1 (paling murah) |
| F2 | A5 - Tambah produk baru | owner + admin | `/stok` (dialog baru) | aksi `tambah-produk` di `POST /api/admin` | 2 |
| F3 | A2 - Konfirmasi draft dari dashboard (opname/picking batch/sync) | owner semua; admin draft sendiri | `/draft` (read-only -> interaktif) | aksi `konfirmasi-draft` di `POST /api/admin` | 3 (paling berisiko) |

### 1.1 Latar belakang (kebocoran fungsional terverifikasi)

1. **A7 (permintaan akses).** Halaman `/admin` (`app/admin/page.tsx:224-272`) menampilkan seksi
   "Permintaan Akses" dengan `deskripsi="Permintaan akses masuk. Tinjau dari Telegram."` (`:227`) dan
   **nol tombol aksi**. Satu-satunya jalur menyetujui adalah inline callback bot
   (`handleApprovalCallback.js:109-155`). Bila owner tidak sedang membuka Telegram, antrean request
   menggantung.
2. **A5 (tambah produk baru).** `tambahProdukBaru` hanya bisa dipicu lewat chat Gemini
   (`chatHandler.js:953-984`). Tidak ada jalur UI. Akibat: menambah produk dari dashboard (mis. saat
   admin sedang meninjau stok minus) mustahil tanpa pindah ke bot.
3. **A2 (konfirmasi draft).** `/draft` (`app/draft/page.tsx`) read-only; tiap kartu hanya render
   tombol **"Tinjau di Telegram"** (`:210-230`). Draft opname/sync hanya bisa di-apply dengan membalas
   `ya` di chat. Ini memaksa admin operasional mengetik di Telegram sambil melihat dashboard.

### 1.2 Non-goals v3b (jangan diimplementasikan)

- **Route baru apa pun.** Margin function sisa 1; route baru = 12/12 = habis, dan setiap fitur
  berikutnya gagal deploy. Lihat S4.1.
- **Mengubah perilaku bot produksi.** Opsi `{ kirimNotifikasi:false }` (S6) WAJIB backward-compatible
  (default `true`); urutan mutasi bot tidak berubah. Baca guard (B2) + return bernilai (B3) adalah
  perubahan ADDITIVE yang diuji tidak mengubah perilaku jalur lama.
- Approve/revoke admin (F3/F4 v2) di halaman ini - sudah ada, tidak disentuh.
- Menambah kolom/field skema besar pada koleksi bot kecuali audit + penanda kepemilikan draft (S7).
- `tambahProdukBaruBatch` dari UI (v3b hanya produk baru **satuan**; batch tetap bot-only).
- Edit/hapus produk, edit draft mentah, ubah penanda, ubah qty draft dari dashboard.
- Notifikasi Telegram ke owner saat draft dikonfirmasi dari dashboard (keputusan S6.4).
- Sesi/state bot, command bot, runtime Gemini - TIDAK disentuh selain opsi baru di S6.
- Role baru / permission custom / tulis Firestore langsung dari client.

---

## 2. Persona, JTBD, dan user story

Persona & JTBD diwarisi dari v1 S8/S9 + v3a S2: owner (Budi), admin operasional.

### 2.1 F1 - A7 Permintaan Akses

> Sebagai **owner**, saya mau menyetujui atau menolak permintaan akses langsung dari dashboard,
> supaya saya tidak harus membuka Telegram untuk meng-unblock user baru.

- US-F1-1: Sebagai owner, saya mau melihat hanya permintaan berstatus `pending` yang butuh keputusan.
- US-F1-2: Sebagai owner, saya mau menekan "Setujui" dengan satu konfirmasi, supaya salah-tap tidak
  langsung mengubah akses.
- US-F1-3: Sebagai owner, saya mau user yang saya setujui menerima pesan "kenalan" yang identik
  dengan jalur bot, supaya alur tidak putus di tengah.

### 2.2 F2 - A5 Tambah Produk Baru

> Sebagai **admin/owner**, saya mau mendaftarkan produk baru dari halaman stok, supaya produk yang
> belum ada di Accurate bisa langsung dipakai bot tanpa pindah ke chat.

- US-F2-1: Sebagai admin, saya mau mengisi `kode_barang` (wajib, sama persis kode Accurate),
  `nama_produk` (wajib), `hpp` dan `stok_awal` (opsional), lalu menekan "Tambah Produk".
- US-F2-2: Sebagai admin, saya mau ditolak jelas bila kode sudah dipakai produk lain.
- US-F2-3: Sebagai admin, saya mau produk baru otomatis `is_online_product: true` dan muncul di
  daftar stok tanpa reload manual.

### 2.3 F3 - A2 Konfirmasi Draft

> Sebagai **owner/admin**, saya mau meng-apply draft opname/picking/sync langsung dari dashboard,
> supaya pekerjaan meninjau draft selesai tanpa mengetik di Telegram.

- US-F3-1: Sebagai owner, saya mau mengonfirmasi **semua** draft (punya siapa pun).
- US-F3-2: Sebagai admin, saya mau mengonfirmasi **hanya draft yang saya buat sendiri**.
- US-F3-3: Sebagai pemakai, saya mau draft yang sudah diproses hilang dari daftar pending dan tidak
  bisa diproses dua kali.
- US-F3-4: (Sync) Saya mau meng-acc **per kelompok** kondisi (`sheets_ketinggalan`/`sheets_manual`/
  `konflik`/`produk_baru`) atau semua.
- US-F3-5: (Picking) Saya mau mengonfirmasi **satu batch** picking (semua movement dari satu
  screenshot) sebagai satu unit, dengan ringkasan berapa item diproses dan berapa dilewati.
---

## 3. Verifikasi kode (WAJIB dibaca sebelum implementasi)

Semua klaim di bawah diverifikasi langsung ke kode pada 2026-09-16 (dan diverifikasi ULANG saat
revisi v3b-r1). **Jangan riset ulang.**

### 3.1 Apakah draft menyimpan identitas pembuat? (JAWABAN)

| Koleksi | Field pembuat? | Bukti |
|---|---|---|
| `opname_drafts` | **TIDAK** | `handleOpname.js:176-181` hanya menulis `{ items, status, created_at }` |
| `sync_stok_drafts` | **TIDAK** | `syncStokDuaArah.js:207-213` hanya menulis `{ kondisi, items, index_kolom, status, created_at }` |
| `stock_movements` (picking list) | **YA** | `handleScreenshotPickingList.js:131` menulis `created_by: telegramUserId`; `catatPergerakanStok` juga mengisi `requested_by` (`stockMovements.js:67`) |

**Konsekuensi (A2 perlu cara mendapat `owner_user_id`):**
- **Picking list**: pemilik = `stock_movements/{movementId}.created_by` (atau `.requested_by`). TERSEDIA.
- **Opname & sync**: TIDAK tersedia di draft. Satu-satunya sumber pemilik adalah
  `sessions/{telegramUserId}.pendingOpname` / `.pendingSyncStok` - **doc id `sessions` ADALAH
  `telegramUserId`** (`handleOpname.js:188` menulis `.doc(String(telegramUserId))`, `syncStokDuaArah.js:220-224` idem).
  Jadi `owner_user_id` = doc id sesi yang `pendingOpname.draftId` / `pendingSyncStok.draftIds` memuat draft itu.

**KEPUTUSAN A2-5 (final, lihat S7.2):** `owner_user_id` WAJIB ditulis ke draft opname/sync saat
draft dibuat (additive di bot, 2 titik `add()`), supaya client bisa membacanya tanpa membuka
`sessions` (client DILARANG baca `sessions`, `firestore.rules:37`). Untuk picking, `owner_user_id`
sudah tersedia via `stock_movements.created_by` - TIDAK diubah. Risiko: menyentuh 2 titik bot
produksi (diterima & dibatasi; additive murni, tidak mengubah percabangan). **Test regresi WAJIB:
bot tetap menulis `owner_user_id` (R-E).**

**KEPUTUSAN A2-1 (DIBATALKAN oleh A2-5):** usulan awal "tidak menambah field, resolve dari
`sessions`" tidak layak karena client tidak boleh membaca `sessions` (bocor history AI + state
internal) dan query nested field mahal/butuh index. Lihat S7.2 untuk detail final.

**Alternatif yang DITOLAK:** (a) menambah field di bot = regresi + sentuh handler produksi;
(b) query koleksi `sessions` by nested field (`where("pendingOpname.draftId","==",id)`) = butuh
index composite + 1 read collection / draft = mahal, dan TIDAK didukung bila `pending*` sudah dihapus.

### 3.2 Fungsi bot yang punya efek samping Telegram + baca state sesi

| Fungsi | File:baris | Efek Telegram | Baca sesi |
|---|---|---|---|
| `konfirmasiOpname(telegramUserId, teksJawaban, confirmedBy)` | `handleOpname.js:209` | `:221,226,267` kirim ke `chatId` dari `sessions/{tuid}.pendingOpname` | ya (`:211-212`) |
| `konfirmasiPickingList(telegramUserId, teksJawaban, {sumber, confirmedBy})` | `konfirmasiPickingList.js:37` | `:53,61,103` | ya (`:39-40`) |
| `konfirmasiSyncStok(telegramUserId, teksJawaban, confirmedBy)` | `syncStokDuaArah.js:332` | `:344,350,362,381` | ya (`:334-335`) |

Ketiganya mengambil `chatId` DARI state sesi, bukan dari argumen. Karena itu, saat dikonfirmasi dari
dashboard, `telegramUserId` yang dikirim WAJIB = pemilik draft (S3.1), agar state sesi yang dibaca
benar dan `owner_user_id` yang diidentifikasi cocok.

### 3.3 Logika kelompok `konfirmasiSyncStok` (WAJIB ditiru dashboard)

`syncStokDuaArah.js:358-379`: bila `kondisiDipilih !== "semua"`, hanya draft kelompok itu yang di-`apply`.
- Bila masih ada sisa: `pendingSyncStok` **TETAP ADA** dengan `draftIds` sisa (`:377-379`), status draft
  yang sudah diproses -> `"processed"` (`:419,457`).
- Bila sisa kosong: `pendingSyncStok` dihapus (`:376`).
- `KONDISI` (`:26-32`): `sheets_ketinggalan`, `sheets_manual`, `konflik`, `produk_baru`.
- `tentukanKondisiDariJawaban` (`:387-394`) hanya mengenali string `"ya <kondisi>"`/`"ya semua"`.

**KEPUTUSAN A2-2 (final):** dashboard mengirim `teksJawaban` PERSIS bentuk yang dikenali
`tentukanKondisiDariJawaban` (`"ya sheets_ketinggalan"` dst., atau `"ya semua"`). JANGAN mengubah
fungsi bot. Untuk kelompok, dashboard memanggil `konfirmasiSyncStok` SEKALI per kelompok yang dipilih
(atau sekali `"ya semua"`). JANGAN menghapus seluruh `pendingSyncStok` dari dashboard.

### 3.4 Draft status & guard idempotensi saat ini

- Draft dibuat `status: "pending_confirmation"` (`handleOpname.js:178`, `syncStokDuaArah.js:211`);
  picking list memakai `stock_movements.status` (`handleScreenshotPickingList.js:130`).
- Draft di-set `"processed"` setelah apply (`handleOpname.js:263`, `syncStokDuaArah.js:419,457`).
- **TIDAK ada guard idempotensi eksplisit**: `konfirmasiOpname`/`konfirmasiSyncStok` di awal hanya
  cek `pending*` ADA (`handleOpname.js:213`, `syncStokDuaArah.js:336`). Bila `pending*` sudah dibersihkan
  bot tapi dipanggil ulang, fungsi berhenti senyap (`return`) - bukan error. Bila `pending*` masih ada
  dan draft sudah `processed`, `konfirmasiOpname` akan apply ULANG item yang sama (idempoten hanya
  karena `timpaStokOpname` menimpa nilai; tapi movement audit tetap double). Untuk picking,
  `konfirmasiPickingList` mengurangi stok ULANG bila `pendingPickingList` masih ada.
- **Early return SENYAP (B3, terverifikasi):** ketiga fungsi `return` TANPA sinyal saat `pending*`
  tidak ada: `handleOpname.js:213` (`if (!pending) return;`), `syncStokDuaArah.js:336` (idem),
  `konfirmasiPickingList.js:42` (`if (!pending) return false;`). Route dashboard yang memanggil fungsi
  ini akan melihat "sukses" padahal tidak ada mutasi -> 200 palsu. **KEPUTUSAN B3:** ketiga fungsi
  WAJIB mengembalikan nilai eksplisit (S6.1/S6.6).
- **Picking = BATCH (B1, terverifikasi):** `sessions.pendingPickingList` menyimpan SATU array
  `movementIds` (`handleScreenshotPickingList.js:66`), dan `konfirmasiPickingList` memproses SEMUA id
  dalam array itu sekaligus (`:70` ambil semua, `:81-98` loop apply, `:100` hapus seluruh sesi). BUKAN
  "satu draft_id = satu konfirmasi". **KEPUTUSAN B1:** unit konfirmasi picking = SATU BATCH (S5.4/S8.2).
- **A5 race (B5, terverifikasi):** `chatHandler.js:621-624` punya race guard (`throw` bila kode sudah
  ada) SEBELUM `simpanProduk`; `simpanProduk` sendiri `set(payload, { merge: true })` (`produk.js:83`)
  = menimpa bila dokumen sudah ada. Route dashboard WAJIB menyalin paritas ini secara ATOMIK (S5.3).
- **A7 tanpa guard atomik (B4, terverifikasi):** `setujuiAccessRequest` (`accessRequests.js:31`) dan
  `tolakAccessRequest` (`:42`) hanya `update()` tanpa cek `status`. Cek bot `handleApprovalCallback.js:101`
  terpisah & non-atomik. Route WAJIB transaksional (S5.2).
- **Implikasi:** guard idempotensi v3b WAJIB diletakkan di route/dashboard DAN di bot (S8), BUKAN
  mengandalkan urutan cek-lalu-tulis.

### 3.5 Route & budget function (terverifikasi)

- `app/api/**/route.ts` = **10** (admin, admin/hapus, admin/role, admin/tambah, auth/telegram,
  pengaturan/ai, permintaan, produk/hpp, stok/mutasi, stok/reorder-point) + `api/webhook.js` = **11/12**.
- Sisa margin = **1**. v3b TIDAK menambah route.

---

## 4. Kontrak route v3b (BATASAN KERAS)

### 4.1 Keputusan route: TITIP di `POST /api/admin` (final)

- **Path:** tetap `POST /api/admin` (`app/api/admin/route.ts`). **NOL route baru.**
- v3a mengimplementasikan aksi `kata-kunci`. v3b MENAMBAH aksi ke diskriminator `aksi` yang sama:
  `approve-akses`, `tolak-akses`, `tambah-produk`, `konfirmasi-draft`.
- **Dampak budget function:** **11/12 tetap** setelah v3b (route tidak bertambah). Sisa margin tetap 1.
- **Bila kelak terpaksa route baru** (mis. A2 terlalu kompleks untuk satu route): 12/12 -> **habis**,
  dan deploy berikutnya + fitur apa pun akan gagal (Vercel Hobby 12 function). Konsekuensi ini
  dicatat sebagai OQ-1; TIDAK diambil kecuali diminta eksplisit.
- **Konsekuensi kohesi:** satu route menangani 5 aksi berbeda. Diterima karena pola diskriminator
  `aksi` sudah ditetapkan v3a (S6.4) dan sudah dipakai `/api/permintaan` (4 aksi).

### 4.2 Validator

Tambah fungsi baru di `lib/dashboard/validasiTulisV3a.js` (pola existing, CJS murni tanpa I/O):
- `validasiAksiAdminV3b(body)` -> `{ ok, status, aksi, ... }` atau `{ ok:false, status, error }`.
  Dispatcher yang memanggil validator per aksi: `validasiApproveAkses`, `validasiTambahProduk`,
  `validasiKonfirmasiDraft`.
- **PENTING:** `validasiAksiAdmin` lama (v3a) mengembalikan 400 `"Aksi tidak dikenal."` untuk aksi
  apa pun selain `kata-kunci` (`validasiTulisV3a.js:128`). v3b WAJIB memperluasnya agar aksi v3b
  tidak ditolak 400. **KEPUTUSAN:** ubah `validasiAksiAdmin` menjadi dispatcher yang mengenali
  `kata-kunci` + 4 aksi v3b; aksi di luar daftar tetap 400 `"Aksi tidak dikenal."`. Ini SATU titik
  perubahan di validator (test lama v3a aksi `kata-kunci` HARUS tetap hijau).
- **Body `konfirmasi-draft` TIDAK menerima `owner_user_id`** (N1). Field itu diambil dari DRAFT
  (server-side), bukan dari body; bila dikirim di body, DIABAIKAN (dokumentasi kontrak, bukan hanya
  komentar) - mencegah pemalsuan identitas via body.

### 4.3 Urutan guard route (wajib dipertahankan)

`tolakOrigin` -> cookie `dat_sesi` -> `verifikasiTokenSesi` -> parse body -> validasi `aksi` ->
**`cekRateLimit(bucket)`** (bucket sesuai `aksi`, tabel di bawah) -> `ambilAdmin` (role dari Firestore,
BUKAN sesi/body) -> guard role per aksi -> model -> `console.info`. Basis: `app/api/admin/route.ts:31-98`.
**Perubahan v3b:** `cekRateLimit` DIPINDAH ke SETELAH `aksi` diketahui (agar bucket dipilih per jenis).
`tolakOrigin`/cookie/`verifikasiTokenSesi`/`ambilAdmin` TETAP di posisi asal.

**KEPUTUSAN F17 (rate limit, final):** **bucket DIPISAH**, bukan satu bucket 40. Karena A2 memanggil
Sheets (mahal + kuota), bucket tunggal berarti spam `tambah-produk` (murah) bisa memakan kuota A2.

| Bucket | Kunci | Aksi | Batas |
|---|---|---|---|
| A - admin | `admin:{uid}:aksi` | `kata-kunci`, `approve-akses`, `tolak-akses`, `tambah-produk` | 40/menit |
| B - draft | `admin:{uid}:draft` | `konfirmasi-draft` | 20/menit |

Alasan batas 20 untuk bucket draft: tiap `konfirmasi-draft` menyentuh Firestore + (sync/picking)
Sheets; 20/menit = 1 aksi per 3 detik, cukup untuk operator manusia dan membatasi abuse. Klaim tetap
"per uid per 60 detik per instance" (soft in-memory, tidak reliabel lintas lambda - konsisten v3a #5).
`cekRateLimit` dipanggil SETELAH `aksi` diketahui dari body (muat ulang bucket sebelum kunci lease).

### 4.4 Tabel error umum (semua aksi v3b)

| Cek | Status | `error` |
|---|---|---|
| `tolakOrigin` gagal | 403 | `"Origin tidak diizinkan."` |
| cookie/sesi invalid | 401 | `"Sesi kedaluwarsa. Buka ulang dari Telegram."` (persis `SESI_KEDALUWARSA`) |
| rate limit | 429 | `"Terlalu banyak permintaan. Coba lagi sebentar lagi."` |
| body bukan JSON | 400 | `"Body tidak valid."` |
| `aksi` kosong/bukan string/di luar daftar | 400 | `"Aksi tidak dikenal."` |
| `ambilAdmin` null | 403 | `"Akses ditolak. Hubungi owner."` |
| role guest (untuk semua aksi tulis v3b) | 403 | `"Akses ditolak. Hubungi owner."` |
| model throw (Firestore/Sheets) | 500 | pesan per aksi (tabel di bawah) |

**Guard interpretasi (WAJIB, testable):** bila `runTransaction` gagal KARENA error tidak terduga
(bukan sentinel `SUDAH_DIPROSES`/`TIDAK_ADA`), route LOG lalu LANJUT aksi sah (`console.error("[draft_guard_failed]")`),
TIDAK memblokir operasi. Diuji dengan mock `runTransaction` yang `throw` (mengharapkan aksi tetap jalan).

---

## 5. Kontrak aksi v3b di `POST /api/admin`

### 5.1 Tabel aksi (ringkas)

| `aksi` | Body field | Role | Status sukses | Pesan error identitas |
|---|---|---|---|---|
| `approve-akses` | `target_user_id` | owner | 200 | 403 `"Hanya owner yang dapat memproses permintaan akses."` |
| `tolak-akses` | `target_user_id` | owner | 200 | idem |
| `tambah-produk` | `kode_barang`, `nama_produk`, `hpp?`, `stok_awal?` | owner + admin | 200 | 403 `"Akses ditolak. Hubungi owner."` |
| `konfirmasi-draft` | `jenis`, `draft_id`, `aksi_draft` (+ `kondisi?`) | owner (semua) / admin (draft sendiri) | 200 | 403 `"Hanya owner atau pembuat draft yang dapat mengonfirmasi."` |

Catatan: `owner_user_id` TIDAK pernah diterima dari body (N1); nilai diambil dari draft (S7.3).
### 5.2 Aksi `approve-akses` / `tolak-akses` (F1/A7)

**Body:**
```json
{ "aksi": "approve-akses", "target_user_id": "123456789" }
{ "aksi": "tolak-akses", "target_user_id": "123456789" }
```

**Validasi:**

| Cek | Status | `error` |
|---|---|---|
| `target_user_id` bukan string digit (`/^\d+$/`) | 400 | `"User ID Telegram tidak valid."` |
| role != owner | 403 | `"Hanya owner yang dapat memproses permintaan akses."` |
| request tidak ada | 404 | `"Permintaan akses tidak ditemukan."` |
| request status != `pending` (sudah diproses) | **409** | **`"Request ini sudah diproses sebelumnya."`** (paritas `handleApprovalCallback.js:103`) |
| model throw (selain sentinel) | 500 | `"Gagal memproses permintaan akses."` |

**KEPUTUSAN B4 (guard 409 ATOMIK, final):** cek status tidak boleh cek-lalu-tulis (TOCTOU). Model
`setujuiAccessRequest`/`tolakAccessRequest` (`accessRequests.js:31,42`) WAJIB diubah memakai
`db.runTransaction`: di dalam transaksi BACA `access_requests/{id}`, lalu tulis `approved`/`rejected`
HANYA bila `status === "pending"` (compare-and-set). Bila bukan `pending`, batalkan transaksi & lempar
error terkontrol `Error("SUDAH_DIPROSES")`. Route memetakan error itu ke **409
`"Request ini sudah diproses sebelumnya."`**.

- **Kontrak fungsi (setelah v3b):** `setujuiAccessRequest(id, by)` / `tolakAccessRequest(id, by)`
  mengembalikan dokumen hasil bila sukses; `throw new Error("SUDAH_DIPROSES")` bila status != `pending`;
  `throw new Error("TIDAK_ADA")` bila dokumen tidak ada (route -> 404 `"Permintaan akses tidak ditemukan."`).
- **Backward-compat:** pemanggil existing = bot `handleApprovalCallback.js:101` yang SUDAH cek
  `req.status !== "pending"` SEBELUM memanggil; guard baru = defense-in-depth (di jalur bot, setelah cek
  lama, status masih `pending` -> sukses). Verifikasi grep: TIDAK ada call site lain (S15).
- **Test:** T1b (dua approve paralel `Promise.all` -> tepat satu sukses, satu 409; `resolved_by` sekali tulis).

**Perilaku sukses (`approve-akses`):**
1. `setujuiAccessRequest(target_user_id, sesi.uid)` (`accessRequests.js:31`, sekarang transaksional) - `resolved_by = sesi.uid`.
2. **Notifikasi Telegram ke user target** (KEPUTUSAN S6.1): kirim
   `"Sudah disetujui! Boleh kenalan dulu, namanya siapa?"` (`handleApprovalCallback.js:125`, literal)
   via `kirimPesan(target_user_id, teks)` - sama persis teks bot.
3. Sukses 200: `{ ok: true, target_user_id, status: "approved", notifikasi_terkirim: boolean }`.

**Perilaku sukses (`tolak-akses`):**
1. `tolakAccessRequest(target_user_id, sesi.uid)` (`accessRequests.js:42`, sekarang transaksional) - set `rejected_until` +1 jam.
2. **Notifikasi Telegram** (KEPUTUSAN S6.1): kirim `PESAN_TOLAK_HALUS`
   (`handleAksesBaru.js:21` = `"Maaf, saat ini belum bisa saya bantu ya."`).
3. Sukses 200: `{ ok: true, target_user_id, status: "rejected", notifikasi_terkirim: boolean }`.

**Kegagalan kirim Telegram:** TIDAK rollback status (paritas bot `handleApprovalCallback.js:127-131`
menganggap gagal notif tidak fatal); balas 200 dengan `notifikasi_terkirim: false`; `console.error("[admin_approve_notif_gagal]", ...)`.

**Catatan alur "kenalan" (`handleAksesBaru.js`):** setelah approve, user target masih harus menjawab
nama di Telegram; bot memakai `apakahMenungguKenalan` (`:79-82`, `access_requests.status==="approved"`)
lalu `lanjutkanKenalan` (`:87`) untuk memasukkan user ke `admins` (role guest). Dashboard TIDAK
menyentuh alur ini - hanya `access_requests`; user tetap wajib "kenalan" di Telegram. Konsekuensi:
approve dari dashboard TIDAK langsung membuat user jadi admin; langkah kenalan tetap di Telegram.
Ini dicatat sebagai perilaku eksplisit (bukan bug).

### 5.3 Aksi `tambah-produk` (F2/A5)

**Body:**
```json
{ "aksi": "tambah-produk", "kode_barang": "BRG-999", "nama_produk": "Mangkok Tulip", "hpp": 15000, "stok_awal": 12 }
```
`hpp` dan `stok_awal` opsional. `stok_awal` absen -> 0 (paritas bot `stokAwal || 0`, `chatHandler.js:959`).

**Validasi:**

| Cek | Status | `error` |
|---|---|---|
| `kode_barang` bukan string / kosong setelah trim | 400 | `"Kode barang wajib diisi."` |
| `kode_barang` > 60 char | 400 | `"Kode barang maksimal 60 karakter."` |
| `nama_produk` bukan string / kosong setelah trim | 400 | `"Nama produk wajib diisi."` |
| `nama_produk` > 120 char | 400 | `"Nama produk maksimal 120 karakter."` |
| `hpp` ada tapi bukan integer >= 0 | 400 | `"HPP harus bilangan bulat >= 0."` |
| `stok_awal` ada tapi bukan integer >= 0 | 400 | `"Stok awal harus bilangan bulat >= 0."` |
| `stok_awal` > 1.000.000 | 400 | `"Stok awal maksimal 1.000.000."` |
| role guest | 403 | `"Akses ditolak. Hubungi owner."` |
| kode sudah dipakai produk lain | **409** | **`kode "${kode}" sudah dipakai produk lain`** (paritas `chatHandler.js:623`, literal) |
| model throw | 500 | `"Gagal menambah produk."` |

**KEPUTUSAN B5 (write atomic eksklusif, final):** BUKAN "baca dulu, kalau ada 409". Route memakai
`db.runTransaction`:
1. Di dalam transaksi: `trx.get(products/{kode})`. Bila `exists` -> batalkan & lempar
   `Error("KODE_SUDAH_ADA")` (route -> **409** `kode "${kode}" sudah dipakai produk lain`).
2. Bila belum ada: `trx.set(products/{kode}, payload)` (create) DAN `trx.set(stock/{kode}, payloadStok)`
   (create) dalam transaksi yang SAMA.
Ini menyamai paritas race guard bot (`chatHandler.js:621-624`) tapi ATOMIK lintas-admin (dua admin
menambah kode sama bersamaan -> tepat satu sukses, satu 409). `simpanProduk`/`buatStokAwal` existing
(`set merge:true`) TIDAK dipakai di jalur tulis v3b; jalur bot tetap memakainya apa adanya.
Cache produk/stok di-invalidasi setelah transaksi sukses (`invalidasiCacheProduk`/`invalidasiCacheStok`
dipanggil langsung, T3f2).

**Perilaku sukses (paritas `chatHandler.js:954-976`):**
1. Transaksi create `products/{kode}`: `{ nama_accurate: nama_produk, hpp,
   nama_accurate_normalized, is_online_product: true, updated_at }` - `nama_accurate_normalized`
   ditulis manual (karena tidak lewat `simpanProduk`) memakai helper `normalisasiNama` yang sama.
2. Transaksi create `stock/{kode}`: `{ stok_gudang_online: stok_awal, reorder_point: null,
   last_updated, last_updated_by: sesi.uid, last_synced_at: null, last_synced_value: null }`
   (setara `buatStokAwal`, `stok.js:24-42`, minus `cekDanNotifikasiReorderPoint` - dipanggil setelah
   commit bila `stok_awal > 0`).
3. `catatPergerakanStok({ kode_barang, nama_terbaca: nama_produk, variasi: "-", qty: Math.abs(stok_awal||0),
   type: "koreksi_manual", action_type: "tambah_stok", catatan: "produk baru didaftarkan lewat dashboard",
   source: "web_dashboard", status: "processed", created_by: sesi.uid, requested_by: sesi.uid, confirmed_by: sesi.uid })`.
   Catatan: `source: "web_dashboard"` SUDAH ada di `types.ts:26` (MovementSource) - tidak perlu
   enum baru. Ini pembeda dari bot (`manual_chat_produk_baru`).
4. Sukses 200: `{ ok: true, produk: { kode_barang, nama_accurate, hpp, is_online_product: true }, stok_awal }`.

**Audit "siapa menambah produk" (KEPUTUSAN S9 / F16, final - DIPERTAHANKAN):** TIDAK menulis
`product_changes` untuk A5. Alasan: `product_changes.field` bertipe `"hpp"|"hpp_baru"|"reorder_point"`
(perubahan field produk EXISTING, `types.ts:253`), bukan pembuatan produk; menambah nilai `field` di
luar tipe = perubahan kontrak tanpa manfaat. Pelacakan "siapa menambah produk apa kapan" BUKAN via
`product_changes`, melainkan via `stock_movements` hasil langkah 3: `nama_terbaca = nama_produk`
+ `source:"web_dashboard"` + `created_by/requested_by/confirmed_by = sesi.uid` + `type:"koreksi_manual"`.
Ini tetap tertulis walau `stok_awal = 0` (qty 0, baris tetap ada). **Konsekuensi yang diakui:** tidak
ada jejak field-level produk (mis. perubahan `hpp`/`reorder_point` produk baru) selain payload
`products` itu sendiri + `updated_at`; audit field-level produk = v3c (OQ-4).

**Tidak ada notifikasi Telegram** untuk A5 (keputusan S6.2). Alasan: pembuatan produk bukan event
yang perlu diberitahukan ke user; bot tidak mengirim notif saat `tambahProdukBaru` dipanggil
(`chatHandler.js:978-982` hanya membalas pelaku di chat yang sama).

### 5.4 Aksi `konfirmasi-draft` (F3/A2)

**Body:**
```json
{ "aksi": "konfirmasi-draft", "jenis": "opname", "draft_id": "<docId>", "aksi_draft": "apply" }
{ "aksi": "konfirmasi-draft", "jenis": "picking", "batch_id": "<telegramUserId>", "aksi_draft": "apply" }
{ "aksi": "konfirmasi-draft", "jenis": "sync", "draft_id": "<docId>", "aksi_draft": "apply", "kondisi": "sheets_ketinggalan" }
{ "aksi": "konfirmasi-draft", "jenis": "sync", "draft_id": "<docId>", "aksi_draft": "apply", "kondisi": "semua" }
{ "aksi": "konfirmasi-draft", "jenis": "opname", "draft_id": "<docId>", "aksi_draft": "batal" }
```

Nilai `jenis`: `"opname" | "picking" | "sync"`. Nilai `aksi_draft`: `"apply" | "batal"`.
`kondisi` (opsional, hanya untuk `jenis:"sync"` + `aksi_draft:"apply"`): salah satu `KONDISI`
(`sheets_ketinggalan`|`sheets_manual`|`konflik`|`produk_baru`) atau `"semua"`. Absen -> `"semua"`.

**KEPUTUSAN B1 (picking = BATCH, final):** untuk `jenis:"picking"`, unit konfirmasi adalah SATU
**batch** = satu sesi `sessions/{owner}.pendingPickingList` (array `movementIds`). Body memakai
**`batch_id`** = `telegramUserId` PEMILIK sesi (bukan `draft_id` movement). Satu panggilan
`konfirmasi-draft` picking memproses SELURUH `movementIds` batch itu (perilaku fungsi bot apa adanya,
`:70-100`). **TIDAK ADA** konfirmasi per-movement dari dashboard.

- **Cara dashboard menemukan batch:** dari `sessions.pendingPickingList` — TIDAK bisa (client
  DILARANG baca `sessions`, `firestore.rules:37`). Karena itu batch ditemukan dari `stock_movements`
  dengan `status == "pending_confirmation"` dan `action_type != null`, DIKELOMPOKKAN per
  `created_by`/`requested_by` (owner). Bila >1 movement dengan owner sama & semua `pending_confirmation`,
  dashboard menyajikan SATU kartu "Batch picking" berisi N movement + `batch_id = owner`.
  **Catatan index (N7):** filter `action_type != null` di mode real berisiko butuh composite index;
  **KEPUTUSAN:** filter `status` + `action_type` dilakukan DI MEMORI (pola `listOpnameDrafts`
  `real.ts:305-318`), bukan query `!=` (lihat S10.3).
- **Ringkasan batch (WAJIB tampil):** "N item siap diproses, M dilewati (produk tak ketemu/ragu)" —
  N = movement punya `kode_barang`, M = sisanya (`konfirmasiPickingList.js:75-76`).
- **Satu tombol konfirmasi** untuk SELURUH batch; tidak ada tombol per item.
- **Guard dobel-proses batch:** lihat S8.2/S8.4 (status + guard dokumen `draft_kirim_guard/{picking}:{batch_id}`).

**Validasi:**

| Cek | Status | `error` |
|---|---|---|
| `jenis` di luar 3 nilai | 400 | `"Jenis draft tidak dikenal."` |
| `jenis:"picking"`: `batch_id` bukan string / kosong | 400 | `"Batch picking tidak ditemukan."` |
| `jenis` != `picking`: `draft_id` bukan string / kosong | 400 | `"Draft tidak ditemukan."` |
| `aksi_draft` di luar `apply`/`batal` | 400 | `"Aksi draft tidak dikenal."` |
| `jenis` != `sync` tapi `kondisi` dikirim non-null | 400 | `"Kondisi hanya untuk draft sync."` |
| `kondisi` dikirim tapi tidak valid | 400 | `"Kondisi tidak dikenal."` |
| draft/batch tidak ditemukan | 404 | `"Draft tidak ditemukan."` (picking: `"Batch picking tidak ditemukan."`) |
| draft status != `pending_confirmation` (opname/sync) | **409** | **`"Draft ini sudah diproses sebelumnya."`** |
| batch picking: SEMUA movement sudah != `pending_confirmation` | **409** | **`"Batch picking ini sudah diproses sebelumnya."`** |
| `jenis:"sync"` + `kondisi != "semua"` + tidak ada draft kelompok itu pending | 409 | `"Tidak ada draft kelompok itu yang masih pending."` |
| pemilik draft/batch tidak dapat ditentukan (tanpa `owner_user_id`/`created_by`) | 409 | `"Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram."` |
| role admin & `sesi.uid` != `owner_user_id` draft/batch | 403 | `"Hanya owner atau pembuat draft yang dapat mengonfirmasi."` |
| model throw (Sheets mis. kuota) | 500 | `"Gagal memproses draft."` |

**Perilaku sukses:** memanggil fungsi bot yang SAMA dengan `{ kirimNotifikasi:false }` (S6),
dengan `telegramUserId = owner_user_id` (S7.3) dan `confirmedBy = sesi.uid` (audit pelaku dashboard).
**Wajib memeriksa hasil `{ ok }` yang dikembalikan fungsi bot (B3):** bila `ok === false` (mis.
`alasan: "tidak_ada_pending"`), route membalas **409** `"Draft sedang diproses atau pemilik draft
tidak dapat diverifikasi."` - BUKAN 200. Rincian per jenis ada di S8 (guard) + S6 (signature/return).
---

## 6. Modifikasi yang menyentuh bot (WAJIB backward-compatible)

### 6.1 Signature final 3 fungsi konfirmasi (B2 + B3)

Tiga fungsi diubah untuk (a) menerima opsi objek `{ kirimNotifikasi }` (default `true`), (b) menerima
`opsiBacaGuard` untuk membaca guard sebelum apply (B2), dan (c) MENGEMBALIKAN objek hasil eksplisit
`{ ok, alasan, ... }` alih-alih `return` senyap/boolean mentah (B3).

```js
// lib/handlers/handleOpname.js
// SEBELUM: async function konfirmasiOpname(telegramUserId, teksJawaban, confirmedBy = telegramUserId)
// SESUDAH:
async function konfirmasiOpname(telegramUserId, teksJawaban, opsi = {}) {
  const { confirmedBy, kirimNotifikasi = true, cekGuard = false } =
    typeof opsi === "string" ? { confirmedBy: opsi } : opsi;
  const pelaku = confirmedBy ?? telegramUserId;
  // ... di awal, sebelum mutasi apa pun:
  const pending = (await sessionRef.get()).data()?.pendingOpname;
  if (!pending) return { ok: false, alasan: "tidak_ada_pending" };            // B3 (sebelumnya: return;)
  if (cekGuard) { /* B2: baca draft_kirim_guard, bila aktif -> return {ok:false, alasan:"guard_aktif"} */ }
  // ... pakai `pelaku` di tempat `confirmedBy` lama; bungkus kirimPesan dgn if (kirimNotifikasi)
  // ... semua cabang sukses `return { ok: true, diproses: <n> }` atau { ok:true, dibatalkan:true }
}

// lib/handlers/konfirmasiPickingList.js  (sudah memakai objek opsi)
async function konfirmasiPickingList(
  telegramUserId,
  teksJawaban,
  { sumber = "teks", confirmedBy = telegramUserId, kirimNotifikasi = true, cekGuard = false } = {}
) {
  // ... if (!pending) return { ok: false, alasan: "tidak_ada_pending" };      // B3 (sebelumnya: return false;)
  // ... cabang batal -> return { ok: true, dibatalkan: true }
  // ... cabang bukan ya -> return { ok: false, alasan: "jawaban_tak_dikenal" }
  // ... sukses -> return { ok: true, diproses: jumlahKurangiStok + jumlahMintaGudang, dilewati: dilewati.length, batch_id }
}

// lib/sheets/syncStokDuaArah.js
async function konfirmasiSyncStok(telegramUserId, teksJawaban, opsi = {}) {
  const { confirmedBy, kirimNotifikasi = true, cekGuard = false } =
    typeof opsi === "string" ? { confirmedBy: opsi } : opsi;
  const pelaku = confirmedBy ?? telegramUserId;
  // ... if (!pending) return { ok: false, alasan: "tidak_ada_pending" };      // B3 (sebelumnya: return;)
  // ... semua cabang sukses `return { ok: true, diproses: <n>, sisa: draftIdsSisa.length }`
}
```

**Definisi default:** `kirimNotifikasi = true`, `cekGuard = false`. Bila opsi tidak dikirim /
`confirmedBy` dikirim sebagai string (bentuk lama), perilaku identik dengan sebelum v3b.

### 6.2 Kompatibilitas dua arah (BUKTI WAJIB)

| Pemanggil | Bentuk lama | Setelah v3b | Hasil |
|---|---|---|---|
| `handleKonfirmasiCallback.js:47` | `konfirmasiOpname(idPemilik, jawabanTeks, fromUserId)` | string diterima via fallback `typeof opsi === "string"` | OK (fallback) |
| `handleKonfirmasiCallback.js:68` | `konfirmasiPickingList(idPemilik, jawabanTeks, { sumber:"tombol", confirmedBy: fromUserId })` | kompatibel (field baru default `true`/`false`) | OK |
| `handleKonfirmasiCallback.js:76` | `konfirmasiSyncStok(idPemilik, jawabanTeks, fromUserId)` | string diterima via fallback | OK (fallback) |
| `routePesan.js:115` | `konfirmasiPickingList(ctx.telegramUserId, ctx.message.text)` | opsi kosong -> default | OK |
| `routePesan.js:119` | `konfirmasiSyncStok(ctx.telegramUserId, ctx.message.text)` | opsi kosong -> default | OK |
| `routePesan.js:123` | `konfirmasiOpname(ctx.telegramUserId, ctx.message.text)` | opsi kosong -> default | OK |

**KEPUTUSAN BOT-1 (final):** karena `handleOpname.js` dan `syncStokDuaArah.js` menerima argumen
ketiga sebagai STRING (posisi `confirmedBy`), perubahan signature WAJIB **mendukung KEDUA bentuk**
(objek opsi + string fallback). Alasan: (a) backward-compatible 100% untuk pemanggil lama mana pun;
(b) minim perubahan bot.

**KEPUTUSAN BOT-2 (N2, final):** **JANGAN mengubah call site lama** `handleKonfirmasiCallback.js:47,76`.
Fallback string sudah cukup; mengubahnya ke bentuk objek menambah diff bot tanpa manfaat dan berisiko
mencampur bentuk dengan `:68` (yang sudah objek). Diff bot dijaga minimal (hanya di dalam 3 fungsi +
1 titik baca guard).

### 6.3 Detail titik perubahan di dalam fungsi

| Fungsi | Pesan yang WAJIB di-guard `if (kirimNotifikasi)` |
|---|---|
| `konfirmasiOpname` | `:221` ("Oke, opname dibatalkan..."), `:226` (pesan nunggu jawaban), `:267` (hasil konfirmasi) |
| `konfirmasiPickingList` | `:53` (dibatalkan), `:61` (nunggu jawaban, hanya `sumber:"teks"`), `:103` (hasil) |
| `konfirmasiSyncStok` | `:344` (dibatalkan), `:350` (format tidak kebaca), `:362` (tidak ada draft kelompok), `:381` (hasil) |

**Catatan penting:** guard HANYA membungkus pengiriman pesan. Semua mutasi Firestore (status draft,
hapus/ubah `pending*`, apply stok, `catatPergerakanStok`) TETAP jalan tanpa syarat. Bila ada
percabangan yang `return` SEBELUM mutasi (mis. `:350` format tidak kebaca), `return` tetap terjadi
(dashboard tidak akan pernah mengirim format salah, jadi tidak terpengaruh) — namun sekarang
mengembalikan `{ ok:false }` bukan `undefined`.

### 6.4 Notifikasi Telegram per fitur (ringkas keputusan)

| Fitur | Kirim Telegram? | Alasan |
|---|---|---|
| A7 `approve-akses` | **YA** (ke user target, teks bot) | user top-level menunggu balasan; tanpa ini alur kenalan putus (`handleApprovalCallback.js:123-126`) |
| A7 `tolak-akses` | **YA** (ke user target, `PESAN_TOLAK_HALUS`) | idem (`:149`) |
| A5 `tambah-produk` | **TIDAK** | bukan event ke user lain; bot pun tidak mengirim (`chatHandler.js:978-982`) |
| A2 semua | **TIDAK** (`kirimNotifikasi:false`) | pelaku di dashboard; pesan "Selesai diproses" ke chat Telegram = spam + membingungkan karena pelaku tidak di Telegram |

### 6.5 Test yang membuktikan bot TIDAK berubah (WAJIB)

- T4a: panggil `konfirmasiOpname(uid, "ya", fromUserId)` (string lama) -> `stock_movements.confirmed_by === String(fromUserId)`
  DAN `kirimPesan` dipanggil (stub) - perilaku lama utuh. **Assert nilai PERSIS `String(fromUserId)`, bukan truthy.**
- T4b: panggil `konfirmasiOpname(uid, "ya", { confirmedBy: fromUserId, kirimNotifikasi: false })` ->
  mutasi stok tetap terjadi, `stock_movements` tercatat, dan `kirimPesan` **TIDAK** dipanggil.
- T4c/T4d: sama untuk `konfirmasiSyncStok` (string lama + objek baru).
- T4e: `konfirmasiPickingList` dengan `{ kirimNotifikasi:false }` -> stok berubah, `kirimPesan` nol;
  juga assert `sumber` dari dashboard BUKAN `"teks"` (jangan sampai `:61` kena) - R-C.
- T4f (regresi callback): `handleKonfirmasiCallback` prefix `op`/`ss` tetap memanggil dengan
  argumen ketiga = `fromUserId` (assert spy argumen bentuk PERSIS `(idPemilik, jawabanTeks, fromUserId)`).
- T4g (jalur batal): `konfirmasiOpname(uid, "batal", ...)` -> status draft `"dibatalkan"`, `pendingOpname` dihapus.
- T4h (B3 no-op): `pending*` sudah kosong -> ketiga fungsi mengembalikan `{ ok:false, alasan:"tidak_ada_pending" }`
  TANPA mutasi & TANPA `kirimPesan`.
- T4i (B2 guard bot): guard `draft_kirim_guard` AKTIF -> ketiga fungsi (dengan `cekGuard:true`)
  mengembalikan `{ ok:false, alasan:"guard_aktif" }`, TIDAK apply, TIDAK hapus `pending*`.

### 6.6 Ringkasan return value: SEBELUM vs SESUDAH (B3)

| Fungsi | Return SEBELUM | Return SESUDAH (semua cabang) |
|---|---|---|
| `konfirmasiOpname` | `undefined` di semua cabang (early `return;` di `:213`; sisanya fall-through) | `{ ok:false, alasan:"tidak_ada_pending" }` / `{ ok:false, alasan:"guard_aktif" }` / `{ ok:false, alasan:"jawaban_tak_dikenal" }` / `{ ok:true, dibatalkan:true }` / `{ ok:true, diproses:<n>, perlu_klarifikasi:<n>, tidak_ketemu:<n> }` |
| `konfirmasiSyncStok` | `undefined` (early `return;` di `:336`; sisanya fall-through) | `{ ok:false, alasan:"tidak_ada_pending" }` / `{ ok:false, alasan:"guard_aktif" }` / `{ ok:false, alasan:"format_tak_dikenal" }` / `{ ok:false, alasan:"kondisi_kosong" }` / `{ ok:true, dibatalkan:true }` / `{ ok:true, diproses:<n>, sisa:<n> }` |
| `konfirmasiPickingList` | `false` (`:42`, `:67`) / `true` (`:54`, `:104`) | `{ ok:false, alasan:"tidak_ada_pending" }` / `{ ok:false, alasan:"guard_aktif" }` / `{ ok:false, alasan:"jawaban_tak_dikenal" }` / `{ ok:true, dibatalkan:true }` / `{ ok:true, diproses:<n>, dilewati:<n>, batch_id:<uid> }` |

**Pemanggil yang WAJIB disesuaikan (daftar lengkap, hasil verifikasi grep):**

| File:baris | Perubahan |
|---|---|
| `handleKonfirmasiCallback.js:47` (`op`) | IGNOR return baru (sebelumnya pun tidak dipakai); TIDAK perlu diubah, aman |
| `handleKonfirmasiCallback.js:68` (`pl`) | Variabel `berhasil` sekarang objek -> ubah ke `berhasil.ok` untuk `tutupCallback` |
| `handleKonfirmasiCallback.js:76` (`ss`) | IGNOR return baru (semula selalu `tutupCallback(..., true)`); aman, TIDAK diubah |
| `routePesan.js:115` (`picking`) | IGNOR return; hanya `return true` (pesan sudah ditangani). TIDAK diubah |
| `routePesan.js:119` (`sync`) | IGNOR return; TIDAK diubah |
| `routePesan.js:123` (`opname`) | IGNOR return; TIDAK diubah |

**Catatan:** `konfirmasiPickingList` di `handleKonfirmasiCallback.js:68` SUDAH memakai return
(`berhasil`) untuk `tutupCallback`; karena return berubah dari boolean ke objek, baris itu WAJIB
diubah ke `Boolean(hasil?.ok)`. Ketiga `routePesan.js` dan dua callback `op`/`ss` mengabaikan return
lama, jadi TIDAK perlu diubah (tetap kompatibel). **Test T4f menutup risiko R-D.**

### 6.7 B2 - Bot membaca guard (anti race dashboard <-> Telegram)

**KEPUTUSAN B2 (final):** SEBELUM apply, BOT membaca guard dokumen server-only; bila guard aktif ->
bot MENOLAK dengan pesan jelas. Desain guard final ada di S8.5. Implementasi: parameter `cekGuard`
(dikirim `true` HANYA oleh route dashboard saat memanggil bot; jalur Telegram tidak mengirimnya ->
`false` -> perilaku lama). **Catatan penting:** karena permintaan user adalah "bot JUGA membaca guard",
route dashboard-lah yang WAJIB mengaktifkan `cekGuard:true` saat memanggil bot; jalur Telegram murni
tetap `cekGuard:false` agar tidak ada perubahan perilaku (S6.5 T4i menguji `cekGuard:true`).

Pesan penolakan bot saat guard aktif (dipakai bila bot dipaksa `cekGuard:true`): teks diserahkan ke
pemanggil; bot TIDAK mengirim pesan (karena `kirimNotifikasi` dashboard = false) dan hanya
mengembalikan `{ ok:false, alasan:"guard_aktif" }`.

**Risiko regresi B2 (dinyatakan eksplisit):** menambah `cekGuard` di dalam 3 handler produksi =
permukaan regresi baru. Mitigasi: (a) default `cekGuard:false` -> jalur Telegram tak berubah;
(b) T4a-T4i membuktikan jalur lama; (c) T4i membuktikan `cekGuard:true` menolak saat guard aktif.
---

## 7. Aturan identitas A2 + cara mendapat `owner_user_id`

### 7.1 Matriks izin A2 (KEPUTUSAN USER, final)

| Peran | Lihat semua draft? | Konfirmasi |
|---|---|---|
| Owner | ya | **semua** draft |
| Admin | ya | **hanya draft yang ia buat sendiri** (`owner_user_id === sesi.uid`) |
| Guest | tidak (nav tersembunyi, 403) | tidak |
| Non-admin | tidak (401/403) | tidak |

### 7.2 Cara mendapat `owner_user_id` (definisi konkret)

Verifikasi S3.1 membuktikan draft opname/sync **tidak** menyimpan pemilik, sementara client
DILARANG membaca `sessions` (`firestore.rules:37`). Ada dua jalur:

**Jalur 1 (picking, tanpa perubahan bot):** `stock_movements` milik batch. Pemilik batch = `created_by`
(fallback `requested_by`) dari movement-movement dalam batch. Bukti: `handleScreenshotPickingList.js:131`,
`stockMovements.js:67`. TERSEDIA.

**Jalur 2 (opname/sync):** `owner_user_id` WAJIB ditulis ke draft saat draft dibuat (additive di bot)
supaya client bisa membacanya tanpa membuka `sessions`.

**KEPUTUSAN A2-5 (final - mengalah dari A2-1):** tulis `owner_user_id` ke draft opname/sync saat
dibuat. Alasan: (a) client tidak boleh baca `sessions` (bocor history AI + state internal);
(b) otorisasi UI (sembunyikan tombol) butuh sumber yang bisa dibaca client; (c) perubahan additive
murni (tambah 1 field di `add()`), tidak mengubah percabangan/alur bot. **Risiko regresi diterima &
dibatasi** ke 2 titik `add()`. A2-1 (yang menyebut "jangan menambah field") DIBATALKAN oleh A2-5.

Perubahan bot untuk A2 (2 titik, additive):
1. `handleOpname.js:176-181` (`simpanDraftOpname`) -> tambah `owner_user_id: String(telegramUserId)`.
   `simpanDraftOpname(hasilBanding)` perlu menerima `telegramUserId` (parameter baru, dipanggil di `:56`).
2. `syncStokDuaArah.js:207-213` (`simpanDraftPerKelompok`) -> tambah `owner_user_id: String(telegramUserId)`.
   `simpanDraftPerKelompok(kelompok, indexKolom)` perlu menerima `telegramUserId` (parameter baru,
   dipanggil di `:83` dari `mulaiSyncStok`).
3. Picking: TIDAK diubah (sudah punya `created_by`).

**Verifikasi pemanggil `simpanDraftOpname`/`simpanDraftPerKelompok` (N8):** grep `test/*` menunjukkan
TIDAK ADA test yang mengimpor kedua fungsi ini langsung (hanya fungsi konfirmasi yang diuji). Perubahan
signature AMAN; gate B-W1 tetap menjalankan `npm test` penuh.

**KEPUTUSAN draft LAMA tanpa `owner_user_id` (FAIL-CLOSED, final):** draft pra-v3b yang tidak punya
`owner_user_id` (dan picking tanpa `created_by`) **TIDAK bisa dikonfirmasi dari dashboard oleh siapa
pun, TERMASUK OWNER**. Route mengembalikan **409 `"Pemilik draft tidak dapat diverifikasi. Proses
lewat Telegram."`**. UI menandai kartu "Pemilik tidak diketahui - proses lewat Telegram" dan
MENYEMBUNYIKAN tombol konfirmasi. Alasan fail-closed: tanpa owner, `telegramUserId` untuk fungsi bot
tidak bisa ditentukan -> `pending*` sesi yang dibaca bisa salah orang -> apply ke sesi salah. Ini
kebijakan eksplisit, bukan gap pasif. **Test T5d menutupnya** (draft tanpa owner -> 409, tidak ada mutasi).

**Tameng terhadap pemalsuan `owner_user_id` via body:** route SELALU mengambil `owner_user_id` dari
draft (`draft.owner_user_id ?? draft.created_by`), BUKAN dari body. Body TIDAK punya field itu (S4.2).
Ini diuji T5e (kirim `owner_user_id` palsu di body -> diabaikan; otorisasi pakai nilai draft).

### 7.3 Verifikasi otorisasi di route (final)

```
1. Baca draft (opname_drafts/{id} | sync_stok_drafts/{id}) atau batch picking (kumpulan stock_movements
   status=="pending_confirmation" milik satu owner).
2. owner_user_id = draft.owner_user_id (opname/sync) ?? movements[0].created_by ?? movements[0].requested_by ?? null.
3. Jika null -> 409 "Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram." (JANGAN pakai body.)
4. Jika `jenis:"sync"` dan `kondisi != "semua"`: pastikan draft.kondisi === kondisi (atau kelompok ada).
5. role owner -> lanjut. role admin -> jika String(sesi.uid) !== String(owner_user_id) -> 403.
6. Panggil fungsi bot dengan telegramUserId = owner_user_id, confirmedBy = sesi.uid,
   kirimNotifikasi:false, cekGuard:true.
7. Periksa return: bila `!hasil.ok` -> 409 "Draft sedang diproses atau pemilik draft tidak dapat
   diverifikasi." (BUKAN 200).
```

**Catatan identitas ganda:** draft dibuat oleh user Telegram (pemilik = `owner_user_id`), tapi bisa
dikonfirmasi oleh admin yang login dashboard (`sesi.uid`). Karena itu `telegramUserId` untuk fungsi bot
= `owner_user_id` (agar state sesi & `requested_by` benar), sedangkan audit pelaku =
`sesi.uid` (di `stock_movements.confirmed_by`). Perilaku ini PERSIS pola bot yang sudah ada
(`chatHandler.js:973-975`: `created_by/confirmed_by = confirmedBy`, `requested_by = telegramUserId`).

---

## 8. Guard dobel-proses A2 (desain konkret)

### 8.1 Bahaya

Draft dikonfirmasi dari dashboard, LALU admin membalas `"ya"` di Telegram (chat lama / tombol lama).
`konfirmasiOpname`/`konfirmasiPickingList`/`konfirmasiSyncStok` membaca `pending*` dan memproses ULANG.

**Skenario khusus (dari review):** draft dikonfirmasi dari dashboard -> `pending*` dihapus -> ADMIN
MASIH melihat pesan lama di Telegram & menekan tombol inline. Karena dashboard memakai
`kirimNotifikasi:false`, tombol Telegram TIDAK dihapus. **KEPUTUSAN (B2/B3):** tombol lama yang ditekan
-> bot memanggil fungsi dengan `cekGuard` TIDAK aktif di jalur Telegram, TETAPI `pending*` sudah tidak
ada -> fungsi mengembalikan `{ ok:false, alasan:"tidak_ada_pending" }` -> `tutupCallback` menampilkan
pesan jelas: **"Sudah diproses sebelumnya atau kadaluarsa."** (sudah ada di `handleKonfirmasiCallback.js:102`).
Jadi bot MENOLAK dengan pesan jelas, BUKAN sukses palsu. (Untuk picking, `konfirmasiPickingList:42`
sekarang mengembalikan objek `{ok:false}`; `handleKonfirmasiCallback.js:68` diubah ke `Boolean(hasil?.ok)`.)

### 8.2 Tiga lapis guard (diperbarui)

**Lapis 1 - status draft (idempoten, server-side, otoritatif).**
Sebelum memanggil fungsi bot, route membaca draft dan menolak bila `status !== "pending_confirmation"`:
`opname_drafts.status`, `sync_stok_drafts.status`; untuk picking: karena unit = batch, tolak bila
**SEMUA** movement batch `!= "pending_confirmation"` (kode `"Batch picking ini sudah diproses sebelumnya."`).
Status di-set `"processed"` OLEH FUNGSI BOT yang sama (`handleOpname.js:263`, `syncStokDuaArah.js:419,457`,
`tandaiMovementProcessed` `:117`). SATU sumber kebenaran; route dashboard TIDAK menulis status terpisah.

**Lapis 2 - pembersihan state sesi bot (agar balasan Telegram berikutnya tidak menemukan draft).**
Setelah fungsi bot sukses, state `pending*` sudah bersih/diupdate OLEH BOT SENDIRI:
- `konfirmasiOpname` -> `hapusPendingOpname` (`:264,279`) menghapus `pendingOpname`.
- `konfirmasiPickingList` -> `hapusPendingPickingList` (`:100,141-143`) (menghapus SELURUH batch).
- `konfirmasiSyncStok` -> hapus `pendingSyncStok` bila sisa nol (`:376`), ATAU simpan `draftIds` sisa
  (`:377-379`) untuk kelompok yang belum diproses.

**Lapis 3 - guard dokumen `draft_kirim_guard` (lintas-jalur, best-effort).**
Tulis `{ at }` via transaction SEBELUM memanggil bot; bila panggilan baru < TTL untuk kunci yang sama
-> 409 `"Draft sedang diproses."`. **B2:** bot JUGA membaca guard ini bila `cekGuard:true` (route
dashboard mengirim `cekGuard:true`). **Ini menutup dashboard<->Telegram**, bukan hanya dobel-dashboard.

**KEPUTUSAN A2-6 (final):** TIDAK menambah `hapusPendingSpecifik(uid, field)` di `lib/models/sessions.js`.
Alasan: (a) fungsi bot sudah membereskan state-nya sendiri pada semua cabang sukses; (b) usulan di
brief ("hapus SPESIFIK satu field") hanya perlu bila bot TIDAK membersihkan - verifikasi membuktikan
bot membersihkan; (c) `hapusSemuaPendingState` TIDAK boleh dipakai (akan menghapus `pendingAction` dll
yang tidak berhubungan). Menambah fungsi = permukaan bug baru tanpa manfaat.

**Race (dashboard & Telegram bersamaan):** kedua jalur membaca `pending*` dan status draft. Guard
Lapis 1 menolak status != `pending_confirmation`, sehingga invocation kedua akan 409/berhenti. Jendela
antara "baca status" dan "fungsi bot menulis processed" ditutup oleh Lapis 3 (guard dokumen) yang
DIBACA KEDUA JALUR (bot dengan `cekGuard:true`, route tanpa tambahan).

**Guard best-effort (testable):** kegagalan `runTransaction` guard (error tak terduga, BUKAN sentinel)
-> route LOG `console.error("[draft_guard_failed]")` lalu LANJUT. Diuji dengan mock throw (aksi tetap jalan).

### 8.3 Guard atomik model lain (B4/B5)

- **A7 (B4):** `runTransaction` compare-and-set di `accessRequests.js` (S5.2).
- **A5 (B5):** `runTransaction` create-only `products` + `stock` (S5.3).

### 8.4 Guard batch picking (khusus)

- Kunci guard: `draft_kirim_guard/{picking}:{batch_id}` (batch_id = owner_user_id sesi).
- Lapis 1: tolak 409 bila semua movement batch sudah != `pending_confirmation`.
- Lapis 3: guard dokumen mencegah dua konfirmasi batch paralel.
- **Retry parsial (mis. gagal di tengah loop `:81-98`):** movement yang sudah diproses menjadi
  `processed`; `pendingPickingList` BELUM dihapus sampai loop selesai (`:100`). Pada retry, route
  memfilter movement yang masih `pending_confirmation` sebelum memanggil bot (guard Lapis 1 per-batch
  tidak cukup). **KEPUTUSAN:** route mengirim daftar `movementIds` sisa? TIDAK — fungsi bot memproses
  ulang SEMUA `movementIds` sesi. Karena itu, bila terdeteksi batch setengah jadi (sebagian
  `processed`, sebagian `pending_confirmation`) route menolak dengan **409
  `"Batch picking ini diproses sebagian. Selesaikan lewat Telegram."`** dan TIDAK memanggil bot
  (fail-closed) - mencegah `kurangiStok` dobel. Dicatat sebagai edge case E-3 (S20).

### 8.5 Desain guard final (jawaban B2)

| Aspek | Nilai final |
|---|---|
| Nama dokumen/koleksi | `draft_kirim_guard` |
| Format doc id | `opname:{draftId}`, `sync:{draftId}`, `picking:{batch_id}` (per jenis, hindari bentrok antar jenis) |
| Field | `{ at: Timestamp }` (server time) |
| Cakupan | PER unit konfirmasi (opname draft / sync draft / picking batch), bukan per-user |
| TTL | **10 detik** (panggilan baru untuk kunci sama < 10s -> 409 `"Draft sedang diproses."`) |
| Siapa yang MENULIS | Route dashboard (`POST /api/admin` aksi `konfirmasi-draft`) via `runTransaction` |
| Siapa yang MEMBACA | (1) Route dashboard (sendiri, sebelum panggil bot); (2) **BOT** saat `cekGuard:true` (B2) |
| Rules | `match /draft_kirim_guard/{id} { allow read, write: if false; }` - APPEND dekat `permintaan_form_guard` (`firestore.rules:35`), pola sama `stock_write_guard:34` |
| Kegagalan guard | Best-effort: error tak terduga -> log & lanjut (tidak memblokir aksi sah) |

**Aturan TTL testable:** dua `konfirmasi-draft` untuk draft/batch sama dalam < 10 detik -> satu 200,
satu 409 `"Draft sedang diproses."`. Setelah > 10 detik, panggilan baru diizinkan (namun Lapis 1 tetap
menolak bila sudah `processed`).

**Mengapa 10 detik:** operasi A2 (Sheets) normal selesai < 5s (S12); 10s memberi margin 2x. TTL lebih
panjang memperlambat retry sah; lebih pendek membuka jendela race.
---

## 9. Audit trail

| Fitur | Apa yang dicatat | Di mana |
|---|---|---|
| A7 approve | `access_requests.resolved_by = sesi.uid`, `resolved_at` (existing, `accessRequests.js:31-39`, kini transaksional) | `access_requests/{target}` |
| A7 reject | `resolved_by`, `resolved_at`, `rejected_until` (`:42-52`, kini transaksional) | `access_requests/{target}` |
| A5 | `products` + `stock` (`last_updated_by = sesi.uid`) + `stock_movements` (`type:"koreksi_manual"`, `source:"web_dashboard"`, `created_by/requested_by/confirmed_by = sesi.uid`) | `products/{kode}`, `stock/{kode}`, `stock_movements/{autoId}` |
| A2 opname | `stock_movements` dibuat bot dengan `confirmed_by = sesi.uid`, `requested_by = owner_user_id`; `opname_drafts.status = "processed"` | `stock_movements`, `opname_drafts/{id}` |
| A2 picking (batch) | Tiap `stock_movements` movement diupdate `confirmed_by/confirmed_by_name/confirmed_at` (`konfirmasiPickingList.js:120-128`), `status` (`:117,132`) | `stock_movements/{movementId}` |
| A2 sync | `sync_stok_drafts.status = "processed"`; `stock_movements` `type:"sync_confirmed"` `confirmed_by = sesi.uid` (`syncStokDuaArah.js:438-451`) | `sync_stok_drafts/{id}`, `stock_movements/{autoId}` |

**KEPUTUSAN S9-1 (final):** TIDAK membuat koleksi audit baru untuk v3b. Alasan: (a) tiap fitur sudah
punya jejak durable (`access_requests`, `stock_movements`, `products`/`stock`); (b) margin kompleksitas
+ risiko regresi tidak sebanding; (c) `console.info("[admin_...]")` tetap ditulis sebagai log
operasional (tidak diklaim durable). Bila kelak perlu "siapa approve dari mana (dashboard vs Telegram)",
pembedanya adalah `stock_movements.source = "web_dashboard"` (A2/A5). Untuk A7 tidak ada pembeda durable
-> gap audit yang diakui (OQ-5). Bila diputuskan perlu, tambahkan field `resolved_via: "web"|"telegram"`
ke `access_requests` (additive, 1 baris) - kandidat v3c.

---

## 10. UI + state lengkap

### 10.1 F1 - `/admin` seksi Permintaan Akses (A7)

Perubahan `app/admin/page.tsx`: tiap baris `pending` (dan hanya `pending`) mendapat tombol
**"Setujui"** (`primary`) + **"Tolak"** (`outline`). Owner only (pakai `role === "owner"`, sudah ada
`bolehUbahRole` di `:53`). Baris non-pending tetap read-only seperti sekarang.

| State | Perilaku |
|---|---|
| Loading | Skeleton existing (`Memuat`, `:332`) dipertahankan |
| Kosong | Empty existing ("Belum ada permintaan akses.", `:230`) dipertahankan |
| Owner + baris `pending` | Tombol Setujui/Tolak tampil, `h-11` (mobile) / `size="sm"` (desktop) |
| Admin | TANPA tombol (seksi tetap read-only); aksi via route -> 403 |
| Konfirmasi | `AlertDialog`: "Setujui akses {nama}?" / "Tolak akses {nama}?" + nama + user id; tombol batal/ok |
| Submit | Kedua tombol baris disabled + spinner; teks "Memproses..." |
| Sukses approve | Toast "Akses disetujui"; baris pindah status Disetujui (refetch `listAccessRequests()`) |
| Sukses reject | Toast "Akses ditolak"; baris pindah status Ditolak |
| Sukses + `notifikasi_terkirim:false` | Toast sukses + warning "Tersimpan, tapi notifikasi Telegram ke user gagal terkirim." |
| Error 409 | Toast `"Request ini sudah diproses sebelumnya."`; refetch (baris hilang dari pending) |
| Error 403/404/500 | Toast pesan server; baris tidak berubah |
| **Error 401 mid-write** | `tampilkanGagalTulis()` (`lib/dashboard/pesan.ts`): toast `SESI_KEDALUWARSA` + tombol "Buka ulang" (`bukaUlangTelegram`); `AlertDialog` TETAP TERBUKA (state `dialogTerbuka` TIDAK di-reset); baris tidak berubah |

**Mekanisme 401 (B6):** state `dialogTerbuka` + `idTarget` hidup di React state lokal
(`useState`), TIDAK di-reset saat error 401 di cabang `catch`; hanya toast + tombol "Buka ulang"
yang dirender. Test e2e `?mock-401=1` (pola `lib/dashboard/data/mock.ts:133-136`) memverifikasi
dialog masih ter-mount dan tombol "Buka ulang" ada setelah submit 401.

`data-testid` baru: `setujui-akses-{id}`, `tolak-akses-{id}`, `konfirmasi-akses-ok-{id}`,
`konfirmasi-akses-batal-{id}`.

### 10.2 F2 - `/stok` dialog Tambah Produk (A5)

Perubahan `app/stok/page.tsx`: tombol **"Tambah Produk"** di header (owner + admin, `bolehKoreksi`
sudah ada `:59`), membuka `components/dashboard/dialog-tambah-produk.tsx` (baru).
Form: `kode_barang` (wajib), `nama_produk` (wajib), `hpp` (opsional, angka), `stok_awal`
(opsional, angka, default 0). Setelah sukses -> refetch `listStock()`.

| State | Perilaku |
|---|---|
| Tombol "Tambah Produk" | `h-11` mobile / `size="sm"` desktop; owner+admin; guest tak sampai halaman |
| Dialog kosong | Input kosong; helper "Kode barang harus sama persis dengan kode di Accurate." |
| Submit disabled | Saat `mengirim` ATAU `kode_barang`/`nama_produk` kosong |
| Sukses | Toast "Produk {kode} ditambahkan"; dialog tutup; daftar stok refetch |
| Error 409 | Error inline di field `kode_barang`: `kode "${kode}" sudah dipakai produk lain`; isian lain DIPERTAHANKAN |
| Error 400 | Error inline pesan server; isian DIPERTAHANKAN |
| **Error 401 mid-write** | `tampilkanGagalTulis()`: toast `SESI_KEDALUWARSA` + "Buka ulang"; **dialog TETAP TERBUKA & isian (kode/nama/hpp/stok) DIPERTAHANKAN** (state form lokal TIDAK di-reset) |
| Error 500/network | Toast "Gagal menambah produk. Coba lagi."; dialog tetap terbuka |

**Validasi input UI (testable):** `hpp`/`stok_awal` = angka integer >= 0; `stok_awal` > 1.000.000
ditolak inline; `kode_barang` <= 60 char; `nama_produk` <= 120 char. `hpp` kosong -> dikirim sebagai
absen (server -> `null`/tidak diset).

**Mekanisme 401 (B6):** `dialogTerbuka` + state form (`useState` per field) TIDAK di-reset pada catch
401; test e2e `?mock-401=1` memverifikasi dialog masih terbuka + nilai field utuh + tombol "Buka ulang".

`data-testid`: `buka-tambah-produk`, `dialog-tambah-produk`, `input-kode-produk`, `input-nama-produk`,
`input-hpp-produk`, `input-stok-awal-produk`, `simpan-produk`.

**Keputusan halaman:** form di `/stok` (dialog), BUKAN halaman baru. Alasan: (a) halaman baru tak
perlu; (b) konteks stok ada di sana. Dialog TIDAK tumpang-tindih dengan dialog mutasi/hpp existing
(setiap dialog punya `aria-modal` + fokus terkelola; hanya satu dialog aktif pada satu waktu).
Alternatif `/produk/baru` dicatat OQ-2.

### 10.3 F3 - `/draft` interaktif (A2)

Perubahan `app/draft/page.tsx`: tiap kartu mendapat tombol **"Konfirmasi"** (primary) + **"Batalkan"**
(outline), mendampingi tombol "Tinjau di Telegram" (tetap ada sebagai fallback). Untuk sync, tombol
per KELOMPOK + "Konfirmasi Semua".

| State | Perilaku |
|---|---|
| Loading | Skeleton existing (`Memuat`, `:283`) dipertahankan |
| Kosong | Empty existing opname/sync (`:89-95`, `:113-119`) dipertahankan |
| Draft dengan owner diketahui | Tombol Konfirmasi/Batalkan tampil |
| Draft tanpa owner (lama/orphan) | Badge "Pemilik tidak diketahui" + teks "Proses lewat Telegram"; TANPA tombol konfirmasi (fail-closed S7.2) |
| Admin + draft orang lain | Tombol konfirmasi DISEMBUNYIKAN; tooltip "Hanya pembuat draft atau owner" |
| Konfirmasi opname | `AlertDialog` ringkasan: jumlah item yang akan di-apply |
| Konfirmasi picking (batch) | `AlertDialog` ringkasan: **"Batch {N} item siap diproses, {M} dilewati (produk tak ketemu/ragu)"** + satu tombol OK |
| Sync multi-kelompok | Menampilkan daftar kelompok pending; tombol per kelompok + "Konfirmasi Semua" |
| Submit | Tombol kartu disabled + spinner |
| Sukses | Toast "Draft diproses"; refetch; (opname/picking) kartu hilang; (sync) kartu tersisa bila ada kelompok lain |
| Sync sebagian | Kartu sync tetap tampil dengan kelompok sisa; toast "Sebagian diproses. Masih ada kelompok lain yang menunggu." |
| Batch setengah jadi | Badge "Diproses sebagian" + teks "Selesaikan lewat Telegram"; TANPA tombol konfirmasi (S8.4 E-3) |
| Error 409 (sudah diproses) | Toast "Draft ini sudah diproses sebelumnya."; refetch |
| Error 409 (batch sudah diproses) | Toast "Batch picking ini sudah diproses sebelumnya."; refetch |
| Error 409 (pemilik tak dapat diverifikasi) | Toast `"Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram."` |
| Error 409 (sedang diproses) | Toast `"Draft sedang diproses."` (guard 10s) |
| Error 403 (admin bukan pembuat) | Toast "Hanya owner atau pembuat draft yang dapat mengonfirmasi." |
| **Error 401 mid-write** | `tampilkanGagalTulis()`: toast `SESI_KEDALUWARSA` + "Buka ulang"; `AlertDialog` TETAP TERBUKA |
| Error 500 (Sheets kuota) | Toast "Gagal memproses draft. Coba lagi."; kartu tetap |

`data-testid` baru: `konfirmasi-opname-{id}`, `batalkan-opname-{id}`, `konfirmasi-picking-batch-{owner}`,
`ringkasan-picking-batch-{owner}`, `konfirmasi-sync-{id}`, `konfirmasi-sync-semua-{id}`,
`badge-pemilik-diketahui-{id}`, `badge-pemilik-tak-diketahui-{id}`.

**Picking list (UI-1 + B1/N7):** `/draft` saat ini HANYA menampilkan opname & sync (`page.tsx:48`).
**KEPUTUSAN UI-1:** tambah seksi **"Picking List"** yang menyajikan **satu kartu per BATCH**
(per owner), bukan per movement. Data-access: method baru `listPickingDrafts()`.
**Catatan index (N7):** implementasi `listPickingDrafts()` di `real.ts` mengambil `stock_movements`
lalu MEMFILTER `status === "pending_confirmation"` DAN `action_type != null` **DI MEMORI**
(pola `listOpnameDrafts` `real.ts:305-318`), BUKAN query `!=` (yang butuh composite index).
Pengelompokan per `created_by` dilakukan di client/route helper.

### 10.4 State 401 mid-write (semua fitur) - B6

**Helper bersama (WAJIB):** pakai `tampilkanGagalTulis()` (dari v2/v3a, `lib/dashboard/pesan.ts`)
yang merender toast `SESI_KEDALUWARSA` (`pesan.ts:9`) + tombol "Buka ulang" (`bukaUlangTelegram`).
TIDAK ada implementasi 401 ad-hoc per halaman.

| Fitur | Apa yang DIPERTAHANKAN saat 401 mid-write | Mekanisme | Test |
|---|---|---|---|
| A7 `/admin` | Dialog konfirmasi TETAP terbuka; `idTarget` tetap; tombol baris kembali aktif | `dialogTerbuka`/`idTarget` di `useState`, tidak di-reset di catch 401 | e2e `?mock-401=1` |
| A5 `/stok` | Dialog TETAP terbuka; isian `kode_barang`/`nama_produk`/`hpp`/`stok_awal` utuh | state form `useState` per field, tidak di-reset di catch 401 | e2e `?mock-401=1` |
| A2 `/draft` | Dialog konfirmasi/ringkasan TETAP terbuka; pilihan kelompok sync tetap | state dialog di `useState`, tidak di-reset di catch 401 | e2e `?mock-401=1` |

**Aturan umum:** pada error 401, TIDAK BOLEH memanggil `setDialogTerbuka(false)` atau mereset field
form. Hanya toast + tombol "Buka ulang" yang berbeda dari jalur sukses.

---

## 11. Test plan (testable)

Framework existing: `test/*.test.js` (CJS, node:test + assert) + Playwright e2e.

**A7 (F1):**
- T1a: approve request `pending` -> `access_requests.status === "approved"`, `resolved_by === sesi.uid`.
- T1b (atomik, B4): dua approve paralel `Promise.all` -> tepat satu 200, satu 409 `"Request ini sudah diproses sebelumnya."`; `resolved_by` tertulis sekali.
- T1c: reject -> `status === "rejected"`, `rejected_until` ~ +1 jam.
- T1d: admin (non-owner) -> 403 `"Hanya owner yang dapat memproses permintaan akses."`.
- T1e: target_user_id non-digit -> 400 `"User ID Telegram tidak valid."`.
- T1f: notifikasi Telegram dipanggil ke `target_user_id` dengan teks bot PERSIS (string equality).
- T1g: `kirimPesan` gagal -> 200 + `notifikasi_terkirim:false` (TIDAK rollback status).
- T1h: request tidak ada -> 404 `"Permintaan akses tidak ditemukan."`.

**A5 (F2):**
- T3a: tambah produk baru -> `products/{kode}.is_online_product === true`, `stock/{kode}.stok_gudang_online === stok_awal`.
- T3b (atomik, B5): kode sudah ada -> 409 `kode "BRG-001" sudah dipakai produk lain`; `products`/`stock` TIDAK berubah.
- T3b2 (race): dua `tambah-produk` paralel kode sama -> tepat satu 200, satu 409; dokumen produk/stok konsisten (tidak merge-timpa).
- T3c: `stok_awal` absen -> dokumen stok dibuat dengan 0.
- T3d: `stock_movements` tercatat 1 baris `type:"koreksi_manual"`, `source:"web_dashboard"`, `created_by === sesi.uid`, `nama_terbaca === nama_produk`.
- T3e: role guest -> 403; admin -> sukses.
- T3f: `hpp` negatif / bukan integer -> 400; `stok_awal > 1.000.000` -> 400.
- T3f2: cache produk/stok invalidated setelah transaksi sukses (`invalidasiCacheProduk`/`invalidasiCacheStok` terpanggil).

**A2 (F3):** T2a-T2e (S8.3) + T5a: konfirmasi sync `"ya semua"` -> semua draft `processed`, `pendingSyncStok` hilang.
- T5b (picking batch): konfirmasi batch dari dashboard -> semua movement batch `processed`, `kurangiStok` terpanggil N kali (N = movement tanpa `kode_barang`... tepatnya movement `action_type==="kurangi_stok"`).
- T5c: admin memproses draft orang lain -> 403; draft tidak berubah.
- T5d (fail-closed): draft tanpa `owner_user_id` -> 409 `"Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram."` (owner TIDAK dikecualikan); tidak ada mutasi.
- T5e (anti-pemalsuan): body kirim `owner_user_id` palsu -> diabaikan; otorisasi pakai nilai draft.
- T5f (batch guard): dua konfirmasi batch paralel -> satu 200, satu 409.

**Regresi bot (WAJIB):** T4a-T4i (S6.5/S6.6).

**Validator:** `validasiAksiAdmin` mengenali 5 aksi (kata-kunci + 4 v3b); aksi lain 400.
`konfirmasi-draft` dengan `owner_user_id` di body -> diabaikan (bukan error; dokumentasi kontrak S4.2).

**E2E:** approve dari `/admin`; tambah produk dari `/stok`; konfirmasi opname dari `/draft`;
sync per-kelompok; konfirmasi batch picking. Plus: tombol `h-11` (boundingBox.height >= 44),
tanpa scroll horizontal @360px, `?mock-401=1` per fitur (dialog/isian dipertahankan).

---

## 12. Non-functional requirements

- **Budget:** 11/12 setelah v3b. Diverifikasi `vercel build` (atau hitung manual `route.ts`).
- **Waktu respons:** submit -> toast <= 2s pada data mock; <= 5s pada real (Sheets ops bisa lambat).
- **Idempotensi:** aksi yang sudah diproses -> 409, tidak mengubah state (T1b, T2a, T3b2, T5f).
- **Keamanan:** role SELALU dari `ambilAdmin(sesi.uid)` (Firestore), BUKAN sesi/body. `owner_user_id`
  diverifikasi server dari DRAFT (S7.3), bukan dipercaya dari body; field body `owner_user_id` diabaikan.
- **Rate limit:** bucket terpisah (S4.3): `admin:{uid}:aksi` 40/menit, `admin:{uid}:draft` 20/menit
  (soft per-instance).
- **Aksesibilitas:** kontras >= 4.5:1 (`@axe-core/playwright`), target sentuh >= 44px, `aria-busy` saat loading.
- **Mobile-first:** tanpa scroll horizontal @360px.
- **Konsistensi pesan error:** pesan 400/403/404/409 PERSIS tabel S4/S5 (diuji string equality).
---

## 13. Urutan implementasi (wave) untuk delegasi paralel

**KEPUTUSAN USER (dihormati): A7 + A5 dulu; A2 fase TERPISAH.**

### Fase A (A7 + A5) - prioritas 1-2

| Wave | Isi | File | Gate |
|---|---|---|---|
| **A-W1** (server) | Validator v3b (dispatcher `validasiAksiAdmin` + validator per aksi) + guard atomik model A7 | `lib/dashboard/validasiTulisV3a.js`, `lib/models/accessRequests.js`, `test/*` | `npm test` hijau (T1a-T1h) |
| **A-W2** (server) | Aksi `approve-akses`/`tolak-akses`/`tambah-produk` di route (transaksi create-only A5) | `app/api/admin/route.ts` | `npm test` + route test hijau (T3a-T3f2) |
| **A-W3** (UI) | `/admin` tombol + dialog + state 401 | `app/admin/page.tsx`, `components/dashboard/*` | `tsc` + e2e hijau |
| **A-W4** (UI) | `/stok` tombol + dialog + kontrak data-access + state 401 | `app/stok/page.tsx`, `components/dashboard/dialog-tambah-produk.tsx`, `lib/dashboard/data/*`, `lib/dashboard/types.ts`, `lib/dashboard/sumber-data.tsx` | `tsc` + e2e hijau |
| **A-W5** | rules + deploy doc | `firestore.rules`, `docs/dashboard-deploy.md` | rules ok |
| **A-W6** | e2e + `?mock-401=1` per fitur | `e2e/*.spec.ts` | `npm run e2e` hijau |

Paralelisasi: A-W1 -> A-W2 serial. A-W3 dan A-W4 bisa paralel setelah A-W2 (kontrak respons beku).
A-W5/A-W6 setelah A-W3/A-W4.

### Fase B (A2) - prioritas 3, TERPISAH, mulai setelah Fase A stabil

| Wave | Isi | File | Gate |
|---|---|---|---|
| **B-W1** | Perubahan bot additive: `owner_user_id` di draft + opsi `kirimNotifikasi` + `cekGuard` + return `{ ok }` (B2/B3) | `lib/handlers/handleOpname.js`, `lib/handlers/konfirmasiPickingList.js`, `lib/sheets/syncStokDuaArah.js`, `lib/handlers/handleKonfirmasiCallback.js`, `lib/dashboard/validasiTulisV3a.js` | test regresi bot hijau (T4a-T4i, T2b) |
| **B-W2** | Validator `konfirmasi-draft` + helper baca batch/owner | `lib/dashboard/validasiTulisV3a.js`, `lib/dashboard/draftOwner.js` | `npm test` hijau |
| **B-W3** | Aksi `konfirmasi-draft` + guard dokumen `draft_kirim_guard` (lintas-jalur) | `app/api/admin/route.ts`, `firestore.rules` | route test hijau (T2a-T2e, T5b-T5f) |
| **B-W4** | `/draft` interaktif (batch picking) + data-access `owner_user_id` + `listPickingDrafts` + state 401 | `app/draft/page.tsx`, `lib/dashboard/data/*`, `lib/dashboard/types.ts` | `tsc` + e2e hijau |
| **B-W5** | e2e A2 + verifikasi regresi bot | `e2e/*.spec.ts` | `npm run e2e` hijau |

**Gate pemisah:** Fase B TIDAK dimulai sebelum Fase A lulus DoD (S14). Alasan: B-W1 menyentuh 3 handler
bot produksi; menumpuknya dengan perubahan route A meningkatkan area regresi.

---

## 14. Definition of Done (testable)

- `npm test` hijau (test baru S11: T1a-T1h, T2a-T2e, T3a-T3f2, T4a-T4i, T5a-T5f).
- `npx tsc --noEmit` exit 0 (kontrak `DataSource` + `dataKosong` diperluas; `satisfies` menagih).
- `npm run e2e` hijau (approve, tambah produk, konfirmasi opname, konfirmasi batch picking, sync
  per-kelompok, `?mock-401=1` per fitur).
- **Budget function 11/12 terbukti** (tidak ada `route.ts` baru; hitung manual + `vercel build`).
- **Bot TIDAK berubah perilaku:** T4a-T4i hijau; pemanggil callback lama tetap bekerja; `cekGuard`
  default `false` untuk jalur Telegram.
- **Guard dobel-proses terbukti:** T2a-T2f + T5f hijau (draft/batch diproses 1x; sync sebagian
  mempertahankan sisa; batch setengah jadi fail-closed).
- **Guard atomik terbukti:** T1b (A7 CAS), T3b2 (A5 create-only), T5f (batch) hijau.
- **B3 terbukti:** ketiga fungsi tidak lagi early-return senyap; T4h hijau; route memetakan `ok:false` -> 409.
- **B2 terbukti:** T4i hijau (bot menolak saat guard aktif); guard dibaca bot & route.
- **Aturan identitas terbukti:** T5c, T5d (fail-closed tanpa owner), T5e (anti-pemalsuan body) hijau.
- **Audit:** A5 -> `stock_movements source="web_dashboard"`; A7 -> `access_requests.resolved_by`;
  A2 -> movement `confirmed_by = sesi.uid`.
- **Pesan error** 400/403/404/409 persis tabel S4/S5 (string equality test).
- **Rules:** `draft_kirim_guard` server-only; `sessions` TETAP tertutup total.
- **State 401:** dialog/tidak tertutup & isian utuh diuji per fitur (e2e `?mock-401=1`).

---

## 15. Daftar file dibuat / diubah

**Dibuat:**
- `docs/dashboard-prd-v3b.md` (dokumen ini).
- `components/dashboard/dialog-tambah-produk.tsx` (A5).
- `lib/dashboard/draftOwner.js` (A2, server-only; validasi pemilik draft/batch).
- `test/*` (test A7/A5/A2 + regresi bot).
- `e2e/*` (spec baru).

**Diubah (Fase A):**
- `app/api/admin/route.ts` (tambah 4 aksi + dispatcher; TIDAK menambah route).
- `lib/dashboard/validasiTulisV3a.js` (dispatcher `validasiAksiAdmin` + validator v3b).
- `lib/models/accessRequests.js` (B4: `setujuiAccessRequest`/`tolakAccessRequest` transaksional CAS;
  TIDAK mengubah signature).
- `app/admin/page.tsx` (A7 UI).
- `app/stok/page.tsx` (A5 UI).
- `lib/dashboard/data/index.ts`, `real.ts`, `mock.ts`, `mock-data.ts`, `lib/dashboard/types.ts`,
  `lib/dashboard/sumber-data.tsx` (tipe request/response v3b + kontrak data-access).
- `firestore.rules` (tambah `draft_kirim_guard`).
- `docs/dashboard-deploy.md` (prosedur + catatan budget).

**Diubah (Fase B):**
- `app/draft/page.tsx` (A2 UI, kartu batch picking).
- `lib/handlers/handleOpname.js`, `lib/handlers/konfirmasiPickingList.js`,
  `lib/sheets/syncStokDuaArah.js` (opsi `kirimNotifikasi` + `cekGuard` + return `{ ok }` + `owner_user_id` draft).
- `lib/handlers/handleKonfirmasiCallback.js` (HANYA `:68` -> `Boolean(hasil?.ok)`; `:47,76` TIDAK diubah, N2).
- `lib/dashboard/data/*` + `lib/dashboard/types.ts` (`listPickingDrafts`, `owner_user_id` draft).

**TIDAK disentuh:** `app/api/admin/{role,tambah,hapus}/route.ts`, `lib/router/routePesan.js`
(return lama diabaikan, TIDAK berubah), `lib/gemini/**`, `lib/models/sessions.js` (tidak menambah
`hapusPendingSpecifik`), `lib/models/produk.js`, `lib/models/stok.js` (fungsi existing tetap dipakai
jalur bot apa adanya), `lib/handlers/handleKonfirmasiCallback.js:47,76`.

---

## 16. Risiko dan mitigasi

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Perubahan signature `konfirmasiOpname`/`konfirmasiSyncStok` merusak pemanggil bot | Alur confirm Telegram mati | Fallback string + test T4a-T4i; `routePesan.js` tidak diubah; hanya `:68` disesuaikan |
| R2 | Menambah `owner_user_id` ke draft bot = regresi penulisan draft | Draft bot gagal dibuat | Additive murni (field baru); test draft lama tetap terbaca (field opsional) |
| R3 | Dobel-proses (dashboard + Telegram) | Stok/picking dobel, audit ganda | Lapis 1 (status) + Lapis 2 (bot bersihkan `pending*`) + Lapis 3 (guard `draft_kirim_guard` DIBACA bot `cekGuard:true` + route) + return `{ ok }` (B3) |
| R4 | Sync sebagian salah bersihkan sesi | Kelompok sisa hilang | TIDAK menghapus `pendingSyncStok` dari route; serahkan ke bot; test T2c |
| R5 | Route gabungan 5 aksi rawan konflik merge | Deploy gagal | Satu dispatcher, validator terpisah per aksi, test per aksi |
| R6 | Sheets error (kuota) saat sync | 500 | Tangkap error -> 500 `"Gagal memproses draft."`; draft tidak berubah (status belum `processed`) |
| R7 | Notifikasi Telegram A7 gagal | User tak dapat balasan | Sukses tetap 200 + `notifikasi_terkirim:false`; owner lihat warning |
| R8 | Client perlu `owner_user_id` draft | UI tak bisa hide tombol | Field ditulis ke draft (additive); draft lama -> badge "Pemilik tidak diketahui" + fail-closed |
| R9 | Rate limit dipisah bucket | — | Bucket A 40/menit, B 20/menit; klaim eksplisit soft per-instance; monitor log |
| R10 | `hpp`/`stok_awal` salah ketik | Data kotor | Validasi integer >= 0, batas 1.000.000, error inline |
| **R11 (B2)** | **Bot membaca guard = perubahan bot produksi** | **Jalur Telegram bisa ikut tertolak bila `cekGuard` salah default** | **`cekGuard` default `false`; jalur Telegram tidak mengirimnya -> perilaku lama; T4i menguji `cekGuard:true` menolak hanya saat guard aktif** |
| **R12 (B3)** | **Return baru memecah pemanggil yang memakai boolean (`:68`)** | **`tutupCallback` salah menampilkan status** | **`:68` diubah ke `Boolean(hasil?.ok)`; T4f assert argumen; `routePesan.js` mengabaikan return** |
| **R13 (B4/B5)** | **Transaksi Firestore gagal (mis. contention)** | **Aksi gagal sementara** | **Retry transaksi standar Firestore; error non-sentinel -> 500 dengan pesan per aksi; log `[admin_*_reject]`** |

---

## 17. Pertanyaan terbuka (OQ)

- **OQ-1:** Bila kelak A2 terlalu besar untuk route gabungan, apakah boleh route baru (12/12)? Default: TIDAK.
- **OQ-2:** Form tambah produk di `/stok` (dialog) vs halaman `/produk/baru`? **DITUTUP:** dialog `/stok` (S10.2).
- **OQ-3:** Draft lama tanpa `owner_user_id` (pra-v3b) tidak bisa dikonfirmasi dari dashboard.
  **DITUTUP:** kebijakan FAIL-CLOSED (S7.2) - hanya via Telegram, oleh siapa pun termasuk owner.
  Backfill = tidak dilakukan di v3b (bila perlu, kandidat v3c).
- **OQ-4:** Perlukah `product_changes` untuk pembuatan produk (A5)? **DITUTUP:** TIDAK. Dokumen eksplisit:
  A5 tanpa `product_changes` disengaja; audit via `stock_movements` (`source:"web_dashboard"` +
  `nama_terbaca` + `created_by/requested_by/confirmed_by`). Audit field-level produk = v3c.
- **OQ-5:** Perlu menandai asal keputusan A7 (`resolved_via`) di `access_requests`? Default: TIDAK di
  v3b; kandidat v3c (gap audit A7 diakui, S9).
- **OQ-6:** Rate limit `admin:{uid}` 40/menit vs memisah bucket per aksi? **DITUTUP:** bucket dipisah
  (A: 40/menit, B draft: 20/menit), S4.3.
- **OQ-7:** Bolehkan admin mengonfirmasi draft miliknya bila ia BUKAN admin aktif lagi (sudah di-revoke)?
  Default: `ambilAdmin` null/bukan admin -> 403 (mengikuti S7.1 umum).
- **OQ-8:** Batch picking setengah jadi (sebagian `processed`) - auto-heal atau manual? Default: TIDAK
  auto-heal; route fail-closed 409 `"Batch picking ini diproses sebagian. Selesaikan lewat Telegram."`
  (S8.4). Auto-heal = kandidat v3c.

---

## 18. Monitoring dan rollback

- **Monitoring:** log `[admin_approve_akses_success]`, `[admin_approve_notif_gagal]`,
  `[admin_tambah_produk_success]`, `[admin_konfirmasi_draft_success]`, `[admin_v3b_reject]` (alasan),
  `[draft_guard_failed]`, `[draft_kirim_guard_reject]`, `[konfirmasi_draft_no_op]` (B3: `ok:false`).
- **Rollback:** fitur v3b additive di route gabungan. Menonaktifkan = guard pada dispatcher (aksi v3b
  -> 400), tanpa menyentuh v3a. Perubahan bot (`kirimNotifikasi`/`cekGuard`/`owner_user_id`/return `{ok}`)
  TIDAK perlu di-rollback: `kirimNotifikasi` default `true`, `cekGuard` default `false`, field opsional,
  dan return baru hanya dipakai `:68` (yang ikut di-rollback bersama bacaannya).
- **Pemicu rollback:** lonjakan `[admin_*_reject]` 500 di atas ambang, laporan stok dobel, atau
  `[konfirmasi_draft_no_op]` meningkat -> matikan aksi `konfirmasi-draft` (set 400) sambil investigasi.

---

## 19. Acceptance criteria (ringkas, testable)

- [ ] `POST /api/admin` `{aksi:"approve-akses"}` oleh owner -> 200, `access_requests.status="approved"`,
  notif terkirim; oleh admin -> 403; request non-pending -> 409 `"Request ini sudah diproses sebelumnya."`;
  DUA approve paralel -> tepat satu sukses (T1b).
- [ ] `POST /api/admin` `{aksi:"tambah-produk"}` -> `products.is_online_product=true`, `stock` dibuat;
  kode duplikat -> 409 persis pesan bot; DUA tambah paralel kode sama -> tepat satu sukses (T3b2).
- [ ] `POST /api/admin` `{aksi:"konfirmasi-draft"}` opname -> draft `processed`, `pending*` bersih,
  tidak dobel; draft sudah diproses -> 409; admin bukan pembuat -> 403; tanpa owner -> 409 (fail-closed);
  `owner_user_id` di body diabaikan (T5e).
- [ ] `{aksi:"konfirmasi-draft", jenis:"picking", batch_id}` -> SELURUH movement batch `processed`;
  ringkasan batch tampil; dua konfirmasi batch paralel -> satu 409; batch setengah jadi -> 409 (T5b/T5f).
- [ ] Bot TIDAK berubah: T4a-T4i hijau; pesan Telegram bot pada jalur lama tetap terkirim;
  `cekGuard` default `false` di jalur Telegram.
- [ ] B3: ketiga fungsi tidak early-return senyap; `{ok:false}` -> route 409 (bukan 200).
- [ ] B2: guard `draft_kirim_guard` dibaca bot (`cekGuard:true`) & route; TTL 10s.
- [ ] Sync per-kelompok: konfirmasi 1 kelompok -> sisa tetap ada; konfirmasi semua -> bersih (T2c, T5a).
- [ ] State 401: dialog tidak tertutup & isian utuh per fitur (e2e `?mock-401=1`).
- [ ] Budget function 11/12; tidak ada route baru.
- [ ] `npm test` + `npx tsc --noEmit` + `npm run e2e` hijau.
---

## 20. Edge case & state kosong (testable)

| # | Skenario | Perilaku final | Test |
|---|---|---|---|
| E-1 | Draft tanpa `owner_user_id` (opname/sync lama) | Kartu badge "Pemilik tidak diketahui", TANPA tombol; route 409 | T5d |
| E-2 | Picking batch tanpa `created_by` (movement non-screenshot) | Fail-closed: 409 `"Pemilik draft tidak dapat diverifikasi. Proses lewat Telegram."` | T5d |
| E-3 | Batch picking setengah jadi (sebagian `processed`, sebagian `pending_confirmation`) | 409 `"Batch picking ini diproses sebagian. Selesaikan lewat Telegram."`; TIDAK memanggil bot | T5f-var |
| E-4 | Tombol Telegram lama ditekan setelah draft di-konfirmasi dashboard | `pending*` sudah kosong -> bot `{ok:false, alasan:"tidak_ada_pending"}` -> alert "Sudah diproses sebelumnya atau kadaluarsa." | T4h |
| E-5 | `konfirmasi-draft` sync `kondisi` kelompok sudah kosong | 409 `"Tidak ada draft kelompok itu yang masih pending."` | T2c |
| E-6 | Guard `draft_kirim_guard` aktif (dobel cepat < 10s) | 409 `"Draft sedang diproses."`; satu invocation lanjut | T2d |
| E-7 | `runTransaction` guard throw error tak terduga | Log `[draft_guard_failed]`, LANJUT aksi sah (tidak blokir) | mock throw |
| E-8 | Sheets kuota habis saat sync/picking | 500 `"Gagal memproses draft."`; draft tidak berubah | T-e2e |
| E-9 | A5 `stok_awal = 0` | `stock` dibuat dengan 0; `stock_movements` tetap ditulis (qty 0) | T3c/T3d |
| E-10 | A5 kode sudah ada (bukan race) | 409 persis pesan bot; `products`/`stock` tidak berubah | T3b |
| E-11 | A7 request sudah diproses (dobel) | 409 `"Request ini sudah diproses sebelumnya."` | T1b |
| E-12 | State kosong `/draft` (tanpa opname/sync/picking pending) | Empty state existing + seksi Picking List kosong "Belum ada picking list." | e2e |
| E-13 | 401 mid-write semua fitur | Dialog tetap terbuka, isian utuh, toast `SESI_KEDALUWARSA` + "Buka ulang" | e2e `?mock-401=1` |