# Code Review - Dashboard v2 (kode, bukan keamanan)

Reviewer: senior code reviewer (independen). Tanggal: 2026-09-15.
Metode: `git status`/`git diff`/file untracked dibaca; `npm test` + `npx tsc --noEmit` dijalankan.
Sumber kontrak: `docs/dashboard-v2-plan.md`, `docs/dashboard-prd-v2.md`,
`docs/dashboard-prd-v2-review.md`, `docs/development.md`. Kode TIDAK diubah.

## Verdict

**CHANGES REQUESTED** - ada 1 bug frontend nyata (regresi state dialog, B-01) dan 3 gap
kontrak/kualitas test yang terikat DoD PRD (B-02..B-04). Logika server/model secara umum benar
dan solid; test + typecheck hijau.

---

## Blocking (harus diperbaiki)

### B-01. State dialog tidak pernah sinkron ulang dengan data produk -> nilai basi setelah refetch
- **Di mana:** `components/dashboard/dialog-edit-hpp.tsx:48-49`
  ```
  const [hppText, setHppText] = useState(() => teksAwal(produk.hpp))
  const [hppBaruText, setHppBaruText] = useState(() => teksAwal(produk.hpp_baru))
  ```
  `components/dashboard/dialog-edit-reorder.tsx:50`
  ```
  const [reorderText, setReorderText] = useState(() => teksAwal(reorderSekarang))
  ```
- **Masalah:** inisialisasi lazy hanya berjalan pada mount pertama. Komponen dialog TIDAK
  di-unmount saat `open=false` - parent merender kondisional hanya pada level role
  (`app/produk/[kode]/page.tsx:290-297`, `:299-309`), sehingga `<Dialog open={false}>` tetap
  ter-mount selama role tidak berubah. Akibatnya state `hppText`/`hppBaruText`/`reorderText`
  tidak pernah diisi dari `produk`/`reorderSekarang` yang baru.
- **Repro (bukti kode):** user buka dialog HPP, isi `90000`, "Batal" -> `tutup(false)` memanggil
  `reset()` (`:53-58`) yang menulis ulang `teksAwal(produk.hpp)` memakai `produk` dari *closure
  render saat itu*, lalu parent refetch? Tidak - parent hanya refetch pada sukses
  (`onSukses`). Kasus nyata: (a) simpan sukses -> `onOpenChange(false)` + `onSukses()` refetch,
  state di-reset oleh `reset()` sebelum `produk` baru tiba (`:88-90`) sehingga nilai awal basi;
  (b) halaman lain/stale prop. Setelah refetch, membuka ulang dialog menampilkan nilai input dari
  state lama, BUKAN dari `produk` baru. `DialogEditReorder` idem; `DialogKoreksiStok`
  (`components/dashboard/dialog-koreksi-stok.tsx`) pun mengembalikan `""` lewat `reset()`.
- **Dampak:** pengguna bisa menyimpan nilai yang ia kira nilai lama padahal nilai sudah berubah di
  server; pada dialog reorder, `preview-status-reorder` (`:58`) dihitung dari `reorderSekarang`
  prop (benar) sementara input bisa berisi teks basi -> inkonsistensi yang terlihat.
- **Perbaikan konkret:** sinkronkan saat `open` menjadi true, mis.
  ```
  useEffect(() => {
    if (open) { setHppText(teksAwal(produk.hpp)); setHppBaruText(teksAwal(produk.hpp_baru)); setError(null); }
  }, [open, produk.hpp, produk.hpp_baru])
  ```
  sama untuk `dialog-edit-reorder.tsx` (`[open, reorderSekarang]`).

### B-02. DoD PRD 6.5/6.2 (B4) tidak terpenuhi: `getSession()` mock & real tidak ada test
- **DoD:** `docs/dashboard-prd-v2.md:1185` "**F5:** `getSession()` (mock & real) mengembalikan
  `superAdmin: boolean`" dan `:735` "assert `getSession()` (mock DAN real) mengembalikan
  `superAdmin` bertipe boolean (bukan `undefined`)".
