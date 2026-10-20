# 12 — Integrasi & Sinkronisasi (Kledo, Sheets, Firebase, Reminder)

## Ringkasan area
- Isi area ini: tiga jalur integrasi/sinkronisasi — (1) Kledo → D1 satu arah (gudang/produk/stok/HPP), (2) Google Sheets era lama: searah Sheets→Firestore untuk master (`syncMasterData.js`) dan dua arah untuk stok online (`syncStokDuaArah.js`, Firestore selalu menang), (3) log impor berkas marketplace per toko (`sinkron_log` + `POST /api/sinkronisasi`), plus dua reminder stok.
- Kledo hanya dibaca (GET saja). Menulis balik ke Kledo, webhook Kledo, rak, varian/bundle, riwayat stok harian: sengaja TIDAK dikerjakan (docs/rencana-integrasi-kledo.md bagian 9).
- BUKAN di sini: impor order/laba/performa/iklan itu sendiri (route `app/api/order`, `app/api/laba`, `app/api/analisa`), pembacaan stok D1 (`lib/d1/stok.ts`), bot Telegram (`worker/bot.ts`), dashboard/AI.

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `lib/kledo/klien.ts` | Klien HTTP Kledo, GET + timeout + retry (5xx/429) | `kledoGet`, `kledoHalaman`, `ambilSemua`, `potong`, `bacaHalaman`, `ambilGudang`, `ambilProduk`, `ambilStok`, `ambilHargaBeliTerakhir`, `ujiKoneksi`, `PER_PAGE_MAKS=100`, `CHUNK_PRODUK=200`, tipe `OpsiKledo`, `GudangKledo`, `ProdukKledo`, `StokProdukKledo` |
| `lib/kledo/sinkron.ts` | Mesin sinkron Kledo→D1, 4 tahap, tulis laporan | `jalankanSinkron`, `adaSinkronBerjalan`, `sinkronTerakhir`, `galatTerakhir`, `hppDariKledo`, `normNama`, `GUDANG_VIRTUAL="ONLINE"`, tipe `HasilSinkron`, `RingkasSinkron` |
| `lib/kledo/fixture/kledo.json` | Rekaman respons produksi (warehouses/produk/stok) tanpa token | dipakai `lib/kledo/klien.test.ts` (test "fixture produksi") |
| `lib/d1/kledoKredensial.ts` | CRUD kredensial Kledo di D1, AES-GCM (kunci `AI_KEY_ENCRYPTION_KEY`) | `simpanKledo`, `daftarKledo`, `ambilKledo`, `ambilKledoById`, `setAktifKledo`, `hapusKledo`, `catatUjiKledo`, `normalSubdomain`, tipe `KledoRingkas`, `KledoPenuh` |
| `lib/sheets/client.js` | Singleton Google Sheets API v4 (service account) | `ambilSheetsClient`, `bacaRange`, `tulisRange`, `ambilHeader`, `tambahKolomHeader`, `tambahBarisBaru`, `angkaKeHurufKolom` |
| `lib/sheets/syncMasterData.js` | Sheets→Firestore searah (master produk) | `syncMasterData` |
| `lib/sheets/syncStokDuaArah.js` | Sync stok online manual + draft konfirmasi Telegram | `mulaiSyncStok`, `konfirmasiSyncStok`, `konfirmasiTambahKolom`, `batalkanTambahKolom`, `apakahAdaPendingSyncStok`, `apakahMintaKonfirmasiKolom`, `KONDISI` |
| `lib/ai/kripto.ts` | AES-GCM untuk kredensial (dipakai Kledo & AI) | `enkripsi`, `dekripsi`, `maskKredensial`, `ambilKunci` |
| `lib/firebase.js` | Init Firebase Admin singleton (env trio atau ADC) | `db`, `firebaseApp` |
| `worker/notify.ts` | Pemicu cron sinkron Kledo sore + laporan harian + drain antrean notifikasi | `drainTick`, `sinkronKledoSore` (privat), `SINKRON_CRON`, `LAPORAN_CRON` |
| `firestore.rules` | Rules default-deny; tulis dari klien DILARANG (`allow write: if false`) | fungsi `authed()`, `staff()` |
| `firestore.indexes.json` | Index Firestore (mayoritas `stock_movements`) | — |
| `lib/reminder/cekReorderPoint.js` | Reminder reaktif saat stok berubah | `cekDanNotifikasiReorderPoint` |
| `lib/reminder/reminderHarian.js` | Reminder proaktif harian (proyeksi dari tren `stock_movements`) | `jalankanReminderHarian`, `hitungRataRataPemakaianHarian` |
| `lib/router/handleCommand.js` + `lib/handlers/handleKonfirmasiCallback.js` | Pemanggil `/sync_stok` dan tombol konfirmasi sync stok | `mulaiSyncStok`, `konfirmasiSyncStok`, `konfirmasiTambahKolom` |
| `.github/workflows/sync-master-data.yml`, `reminder-harian.yml` | Pemicu cron GitHub Actions untuk Sheets dan reminder (bukan Vercel Cron) | `node scripts/jalankan*.js` |
| `lib/config/env.js` | Validasi env sebelum job cron jalan | `validasiEnvCronSheets`, `validasiEnvCronReminder` |
| `app/api/pengaturan/kledo/route.ts` | REST setelan + pemicu sinkron Kledo (owner) | `GET`, `POST` |
| `app/api/sinkronisasi/route.ts` | Riwayat impor berkas per toko (admin) | `GET`, `POST` |
| `app/sinkronisasi/page.tsx` | Halaman semua impor berkas + riwayat per jenis | `HalamanSinkronisasi` |
| `components/dashboard/kledo-integrasi.tsx` | Kartu UI Kledo (simpan/uji/sinkron/aktif/hapus) | `KledoIntegrasi` |
| `scripts/jalankanSyncMasterData.js` | CLI untuk workflow cron Sheets→Firestore | `main()` → `syncMasterData()` |
| `scripts/jalankanReminderHarian.js` | CLI untuk workflow cron reminder | `main()` → `jalankanReminderHarian()` |
| `scripts/backfillLastSyncedValue.js` | Isi `last_synced_value` (klasifikasi diff stok), dry-run default | `--apply` |
| `scripts/backfillQtyStockMovements.js` | Normalisasi tanda `qty` di `stock_movements` lama, dry-run default | `--apply` |
| `scripts/ensure-gudang-online-v5.mjs` | Pastikan dokumen gudang ONLINE ada (idempoten, REST Firestore) | `main()` |
| `migrations/0025_kledo.sql` | Skema Kledo: kredensial, peta, laporan, kolom penanda | — |
| `migrations/0043_sinkron_log.sql` | Tabel `sinkron_log` + index per preset/jenis | — |
| `migrations/0040_orders_preset.sql` | `orders.preset_id` + `idx_orders_preset_tgl` (penanda toko untuk impor) | — |
| `docs/rencana-integrasi-kledo.md` | Rencana + temuan live Kledo (endpoint, batas, keputusan) | bagian 2, 4.6, 9 |
| `docs/firestore-audit.md` | Audit koleksi/field Firestore (aktor `stock_movements`), cara deploy index | — |

