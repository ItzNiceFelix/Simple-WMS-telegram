# 01 — Runtime & Deploy (Cloudflare Worker + OpenNext + D1)

## Ringkasan area
- Area ini soal **bagaimana request masuk dan aplikasi dijalankan**: Cloudflare Worker kustom (`worker/index.ts`), auth/sesi sisi Worker (`worker/auth.ts`, `worker/api.ts`), webhook Telegram Worker (`worker/bot.ts`), cron + antrean notifikasi (`worker/notify.ts`), dan seluruh konfigurasi deploy (`wrangler.jsonc`, `next.config.mjs`, `open-next.config.ts`, `package.json`, `cloudflare-env.d.ts`, `.env.example`, `.dev.vars.example`).
- Batas produksi: 1 Worker bernama `simple-wms-telegram`, aset statis dari `.open-next/assets`, 1 database D1 `simple-wms` (binding `DB`).
- TIDAK termasuk: logika perintah/command Telegram (peta bot), guard/sesi route Next (`lib/d1/route.ts` → peta auth), semua `lib/d1/*` (peta database/stok/laba), isi command bot.
- Jalur lama Vercel (`api/webhook.js`, `vercel.json`, `firebase.json`, `.github/workflows/*`) masih ada di repo tapi praktis legacy (era Firestore/Vercel) — jangan dipakai untuk deploy baru.
- Cron produksi ada DUA tempat berbeda: `triggers.crons` di `wrangler.jsonc` (aktif, Worker) dan `schedule` di `.github/workflows/*.yml` (lokal/untracked, era Firestore).

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `worker/index.ts` (33 baris) | Worker entry: routing 3 lapis + `scheduled` cron | `export default { fetch, scheduled } satisfies ExportedHandler<CloudflareEnv>` |
| `worker/api.ts` (227) | Semua `/api/*` milik Worker (health, setup owner, auth, lupa password) | `export async function tanganiApi(request, env): Promise<Response \| null>`, `export type Env` |
| `worker/auth.ts` (304) | Auth inti berbasis D1: PBKDF2, sesi opaque, OTP | `ambilPengguna`, `ambilPenggunaLogin`, `verifikasiPassword`, `buatSesi`, `verifikasiSesi`, `cabutSesi`, `terbitkanKode`, `verifikasiKode`, `setPassword`, `bootstrapOwner`, `loginTerkunci`, `catatLogin`, `atributCookieSesi`, `cookieHapusSesi`, `ambilTokenDariCookie`, `NAMA_COOKIE_SESI` (`"swt_sesi"`), `PESAN_LOGIN_GAGAL` |
| `worker/bot.ts` (838) | Webhook Telegram + command/vision/AI di Worker | `tanganiWebhook(request, env, ctx)`, `kirimPesanBot`, `kirimPesanTombol`, `editPesan`, `kirimTyping`, `export type Update` |
| `worker/notify.ts` (198) | Antrean notifikasi + drain cron + laporan harian + sinkron Kledo terjadwal | `antreNotifikasi`, `fanoutNotifikasi`, `drainQueue`, `bangunLaporanHarian`, `drainTick(env, cron?)`, `LAPORAN_CRON = "5 0 * * *"`, `SINKRON_CRON = "0 9 * * *"` |
| `worker/package.json` | Menandai folder worker ESM | `{"type":"module"}` (root `package.json` justru `"type":"commonjs"`) |
| `api/webhook.js` (54) | Entry Vercel Serverless lama (masih ada, bukan jalur prod sekarang) | `module.exports = async function handler(req, res)`; helper internal `apakahRequestValid(req)`; panggil `routePesan` + `waitUntil` + `validasiEnvWebhook` |
| `wrangler.jsonc` | Konfigurasi Worker: name, main, crons, vars, D1, assets | `name: simple-wms-telegram`, `main: ./worker/index.ts`, `triggers.crons` (3), `d1_databases[0].binding: DB` |
| `next.config.mjs` | Konfigurasi build Next + env inline | `env.NEXT_PUBLIC_DASHBOARD_DATA`, `serverExternalPackages: ["firebase-admin","jose","jwks-rsa","@google-cloud/firestore"]` |
| `open-next.config.ts` | Konfigurasi OpenNext (default kosong: tanpa incremental cache/queue/tag cache) | `export default defineCloudflareConfig({})` |
| `package.json` (scripts) | Perintah dev/build/deploy/test/e2e | lihat "Test terkait" & "Gotcha" |
| `cloudflare-env.d.ts` | Tipe manual binding+env (karena `wrangler types` crash di sandbox PRoot) | `interface CloudflareEnv { DB; ASSETS; … }` + `declare namespace NodeJS.ProcessEnv` |
| `.env.example` | Daftar env era Vercel/Firestore (nama + penjelasan) | `NEXT_PUBLIC_DASHBOARD_DATA`, `DASHBOARD_ALLOWED_ORIGINS`, `DASHBOARD_SESSION_SECRET`, TELEGRAM/FIREBASE/AI/Sheets |
| `.dev.vars.example` | Template secret lokal Worker | komentar `wrangler secret put <NAMA>`; TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SUPER_ADMIN_ID, AI_PROVIDER_TEXT… |
| `vercel.json` | Sisa era Vercel | `functions: {"api/*.js": { maxDuration: 300 }}` |
| `firebase.json` | Sisa era Firestore | `firestore.rules`, `firestore.indexes.json`, `database: (default)`, `location: nam5` |
| `.github/workflows/ci.yml` | CI test (berkas LOKAL, untracked: `git status` → `?? .github/`) | `npm ci` + `npm test` pada push/PR `main` |
| `.github/workflows/reminder-harian.yml` | Cron GHA LOKAL (07:00 WIB = `0 0 * * *`) | `node scripts/jalankanReminderHarian.js`, env `FIREBASE_*` + `TELEGRAM_BOT_TOKEN`, `environment: production` |
| `.github/workflows/sync-master-data.yml` | Cron GHA LOKAL (06:00 WIB = `0 23 * * *`) | `node scripts/jalankanSyncMasterData.js`, env `FIREBASE_*` + `GOOGLE_SHEETS_*` |
| `docs/development.md` | Konvensi kontribusi (CJS, nama Indonesia, cara menambah command/tool/cron/test) | — |
| `docs/dashboard-deploy.md` | Deploy era Vercel/Firebase (env, rules, index, smoke test manual §5) | — |
| `docs/patch-notes.md` | Catatan rilis; bagian deploy hanya menunjuk `docs/dashboard-deploy.md` §5 | — |

