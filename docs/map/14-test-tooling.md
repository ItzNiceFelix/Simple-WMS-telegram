# 14 — Test & Tooling (unit, e2e, skrip manual)

## Ringkasan area

- Empat lapis verifikasi: (1) unit CJS `test/**/*.test.js` (node:test), (2) unit TS `lib|app|worker/**/*.test.ts` (di-bundle esbuild lalu node:test), (3) e2e Playwright mode MOCK (`e2e/*.spec.ts`), (4) skrip manual `scripts/**` untuk hal yang tidak bisa diotomasi di CI (data nyata, Deploy D1, Sheets/Telegram asli).
- TIDAK ada vitest/jest: semuanya `node:test` + `node:assert/strict`. `package.json` `"type": "commonjs"`, `engines.node >= 20`, CI pakai Node 22.
- Hitungan: `test/` = 85 file (67 `*.test.js` root + 10 `test/ai/**` + 5 `test/alias-*.mjs` + 3 `test/helpers/*.js`); unit TS = 53 file; e2e = 36 spec (~233 test); `scripts/` = 26 skrip root + `scripts/lib/firebaseCli.mjs`.
- Batas area: isi/detail modul `lib/d1/*` tidak di sini (peta Database), UI/halaman tidak di sini (peta UI/Dashboard), deploy/wrangler tidak di sini (peta RuntimeDeploy). Peta ini hanya soal CARA menguji + skrip.
- e2e SELALU mode mock (PRD I2): tidak boleh menembak Firestore/Telegram nyata. Mode real diuji manual via `scripts/e2e-build-real.mjs` + `scripts/cek-real.mjs`.
- Angka di dokumen laporan (`docs/test-report*.md`) sering basi vs kode; selalu jalankan gate sendiri (`docs/learnings.md`).

## Peta file

| file | peran | export/entry penting |
|---|---|---|
| `package.json` | daftar perintah gate (`scripts`) | `test`, `test:worker`, `e2e`, `e2e:fast`, `e2e:full`, `e2e:dev`, `e2e:build`, `typecheck` |
| `playwright.config.ts` | 3 project + webServer mock | `LAYOUT_SENSITIVE`, `DESKTOP_ONLY`, `defineConfig` (baseURL `http://127.0.0.1:3100`) |
| `test/*.test.js` | 67 unit CJS (node:test) | tiap file `test(...)` |
| `test/ai/**/*.test.js` | 10 unit AI provider/fallback | `test/ai/index.test.js`, `test/ai/adapters/openaiCompat.test.js` |
| `test/helpers/mockFirestore.js` | mock Firestore in-memory (transaksi diserialkan) | `installMockFirestore()` |
| `test/helpers/mockSheets.js` | mock Sheets v4 STATEFUL (bacaRange/tulisRange/append) | `installMockSheets()` |
| `test/helpers/stubTelegram.js` | stub `lib/telegram/kirimPesan` via require.cache | `installStubTelegram()` |
| `test/alias-db.mjs` | stub `@/lib/d1/db` untuk bundel test:worker | `getDb()`, `sekarang()`, `getEnvAi()`, `gagal()`, `getKunciEnkripsi()` |
| `test/alias-next-server.mjs` | stub minimal `next/server` | `NextResponse.json` |
| `test/alias-initdata.mjs` | arahkan import `@/lib/dashboard/auth/initData.js` ke file nyata | re-export `buatInitData`, `verifikasiInitData`, `InitDataError` |
| `test/alias-require-initdata.mjs` | patch `node:module` createRequire (dipakai `--import`) | no-op bila tak relevan |
| `test/alias-route-order.mjs` | stub `@/lib/d1/route` (sesi palsu admin) untuk uji route order | `sesiRoute()`, `json()`, `bacaBody()` |
| `lib/**/*.test.ts` (48) | unit TS bundled esbuild | mis. `lib/d1/order.test.ts`, `lib/printing/watermark.test.ts` |
| `app/api/auth/tma/route.test.ts`, `app/api/order/route.test.ts` | unit route Next nyata (mock D1 + alias) | `POST` / `GET` dari `./route` |
| `worker/*.test.ts` | unit worker CF | `auth.test.ts`, `bot-akses.test.ts`, `notify.test.ts` |
| `scripts/jalankan-tes-worker.mjs` | runner unit TS: discover → esbuild → node:test | CLI tanpa argumen |
| `scripts/e2e-build.mjs` | build Next mode mock untuk e2e | set `NEXT_PUBLIC_DASHBOARD_DATA=mock`, `NEXT_PUBLIC_ALLOW_MOCK=true` |
| `scripts/e2e-build-real.mjs` | build mode real (uji R11) | tanpa `NEXT_PUBLIC_ALLOW_MOCK` |
| `e2e/*.spec.ts` | 36 spec Playwright | tiap file `test(...)` |
| `.github/workflows/ci.yml` | gate CI tiap push/PR ke main | `npm ci` → `npm test` (Node 22) |
| `.github/workflows/reminder-harian.yml`, `sync-master-data.yml` | cron memanggil skrip | `node scripts/jalankanReminderHarian.js`, `jalankanSyncMasterData.js` |
| `docs/test-report.md` | laporan v3a (Sheets grid + paritas stok, 602 test, mutation test) | historis |
| `docs/test-report-v5-1.md`, `docs/test-report-v5-w4.md` | laporan v5.1 & v5 W4 (CAS/urutan guard) | historis, jangan ditimpa |
| `docs/audit-e2e.md` | audit efisiensi e2e: alasan 3 project, gate cepat vs full, usulan pangkas spec | historis/desain |
| `docs/learnings.md` | pelajaran tooling & jebakan test (glob, seed mock, laporan basi, BOM) | historis |
| `scripts/lib/firebaseCli.mjs` | helper Firestore REST via token Firebase CLI | `PROJECT`, `ROOT`, `BASE`, `token()`, `semua()`, `angka()` |

