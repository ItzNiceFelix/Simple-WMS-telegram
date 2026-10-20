# 02 — Database D1 & Model Lama (Firestore)

## Ringkasan area
- Peta **skema D1** (binding `DB`, database `simple-wms`) dan lapisan aksesnya: seluruh `migrations/*.sql` (43 berkas, 78 tabel aktif), `lib/d1/db.ts`, `lib/d1/route.ts`, `lib/d1/guard.ts`, `lib/d1/ledger.ts`, `lib/d1/rateLimit.ts`, `lib/d1/hasil.ts`.
- Sumber kebenaran skema = `migrations/*.sql`, BUKAN dokumen arsitektur. `docs/architecture-v5.md` masih rancangan era Firestore (`stock.qty_per_gudang`, `permintaan_gudang`, `opname_gudang`).
- `lib/models/*.js` adalah CRUD Firestore lama (firebase-admin). Masih hidup di jalur bot/handler Node, sheets, reminder, matching, dan satu route (`app/api/auth/telegram/route.ts`); Worker Telegram sudah memakai `lib/d1/*`.
- TIDAK termasuk: logika bisnis per domain (order, laba, stok, AI, desain) — hanya daftar tabel, helper inti, dan pola pemakaian. Endpoint non-data dan UI ada di peta lain.
- `docs/database-review.md` khusus jalur Firestore `stock_movements` era sync Sheets (id deterministik), bukan review skema D1.

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `lib/d1/db.ts` (39) | Ambil binding D1 per request + env AI | `getDb()`, `getEnvAi()`, `getKunciEnkripsi()`; re-export `gagal`, `sekarang`, `Hasil` |
| `lib/d1/route.ts` (68) | Pola route Next → D1: origin, sesi, rate limit, JSON | `json()`, `tolakOriginD1()`, `sesiRoute()`, `bacaBody()`; re-export `cekRateLimitD1` |
| `lib/d1/auth.ts` | Verifikasi cookie `swt_sesi` ke tabel `sessions` | `requireSession()`, `bolehTulisGudang()`, tipe `SesiPengguna` |
| `lib/d1/guard.ts` (63) | Guard dobel-proses 10 detik di tabel `guards` | `TTL_DETIK`, `SCOPE`, `kunciGuard()`, `guardAktif()`, `tulisGuard()` |
| `lib/d1/ledger.ts` (65) | Baca ledger/kartu stok (read-only) | `listMovements()`, `kartuStok()`, tipe `Movement`, `MovementFilter` |
| `lib/d1/rateLimit.ts` (20) | Sliding-window in-memory per isolat Worker | `cekRateLimitD1(kunci, maksPerMenit)` |
| `lib/d1/hasil.ts` (25) | Tipe hasil bisnis tanpa dependensi | `Hasil<T>`, `UpayaGagal`, `gagal()`, `sekarang()` |
| `lib/d1/stok.ts` | Operasi stok D1 + ledger | `GUDANG_ONLINE`, `bacaQtyPerGudang`, `bacaQty`, `tulisQty`, `ubahRelatif`, `mutasiAntarGudang`, `setReorderPoint`, `stokDiBawahReorder` |
| `lib/models/*.js` | CRUD Firestore lama (15 file) | contoh: `admins.js` (`ambilAdmin`, `isAdmin`, `updateRoleAdmin`), `stok.js` (`tambahStok`, `setQtyGudang`), `permintaanGudang.js` (`buatPermintaan`, `kirimPermintaan`) |
| `migrations/0001_fase0_fondasi.sql` | Fondasi auth/user/gudang/settings | 8 tabel awal |
| `migrations/0002_fase1_skema.sql` | Skema paritas Firestore → D1 | 22 tabel inti stok/order/permintaan/opname |
| `migrations/0006_fase3_order.sql`, `0019_order_advance.sql` | Order + Advance; rebuild `stock_moves`/`order_items` | tabel order, booking, resi grup |
| `migrations/0013`–`0018`, `0040`–`0041` | Laba multi-preset, fee rules, snapshot, registry, periode | `seller_presets`, `fee_rules`, `laba_*`, `performa_produk` |
| `migrations/0020`–`0024`, `0031`, `0035`–`0037` | AI: kredensial, model, tool, pemakaian, setting, izin role, editor | 14 tabel AI |
| `migrations/0025`–`0026` | Integrasi Kledo | `kledo_kredensial`, `kledo_map`, `kledo_sync`, `kledo_sync_galat` |
| `migrations/0027`–`0032`, `0042`–`0043` | Analisa, desain, picklist, cetak order, log sinkron | `shopee_produk`, `peta_putusan`, `ads_produk`, `performa_produk`, `desain_*`, `ai_*`, `picklist_ekspor`, `order_cetak`, `sinkron_log` |
| `docs/database-review.md` (176) | Review Firestore `stock_movements` id deterministik | temuan `created_at` ter-reset & `qty=0` saat retry |
| `docs/architecture-v5.md` (807) | Arsitektur domain v5 era Firestore | model `qty_per_gudang`, alur permintaan/opname, guard |

