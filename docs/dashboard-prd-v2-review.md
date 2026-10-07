# PRD Review Adversarial - `docs/dashboard-prd-v2.md`

Reviewer: senior product reviewer (adversarial). Tanggal: 2026-09-15.
Metode: spec dibaca utuh (1099 baris) + verifikasi langsung ke kode repo. Spec TIDAK diubah.

---

## Verdict

**PASS WITH CHANGES.** Kontrak route, guard, dan matriks izin v2 secara umum solid dan sadar-risiko, tetapi ada 4 cacat blocking (satu di antaranya bug produksi nyata yang spec klaim sebagai "berfungsi", satu lagi klaim file/signature yang tidak terbukti) plus belasan klaim verifikasi yang perlu dikoreksi sebelum implementasi.

---

## Blocking (harus diperbaiki sebelum implementasi)

### B1. F2 mengklaim notifikasi terkirim "ke owner & admin" — padahal loop penerima memakai `admin.id` yang SELALU `undefined`
- **Di mana:** spec baris 230-231, 291, 303-305, 899 (`cekDanNotifikasiReorderPoint` -> `notifikasi_terkirim: true` -> toast "Notifikasi stok menipis terkirim ke owner & admin").
- **Temuan kode:** `lib/reminder/cekReorderPoint.js:37-47`:
  - `ambilSemuaAdminByRole("owner")` mengembalikan objek dengan field **`telegram_user_id`**, BUKAN `id` (`lib/models/admins.js:101`).
  - Loop memanggil `kirimPesan(admin.id, teks, ...)` -> `admin.id` = `undefined`. Bug identik di `lib/reminder/reminderHarian.js:62`.
  - Jadi fungsi mengembalikan `true` (line 50) walau tidak ada pesan yang benar-benar terkirim, dan `kirimPesan(undefined, ...)` berpotensi melempar -> ditangkap try/catch -> log "Gagal cek reorder point". Artinya `notifikasi_terkirim` bisa `true` padahal kirim gagal.
- **Kenapa blocking:** spec menjadikan `notifikasi_terkirim` bagian kontrak respons sukses (F2 §3.3) DAN toast UI (baris 291) DAN test #4-5 (baris 303-305). Test di mock tanpa stub `kirimPesan` akan lulus palsu (stub mengembalikan apa pun). User diberi pesan "terkirim" yang bohong.
- **Perbaikan konkret:**
  1. Perbaiki dulu `cekReorderPoint.js:47` (dan `reminderHarian.js:62`) jadi `admin.telegram_user_id`. Ini di luar scope v2 tapi WAJIB, karena F2 memakainya.
  2. Tambah test yang stub/assert `kirimPesan` dipanggil dengan `telegram_user_id` yang benar (bukan `undefined`).
  3. Atau — bila tidak mau menyentuh bug lama — definisikan ulang `notifikasi_terkirim` sebagai "kondisi stok <= reorder terdeteksi" (bukan "terkirim"), dan ubah teks toast agar tidak menjanjikan pengiriman. Pilih satu, jangan keduanya.

### B2. Opsi C: klaim "tepat 1 baris audit" belum ada test bot; `handleSetRole` adalah satu-satunya pemanggil `updateRoleAdmin`, tapi tidak ada test existing yang mengasumsikan bot mencatat sendiri
- **Di mana:** spec §8.2 (baris 724-759), A4 (baris 1005), DoD (baris 1053-1055).
- **Temuan kode (grep seluruh repo):** pemanggil `updateRoleAdmin` = HANYA `lib/handlers/handleSetRole.js:20` + export di `admins.js:123`. Tidak ada pemanggil lain. Jadi memindahkan audit ke model TIDAK memecah caller lain.
- **Temuan test:** `rg` di `test/` TIDAK menemukan file yang mengimpor `handleSetRole`, `updateRoleAdmin`, atau `catatPerubahanRole`. Artinya: **tidak ada test bot existing** yang akan menangkap regresi double-audit ATAU kehilangan audit. Klaim spec "suite `npm test` sudah memuat test bot" (baris 754, 1011 "perbarui test bot bila ada") **tidak terbukti** — memang tidak ada.
- **Kenapa blocking:** DoD v2 mewajibkan "handleSetRole menghasilkan tepat 1 baris" tetapi test itu belum ada dan spec tidak mewajibkannya dibuat sebagai test baru yang eksplisit. Bila A4 diimplementasikan tanpa test baru, tidak ada bukti apa pun; regresi bot bisa lolos.
- **Perbaikan konkret:** di §17 A10, wajibkan file test baru `test/handleSetRole.test.js` (atau `test/auditRole.test.js`) yang: (a) memanggil `updateRoleAdmin` -> assert 1 baris; (b) memanggil `handleSetRole` -> assert 1 baris (bukan 2); (c) guard gagal -> 0 baris. Hapus klaim "sudah memuat test bot" yang salah.