## Alur data

1. Unit CJS: `npm test` → `node --test "test/**/*.test.js"` (rekursif, termasuk `test/ai/*`) → lalu `npx esbuild worker/auth.test.ts --bundle --outfile=.tmp-auth-npm.test.mjs` → `node --test .tmp-auth-npm.test.mjs`.
2. Unit TS: `npm run test:worker` → `scripts/jalankan-tes-worker.mjs` mengumpulkan `lib/**/*.test.ts` + `app/**/*.test.ts` + `worker/*.test.ts` (urut alfabetis) → per file `npx esbuild <file> --bundle --platform=node --format=esm --define:__dirname="'.'"` (+ alias/stub) → `node [--import patch] --test .tmp-*.test.mjs` → hapus temp; exit 1 bila ada yang gagal.
3. e2e (mock): `npm run e2e:build` (atau `npm run e2e`) → `playwright test` → `webServer` menjalankan `npx next start -p 3100` → halaman memakai DataSource mock (`lib/dashboard/data/mock.ts`) → spec berinteraksi via `?role=owner` (diizinkan hanya karena `NEXT_PUBLIC_ALLOW_MOCK=true`); sebagian spec meng-`page.route("**/api/...")` untuk membekukan kontrak respons.
4. e2e (real R11): `node scripts/e2e-build-real.mjs` → `npx next start -p 3105` (job terpisah) → `node scripts/cek-real.mjs` (exit 0 = lulus) / `node scripts/cek-splash-real.mjs` / `node scripts/cek-tg-sdk.mjs`.
5. Skrip data manual: `scripts/lib/firebaseCli.mjs` `token()` → Firestore REST (`backup-stock-v5`, `verify-backfill`, `migrate-backfill-v5`, dll); D1 lewat `wrangler d1 execute` (`muat-seed-laba.mjs`, `migrate-firestore-to-d1.mjs --apply`); jalur API + cookie sesi (`mutasi-batch2.mjs`).

## Endpoint & tabel terkait