## Alur data
1. **Pola route D1**: `app/api/<segmen>/route.ts` → `sesiRoute(request, batas)` (`tolakOriginD1` → `requireSession` → `cekRateLimitD1`) → route cek role dari DB (`user.is_admin`/`user.is_owner`/`bolehTulisGudang`) → `bacaBody()` → fungsi `lib/d1/*` → `json()`. Route D1 memakai `export const runtime = "nodejs"` + `dynamic = "force-dynamic"`.
2. **Akses DB**: `getDb()` memakai `cache()` React + `getCloudflareContext().env.DB`, jadi satu request satu binding. Fungsi domain menerima `db: D1Database` eksplisit agar bisa diuji dengan mock (`lib/d1/*.test.ts`).
3. **Mutasi stok**: `POST /api/stok/gudang` atau `POST /api/stok/mutasi` → `tulisQty`/`mutasiAntarGudang` (`lib/d1/stok.ts`) → `db.batch`: upsert `stock_by_bin` + `INSERT stock_moves` + update `products.last_stock_updated`. `qty` ledger = delta/selisih; stok negatif sengaja diizinkan.
4. **Opname/transfer/order juga menulis ledger**: `lib/d1/opname.ts`, `lib/d1/transfer.ts`, `lib/d1/orderTransisi.ts`, `lib/d1/stokOnline.ts`, `lib/d1/produk.ts` (stok awal) masing-masing menyisipkan `stock_moves` dan mengubah `stock_by_bin` dalam batch. `ledger.ts` hanya membaca.
5. **Order import**: `POST /api/order` → `normalisasiSheetShopee` → `importFingerprint` (`import_files`) → `import_batches`/`import_errors` → `imporPesanan`/`simpanBooking`/`isiResiGrup` → tabel `orders`, `order_items`, `advance_bookings`, `resi_grup`, `sku_belum_mp`.
6. **Auth**: `worker/auth.ts` menulis `sessions`, `auth_codes`, `login_audit`, `users`; route Next hanya memverifikasi via `requireSession`. Legacy `app/api/auth/telegram/route.ts` masih `require()` `lib/models/admins.js`.
7. **Bot Worker**: `worker/bot.ts` + `worker/notify.ts` menulis `bot_sessions`, `groups`, `notify_queue` dan memanggil `lib/d1/{stok,produk,gudang,opname,transfer,akses,admin,peran}`.

## Endpoint & tabel terkait
- `GET /api/baca` → `app/api/baca/route.ts` (`GET`) → `listMovements`, `bacaQtyPerGudang`, `listGudang`, `listOpname`, `listTransfer`; baca hampir semua tabel dashboard.
- `POST /api/stok/mutasi` → `app/api/stok/mutasi/route.ts` (`POST`) → `tulisQty`; tulis `stock_by_bin`, `stock_moves`.
- `POST /api/stok/gudang` → `app/api/stok/gudang/route.ts` (`POST`) → `mutasiAntarGudang`/`tulisQty`; `stock_by_bin`, `stock_moves`.
- `POST /api/stok/reorder-point` → `app/api/stok/reorder-point/route.ts` (`POST`) → `setReorderPoint`; `products.stok_min`.
- `POST /api/opname-gudang` → `app/api/opname-gudang/route.ts` (`POST`) → `buatOpname`/`setujuiOpname`/`tolakOpname`; `stock_counts`, `count_lines`, `count_status_log`, `stock_moves`.
- `POST /api/permintaan-gudang` → `app/api/permintaan-gudang/route.ts` (`POST`) → `buatTransfer`, `setujuiTujuan`, `kirimTujuan`, `terimaTujuan`, `tidakTerimaTujuan`, `tutupTujuan`; `transfers`, `transfer_destinations`, `transfer_items`, `transfer_status_log`.
- `GET|POST /api/order` → `app/api/order/route.ts` → `imporPesanan`, `transisiFulfillBatch`, `simpanBooking`, `isiResiGrup`, `catatImportFile`; `orders`, `order_items`, `order_fees`, `import_*`, `advance_bookings`, `resi_grup`, `picklist_ekspor`.
- `GET|POST /api/laba` → `app/api/laba/route.ts` → `hitungDanSimpan` (`lib/d1/labaPreset.ts`), `cariOverlap`, `daftarPerNo`; `laba_snapshot`, `laba_order`, `fee_rules`, `seller_presets`.
- `GET|POST /api/analisa` + `/api/analisa/peta` → `lib/d1/analisa.ts`, `adsProduk.ts`, `shopeePeta.ts`; `laba_snapshot`, `ads_produk`, `performa_produk`, `shopee_produk`, `peta_putusan`.
- `GET|POST /api/advance` → `lib/d1/advanceBelumSku.ts`; `advance_bookings`, `sku_belum_mp`, `import_files`, `stock_moves`.
- `GET|POST|DELETE /api/ads` → `app/api/ads/route.ts` → `lib/d1/adsProduk.ts`; `ads_produk`, `performa_produk`.
- `GET|POST /api/desain*` → `lib/d1/desain.ts`, `elemenDesain.ts`; `desain_folder`, `ai_latar`, `ai_desain`, `ai_elemen`, `ai_editor_setting`.
- `GET|POST /api/pengaturan/ai` → `simpanPengaturanAI`/`simpanProviderAI`, `aiIzinModel`; `settings`, `ai_kredensial`, `ai_model`, `ai_model_izin`.
- `GET|POST /api/pengaturan/kledo` + `GET|POST /api/sinkronisasi` → `lib/d1/kledoKredensial.ts`, `lib/kledo/sinkron.ts`; `kledo_*`, `sinkron_log`.
- `GET|POST /api/printing` → `app/api/printing/route.ts`; upsert `order_cetak`.
- `POST /api/permintaan` → `lib/d1/permintaan.ts`; `daily_requests`, `daily_request_items`, `daily_request_changes`.
- `POST /api/gudang`, `/api/admin/*`, `/api/produk/*` → `lib/d1/gudang.ts`, `admin.ts`, `produk.ts`; `warehouses`, `users`, `user_warehouses`, `admin_role_changes`, `products`, `product_changes`.
- Tabel D1: detail lengkap ada di tabel berikut; aturan umum: tabel ditulis modul `lib/d1/*`, dibaca route/`/api/baca`/bot Worker; migrasi asal tercantum per baris.