## Alur data
1. Sinkron Kledo manual: `components/dashboard/kledo-integrasi.tsx` → `POST /api/pengaturan/kledo {aksi:"sinkron"}` → `app/api/pengaturan/kledo/route.ts` (guard `sesiRoute` + `is_owner`, tolak 409 bila `adaSinkronBerjalan`) → `jalankanSinkron()` dijalankan di latar lewat `getCloudflareContext().ctx.waitUntil` → `lib/kledo/klien.ts` (GET `/finance/warehouses`, `/finance/products`, `/finance/products/stocks`, `/finance/products/last_buy_prices`) → D1 `warehouses`, `products`, `stock_by_bin`, `stock_moves` + `kledo_map`, laporan di `kledo_sync`/`kledo_sync_galat`. Klien memantau lewat `GET ?aksi=ringkas`.
2. Sinkron Kledo terjadwal: `wrangler.jsonc` crons `"0 9 * * *"` → `worker/index.ts` `scheduled()` → `worker/notify.ts` `drainTick()` → `sinkronKledoSore()` (konstanta `SINKRON_CRON`) → `jalankanSinkron(..., { pemicu: "jadwal", oleh: "cron" })` → ringkasan dikirim ke admin via `fanoutNotifikasi(db, "info", pesan)`.
3. Tahap-tahap `jalankanSinkron`: (1) gudang — peta id Kledo→`warehouses.id` lewat `kledo_map`, cocokkan NAMA (`normNama`) sebagai cadangan, gudang baru dibuat dengan id `K<nama id Kledo>`; (2) produk — `products.sku = Produk.code`, HPP dari `avg_base_price` → fallback `last_buy_prices` → PERTAHANKAN HPP D1 (`hppDariKledo`); (3) stok — `stock_by_bin` ditimpa per (sku, gudang), ledger hanya mencatat DRIFT satu baris per SKU (`stock_moves` jenis `sync_confirmed`, source `sync`, penanda `kledo`); (4) laporan — `akhiriLaporan()` menulis `kledo_sync` + `kledo_sync_galat`. Semua tulis lewat `db.batch` (potongan 50).
4. Master dari Sheets: `.github/workflows/sync-master-data.yml` (cron `0 23 * * *` = 06:00 WIB) → `scripts/jalankanSyncMasterData.js` → `lib/sheets/syncMasterData.js` `syncMasterData()` → `bacaRange("DATABASE_ACCURATE!A2:G")` + `bacaRange("Mapping!A2:D")` → `simpanProduk()` (`lib/models/produk.js`, Firestore `products`).
5. Stok dua arah (manual, selalu lewat konfirmasi admin): command `/sync_stok` → `lib/router/handleCommand.js` → `mulaiSyncStok()` → baca `DATABASE_ACCURATE` + Firestore (`listSemuaProduk({hanyaOnline:true})`, `ambilStok`, `bacaParitasOnline`) → draft per kelompok di koleksi `sync_stok_drafts` → tombol Telegram → `handleKonfirmasiCallback.js`/`routePesan.js` → `konfirmasiSyncStok()` → `applyDraft()`/`applyDraftProdukBaru()` → tulis Sheets (`pushNilaiKeSheet`, `tambahBarisBaru`) + `catatPergerakanStok()`. Arah tetap Firestore → Sheets; kolom baru dibuat hanya setelah admin setuju (`konfirmasiTambahKolom`).
6. Log impor marketplace: `app/sinkronisasi/page.tsx` + `components/dashboard/dialog-import-order.tsx` + `dialog-laba-shopee.tsx` memanggil `POST /api/sinkronisasi` setelah impor selesai (endpoint impor lama tidak diubah) → `sinkron_log`; halaman membacanya via `GET /api/sinkronisasi?presetId=`.
7. Reminder reaktif: tiap stok berubah di `lib/models/stok.js` (`_ubahStokRelatif` dkk.) → `cekDanNotifikasiReorderPoint(kodeBarang)` → banding `stok_gudang_online` vs `reorder_point` → kirim Telegram ke `telegram_user_id` semua admin role owner+admin.
8. Reminder harian: `.github/workflows/reminder-harian.yml` (cron `0 0 * * *` = 07:00 WIB) → `scripts/jalankanReminderHarian.js` → `jalankanReminderHarian()` → `hitungRataRataPemakaianHarian()` baca Firestore `stock_movements` (`type="keluar_resi"`, `action_type="kurangi_stok"`, `status="processed"`, 7 hari) → produk dengan proyeksi habis ≤3 hari dikirim ke owner+admin.