- `POST /api/auth/tma` → `app/api/auth/tma/route.ts` → `POST` (unit `app/api/auth/tma/route.test.ts`; guard origin-nya e2e `e2e/tma.spec.ts`).
- `GET|POST /api/order` → `app/api/order/route.ts` (unit `app/api/order/route.test.ts`, fokus FK `order_items.sku` + penanda `+PERLU-SKU-*`); e2e `e2e/order-laba.spec.ts`, `e2e/order-picklist.spec.ts`, `e2e/preview-picklist.spec.ts` (intercept `aksi=daftar|picklist-pdf|preview-picklist`).
- `POST /api/stok/gudang` dipakai `scripts/mutasi-batch2.mjs` (butuh cookie `SW_COOKIE`).
- Tabel D1 yang di-guard test: `migrations/0002_fase1_skema.sql` — index `idx_moves_sku`, `idx_moves_pending`, `idx_dest_wh`, `idx_sbb_sku`, `idx_users_role`, `idx_sbb_wh` dicek `test/guardD1.test.js`.
- Ditulis skrip manual (bukan test): `seller_presets` + `tier_admin` oleh `scripts/muat-seed-laba.mjs` (remote D1 via wrangler); koleksi `stock` Firestore oleh `scripts/migrate-backfill-v5.mjs --apply`.

## Test terkait

Cara menjalankan:

- Semua unit CJS: `npm test` (juga = gate CI).
- Satu file unit: `node --test test/sesi.test.js` (atau `node --test test/ai/index.test.js`).
- Semua unit TS (worker/lib/app): `npm run test:worker`.
- Satu file unit TS: tidak ada flag di runner; tiru manual → `npx esbuild lib/d1/order.test.ts --bundle --platform=node --format=esm --outfile=.tmp.test.mjs --define:__dirname="'.'" --external:react --external:@opennextjs/cloudflare && node --test .tmp.test.mjs` (untuk `app/api/order/route.test.ts` tambah `--alias:@/lib/d1/db=./test/alias-db.mjs --alias:@/lib/d1/route=./test/alias-route-order.mjs --alias:next/server=./test/alias-next-server.mjs`).
- Semua e2e: `npm run e2e` (= build mock + semua project); gate cepat `npm run e2e:fast` (~desktop + desktop-viewport); `npm run e2e:full` sama dengan `e2e`; `npm run e2e:dev` hanya Playwright (butuh build mock sudah ada).
- Satu spec: `npm run e2e:build && npx playwright test e2e/stok.spec.ts`; satu test: `npx playwright test e2e/stok.spec.ts -g "nama test"`.
- Mode headed: `npx playwright test e2e/stok.spec.ts --headed`; paksa project: `--project=mobile` / `--project=desktop`.
- Test worker = `npm run test:worker` (bukan Playwright).
- Typecheck: `npm run typecheck`.

Kelompok `test/*.test.js` (67): auth & guard (`sesi`, `initData`, `guard`, `guardD1`, `guardV5`, `authFlow`, `rateLimit`, `bacaUidToken`, `superAdmin`); admin & akses (`adminRole`, `auditRole`, `adminKelola`, `adminGudangJabatan`, `accessRequests`, `adminRoute`, `adminRouteV3b`); permintaan (`permintaanHarian`, `permintaanGudang`, `permintaanRoute`, `paritasPermintaanV51`, `dailyRequests`); stok/sync (`mutasiStok`, `stokGudangMutasi`, `stokGudangQty`, `stokPaginasi`, `stockFilter`, `reorderPoint`, `reminderHarian`, `opnameGudang`, `gudangMaster`, `produkOnline`, `bacaStokOnlineFilter`, `sheetsClientKolom`, `syncStok*`/`backfill*`); bot/notif (`konfirmasiBotV3b`, `gapV3b`, `draftKonfirmasiV3b`, `handleScreenshotPickingList`, `handleSettings`, `kataKunci`, `keywordActionType`, `keywordNotes`, `notifikasiError`, `notifikasiTeks`, `routeFotoOpname`, `bentukHasilModel`); dashboard murni (`combobox`, `selectValueGuard`, `riwayatEditorDesain`, `orderPaginasiSort`, `mockParitas`, `paritasA2Data`, `editProduk`, `base64Gambar`, `casModelFirestore`, `env*`, `providerAi*`).

