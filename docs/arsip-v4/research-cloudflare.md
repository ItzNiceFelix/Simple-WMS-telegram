# Research: Cloudflare Free vs Vercel Hobby (per September 2026)

**Proyek:** `Bot-Admin-Toko` — Next.js 15.5.25 (App Router), ~10 API route di `app/api/*/route.ts`, 1 Vercel serverless function `api/webhook.js`.
**Stack:** `firebase-admin@^12.7.0`, `firebase@^12.19.0`, `googleapis@^144`, `@google/generative-ai@^0.21`.
**Deploy sekarang:** Vercel Hobby (non-komersial).

Legend status:
- [DOC] = terverifikasi dari dokumentasi resmi (dibaca langsung, tanggal halaman dicantumkan)
- [3RD] = laporan pihak ketiga (GitHub issue / blog / forum)
- [NOT FOUND] = tidak ditemukan sumber yang meyakinkan — jangan dianggap angka pasti
- [CONFLICT] = sumber saling bertentangan

Catatan waktu: halaman Cloudflare "Limits" updated **Sep 5, 2026**; "Pricing" **Aug 28, 2026**; Pages "Limits" **Sep 5, 2026**; Pages Functions "Pricing" **Sep 8, 2026**. Halaman Vercel "Limits" **Sep 3, 2026**; Hobby **Aug 31, 2026**; Pro **Sep 2, 2026**; fair-use **Jul 29, 2026**. Ini mendekati September 2026.

---

## 1. Batas FREE Cloudflare Workers (dan Pages), Sep 2026

Sumber utama: https://developers.cloudflare.com/workers/platform/limits/ [DOC, updated Sep 5, 2026]

| Item | Workers Free | Workers Paid | Sumber |
|---|---|---|---|
| Requests | 100.000/hari (reset 00:00 UTC); lewat ini → Error 1027 (fail open atau fail closed) | Tanpa batas | workers/platform/limits/ |
| CPU time per HTTP request | **10 ms** | 5 menit (default 30 detik) | workers/platform/limits/ |
| CPU time per Cron Trigger | 10 ms | 30 detik (<1 jam interval) / 15 menit (>=1 jam) | workers/platform/limits/ |
| Wall time (HTTP request) | **Tanpa batas** selama client tetap terhubung | Tanpa batas | workers/platform/limits/ |
| Wall time (Cron / DO Alarm / Queue consumer) | bukan limit terpisah di Free; Cron = 15 menit | 15 menit | workers/platform/limits/ |
| Memory | 128 MB per isolate (=bukan per invocation; 1 isolate melayani banyak request konkuren) | 128 MB | workers/platform/limits/ |
| Subrequests per request | **50** | 10.000 (bisa dinaikkan sampai 10M) | workers/platform/limits/ |
| Subrequests ke internal services | 1.000 | mengikuti limit (default 10.000) | workers/platform/limits/ |
| Simultaneous open connections/request | 6 | 6 | workers/platform/limits/ |
| Env vars per Worker | 64 | 128 | workers/platform/limits/ |
| Worker size | **64 MiB uncompressed** (tidak ada limit compressed) | 64 MiB uncompressed | workers/platform/limits/ |
| Startup time | 1 detik | 1 detik | workers/platform/limits/ |
| Jumlah Workers per akun | **100** | 500 | workers/platform/limits/ |
| Cron Triggers per akun | **5** | 250 | workers/platform/limits/ |
| Static asset files per Worker version | 20.000 | 100.000 | workers/platform/limits/ |
| Log data per request | 256 KB | 256 KB | workers/platform/limits/ |
| Bindings (KV/D1/R2) | KV: 100k read/hari, 1k write/hari, 1 GB; D1: 5M rows read/hari, 100k rows write/hari, 5 GB; R2: 10 GB, 1M Class A, 10M Class B | berbayar sesuai pemakaian | workers/platform/pricing/ [DOC, Aug 28, 2026] |