## Alur data
1. **Urutan routing di `worker/index.ts` → `fetch`**: (a) `url.pathname === "/api/telegram/webhook"` → `tanganiWebhook(request, env, ctx)` dari `worker/bot.ts`; (b) `await tanganiApi(request, env)` dari `worker/api.ts` — kalau mengembalikan `Response` (bukan `null`), langsung dipakai; (c) sisanya diteruskan ke handler OpenNext `../.open-next/worker.js` (`handler.fetch(request, env, ctx)`), yang menjalankan Next App Router (`app/**`).
2. **`worker/api.ts` hanya menangani `/api/`** (`if (!path.startsWith("/api/")) return null`) dan hanya rute milik Worker; semua `/api/*` lain (mis. `/api/stok`, `/api/baca`, `/api/order`) sengaja `return null` supaya diteruskan ke OpenNext (komentar eksplisit di akhir fungsi).
3. **Auth: dua lapis berbeda.** Lapisan Worker (`worker/auth.ts` + `worker/api.ts`) menangani `/api/auth/login`, session cookie `swt_sesi`, `/api/me`, set/reset password, `minta-kode` lewat Bot API (`kirimViaBot`). Lapisan Next (`lib/d1/route.ts`: `tolakOriginD1` → `requireSession` → role dari DB → `lib/d1/*`) dipakai route dashboard — jadi middleware bukan satu rantai, tapi dua boundary terpisah.
4. **Webhook Telegram**: `tanganiWebhook` cek method POST, verifikasi header `x-telegram-bot-api-secret-token` dengan `secretCocok` (constant-time) bila `TELEGRAM_WEBHOOK_SECRET` diset, lalu **selalu balas 200** dan memproses update lewat `ctx.waitUntil(prosesUpdate(...))` → command D1 (`lib/d1/stok|produk|gudang|opname|transfer|akses|admin|peran`) + jalur AI (`lib/ai/*`).
5. **Cron**: `scheduled(controller, env, ctx)` → `ctx.waitUntil(drainTick(env as Env, controller.cron))` (selalu) + `console.log("[scheduled] …")`. `drainTick` di `worker/notify.ts`: selalu `drainQueue(env)`; laporan harian hanya bila `cron === LAPORAN_CRON`; lalu `sinkronKledoSore(env, cron)` yang hanya jalan bila `cron === SINKRON_CRON` dan `AI_KEY_ENCRYPTION_KEY` ada, memanggil `lib/kledo/sinkron.jalankanSinkron` + `lib/d1/kledoKredensial.ambilKledo`, hasilnya di-`fanoutNotifikasi`.
6. **Efek samping**: pesan keluar via Bot API (`worker/bot.ts` + `worker/notify.ts`), laporan harian = tabel stok per gudang + top 10 menipis, sinkron Kledo menulis log/tabel D1 dan mengirim ringkasan ke admin.
7. **Jalur lama** (`api/webhook.js`): Vercel handler → `validasiEnvWebhook()` (Firebase trio + TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET + GEMINI_API_KEY) → cek secret → `routePesan(req.body)` di `waitUntil`, balas 200.