15 file unit terpenting:

| file | yang dijaga |
|---|---|
| `test/guardD1.test.js` | urutan guard route D1 (origin→sesi→rate-limit→role→validasi) dibaca dari sumber nyata + index migrasi 0002 |
| `test/mockParitas.test.js` | guard tulis mode mock tidak lebih longgar dari validator server (`lib/dashboard/data/mock-paritas.mjs`) |
| `test/paritasPermintaanV51.test.js` | paritas `mock.ts` ↔ `lib/models/permintaanGudang.js` (per-tujuan v5.1), load via transpile TS |
| `test/sesi.test.js` | `buatTokenSesi`/`verifikasiTokenSesi`/`atributCookie`/`ambilTokenDariCookie`/`UMUR_SESI_DETIK` |
| `test/initData.test.js` | `verifikasiInitData`/`buatInitData`/`susunDataCheckString` (HMAC Telegram) |
| `test/mutasiStok.test.js` | transaksi atomik tulis stok, stok negatif, audit 1 baris, `created_by` string |
| `test/syncStokReplay.test.js` | replay end-to-end `/sync_stok` (mock Sheets stateful + Firestore) |
| `test/sheetsClientKolom.test.js` | `tambahKolomHeader` urutan metadata→expand→tulis + throw sheet hilang |
| `test/handleScreenshotPickingList.test.js` | `stock_movements.action_type` harus STRING lewat handler nyata |
| `test/permintaanGudang.test.js` | model `permintaan_gudang` v5.1 (target gudang, status per-tujuan) |
| `test/providerAiParitas.test.js` | paritas daftar provider: shim TS == registry backend == model aiSettings |
| `test/riwayatEditorDesain.test.js` | undo/redo + geometri ekspor editor desain (logika diekstrak, fabric butuh DOM) |
| `test/selectValueGuard.test.js` | cegah `<SelectValue />` menampilkan nilai mentah (uuid) |
| `lib/d1/order.test.ts` | `listOrder`/`ambilOrder`/`imporPesanan`/`transisiFulfill*` dengan mock D1 setia WHERE |
| `app/api/order/route.test.ts` | `konfirmasi-shopee`: FK `order_items.sku` + penanda `+PERLU-SKU-*` (mock memodelkan FK) |

Fungsi stub alias (dipakai `scripts/jalankan-tes-worker.mjs` via `--alias:` / `--import`, hanya untuk harness, BUKAN modul produksi):
`alias-next-server.mjs` (`next/server` tak bisa di-ESM-resolve), `alias-db.mjs` (`@/lib/d1/db` memanggil `getCloudflareContext()` yang mati di luar Worker → ambil DB dari `globalThis.__TMA_TEST_DB__`), `alias-initdata.mjs` + `alias-require-initdata.mjs` (bundel memindahkan `import.meta.url`/`createRequire` ke root repo → specifier relatif `../../../../lib/dashboard/auth/initData.js` meleset 4 tingkat), `alias-route-order.mjs` (route order diganti `sesiRoute()` admin tetap supaya uji tidak menguji auth — sudah ada e2e-nya).

Spec e2e → fitur/halaman (jumlah test):