### B3. Klaim "`dataKosong()` di `lib/dashboard/sumber-data.tsx:196`" — nama ada, tapi daftar field wajib diperluas; spec tidak menyebut `getSession` ikut berubah untuk F5
- **Di mana:** spec baris 813, 1022, 1086; §11 dan §17 B4/B5.
- **Temuan kode:** `dataKosong()` **benar-benar ada** di `lib/dashboard/sumber-data.tsx:196` (sesuai klaim), dan berisi 15 method termasuk `mutasiStok`, `ubahProviderAi`. Jadi nama file/fungsi spec BENAR. Namun: begitu 5 fungsi tulis + `getStatusSuperAdminSaya` (bila Q3 opsi murah) ditambahkan ke `DataSource`, `dataKosong()` (yang di-cast `as unknown as DataSource`, baris 215) akan diam-diam KEHILANGAN method baru tanpa error TypeScript. Test "typecheck bersih" §17 B5 TIDAK akan menangkap ini karena cast.
- **Kenapa blocking:** klaim "lupa salah satu = error build/type" (baris 814) **SALAH** untuk `dataKosong()` — cast `as unknown as DataSource` mematikan pengecekan. Sumber bug runtime "Sesi belum siap." yang membingungkan.
- **Perbaikan konkret:** (a) hapus `as unknown as DataSource`, ganti dengan objek literal `DataSource` + helper `tolak` (maka TS akan memaksa field baru); ATAU (b) tambahkan test yang meng-assert setiap key `DataSource` ada di `dataKosong()`. Ubah klaim baris 814 agar akurat — hanya interface `index.ts` yang memberi error; `dataKosong()` tidak.

### B4. F5 "0 function tambahan, cukup 1 field di SessionInfo" — meremehkan perubahan; `real.ts` mengambil dari `/api/auth/telegram` dan `mock.ts` tidak punya field itu; `super_admin` tidak akan pernah tampil
- **Di mana:** spec §6.2 baris 632-638, Q3 baris 968-970.
- **Temuan kode:**
  - `app/api/auth/telegram/route.ts:126-131` merespons `{ ok, user, role, firebaseToken }` — TIDAK ada `superAdmin`.
  - `lib/dashboard/data/real.ts:93-105` (`ambilSesiReal`) memetakan respons ini ke `SesiReal = { uid, role, token }` — field `superAdmin` harus ditambahkan di sana juga, lalu diteruskan ke `getSession()`.
  - `lib/dashboard/types.ts:193-196` `SessionInfo` juga wajib berubah.
  - `mock.ts:75-78` `getSession()` mengembalikan `MOCK_SESSION` — harus diisi juga.
  - Kritis: `isSuperAdminDariEnv` membaca `process.env.SUPER_ADMIN_ID`, yang di route/server TERSEDIA, tapi `role` di `getSession()` berasal dari `SessionInfo`. Bila field baru ditambahkan ke respons auth, itu bisa. Tapi spec bilang "0 function" — benar soal function, SALAH bila menyiratkan "0 file berubah". Minimal 4 file: route auth, real.ts, mock.ts (mock-data), types.ts.