### Daftar tabel (78 tabel aktif; 92 `CREATE TABLE` termasuk rebuild/temp)
| tabel | migrasi | kolom kunci | index / pemakai utama |
|---|---|---|---|
| `users` | `0001_fase0_fondasi.sql` (rebuild `0011`, `0033`) | `id` PK, `tg_id` UNIQUE, `username`, `role` CHECK, `active` | `idx_users_tg/active/role`, `idx_users_username` (0021); `auth.ts`, `admin.ts` |
| `user_warehouses` | `0001_fase0_fondasi.sql` (rebuild `0011`, `0033`) | PK(`user_id`,`warehouse_id`) | `idx_uw_warehouse`; scope `requireSession` |
| `sessions` | `0001_fase0_fondasi.sql` (rebuild `0033`) | `token_hash` PK, `user_id`, `expires_at`, `revoked_at` | `idx_sessions_user/expires`; `worker/auth.ts`, `requireSession` |
| `auth_codes` | `0001_fase0_fondasi.sql` | `id` PK, `tg_id`, `code_hash`, `purpose`, `expires_at`, `attempts` | `idx_codes_tg`; route auth |
| `login_audit` | `0001_fase0_fondasi.sql` | `id` PK, `tg_id`, `ip`, `sukses`, `alasan`, `at` | `idx_audit_tg`; `worker/auth.ts` |
| `warehouses` | `0001_fase0_fondasi.sql` (rebuild `0002`, alter `0025`) | `id` TEXT PK, `code` UNIQUE, `nama`, `aktif`, `is_online`, `kledo_id` | `idx_wh_kledo`; `lib/d1/gudang.ts` |
| `settings` | `0001_fase0_fondasi.sql` | `key` PK, `value`, `updated_at` | `lib/d1/pengaturan.ts` |
| `idempotency_keys` | `0001_fase0_fondasi.sql` | `key` PK, `at` | tidak dipakai runtime (0 referensi di `app/`, `lib/`, `worker/`) |
| `products` | `0002_fase1_skema.sql` (alter `0013`,`0014`,`0015`,`0025`) | `sku` PK, `nama_accurate`, `nama_accurate_normalized`, `hpp`, `is_online_product`, `stok_min`, `kategori`, `kledo_synced_at` | `idx_products_online/norm`, `idx_products_nama_sku` (0038); `produk.ts`, `stok.ts` |
| `product_variants` | `0002_fase1_skema.sql` | `id` PK, `sku` FK, `variasi`, UNIQUE(`sku`,`variasi`) | `idx_variants_sku`; `/api/baca` |
| `product_search_keywords` | `0002_fase1_skema.sql` | PK(`sku`,`keyword`) | `cariProduk`/matching |
| `mp_products` | `0002_fase1_skema.sql` | `id` PK, `sku` FK, `marketplace`, `nama_mp`, `harga_jual_mp` | `idx_mp_sku`; `advanceBelumSku.ts` |
| `stock_by_bin` | `0002_fase1_skema.sql` | PK(`sku`,`warehouse_id`), `qty` | `idx_sbb_sku/wh`; sumber angka stok `lib/d1/stok.ts` |
| `stock_moves` | `0002_fase1_skema.sql` (rebuild `0006`, `0019`) | `id` PK, `ref_client_id` UNIQUE, `sku`, `qty`, `jenis` CHECK, `gudang_id`, `status`, `at` | `idx_moves_sku/pending/gudang`; tulis `stok/opname/transfer/produk/stokOnline`, baca `ledger.ts` |
| `transfers` | `0002_fase1_skema.sql` | `id` TEXT PK, `dari_warehouse_id`, `status`, `created_by` | `idx_transfers_status`; `transfer.ts` |
| `transfer_destinations` | `0002_fase1_skema.sql` | `id` PK, `transfer_id` FK, `idx_tujuan`, `status`, `status_kirim` | UNIQUE(`transfer_id`,`idx_tujuan`), `idx_dest_wh/transfer`; `transfer.ts` |
| `transfer_items` | `0002_fase1_skema.sql` | `id` PK, `destination_id` FK, `sku`, `qty` | `idx_titem_dest`; `transfer.ts` |
| `transfer_status_log` | `0002_fase1_skema.sql` | `id` PK, `transfer_id` FK, `status`, `oleh`, `at` | `idx_tlog_transfer`; `transfer.ts` |
| `stock_counts` | `0002_fase1_skema.sql` | `id` TEXT PK, `warehouse_id`, `status`, `freeze` | `idx_counts_status`; `opname.ts` |
| `count_lines` | `0002_fase1_skema.sql` | `id` PK, `count_id` FK, `sku`, `qty_sistem`, `qty_fisik`, `selisih` | `idx_clines_count`; `opname.ts` |
| `count_status_log` | `0002_fase1_skema.sql` | `id` PK, `count_id` FK, `status`, `at` | `opname.ts` (tanpa index khusus) |
| `daily_requests` | `0002_fase1_skema.sql` | `tanggal` PK, `status`, `form_dibuat_at`, `selesai_at` | `permintaan.ts` |
| `daily_request_items` | `0002_fase1_skema.sql` | `id` PK, `tanggal` FK, `sku`, `variasi`, `buffer`, `status`, `qty` | UNIQUE(`tanggal`,`sku`,`variasi`,`buffer`,`status`), `idx_dritem_tanggal`; `permintaan.ts` |
| `daily_request_changes` | `0002_fase1_skema.sql` | `id` PK, `tanggal` FK, `key_item`, `qty_lama`, `qty_baru` | `idx_drch_tanggal`; `permintaan.ts` |
| `access_requests` | `0002_fase1_skema.sql` | `tg_id` PK, `status`, `requested_at`, `rejected_until` | `idx_access_status`; `akses.ts` |
| `bot_sessions` | `0002_fase1_skema.sql` | `tg_id` PK, `history_json`, `pending_*_json` | `worker/bot.ts` |
| `keyword_notes` | `0002_fase1_skema.sql` | `id` PK, `raw_text` UNIQUE NOCASE, `interpreted_as`, `confidence` | `idx_keyword_last_used`; `lib/models/keywordNotes.js`, bot |
| `product_changes` | `0002_fase1_skema.sql` | `id` PK, `sku` FK, `field`, `lama`, `baru`, `oleh` | `idx_pch_sku`; `produk.ts`, legacy |
| `admin_role_changes` | `0002_fase1_skema.sql` | `id` PK, `tg_id`, `role_lama`, `role_baru`, `catatan` | `idx_arch_tg`; `admin.ts` |
| `guards` | `0002_fase1_skema.sql` | PK(`scope`,`key`), `payload_json`, `at` | `guard.ts`, `permintaan.ts`, `opname.ts` |
| `notify_queue` | `0004_fase2_notify.sql` | `id` PK, `kind` CHECK, `payload`, `target_user`, `target_group`, `sent_at`, `attempts` | `idx_queue_pending`; `worker/notify.ts` |
| `groups` | `0004_fase2_notify.sql` | `id` PK, `chat_id` UNIQUE, `status`, `notify_problem` | `worker/bot.ts`, `worker/notify.ts` |
| `import_batches` | `0005_fase2_import.sql` (alter `0034`) | `id` PK, `tipe`, `file`, `status`, `payload_json`, `progres_baris`, `nomor_potong` | `idx_import_status`, `idx_import_progress`; `/api/excel`, `/api/order` |
| `import_errors` | `0005_fase2_import.sql` | `id` PK, `batch_id` FK, `baris`, `pesan` | `idx_import_err`; `/api/excel`, `/api/order` |
| `orders` | `0006_fase3_order.sql` (alter `0009`,`0019`,`0040`) | PK(`marketplace`,`no_pesanan`), `tanggal`, `status_fulfill`, `stok_dikurangi`, `no_resi`, `preset_id`, `item_json` | `idx_orders_tgl/mp/resi/urut_daftar/preset_tgl`; `order.ts` |
| `order_items` | `0006_fase3_order.sql` (rebuild `0019`, alter `0030`) | PK(`marketplace`,`no_pesanan`,`sku`,`variasi`), `qty`, `harga_satuan`, `hpp_snapshot`, `perlu_sku` | `idx_items_sku/perlu_sku`; `order.ts` |
| `order_fees` | `0006_fase3_order.sql` (rebuild `0012`) | `id` PK, `marketplace`, `no_pesanan`, `jenis`, `basis`, `nilai` REAL, `amount` | `idx_fees_order`; `order.ts`, laba |
| `mp_fee_presets` | `0006_fase3_order.sql` (rebuild `0012`) | PK(`marketplace`,`jenis`), `basis`, `nilai` REAL | legacy; dibaca `seedLaba.ts` untuk migrasi ke `fee_rules` |
| `laba_harian` | `0008_laba_shopee.sql` (alter `0010`) | `tanggal` PK, `marketplace`, `omzet`, `hpp`, `biaya`, `laba`, `rincian_json` | `labaShopee.ts` (jalur laba harian lama), `seedLaba.ts` |
| `seller_presets` | `0013_laba_multi_preset.sql` (alter `0014`) | `id` PK, `nama`, `marketplace`, `status_toko`, `aktif`, `status_berlaku_sejak` | `idx_presets_aktif`; `preset.ts`, `labaPreset.ts` |
| `fee_rules` | `0013_laba_multi_preset.sql` (alter `0014`) | `id` PK, `preset_id` FK, `jenis`, `kategori`, `basis`, `nilai`, `valid_from`, `kode_program` | `idx_fee_rules_preset`; `preset.ts` |
| `laba_snapshot` | `0013_laba_multi_preset.sql` (alter `0016`,`0018`) | PK(`preset_id`,`tanggal`), `omzet`, `hpp`, `biaya`, `pajak`, `laba`, `no_json` | `idx_laba_snapshot_tgl`; `labaPreset.ts`, `analisa.ts` |
| `kategori_tarif` | `0014_kategori_program.sql` | `kategori_path` PK, `tier`, `grup_go`, `verifikasi` | `preset.ts`, laba |
| `tier_admin` | `0014_kategori_program.sql` | `tier` PK, `persen_dasar`, `diskon_persen`, `persen_final` | laba |
| `program_katalog` | `0014_kategori_program.sql` | `kode_program` PK, `nama`, `opsional` | laba |
| `preset_program` | `0014_kategori_program.sql` | PK(`preset_id`,`kode_program`), `aktif`, `aktif_sejak`, `aktif_sampai` | `preset.ts` |
| `ads_harian` | `0014_kategori_program.sql` | PK(`preset_id`,`tanggal`), `biaya_iklan_bersih` | laba/analisa |
| `preset_penghitung` | `0014_kategori_program.sql` | `preset_id` PK, `pesanan_selesai_kumulatif`, `bergabung_sejak` | laba |
| `laba_order` | `0017_laba_registry.sql` | PK(`preset_id`,`no_pesanan`), `tanggal_snapshot`, `tanggal_pesanan`, `laba`, `hash_baris` | `idx_laba_order_tgl/pesanan`; `labaRegistry.ts` |
| `advance_bookings` | `0019_order_advance.sql` | `booking_sn` PK, `no_resi`, `sku`, `qty`, `status`, `batch_import` | `idx_advance_status/batch/resi`; `advanceBelumSku.ts` |
| `import_files` | `0019_order_advance.sql` | `id` PK, `tipe`, `file`, `file_hash`, `no_json`, `batch_id` | UNIQUE `idx_import_files_hash`; `importFingerprint.ts` |
| `sku_belum_mp` | `0019_order_advance.sql` (alter `0030`) | PK(`nama_shopee`,`variasi`), `order_ref`, `sumber`, `qty_total` | `advanceBelumSku.ts` |
| `resi_grup` | `0019_order_advance.sql` | `no_resi` PK, `no_json`, `jumlah_order`, `tipe_pesanan`, `jasa_kirim` | `idx_resi_grup_jumlah/tipe`; `resiGrup.ts` |
| `ai_kredensial` | `0020_ai.sql` (alter `0024`) | `id` PK, `provider`, `ciphertext`, `iv`, `tag`, `aktif`, `base_url` | `idx_ai_kred_provider`; `aiKredensial.ts` |
| `ai_model` | `0020_ai.sql` (alter `0022`) | `id` PK, UNIQUE(`provider`,`model_id`), `jenis`, `reasoning_*` | `idx_ai_model_prov`; `aiModel.ts` |
| `ai_preset_prompt` | `0020_ai.sql` | `id` PK, `nama`, `kategori`, `prompt`, `urutan`, `aktif` | `idx_ai_preset_kat`; `aiPreset.ts` |
| `ai_tool` | `0020_ai.sql` | `nama` PK, `label`, `jenis`, `perlu_konfirmasi`, `aktif` | `aiTool.ts` |
| `ai_tool_kata` | `0020_ai.sql` | `id` PK, `tool`, `kata`, UNIQUE(`tool`,`kata`) | `idx_ai_kata`; `aiTool.ts` |
| `ai_pemakaian` | `0020_ai.sql` | PK(`tanggal`,`provider`,`model`,`jenis`), `panggilan`, `token_masuk`, `token_keluar` | penulis `lib/ai/provider.ts`, pembaca `app/api/pengaturan/ai/route.ts` |
| `ai_gambar_setting` | `0023_ai_gambar_setting.sql` | `tg_id` PK, `provider`, `model_id`, `aspek_rasio`, `jumlah` | `aiGambarSetting.ts` |
| `kledo_kredensial` | `0025_kledo.sql` (alter `0026`) | `id` PK, `subdomain` UNIQUE, `ciphertext`, `iv`, `tag`, `aktif`, `uji_pesan` | `kledoKredensial.ts` |
| `kledo_map` | `0025_kledo.sql` | PK(`jenis`,`kledo_id`), `lokal_id`, `nama_snapshot` | `idx_kledo_map_lokal`; `lib/kledo/*` |
| `kledo_sync` | `0025_kledo.sql` | `id` PK, `jenis`, `pemicu`, `status`, statistik sync | `idx_kledo_sync_mulai`; `lib/kledo/sinkron.ts` |
| `kledo_sync_galat` | `0025_kledo.sql` | `id` PK, `sync_id` FK, `bagian`, `ref`, `pesan` | `idx_kledo_galat_sync`; `lib/kledo/sinkron.ts` |
| `shopee_produk` | `0027_analisa.sql` | PK(`kode_produk`,`sku`), `tingkat`, `variasi`, `kode_variasi_shopee` | `idx_shopee_produk_sku/tingkat`; `shopeePeta.ts` |
| `peta_putusan` | `0027_analisa.sql` | `id` PK, UNIQUE(`jenis`,`acuan`), `diputuskan_sku`, `diputuskan_at` | `idx_peta_putusan_belum`; `shopeePeta.ts` |
| `ads_produk` | `0027_analisa.sql` | PK(`preset_id`,`tanggal`,`sku`), `biaya`, `klik`, `omzet_iklan` | `idx_ads_produk_tgl`; `adsProduk.ts` |
| `performa_produk` | `0027_analisa.sql` (index `0041`) | PK(`preset_id`,`periode`,`sku`), metrik kunjungan/keranjang/omzet | UNIQUE `idx_performa_preset_periode_sku`, `idx_performa_preset`; `analisa.ts` |
| `desain_folder` | `0028_desain.sql` | `id` PK, `preset_id` FK, `parent_id` self-FK, `nama` | `idx_desain_folder_pohon`; `desain.ts` |
| `ai_latar` | `0028_desain.sql` | `id` PK, `preset_id`, `folder_id`, `mime`, `base64`, `byte` | `idx_ai_latar_daftar`; `desain.ts` |
| `ai_desain` | `0028_desain.sql` | `id` PK, `preset_id`, `folder_id`, `ukuran`, `dokumen_json`, `latar_id` | `idx_ai_desain_terbaru/folder`; `desain.ts` |
| `ai_analisa_setting` | `0031_ai_analisa_setting.sql` | `tg_id` PK, `reasoning`, `maks_token`, `kedalaman` | `aiAnalisaSetting.ts` |
| `picklist_ekspor` | `0032_picklist_ekspor.sql` | PK(`marketplace`,`no_pesanan`,`mode`), `jumlah_cetak`, `oleh` | `idx_picklist_ekspor_order`; `picklistEkspor.ts` |
| `ai_model_izin` | `0035_ai_model_izin_role.sql` | `id` PK, `role`, `provider`, `model_id`, `jenis`, `allowed` | UNIQUE `idx_ai_model_izin_unik`, `idx_ai_model_izin_role_jenis`; `aiIzinModel.ts` |
| `ai_editor_setting` | `0036_ai_editor.sql` (alter `0037`) | `tg_id` PK, `reasoning`, `maks_token`, `model_editor` | `aiEditorSetting.ts` |
| `ai_elemen` | `0036_ai_editor.sql` | `id` PK, `preset_id`, `folder_id`, `kategori`, `svg`, `elemen_json` | `idx_ai_elemen_daftar/kategori/folder`; `elemenDesain.ts` |
| `order_cetak` | `0042_order_cetak.sql` | PK(`preset_id`,`no_pesanan`), `no_resi`, `dicetak_at`, `file` | `idx_order_cetak_resi`; `/api/printing` |
| `sinkron_log` | `0043_sinkron_log.sql` | `id` PK, `preset_id`, `jenis`, `file`, `baris`, `gagal`, `ringkas` | `idx_sinkron_preset_jenis_at`; `/api/sinkronisasi` |

