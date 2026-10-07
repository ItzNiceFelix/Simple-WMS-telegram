# Catatan Fase 1 — Cutover Firestore → D1 (paritas)

Tanggal: 2026-10-07/08. Status: cutover route tulis + baca selesai, menunggu
build + verifikasi Playwright.

## Keputusan

1. **Tulis via route Next (tetap)**: semua POST sudah D1 (`lib/d1/*` +
   `sesiRoute`). Bot Telegram (`lib/`) tetap Firestore sampai Fase 2 —
   dashboard dan bot berbagi D1 nanti setelah migrasi data produksi.
2. **Baca via `GET /api/baca?scope=*`**: menggantikan Firestore client SDK.
   `real.ts` tidak lagi import `firebase/*`; sesi = cookie `swt_sesi`.
3. **Sesi ganda sementara**: cookie lama `dat_sesi` (HMAC stateless,
   `/api/auth/telegram`) MASIH dipakai route yang belum di-cutover (tidak
   ada lagi — semua route tulis sudah `sesiRoute`). Route telegram
   dipertahankan untuk Mini App sampai Fase 2.
4. **Auth web**: `/masuk` (login + lupa password via bot), `/api/auth/login`,
   `/api/auth/logout`, `/api/me`, `/api/auth/minta-kode`,
   `/api/auth/reset-password`. Provider sesi mengarahkan ke `/masuk` bila
   tanpa cookie (`perlu_masuk`, bukan `tanpa_telegram`).
5. **Aksi yang ditunda (501)**: `konfirmasi-draft` (butuh bot/Sheets di
   Worker) → Fase 2. `listOpnameDrafts/listSyncDrafts/listRoleChanges` →
   array kosong (koleksi draft bot/Sheets, bukan D1).
6. **Transfer**: `ubah-item` + `tolak` dokumen ditambahkan (sebelumnya
   hilang); `tolak-tujuan` memakai `status='ditolak'` + `status_kirim=
   'dikirim'` (paritas P1 `_ubahStatusKirimTujuan`).
7. **Ledger immutable**: tidak ada UPDATE/DELETE `stock_moves` (beda dari
   `updateStatusPergerakan` Firestore — status baru = baris koreksi).
8. **Hapus admin = soft** (`active=0` + access revoked), bukan DELETE keras.
9. **Seed demo** (`migrations/0003`): 3 produk + stok ONLINE, TANPA user —
   owner dibuat via `/api/setup/owner` saat verifikasi.

## Belum selesai

- Build5 (mode real) + upload + deploy + verifikasi live.
- Playwright: 27 spec existing (mock) + `masuk.spec.ts` baru.
- Migrasi data produksi (butuh kredensial Firestore user).
- Bot Telegram → Worker (Fase 2).