## Endpoint & tabel terkait
- Endpoint Worker (semua di `worker/api.ts`, fungsi `tanganiApi`):
  - `GET /api/health` → cek `SELECT 1` ke D1, balas `{ ok, db: "up"|"down", fase: 0 }`.
  - `POST /api/setup/owner` → `bootstrapOwner` + `buatSesi` (hanya berguna saat `users` kosong).
  - `POST /api/auth/login` → `ambilPenggunaLogin`, `loginTerkunci`, `verifikasiPassword`, `catatLogin`, `buatSesi`.
  - `POST /api/auth/logout` → `cabutSesi` + `cookieHapusSesi`.
  - `GET /api/me` → `verifikasiSesi` (balas `scope_gudang`, `password_set`).
  - `POST /api/auth/set-password` → `setPassword` (butuh sesi).
  - `POST /api/auth/minta-kode` → `terbitkanKode` + kirim kode via Bot API (503 bila gagal kirim).
  - `POST /api/auth/reset-password` → `verifikasiKode` + `setPassword`.
  - `POST /api/telegram/webhook` → `worker/bot.ts:tanganiWebhook` (di-intercept `worker/index.ts`, BUKAN OpenNext).
- Endpoint Next (`app/api/**/route.ts`): semua sisanya, masuk lewat handler OpenNext; contoh segmen terverifikasi: `admin`, `ads`, `advance`, `ai`, `analisa`, `auth`, `baca`, `desain`, `excel`, `gudang`, `harga-jual`, `laba`, `me`, `opname-gudang`, `order`, `pengaturan`, `permintaan`, `permintaan-gudang`, `preset`, `printing`, `produk`, `profil`, `sinkronisasi`, `stok`.
- Tabel D1 terkait area ini (detail kolom ada di peta database; migrasi `migrations/NNNN_*.sql`, terakhir `0043_sinkron_log.sql`, total 43 berkas):
  - `users` → tulis: `worker/auth.ts` (`bootstrapOwner`, `setPassword`), baca: `ambilPengguna`/`ambilPenggunaLogin`.
  - Sesi (token hash, `swt_sesi`) → `worker/auth.ts` (`buatSesi`, `verifikasiSesi`, `cabutSesi`).
  - Kode OTP reset/link → `worker/auth.ts` (`terbitkanKode`, `verifikasiKode`).
  - Rate-limit & log login → `worker/auth.ts` (`loginTerkunci`, `catatLogin`).
  - `notify_queue` → penulis `worker/notify.ts:antreNotifikasi`, pembaca `drainQueue`; dibuat migrasi `0004` (komentar di `worker/notify.ts`).
  - `groups` → `drainQueue` (status `left`) + `worker/bot.ts:tanganiMigrasiGrup` (pindah `chat_id` ke supergroup).
  - `warehouses`, `stock_by_bin`, `products` → dibaca `bangunLaporanHarian` (laporan stok harian).
  - Log sinkron Kledo → `lib/kledo/sinkron.ts` (`adaSinkronBerjalan`, `jalankanSinkron`), migrasi `0043_sinkron_log.sql`.