## Endpoint & tabel terkait
- Endpoint: `GET /api/pengaturan/kledo?aksi=ringkas|galat` → `app/api/pengaturan/kledo/route.ts` → `daftarKledo`, `sinkronTerakhir`, `galatTerakhir`, `adaSinkronBerjalan` (owner saja).
- Endpoint: `POST /api/pengaturan/kledo {aksi: simpan|aktif|hapus|uji|sinkron}` → route yang sama → `simpanKledo`/`setAktifKledo`/`hapusKledo`/`ujiKoneksi`+`catatUjiKledo`/`jalankanSinkron` (owner saja).
- Endpoint: `GET /api/sinkronisasi?presetId=&jenis=` dan `POST /api/sinkronisasi` → `app/api/sinkronisasi/route.ts` (wajib `is_admin`; allowlist jenis `order|laba|performa|iklan`).
- Tabel D1: `kledo_kredensial` (tulis `simpanKledo`/`setAktifKledo`/`hapusKledo`/`catatUjiKledo`, baca `daftarKledo`/`ambilKledo`/`ambilKledoById`) dan `kledo_map`, `kledo_sync`, `kledo_sync_galat` (penulis+pembaca `lib/kledo/sinkron.ts`) → migrasi `0025_kledo.sql`.
- Tabel D1: `sinkron_log` (tulis `POST /api/sinkronisasi`, baca `GET /api/sinkronisasi`) → migrasi `0043_sinkron_log.sql`.
- Tabel D1 terkait sinkron impor: `orders.preset_id` + index `idx_orders_preset_tgl` (ditulis impor order di `app/api/order/route.ts`; baris lama NULL) → migrasi `0040_orders_preset.sql`; `stock_by_bin` (`0002_fase1_skema.sql`) dan `stock_moves` (jenis `sync_confirmed` sudah ada izinnya sejak `0002`, dipertahankan `0006`/`0019`); kolom `warehouses.kledo_id`, `warehouses.kledo_synced_at`, `products.kledo_synced_at` dari `0025`.
- Firestore: `products` (tulis `syncMasterData.js`), `stock` + `stock_movements` (baca/tulis `lib/models/stok.js`, `lib/models/stockMovements.js`), `sync_stok_drafts` (draft sync stok), `admins` (penerima notifikasi). Rules: semua `allow write: if false` — tulis hanya lewat Admin SDK/server.