**Worker size — ADA KONFLIK.**
- [DOC] https://developers.cloudflare.com/workers/platform/limits/ (Sep 5, 2026) secara eksplisit menyatakan: *"Worker size (uncompressed) 64 MiB / 64 MiB... There is no compressed size limit. Only the uncompressed bundle size counts."*
- [CONFLICT] Dokumentasi OpenNext http://opennext.js.org/cloudflare (di bagian "Note on Worker Size Limits") masih menulis: *"The size limit of a Cloudflare Worker is 3 MiB on the Workers Free plan, and 10 MiB on the Workers Paid plan... Only the latter (compressed size) matters."*
- Penilaian: angka 3 MiB/10 MiB adalah aturan lama. Dokumen resmi Cloudflare yang update Sep 5 2026 memakai 64 MiB uncompressed. **Saya tidak 100% yakin** kapan tepatnya perubahan 3/10 MiB → 64 MiB terjadi, tapi halaman Cloudflare resmi adalah sumber otoritatif saat ini. Untuk safety, asumsikan 64 MiB uncompressed tapi verifikasi dengan `wrangler deploy --dry-run` sebelum mengandalkan.

### Pages (bukan Pages Functions) — batas FREE
Sumber: https://developers.cloudflare.com/pages/platform/limits/ [DOC, Sep 5, 2026]

| Item | Free | Sumber |
|---|---|---|
| Builds | 1 build sekaligus | pages/platform/limits/ |
| Builds per bulan | 500 | pages/platform/limits/ |
| Build timeout | 20 menit | pages/platform/limits/ |
| Custom domains per project | 100 | pages/platform/limits/ |
| File per site | 20.000 | pages/platform/limits/ |
| Ukuran file individual | 25 MiB | pages/platform/limits/ |
| Projects per akun | 100 | pages/platform/limits/ |
| `_headers` rules | 100 | pages/platform/limits/ |
| `_redirects` | 2.000 static + 100 dynamic (total 2.100) | pages/platform/limits/ |

**Pages Functions (runtime server) memakai kuota Workers.** Sumber: https://developers.cloudflare.com/pages/functions/pricing/ [DOC, Sep 8, 2026]: *"Requests to your Pages Functions count towards your quota for the Workers Free plan. For example, you could use 50,000 Functions requests and 50,000 Workers requests to use your full 100,000 daily request usage."* Static asset requests = gratis & unlimited di kedua plan.

### Cron Triggers
- Free: maksimal **5 Cron Trigger per akun**, CPU 10 ms, wall time 15 menit. [DOC] workers/platform/limits/ (Sep 5, 2026).
- Ini kemungkinan jadi kendala kalau butuh banyak jadwal (mis. sync stok, cek reorder-point, report) — hanya 5 di Free.

### Durable Objects — relevan karena OpenNext cache pakai DO
- Free plan: **hanya DO dengan SQLite storage backend** yang tersedia. Key-value backend butuh Paid. [DOC] workers/platform/pricing/ (Aug 28, 2026).
- DO Free: 100.000 request/hari, 13.000 GB-s/hari duration; SQLite rows read 5juta/hari, rows written 100k/hari, storage 5 GB. [DOC] workers/platform/pricing/.
- Catatan: storage billing untuk SQLite DO mulai Jan 7 2026, tapi Free tetap punya alokasi di atas. [DOC].
- **Penting:** OpenNext Cloudflare memakai Durable Objects untuk caching (`DOQueueHandler`, `DOShardedTagCache`). Jadi Free plan **akan** membuat DO SQLite — masih didukung, tapi kena limit Free di atas. Sumber: https://opennext.js.org/cloudflare/known-issues [DOC].

---

## 2. Batas FREE Vercel Hobby (pembanding)