## Test terkait
- Unit Worker: `worker/auth.test.ts`, `worker/bot-akses.test.ts`, `worker/notify.test.ts` (pakai `node:test`).
- Runner khusus: `npm run test:worker` → `scripts/jalankan-tes-worker.mjs` (discover `lib/**/*.test.ts` + `app/**/*.test.ts` + `worker/*.test.ts`, bundle esbuild, jalankan `node --test`).
- Unit CJS lama: `npm test` → `node --test "test/**/*.test.js"` + bundle `worker/auth.test.ts` khusus.
- Typecheck: `npm run typecheck` (`tsc --noEmit`).
- E2E: `e2e/*.spec.ts` (Playwright, `playwright.config.ts`: `testDir: ./e2e`, `baseURL: http://127.0.0.1:3100`, `webServer: npx next start -p 3100`, project `desktop` / `desktop-viewport` / `mobile`).
- Cara menjalankan satu test: `npm run test:worker -- --grep` tidak didukung → jalankan langsung `npx esbuild worker/notify.test.ts --bundle --platform=node --format=esm --outfile=/tmp/t.mjs && node --test /tmp/t.mjs`. E2E satu spec: `npm run e2e:build` lalu `npx playwright test e2e/smoke.spec.ts --project=desktop` (atau `npm run e2e:dev` bila `.next` sudah ada).