- **Kenapa blocking:** tanpa daftar file yang benar, agent UI/implementor bisa menambah field di `types.ts` saja dan mengira selesai -> `superAdmin` selalu `undefined` -> F5 tidak berfungsi, dan test tidak menangkap karena mock di-cast.
- **Perbaikan konkret:** ubah §6.2/§19 agar menyebut eksplisit 4 file dan tambah test `getSession()` (mock & real) memuat `superAdmin` boolean. Atau turunkan F5 menjadi non-goal v2 (paling murah, karena keputusan sudah read-only dan tidak ada route tulis).

---

## Non-blocking (tidak menghalangi, tapi akurasi kontrak buruk bila dibiarkan)

### N1. §3.4 / §2.4 referensi baris kode yang bergeser
- Spec: `ambilProdukByKode` di `lib/models/produk.js:71` -> **benar** (line 71).
- `updateProduk` di `produk.js:88` -> **benar** (line 88).
- `setReorderPoint` pola `timpaStokOpname` "stok.js:86-103" -> **benar** (line 86-103).
- `cekDanNotifikasiReorderPoint` guard `stok.reorder_point === null` di `cekReorderPoint.js:26` -> **benar** (line 26).
- `updateRoleAdmin` di `admins.js:76` -> **benar** (line 76), guard di 78-89 -> **benar**.
- `timestampAdmin`? tidak diklaim. `ambilSemuaAdminByRole` di `admins.js:99` -> **benar**.
- `hapusAdmin` di `admins.js:111` -> **benar** (line 111) dan TANPA guard -> **benar**.
- `isSuperAdminDariEnv` di `admins.js:21` -> **benar**; tidak diekspor -> **benar** (module.exports line 115-127 tidak memuatnya).
- `tambahAdmin` di `admins.js:48` -> **benar**, pakai `set()` tanpa merge -> **benar** (line 56).
- **Kesimpulan:** referensi baris model sangat akurat. Pujian layak. Tidak ada temuan.

### N2. §11 klaim "termasuk `dataKosong()`" benar; klaim error build salah (lihat B3). Selain itu pola `credentials: "include"` di `real.ts:391,404` -> **benar**.

### N3. Rate limit kunci berbeda per route adalah desain baik, tapi v1 §11.9 + guard.js memakai window tetap 60s dengan map in-memory per-instance. Spec §12 benar menyebut soft-guard. Tidak ada temuan.

### N4. Race condition hapus admin (TOCTOU) - Q1 menerima risiko. Analisis:
- `hapusAdmin` (`admins.js:111`) benar tanpa transaksi dan tanpa guard. Spec BENAR menemukan ini.
- Namun mitigasi yang disebut ("rate limit ketat 10/menit + audit + env recovery") TIDAK cukup sebagai klaim keamanan: 10/menit per uid masih memungkinkan 2 owner yang login bersamaan saling hapus. Env `SUPER_ADMIN_ID` adalah jalur pemulihan HANYA bila env diset; bila tidak diset, 0 owner = terkunci.
- **Rekomendasi:** terima risiko v2 DENGAN syarat operasional: (a) DoD wajib memverifikasi `SUPER_ADMIN_ID` diset di produksi sebelum rilis, atau (b) tolak hapus/penurunan bila hasil query owner <= 1 DENGAN re-cek tepat sebelum delete (mengurangi window, bukan menghilangkan). Jangan klaim "termitigasi" tanpa salah satu.

### N5. F4b "audit dulu -> hapusAdmin" (baris 530) tidak konsisten dengan F3 (audit setelah sukses, baris 370-378).
- Di F3 spec tolak audit-sebelum (bisa mencatat perubahan yang tidak terjadi). Di F4b spec malah menyuruh audit DULU lalu hapus. Bila `hapusAdmin` gagal, timeline `admin_role_changes` punya entri "dihapus" palsu — persis alasan yang spec pakai untuk menolak di F3.
- **Perbaikan:** audit pencabutan SETELAH `hapusAdmin` sukses, atau (bila memakai `new_role: "dihapus"` sebagai timeline) tandai bahwa kegagalan hapus = entri tidak ditulis. Konsistenkan urutan.

