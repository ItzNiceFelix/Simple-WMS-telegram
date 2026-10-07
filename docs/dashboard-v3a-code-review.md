# Code Review — Dashboard v3a (Permintaan Harian + Keyword Notes)

Reviewer: senior reviewer independen. Tanggal: 2026-09-16.
Metode: baca diff + file untracked apa adanya; jalankan `npm test` + `npx tsc --noEmit`.
Tidak ada kode yang diubah. Tidak ada proses node dimatikan.

---

## Verdict

**CHANGES REQUESTED**

Alasan satu kalimat: kontrak inti (B1–B6, T1, T4, route/pola, race guard, rules, Telegram plain
+ `telegram_user_id`) BENAR dan terbukti di test, tetapi ada **satu bug nyata di jalur baca UI real**
(`datang_at` selalu jadi `null`) yang TIDAK tertangkap karena mock menulis ISO string sementara
server menulis objek `Date` — jadi e2e hijau palsu — plus satu penyimpangan kontrak robustness
(`buatForm` tidak tahan `items` bukan array, E18). Keduanya harus diperbaiki sebelum merge.

---

## Blocking

### BLOCKING-1 — `datang_at` hilang di jalur baca UI mode REAL (mock menyamarkan)

- **Bukti model menulis objek `Date`:**
  - `lib/models/dailyRequests.js:284-293`
    ```js
    const sekarang = new Date();
    ... itemsBaru = items.map((it, i) => i === idx
      ? { ...it, status: "datang", qty_datang: qtyDatang, datang_at: sekarang, datang_by: oleh } ...
    ```