- **Bukti:** grep `test/` untuk `getSession` -> NONE. `test/superAdmin.test.js:23-25` hanya menguji
  helper lokal `hitungSuperAdmin` + `isSuperAdminDariEnv`; tidak ada assertion atas `superAdmin`.
  `docs/verification.md` sendiri sudah menandai ini "SEBAGIAN".
- **Dampak:** field `superAdmin` adalah satu-satunya penghubung F5; kalau `real.ts:111`
  (`superAdmin: data.superAdmin === true`) atau `mock.ts:181` berubah/terlewat, tidak ada test yang
  merah. UI (`app/pengaturan/page.tsx:217-219`) menampilkan "—" saat `null`.
- **Perbaikan:** tambah test yang (a) memanggil `makeMockDataSource(() => "owner").getSession()` dan
  assert `typeof superAdmin === "boolean"` + `role==="admin"` -> `false`; (b) assert kontrak
  respons auth (bisa lewat unit murni `isSuperAdminDariEnv || role==="owner"` yang meniru
  `route.ts:98`, atau test route handler).

### B-03. Parity mock-vs-server cacat di `ubahHpp` dan `hapusAdmin` -> hijau palsu
- **`mock.ts:377-398` (`ubahHpp`)** tidak melakukan validasi tipe sama sekali:
  - `req.hpp` diterima tanpa `Number.isInteger(>=0)`; route menolaknya di `validasiHpp`
    (`validasiTulisV2.js:28`) -> "HPP harus bilangan bulat >= 0."
  - `if (adaHpp) produk.hpp = req.hpp ?? null` (`:394`) menulis `null` ke `hpp`; server menolak
    `hpp: null` (`validasiTulisV2.js:28`: `typeof null !== "number"` -> 400). Mock lebih longgar.
- **`mock.ts:124-137` (`guardHapusAdmin`)** tidak punya guard super-admin env. Server menolaknya
  (`validasiTulisV2.js:128-130` "Super admin (env) tidak dapat dihapus dari dashboard."). Di mock,
  menghapus akun yang id-nya di `SUPER_ADMIN_ID` akan SUKSES.
- **Kontrak:** `docs/dashboard-prd-v2.md:941-943` ("mock wajib menyimulasikan guard SAMA PERSIS
  dengan server... Mock yang lebih longgar dari server = test UI hijau palsu") + DoD `:1193`.
- **Bukti test tidak menangkap:** `e2e/dashboard-v2.spec.ts` hanya menguji happy-path + 409 + disable
  baris sendiri. `adminKelola.test.js` menguji `validasiTulisV2`/model, bukan mock DataSource.
- **Perbaikan:** tambah pemeriksaan integer di `ubahHpp` mock (tolak non-integer dan `hpp:null`),
  dan tambah guard `isSuperAdminEnv` di `guardHapusAdmin` mock (mock bisa membaca id env lewat data
  seed atau konstanta mock). Tambahkan test paritas tabel guard.

### B-04. Test "mirror route" menduplikasi logika route, bukan mengeksekusinya (status/pesan/urutan tidak tereksekusi)
- **Di mana:** `test/editProduk.test.js:26-67` (`jalankanEditHpp`), `test/adminRole.test.js:24-39`
  (`ubahRoleRoute`), `test/adminKelola.test.js:34-85` (`tambahRoute`/`hapusRoute`).
- **Masalah:** tidak satu pun test meng-import `app/api/**/route.ts` (konfirmasi `docs/verification.md`
  section 2.1: grep `app/api` di `test/` -> NONE). Helper menyalin urutan
  validasi -> owner-only -> 404 -> idempoten -> tulis -> audit. Bila urutan route salah (mis. 404
  sebelum cek owner, atau audit sebelum tulis), test tetap hijau.
- **Dampak:** klaim DoD `:1173` "Semua kontrak route ... diimplementasikan persis (path, status,
  pesan)" hanya terbukti lewat pembacaan kode, bukan eksekusi. Sudah tercatat sebagai risiko di
  `docs/learnings.md` (paragraf terakhir) - jadi ini diketahui, tetapi DoD belum tertutup.
