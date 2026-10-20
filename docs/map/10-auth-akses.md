# 10 — Auth, Sesi, Role & Akses

## Ringkasan area
- Peta autentikasi dashboard D1/Worker: password, kode Telegram, TMA, sesi `swt_sesi`, role, guard, scope gudang, dan admin.
- Jalur utama Next.js ialah `app/api/**/route.ts` → `lib/d1/route.ts` / `lib/d1/*`; Worker auth entry ada di `worker/api.ts`.
- Firestore `lib/models/*.js` dan `firestore.rules` merupakan jalur bot/dashboard lama, bukan penyimpanan sesi jalur D1.
- Tidak mencakup seluruh perilaku bot maupun detail setiap izin endpoint non-auth; lihat [11-telegram](11-telegram-bot.md) untuk bot.

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `worker/auth.ts` | PBKDF2, sesi, cookie, OTP, audit login, bootstrap | `verifikasiPassword`, `buatSesi`, `verifikasiSesi`, `terbitkanKode`, `verifikasiKode`, `catatLogin`, `ambilTokenDariCookie` |
| `worker/api.ts` | Dispatch Worker `/api/*`, login/logout/me dan kode/reset | `tanganiApi` |
| `lib/dashboard/auth/initData.js` | HMAC Telegram Mini App initData | `verifikasiInitData` |
| `app/api/auth/login/route.ts` | Login password Next | `POST` |
| `app/api/auth/minta-kode/route.ts`, `reset-password/route.ts` | Permintaan kode dan reset password | `POST` |
| `app/api/auth/tma/route.ts` | Login TMA menuju sesi D1 | `POST` |
| `app/api/auth/telegram/route.ts` | Jalur Telegram legacy (initData/Firebase) | `POST` |
| `app/api/auth/logout/route.ts`, `app/api/me/route.ts` | Cabut sesi, identitas aktif | `POST`, `GET` |
| `lib/d1/auth.ts`, `route.ts`, `rateLimit.ts` | Guard sesi Next, origin, rate limit | `requireSession`, `sesiRoute`, `tolakOriginD1`, `cekRateLimitD1` |
| `lib/d1/peran.ts`, `akses-halaman.ts` | Union role, kapabilitas bot, matriks halaman | `Role`, `kapabilitas`, `AKSES_HALAMAN`, `bolehBukaHalaman` |
| `lib/d1/admin.ts`, `akses.ts`, `profil.ts` | CRUD admin/scope, permintaan akses, profil | `tambahAdmin`, `ubahRole`, `setGudangUser`; `mintaAkses`, `putuskanAkses`; detail lihat file |
| `app/api/admin/{route,tambah,hapus,role,ubah-nama}/route.ts` | API pengelolaan admin D1 | handler `POST` |
| `app/api/profil/{route,password,username}/route.ts` | Profil/password/username | handler route terkait |
| `migrations/0001_fase0_fondasi.sql`, `0033_users_role_baru.sql`, `0035_ai_model_izin_role.sql` | Skema sesi/user, role, izin model | SQL migrasi |
| `lib/models/{sessions,admins,accessRequests,adminRoleChanges,dailyRequests}.js`, `firestore.rules` | Model Firestore lama | API CommonJS model legacy |
| `app/masuk/page.tsx`, `app/admin/page.tsx`, `app/profil/page.tsx` | UI login, admin, profil | komponen halaman default |

