# Baseline Test — T0.2 (Fase 0)

Tanggal: 2026-10-10. Repo `/sdcard/Download/Simple-WMS-telegram/repo`, HEAD `8ea1855`.
Belum ada perubahan kode produksi — hanya dokumen `docs/refactor-laba/`.

## 1. `npm test` penuh: TIDAK BISA SELESAI di environment ini (didokumentasikan, bukan diperbaiki)
- Percobaan 1: `npm test | tail` → 174 test, pass 119 / fail 55. Semua fail = `MODULE_NOT_FOUND` (`firebase-admin/app` ×49, `@google/generative-ai`, `googleapis`, `typescript`) karena `node_modules` belum terinstal.
- Percobaan 2–3: `npm test` penuh hang — mati di test ~106 (`worker/auth` token tests) setelah >10 menit, dua kali (bg_2, bg_4). Log parsial `/tmp/baseline-full.log` berhenti di `# Subtest: token rusak/kosong -> null`.
- `npm install` lanjutan gagal di tahap symlink: `EACCES symlink ../@babel/parser/bin/babel-parser.js -> node_modules/.bin/parser` — storage `/sdcard` (fuse) tidak mendukung symlink/exec. Akibat: `node_modules/.bin` hilang (0 file) dan paket `next` rusak parsial (`dist/server/require-hook.js` hilang, `dist/server` hanya 56 entri). File tracked git UTUH (`git diff --stat` kosong).
- Perbaikan berjalan: `npm install --no-bin-links` (bg_7) + shim biner manual di `/tmp/e2ebin`. Status saat dokumen ini ditulis: masih berjalan.

## 2. Unit test relevan PRD: HIJAU semua (cara: esbuild binary di-copy ke /tmp karena noexec)
- `lib/d1/labaShopee.test.ts`: **4/4 pass** (`hitungLabaShopee`: allowlist, qty bersih retur, rincian SKU, tolak).
- `lib/d1/order.test.ts`: **19/19 pass** (`hitungLaba`, desimal 3.5%, `alokasiLabaSku`, `porsiSku`, impor, list, transisi).
- `lib/d1/rekapPdf.test.ts`: **3/3 pass**.
- `lib/d1/orderImportShopee.test.ts`: **4/4 pass**.
- `lib/d1/picklist.test.ts`: **5/5 pass**.
- Perintah verifikasi (di dalam repo, output ke `.tmp-*` agar `react` ter-resolve):
  `node_modules` esbuild → `/tmp/esbuild-bin ... --outfile=.tmp-t-<nama>.test.mjs ... && node --test .tmp-t-<nama>.test.mjs`

## 3. e2e `order-laba.spec.ts` + `order-picklist.spec.ts`: BELUM BISA JALAN (blocker env, bukan kode)
- Prasyarat OK: Playwright 1.63.0 + browser `chromium-1243` ada di `~/.cache/ms-playwright`; `e2e/order-laba.spec.ts` + `order-picklist.spec.ts` ada (mock `?role=owner`, fixture laba 71000).
- Blocker: `node scripts/e2e-build.mjs` → `sh: 1: next: not found` (akibat `.bin` hilang); shim `/tmp/e2ebin/next` → `Cannot find module '../server/require-hook'` (paket next rusak, lihat §1).
- Lanjut setelah bg_7 selesai: verifikasi `node_modules/next/dist/server/require-hook.js` ada → `e2e-build.mjs` → `playwright test order-laba order-picklist --project=desktop`.

## 4. Kesimpulan T0.2
- Baseline kode: tidak ada fail yang menunjuk bug logika laba/order — fail penuh-suite murni environment (deps + storage).
- Test relevan PRD hijau; e2e ditunda hingga env pulih. Tidak ada perbaikan kode di fase ini sesuai PRD.