## Test terkait
- Unit D1 (TS, colocated): `lib/d1/*.test.ts` — inti: `d1.library.test.ts` (mock D1 setia `prepare/bind/first/all/run/batch`), `order.test.ts`, `advanceBelumSku.test.ts`, `stokOnline.test.ts`, `labaRegistry.test.ts`, `seedLaba.test.ts`, `importFingerprint.test.ts`, `admin.test.ts`, `akses.test.ts`.
- Unit jalur lama (JS): `test/guardD1.test.js`, `test/mutasiStok.test.js`, `test/opnameGudang.test.js`, `test/permintaanGudang.test.js`, `test/dailyRequests.test.js`, `test/syncStokIdempoten.test.js`; helper mock Firestore di `test/helpers/mockFirestore.js`.
- E2E terkait data: `e2e/stok.spec.ts`, `e2e/stok-mutasi.spec.ts`, `e2e/opname-gudang.spec.ts`, `e2e/permintaan-antar-gudang-v51.spec.ts`, `e2e/order-laba.spec.ts`, `e2e/printing-sinkronisasi.spec.ts`, `e2e/laba-preset.spec.ts`.
- Jalankan satu test JS: `node --test test/guardD1.test.js`. Jalankan satu test TS harus lewat bundel esbuild: `npx esbuild lib/d1/order.test.ts --bundle --platform=node --format=esm --outfile=.tmp-order.test.mjs --external:react --external:@opennextjs/cloudflare && node --test .tmp-order.test.mjs`. Semua test TS: `npm run test:worker` (discover `lib/**/*.test.ts`, `app/**/*.test.ts`, `worker/*.test.ts`).
- Tidak ada test migrasi SQL; verifikasi skema manual via `wrangler d1 execute`/`sqlite_master` (lihat rencana di `docs/superpowers/plans/2026-10-08-fase3a-order-laba.md`).