Sumber: https://vercel.com/docs/plans/hobby [DOC, Aug 31, 2026], https://vercel.com/docs/limits [DOC, Sep 3, 2026], https://vercel.com/docs/functions/usage-and-pricing [DOC, Jun 16, 2026], https://vercel.com/docs/functions/configuring-functions/duration [DOC, Aug 24, 2026].

| Item | Hobby Included | Sumber |
|---|---|---|
| Jumlah Vercel Function | **Framework-dependent** — tidak ada angka cap eksplisit di tabel; "Functions Created per Deployment: Framework-dependent". Pro/Enterprise = ∞ | vercel.com/docs/limits |
| MaxDuration function | **300s (5 menit)** default dan maksimum (dengan fluid compute default-on) | vercel.com/docs/functions/configuring-functions/duration |
| Active CPU | 4 CPU-hrs/bulan included | vercel.com/docs/plans/hobby |
| Provisioned Memory | **360 GB-hrs/bulan** included | vercel.com/docs/plans/hobby |
| Function Invocations | 1.000.000/bulan included | vercel.com/docs/plans/hobby |
| Fast Data Transfer (bandwidth) | 100 GB/bulan | vercel.com/docs/plans/hobby |
| Fast Origin Transfer | 10 GB/bulan | vercel.com/docs/plans/hobby |
| Edge Requests | 1.000.000/bulan | vercel.com/docs/plans/hobby |
| Deployments per day | 100 | vercel.com/docs/limits |
| Projects | 200 | vercel.com/docs/limits |
| Cron Jobs per project | 100 | vercel.com/docs/limits |
| Build time per deployment | 45 menit | vercel.com/docs/limits |
| Proxied request timeout | 120 detik | vercel.com/docs/limits |
| Routes per deployment | 2.048 | vercel.com/docs/limits |
| Environment variables per env per project | 1.000 (total size 64KB) | vercel.com/docs/limits |
| Runtime logs retention | 1 jam | vercel.com/docs/plans/hobby |
| Image transform | 5.000/bulan | vercel.com/docs/plans/hobby |
| Web Analytics events | 50.000/bulan | vercel.com/docs/plans/hobby |
| WAF IP Blocking | sampai 3 | vercel.com/docs/plans/hobby |
| WAF Custom Rules | sampai 3 | vercel.com/docs/plans/hobby |

Catatan maxDuration: catatan lama di `vercel.com/docs/limits` (project dibuat sebelum 23 Apr 2025 & tidak pakai Fluid compute) menyebut Hobby maks 60s. Tapi sejak Fluid compute default-on, tabel resmi di `configuring-functions/duration` menetapkan **Hobby = 300s default + maksimum**. `api/webhook.js` proyek ini set `maxDuration 300` — masih **valid di Hobby**, tidak perlu upgrade untuk duration.

### Batas komersial Hobby — INI KRITIS
Sumber: https://vercel.com/docs/limits/fair-use-guidelines [DOC, Jul 29, 2026].

> **Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan.**

Definisi komersial mencakup: minta/proses pembayaran dari visitor, iklan, menjual produk/jasa, affiliate linking sebagai tujuan utama, dibayar untuk membuat/mengupdate/hosting situs. **Donasi tidak termasuk komersial.**

Implikasi langsung: ini adalah **bot admin toko untuk bisnis** ("admin toko", cek stok, HPP, picking list, opname). Kalau ini dipakai operasional toko/UMKM yang menghasilkan uang, **Hobby melanggar fair-use Vercel**. Ini alasan sah dan mendesak untuk pindah (Cloudflare Free tidak punya larangan komersial seperti ini) atau upgrade ke Vercel Pro.

---

## 3. Apakah `firebase-admin` (gRPC) jalan di Workers dengan `nodejs_compat`?

**Jawaban: Kemungkinan besar TIDAK, dan bukti kuat mengarah ke tidak berjalan tanpa patch. JANGAN anggap ini berjalan out-of-the-box.**