### N6. `revokeAccessRequest` (Q2) belum diputuskan tapi muncul di jalur F4b. Rekomendasi spec "YA samakan dengan bot" masuk akal; `handleRevokeAdmin.js:78` memang memanggilnya. Ini bukan blocking, tapi keputusan harus difinalkan sebelum A8 karena mengubah test #9.

### N7. F1 edge "hpp baru === hpp lama dan hpp_baru tidak berubah -> tetap 200, tidak menulis audit" (BR-F1-4) — testable, bagus. Tapi definisi "hpp_baru tidak berubah" ambigu: bila field `hpp_baru` TIDAK dikirim, ia "tidak diubah"; bila dikirim sama nilainya, juga tidak berubah. Spec harus menyatakan keduanya = no-op audit. Test #8 hanya menutup satu.

### N8. `updated_at` F1: `updateProduk` selalu set `updated_at` (`produk.js:89`) walau nilai tidak berubah. Spec BR-F1-4 bilang 200 idempoten "tidak menulis audit", tapi `updated_at` produk TETAP berubah. Tidak salah, tapi sebutkan agar UI/`hppBerbeda` tidak membingungkan.

### N9. Function budget: spec menyebut "4 + 5 = 9". Verifikasi: route dashboard existing = `app/api/stok/mutasi/route.ts`, `app/api/pengaturan/ai/route.ts`, `app/api/auth/telegram/route.ts` (3; user menyebut "4" — kemungkinan ada route lain). Spec wajib melampirkan hitungan aktual; jangan asumsi. Bukan blocking karena spec sudah meminta bukti `vercel build`.

### N10. F5 §6.3 matriks "Admin: lihat" daftar super admin env. Ini membocorkan ID Telegram super admin ke admin biasa. Bila tujuannya read-only status-diri (Q3 murah), admin tidak perlu lihat DAFTAR. Matriks dan keputusan Q3 saling tidak konsisten; pilih satu dan selaraskan §6.3.

### N11. §8.3 klaim UI sudah menangani `new_role: "dihapus"` via `labelRolePeran` — verifikasi: `app/admin/page.tsx:263-266` **benar** mengembalikan string apa adanya untuk nilai tak dikenal. Klaim valid.

---

## Verifikasi Klaim (spec vs kode aktual)

| Klaim spec | Temuan kode aktual | Verdict |
|---|---|---|
| `dataKosong()` ada di `sumber-data.tsx:196` | Ada persis di line 196 | **BENAR** |
| "Lupa tambah fungsi = error build/type" (baris 814) | `dataKosong` di-cast `as unknown as DataSource` (line 215) -> TIDAK error | **SALAH** |
| `updateRoleAdmin` menulis audit | Tidak menulis audit (line 91-96) | **BENAR** |
| Bot mencatat audit terpisah di `handleSetRole.js:26` | Benar, line 26-32 | **BENAR** |
| `hapusAdmin` tanpa guard | Benar, line 111-113 | **BENAR** |
| `isSuperAdminDariEnv` tidak diekspor | Benar, tidak ada di module.exports 115-127 | **BENAR** |
| `tambahAdmin` pakai `set()` tanpa merge | Benar, line 56 | **BENAR** |
| `cekDanNotifikasiReorderPoint` guard null di `cekReorderPoint.js:26` | Benar | **BENAR** |
| `notifikasi_terkirim` = notif ke owner & admin | Loop pakai `admin.id` yang `undefined` (line 47) | **SALAH / bug** |
| Suite `npm test` memuat test bot | Tidak ada test impor `handleSetRole`/`updateRoleAdmin` | **SALAH** |
| F5 "0 function, cukup 1 field di SessionInfo" | Perlu ubah juga route auth, real.ts, mock.ts, types.ts | **MENYESATKAN** |
| `labelRolePeran` menangani nilai tak dikenal (`admin/page.tsx:263`) | Benar | **BENAR** |
| `ambilAdmin`, `updateProduk`, `ambilProdukByKode` lokasi | Semua sesuai baris yang diklaim | **BENAR** |
| `app/admin/page.tsx:5` read-only v1 | (tidak diverifikasi baris spesifik; halaman ada) | tidak diputuskan |