- **Bukti normalizer TIDAK mengonversi `datang_at`:** `lib/dashboard/data/normalisasi.ts:47-48`
  ```ts
  datang_at: typeof it.datang_at === "string" ? it.datang_at : null,
  datang_by: typeof it.datang_by === "string" ? it.datang_by : null,
  ```
  `normalisasiDokumen` (`normalisasi.ts:96-114`) menyerahkan `items` mentah ke `normalisasiItemLama`
  tanpa memakai `keIso`. Padahal `keIso` sudah disuntik justru untuk konversi Firestore Timestamp/Date
  (komentar `normalisasi.ts:94` + PRD §4.1 sendiri: "normalizer di `real.ts` (S4.2) mengonversi
  `Date` Firestore -> ISO via `keIso`").
- **Akibat nyata (mode real):** UI membaca lewat `real.ts:339-347` → `normalisasiDokumen(d.id, d.data(), keIso)`.
  Untuk item yang baru ditandai datang, `datang_at` adalah objek `Date` → `typeof !== "string"` →
  `null`. Konsumen UI: `components/dashboard/dialog-barang-datang.tsx:129`
  `{formatAngka(item.qty_datang)} pcs · {formatTanggal(item.datang_at)}` → `formatTanggal(null)` = `"—"`
  (`format.ts:67-68`). **Waktu terima tidak pernah tampil di produksi.**
- **Kenapa tidak tertangkap test:** mock menulis ISO string — `lib/dashboard/data/mock.ts:467`
  `datang_at: sekarang` (`sekarang = new Date().toISOString()`). Test model (`test/permintaanHarian.test.js:246`)
  hanya `assert.ok(doc.items[0].datang_at)`, tidak mengasrt tipe/konversi. `e2e/*` hanya mode mock.
- **Perbaikan konkret:** di `normalisasi.ts`, jadikan `datang_at` sadar-`keIso`, mis.
  `normalisasiItemLama(mentah, keIso?)` (default `(v)=>typeof v==="string"?v:null`) dan panggil dengan
  `keIso` dari `normalisasiDokumen`; `real.ts` sudah mengirim `keIso`. Tambah test unit: item dengan
  `datang_at: new Date("2026-09-15T10:00:00Z")` → hasil normalisasi `typeof === "string"` dan
  bukan `null`. (PRD §10 #1b hanya menguji item lama, tidak menguji tipe `datang_at` — tambah.)

### BLOCKING-2 — `buatForm` tidak tahan `items` bukan array (langgar E18 → 500, bukan 400/404)

- **Bukti:** `lib/models/dailyRequests.js:232`
  ```js
  const asli = (data.items || []).map(normalisasiItemLama);
  ```
  Bila `items` truthy tapi bukan array (mis. objek/string = data rusak), `.map` bukan fungsi →
  `TypeError` → route jatuh ke `galatModel` (`app/api/permintaan/route.ts:221-227`) → **500
  "Gagal memperbarui permintaan."**.
  Padahal `sesuaikanQtyItem` (`:161`) dan `tandaiItemDatang` (`:271`) memakai
  `Array.isArray(...) ? ... : []`, dan PRD E18 eksplisit: "`items` bukan array (data rusak) →
  Normalizer mengembalikan `[]`; aksi → 400/404".
- **Perbaikan konkret:** ganti ke
  `const asli = (Array.isArray(data.items) ? data.items : []).map(normalisasiItemLama);`
  (satu baris; samakan dengan dua fungsi lain). Tambah test E18 untuk `buatForm`.

---

## Non-blocking

### NB-1 — BOM (U+FEFF) baru ditambahkan ke `firestore.rules` dan `nav-config.ts`
- **Bukti byte:** `firestore.rules` lama mulai `114,117,108,101` (`rule`), baru `239,187,191,114`
  (BOM `EF BB BF`). Sama untuk `components/dashboard/nav-config.ts` (`47,47,32` → `239,187,191,47`).
- **Risiko:** `firebase deploy --only firestore:rules` umumnya toleran, tetapi ini perubahan tak
  diminta tanpa nilai. `nav-config.ts` di sisi lain punya baris pertama `﻿// ...` (BOM menempel ke komentar).
- **Saran:** hapus BOM (simpan sebagai UTF-8 tanpa BOM). Jangan andalkan asumsi parser.

### NB-2 — Mojibake U+FFFD di komentar `types.ts`
- **Bukti byte:** `lib/dashboard/types.ts:103` berisi `32,118,51,97,32,65533,52,46,49` → `§` menjadi
  `U+FFFD` (`PRD v3a ?4.1`). Sama di baris 134, 149, 356, 365, 381, 401, 417.
- Hanya komentar → nol dampak runtime. Perbaiki agar grep dokumen tidak rusak.

### NB-3 — Paritas mock ≠ server untuk `sesuaikan` (`qty_diminta` strip)
- Server `sesuaikanQtyItem` membuang `qty_diminta` pada item yang aslinya tak punya field
  (`dailyRequests.js:200-207`), ketat sesuai §4.3. Mock `sesuaikanQtyPermintaan`
  (`mock.ts:366-397`) TIDAK melakukan strip, dan `dokumenMock` (`mock.ts:90-95`) selalu menormalisasi
  sehingga `qty_diminta` selalu ada. Jadi e2e tidak pernah menguji jalur "draft lalu sesuaikan".
  Bukan bug produksi, tetapi melemahkan R7 ("mock meniru guard server").
- **Saran:** tambahkan strip yang sama di mock, atau catat sebagai batas mock.

### NB-4 — `datang` pada item `qty_diminta === 0` tidak menolak 409 (E19)
- PRD §4.4/E19: `datang` pada item qty 0 "tetap DIIZINKAN … server mengembalikan 409
  `Item ini sudah ditandai datang.` bila tidak ada perubahan". Implementasi
  `tandaiItemDatang` (`dailyRequests.js:282`) hanya menolak bila `status === "datang"`, sehingga
  item `qty_diminta === 0` akan **berhasil** ditandai datang (bukan 409). UI tidak merender tombolnya
  (`dialog-barang-datang.tsx:131-134`, `page.tsx:413`), jadi tidak terjangkau lewat UI normal, tetapi
  kontrak server belum persis. Klarifikasi PRD ambigu ("diizinkan" vs "409"); putuskan & samakan.

### NB-5 — `data-testid` UI menyimpang dari PRD §3.9
- PRD: `aksi-ubah-jumlah`, `aksi-kirim-form`, `aksi-kirim-ulang`, `aksi-barang-datang`,
  `dialog-konfirmasi-selesai`, `badge-qty-desync`, `badge-tidak-diminta`.
- Implementasi: `tombol-ubah-jumlah`, `tombol-kirim-form`, `tombol-kirim-ulang`,
  `tombol-barang-datang`, `konfirmasi-selesai`, `badge-desync`; `badge-tidak-diminta` TIDAK ada
  (badge hanya teks, `page.tsx:428`). Uji e2e internal konsisten, jadi bukan regresi — tetapi
  menyimpang dari kontrak spec dan menyulitkan test lintas-tim.

---

## Nit

- **NIT-1** — `formatAngka` diduplikasi: `dailyRequests.js:386-388` mendefinisikan sendiri
  (`n ?? 0`) sementara `lib/dashboard/format.ts:52-55` mengembalikan `"—"` untuk null. Aman untuk
  data kanonik, tetapi dua sumber perilaku. Sudah tercatat di `docs/test-report.md:130`.
- **NIT-2** — `lib/dashboard/data/real.ts:350-351` `const s = await sesi(); void s;` — variabel
  tak terpakai sebagai "side-effect" check. Hapus atau pakai hasilnya.
- **NIT-3** — `sesuaikanQtyPermintaan` route (`route.ts:142-150`) mengembalikan seluruh array
  `perubahan` (maks 50) sebagai `items` + mengambil `perubahan_terakhir`; respons bisa besar
  (dokumen dengan 50 entri x riwayat) — cukup kirim `perubahan_terakhir` + `items`.
- **NIT-4** — `docs/dashboard-v3a-plan.md:12` menyebut "Setelah v3a +2 route = 11/12" — benar.
  Angka `npm test` 221 vs laporan lama 211/218 sudah dijelaskan di `docs/learnings.md` (ditambahkan
  di diff ini) — bagus.

---

## Verifikasi B1–B6 + T1/T4

| Kode | Verdict | Bukti |
|---|---|---|
| **B1** (`datang` hanya di `diproses`) | **PASS** | Route `route.ts:126-129` → 409 `"Kirim form dulu sebelum menandai barang datang."`; test `test/permintaanRoute.test.js:150-159`; mock paritas `mock.ts:446-450`. UI tidak merender tombol di draft (`page.tsx:250-261`). |
| **B2** (snapshot `qty_diminta` termasuk item bot hanya-`qty`) | **PASS** | `dailyRequests.js:240-243` `item.status === "datang" ? item : { ...item, qty_diminta: item.qty ?? 0 }`, acuan selalu `qty`. Test `permintaanHarian.test.js:211-219` (`qty_diminta === 12`, `!== undefined`). |
| **B3** (normalizer di jalur baca UI `real.ts`/`mock.ts`) | **PASS (dengan cacat BLOCKING-1)** | `real.ts:345` → `normalisasiDokumen(..., keIso)`; `mock.ts:333-337`; seed item lama `mock-data.ts`. Namun konversi waktu item (`datang_at`) bocor → BLOCKING-1. |
| **B4** (`dataKosong` 6 method, `satisfies` menagih) | **PASS** | `sumber-data.tsx:217-227` menambah tepat 6 method + `} satisfies DataSource;`; `npx tsc --noEmit` exit 0. |
| **B5** (`perubahan[]` max 50 + `updated_at/by`) | **PASS** | `dailyRequests.js:191-198` push entri; `:214` `slice(-MAKS_PERUBAHAN)`; `:215-216` `updated_at/by`. Test `:156-181` (3b/3c: 51 → 50). |
| **B6** (item qty 0 auto-selesai + `selesai` manual ada) | **PASS** | `itemEfektifSelesai` `:66-68`; auto-selesai di dalam transaksi `:298`; `selesaikanRequest` `:321-339` (dipakai route `:210-218`). Test `:251-262`, `:374-392`. Catatan E19: NB-4. |
| **T1** (gabung hanya bila kode+variasi+buffer sama) | **PASS** | `gabungItemDuplikat` kunci `${kode}::${variasi}::${buffer}::${status}` `:45-63`; test `:96-119` (buffer beda → 2 baris, campuran datang → 2 baris). |
| **T4** (tanpa `/api/kata-kunci`; route lama tak diubah; 11 function) | **PASS** | `Test-Path app/api/kata-kunci` = `False`; `git diff --stat` untuk `app/api/admin/role|tambah|hapus/route.ts` kosong; `app/api/**/route.ts` = 10 + `api/webhook.js` = **11/12**. |

### Regresi & konsistensi (poin 4–9 brief)

| Cek | Verdict | Bukti |
|---|---|---|
| `tambahItemKeDailyRequest` tidak berubah | **PASS** | Diff hanya menyisipkan setelah `:133`; blok `:109-134` identik. Test `:519-529`. |
| `updateStatusDailyRequest` dipakai (bukan dead) | **PASS** | `selesaikanRequest` `:333`; diekspor `:425`. |
| `konfirmasiKeyword` tidak diduplikasi | **PASS** | `perbaruiInterpretasi` `keywordNotes.js:145` memanggil `konfirmasiKeyword`. |
| Fungsi existing `keywordNotes.js` tidak berubah | **PASS** | Diff hanya blok baru `:111-149` + ekspor. Test `kataKunci.test.js:90-93`. |
| Pola route (origin→cookie→sesi→rate→validasi→`ambilAdmin`→model→log) | **PASS** | `permintaan/route.ts:49-97`, `admin/route.ts:32-77`; urut, `runtime="nodejs"`, `dynamic="force-dynamic"`. |
| Role dari Firestore, bukan body/sesi | **PASS** | `ambilAdmin(sesi.uid)` `permintaan:82-87`, `admin:64-69`; role body tidak dibaca. |
| Race `buat-form` atomik (`runTransaction`) | **PASS** | `periksaGuardForm` `route.ts:258-269` baca+set dalam `db.runTransaction`; idempotensi 30s `:156-160` (mock paritas `mock.ts:408-417`). |
| Backward-compat item/dokumen lama | **PASS (kecuali BLOCKING-1)** | `normalisasiItemLama` mengisi `status`/`qty_diminta`; item lama bot hanya `{kode,nama,variasi,qty,buffer}` tetap terbaca. |
| Kirim pakai `admin.telegram_user_id`, dedupe, gagal tidak rollback | **PASS** | `kirimFormPermintaan` `:392-418` (`admin?.telegram_user_id`, `Map` dedupe `:399-404`, `try/catch` `:409-415`); test `#9` `:476-515`. Route `:188-189` `peringatan_kirim` tanpa rollback. |
| Pesan persis §3.5, U+00B7, TZ-safe | **PASS** | `formatPesanPermintaan` `:347-384`; test `#7`/`#7b` `:406-460` (string equality + TZ NY/UTC). |
| UI state (loading/kosong/error/sukses/401) + Riwayat existing | **PASS** | `page.tsx:150-165` error/loading; Empty `:177-188`; Riwayat `:303-363` dipertahankan; dialog 401 menahan isian (`dialog-ubah-jumlah.tsx:88-92`). |
| `buffer` ikut payload `sesuaikan`/`datang` | **PASS** | `dialog-ubah-jumlah.tsx:76`; `dialog-barang-datang.tsx:71`; validasi `validasiTulisV3a.js:90,111`. |

---

## Hasil perintah

| Perintah | Hasil |
|---|---|
| `npm test` | **HIJAU** — `tests 221 / pass 221 / fail 0`, `duration_ms 4587`. |
| `npx tsc --noEmit` | **exit 0** (output hanya `npm notice`, tidak ada diagnostik TS). |
| `npm run e2e` | **TIDAK dijalankan** (butuh build 240s; di luar izin yang diminta). Konsekuensi: klaim e2e hijau belum diverifikasi reviewer. |
| `vercel build` / bukti 11 function | **TIDAK dijalankan.** Bukti budget dihitung statis (10 `route.ts` + 1 `api/webhook.js`). |

---

## Yang dinilai aman

- State machine + seluruh pesan error Bahasa Indonesia persis tabel PRD §5.1 (peta
  `PETA_ERROR_MODEL` `route.ts:38-46`).
- Kebijakan tanggal server-side: `sesuaikan` lampau → 400, aksi lain lampau → boleh, masa depan → 400
  (`validasiTulisV3a.js:36-56,71-75`; test `#10c`).
- Semua mutasi array `daily_requests` memakai `runTransaction` (`sesuaikanQtyItem`, `buatForm`,
  `tandaiItemDatang`, `tambahItemKeDailyRequest`). `buatForm` transaksi mengembalikan `itemsFinal`
  untuk dikirim, bukan membaca ulang (aman).
- Auto-selesai dievaluasi DI DALAM transaksi `tandaiItemDatang` (`:298`) — anti race E11.
- Rules: `daily_requests`/`keyword_notes` tetap `read staff / write false`, `permintaan_form_guard`
  server-only (`firestore.rules:23,30,35`).
- Guard double-submit best-effort tidak memblokir aksi sah saat gagal (`route.ts:270-273`).
- Validasi tipe input ketat: `qty` string `"12"` ditolak, integer ≥ 0 ≤ 1.000.000.
- Pemisahan `formatTanggalCjs.js` sebagai replika CJS TS (dengan test parity) — solusi wajar untuk
  batas `require` .ts.

## Yang belum bisa diverifikasi

- `npm run e2e` (Playwright) belum dijalankan → perilaku UI nyata (saran stok, badge, 401 mid-write,
  izin) belum terbukti end-to-end oleh reviewer.
- `firebase deploy --only firestore:rules` dengan BOM belum diuji (NB-1).
- `vercel build` (batas 12 function Hobby) belum dijalankan; hitungan 11 statis.
- Jalur tulis REAL (Firestore + Telegram nyata) tidak diuji — test stub Firestore/Telegram.
- Perilaku `datang_at` di real (BLOCKING-1) tidak dapat dibuktikan sebelum diperbaiki; bukti saat ini
  adalah pembacaan kode (Date → `null`).