| spec | fitur/halaman |
|---|---|
| `e2e/a11y.spec.ts` (6) | axe critical/serious, label/contrast/lang/landmark |
| `e2e/admin-akses.spec.ts` (8) | permintaan akses owner (approve/reject, hanya pending) |
| `e2e/advance-pilih.spec.ts` (3) | pilih-semua + kolom resi halaman Advance |
| `e2e/boot.spec.ts` (3) | boot mode mock tanpa splash/error palsu |
| `e2e/dashboard-v2.spec.ts` (16) | aksi tulis v2: HPP, HPP baru, koreksi stok, reorder |
| `e2e/draft-konfirmasi.spec.ts` (6) | konfirmasi draft picking dari `/draft` |
| `e2e/excel.spec.ts` (2) | dialog import + tombol export/template |
| `e2e/gudang-jabatan-user.spec.ts` (6) | set gudang/jabatan user di `/admin` |
| `e2e/gudang-v5.spec.ts` (6) | master gudang (owner only) |
| `e2e/histori.spec.ts` (11) | H4 histori + filter (panel mobile) |
| `e2e/izin.spec.ts` (7) | matriks izin per role (`?role=` mock) |
| `e2e/kata-kunci.spec.ts` (10) | F2 kata kunci / kamus adaptif |
| `e2e/laba-preset.spec.ts` (2) | preset toko + upload + stok kategori |
| `e2e/masuk.spec.ts` (2) | halaman login web `/masuk` + lupa |
| `e2e/offline.spec.ts` (5) | isolasi jaringan: mock tidak menembak domain eksternal |
| `e2e/opname-gudang.spec.ts` (5) | opname dashboard + approve owner |
| `e2e/order-laba.spec.ts` (3) | halaman Order (daftar) + Laba per preset |
| `e2e/order-picklist.spec.ts` (4) | seleksi order, bulk transition, picklist |
| `e2e/permintaan-antar-gudang-v51.spec.ts` (10) | alur per-tujuan v5.1 (penerima/qty/setujui per tujuan) |
| `e2e/permintaan-antar-gudang.spec.ts` (6) | F5/F6 halaman antar-gudang (versi v5) |
| `e2e/permintaan-gudang.spec.ts` (6) | F9 filter stok per gudang + F8 toggle online |
| `e2e/permintaan.spec.ts` (17) | F1 permintaan harian interaktif |
| `e2e/preview-picklist.spec.ts` (15) | pratinjau picklist (tabel gulir, tombol Export) — layout-sensitif |
| `e2e/printing-sinkronisasi.spec.ts` (2) | cetak resi + halaman sinkronisasi |
| `e2e/provider-ui.spec.ts` (3) | dropdown provider AI, owner boleh ganti, admin disabled |
| `e2e/real-r11.spec.ts` (2, skip) | R11 mode real (lihat `scripts/cek-real.mjs`) |
| `e2e/responsif.spec.ts` (15) | breakpoint 768, touch ≥44px — layout-sensitif |
| `e2e/ringkasan.spec.ts` (7) | H1 ringkasan (blok minus, guest tanpa kartu draft) |
| `e2e/routing.spec.ts` (3) | navigasi H1..H9 + detail produk |
| `e2e/smoke.spec.ts` (1) | gate A0 boot tanpa backend data |
| `e2e/staff.spec.ts` (8) | konten H5/H6/H7/H8 |
| `e2e/stok-mutasi.spec.ts` (6) | v5.2 mode mutasi antar gudang di dialog stok |
| `e2e/stok.spec.ts` (9) | H2 stok + H3 detail + dialog koreksi — layout-sensitif |
| `e2e/tambah-produk.spec.ts` (8) | tambah produk, kode duplikat 409 — layout-sensitif |
| `e2e/tema.spec.ts` (8) | tema terang/gelap (`localStorage "tema"`) |
| `e2e/tma.spec.ts` (2) | guard lapis route `POST /api/auth/tma` (tanpa Origin → 403) |

Skrip manual (`scripts/*.mjs|js`) — kegunaan & keamanan:

| skrip | kegunaan | efek/butuh |
|---|---|---|
| `jalankan-tes-worker.mjs` | runner unit TS (esbuild→node:test) | aman; menulis temp lalu hapus |
| `e2e-build.mjs` / `e2e-build-real.mjs` | build Next mock / real | aman (hanya `.next`) |
| `cek-real.mjs` | verifikasi R11 mode real | read-only HTTP; butuh server 3105 (`CEK_REAL_BASE`) |
| `cek-splash-real.mjs` | splash + initData tiruan di mode real | read-only HTTP; server 3105 |
| `cek-tg-sdk.mjs` | cek SDK Telegram termuat | read-only HTTP; server 3100 (`CEK_BASE`) |
| `shots.mjs` | screenshot 8 halaman mobile+desktop, tema gelap | tulis `test-results/visual/*.png`; butuh server 3100 + mock |
| `buat-template-excel.mjs` | generator template import produk | tulis `public/template-import-produk.xlsx` |
| `cekStrukturSheets.js` | diagnosa struktur Sheets (lebar grid, header, kolom B) | read-only; butuh `GOOGLE_SHEETS_ID/_CLIENT_EMAIL/_PRIVATE_KEY` |
| `backup-stock-v5.mjs` | backup koleksi `stock` sebelum migrasi | read-only Firestore; tulis JSON ke `tmpdir()/backup-v5` |
| `verify-backfill.mjs` | verifikasi paritas `qty_per_gudang.ONLINE` == `stok_gudang_online` | read-only; exit 1 bila beda |
| `ensure-gudang-online-v5.mjs` | pastikan dokumen `gudang/ONLINE` ada | MENULIS Firestore (idempoten); token Firebase CLI |
| `migrate-backfill-v5.mjs` | backfill `qty_per_gudang["ONLINE"]` + selaras legacy | default DRY-RUN; `--apply` MENULIS; urutan: backup→verify→ensure→dry→apply→verify |
| `migrate-firestore-to-d1.mjs` | migrasi Firestore → D1 (sekali jalan) | default dry-run; `--apply` MENULIS ke D1; butuh `GOOGLE_APPLICATION_CREDENTIALS` + wrangler |
| `muat-seed-laba.mjs` | seed remote D1 (preset + tier_admin) | MENULIS D1 remote via `wrangler d1 execute`; butuh `wrangler login`; idempoten |
| `isi-kategori-export.mjs` | isi `products.kategori` D1 dari export Shopee | dry-run tulis `isi-kategori.sql`; `--tulis` → jalankan SQL manual via wrangler |
| `mutasi-batch2.mjs` | pindah 252 SKU batch-2 ke gudang D19 | tanpa `--jalan` = cek; `--jalan` MENULIS via API; butuh `SW_COOKIE` + `SW_BASE` |
| `backfillLastSyncedValue.js` | isi `last_synced_value` (klasifikasi sync lebih akurat) | Firestore, default DRY-RUN; `--apply` menulis; nice-to-have |
| `backfillQtyStockMovements.js` | normalisasi tanda `qty` stock_movements lama | Firestore, default DRY-RUN; `--apply` menulis |
| `verifikasi-revoke-admin.js` | cek alur revoke admin | self-execute; firebase-admin di-MOCK in-process → bukan uji nyata |
| `jalankanReminderHarian.js` | entry cron reminder stok menipis | MENGIRIM Telegram; butuh env FIREBASE_*/TELEGRAM_BOT_TOKEN (dipanggil GH Actions) |
| `jalankanSyncMasterData.js` | entry cron sync master data Sheets | MENULIS Sheets/Firestore; butuh env cron; exit 1 bila ada gagal |
| `uji-laba-nyata.mjs` | banding mesin laba lama vs baru pada Order nyata | read-only; butuh `UJI_FILE`/`UJI_TGL` + `dump-hitung.json` |
| `uji-001597.mjs` | uji 2 SKU laba (001597 vs 100331) dari dump D1 | read-only; butuh `dump-aktif2.json`, `dump-master.json`, `kat-d1.json` |
| `banding-income.mjs` / `banding-income2.mjs` | banding biaya Income vs mesin preset | read-only; path xlsx Windows HARDCODE (tidak jalan di Linux tanpa edit) |
| `scripts/lib/firebaseCli.mjs` | helper token + REST Firestore untuk skrip | dipakai banyak skrip; `token()` exit 1 bila belum `firebase login` |

## Gotcha / konvensi

