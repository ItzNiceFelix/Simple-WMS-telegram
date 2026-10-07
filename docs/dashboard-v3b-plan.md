# Rencana Eksekusi v3b (sinkron bot <-> dashboard)

> Turunan operasional dari `docs/dashboard-prd-v3b.md` (1187 baris, kontrak mengikat) +
> `docs/dashboard-prd-v3b-review.md` (6 blocking ditutup di PRD).

## Fakta terverifikasi

| Item | Nilai |
|---|---|
| Route API existing | 10 `route.ts` + `api/webhook.js` = **11/12** |
| Route baru v3b | **NOL**. Semua aksi titip di `POST /api/admin`. Budget tetap 11/12 |
| `opname_drafts` simpan pembuat? | TIDAK (`handleOpname.js:176-181`) -> tambah `owner_user_id` |
| `sync_stok_drafts` simpan pembuat? | TIDAK (`syncStokDuaArah.js:207-213`) -> tambah `owner_user_id` |
| Picking list simpan pembuat? | YA (`handleScreenshotPickingList.js:131` `created_by`) |
| `sessions` bisa dibaca client? | TIDAK (tak ada match di rules -> deny) |
| Picking list semantik | BATCH: satu sesi = array `movementIds`, konfirmasi proses SEMUA |
| Bot baca guard? | TIDAK -> race terbuka, bot harus ikut baca |
| Fungsi bot early-return | SENYAP -> sukses palsu, harus beri sinyal |

## Fase & wave

| Wave | Isi | File | Gate |
|---|---|---|---|
| **A-W1** | Validator v3b + guard atomik A7 (CAS `runTransaction`) | `validasiTulisV3a.js`, `accessRequests.js`, test | `npm test` hijau |
| **A-W2** | 3 aksi route: `approve-akses`, `tolak-akses`, `tambah-produk` (create-only) | `app/api/admin/route.ts`, test | `npm test` + tsc |
| **A-W3** | UI `/admin` (A7) | `app/admin/page.tsx`, komponen | tsc + e2e |
| **A-W4** | UI `/stok` (A5) + kontrak data | `app/stok/page.tsx`, `dialog-tambah-produk.tsx`, data/*, types.ts, sumber-data.tsx | tsc + e2e |
| **A-W5** | rules + deploy doc | `firestore.rules`, `dashboard-deploy.md` | ok |
| **B-W1** | Bot additive: `owner_user_id` + opsi `{kirimNotifikasi, cekGuard}` + return `{ok}` | 3 handler bot + `handleKonfirmasiCallback.js:68` | test regresi bot hijau |
| **B-W2** | Validator `konfirmasi-draft` + `draftOwner.js` | `validasiTulisV3a.js`, `draftOwner.js` | `npm test` hijau |
| **B-W3** | Aksi `konfirmasi-draft` + guard `draft_kirim_guard` | `app/api/admin/route.ts`, `firestore.rules` | route test hijau |
| **B-W4** | UI `/draft` (batch picking, sync kelompok) | `app/draft/page.tsx`, data/* | tsc + e2e |

Paralelisasi: A-W1 -> A-W2 serial. A-W3 || A-W4 setelah A-W2. B-W1 -> B-W2 -> B-W3 -> B-W4 serial (bot).

## 6 blocking yang WAJIB terbukti

| Kode | Bukti |
|---|---|
| B1 | Picking list = per BATCH (bukan per-draft); ringkasan "N siap, M dilewati" |
| B2 | Bot membaca `draft_kirim_guard` sebelum apply -> tolak saat guard aktif |
| B3 | Ketiga fungsi konfirmasi return `{ok, alasan}`; route petakan `ok:false` -> 409 |
| B4 | A7 CAS `runTransaction` status pending -> 409 atomik |
| B5 | A5 create-only transaksi (products + stock) -> 409 kode duplikat |
| B6 | State 401 per fitur: form tidak reset, dialog tidak tertutup |

## Aturan keras

- **Budget function 11/12.** NOL route baru. Semua aksi di `POST /api/admin`.
- Fase B menyentuh **3 handler bot produksi**. Bot TIDAK boleh berubah perilaku dengan default.
- `cekGuard` default **false** untuk jalur Telegram.
- `owner_user_id` diambil dari DRAFT, **bukan** body (anti pemalsuan).
- Draft lama tanpa `owner_user_id` -> **fail-closed** 409.
- TIDAK menyentuh: route admin lama, `routePesan.js`, `lib/gemini/**`, `sessions.js`, `produk.js`, `stok.js`.
- `handleKonfirmasiCallback.js` HANYA baris 68; `:47,:76` tidak diubah.
- **JANGAN mematikan proses node apa pun** (kill/taskkill/Stop-Process/kill-port dilarang). Ada 9router.

## DoD

`npm test` hijau (T1a-T1h, T2a-T2e, T3a-T3f2, T4a-T4i, T5a-T5f) + `tsc` exit 0 +
`npm run e2e` hijau + budget 11/12 + bot tidak berubah perilaku.

## Risiko yang diterima user

Keputusan: Fase A+B sekaligus, push langsung setelah gate hijau. **Bot produksi akan pakai
versi baru saat Vercel deploy, tanpa smoke test bot manual lebih dulu.** Mitigasi yang tetap ada:
test regresi T4a-T4i + `cekGuard` default false + perubahan additive (signature lama tetap valid).