- **Perbaikan:** tambah test yang memanggil `POST()` route dengan stub `next/server`
  (`NextResponse.json`) + `require` model di-mock, atau minimal Playwright yang menembak route
  nyata untuk 1 route (401/403/404/200). Kalau harness ditolak, turunkan klaim "persis" di DoD atau
  tandai eksplisit sebagai verifikasi-inspeksi.

---

## Non-blocking (akurasi kontrak / maintainability)

### N-01. `app/admin/page.tsx:172` - `uid ?? ""` berpotensi menonaktifkan aksi yang seharusnya aktif
`uid` diisi dari `data.getSession()` (`:70-71`) yang diselesaikan paralel dengan `listAdmins`.
Tidak ada `if (!sesi)`; bila `getSession()` reject, `Promise.all` melempar -> `setError(true)`
dan tabel tidak dirender (aman). Namun bila sukses dan `uid` belum ter-commit, render pertama
memakai `uid === null -> ""`; `aksi-role-admin.tsx:50` `sendiri = admin.telegram_user_id === uid`
menjadi false untuk SEMUA baris. Bukan bug saat data normal, tapi jangan kirim sentinel `""` sebagai
uid; render kolom aksi hanya bila `uid !== null` (sama seperti `kelola-admin.tsx:126` yang sudah
memakai `uid !== null`).

### N-02. `setReorderPoint` - cek dokumen dan tulis tidak atomik (TOCTOU)
`lib/models/stok.js:153-163`: `ambilStok` lalu `doc.set(..., {merge:true})`. Dokumen `stock` bisa
dihapus di antara dua langkah, dan `set merge` akan MEMBUAT ulang dokumen - kondisi yang justru
mau dicegah (spec E13, plan baris 17). Sangat sempit (butuh delete konkuren), dan tidak
transaksional di v2 memang diterima (Q1), tetapi solusinya sepele:
```
const ref = db.collection(KOLEKSI).doc(kodeBarang);
await db.runTransaction(async (trx) => { if (!(await trx.get(ref)).exists) throw new KodeTidakAda(); trx.set(ref, {...}, {merge:true}); });
```

### N-03. Bug B1 hanya diperbaiki di `cekReorderPoint`/`reminderHarian`; pola `admin.id` masih ada
`lib/telegram/notifikasiError.js:43` masih `admin.telegram_user_id || admin.id`. Fallback ke
`admin.id` selalu undefined sehingga klausa itu dead; tidak berbahaya, tapi menyisakan pola yang
sama yang jadi akar B1. Bersihkan menjadi `admin.telegram_user_id` saja agar grep konsisten.

### N-04. `lib/models/stok.js:175` - pembacaan ulang dokumentasi setelah tulis
`return { stok: await ambilStok(kodeBarang), notifikasi }` melakukan GET kedua yang tidak perlu
(route reorder-point hanya memakai `.notifikasi`, lihat `route.ts:121`). Bisa dikembalikan objek
`stok` yang sudah diketahui, atau minimal dokumentasikan bahwa nilai balik tidak dikonsumsi.

### N-05. `hitungRataRataPemakaianHarian` memakai rata-rata magnitudo, bukan pemakaian bersih
`lib/reminder/reminderHarian.js:89` `total + Math.abs(qty)`. Query menyaring
`type=keluar_resi`, `action_type=kurangi_stok`, `status=processed` (`:75-82`), jadi `Math.abs`
memadai untuk data saat ini. Tetapi bila koreksi stok keluar tercampur (positif), `Math.abs` akan
menghitung penambahan sebagai pemakaian -> proyeksi "habis" terlalu cepat. Query sudah
mengasumsikan hanya delta negatif; beri komentar eksplisit atau filter `qty < 0` agar invariannya
dijaga.

### N-06. E2E tidak menutup beberapa state yang diwajibkan spec
`e2e/dashboard-v2.spec.ts` tidak menguji:
- 401 mid-write untuk route selain HPP (`:58-70` hanya HPP), padahal DoD `:1189` "minimal 1 route"
  terpenuhi - jadi ini aman, tapi `mock-401=1` sudah global dan murah untuk diulang di F2/F3/F4.
- F5 non-owner (`:188-194` hanya owner); PRD `:714-719` bilang admin/guest tidak melihat daftar.
  `app/pengaturan/page.tsx:208` benar (`adalahStaff`), tetapi tidak ada bukti test.