- `npm test` = `test/**/*.test.js` (REKURSIF) + bundel `worker/auth.test.ts`. Menambah subfolder test baru wajib dicek ikut ter-glob (`docs/learnings.md` pernah kena: `test/ai/*` tidak ikut gate).
- `node --test test/` TIDAK jalan; harus pola glob berkutip `node --test "test/**/*.test.js"`.
- Unit TS **tidak** ikut `npm test` — hanya `npm run test:worker`. Jangan klaim "sudah jalan" tanpa itu.
- Runner TS menyalin daftar flag per berkas di `FLAG_PER_BERKAS`/`IMPORT_PER_BERKAS`; tambah berkas uji baru = ikut otomatis, tapi bila butuh alias baru harus didaftarkan di sana.
- Test route `.ts` di `app/api/**` hanya 2 (`tma`, `order`); sisanya "mirror route" (menduplikasi urutan validasi) — urutan guard nyata dikunci `test/guardD1.test.js` yang membaca sumber produksi.
- Jangan pakai `npm test` lama (`test/*.test.js`) untuk mengklaim angka; jalankan sendiri dan pakai hitungan runtime.
- Seed mock baru yang masuk koleksi bersama MERUSAK e2e yang mengunci COUNT (`histori.spec.ts`, `ringkasan.spec.ts`, `smoke.spec.ts`) — jalankan mereka dulu (learnings 31).
- e2e mock store in-memory: `page.reload()` selalu mengembalikan seed → jangan pakai reload untuk membuktikan persistensi tulis.
- `?role=` hanya AMPUH di build mock (`NEXT_PUBLIC_ALLOW_MOCK=true`); build produksi mengabaikannya (R11, diuji `scripts/cek-real.mjs`).
- Layout-sensitif (`responsif`, `stok`, `tambah-produk`, `histori`, `kata-kunci`, `preview-picklist`) jalan di 2 project (768px + 360px); sisanya desktop 1280px saja. Tablet sudah dihapus; batas 768 diuji satu test di `responsif.spec.ts`.
- `webServer` e2e memakai `npx next start -p 3100` → WAJIB ada hasil `npm run e2e:build` dulu; port 3100 bentrok = spec gagal palsu (`reuseExistingServer` aktif non-CI).
- Reporter HTML hanya di CI; lokal `line` saja; `playwright-report/`, `test-results/` adalah artefak.
- Beberapa test butuh env dummy sebelum require (mis. `GEMINI_API_KEY`, `FIREBASE_*`, `DASHBOARD_SESSION_SECRET`, `AI_RATE_LIMIT_PER_MINUTE`) — kalau tidak, kegagalan hanya "test failed" tanpa sebab jelas.
- Mock Firestore tidak menolak nilai `undefined`; mock D1 di `lib/d1/*.test.ts` harus memodelkan FK untuk berguna.
- Skrip dengan `--apply`/`--jalan`/`--tulis` menulis data nyata; tanpa flag = dry-run. Skrip Firestore butuh `firebase login` (token `~/.config/configstore/firebase-tools.json`); skrip D1 butuh `wrangler login`.
- Jangan menimpa `docs/test-report.md`; laporan baru pakai nama berversi.

## Kalau masalahnya ... buka ...

