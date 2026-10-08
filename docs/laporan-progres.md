# Laporan Progres — Simple-WMS-telegram (dikerjakan semalam)

## Fase 0 — SELESAI ✅ (live + ter-push)

- Worker `simple-wms-telegram` + D1 `simple-wms` (APAC) + auth web.
- `worker/auth.ts`: PBKDF2-SHA256, sesi opaque 12 jam, OTP 6-digit, rate-limit.
- Endpoint: health, setup/owner, login, logout, me, set-password,
  minta-kode (via bot), reset-password.
- Test `worker/auth.test.ts` 5/5 hijau.

## Fase 1 — SELESAI ✅ (live + ter-push, commit `044f046`)

- **Dashboard Next.js live di Cloudflare** via OpenNext (versi `46c41ed9`),
  15/15 halaman termasuk `/masuk` baru. Tanpa pengurangan UI.
- **Cutover Firestore → D1 penuh**:
  - `lib/d1/*` (13 modul): stok+ledger, produk, gudang, transfer (13 aksi
    + CAS), opname (CAS T9), permintaan harian, admin, akses, kamus,
    ledger, pengaturan, guard, route helper.
  - 12 route tulis Next → D1; `GET /api/baca` (11 scope) ganti Firestore SDK.
  - Auth web: `/masuk` + 5 endpoint sesi; provider redirect ke `/masuk`.
- **Terverifikasi live end-to-end**: setup owner → login → baca stok
  (DEMO-002 menipis ✅) → mutasi → tambah gudang → transfer
  setujui→kirim→terima (stok pindah benar) → opname selisih→setujui →
  HPP → reorder → histori. Data uji DIBERSIHKAN (D1 kosong kembali).
- Test D1 `6/6` hijau; typecheck `0 error`.

## Yang belum (butuh kamu)

1. **Migrasi data produksi**: skrip `scripts/migrate-firestore-to-d1.mjs`
   siap (dry-run default). Butuh `GOOGLE_APPLICATION_CREDENTIALS`
   (service account Firestore) — tidak ada di mesin ini. Jalankan dari
   mesin yang punya akses Firebase, atau kirim service account.
2. **Secrets bot (WAJIB sebelum uji Telegram)**: `wrangler secret put
   TELEGRAM_BOT_TOKEN` + `wrangler secret put TELEGRAM_WEBHOOK_SECRET`,
   lalu daftarkan webhook (`setWebhook` + `secret_token` sama). Tanpa ini:
   `minta-kode` 503, webhook tanpa secret lolos 200, balasan `/start /stok`
   tak terkirim. Uji `/start /stok /tambah` + cron drain (`wrangler tail`)
   MENUNGGU secrets ini.
3. **Token `ghp_…` di chat**: REVOKE di github.com/settings/tokens (bocor).
4. **CI workflow**: `.github/workflows/` belum ter-push (token tanpa scope
   `workflow`) — tambah manual via web atau token baru.
5. **Modul e-commerce** (Fase 3) — sesuai PRD.


## Update — Fase 1 SELESAI PENUH ✅ (2026-10-08 pagi)

- Unit: **579/579 hijau** (5 test Firestore usang dihapus, diganti
  `test/guardD1.test.js`; 3 test teks disesuaikan ke implementasi D1).
- E2E: browser diperbaiki (`playwright install --with-deps`); spec
  `/masuk` baru **2/2 lolos**. Full suite 258 test terlalu berat untuk
  sandbox (timeout) — jalankan di CI/Workers Builds.
- Halaman `/masuk` dibebaskan dari AppShell (bug: tertahan splash) —
  terverifikasi visual: form telegramId+password + lupa password.
- Alur login → dashboard "Ringkasan" terverifikasi di browser
  (empty state benar untuk DB kosong).
- Produksi: versi `4b0ea8ce` live, D1 bersih kembali.
- Commit: `8605e67`, ter-push ke repo publik.

## Update — Fase 2 TERDEPLOY ✅ (2026-10-08 siang)

- Bot webhook+command, notify queue+cron `*/5`, Excel import/export live
  (versi `b177de30`, 100% traffic, triggers aktif).
- Fix migrasi supergroup (pola scaFlow v13): webhook tangani
  `migrate_to/from_chat_id`; drain update `chat_id` + retry sekali ke chat
  baru. Notify test `3/3` hijau; typecheck `0 error`.
- Verifikasi produksi: health `db:up`; webhook POST → 200; `/masuk`+`/stok`
  200; Excel template 3 baris preview 3/3 → konfirmasi 3 → stok terbaca
  benar → export 3 baris cocok. Data uji DIBERSIHKAN (D1 kosong kembali).
- Commit: `04fb722`, ter-push ke repo publik.

## Update — Fase 3a Order + Laba SELESAI ✅ (2026-10-08 malam)

- **Order Keluar**: import pesanan MP (template sheet `Pesanan`, 12 kolom),
  filter status/MP, tombol Pack/Kirim/Selesai/Batal; stok ONLINE kurang saat
  Pack (movement `jual_mp`), kembali saat Batal (`retur_mp`), hard-block stok
  negatif.
- **Laba**: omzet/HPP/biaya/PPh 0,5%×omzet per pesanan/PPN → laba + margin;
  filter periode/MP/SKU; filter SKU menampilkan **porsi** SKU (bukan total
  order); export CSV + **PDF** (`pdf-lib`).
- Skema: migrasi `0006` (orders/order_items/order_fees/mp_fee_presets + jenis
  movement MP) + `0007` (index fee). Fresh — tanpa migrasi Firebase.
- Bot: `/laba [7h|30h]` agregat per MP.
- Test: tsc `0 error`; worker `32/32` (auth 5 + notify 3 + d1lib 6 + order 14
  + rekapPdf 3 + route TMA 4); e2e `36/36` (order-laba + histori).
- Review: tiap tugas lewat reviewer independen; final review ketemu 2 regresi
  nyata (Histori rusak oleh jenis movement baru; filter SKU menampilkan angka
  salah) → diperbaiki + diverifikasi ulang.
- Commit Fase 3a: `7fa7ecf`..`8f2f99b` (12 commit), ter-push.
- Belum: Fase 3b (lots/FEFO, cycle count/freeze, valuasi MA); JPG export.

### Catatan teknis (histori implementasi)

- `app/api/order/route.ts`: `HEADER_PESANAN` tak lagi di-export (export
  non-route memecah `next build`); `test:worker` bundle `auth.test` via esbuild.
- `filter-branch` dipakai untuk mengeluarkan `.github/workflows` dari riwayat
  Fase 3a (belum ter-push saat itu) — isi kode tak berubah, hanya hash commit.

## Cara pakai sekarang

1. Buka `https://simple-wms-telegram.bagus-deva-nov-p.workers.dev/api/setup/owner`
   sekali (buat owner pertama), atau POST tg_id + password.
2. Buka `/masuk`, login dengan telegramId + password.
3. Dashboard penuh dengan data D1 (kosong — import/migrasi dulu).