## Test terkait
- unit TS (node:test, dijalankan lewat `npm run test:worker` = `node scripts/jalankan-tes-worker.mjs` yang menemukan `lib/**/*.test.ts`): `lib/kledo/klien.test.ts`, `lib/kledo/sinkron.test.ts`. Satu berkas: bundel dulu, `npx esbuild lib/kledo/sinkron.test.ts --bundle --platform=node --format=esm --outfile=.tmp-kledo.test.mjs && node --test .tmp-kledo.test.mjs`.
- unit JS (`npm test` = `node --test "test/**/*.test.js"`): `test/sheetsClientKolom.test.js`, `test/syncStokIdempoten.test.js`, `test/syncStokMovementIdempotensi.test.js`, `test/syncStokParitas.test.js`, `test/syncStokProdukBaru.test.js`, `test/syncStokReplay.test.js`, `test/reminderHarian.test.js`, `test/reorderPoint.test.js`, `test/backfillLastSyncedValue.test.js`, `test/backfillQtyStockMovements.test.js`, `test/draftKonfirmasiV3b.test.js`. Satu berkas: `node --test test/reminderHarian.test.js`.
- e2e: `e2e/printing-sinkronisasi.spec.ts` (mem-`route` `**/api/sinkronisasi?*`). Jalankan: `npx playwright test e2e/printing-sinkronisasi.spec.ts`.
- Tidak ada `lib/d1/kledoKredensial.test.ts` (dan tidak ada e2e khusus Kledo) — jangan mencarinya.