- Validasi klien dialog reorder (string non-digit) dan tombol "Hapus reorder point"
  (`dialog-edit-reorder.tsx:165-170`) tidak diuji.

### N-07. Doc drift: `docs/verification.md` & sebagian `docs/test-report.md` menggambarkan state lama
`docs/verification.md` menyatakan "Stub minimal mock.ts/real.ts melempar 'belum diimplementasikan
(Wave 3b)'" dan "`sumber-data.tsx` masih memakai cast `as unknown as DataSource`" - keduanya SUDAH
tidak benar di diff ini (`mock.ts`/`real.ts` terimplementasi; `sumber-data.tsx:220` memakai
`satisfies DataSource`). Demikian pula `docs/test-report.md:17` menyebut "134 pass" sedangkan
aktual 135. Dokumen ini tidak di-scope PRD v2, tapi jangan dibiarkan sebagai bukti yang menyesatkan.

### N-08. `ubahHpp` mock: perbandingan idempoten berbeda dari server untuk `hpp` bertipe aneh
`mock.ts:389` `produk.hpp === req.hpp` - karena mock tidak memvalidasi tipe, `req.hpp = "90000"`
akan lolos dan menulis string ke `hpp` mock. Ini satu paket dengan B-03 (validasi tipe) dan akan
tertutup bila B-03 diperbaiki.

---

## Nit

### NIT-01. Parser `validasiTambahAdmin` menerima username aneh
`validasiTulisV2.js:95-98`: `@` di-tolak HANYA di posisi pertama; `budi@` dan `bu/di` diterima.
Spec `:524` hanya melarang `@` di depan dan spasi, jadi ini sesuai kontrak - tetapi kombinasi
dengan `validasiHapusAdmin` yang ketat digit memperlihatkan ketidakkonsistenan gaya validasi.
Catat sebagai batas yang disengaja atau perketat.

### NIT-02. `ROLE_VALID` diekspor tapi tidak dipakai lintas modul
`validasiTulisV2.js:9,135` mengekspor `ROLE_VALID`; tidak ada konsumen luar (`grep`
menemukan hanya definisi/pemakaian internal + `handleSetRole.js` punya salinannya sendiri di
`:4`). Kandidat konsolidasi: `handleSetRole.js` bisa mengimpor dari sini. Bukan blocker.

### NIT-03. `isSuperAdminDariEnv` di-shadow oleh nama variabel lokal di route auth
`app/api/auth/telegram/route.ts:17-21,32`: `const { verifikasiInitData } = require(...)` di-scope
modul sementara `admins` di-require lokal di dalam handler (`:81`). Bekerja, tetapi import
`guard`/`sesi` sengaja top-level sedangkan `admins` sengaja lokal untuk menghindari init Firestore
saat modul dimuat. Beri komentar singkat alasan beda perlakuan ini agar tidak "diperbaiki" orang
lain.

### NIT-04. Emoji/karakter mojibake pada `.env.example:38,40`
```
# groq (default) atau gemini �?' lihat lib/models/aiSettings.js
# Dibaca lib/gemini/groqClient.js �?' WAJIB kalau provider groq dipakai (soft-warn saja).
```
Karakter `-` menjadi byte `C3 A2 E2 82 AC E2 80 9D` (UTF-8 dari mojibake). Kosmetik; ganti dengan
`-` biasa. `docs/learnings.md` juga bertambah BOM (`EF BB BF` di awal file).

### NIT-05. Ekspor `hitungRataRataPemakaianHarian` hanya untuk test
`lib/reminder/reminderHarian.js:105` menambah ekspor hanya supaya `reminderHarian.test.js` bisa
memanggilnya. Modul ini bukan library; ini trade-off wajar, catat saja.

---

## Verifikasi kecocokan spec