### Bukti status runtime [DOC]
- Workers hanya menyediakan `node:http2` sebagai **non-functional stub** (import berhasil, tapi memanggil API-nya gagal). `node:http2` baru aktif sebagai stub dengan `nodejs_compat` pada compatibility date >= 2025-09-01. Sumber: https://developers.cloudflare.com/workers/runtime-apis/nodejs/ [DOC, Aug 12, 2026] — tabel "Non-functional stub modules".
- `node:net` (TCP socket) **didukung** [DOC] https://developers.cloudflare.com/workers/runtime-apis/nodejs/net/, tapi `net.Server` tidak didukung. gRPC butuh HTTP/2, bukan sekedar TCP socket.
- Jadi jalur gRPC (`@grpc/grpc-js` → HTTP/2) **tidak punya implementasi HTTP/2 nyata** di Workers. Ini adalah akar masalah, terlepas dari `nodejs_compat`.

### Bukti laporan nyata [3RD]
1. **opennextjs-cloudflare issue #737** — "[BUG] firebase admin (Jose) does not work with workers + nexts" (dibuka 18 Jun 2025, **closed as completed**). Error: `Could not resolve "Jose"` lewat `firebase-admin → jwks-rsa → jose@4.15.9`; `jose` package memilih entry `"workerd": "./dist/browser/index.js"` yang tidak ada di filesystem. Reporter juga menautkan https://github.com/firebase/firebase-admin-node/issues/2069 sebagai akar. Sumber: https://github.com/opennextjs/opennextjs-cloudflare/issues/737 [3RD].
   - Status issue "closed completed" **bukan berarti fix**; sering hanya diclose karena bukan scope adapter. Perlu verifikasi manual.
2. **firebase/firebase-admin-node issue #2069** — "Various issues when used with Cloudflare Pages" (dibuka 10 Feb 2023, **masih OPEN**, label `type: feature request`). Error: `TypeError: globalThis.XMLHttpRequest is not a constructor` (dari polyfill `http-lib`; Workers tidak punya XMLHttpRequest), plus `Could not resolve "@firebase/database-compat/standalone"` saat import `admin.auth()`. Assignee ada (`lahirumaramba`) tapi tetap open sejak 2023. Sumber: https://github.com/firebase/firebase-admin-node/issues/2069 [3RD].
3. **opennextjs-cloudflare issue #1301** — "[BUG] protobufjs codegen uses new Function() at runtime, crashes in Workers (firebase/firestore)" (dibuka 1 Jul 2026, **masih OPEN**). Ini paket `firebase` (client), bukan admin, di jalur `@grpc/proto-loader → protobufjs/ext/descriptor`, memanggil `new Function()` saat init → `EvalError: Code generation from strings disallowed for this context`. Workaround yang dilaporkan = post-build patch regex ke `handler.mjs`. Sumber: https://github.com/opennextjs/opennextjs-cloudflare/issues/1301 [3RD].

### Kesimpulan tugas 3
- **Saya tidak bisa memverifikasi `firebase-admin` berjalan di Workers.** Bukti yang ada menunjukkan **gagal**: (a) HTTP/2 hanya stub di Workers [DOC], (b) issue firebase-admin-node #2069 open sejak 2023 dengan error nyata di Cloudflare [3RD], (c) OpenNext issue #737 melaporkan firebase-admin gagal [3RD], (d) protobufjs `new Function()` meledak [3RD].
- Catatan penting: `firebase-admin` **default-nya** memakai gRPC untuk Firestore. Ada opsi fallback REST (`PreferRest`/`Firestore.settings({preferRest: true})`) di SDK modern — tapi **saya TIDAK menemukan sumber yang memverifikasi kombinasi ini berhasil di Workers dengan `nodejs_compat`.** [NOT FOUND] Jangan asumsikan.