---

## Keputusan Arsitektur (Opsi C)

**Rekomendasi final: Opsi D (varian), BUKAN C murni.**

Alasan:
1. `grep` membuktikan `updateRoleAdmin` HANYA dipanggil dari `handleSetRole.js:20`. Jadi risiko regresi bot dari memindahkan audit ke model **kecil** secara blast-radius, TETAPI **tinggi dampaknya** bila salah: bot produksi menulis audit ganda / kehilangan audit, dan tidak ada test yang menangkap (temuan B2).
2. `handleSetRole.js` masih memakai `hasil.adminLama.name` di line 33 untuk pesan balasan. Memindahkan audit ke model TIDAK menghilangkan kebutuhan `adminLama` dari return value (model tetap mengembalikannya, line 96). Jadi aman dari sisi itu.
3. Opsi C murni mengubah dua file produksi (model + bot) dalam satu langkah tanpa test bot existing -> "atomic but unverified".

**Opsi D yang direkomendasikan:**
- Tambahkan param opsional: `updateRoleAdmin(target, roleBaru, diubahOleh, { catatAudit = true } = {})`. Model mencatat `catatPerubahanRole` bila `catatAudit` true. Bot tetap memanggil tanpa opsi (default true) -> **hapus** panggilan line 26. Route dashboard default true.
- Kelebihan atas C: (a) default menegakkan invariant "tidak mungkin lupa" (sama seperti C); (b) escape hatch eksplisit untuk caller non-audit di masa depan (mis. migrasi/skrip) tanpa melemahkan model; (c) lebih mudah diuji karena bisa mematikan audit di test.
- WAJIB barengi: `test/handleSetRole.test.js` baru (lihat B2) yang membuktikan "tepat 1 baris" untuk model DAN bot.

**Risiko regresi bila memilih C/D:** SEDANG. Satu-satunya pemanggil adalah bot, dan bot tidak punya test. Mitigasi wajib: test baru untuk `handleSetRole`, jalankan `npm test`, smoke satu kali `/set_role` di staging sebelum deploy. Jangan merge A4 tanpa test ini.

---

## Requirement Tidak Testable (kutipan -> kriteria terukur)

| Kutipan spec | Masalah | Kriteria pengganti |
|---|---|---|
| "dialog dan tabel aksi harus berfungsi pada 360 px" (baris 863) | "berfungsi" tidak terukur | Tidak ada overflow horizontal (scrollWidth <= clientWidth) pada viewport 360x800; tombol target >= 44x44 px; e2e assert tidak ada elemen terpotong. |
| "kontras >= 4.5:1" (baris 862) | Sudah terukur, tapi tak ada test | Jalankan axe/Lighthouse; assert 0 violation contrast pada 3 dialog baru. |
| "fokus terlihat" (baris 861) | subjektif | Tab index urut, `:focus-visible` style ada, assert fokus berpindah ke field pertama saat dialog buka. |
| "toast `\"HPP diperbarui\"`" (baris 160) | Tidak ada test toast | Playwright assert teks toast tampil <= 1s setelah 200. |
| "notifikasi stok menipis terkirim ke owner & admin" (baris 291) | Janji palsu (B1) & tak terukur | Benar-benar assert `kirimPesan` dipanggil N kali dengan `telegram_user_id` valid; atau ganti teks. |
| "Risiko diterima & didokumentasikan" TOCTOU (baris 389) | "diterima" tanpa acceptance test | Test konkuren 2 owner hapus/ubah -> assert sistem tetap punya >= 1 owner ATAU dokumentasikan sebagai known limitation dengan guard env wajib. |
| "100% aksi tulis v2 menulis audit" (baris 864) | testable tapi tak ada test agregat | Test yang, untuk tiap route, sukses -> assert koleksi audit bertambah >= 1; gagal -> assert tidak ada tulis parsial. |
| "Mock wajib menyimulasikan guard server SAMA PERSIS" (baris 832) | tidak ada test paritas | Test tabel guard: untuk tiap (route, role, payload) assert mock result === server result. |
| "`vercel build` <= 12 function" (baris 857) | butuh bukti, belum dilampirkan | Lampirkan log `vercel build` di PR; assert jumlah function <= 12. |
| "Dialog terkunci (tidak bisa ditutup saat mengirim)" (baris 159) | tak ada test | Playwright: klik overlay/Esc saat submit -> dialog tetap terbuka. |
| "UI menampilkan catatan ini di konfirmasi hapus" 1 jam (baris 539) | tak ada test | Playwright assert teks catatan ada di AlertDialog. |