## Alur data
1. Password: `/masuk` → `POST /api/auth/login` (Next; Worker juga dispatch `/api/auth/login` melalui `tanganiApi`) → `ambilPenggunaLogin` → `verifikasiPassword` membandingkan PBKDF2-SHA256/100.000 iterasi, salt 16 byte → `buatSesi` → token acak 32 byte, SHA-256 di `sessions`, token mentah cookie `swt_sesi`.
2. Kode Telegram: `POST /api/auth/minta-kode` mencari akun dan mengirim OTP lewat bot; `terbitkanKode` menghasilkan kode enam digit, menyimpan hash terikat purpose+tg_id, berlaku 10 menit. `POST /api/auth/reset-password` → `verifikasiKode` (sekali pakai; maksimal lima percobaan) → `setPassword` menyimpan hash PBKDF2. Login OTP tidak sama dengan reset: worker memiliki purpose `otp` tetapi endpoint jalurnya perlu dibedakan (lihat Belum diverifikasi).
3. TMA: `POST /api/auth/tma` mengambil `initData` mentah → `verifikasiInitData` di `lib/dashboard/auth/initData.js` memeriksa HMAC menggunakan token bot, format/hash dan umur `auth_date` → user harus dikenal/aktif di D1 → `buatSesi` dan `Set-Cookie`. TMA bukan pengganti password bagi browser biasa.
4. Verifikasi sesi D1: `ambilTokenDariCookie`/`bacaCookie` membaca `swt_sesi`; `requireSession` SHA-256 token lalu JOIN `sessions` + `users` aktif, wajib `revoked_at IS NULL` dan `expires_at` belum lewat; ambil `user_warehouses`, normalkan role tak dikenal menjadi `guest`. Worker `verifikasiSesi` melakukan lookup hash, expiry/revoke, user aktif, lalu scope gudang.
5. Sesi D1 berlaku 12 jam (`SESSION_TTL_DETIK`); cookie dihasilkan `atributCookieSesi`: HttpOnly, SameSite=Lax, Path=/, Max-Age, Secure bila HTTPS. Nilai token disimpan browser sebagai cookie, bukan localStorage; DB hanya menyimpan hash. Logout mencabut baris sesi dan menghapus cookie.
6. `sesiRoute` Next menjalankan origin → `requireSession` → rate limit per `tg_id`; handler lalu menerapkan role/validasi dan memanggil model D1. Worker `worker/auth.ts` menyediakan verifikasi cookie/sesi langsung; dispatcher `worker/api.ts` menangani rute auth/me, bukan helper `sesiRoute` Next.

## Endpoint & tabel terkait
- Endpoint: `POST /api/auth/login` → `app/api/auth/login/route.ts` (Next) dan dispatch `worker/api.ts` → `verifikasiPassword`/`buatSesi`.
- Endpoint: `POST /api/auth/minta-kode`, `POST /api/auth/reset-password` → masing-masing `app/api/auth/.../route.ts`; model OTP di `worker/auth.ts`.
- Endpoint: `POST /api/auth/tma` → `app/api/auth/tma/route.ts` → `verifikasiInitData` lalu sesi D1.
- Endpoint: `POST /api/auth/logout`, `GET /api/me` → `app/api/auth/logout/route.ts`, `app/api/me/route.ts`; worker punya dispatch auth/me di `worker/api.ts`.
- Endpoint: `POST /api/admin`, `/api/admin/{tambah,hapus,role,ubah-nama}` → `app/api/admin/**/route.ts` → `lib/d1/admin.ts`; detail rute `/api/admin` aksi gabungan.
- Endpoint: `/api/profil` dan `/api/profil/{password,username}` → `app/api/profil/**/route.ts` → `lib/d1/profil.ts`.
- Tabel `users` → autentikasi/role; `worker/auth.ts`, `lib/d1/auth.ts`, `lib/d1/admin.ts` pembaca/penulis → `0001_fase0_fondasi.sql`, `0033_users_role_baru.sql`.
- Tabel `sessions` → `buatSesi` penulis, `verifikasiSesi`/`requireSession` pembaca, `cabutSesi` pencabut → `0001_fase0_fondasi.sql`, dibangun ulang bersama users oleh `0033_users_role_baru.sql`.
- Tabel `auth_codes`, `login_audit` → kode/reset dan catatan percobaan/login di `worker/auth.ts`; skema fondasi `0001_fase0_fondasi.sql`.
- Tabel `user_warehouses` → `requireSession`/`verifikasiSesi` pembaca; `setGudangUser` dan bootstrap penulis → migrasi `0011_users_guest.sql` dan dibangun ulang `0033_users_role_baru.sql`.
- Tabel `access_requests` → `lib/d1/akses.ts` (`mintaAkses`, `putuskanAkses`, `listAkses`); skema fondasi D1; keputusan akses dapat menambahkan/mengubah user.
- Tabel `admin_role_changes` → `lib/d1/admin.ts` mencatat perubahan role (termasuk set gudang sebagai catatan `set_gudang`); tampilan riwayat di admin; skema fondasi D1.
- Tabel `ai_model_izin` → `lib/d1/aiIzinModel.ts`, role non-owner per provider/model/jenis; migrasi `0035_ai_model_izin_role.sql`.