### Alternatif (urut dari paling sedikit usaha) [rekomendasi saya, bukan klaim docs]
1. **Tetap di Vercel** (paling praktis) — `firebase-admin` + `googleapis` jalan native di Node runtime Vercel. Upgrade ke Pro kalau ada komersial. Ini jalur dengan risiko nol.
2. **Workers + Firebase REST API langsung** — ganti `firebase-admin` firestore calls dengan Firebase REST/Firestore REST atau `firebase` client SDK yang compatible Workers. Ini artinya refactor besar; hanya `googleapis` (yang juga pakai HTTP/2 untuk sebagian API?) perlu dicek. `googleapis` juga memakai `gaxios`/HTTP biasa untuk banyak API, jadi mungkin lebih kompatibel, tapi **perlu proof-of-concept**. [NOT FOUND untuk verifikasi].
3. **Cloudflare Workers + Cloudflare D1/KV** — pindah dari Firestore. Refactor sangat besar, kemungkinan tidak ekonomis.
4. **Kompatibilitas Node dengan `nodejs_compat` + patch polyfill** — rapuh, tidak disarankan untuk produksi (lihat workaround regex di issue #1301).

**Rekomendasi jujur:** kalau aplikasi bergantung pada `firebase-admin` + `googleapis`, migrasi ke Cloudflare Workers berisiko tinggi dan kemungkinan butuh refactor besar. Jangan migrasi hanya demi "gratis".

---

## 4. Apakah OpenNext Cloudflare adapter mendukung Next.js 15 App Router API routes dengan `runtime="nodejs"`?

Sumber: http://opennext.js.org/cloudflare [DOC] dan http://opennext.js.org/cloudflare/known-issues [DOC].

**Ya — ini justru model yang didukung secara resmi.**

- [DOC] "The `@opennextjs/cloudflare` adapter lets you deploy Next.js apps to Cloudflare Workers using the Node.js 'runtime' from Next.js."
- [DOC] "When you use `@opennextjs/cloudflare`, your app should use the **Node.js runtime**, which is more fully featured... This is an important difference from `@cloudflare/next-on-pages`, which only supports the 'Edge' runtime."
- **Supported Next.js versions** [DOC]: "Next.js 16 and the latest minors of Next.js 14 and 15 are supported." Next.js 14 support di-drop Q1 2026. Next.js **15.5.25** (versi proyek ini) ada di rentang yang didukung.
- **Supported features** [DOC] mencakup eksplisit: **App Router**, **Route Handlers** (= `app/api/*/route.ts`), dynamic routes, SSG, SSR, middleware, image optimization, PPR, Pages Router, ISR.
  - **Caveat** [DOC]: "Node Middleware introduced in 15.2 are not yet supported." — hanya relevan kalau pakai Node middleware; route handler sendiri OK.
- Cara deploy: `npx @opennextjs/cloudflare` build lalu `wrangler deploy`. Worker size diperiksa `wrangler` (lihat konflik ukuran di bagian 1).

**Catatan Windows** [DOC]: "OpenNext can be used on Windows systems but Windows full support is not guaranteed." Proyek ini di Windows (workdir `C:\Users\...`). Disarankan pakai WSL, Linux VM, atau build di CI (GitHub Actions linux). Ini bukan blocker tapi menambah friksi.

**Catatan penting:** dukungan adapter untuk App Router API routes **tidak** berarti dependency di dalam route berjalan. `firebase-admin` tetap masalah terpisah (bagian 3). Adapter hanya soal Next.js → Worker, bukan kompatibilitas npm package.

---

## 5. Model harga saat naik dari free ke berbayar

### Cloudflare Workers Paid
Sumber: https://developers.cloudflare.com/workers/platform/pricing/ [DOC, Aug 28, 2026].

- **Minimum $5/bulan per akun** (bukan per Worker). Termasuk:
  - 10 juta request/bulan; +$0.30 per juta tambahan.
  - 30 juta CPU-ms/bulan; +$0.02 per juta CPU-ms tambahan.
  - Duration: tidak ada charge, tidak ada limit.
  - Max CPU per invocation: 5 menit (default 30 detik). Max 15 menit untuk Cron/Queue.
  - **Tidak ada biaya egress/bandwidth.** [DOC]
  - Static asset requests gratis & unlimited.
- Contoh [DOC]: 15 juta request @7ms CPU ≈ $8/bulan total. 100 juta request @7ms ≈ $45.40/bulan.
- KV Paid: 10M read/bulan +$0.50/juta; 1M write +$5/juta; storage 1 GB +$0.50/GB-month.
- R2 Free: 10 GB + 1M Class A + 10M Class B per bulan, **egress gratis**.

### Cloudflare Pages (Functions)
Sumber: https://developers.cloudflare.com/pages/functions/pricing/ [DOC, Sep 8, 2026].
- Functions dibilling sebagai Workers. Paid Functions masuk kuota Workers Paid (Standard usage model). Static assets gratis/unlimited di kedua plan. **Jadi tidak ada "harga Pages" terpisah** — sama dengan Workers.

### Vercel Pro
Sumber: https://vercel.com/docs/plans/pro-plan [DOC, Sep 2, 2026], https://vercel.com/docs/limits/fair-use-guidelines [DOC, Jul 29, 2026].

- **$20/bulan platform fee.** Termasuk:
  - 1 deploying seat (seat tambahan $20/bulan/user; viewer seat gratis).
  - **$20/bulan kredit** yang bisa dipakai lintas resource, hangus tiap bulan.
  - Flat Rate CDN tier terendah: 1 juta CDN request + 1 TB data transfer/bulan.
- Setelah kredit habis → on-demand. Rate dari fair-use halaman [DOC]:
  - Function Invocations: $0.60 per 1.000.000.
  - Active CPU: mulai $0.128/jam (per region; mis. iad1/pdx1/cle1 $0.128; São Paulo $0.221).
  - Provisioned Memory: mulai $0.0106/GB-hr (per region; São Paulo $0.0183).
  - Image Transform: $0.05/1K; Image Cache Reads $0.40/1M; Image Cache Writes $4.00/1M.
- MaxDuration Pro: 300s default, **800s maksimum GA**, 1800s (30 menit) beta lewat extended max duration. [DOC] configuring-functions/duration.
- Add-ons: SAML SSO $300/bln; HIPAA BAA $350/bln; Password Protection $20/bln/project terkunci; Observability Plus $1.20/1M event; Preview Deployment Suffix $100/bln; Static IPs $100/bln/project; Web Analytics Plus $10/bln; Speed Insights Plus $10/bln/project.

### Perbandingan biaya kasar (skenario proyek ini)
| Skenario | Cloudflare | Vercel |
|---|---|---|
| Hobi/non-komersial, trafik rendah | **$0** (Free) | **$0** (Hobby) |
| Produksi komersial 1 juta request/bulan | $5 (Paid, muat 10M req) | $20 (Pro) |
| Tidak ada egress charge | Ya [DOC] | Fast Data Transfer 100GB lalu berbayar |

Catatan: Vercel Hobby sekarang **secara eksplisit melarang komersial**; Cloudflare Free tidak punya larangan serupa di halaman limits/pricing yang dibaca. Tapi saya **tidak menemukan** bagian ToS Cloudflare Free yang membahas larangan komersial secara eksplisit — [NOT FOUND], verifikasi sendiri sebelum mengandalkan.

---

## Ringkasan eksekutif & rekomendasi

1. **Cloudflare Free jauh lebih ketat di CPU (10 ms per request)** vs Vercel Hobby (300s duration). Next.js SSR + `firebase-admin` + `googleapis` + Gemini **akan sering melewati 10 ms CPU**. Secara praktis, Workers Free kemungkinan **tidak cukup** untuk beban ini; Paid ($5, CPU 30s default) kemungkinan lebih realistis.
2. **Blocker utama = `firebase-admin`.** Bukti runtime (HTTP/2 hanya stub) + 3 GitHub issue menunjukkan tidak jalan tanpa patch. Migrasi ke Workers kemungkinan butuh **refactor besar** (Firestore REST atau ganti backend). Ini risiko terbesar.
3. **Pemicu sah untuk meninggalkan Hobby = larangan komersial Vercel.** Kalau toko ini komersial, Hobby melanggar fair-use. Pilihan termurah yang benar: **Vercel Pro $20/bln** (tetap, tanpa refactor) vs **Cloudflare Workers Paid $5/bln** (murah, tapi butuh refactor `firebase-admin`).
4. Kalau memang ingin pindah ke Cloudflare: pakai Workers Paid (bukan Free), bukan Pages (Pages Functions = kuota Workers juga), dan **kerjakan proof-of-concept `firebase-admin`/`googleapis` dulu** sebelum commit migrasi. Uji: (a) build OpenNext, (b) deploy, (c) panggil satu route yang baca Firestore.

### Yang belum terverifikasi / jangan diandalkan
- Ukuran bundle Worker Free: dokumen resmi (64 MiB uncompressed) vs OpenNext (3 MiB compressed). [CONFLICT]
- Apakah `firebase-admin` dengan `preferRest: true` benar-benar jalan di Workers + `nodejs_compat` [NOT FOUND].
- Apakah `googleapis` jalan di Workers (sebagian API-nya memakai HTTP/2) [NOT FOUND].
- Larangan komersial Cloudflare Free (kalau ada) [NOT FOUND].
- Perubahan limit Pages yang tidak tercantum di halaman yang dibaca.

---

## Sumber
- Cloudflare Workers Limits — https://developers.cloudflare.com/workers/platform/limits/ (Sep 5, 2026)
- Cloudflare Workers Pricing — https://developers.cloudflare.com/workers/platform/pricing/ (Aug 28, 2026)
- Cloudflare Pages Limits — https://developers.cloudflare.com/pages/platform/limits/ (Sep 5, 2026)
- Cloudflare Pages Functions Pricing — https://developers.cloudflare.com/pages/functions/pricing/ (Sep 8, 2026)
- Cloudflare Node.js compatibility — https://developers.cloudflare.com/workers/runtime-apis/nodejs/ (Aug 12, 2026)
- Cloudflare node:net — https://developers.cloudflare.com/workers/runtime-apis/nodejs/net/ (Apr 23, 2026)
- Cloudflare Compatibility flags — https://developers.cloudflare.com/workers/configuration/compatibility-flags/ (Aug 20, 2026)
- OpenNext Cloudflare Overview — http://opennext.js.org/cloudflare
- OpenNext Cloudflare Known issues — http://opennext.js.org/cloudflare/known-issues
- OpenNext issue #737 (firebase admin) — https://github.com/opennextjs/opennextjs-cloudflare/issues/737 [3RD]
- OpenNext issue #1301 (protobufjs new Function) — https://github.com/opennextjs/opennextjs-cloudflare/issues/1301 [3RD]
- firebase-admin-node issue #2069 — https://github.com/firebase/firebase-admin-node/issues/2069 [3RD]
- Vercel Limits — https://vercel.com/docs/limits (Sep 3, 2026)
- Vercel Hobby — https://vercel.com/docs/plans/hobby (Aug 31, 2026)
- Vercel Pro — https://vercel.com/docs/plans/pro-plan (Sep 2, 2026)
- Vercel Fair Use Guidelines — https://vercel.com/docs/limits/fair-use-guidelines (Jul 29, 2026)
- Vercel Functions usage & pricing — https://vercel.com/docs/functions/usage-and-pricing (Jun 16, 2026)
- Vercel Configuring max duration — https://vercel.com/docs/functions/configuring-functions/duration (Aug 24, 2026)