## Gotcha / konvensi
- **Deploy**: `npm run deploy` (`opennextjs-cloudflare build && opennextjs-cloudflare deploy`), preview `npm run preview`, upload `npm run upload`. Worker = `simple-wms-telegram`; DB = `simple-wms` (`id bead212e-5c8c-43f6-b654-75b1a7c84fd4`). URL produksi dari var `DASHBOARD_ALLOWED_ORIGINS`: `https://simple-wms-telegram.bagus-deva-nov-p.workers.dev`.
- **Migrasi D1 tidak punya npm script.** Perintah yang terverifikasi di dokumen repo: `npx wrangler d1 execute simple-wms --local --file=migrations/0006_fase3_order.sql` dan versi `--remote` (docs/superpowers/plans/2026-10-08-fase3a-order-laba.md), serta `wrangler d1 migrations apply --local` (docs/rencana-integrasi-kledo.md:356).
- **Secrets ≠ vars.** `wrangler.jsonc` hanya memuat `vars` non-rahasia (`AI_PROVIDER_TEXT=groq`, `GEMINI_TIMEOUT_MS`, `GEMINI_TOTAL_TIMEOUT_MS`, `DASHBOARD_ALLOWED_ORIGINS`). Rahasia di-`wrangler secret put`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SUPER_ADMIN_ID`, `AI_KEY_ENCRYPTION_KEY` (`.dev.vars.example`, `docs/laporan-progres.md:33`, `lib/ai/kripto.ts:7`). `DASHBOARD_SESSION_SECRET` dan `KENARI_BASE_URL` hanya ada di `cloudflare-env.d.ts` — sengaja tidak ada di `vars`.
- **Dua cara baca vars di Next**: `process.env.X` (OpenNext menyuntikkan `vars`, lihat komentar `cloudflare-env.d.ts`) ATAU `getCloudflareContext().env.X` lewat `lib/d1/db.ts:getEnvAi/getKunciEnkripsi` (komentar menyebut ini lebih akurat dan dipakai `/api/baca?scope=ai`). Binding D1 untuk route Next juga dari `getCloudflareContext()` (`lib/d1/db.ts:getDb`) — bukan `process.env.DB`.
- **Jangan panggil `initOpenNextCloudflareForDev()` di `next.config.mjs`**: komentar di file itu menjelaskan workerd native crash (TCMalloc mmap) di sandbox PRoot ARM.
- **`process.env` legacy masih dipakai** oleh `lib/config/env.js` (validasi fail-fast per konteks: `validasiEnvWebhook`, `validasiEnvCronSheets`, `validasiEnvCronReminder`, `validasiEnvScript`) dan `lib/dashboard/auth/guard.js` / `lib/d1/route.ts` (allowlist origin) — itu jalur Vercel/Node lama, bukan binding Worker.
- **Cron UTC, bukan WIB**: `5 0 * * *` = 00:05 UTC = 07:05 WIB (`worker/notify.ts` komentar `LAPORAN_CRON`); `0 9 * * *` = 09:00 UTC = 16:00 WIB (`SINKRON_CRON`). `drainTick` masih punya fallback berbasis jam WIB (`wib = Date.now() + 7 jam`) kalau `cron` tidak diberikan.
- **Webhook selalu 200** (worker & Vercel) supaya Telegram tidak retry beruntun; kerja berat di `ctx.waitUntil`/`waitUntil`. Kegagalan non-fatal cukup `console.error`.
- **`keep_names: false`, `compatibility_date: 2025-05-05`, flags `nodejs_compat` + `global_fetch_strictly_public`** — `global_fetch_strictly_public` berarti `fetch` ke URL privat/diri sendiri tidak "menempel" ke binding; jangan andalkan fetch internal Worker.
- **Batas ukuran Worker**: (arsip) riset lama menyebut batas uncompressed 64 MiB dan menyarankan cek `wrangler deploy --dry-run`; `serverExternalPackages` di `next.config.mjs` ada justru karena firebase-admin/jose tak bisa dibundel untuk Workers.
- **`type: commonjs` di root vs `type: module` di `worker/`**: modul klien yang masuk grafik `"use client"` wajib ESM, kalau tidak `next dev` error `Cannot use 'import.meta' outside a module` dan SEMUA route 500 — lihat commit `09668e9` (bukan `09668e4`; hash itu tidak ada di repo).
- **`.github/workflows/` untracked** (`git status` → `?? .github/`): ada di mesin lokal, belum ada di git. Jangan asumsikan CI/cron GHA berjalan di repo.
- **`docs/patch-notes.md` tidak punya catatan deploy Cloudflare** — bagian deploy hanya menunjuk `docs/dashboard-deploy.md` §5 (smoke manual). Untuk prosedur deploy terkini ikuti `package.json` + `wrangler.jsonc`, bukan `docs/dashboard-deploy.md` (dokumen itu era Vercel/Firebase).

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, termasuk sinonim/typo umum) | file pertama yang dibuka | catatan |
|---|---|---|
| deploy gagal / "wrangler deploy error" / worker tidak terupdate / nama worker atau database | `wrangler.jsonc` lalu `package.json` (script `deploy`) | name `simple-wms-telegram`, main `./worker/index.ts`, DB `simple-wms`; jalur `opennextjs-cloudflare build && deploy` |
| 500 di SEMUA route saat `next dev` / "Cannot use 'import.meta' outside a module" / hydration/hot reload rusak | commit `09668e9` (`git show 09668e9`) + `next.config.mjs` | modul CJS di grafik klien ESM; produksi tidak kelihatan karena HMR tidak disuntik |
| bot Telegram tidak balas / webhook tidak masuk / setWebhook / 401 unauthorized webhook | `worker/index.ts` (`/api/telegram/webhook`) → `worker/bot.ts:tanganiWebhook` | cek `TELEGRAM_WEBHOOK_SECRET` (header `x-telegram-bot-api-secret-token`) vs `setWebhook secret_token` |
| login gagal / "Login gagal." / akun terkunci 15 menit / lupa password kode tidak terkirim | `worker/api.ts:tanganiApi` → `worker/auth.ts:ambilPenggunaLogin/loginTerkunci/verifikasiPassword` | pesan sengaja seragam; `minta-kode` balas 503 bila `TELEGRAM_BOT_TOKEN` belum diset |
| cookie sesi hilang / "Belum login" padahal sudah login / logout tidak jalan | `worker/auth.ts` (`NAMA_COOKIE_SESI`, `atributCookieSesi`, `verifikasiSesi`) | cookie `swt_sesi`, TTL 12 jam, `Secure` hanya bila https |
| cron tidak jalan / notifikasi menumpuk di antrean / drain tidak mengirim | `worker/notify.ts:drainTick/drainQueue` + `wrangler.jsonc` (`triggers.crons`) | limit 25 per tick, retry maks 5, konkurensi 5; cron `*/15` |
| laporan stok harian tidak masuk / jam laporan salah | `worker/notify.ts:LAPORAN_CRON` + `bangunLaporanHarian` | 07:05 WIB; cek juga `wrangler tail` (docs/laporan-progres.md:37) |
| sinkron Kledo terjadwal diam / "AI_KEY_ENCRYPTION_KEY belum diset" | `worker/notify.ts:sinkronKledoSore` → `lib/kledo/sinkron` | cron `0 9 * * *` (16:00 WIB); kredensial dari D1 terenkripsi, bukan binding |
| env/binding kosong di produksi / "DB undefined" / vars tidak terbaca | `cloudflare-env.d.ts` + `lib/d1/db.ts:getDb/getEnvAi` | D1 harus lewat `getCloudflareContext()`; vars bisa lewat `process.env` (disuntik OpenNext) |
| route `/api/...` balas 404 / route Next ketiban Worker | `worker/api.ts` (akhir `tanganiApi`) | Worker hanya klaim 8 rute di atas; sisanya `return null` → OpenNext |
| origin ditolak 403 / CSRF / trailing slash di allowed origins | `lib/d1/route.ts:tolakOriginD1` + var `DASHBOARD_ALLOWED_ORIGINS` | tanpa trailing slash; wildcard preview `*.bagus-deva-nov-p.workers.dev` |
| error "firebase-admin" / jose / bundle Worker kebesaran / build OpenNext aneh | `next.config.mjs` (`serverExternalPackages`) + `open-next.config.ts` | config OpenNext sengaja kosong (tanpa incremental cache/R2/queue) |
| data dev hilang / tabel "no such table" saat lokal | `migrations/*.sql` + `wrangler d1 execute --local` | tidak ada npm script migrasi; D1 lokal ada di `.wrangler/` |
| e2e gagal / butuh jalankan satu spec / mock vs real | `playwright.config.ts` + `scripts/e2e-build.mjs` + `NEXT_PUBLIC_DASHBOARD_DATA` | `npm run e2e:build` dulu (mock + `NEXT_PUBLIC_ALLOW_MOCK`), baru `npx playwright test` |
| CI merah / test apa yang dijalankan di GitHub | `.github/workflows/ci.yml` (berkas lokal untracked) + `scripts/jalankan-tes-worker.mjs` | `npm ci && npm test`; runner TS lewat `npm run test:worker` |

## Belum diverifikasi
- Perilaku persis sistem Cloudflare Assets saat `assets.directory` diset tanpa `run_worker_first`: apakah request halaman yang cocok aset statis dilewati Worker sepenuhnya. Yang terverifikasi hanya isi `wrangler.jsonc` (binding `ASSETS` + direktori `.open-next/assets`) dan pass-through ke `../.open-next/worker.js` di `worker/index.ts`.
- Isi `.open-next/worker.js` (artefak build, digenerate `opennextjs-cloudflare build`) — tidak dibaca (bukan sumber).
- Nilai/nama secret yang benar-benar terpasang di akun Cloudflare (tidak bisa dicek dari repo); daftar di atas berasal dari `wrangler.jsonc`, `.dev.vars.example`, `cloudflare-env.d.ts`, dan catatan docs.
- Commit `09668e4` yang disebut di tiket tidak ada di riwayat git; hash terdekat dan jelas relevan adalah `09668e9` ("fix(dev): jadikan 5 modul CJS di grafik klien ESM — `next dev` 500 di SEMUA route").