## Test terkait
- Auth TMA: `app/api/auth/tma/route.test.ts` + `route.mock.ts` (initData kosong/hash salah/user tak terdaftar/sukses cookie). Ikut dijalankan `npm run test:worker` (runner `scripts/jalankan-tes-worker.mjs`, discover `lib/**/*.test.ts` + `app/**/*.test.ts` + `worker/*.test.ts`).
- Unit CJS auth/role: `test/authFlow.test.js`, `test/sesi.test.js`, `test/initData.test.js`, `test/adminRole.test.js`, `test/akses*.test.js` lewat `npm test`.
- E2E: `e2e/masuk.spec.ts` (login), `e2e/tma.spec.ts` (guard Mini App), `e2e/izin.spec.ts` (matriks peran), `e2e/admin-akses.spec.ts`, `e2e/staff.spec.ts`. Satu spec: `npm run e2e:build` lalu `npx playwright test e2e/izin.spec.ts --project=desktop`.

## Gotcha / konvensi
- Role kode persis: `owner`, `high_admin`, `admin`, `designer`, `guest` (`Role` di `lib/d1/peran.ts`). Skema 0033 juga mempertahankan `staff` sebagai nilai lama/default; `lib/d1/auth.ts` memetakan role tak dikenal termasuk `staff` menjadi `guest`.
- Matriks halaman server ada di `AKSES_HALAMAN`: `owner` semua; `high_admin` semua kecuali `/pengaturan`; `admin` daftar eksplisit tanpa `/gudang`; `designer` hanya `/`, `/profil`, `/ai-gambar`; `guest` hanya `/`. `bolehBukaHalaman` fail-closed pada role/path asing.
- `kapabilitas(role)` bukan matriks halaman: owner/high_admin/admin boleh perintah+gambar, designer hanya gambar dan chat tanpa tool, guest/tak dikenal tidak boleh. Akses tulis gudang diperiksa terpisah lewat `bolehTulisGudang`.
- `lib/d1/route.ts` adalah pola guard route Next (origin → sesi → rate limit); role ditentukan dari DB, bukan body. Worker memakai fungsi sesi langsung, bukan guard Next. Jangan menganggap guard tampilan UI cukup untuk API.
- `loginTerkunci`: lima login gagal per `tg_id` dalam 15 menit menghasilkan lock 15 menit; catatan login di `login_audit`. `sesiRoute` default 60/menit, tetapi route dapat memberi batas sendiri; D1 `cekRateLimitD1` terpisah dari lock login.
- TMA: `verifikasiInitData` menolak `auth_date` lebih tua dari `BATAS_UMUR_DETIK = 3600` (60 menit, PRD 11.2) dan `auth_date` non-integer; HMAC memakai token bot.
- `user_warehouses` menentukan scope gudang dari DB. `setGudangUser` menghapus scope lama lalu memasukkan gudang terpilih; owner melewati scope pada `bolehTulisGudang`, admin/high_admin harus cocok untuk gudang tertentu.
- `0033_users_role_baru.sql` harus dijalankan sendirian menurut komentar migrasi; ia membangun ulang `users`, `sessions`, `user_warehouses`. `0035_ai_model_izin_role.sql`: owner tidak dibatasi; tabel izin kosong fail-closed untuk non-owner.
- Bedakan `lib/models/*.js` dan `firestore.rules` (Firestore legacy, masih dipakai bagian bot/legacy) dari sumber otoritatif sesi/role web D1 (`lib/d1/*`, `worker/auth.ts`). `lib/dashboard/auth/sesi.js` memakai cookie lama `dat_sesi` HMAC 60 menit, bukan `swt_sesi`.
- UI tidak menyimpan token sesi di state/localStorage: browser mengirim cookie HttpOnly; pola fetch menggunakan kredensial cookie.

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, sinonim/typo) | file pertama | catatan |
|---|---|---|
| lupa password, OTP, kode tidak masuk | `app/api/auth/minta-kode/route.ts` | Telusuri pengiriman Telegram, lalu `reset-password` dan `worker/auth.ts`. |
| sandi ditolak, PBKDF2, login password | `worker/auth.ts` | `verifikasiPassword`, `loginTerkunci`, dan audit login. |
| login Mini App, initData, HMAC | `lib/dashboard/auth/initData.js` | Pemanggil D1: `app/api/auth/tma/route.ts`; jangan tertukar `telegram`. |
| sesi habis, cookie hilang, swt_sesi | `lib/d1/auth.ts` | Bandingkan `worker/auth.ts` expiry/revoke/cookie. |
| masih login setelah logout, cabut sesi | `app/api/auth/logout/route.ts` | Memanggil `cabutSesi` lalu cookie penghapus. |
| role asing, staff, guest dapat akses | `lib/d1/auth.ts` | Normalisasi role asing ke guest; matriks ada di akses-halaman. |
| halaman admin tidak muncul, izin halaman | `lib/d1/akses-halaman.ts` | `AKSES_HALAMAN` dan `bolehBukaHalaman` fail-closed. |
| akses bot designer, kapabilitas perintah | `lib/d1/peran.ts` | `kapabilitas` berbeda dari izin halaman. |
| guard API, origin, CSRF, rate limit | `lib/d1/route.ts` | Urutan origin → sesi → rate; role di handler. |
| terlalu banyak gagal login, terkunci | `worker/auth.ts` | `loginTerkunci` membaca `login_audit`, ambang 5/15 menit. |
| gudang salah, scope gudang, user_warehouses | `lib/d1/admin.ts` | `setGudangUser`; pemeriksaan scope juga di `lib/d1/auth.ts`. |
| role berubah tanpa jejak, audit admin | `lib/d1/admin.ts` | `ubahRole` mencatat `admin_role_changes`. |
| permintaan akses, approve/reject | `lib/d1/akses.ts` | `mintaAkses`, `putuskanAkses`, cooldown penolakan. |
| migrasi role gagal, users/session | `migrations/0033_users_role_baru.sql` | Perlu dijalankan tersendiri; tabel FK dibangun ulang. |
| akses model AI role, model mahal | `migrations/0035_ai_model_izin_role.sql` | Periksa juga `lib/d1/aiIzinModel.ts`, terpisah dari RBAC halaman. |
| Firestore lama, dat_sesi, rules | `lib/dashboard/auth/sesi.js` | Legacy HMAC; `firestore.rules` dan `lib/models/*.js` bukan sesi D1. |

## Belum diverifikasi
- `app/api/auth/telegram/route.ts` ialah jalur legacy (Firebase custom token) yang berbeda dari `/tma`; rincian validasi/penyimpanannya belum dipetakan penuh.
- Rute API untuk login dengan kode OTP (bukan reset password) belum ditemukan; yang terverifikasi hanya permintaan kode + reset password (`purpose` `otp` ada di `worker/auth.ts`).