## Gotcha / konvensi
- **Jangan edit migrasi yang sudah diterapkan.** Migrasi bersifat sekali jalan; perubahan skema wajib file nomor baru (dinyatakan eksplisit di header `0038_index_produk_total.sql`). Nomor berikutnya = `0044`.
- **Cara terapkan**: binding `DB` di `wrangler.jsonc` (`database_name: simple-wms`), folder default `migrations`. Urutan = prefiks numerik. Lokal: `npx wrangler d1 migrations apply simple-wms --local`; produksi: `--remote` (lihat "Belum diverifikasi" untuk detail command).
- **`0033_users_role_baru.sql` WAJIB dijalankan sendirian**, tidak dibundel dengan migrasi lain (komentar header: D1 menolak DROP/RENAME tabel target FK). `0033` juga membangun ulang `sessions`; `0011` membangun ulang `users` + `user_warehouses`.
- **`0003_fase1_seed_demo.sql` opsional dan hanya untuk dev/e2e**; header melarang diterapkan di produksi berisi data.
- Rebuild tabel memakai `PRAGMA foreign_keys=OFF`, tabel `_new`/`_backup`, `INSERT ... SELECT`, `DROP`, `RENAME`; contoh: `0002`,`0006`,`0011`,`0012`,`0019`,`0033`. Jangan menambah rebuild tabel yang tidak perlu.
- **D1 batch dibatasi 50 statement** oleh konvensi modul repo (`db.batch(stmts.slice(i, i + 50))` di `order.ts`, `adsProduk.ts`, `aiModel.ts`, `picklistEkspor.ts`, dll.). Batch besar harus dipotong.
- **`stock_moves` adalah ledger append-only**: jangan UPDATE/DELETE untuk koreksi; tulis baris baru. `qty` = delta, `qty_sistem`/`qty_fisik`/`selisih` untuk opname. `ref_client_id` UNIQUE dipakai idempotensi.
- **Sumber qty = `stock_by_bin`**, bukan kolom di `products`; `ONLINE` adalah baris `stock_by_bin(sku,'ONLINE')` (`GUDANG_ONLINE` di `stok.ts`). Stok negatif bukan bug.
- **Guard bukan pengaman utama**: `guardAktif` menelan error I/O dan hanya berlaku 10 detik; pengaman tulis tetap batch/CAS. Duplikat sebaiknya dibalas 409 oleh route.
- **`cekRateLimitD1` in-memory per isolat Worker**, bukan global; kunci biasanya `d1:<tg_id>`. Jangan andalkan untuk kuota lintas isolat.
- **Role dari DB, bukan body**: `sesiRoute` hanya autentikasi; otorisasi (`is_admin`, `is_owner`, `bolehTulisGudang`, `bolehBukaHalaman`) dicek di route. Role tak dikenal jatuh ke `guest` (fail closed).
- **`hasil.ts` tidak boleh mengimpor apa pun** (dipakai Worker tanpa `next/server`); `db.ts` boleh menarik `@opennextjs/cloudflare` + `react`.
- **Data AI terenkripsi**: `ai_kredensial`/`kledo_kredensial` menyimpan `ciphertext`,`iv`,`tag`; kunci dari `AI_KEY_ENCRYPTION_KEY` via `getKunciEnkripsi()`. Jangan pernah menaruh plaintext.
- **Legacy Firestore**: `lib/models/*.js` memakai `require("../firebase")` dan `db.runTransaction`; `app/api/auth/telegram/route.ts` masih `require("../../../../lib/models/admins.js")`. Worker `worker/bot.ts` sudah `lib/d1/*`, jadi jangan menambah model Firestore baru di jalur Worker.
- `docs/architecture-v5.md` adalah rancangan Firestore (`stock/{kode}.qty_per_gudang`, `stock_write_guard`); nama/normalisasi tabel di sana TIDAK sama dengan D1. Untuk skema, selalu buka migrasi.

