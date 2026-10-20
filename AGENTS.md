# Simple WMS Telegram — panduan agent

Next.js 15 App Router + OpenNext di Cloudflare Workers, D1 (binding `DB`), bot Telegram, PDF (pdf-lib), integrasi Kledo/Sheets.
Jalur **aktif**: `app/` + `lib/d1/*` + `worker/*` + `migrations/*.sql`.
Jalur **lama** (Vercel + Firestore; jangan dipakai untuk fitur baru): `api/webhook.js`, `lib/router`, `lib/handlers`, `lib/gemini`, `lib/models`, `vercel.json`, `firebase.json`, `docs/arsip-v4/**`. Sebagian masih hidup: `lib/kledo`, `lib/sheets`, `lib/reminder`, `scripts/jalankan*` (dipanggil cron/worker).

## Hemat token: baca peta dulu, jangan seluruh repo

1. Buka `docs/map/00-index.md` → pilih area.
2. Buka **satu** `docs/map/NN-*.md` sesuai gejala. Tabel “Kalau masalahnya … buka …” di tiap peta menunjuk file pertama + gotcha.
3. Baru `read` file target itu (pakai rentang baris). Jangan menyapu `lib/`, `components/`, `docs/` global.

Peta area: `01` runtime/deploy · `02` database D1 · `03` order/picklist · `04` laba/harga-jual · `05` stok/gudang · `06` permintaan antar gudang · `07` AI · `08` printing/desain · `09` dashboard/analisa · `10` auth/akses · `11` bot Telegram · `12` integrasi/sinkron · `13` UI/komponen · `14` test/tooling.

## Lapisan

- API Next: `app/api/**/route.ts` → `lib/d1/*` (satu-satunya tempat SQL D1). Urutan guard di `lib/d1/route.ts`: origin → sesi → rate limit → role → validasi → model.
- Worker: `worker/index.ts` → `/api/telegram/webhook` → `worker/bot.ts`; auth/health/me → `worker/api.ts` + `worker/auth.ts`; cron → `worker/notify.ts`.
- UI: `app/<halaman>/page.tsx` + `components/{ui,dashboard}/*` → `fetch('/api/...')`.
- Bot legacy: `api/webhook.js` → `lib/router` → `lib/handlers` → `lib/gemini` → `lib/models`.
- D1: tabel dari `migrations/NNNN_*.sql`; helper `lib/d1/db.ts`, `ledger.ts`, `guard.ts`.

## Perintah

- `npm run dev` · `npm run typecheck` · `npm test` (CJS) · `npm run test:worker` (TS) · `npm run e2e` (build mock dulu) · satu spec: `npx playwright test e2e/<x>.spec.ts --project=desktop` · `npm run deploy`.
- Peta dokumentasi: `npm run peta:indeks` (bangun ulang `docs/map/00-index.md` dari peta area) · `npm run peta:verifikasi` (cek setiap path/simbol di peta; exit 1 bila ada yang tidak ada).
- D1 tidak punya npm script: `npx wrangler d1 execute simple-wms --local|--remote --file=migrations/NNNN_*.sql`.
- Jalankan build/test sekali di akhir pekerjaan, bukan di tengah; jangan commit artefak (`.next/`, `.open-next/`, `.wrangler/`).

## Aturan keras

- SQL hanya di `lib/d1/*`; route tidak query D1 langsung.
- Jangan ubah migrasi lama; tambah file `NNNN_*.sql` baru.
- Rahasia via `wrangler secret put`; jangan tulis/print token.
- Kalau menambah route/modul/halaman/tabel, tambah 1 baris di `docs/map/NN-*.md` yang sesuai (peta harus tetap benar).
- `README.md`, `docs/architecture.md`, `docs/arsip-v4/**`, `docs/_archive/**` = arsitektur lama; jangan jadikan acuan.