## Gotcha / konvensi
- Sinkron Kledo hanya membaca. Jangan menambah POST/PUT ke Kledo; klien sengaja cuma punya GET.
- `products.hpp` = `avg_base_price`, BUKAN field `hpp`; `show_columns` menolak `avg_base_price` (HTTP 400) jadi produk diambil payload penuh. Nilai < 1 setelah pembulatan = TIDAK layak → HPP D1 dipertahankan (`hppDipertahankan`).
- Pencocokan gudang lewat NAMA (`normNama`), bukan id: `warehouses.id` D1 (`'GMV0LJYS5'`, `'K2'`) bukan id Kledo. Gudang virtual `ONLINE` (`GUDANG_VIRTUAL`) tidak pernah dipetakan/disentuh; `is_online_product` juga tidak disentuh.
- `db.batch` potongan 50 wajib: sinkron ~1174 produk ≈ 6000 query; satu-satu menggantung >160 detik dan Worker dihentikan di tengah. Karena itu `jalankanSinkron` dipanggil via `ctx.waitUntil`, bukan di siklus request.
- Pagar anti-tumpang-tindih: `adaSinkronBerjalan` menutup sendiri catatan `status='jalan'` yang senyap > 180 detik (`MAKS_SENYAP_DETIK`) dan mengabaikan yang lebih tua dari 30 menit.
- `kledo_sync_galat.pesan`/`kledo_sync.pesan` dipotong 500 karakter; `kledo_map` PK `(jenis, kledo_id)` → dua id Kledo dengan satu SKU terdeteksi sebagai bentrok dan DILAPORKAN, bukan ditimpa otomatis.
- Token Kledo hanya keluar sebagai plaintext lewat `ambilKledo`/`ambilKledoById`; `daftarKledo` selalu mask. Kunci `AI_KEY_ENCRYPTION_KEY`; tanpa kunci itu cron sore melewati sinkron.
- Sheets: header `DATABASE_ACCURATE` kolom A..G (No, Kode Barang, Nama Accurate, HPP/unit, HPP Baru, Stok Online, is_online) + `Mapping` (Nama Shopee, Variasi, Mark Down, Checker Nama Accurate). Kolom `Stok Online` dianggap kolom baru/append, dan menambah kolom HARUS lewat konfirmasi admin.
- `tulisRange` pakai `USER_ENTERED` → sel string dari data produk dinetralkan `amanUntukSheets()` (prefix apostrof) supaya tidak dieksekusi Sheets.
- `syncMasterData` memakai OR untuk `is_online_product` (Sheet hanya bisa menyalakan, tidak mematikan) dan menulis ke Firestore — bukan ke D1.
- `syncStokDuaArah` selalu direview: draft di `sync_stok_drafts` per kelompok (`sheets_ketinggalan`/`sheets_manual`/`konflik`/`produk_baru`), resolusi akhir selalu Firestore menang → Sheets; apply idempoten lewat `draft.pushed_items`. Nilai `undefined` di draft dinormalkan ke `null` (Firestore menolak `undefined` nested).
- Notifikasi reminder memakai `admin.telegram_user_id`, BUKAN `admin.id` (bug B1 yang pernah terjadi). Penerima = role owner + admin (guest tidak).
- `hitungRataRataPemakaianHarian` memakai `Math.abs(qty)` karena `qty` = delta bertanda negatif untuk `keluar_resi`.
- Penulisan `sinkron_log` bersifat best-effort di klien (gagal mencatat tidak membatalkan impor); jenis dibatasi allowlist supaya tabel tidak jadi tempat sampah.
- Firestore rules default-deny untuk semua tulis klien; `lib/firebase.js` harus punya env trio atau ADC, kalau tidak error saat require.