## Belum diverifikasi
- Perintah persis `wrangler d1 migrations apply` tidak tertulis di README/`docs/development.md`; yang terverifikasi hanya konfigurasi `d1_databases` di `wrangler.jsonc`, folder `migrations`, dan contoh `wrangler d1 execute` di dokumen rencana. Anggap command standar Wrangler (migrations_dir default).
- Tidak ada dokumentasi yang menyatakan `mp_fee_presets`/`laba_harian` resmi dihentikan; status "legacy" disimpulkan dari pemakaian kode (`seedLaba.ts` membacanya untuk migrasi, `labaShopee.ts` masih menulis `laba_harian`).

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, termasuk sinonim/typo umum) | file pertama yang dibuka | catatan |
|---|---|---|
| stok tidak sinkron, qty beda antar gudang, stok online salah | `lib/d1/stok.ts` + `migrations/0002_fase1_skema.sql` (`stock_by_bin`) | cek `bacaQty`, `tulisQty`; `ONLINE` = baris `stock_by_bin`, bukan kolom `products` |
| stok berubah tapi riwayat/kartu stok kosong | `lib/d1/ledger.ts` + `lib/d1/stok.ts` | tulis ledger wajib di batch yang sama; `listMovements`/`kartuStok` hanya baca |
| mutasi stok dobel, klik dua kali, "duplikat" | `lib/d1/guard.ts` + route `app/api/stok/mutasi/route.ts` | guard 10 detik best-effort; cek juga `ref_client_id` |
| opname tidak bisa disetujui, selisih aneh, stok beku | `lib/d1/opname.ts` + `stock_counts`/`count_lines` | status `menunggu_approval`, `freeze`, `setujuiOpname` |
| transfer/permintaan antar gudang macet, stok tujuan tidak naik | `lib/d1/transfer.ts` + `app/api/permintaan-gudang/route.ts` | status per tujuan (`status`, `status_kirim`), `transfer_destinations` |
| permintaan harian tidak muncul, qty permintaan salah | `lib/d1/permintaan.ts` + `daily_request_items` | identitas item = `sku`+`variasi`+`buffer`+`status` |
| login gagal, sesi kedaluwarsa, user ter-logout | `lib/d1/auth.ts` + `worker/auth.ts` + `sessions` | cookie `swt_sesi`, token hash, `revoked_at`, `users.active` |
| akses ditolak padahal admin, role tidak dikenal | `lib/d1/auth.ts` + `lib/d1/peran.ts` + `lib/d1/admin.ts` | role DB (`owner/high_admin/admin/designer/guest`), scope `user_warehouses` |
| migrasi gagal, "table already exists", D1 error | `migrations/` (file terakhir) + `wrangler.jsonc` | jangan edit migrasi lama; `0033` harus sendirian; cek urutan nomor |
| tabel/kolom tidak ditemukan setelah deploy | `migrations/` + `docs/map/02-database.md` | bandingkan dengan 78 tabel aktif; migrasi mungkin belum `--remote` |
| laba salah hitung, fee dobel, snapshot tidak cocok | `lib/d1/labaPreset.ts`, `lib/d1/seedLaba.ts`, `fee_rules`/`laba_snapshot` | `mp_fee_presets`/`laba_harian` legacy; registry `laba_order` anti-dobel No. pesanan |
| data order hilang/tertimpa saat impor | `app/api/order/route.ts` + `lib/d1/order.ts` + `import_batches` | `import_files` hash, `import_errors`, mode bertahap |
| picklist/cetak order dobel atau resi salah | `lib/d1/picklistEkspor.ts`, `order_cetak`, `/api/printing` | `picklist_ekspor.jumlah_cetak`, upsert `order_cetak` |
| bot tidak menyimpan percakapan/notifikasi tidak terkirim | `worker/bot.ts` + `worker/notify.ts` + `bot_sessions`/`notify_queue` | queue `sent_at`/`attempts`; cron `drainQueue` |
| kredensial AI/Kledo tidak terbaca, enkripsi gagal | `lib/d1/aiKredensial.ts`, `lib/d1/kledoKredensial.ts`, `getKunciEnkripsi` | ciphertext/iv/tag, `AI_KEY_ENCRYPTION_KEY` |
| error "Cannot perform I/O on behalf of a different request" | `lib/d1/db.ts` | jangan simpan `db` lintas request; `getDb()` harus per request |
| kode lama Firestore dipakai di Worker | `lib/models/*.js` vs `lib/d1/*` | Worker hanya `lib/d1`; legacy Firestore untuk bot Node/sheets |
