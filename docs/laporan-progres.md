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
2. **`TELEGRAM_BOT_TOKEN` worker**: `wrangler secret put TELEGRAM_BOT_TOKEN`
   agar `minta-kode` bisa kirim via bot (sekarang 503 yang benar).
3. **Token `ghp_…` di chat**: REVOKE di github.com/settings/tokens (bocor).
4. **CI workflow**: `.github/workflows/` belum ter-push (token tanpa scope
   `workflow`) — tambah manual via web atau token baru.
5. **Bot Telegram → Worker** (Fase 2), **Excel import/export** (Fase 2),
   **modul e-commerce** (Fase 3) — sesuai PRD.

## Cara pakai sekarang

1. Buka `https://simple-wms-telegram.bagus-deva-nov-p.workers.dev/api/setup/owner`
   sekali (buat owner pertama), atau POST tg_id + password.
2. Buka `/masuk`, login dengan telegramId + password.
3. Dashboard penuh dengan data D1 (kosong — import/migrasi dulu).