| Requirement | Bukti kode | Verdict |
|---|---|---|
| F1 HPP owner-only, minimal 1 field, `hasOwnProperty` bedakan tidak-dikirim vs null | `produk/hpp/route.ts:54-59,74-77`; `validasiTulisV2.js:23-44` | PASS |
| F1 idempoten (nilai sama -> 200, 0 audit) | `route.ts:96-101`; test `editProduk.test.js:156` | PASS |
| F1 audit 1 baris per field berubah | `route.ts:117-141`; test `:130,:143` | PASS |
| F1 gagal audit -> 200 + `peringatan_audit`, log `[audit_write_failed]` | `route.ts:125-145` | PASS |
| F2 owner+admin, `reorder_point` key wajib, null sah | `validasiTulisV2.js:51-64`; `reorder-point/route.ts:37,70-73` | PASS |
| F2 stok tak ada -> 404 TANPA buat dokumen | `stok.js:152-154`; test `reorderPoint.test.js:91-96` | PASS |
| F2 nilai sama -> 200 tanpa notif & audit | `reorder-point/route.ts:108-111`; test model | PASS |
| F2 `notifikasi_terkirim` berasal dari model, bukan klaim | `route.ts:121,140`; `stok.js:167-175` | PASS |
| B1 `admin.id` -> `admin.telegram_user_id` (2 file) | `cekReorderPoint.js:47`; `reminderHarian.js:63`; test `reorderPoint.test.js:110-125`, `reminderHarian.test.js:73-106` | PASS |
| Opsi D: audit di dalam model, bot tidak dobel | `admins.js:104-121`; `handleSetRole.js:19-20`; test `auditRole.test.js` (a)-(d) | PASS |
| F3 guard model dipetakan ke 400, pesan apa adanya | `admin/role/route.ts:96-103`; test `adminRole.test.js:80-113` | PASS |
| F3 return `{adminLama, adminBaru}` tetap ada (bot butuh `adminLama.name`) | `admins.js:123`; `handleSetRole.js:25` | PASS |
| F4a 409 bila target ada (model `set()` tanpa merge) | `admin/tambah/route.ts:95-102`; test `adminKelola.test.js:106` | PASS |
| F4b guard diri sendiri / owner terakhir / super-admin env / 404 | `validasiTulisV2.js:117-132`; `admin/hapus/route.ts:104-111` | PASS |
| F4b urutan hapus -> revoke -> audit; gagal hapus = 0 audit | `admin/hapus/route.ts:113-143`; test `adminKelola.test.js:199-227` | PASS |
| F5 `superAdmin` di respons auth | `auth/telegram/route.ts:98,134` | PASS |
| F5 `getSession()` mock & real `superAdmin: boolean` | `mock.ts:181`; `real.ts:111,223` | PASS (implementasi) |
| F5 test assert `getSession()` (DoD 6.5) | tidak ada di `test/` | **FAIL (B-02)** |
| Tipe `ProductChangeDoc` + request/response v2 | `types.ts:204-212,241-305` | PASS |
| `dataKosong()` key lengkap; cast dihapus | `sumber-data.tsx:200-220` (`satisfies DataSource`) | PASS |
| 5 route seragam: origin -> sesi -> rate limit -> body -> role -> model -> log | kelima route, baris 6-7 `runtime`/`dynamic`; `console.*` reject/success | PASS |
| Panggilan ke-3+ `ambilAdmin` double GET per request | `tambah/route.ts:70,97`; `hapus/route.ts:80,95` | PASS (perf, bukan kontrak) |
| Rules `product_changes` staff read, write false | `firestore.rules:31` | PASS |
| Mock paritas server (owner-only, tolak diri, owner terakhir, 409) | `mock.ts:90-137,377-478` | PASS sebagian - lihat **B-03** |
| Mock paritas: validasi tipe HPP & guard super-admin-env | `mock.ts:377-398,124-137` | **FAIL (B-03)** |
| Client tidak kirim `role`/`changed_by` yang dipercaya | role selalu `ambilAdmin`; `changedBy: sesi.uid` | PASS |
| `ProductChangeDoc` dikonsumsi UI (Q4 = tunda v3) | tidak ada pemakaian selain tipe; sesuai keputusan tunda | PASS |

---

## Hasil perintah

| Perintah | Hasil |
|---|---|
| `npm test` | **135 pass / 0 fail / 0 skip** (exit 0) |
| `npx tsc --noEmit` | **exit 0**, tanpa error |