## Kalau masalahnya ... buka ...
| gejala / kata kunci | file pertama yang dibuka | catatan |
|---|---|---|
| sinkron Kledo gagal / token salah / "Kledo menolak" / uji koneksi | `lib/kledo/klien.ts` + `app/api/pengaturan/kledo/route.ts` | cek `kledoGet` (retry 5xx/429, timeout), aksi `uji`, pesan tersimpan di `kledo_kredensial.uji_pesan` |
| stok tidak sinkron / qty beda dengan Kledo / drift | `lib/kledo/sinkron.ts` (tahap 3) | `stock_by_bin` ditimpa penuh; gudang tak terpetakan dilewati; lihat `kledo_sync.stok_drift` |
| HPP berubah sendiri / hpp jadi 0 / laba salah hitung karena HPP | `lib/kledo/sinkron.ts` → `hppDariKledo` | hanya angka ≥ 1 setelah `Math.round` yang menimpa; sisanya dipertahankan |
| gudang dobel / gudang Kledo tidak muncul / nama gudang berubah sendiri | `lib/kledo/sinkron.ts` (tahap 1) + `normNama` | pemetaan NAMA, bukan id; bentrok dilaporkan di `kledo_sync_galat` |
| sinkron nyangkut "sedang jalan" / tombol sinkron ditolak 409 | `lib/kledo/sinkron.ts` → `adaSinkronBerjalan` | catatan senyap >180 detik ditutup otomatis; cek `GET ?aksi=ringkas` |
| sinkron jalan tapi berhenti di tengah / produk cuma sebagian masuk | `app/api/pengaturan/kledo/route.ts` (aksi sinkron) | wajib `ctx.waitUntil` + `db.batch` 50; jangan jalankan lurus di request |
| cron sore Kledo tidak jalan / tidak ada notifikasi sinkron | `worker/notify.ts` (`sinkronKledoSore`, `SINKRON_CRON`) + `wrangler.jsonc` | cron `0 9 * * *` = 16:00 WIB; kredensial aktif diambil dari D1 |
| kredensial Kledo tidak bisa didekripsi / kunci enkripsi hilang | `lib/d1/kledoKredensial.ts` + `lib/ai/kripto.ts` | `AI_KEY_ENCRYPTION_KEY` berganti → `ambilKledo` balik null |
| stok online Sheets tidak sama / "sheets ketinggalan" / draft /sync_stok | `lib/sheets/syncStokDuaArah.js` (`bandingkanNilai`, `applyDraft`) | Firestore menang; draft di `sync_stok_drafts`; review admin wajib |
| kolom Stok Online belum ada / bot minta izin tambah kolom | `lib/sheets/syncStokDuaArah.js` (`pastikanKolomStokAda`) + `lib/sheets/client.js` (`tambahKolomHeader`) | jangan tambah kolom diam-diam; grid dilebarkan dulu (appendDimension) |
| master produk/HPP dari Sheets tidak masuk / sync harian pagi gagal | `lib/sheets/syncMasterData.js` + `scripts/jalankanSyncMasterData.js` | searah Sheets→Firestore; `validasiEnvCronSheets()`; workflow `sync-master-data.yml` |
| data produk terasa basi di dashboard / "kok masih pakai Firestore" | `lib/firebase.js` + `lib/models/produk.js`, `lib/models/stok.js` | sisa era lama; pemakai produksi tinggal cron Sheets/reminder, bot `lib/router/**`, dan `app/api/auth/telegram/route.ts` |
| reminder stok menipis tidak muncul / reorder point tidak kirim | `lib/reminder/cekReorderPoint.js` + `test/reorderPoint.test.js` | penerima `telegram_user_id`; dipanggil dari `lib/models/stok.js`; arahkan ke pembungkus D1 `lib/d1/stok.ts` bila alur baru |
| reminder harian pagi kosong / proyeksi habis tidak masuk | `lib/reminder/reminderHarian.js` + `.github/workflows/reminder-harian.yml` | `Math.abs(qty)`; ambang 3 hari, tren 7 hari; env trio Firebase wajib |
| riwayat impor salah / "terakhir diimpor" tidak akurat di halaman Sinkronisasi | `app/api/sinkronisasi/route.ts` + `app/sinkronisasi/page.tsx` | jenis allowlist; klien yang mencatat setelah impor; kunci respons `perJenis` (bukan `preset`) |
| impor order tercampur antar toko / order tidak muncul per toko | `migrations/0040_orders_preset.sql` + `app/api/order/route.ts` | `preset_id` ditulis saat impor; baris lama NULL = belum diketahui |