---

## State UI yang Hilang (konsistensi dengan v1 §11.2 / §19.4)

v1 §11.2 (baris 278-281) & §19.4 (baris 894-896) mewajibkan: saat 401 mid-write -> toast "Sesi kedaluwarsa. Buka ulang dari Telegram." **DAN tombol "Buka ulang"**, isian form dipertahankan di memori.

Temuan v2:
- F1 §2.6 baris 162: **hanya toast**, tidak ada tombol "Buka ulang", dan bilang "form tidak reset" (bagus) tapi tidak eksplisit "dipertahankan di memori".
- F2 §3.6 baris 293: "Toast sesi kedaluwarsa; dialog tutup" -> **form direset** dan **tanpa tombol Buka ulang**. Ini MELANGGAR v1 §11.2 lebih keras (v1 bilang form dipertahankan).
- F3 §4.6 baris 428: "Toast sesi kedaluwarsa" tanpa detail tombol/form.
- F4 §5.6 baris 584: "Toast sesi kedaluwarsa; dialog tutup" -> form hilang.
- Ini konsisten satu sama lain (F1/F2/F4) tapi **tidak konsisten dengan v1** yang jadi acuan resmi.
- **Perbaikan:** §2.6/3.6/4.6/5.6 wajib menyatakan: toast + tombol "Buka ulang" + isian form dipertahankan di memori; dan dialog TIDAK ditutup pada 401 (agar input tetap). Tambahkan test e2e 401 mid-write untuk minimal 1 route tulis v2.

---

## Catatan Kontradiksi Lain

- §4.1 user story bilang role bisa diubah ke "owner/admin/guest", padahal `updateRoleAdmin` MENGIZINKAN promosi ke owner (guest->owner) langsung. Apakah owner boleh mengangkat owner baru tanpa guard? Guard hanya berlaku penurunan. Ini keputusan produk yang belum disebut: promosi ke owner = memberi akses setara diri. Bukan blocking, tapi harus diputuskan (bolehkah? perlu konfirmasi AlertDialog juga?).
- §7.1 "Non-admin: tidak" untuk semua — konsisten.
- E10 (baris 932) "Body berisi `changed_by`/`role` dari klien Diabaikan total" — bagus, dan konsisten §9.12.
- Q7 inkonsistensi penamaan `nilai_lama` vs `old_role` diakui; diterima, tidak blocking.

---

## Ringkasan

- Model/route read-side v2 akurat, referensi baris presisi, guard §9 lengkap kecuali yang ditandai.
- Cacat blocking: B1 (bug `admin.id`), B2 (test bot tidak ada), B3 (klaim error build salah), B4 (F5 4 file).
- Opsi arsitektur: pilih **Opsi D** (param `catatAudit` default true) + test bot baru, bukan C tanpa test.
- State 401 mid-write v2 tidak konsisten dengan v1 §11.2 (tombol Buka ulang + form dipertahankan).
- Setelah B1-B4 dan N5/N10 dibenahi, spec layak implementasi.

Status akhir:

NEEDS_REVISION