Catatan: test baru mutasi stok (`test/mutasiStok.test.js`, `test/handleScreenshotPickingList.test.js`,
`test/reminderHarian.test.js`) dan perubahan `mockFirestore.js` ikut hijau. `--test` menjalankan tiap
file di proses terpisah sehingga mutasi global helper tidak bocor antar file.

---

## Cakupan yang dinilai aman

- `lib/models/productChanges.js`: payload sesuai skema `types.ts:204-212`; `changed_by` dipaksa
  `String`; `created_at` server-side.
- `lib/models/stok.js::setReorderPoint`: cek dokumen dulu (null -> 404 tanpa buat dokumen),
  invalidasi cache setelah tulis, notif di try/catch terpisah.
- `lib/models/admins.js::updateRoleAdmin` (Opsi D): audit setelah `update()` sukses, throw audit
  tidak merambat (jadi `peringatan_audit`), return `{adminLama, adminBaru}` utuh; satu-satunya
  pemanggil (`handleSetRole.js:20`) + route konsisten dengan default `catatAudit: true`.
- 5 route: `tolakOrigin` -> sesi -> rate limit (20/20/10/10/10) -> body -> validasi -> `ambilAdmin`
  (fail-closed ke guest) -> model -> mapping status -> log. Role tidak pernah dari body.
- `lib/dashboard/validasiTulisV2.js`: murni, tanpa efek samping; `hasOwnProperty` untuk
  "tidak dikirim" vs `null`; `alasanTolakHapus` urut sesuai spec.
- `lib/dashboard/sumber-data.tsx`: `dataKosong()` memakai `satisfies DataSource` (compiler menagih);
  tidak ada cast tersembunyi.
- `lib/dashboard/data/real.ts`: `kirimTulis` mengembalikan `{ok:false,error}` untuk `!res.ok` dan
  tidak melempar untuk error terduga; `superAdmin` diteruskan dari respons auth.
- Perubahan lintas-workstream qty-delta (`handleOpname`, `chatHandler`, `syncStokDuaArah`,
  `handleCommand`, `handleScreenshotPickingList`) konsisten dengan kontrak delta bertanda dan diuji.
- `AlertDialog` (`components/ui/alert-dialog.tsx`): basis `@base-ui/react`, memakai
  `Backdrop`/`Popup`/`Title`/`Description` sehingga fokus & `aria-labelledby`/`aria-describedby`
  ditangani primitif; tombol aksi/dismiss memenuhi target 44px (`h-11`, `size-11` di mobile).
- `dialog-edit-*`, `aksi-role-admin`, `dialog-tambah-admin`: label `htmlFor`, `aria-invalid`,
  disabled saat kirim, dan jalur 401 (form/dropdown dipertahankan, dialog tidak ditutup) sesuai
  v1 11.2.

---

## Yang belum bisa diverifikasi (butuh env nyata)

1. **`vercel build` jumlah function <= 12 (target 9).** Hitungan aktual dari
   `app/api/**/route.ts` = 8 (3 lama + 5 baru) + `api/webhook.js` = 9, tetapi bukti resmi harus
   dari auto-build Vercel (plan 4). Tidak dijalankan di sini.
2. **Rules `product_changes` ter-deploy:** guest `permission-denied`, tulis client ditolak. Rules
   ada di `firestore.rules:31` tapi butuh deploy + tes Firestore nyata.
3. **B1 end-to-end nyata:** `notifikasi_terkirim: true` benar-benar mengirim pesan Telegram ke
   owner & admin (test memakai stub `kirimPesan`).
4. **Smoke Mini App nyata:** 5 fitur (edit HPP, reorder -> notif, ubah role tanpa dobel timeline,
   tambah/hapus admin + guard + revoke, status super admin read-only) di dalam Telegram nyata.
   Playwright mode mock tidak melewati route server maupun Firestore.
5. **`SUPER_ADMIN_ID` diset di produksi** (syarat Q1) - operasional deploy.
6. **Fokus & kontras konkret** pada 3 dialog baru: `e2e/a11y.spec.ts` belum diperluas ke halaman
   `/produk/[kode]`, `/admin`, `/pengaturan` versi v2; butuh axe run di browser nyata.