| gejala / kata kunci (ID, termasuk sinonim/typo) | file pertama yang dibuka | catatan |
|---|---|---|
| "npm test gagal", "unit test merah", "gate CI merah" | `package.json` (`scripts.test`) + `test/<area yang berubah>.test.js` | CI = `npm test` saja; unit TS bukan bagian gate ini |
| "test:worker gagal", "esbuild bundle error", "Cannot find module initData" | `scripts/jalankan-tes-worker.mjs` → `test/alias-*.mjs` | alias salah/stub db belum dipasang (`__TMA_TEST_DB__`) |
| "e2e gagal padahal build oke", "playwright tidak jalan", "port 3100" | `playwright.config.ts` (`webServer`) + `scripts/e2e-build.mjs` | butuh build mock; cek `NEXT_PUBLIC_ALLOW_MOCK` |
| "role=?role=owner tidak ngaruh", "login mock gagal", "guest bisa buka halaman" | `e2e/izin.spec.ts`, `test/mockParitas.test.js` | bypass role hanya di build mock; produksi R11 |
| "guard urutan salah", "guest ditolak setelah validasi body", "origin 403" | `test/guardD1.test.js`, `lib/d1/route.ts` | kontrak: origin→sesi→rate-limit→role→validasi→model |
| "sesi kedaluwarsa", "cookie tidak terbaca", "token HMAC salah", "initData tidak valid" | `test/sesi.test.js`, `test/initData.test.js` | `DASHBOARD_SESSION_SECRET` wajib; HMAC initData |
| "stok tidak sinkron", "sync stok dobel", "pushed_items", "kolom A nomor" | `test/syncStok*.test.js`, `test/sheetsClientKolom.test.js`, `scripts/verify-backfill.mjs` | mock Sheets stateful; idempotensi 2 lapis (marker + id deterministik) |
| "resi kepotong", "cetak resi", "PDF halaman salah", "watermark" | `lib/printing/watermark.test.ts`, `e2e/printing-sinkronisasi.spec.ts`, `e2e/preview-picklist.spec.ts` | pratinjau harus menghitung semua halaman |
| "picklist kosong", "preview picklist error", "tombol export hilang" | `e2e/preview-picklist.spec.ts`, `e2e/order-picklist.spec.ts`, `lib/d1/picklist.test.ts` | kontrak respons dibekukan via `page.route` |
| "laba salah hitung", "HPP tidak masuk", "perhitungan Shopee beda" | `lib/laba/laba.test.ts`, `lib/d1/labaShopee.test.ts`, `scripts/uji-laba-nyata.mjs` | skrip banding butuh file dump/xlsx lokal |
| "produk tidak muncul di stok", "filter stok salah", "paginasi lambat" | `test/bacaStokOnlineFilter.test.js`, `test/stokPaginasi.test.js`, `e2e/stok.spec.ts` | regresi "produk Kledo hilang" & DOM 1174 baris |
| "notifikasi tidak terkirim", "penerima kosong", "teks status salah" | `test/bentukHasilModel.test.js`, `test/notifikasiTeks.test.js`, `test/notifikasiError.test.js` | nama/level field hasil model & fallback teks |
| "action_type jadi object", "kodeBarang vs kode_barang", "qty tanda salah" | `test/handleScreenshotPickingList.test.js`, `test/keywordActionType.test.js`, `scripts/backfillQtyStockMovements.js` | qty = delta bertanda; action_type harus string |
| "aiKey kosong", "provider fallback tidak jalan", "chain provider salah" | `test/ai/*.test.js`, `lib/ai/provider.test.ts`, `test/providerAiParitas.test.js` | jalankan eksplisit `node --test test/ai/*.test.js` |
| "migrasi D1 gagal", "skema kurang index", "seed laba" | `test/guardD1.test.js` + `migrations/*.sql`, `scripts/muat-seed-laba.mjs` | cek index di `0002_fase1_skema.sql`; seed pakai wrangler |
| "cek data produksi", "verifikasi data nyata", "backfill" | `scripts/lib/firebaseCli.mjs`, `scripts/verify-backfill.mjs`, `scripts/backup-stock-v5.mjs` | backup dulu; dry-run dulu; jangan `--apply` tanpa baca |
| "laporan test basi", "angka test beda", "docs/test-report" | `docs/learnings.md` + `docs/test-report*.md` | laporan historis; percaya hasil runtime, jangan timpa |
| "spec mana yang menjaga halaman X", "e2e apa untuk fitur ini" | tabel spec e2e di atas + `docs/audit-e2e.md` | audit = alasan pembagian project & usulan pangkas |

## Belum diverifikasi

- `test/indexFirestore.test.js` disebut `docs/learnings.md` tetapi TIDAK ada di repo sekarang (kemungkinan dihapus saat migrasi D1) — jangan dicari.
- Jumlah test per spec e2e dihitung dari pola `test(`/`test.skip(`; test yang dibangkitkan loop `for` bisa sedikit berbeda dari angka nyata.
- `docs/audit-e2e.md` berisi usulan (mis. hapus `smoke.spec.ts`, gabung izin ke `izin.spec.ts`) yang BELUM semua diterapkan di kode; angka di dokumen itu bukan kondisi sekarang.
