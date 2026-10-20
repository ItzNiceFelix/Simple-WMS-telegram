# 00 — Index peta kode (mulai di sini)

Repo: `Simple-WMS-telegram` @ `0dbfff8`. Dibuat 2026-10-20 dari isi kode (bukan dari README lama). Dibangun ulang: `node scripts/peta-indeks.mjs`.

## Cara pakai (hemat token)
1. Cari gejala di tabel besar di bawah: `grep -in "<kata kunci>" docs/map/00-index.md` (atau Ctrl-F).
2. Buka **satu** file peta area yang ditunjuk, baca tabel “Kalau masalahnya … buka …” + “Peta file” di sana.
3. Baru buka file kode target (pakai rentang baris). Jangan menyapu seluruh `lib/`, `components/`, atau `docs/`.
4. Kalau mengubah/menambah route, modul, halaman, atau tabel: perbarui peta area, lalu jalankan `node scripts/peta-indeks.mjs`.

## Kata kunci cepat (1 kata -> peta)

| kata kunci | peta |
|---|---|
| resi, watermark, cetak, pdf, label | [`08-printing-desain.md`](08-printing-desain.md) |
| picklist, paket, gabung, ekspor | [`03-order.md`](03-order.md) |
| order, impor, shopee, excel, advance, batal, transisi | [`03-order.md`](03-order.md) |
| laba, hpp, fee, tarif, pajak, omzet, margin, diskon, harga-jual | [`04-laba.md`](04-laba.md) |
| stok, gudang, opname, transfer, reorder, online, mutasi, produk | [`05-stok-gudang.md`](05-stok-gudang.md) |
| permintaan | [`06-permintaan.md`](06-permintaan.md) |
| ai, gemini, groq, provider, fallback, kredensial, reasoning, stream, tools | [`07-ai.md`](07-ai.md) |
| dashboard, ringkasan, analisa, iklan, ads, performa, tren, roas | [`09-dashboard-analisa.md`](09-dashboard-analisa.md) |
| login, sesi, password, otp, tma, role, akses, admin, gudang-scope | [`10-auth-akses.md`](10-auth-akses.md) |
| bot, telegram, webhook, command, notifikasi | [`11-telegram-bot.md`](11-telegram-bot.md) |
| kledo, sheets, firebase, firestore, sinkron, reminder | [`12-integrasi-sinkron.md`](12-integrasi-sinkron.md) |
| ui, komponen, halaman, tema, responsif, tombol, dialog | [`13-ui-komponen.md`](13-ui-komponen.md) |
| test, e2e, playwright, skrip, seed, mock | [`14-test-tooling.md`](14-test-tooling.md) |
| deploy, wrangler, worker, cron, env, binding, assets | [`01-runtime-deploy.md`](01-runtime-deploy.md) |
| tabel, sql, d1, migrasi, skema, index | [`02-database.md`](02-database.md) |

## Daftar area

| peta | isi |
|---|---|
| [`03-order.md`](03-order.md) | 03 — Order Shopee, Picklist & Advance — Siklus order keluar Shopee: impor XLSX (`orders` + `Advance Fulfilment`) -> normalisasi/klasifikasi -> simpan D1 -> transisi fulfillment -> picklist PDF -> tanda cetak picklist/resi. Titik masuk: `POST /api/order` (impor bertahap & legacy), `GET /api/order`... |
| [`04-laba.md`](04-laba.md) | 04 — Laba, Harga Jual & Preset Biaya — Dua mesin terpisah: (1) **laba per order/preset** dari export `Order.all` Shopee, disimpan per `(preset_id, tanggal)` + registry anti-dobel per No. Pesanan; (2) **hitung harga jual** per SKU dari HPP + fee preset (tidak menyimpan transaksi). Inti murni (tan... |
| [`05-stok-gudang.md`](05-stok-gudang.md) | 05 — Stok, Produk & Gudang (D1) — Sumber angka stok = tabel `stock_by_bin` (PK `sku`+`warehouse_id`); `stock_moves` = ledger append-only. Tidak ada kolom stok di `products` — `stok_gudang_online` hanya nama field keluaran API. Gudang virtual `ONLINE` adalah **baris biasa** di `warehouses` +... |
| [`06-permintaan.md`](06-permintaan.md) | 06 — Permintaan Harian & Permintaan Antar-Gudang — Dua alur BERBEDA yang mudah tertukar: permintaan HARIAN (`/permintaan`, tabel `daily_requests`) vs permintaan ANTAR-GUDANG (`/permintaan-gudang`, tabel `transfers` + `transfer_destinations`). Antar-gudang v5.1: satu dokumen `transfers` berisi 1–20 tujuan; t... |
| [`07-ai.md`](07-ai.md) | 07 — AI (Provider, Model, Kredensial, Gambar, Analisa) — Dua stack AI berdampingan: (A) AKTIF `lib/ai/*.ts` — dipakai Worker + route Next, data di D1; (B) LEGACY CJS `lib/ai/{index,registry}.js`, `lib/ai/adapters/openaiCompat.js`, `lib/gemini/*` — dipakai `api/webhook.js` → `lib/router/routePesan.js`, data di Fir... |
| [`08-printing-desain.md`](08-printing-desain.md) | 08 — Printing (resi/watermark/PDF) & Editor Desain — Peta alur pratinjau/cetak resi dan generator PDF picklist, permintaan, laba, advance. Mencakup editor desain, operasi kanvas, pengaturan AI layout, serta penyimpanan elemen/latar. |
| [`09-dashboard-analisa.md`](09-dashboard-analisa.md) | 09 — Dashboard & Analisa Produk/Iklan — Peta UI dashboard Next.js, sumber data mock/real, halaman analisa produk, kalkulasi, impor Shopee, penyimpanan D1 dan ringkasan AI. Dashboard di repo ini adalah UI internal pada `app/page.tsx` dan halaman-halaman App Router; bukan satu komponen tunggal. Hal... |
| [`10-auth-akses.md`](10-auth-akses.md) | 10 — Auth, Sesi, Role & Akses — Peta autentikasi dashboard D1/Worker: password, kode Telegram, TMA, sesi `swt_sesi`, role, guard, scope gudang, dan admin. Jalur utama Next.js ialah `app/api/**/route.ts` → `lib/d1/route.ts` / `lib/d1/*`; Worker auth entry ada di `worker/api.ts`. |
| [`11-telegram-bot.md`](11-telegram-bot.md) | 11 — Bot Telegram (webhook, router, handlers, notifikasi) — Dua stack bot hidup berdampingan: (A) jalur AKTIF di Cloudflare Worker — `worker/index.ts` → `worker/bot.ts` → `lib/d1/*` + `lib/ai/*` (D1 sebagai sumber data); (B) jalur legacy Vercel CJS — `api/webhook.js` → `lib/router/*` → `lib/handlers/*` → `lib/gemini... |
| [`12-integrasi-sinkron.md`](12-integrasi-sinkron.md) | 12 — Integrasi & Sinkronisasi (Kledo, Sheets, Firebase, Reminder) — Isi area ini: tiga jalur integrasi/sinkronisasi — (1) Kledo → D1 satu arah (gudang/produk/stok/HPP), (2) Google Sheets era lama: searah Sheets→Firestore untuk master (`syncMasterData.js`) dan dua arah untuk stok online (`syncStokDuaArah.js`, Firestore selal... |
| [`13-ui-komponen.md`](13-ui-komponen.md) | 13 — UI, Halaman & Komponen — Cakupan: shell aplikasi (`app/layout.tsx`), 21 halaman App Router (`app/**/page.tsx`), 23 primitif `components/ui`, 68 komponen `components/dashboard`, tema/breakpoint/TMA, dan konfigurasi UI. Sumber data halaman dibagi dua: `SumberDataProvider` (`lib/dashb... |
| [`01-runtime-deploy.md`](01-runtime-deploy.md) | 01 — Runtime & Deploy (Cloudflare Worker + OpenNext + D1) — Area ini soal **bagaimana request masuk dan aplikasi dijalankan**: Cloudflare Worker kustom (`worker/index.ts`), auth/sesi sisi Worker (`worker/auth.ts`, `worker/api.ts`), webhook Telegram Worker (`worker/bot.ts`), cron + antrean notifikasi (`worker/notify.... |
| [`02-database.md`](02-database.md) | 02 — Database D1 & Model Lama (Firestore) — Peta **skema D1** (binding `DB`, database `simple-wms`) dan lapisan aksesnya: seluruh `migrations/*.sql` (43 berkas, 78 tabel aktif), `lib/d1/db.ts`, `lib/d1/route.ts`, `lib/d1/guard.ts`, `lib/d1/ledger.ts`, `lib/d1/rateLimit.ts`, `lib/d1/hasil.ts`. Sumber ... |
| [`14-test-tooling.md`](14-test-tooling.md) | 14 — Test & Tooling (unit, e2e, skrip manual) — Empat lapis verifikasi: (1) unit CJS `test/**/*.test.js` (node:test), (2) unit TS `lib/app/worker/**/*.test.ts` (di-bundle esbuild lalu node:test), (3) e2e Playwright mode MOCK (`e2e/*.spec.ts`), (4) skrip manual `scripts/**` untuk hal yang tidak bisa dioto... |

## Router gejala → area → file pertama

| gejala / kata kunci | peta | file pertama | catatan |
|---|---|---|---|
| "impor Shopee gagal", "file sudah pernah diimpor", "dobel impor", "hash beda" | `03-order.md` | `app/api/order/route.ts` (`preview-shopee`, `selesai-impor`) + `lib/d1/importFingerprint.ts` | fingerprint atas baris mentah + nama file; cek `import_files`. |
| "SKU tidak ada di master", "perlu SKU", "belum di MP", "barang raib dari picklist", "sku asal" | `03-order.md` | `lib/d1/orderImportShopee.ts` + `advanceBelumSku.ts` + `susunPernyataanOrder` | jalur `belumSku`, `skuManual`, `tandaiBelumMp`, `skuPenandaPerluSku`. |
| "status order tidak berubah setelah impor", "status mundur", "beda dengan Shopee", "batal hidup lagi" | `03-order.md` | `lib/d1/orderKlasifikasi.ts` + `aturStatusFulfill` di route | `aksiOrder`, `perbaruiStatus`, `mundur` (F10), `batal` final. |
| "tidak bisa ubah status", "transisi ditolak 409", "tombol kirim/pack hilang", "selesai tidak bisa dibatalkan" | `03-order.md` | `lib/d1/orderTransisi.ts` + `app/order/page.tsx` | `PETA_TRANSISI`, preflight batch atomik, label `pack` = "Disiapkan". |
| "picklist kosong", "urutan picklist tidak sesuai", "cetak ulang beda urutan", "urut nama tidak ngaruh" | `03-order.md` | `lib/d1/picklist.ts` + `picklistGabungPdf.ts` + route `picklist-pdf` | `default` berbeda antar mode; hanya order `pending` untuk mode `pisah`. |
| "resi gabungan", "satu resi banyak order", "paket kepisah", "default per paket" | `03-order.md` | `lib/d1/resiGrup.ts` + `buatPicklistPaket` + `pakaiPerPaket` | `resi_grup.jumlah_order`, `no_json`, kriteria gabungan. |
| "stok ONLINE berkurang setelah cetak", "stok minus", "potong dua kali" | `03-order.md` | `lib/d1/stokOnline.ts` + blok `picklist-pdf` | idempoten via `orders.stok_dikurangi`; `gabung-order` tidak memotong. |
| "PDF picklist kepotong", "kolom tumpang tindih", "halaman kosong", "qty total salah" | `03-order.md` | `picklistPdf.ts` / `picklistPaketPdf.ts` / `picklistGabungPdf.ts` | `potong()` memotong teks; `perluSku` dipisah ke tabel kedua. |
| "booking advance tidak muncul", "tidak bisa kirim ke Shopee", "booking sudah terkirim" | `03-order.md` | `lib/d1/advanceBelumSku.ts` + `app/api/advance/route.ts` + `app/advance/page.tsx` | status `menunggu/terkirim/batal/timeout`; qty 1 per SN. |
| "import order besar timeout", "413", "anggaran kueri habis", "potongan ditolak" | `03-order.md` | route `mulai-impor`/`impor-potong` + `UKURAN_POTONG` | resume per `batchId`; `progressBaris` = jumlah order. |
| "order masuk toko yang salah", "laba campur", "preset kosong" | `03-order.md` | `app/api/order/route.ts` + `migrations/0040_orders_preset.sql` | `presetId` wajib saat tulis; NULL = data lama. |
| "cetak resi tidak tercatat", "status cetak tidak muncul", "resi asing" | `03-order.md` | `app/api/printing/route.ts` + `petaCetak` + `printing-workspace.tsx` | hanya nomor yang dikenal `preset_id` yang di-upsert ke `order_cetak`. |
| "draft picking tidak bisa dikonfirmasi", "picking pending" | `03-order.md` | `app/draft/page.tsx` + `lib/dashboard/data/real.ts` (`listPickingDrafts`) | BUKAN order Shopee; data movement `pending_confirmation`. |
| "impor Excel produk", "template produk", "export stok/hpp" | `03-order.md` | `app/api/excel/route.ts` | `import_batches.tipe='produk'`; bukan impor order Shopee. |
| laba dobel, order kehitung dua kali, impor berulang, "angka bengkak" | `04-laba.md` | `lib/d1/labaPreset.ts` (`klasifikasikan`, `totalRegistry`, `hitungDanSimpan`) | cek `laba_order` PK + `laba_snapshot.no_json`; pakai `aksi=overlap` |
| total periode beda dengan jumlah snapshot, "total tidak cocok" | `04-laba.md` | `app/api/laba/route.ts` `aksi=total` + `totalRegistry` | total dari registry (1 baris/No), bukan SUM `laba_snapshot` |
| simpan ditolak, "belum punya kategori tarif", 422 | `04-laba.md` | `hitungLabaPreset.ts` (`TIER_UNKNOWN`) + `app/api/produk/kategori` | petakan `products.kategori`/`tier_override`, lalu hitung ulang |
| fee admin salah, tarif tidak kena, "admin 0" | `04-laba.md` | `lib/laba/aturanBiaya.ts` (`pilihAturan`) + `tier_admin`/`fee_rules` | cek `aktif`, `valid_from/to`, `status_toko`, `priority`, tier hasil `resolveTier` |
| kategori produk tidak ketemu, tier salah, path beda | `04-laba.md` | `lib/laba/kategori.ts` + `kategori_tarif` | `normalisasiPath` (` > `), prefix induk terpanjang, `tier_override` menang |
| program GO/XTRA tidak kena, plafon per qty salah | `04-laba.md` | `hitungLabaPreset.ts` (blok `kode_program`) + `preset_program` | `kategori` rule = grup huruf/`*`; `go_override` > `grup_go` > tier; toggle harus aktif |
| syarat program tidak jalan, "aturan dilewati", iklan | `04-laba.md` | `lib/laba/syarat.ts` + `ads_harian`/`preset_penghitung` | data null = `tak_dihitung`; kunci tak dikenal = gagal |
| PPh/PPN salah, "pajak dobel" | `04-laba.md` | `hitungLabaPreset.ts` (blok pajak) + `fee_rules.jenis` | `pajak_pph`/`pajak_ppn` masuk `biaya` DAN kolom `pajak`; jangan jumlahkan lagi |
| status order tidak dihitung, "Batal ikut", "Perlu Dikirim hilang" | `04-laba.md` | `hitungLabaPreset.ts` `statusDihitung` vs `labaShopee.ts` | allowlist berbeda; data lama di registry diberi peringatan D-5 |
| omzet beda dengan Shopee, diskon dobel, "subtotal" | `04-laba.md` | `hitungLabaPreset.ts` `dasarBaris` + `docs/refactor-laba/kolom-order-shopee.md` | dasar resmi = Harga Awal − diskon − voucher penjual |
| snapshot masuk tanggal salah, satu file jadi satu tanggal | `04-laba.md` | `lib/analisa/potongHarian.ts` + `POST /api/laba` | tanggal dari `Waktu Pesanan Dibuat`; nama berkas hanya pagar |
| PDF laba rusak/kosong, kolom tumpang tindih | `04-laba.md` | `lib/d1/labaPdf.ts` (`bangunPdfLaba`) | butuh `laba_snapshot` lengkap; `rincian`/`tolak` dari JSON |
| CSV laba kacau, koma/kutip | `04-laba.md` | `lib/d1/labaLaporan.ts` (`selCsv`, `barisCsv`) | CRLF; sumber `daftarPerNo` |
| harga jual negatif/tak terdefinisi, "pembagi ≤ 0" | `04-laba.md` | `lib/laba/hitungHargaJual.ts` | fee+iklan+margin ≥ 100%; margin nominal tidak masuk pembagi |
| harga jual terlalu murah/mahal, OPEX tidak masuk | `04-laba.md` | `hitungHargaJual.ts` + `app/harga-jual/page.tsx` | OPEX butuh `volumeBulanan`; flat dibagi `qtyPerOrder`; `pembulatan` |
| fee otomatis harga jual kosong, "tier tak dikenal" | `04-laba.md` | `lib/d1/hargaJualPreset.ts` (`muatKomponenHarga`) | tidak ada fallback `*` untuk admin; cek `fee_rules` preset + `kategori_tarif` |
| preset hilang, "laba campur antar toko", status toko salah | `04-laba.md` | `app/api/preset/route.ts` + `lib/d1/preset.ts` | `dihapus_at` = soft delete; `status_toko` memengaruhi `cocok` |
| aturan/preset tidak bisa diubah, 403 | `04-laba.md` | route `app/api/preset/**` | tulis owner-only, baca admin; guard `sesiRoute` (origin+sesi+rate limit) |
| HPP salah, "HPP basi", harga pakai HPP lama | `04-laba.md` | `app/api/produk/hpp/route.ts` + `lib/d1/produk.ts` (`ubahHpp`) + `12-integrasi-sinkron.md` | `products.hpp`; peringatan >30 hari dari `updated_at` |
| seed tarif tidak masuk, reset seed | `04-laba.md` | `lib/d1/seedLaba.ts` + `app/api/preset/[id]/aturan/route.ts` (`reset-seed`) | hanya `sumber LIKE 'seed:%'`; remote via `scripts/muat-seed-laba.mjs` |
| stok tidak sesuai / stok tidak sinkron / qty beda antar gudang / stok online salah / "stok gudang online" | `05-stok-gudang.md` | `lib/d1/stok.ts` | `bacaQty`, `bacaQtyPerGudang`, `tulisQty`; `ONLINE` = baris `stock_by_bin` |
| stok berubah tapi riwayat kosong / kartu stok kosong / histori hilang | `05-stok-gudang.md` | `lib/d1/ledger.ts` + `lib/d1/stok.ts` | ledger wajib satu batch; `listMovements` hanya baca |
| stok dobel / klik dua kali / "duplikat" / mutasi ganda | `05-stok-gudang.md` | `lib/d1/guard.ts` + `app/api/stok/mutasi/route.ts` | guard 10 dtk best-effort; `ref_client_id` tidak dipakai runtime |
| stok minus / minus tidak wajar / "stok negatif" | `05-stok-gudang.md` | `lib/d1/stokOnline.ts` | jalur ini berhenti di 0; minus hanya dari input manual |
| produk Kledo tidak muncul / daftar stok kosong / cari gagal | `05-stok-gudang.md` | `app/api/baca/route.ts` (scope `stok`) | `is_online` harus opt-in; paginasi di lapisan produk |
| halaman stok berat / lambat / 1174 baris / paginasi salah | `05-stok-gudang.md` | `app/stok/page.tsx` + `app/api/baca/route.ts` | limit cap 200; `total` dari COUNT produk |
| selisih opname aneh / tidak bisa setujui / "stok berubah sejak opname" | `05-stok-gudang.md` | `lib/d1/opname.ts` | CAS T9; status `menunggu_approval`; `freeze` belum dipakai |
| opname tidak mengubah stok / approval tidak jalan | `05-stok-gudang.md` | `app/api/opname-gudang/route.ts` | `buat` = admin+scope gudang, `setujui`/`tolak` = owner |
| transfer macet / stok tujuan tidak naik / status dokumen aneh | `05-stok-gudang.md` | `lib/d1/transfer.ts` | `status_kirim` per tujuan; status dokumen turunan |
| kirim transfer tidak boleh / 403 pada penerima | `05-stok-gudang.md` | `lib/d1/transfer.ts:kirimTujuan` | gate = penerima tujuan atau owner |
| stok kembali ke asal / tidak-terima / retur transfer | `05-stok-gudang.md` | `lib/d1/transfer.ts:tidakTerimaTujuan` | menulis `TRANSFER_IN` di gudang asal |
| reorder point tidak tersimpan / notifikasi menipis tidak jalan | `05-stok-gudang.md` | `lib/d1/stok.ts:setReorderPoint` + `worker/notify.ts:bangunLaporanHarian` | `products.stok_min`; laporan harian pakai `warehouse_id='ONLINE'` |
| HPP salah / edit HPP tidak tercatat / "hanya owner" | `05-stok-gudang.md` | `lib/d1/produk.ts:ubahHpp` + `app/api/produk/hpp/route.ts` | audit `product_changes`; idempoten bila nilai sama |
| toggle produk online tidak berpengaruh / potong picklist | `05-stok-gudang.md` | `app/api/produk/online/route.ts` + `lib/d1/stokOnline.ts` | hanya `is_online_product = 1` yang dipotong |
| tambah produk gagal / kode duplikat / stok awal salah | `05-stok-gudang.md` | `lib/d1/produk.ts:tambahProduk` + `app/api/admin/route.ts` | batch `products`+`stock_by_bin`+`OPENING` |
| impor Excel stok salah / batch tidak bisa dikonfirmasi | `05-stok-gudang.md` | `app/api/excel/route.ts` | 2 fase `import_batches`; ledger `restock` memakai qty absolut |
| kategori/tier produk tidak terpetakan / aksi massal gagal | `05-stok-gudang.md` | `app/api/produk/kategori/route.ts` + `app/api/produk/massal/route.ts` | validasi ke `kategori_tarif`/`tier_admin`; maks 500 SKU |
| gudang tidak bisa dinonaktifkan / nama gudang duplikat / maks 50 | `05-stok-gudang.md` | `lib/d1/gudang.ts` | `MAKS_GUDANG`, cek `lower(nama)` pada yang aktif |
| biaya iklan per produk salah / dobel / impor Ads gagal | `05-stok-gudang.md` | `lib/d1/adsProduk.ts` | akumulasi `ON CONFLICT`; parser CSV menghormati kutip |
| harga jual auto salah / fee tidak muncul / tier unknown | `05-stok-gudang.md` | `lib/d1/hargaJualPreset.ts` | fee admin/program/pajak; OPEX & volume manual |
| data stok beda dengan Kledo / sinkron membalik angka | `05-stok-gudang.md` | `lib/kledo/sinkron.ts` | timpa penuh non-ONLINE; ledger hanya drift |
| bot `/stok`, `/tambah`, `/kurangi` salah angka | `05-stok-gudang.md` | `worker/bot.ts` | memakai `bacaQtyPerGudang`/`ubahRelatif` gudang ONLINE |
| model Firestore lama dipanggil / "firebase-admin" di jalur stok | `05-stok-gudang.md` | `lib/models/stok.js` + `api/webhook.js` | hanya jalur Vercel legacy + `scripts/*`, bukan Worker |
| permintaan antar gudang macet, status tidak maju, "Tujuan sudah diproses" | `06-permintaan.md` | `lib/d1/transfer.ts` | CAS `status_kirim` + `meta.changes`; cek `tulisStatusDokumen` |
| stok gudang tujuan tidak naik setelah diterima | `06-permintaan.md` | `lib/d1/transfer.ts::terimaTujuan` | batch `stock_by_bin` + `stock_moves TRANSFER_IN`; cek `dest_warehouse_id` & gudang aktif |
| stok asal tidak turun / turun dua kali saat kirim | `06-permintaan.md` | `lib/d1/transfer.ts::kirimTujuan` | stok turun PER TUJUAN; `bacaQty` dari `stock_by_bin` |
| "Stok … di gudang asal tidak cukup" | `06-permintaan.md` | `lib/d1/stok.ts::bacaQty` | 409 sebelum CAS; cek baris `stock_by_bin` |
| tidak bisa setujui/kirim, 403 "Hanya penerima tujuan atau owner" | `06-permintaan.md` | `lib/d1/transfer.ts` + `app/permintaan-gudang/page.tsx::BarisTujuan` | `user_penerima_id` null = hanya owner |
| tidak bisa terima/selesai/batal, 403 "Hanya pembuat atau owner" | `06-permintaan.md` | `lib/d1/transfer.ts` | bandingkan `transfers.created_by` dengan `tg_id` sesi |
| tombol aksi abu-abu di UI, alasan disabled | `06-permintaan.md` | `app/permintaan-gudang/page.tsx` | `penerimaSaya`, `pembuatSaya`, `perluSetujui/perluKirim/perluTerima` |
| dokumen tetap "Dikirim" walau semua tujuan selesai | `06-permintaan.md` | `lib/d1/transfer.ts::hitungStatusDokumen` | P6: `selesai` aksi eksplisit, bukan turunan |
| tidak bisa batal, "Sudah ada tujuan yang dikirim" | `06-permintaan.md` | `lib/d1/transfer.ts::batalTransfer` | cek `status_kirim='dikirim'` di semua tujuan |
| tutup tujuan gagal, alasan wajib / maksimal 200 | `06-permintaan.md` | `lib/d1/transfer.ts::tutupTujuan` | owner-only; `catatan_alasan` |
| notifikasi bot permintaan tidak terkirim / "Notifikasi gagal" | `06-permintaan.md` | `lib/notifikasi/permintaanGudang.js` | modul belum dipanggil produksi; `notifikasi_terkirim` tidak ditulis D1 |
| PDF permintaan kosong / salah qty / nama produk hilang | `06-permintaan.md` | `app/api/permintaan-gudang/route.ts::pdfPermintaan` + `lib/d1/permintaanPdf.ts` | item digabung lintas tujuan; fallback `nama_accurate → nama → sku` |
| unduh PDF 400 "Permintaan belum punya item" | `06-permintaan.md` | `app/api/permintaan-gudang/route.ts::pdfPermintaan` | `transfer_items` kosong untuk semua tujuan; `ubahItemTransfer` hanya MENGISI tujuan yang items-nya kosong, tidak pern... |
| "Gudang asal tidak dikenal" / "Anda hanya dapat meminta dari gudang Anda" | `06-permintaan.md` | `app/api/permintaan-gudang/route.ts` + `lib/d1/auth.ts` | `scope_gudang` dari `user_warehouses`; gudang harus `aktif=1` |
| "Pilih minimal satu tujuan" / "Maksimal 20 tujuan" / "Maksimal 200 item" | `06-permintaan.md` | `lib/d1/transfer.ts` (`MAKS_TUJUAN`, `MAKS_ITEM`) + `lib/dashboard/validasiPermintaanGudangV5.js` | batas kembar: konstanta D1 vs validator orphan |
| permintaan harian tidak muncul hari ini | `06-permintaan.md` | `app/api/baca/route.ts` (`scope=daily`) + `lib/d1/permintaan.ts::tanggalHariIni` | tanggal WIB (+7 jam), bukan UTC; default `?tanggal` |
| qty permintaan harian salah / item dobel | `06-permintaan.md` | `lib/d1/permintaan.ts` | identitas `sku+variasi+buffer+status='diminta'`; `qty_diminta` snapshot saat `buat-form` |
| "Semua item sudah datang." saat kirim form | `06-permintaan.md` | `lib/d1/permintaan.ts::buatForm` + `efektifSelesai` | item qty 0 / `qty_diminta` 0 dianggap selesai |
| "Belum ada item yang datang." saat selesai manual | `06-permintaan.md` | `lib/d1/permintaan.ts::selesaikan` | butuh ≥1 `datang` ATAU semua qty 0 |
| badge "Berubah sejak form terakhir dikirim" muncul terus | `06-permintaan.md` | `app/permintaan/page.tsx` (`adaDesync`) | `qty !== (qty_diminta ?? qty)` pada status `diproses` |
| "Form terkirim" tapi tidak ada pesan Telegram | `06-permintaan.md` | `app/api/permintaan/route.ts` + `lib/models/dailyRequests.js::kirimFormPermintaan` | route D1 TIDAK mengirim Telegram dan tidak membalas `dikirim_ulang` |
| tombol Barang Datang tidak ada saat draft | `06-permintaan.md` | `app/permintaan/page.tsx` | guard UI B1 (draft tidak merender tombol) |
| guest bisa/tidak bisa buka halaman | `06-permintaan.md` | `lib/d1/akses-halaman.ts` + `components/dashboard/nav-config.ts` | `/permintaan` & `/permintaan-gudang` untuk owner/high_admin/admin |
| 403 "Origin tidak diizinkan" saat POST | `06-permintaan.md` | `lib/d1/route.ts::tolakOriginD1` | `DASHBOARD_ALLOWED_ORIGINS`; POST tanpa Origin ditolak di produksi |
| 401 "Sesi kedaluwarsa" saat aksi | `06-permintaan.md` | `lib/d1/auth.ts::requireSession` | cookie `swt_sesi`; UI menampilkan "Buka ulang" |
| 429 terlalu banyak permintaan | `06-permintaan.md` | `lib/d1/route.ts::sesiRoute` | 30/menit untuk kedua route tulis, 120/menit `baca` |
| e2e permintaan gagal setelah ubah UI | `06-permintaan.md` | `e2e/permintaan*.spec.ts` | testid `h6-permintaan`, `h12-permintaan-gudang`, `status-permintaan`, `kartu-permintaan-*` |
| data seed/paritas mock berbeda dengan server | `06-permintaan.md` | `lib/dashboard/data/mock.ts` + `lib/dashboard/data/mock-data.ts:595` | `pg-001` menunggu, penerima null; paritas dikunci `test/paritasPermintaanV51.test.js` |
| "semua provider gagal", fallback tidak dipakai, provider cadangan tidak dicoba | `07-ai.md` | `lib/ai/provider.ts` (`ringkasGagal`, `kandidatTeks`) | baca `upaya`/`catatan`: tiap kandidat menyebut alasan; cek `chainTeks` |
| "tidak ada kredensial aktif", key kosong, api key tidak terbaca | `07-ai.md` | `lib/d1/aiKredensial.ts` + `lib/ai/kripto.ts` | juga berarti kunci enkripsi berubah/data rusak; cek `AI_KEY_ENCRYPTION_KEY` |
| "AI_KEY_ENCRYPTION_KEY belum diset", kunci enkripsi, decrypt gagal | `07-ai.md` | `lib/d1/db.ts` (`getKunciEnkripsi`) + `lib/ai/kripto.ts` | secret Worker, bukan baris D1 |
| "tidak diizinkan owner", model tidak boleh, izin model, allowlist role | `07-ai.md` | `lib/d1/aiIzinModel.ts` + `provider.ts::kandidatTeks` | owner bypass; non-owner fail closed; kunci `provider\0model` |
| reasoning selalu timeout, "max/xhigh", thinking budget | `07-ai.md` | `lib/ai/reasoning.ts` + konstanta di `provider.ts` | normalisasi tingkat; Gemini 2.5 `thinkingBudget` vs 3 `thinkingLevel` |
| jawaban streaming terpotong / tidak lanjut provider lain | `07-ai.md` | `lib/ai/provider.ts::panggilTeksStream` + `lib/ai/stream.ts` | aturan potongan pertama; `selesaiAlasan='length'` |
| SSE Gemini tidak terbaca, gemini dilewati di stream | `07-ai.md` | `lib/ai/adapterGemini.ts::streamGemini` | bentuk `candidates[].content.parts[].text`, bukan `choices[].delta` |
| gambar gagal, "Provider tidak mengembalikan gambar", edit multi-referensi | `07-ai.md` | `lib/ai/adapterOpenai.ts::gambarOpenai` + `provider.ts::panggilGambar` | `b64_json`/data URL/URL; multipart `image` vs `image[]` |
| "tool" tidak jalan, bot minta konfirmasi terus, tool tulis | `07-ai.md` | `lib/ai/chat.ts` + `lib/ai/tools.ts` + `lib/d1/aiTool.ts` | jenis `tulis`/`perlu_konfirmasi`; eksekusi hanya lewat `ai:ya` |
| kata kunci tool tidak cocok, "belum paham maksudnya", `saatTakCocok` | `07-ai.md` | `lib/ai/hematToken.ts::pilihTool` + `ai_tool_kata` | peta kata dari DB, bukan hardcode |
| chat bot lambat/kena limit, "terlalu banyak pesan ke AI" | `07-ai.md` | `lib/ai/rateLimit.ts` + `lib/d1/rateLimit.ts` | limit in-memory per isolat; `rateLimitPerMenit` tak terpakai |
| model editor tidak terpakai, editor pakai model bot | `07-ai.md` | `app/api/desain/layout/route.ts` + `lib/d1/aiEditorSetting.ts` | `model_editor` = `provider\0model` → `providerDiminta` |
| analisa bilang "model belum dipilih", tombol analisa mati | `07-ai.md` | `app/api/analisa/route.ts` (`aksi=model-analisa`) + `lib/analisa/ai.ts` | butuh `modelTeks[provider]` + kredensial aktif |
| pemakaian/biaya tidak tercatat, token 0 | `07-ai.md` | `provider.ts::catatPemakaian` + `ai_pemakaian` | provider tidak mengirim `usage` → 0; tanggal WIB |
| tarik model kosong, impor model gagal, kapabilitas model | `07-ai.md` | `app/api/pengaturan/ai/route.ts` (`tarikModel`) + `lib/d1/aiModel.ts` + `lib/ai/kapabilitas.ts` | OpenRouter publik; key absen hanya menurunkan rate limit |
| bot legacy (Vercel/Firestore) error, `GEMINI_API_KEY`, `/settings` | `07-ai.md` | `lib/gemini/client.js` + `lib/ai/index.js` + `lib/router/routePesan.js` | stack lama; jangan tertukar dengan jalur D1 |
| Resi tidak tercetak / tombol cetak | `08-printing-desain.md` | `app/printing/page.tsx` | Area cetak WAJIB anak langsung `<body>`; CSS `body>*:not(#area-cetak-printing)`. |
| Pratinjau kosong / gagal membaca label | `08-printing-desain.md` | `lib/printing/ekstraksi.ts` | Ekstraksi teks murni; lihat test colocated. |
| Strip tidak muncul / posisi meleset | `08-printing-desain.md` | `lib/printing/strip.ts` + `lib/printing/watermark.ts` | Kotak `strip`/`resi` (mm dari atas) → `drawPage`; strip ditanam `embedPdf`. |
| Halaman kosong ikut tercetak / boros kertas | `08-printing-desain.md` | `components/dashboard/printing-workspace.tsx` | Pemindai menandai kosong (<0,2% tinta) dan langsung melewati; klik halaman untuk membalik. |
| Barcode jadi kabur | `08-printing-desain.md` | `lib/printing/watermark.ts` | Kode mempertahankan halaman asli vektor lewat `embedPage`. |
| Jumlah halaman preview dan cetak beda | `08-printing-desain.md` | `lib/printing/watermark.ts` | Periksa opsi gambar watermark halaman pertama. |
| Picklist per SKU salah | `08-printing-desain.md` | `lib/d1/picklistPdf.ts` | `bangunPdfPicklist`. |
| Picklist per paket salah | `08-printing-desain.md` | `lib/d1/picklistPaketPdf.ts` | `bangunPdfPicklistPaket`. |
| Picklist gabungan order+advance | `08-printing-desain.md` | `lib/d1/picklistGabungPdf.ts` | `bangunPdfPicklistGabung`. |
| Pemetaan resi gabungan | `08-printing-desain.md` | `lib/d1/resiGrup.ts` | Satu resi ke beberapa order. |
| Surat permintaan PDF salah | `08-printing-desain.md` | `lib/d1/permintaanPdf.ts` | `bangunPdfPermintaan`; input `DataPermintaanPdf`. |
| Laporan laba PDF salah | `08-printing-desain.md` | `lib/d1/labaPdf.ts` | `bangunPdfLaba`; input snapshot `LabaPdfData`. |
| Picklist Advance salah | `08-printing-desain.md` | `lib/d1/advancePdf.ts` | `bangunPdfAdvance`. |
| Layout AI ditolak / elemen invalid | `08-printing-desain.md` | `lib/desain/skemaLayout.ts` | `validasiLayout`; operasi di `skemaOperasi.ts`. |
| Simpan desain / folder / latar | `08-printing-desain.md` | `migrations/0028_desain.sql` | Tabel `ai_desain`, `desain_folder`, `ai_latar`; modul D1 perlu ditelusuri. |
| AI layout atau model editor | `08-printing-desain.md` | `app/api/desain/layout/route.ts` | Baca `lib/desain/aiEditor.ts`, migrasi 0036/0037. |
| Draft ditolak / bukan pemilik | `08-printing-desain.md` | `lib/dashboard/draftOwner.js` | Guard/aksi pendamping `draftGuard.js`, `aksiDraft.js`. |
| Ringkasan kosong, dashboard tidak memuat | `09-dashboard-analisa.md` | `app/page.tsx` | cek `useData()` dan provider layout |
| mock tampil padahal data produksi | `09-dashboard-analisa.md` | `lib/dashboard/data/index.ts` | cek `NEXT_PUBLIC_DASHBOARD_DATA`, default real |
| data real dashboard gagal dimuat | `09-dashboard-analisa.md` | `lib/dashboard/data/real.ts` | fetch `/api/baca`, sesi dan timeout |
| analisa angka / hasil cepat keliru | `09-dashboard-analisa.md` | `lib/analisa/hitung.ts` | rumus murni; masukan dibentuk route |
| Saran Iklan, ROAS impas / prioritas | `09-dashboard-analisa.md` | `app/analisa/page.tsx` | UI; rumus keputusan ada di `hitung.ts` |
| kunjungan organik tertukar tayangan iklan | `09-dashboard-analisa.md` | `lib/analisa/tipe.ts` | kontrak membedakan `organik*` dari kolom ads |
| impor performa CSV/Shopee gagal | `09-dashboard-analisa.md` | `lib/d1/shopeePetaImpor.ts` | `imporPerforma`; penulis tabel `performa_produk` = `shopeePeta.ts:simpanPerforma` |
| periode kosong/legacy tidak terbaca | `09-dashboard-analisa.md` | `migrations/0041_performa_periode.sql` | nilai kosong dimigrasikan ke `legacy` |
| biaya iklan tidak cocok / CSV Ads | `09-dashboard-analisa.md` | `lib/d1/adsProduk.ts` | parser dan agregator per SKU/tanggal |
| peta SKU Shopee salah atau belum diputuskan | `09-dashboard-analisa.md` | `lib/analisa/peta.ts` | kandidat bukan putusan otomatis |
| peta/putusan tidak tersimpan | `09-dashboard-analisa.md` | `app/api/analisa/peta/route.ts` | cek guard sesi/role dan tabel D1 |
| AI analisa tidak merangkum / salah konteks | `09-dashboard-analisa.md` | `lib/analisa/ai.ts` | `susunBahan`, prompt dan konteks organik |
| estimasi iklan tiga asumsi | `09-dashboard-analisa.md` | `lib/analisa/iklanEstimasi.ts` | histori harian dan status aman/tipis/rugi |
| grafik tren, rentang atau delta | `09-dashboard-analisa.md` | `lib/analisa/tren.ts` | seri tanggal, pembanding dan null hari kosong |
| format angka/tanggal di dashboard | `09-dashboard-analisa.md` | `lib/dashboard/format.ts` | helper presentasi bersama |
| UI tab/detail analisa | `09-dashboard-analisa.md` | `components/dashboard/analisa-detail-produk.tsx` | komponen analisa khusus; halaman parent `/analisa` |
| dialog impor atau preset toko | `09-dashboard-analisa.md` | `components/dashboard/input-iklan.tsx` | UI impor; backend ada di API dan `lib/d1` |
| lupa password, OTP, kode tidak masuk | `10-auth-akses.md` | `app/api/auth/minta-kode/route.ts` | Telusuri pengiriman Telegram, lalu `reset-password` dan `worker/auth.ts`. |
| sandi ditolak, PBKDF2, login password | `10-auth-akses.md` | `worker/auth.ts` | `verifikasiPassword`, `loginTerkunci`, dan audit login. |
| login Mini App, initData, HMAC | `10-auth-akses.md` | `lib/dashboard/auth/initData.js` | Pemanggil D1: `app/api/auth/tma/route.ts`; jangan tertukar `telegram`. |
| sesi habis, cookie hilang, swt_sesi | `10-auth-akses.md` | `lib/d1/auth.ts` | Bandingkan `worker/auth.ts` expiry/revoke/cookie. |
| masih login setelah logout, cabut sesi | `10-auth-akses.md` | `app/api/auth/logout/route.ts` | Memanggil `cabutSesi` lalu cookie penghapus. |
| role asing, staff, guest dapat akses | `10-auth-akses.md` | `lib/d1/auth.ts` | Normalisasi role asing ke guest; matriks ada di akses-halaman. |
| halaman admin tidak muncul, izin halaman | `10-auth-akses.md` | `lib/d1/akses-halaman.ts` | `AKSES_HALAMAN` dan `bolehBukaHalaman` fail-closed. |
| akses bot designer, kapabilitas perintah | `10-auth-akses.md` | `lib/d1/peran.ts` | `kapabilitas` berbeda dari izin halaman. |
| guard API, origin, CSRF, rate limit | `10-auth-akses.md` | `lib/d1/route.ts` | Urutan origin → sesi → rate; role di handler. |
| terlalu banyak gagal login, terkunci | `10-auth-akses.md` | `worker/auth.ts` | `loginTerkunci` membaca `login_audit`, ambang 5/15 menit. |
| gudang salah, scope gudang, user_warehouses | `10-auth-akses.md` | `lib/d1/admin.ts` | `setGudangUser`; pemeriksaan scope juga di `lib/d1/auth.ts`. |
| role berubah tanpa jejak, audit admin | `10-auth-akses.md` | `lib/d1/admin.ts` | `ubahRole` mencatat `admin_role_changes`. |
| permintaan akses, approve/reject | `10-auth-akses.md` | `lib/d1/akses.ts` | `mintaAkses`, `putuskanAkses`, cooldown penolakan. |
| migrasi role gagal, users/session | `10-auth-akses.md` | `migrations/0033_users_role_baru.sql` | Perlu dijalankan tersendiri; tabel FK dibangun ulang. |
| akses model AI role, model mahal | `10-auth-akses.md` | `migrations/0035_ai_model_izin_role.sql` | Periksa juga `lib/d1/aiIzinModel.ts`, terpisah dari RBAC halaman. |
| Firestore lama, dat_sesi, rules | `10-auth-akses.md` | `lib/dashboard/auth/sesi.js` | Legacy HMAC; `firestore.rules` dan `lib/models/*.js` bukan sesi D1. |
| bot diam / tidak membalas di grup padahal DM normal | `11-telegram-bot.md` | `lib/telegram/apakahBotHarusMerespon.js` + env `TELEGRAM_BOT_USERNAME` | cek mention/reply/command; username kosong = tidak terdeteksi |
| bot tidak merespon sama sekali (DM juga) | `11-telegram-bot.md` | `worker/bot.ts::tanganiWebhook` (`secretCocok`, token) | secret salah → 401; token kosong → error saat kirim |
| login/chat gagal, user belum terdaftar, "minta akses", approval | `11-telegram-bot.md` | `worker/bot.ts::gateAdmin` + `lib/handlers/handleAksesBaru.js` | dua jalur: D1 (`access_requests.status`) vs Firestore (`apakahMenungguKenalan`) |
| tombol Setujui/Tolak tidak bereaksi / spinner | `11-telegram-bot.md` | `lib/router/routePesan.js::routeCallbackQuery` + `lib/handlers/handleKonfirmasiCallback.js` | prefix `callback_data` salah atau callback tak dijawab |
| tombol konfirmasi stok/AI nyangkut, dobel penerapan | `11-telegram-bot.md` | `worker/bot.ts::tanganiCallbackAi` + `lib/handlers/handleKonfirmasiCallback.js` | `pending_action_json`, guard `draft_kirim_guard`, cek `bolehPerintah` |
| stok tidak sinkron setelah kirim foto picking list | `11-telegram-bot.md` | `lib/handlers/handleScreenshotPickingList.js` → `lib/handlers/konfirmasiPickingList.js` | draft belum di-approve, item `ragu` sengaja dilewati, `kode_barang` kosong |
| cetak/isi picking list salah baca (nama produk salah) | `11-telegram-bot.md` | `lib/gemini/ekstrakPickingList.js` lalu `lib/matching/cariProdukByNama.js` | hasil vision mentah vs fuzzy match, ambang 0.72/0.45 |
| penanda kolom picking list salah arti (D12, SDA, "sisa gdg") | `11-telegram-bot.md` | `lib/models/keywordNotes.js::ambilActionTypeUntukPenanda` | default `MINTA`→`perlu_request` sampai dikonfirmasi di /kata-kunci |
| opname tidak match / selisih aneh / stok opname tidak berubah | `11-telegram-bot.md` | `lib/handlers/handleOpname.js` (`bandingkanDenganSistem`, `konfirmasiOpname`) | kategori `selisih_besar`/`hilang_dari_opname` tidak auto-apply |
| notif/cron tidak terkirim, laporan harian hilang | `11-telegram-bot.md` | `worker/notify.ts::drainQueue` + `worker/index.ts::scheduled` + `wrangler.jsonc` crons | cek `notify_queue.attempts`, `sent_at`, `last_error`, `groups.status` |
| notifikasi error job cron (GitHub Actions) | `11-telegram-bot.md` | `lib/telegram/notifikasiError.js::kirimNotifErrorCron` | penerima owner, fallback admin; best-effort tidak throw |
| "terlalu banyak permintaan", balasan AI lambat/kuota | `11-telegram-bot.md` | `lib/ai/rateLimit.ts::cekBatas` / `lib/gemini/rateLimit.js` | in-memory per instance; kuota provider di `lib/ai/provider.ts` |
| gambar hasil Studio Gambar gagal kirim ke Telegram | `11-telegram-bot.md` | `app/api/ai/gambar/kirim-telegram/route.ts` | >9 MB base64 → 413 ramah; role harus lolos `ROLE_GAMBAR` |
| pesan Markdown bot gagal terkirim ("can't parse entities") | `11-telegram-bot.md` | `lib/telegram/kirimPesan.js::panggilTelegramApi` | retry otomatis tanpa parse_mode; Worker pakai `esc()`/`amanHtml()` |
| command bot tidak dikenal / `/help` kosong | `11-telegram-bot.md` | `lib/router/handleCommand.js::DAFTAR_COMMAND` (legacy) vs `worker/bot.ts::tanganiCommand` | daftar command BEDA antar dua stack; `/help` tidak ada di Worker |
| group Telegram jadi supergroup, notif nyasar | `11-telegram-bot.md` | `worker/bot.ts::tanganiMigrasiGrup` + `worker/notify.ts::kirimSatu` | `chat_id` -100... dan `notify_queue.target_group` harus ikut dipindah |
| sinkron Kledo gagal / token salah / "Kledo menolak" / uji koneksi | `12-integrasi-sinkron.md` | `lib/kledo/klien.ts` + `app/api/pengaturan/kledo/route.ts` | cek `kledoGet` (retry 5xx/429, timeout), aksi `uji`, pesan tersimpan di `kledo_kredensial.uji_pesan` |
| stok tidak sinkron / qty beda dengan Kledo / drift | `12-integrasi-sinkron.md` | `lib/kledo/sinkron.ts` (tahap 3) | `stock_by_bin` ditimpa penuh; gudang tak terpetakan dilewati; lihat `kledo_sync.stok_drift` |
| HPP berubah sendiri / hpp jadi 0 / laba salah hitung karena HPP | `12-integrasi-sinkron.md` | `lib/kledo/sinkron.ts` → `hppDariKledo` | hanya angka ≥ 1 setelah `Math.round` yang menimpa; sisanya dipertahankan |
| gudang dobel / gudang Kledo tidak muncul / nama gudang berubah sendiri | `12-integrasi-sinkron.md` | `lib/kledo/sinkron.ts` (tahap 1) + `normNama` | pemetaan NAMA, bukan id; bentrok dilaporkan di `kledo_sync_galat` |
| sinkron nyangkut "sedang jalan" / tombol sinkron ditolak 409 | `12-integrasi-sinkron.md` | `lib/kledo/sinkron.ts` → `adaSinkronBerjalan` | catatan senyap >180 detik ditutup otomatis; cek `GET ?aksi=ringkas` |
| sinkron jalan tapi berhenti di tengah / produk cuma sebagian masuk | `12-integrasi-sinkron.md` | `app/api/pengaturan/kledo/route.ts` (aksi sinkron) | wajib `ctx.waitUntil` + `db.batch` 50; jangan jalankan lurus di request |
| cron sore Kledo tidak jalan / tidak ada notifikasi sinkron | `12-integrasi-sinkron.md` | `worker/notify.ts` (`sinkronKledoSore`, `SINKRON_CRON`) + `wrangler.jsonc` | cron `0 9 * * *` = 16:00 WIB; kredensial aktif diambil dari D1 |
| kredensial Kledo tidak bisa didekripsi / kunci enkripsi hilang | `12-integrasi-sinkron.md` | `lib/d1/kledoKredensial.ts` + `lib/ai/kripto.ts` | `AI_KEY_ENCRYPTION_KEY` berganti → `ambilKledo` balik null |
| stok online Sheets tidak sama / "sheets ketinggalan" / draft /sync_stok | `12-integrasi-sinkron.md` | `lib/sheets/syncStokDuaArah.js` (`bandingkanNilai`, `applyDraft`) | Firestore menang; draft di `sync_stok_drafts`; review admin wajib |
| kolom Stok Online belum ada / bot minta izin tambah kolom | `12-integrasi-sinkron.md` | `lib/sheets/syncStokDuaArah.js` (`pastikanKolomStokAda`) + `lib/sheets/client.js` (`tambahKolomHeader`) | jangan tambah kolom diam-diam; grid dilebarkan dulu (appendDimension) |
| master produk/HPP dari Sheets tidak masuk / sync harian pagi gagal | `12-integrasi-sinkron.md` | `lib/sheets/syncMasterData.js` + `scripts/jalankanSyncMasterData.js` | searah Sheets→Firestore; `validasiEnvCronSheets()`; workflow `sync-master-data.yml` |
| data produk terasa basi di dashboard / "kok masih pakai Firestore" | `12-integrasi-sinkron.md` | `lib/firebase.js` + `lib/models/produk.js`, `lib/models/stok.js` | sisa era lama; pemakai produksi tinggal cron Sheets/reminder, bot `lib/router/**`, dan `app/api/auth/telegram/route.ts` |
| reminder stok menipis tidak muncul / reorder point tidak kirim | `12-integrasi-sinkron.md` | `lib/reminder/cekReorderPoint.js` + `test/reorderPoint.test.js` | penerima `telegram_user_id`; dipanggil dari `lib/models/stok.js`; arahkan ke pembungkus D1 `lib/d1/stok.ts` bila alur... |
| reminder harian pagi kosong / proyeksi habis tidak masuk | `12-integrasi-sinkron.md` | `lib/reminder/reminderHarian.js` + `.github/workflows/reminder-harian.yml` | `Math.abs(qty)`; ambang 3 hari, tren 7 hari; env trio Firebase wajib |
| riwayat impor salah / "terakhir diimpor" tidak akurat di halaman Sinkronisasi | `12-integrasi-sinkron.md` | `app/api/sinkronisasi/route.ts` + `app/sinkronisasi/page.tsx` | jenis allowlist; klien yang mencatat setelah impor; kunci respons `perJenis` (bukan `preset`) |
| impor order tercampur antar toko / order tidak muncul per toko | `12-integrasi-sinkron.md` | `migrations/0040_orders_preset.sql` + `app/api/order/route.ts` | `preset_id` ditulis saat impor; baris lama NULL = belum diketahui |
| sidebar hilang, menu mobile, navigasi bawah, hamburger | `13-ui-komponen.md` | `components/dashboard/app-shell.tsx` + `app-sidebar.tsx` | breakpoint 768px; cek juga `e2e/responsif.spec.ts` |
| halaman tidak berizin, akses ditolak, "butuh akses", redirect | `13-ui-komponen.md` | `components/dashboard/butuh-akses.tsx` | dipasang per halaman; role dari `lib/dashboard/auth/guard.js` (peta 10) |
| tema gelap/terang, warna salah, dark mode tidak persist | `13-ui-komponen.md` | `components/dashboard/theme-toggle.tsx` + `app/globals.css` | `localStorage["tema"]`, class `.dark` |
| layar 360 meluber, layout pecah, responsif | `13-ui-komponen.md` | `app/globals.css` + `components/dashboard/app-shell.tsx` | uji `e2e/responsif.spec.ts`; cek tabel lebar (min-width) |
| TMA, Telegram WebApp, viewport, initData | `13-ui-komponen.md` | `app/layout.tsx` + `app/api/auth/tma/route.ts` | SDK dimuat `beforeInteractive`; validasi di server |
| halaman kosong padahal data ada, kartu ringkasan 0 | `13-ui-komponen.md` | `lib/dashboard/data/index.ts` + `sumber-data.tsx` | cek `NEXT_PUBLIC_DASHBOARD_DATA` (mock/real) |
| tombol tidak bereaksi, data tidak refresh setelah simpan | `13-ui-komponen.md` | komponen `dialog-*`/`aksi-*` di halaman terkait | cek state busy + pemanggilan ulang fetch/provider |
| toast/error tidak muncul | `13-ui-komponen.md` | `components/ui/sonner.tsx` + `components/dashboard/umpan-tulis.ts` | `Toaster` dipasang di `app/layout.tsx` |
| form submit dobel, data ganda | `13-ui-komponen.md` | komponen `form-*`/`dialog-*` | tombol harus disable saat proses; server tetap perlu guard (peta 02) |
| komponen tombol/dialog/select/combobox | `13-ui-komponen.md` | `components/ui/` | daftar export di tabel primitif |
| tabel panjang, paginasi, sorting UI | `13-ui-komponen.md` | `components/dashboard/footer-paginasi.tsx` + halaman terkait | sorting server-side untuk `order`/`stok` (peta 03/05) |
| warna/ikon/animasi | `13-ui-komponen.md` | `app/globals.css`, `lucide-react`, `tw-animate-css` | jangan hardcode warna; pakai token |
| deploy gagal / "wrangler deploy error" / worker tidak terupdate / nama worker atau database | `01-runtime-deploy.md` | `wrangler.jsonc` lalu `package.json` (script `deploy`) | name `simple-wms-telegram`, main `./worker/index.ts`, DB `simple-wms`; jalur `opennextjs-cloudflare build && deploy` |
| 500 di SEMUA route saat `next dev` / "Cannot use 'import.meta' outside a module" / hydration/hot reload rusak | `01-runtime-deploy.md` | commit `09668e9` (`git show 09668e9`) + `next.config.mjs` | modul CJS di grafik klien ESM; produksi tidak kelihatan karena HMR tidak disuntik |
| bot Telegram tidak balas / webhook tidak masuk / setWebhook / 401 unauthorized webhook | `01-runtime-deploy.md` | `worker/index.ts` (`/api/telegram/webhook`) → `worker/bot.ts:tanganiWebhook` | cek `TELEGRAM_WEBHOOK_SECRET` (header `x-telegram-bot-api-secret-token`) vs `setWebhook secret_token` |
| login gagal / "Login gagal." / akun terkunci 15 menit / lupa password kode tidak terkirim | `01-runtime-deploy.md` | `worker/api.ts:tanganiApi` → `worker/auth.ts:ambilPenggunaLogin/loginTerkunci/verifikasiPassword` | pesan sengaja seragam; `minta-kode` balas 503 bila `TELEGRAM_BOT_TOKEN` belum diset |
| cookie sesi hilang / "Belum login" padahal sudah login / logout tidak jalan | `01-runtime-deploy.md` | `worker/auth.ts` (`NAMA_COOKIE_SESI`, `atributCookieSesi`, `verifikasiSesi`) | cookie `swt_sesi`, TTL 12 jam, `Secure` hanya bila https |
| cron tidak jalan / notifikasi menumpuk di antrean / drain tidak mengirim | `01-runtime-deploy.md` | `worker/notify.ts:drainTick/drainQueue` + `wrangler.jsonc` (`triggers.crons`) | limit 25 per tick, retry maks 5, konkurensi 5; cron `*/15` |
| laporan stok harian tidak masuk / jam laporan salah | `01-runtime-deploy.md` | `worker/notify.ts:LAPORAN_CRON` + `bangunLaporanHarian` | 07:05 WIB; cek juga `wrangler tail` (docs/laporan-progres.md:37) |
| sinkron Kledo terjadwal diam / "AI_KEY_ENCRYPTION_KEY belum diset" | `01-runtime-deploy.md` | `worker/notify.ts:sinkronKledoSore` → `lib/kledo/sinkron` | cron `0 9 * * *` (16:00 WIB); kredensial dari D1 terenkripsi, bukan binding |
| env/binding kosong di produksi / "DB undefined" / vars tidak terbaca | `01-runtime-deploy.md` | `cloudflare-env.d.ts` + `lib/d1/db.ts:getDb/getEnvAi` | D1 harus lewat `getCloudflareContext()`; vars bisa lewat `process.env` (disuntik OpenNext) |
| route `/api/...` balas 404 / route Next ketiban Worker | `01-runtime-deploy.md` | `worker/api.ts` (akhir `tanganiApi`) | Worker hanya klaim 8 rute di atas; sisanya `return null` → OpenNext |
| origin ditolak 403 / CSRF / trailing slash di allowed origins | `01-runtime-deploy.md` | `lib/d1/route.ts:tolakOriginD1` + var `DASHBOARD_ALLOWED_ORIGINS` | tanpa trailing slash; wildcard preview `*.bagus-deva-nov-p.workers.dev` |
| error "firebase-admin" / jose / bundle Worker kebesaran / build OpenNext aneh | `01-runtime-deploy.md` | `next.config.mjs` (`serverExternalPackages`) + `open-next.config.ts` | config OpenNext sengaja kosong (tanpa incremental cache/R2/queue) |
| data dev hilang / tabel "no such table" saat lokal | `01-runtime-deploy.md` | `migrations/*.sql` + `wrangler d1 execute --local` | tidak ada npm script migrasi; D1 lokal ada di `.wrangler/` |
| e2e gagal / butuh jalankan satu spec / mock vs real | `01-runtime-deploy.md` | `playwright.config.ts` + `scripts/e2e-build.mjs` + `NEXT_PUBLIC_DASHBOARD_DATA` | `npm run e2e:build` dulu (mock + `NEXT_PUBLIC_ALLOW_MOCK`), baru `npx playwright test` |
| CI merah / test apa yang dijalankan di GitHub | `01-runtime-deploy.md` | `.github/workflows/ci.yml` (berkas lokal untracked) + `scripts/jalankan-tes-worker.mjs` | `npm ci && npm test`; runner TS lewat `npm run test:worker` |
| stok tidak sinkron, qty beda antar gudang, stok online salah | `02-database.md` | `lib/d1/stok.ts` + `migrations/0002_fase1_skema.sql` (`stock_by_bin`) | cek `bacaQty`, `tulisQty`; `ONLINE` = baris `stock_by_bin`, bukan kolom `products` |
| stok berubah tapi riwayat/kartu stok kosong | `02-database.md` | `lib/d1/ledger.ts` + `lib/d1/stok.ts` | tulis ledger wajib di batch yang sama; `listMovements`/`kartuStok` hanya baca |
| mutasi stok dobel, klik dua kali, "duplikat" | `02-database.md` | `lib/d1/guard.ts` + route `app/api/stok/mutasi/route.ts` | guard 10 detik best-effort; cek juga `ref_client_id` |
| opname tidak bisa disetujui, selisih aneh, stok beku | `02-database.md` | `lib/d1/opname.ts` + `stock_counts`/`count_lines` | status `menunggu_approval`, `freeze`, `setujuiOpname` |
| transfer/permintaan antar gudang macet, stok tujuan tidak naik | `02-database.md` | `lib/d1/transfer.ts` + `app/api/permintaan-gudang/route.ts` | status per tujuan (`status`, `status_kirim`), `transfer_destinations` |
| permintaan harian tidak muncul, qty permintaan salah | `02-database.md` | `lib/d1/permintaan.ts` + `daily_request_items` | identitas item = `sku`+`variasi`+`buffer`+`status` |
| login gagal, sesi kedaluwarsa, user ter-logout | `02-database.md` | `lib/d1/auth.ts` + `worker/auth.ts` + `sessions` | cookie `swt_sesi`, token hash, `revoked_at`, `users.active` |
| akses ditolak padahal admin, role tidak dikenal | `02-database.md` | `lib/d1/auth.ts` + `lib/d1/peran.ts` + `lib/d1/admin.ts` | role DB (`owner/high_admin/admin/designer/guest`), scope `user_warehouses` |
| migrasi gagal, "table already exists", D1 error | `02-database.md` | `migrations/` (file terakhir) + `wrangler.jsonc` | jangan edit migrasi lama; `0033` harus sendirian; cek urutan nomor |
| tabel/kolom tidak ditemukan setelah deploy | `02-database.md` | `migrations/` + `docs/map/02-database.md` | bandingkan dengan 78 tabel aktif; migrasi mungkin belum `--remote` |
| laba salah hitung, fee dobel, snapshot tidak cocok | `02-database.md` | `lib/d1/labaPreset.ts`, `lib/d1/seedLaba.ts`, `fee_rules`/`laba_snapshot` | `mp_fee_presets`/`laba_harian` legacy; registry `laba_order` anti-dobel No. pesanan |
| data order hilang/tertimpa saat impor | `02-database.md` | `app/api/order/route.ts` + `lib/d1/order.ts` + `import_batches` | `import_files` hash, `import_errors`, mode bertahap |
| picklist/cetak order dobel atau resi salah | `02-database.md` | `lib/d1/picklistEkspor.ts`, `order_cetak`, `/api/printing` | `picklist_ekspor.jumlah_cetak`, upsert `order_cetak` |
| bot tidak menyimpan percakapan/notifikasi tidak terkirim | `02-database.md` | `worker/bot.ts` + `worker/notify.ts` + `bot_sessions`/`notify_queue` | queue `sent_at`/`attempts`; cron `drainQueue` |
| kredensial AI/Kledo tidak terbaca, enkripsi gagal | `02-database.md` | `lib/d1/aiKredensial.ts`, `lib/d1/kledoKredensial.ts`, `getKunciEnkripsi` | ciphertext/iv/tag, `AI_KEY_ENCRYPTION_KEY` |
| error "Cannot perform I/O on behalf of a different request" | `02-database.md` | `lib/d1/db.ts` | jangan simpan `db` lintas request; `getDb()` harus per request |
| kode lama Firestore dipakai di Worker | `02-database.md` | `lib/models/*.js` vs `lib/d1/*` | Worker hanya `lib/d1`; legacy Firestore untuk bot Node/sheets |
| "npm test gagal", "unit test merah", "gate CI merah" | `14-test-tooling.md` | `package.json` (`scripts.test`) + `test/<area yang berubah>.test.js` | CI = `npm test` saja; unit TS bukan bagian gate ini |
| "test:worker gagal", "esbuild bundle error", "Cannot find module initData" | `14-test-tooling.md` | `scripts/jalankan-tes-worker.mjs` → `test/alias-*.mjs` | alias salah/stub db belum dipasang (`__TMA_TEST_DB__`) |
| "e2e gagal padahal build oke", "playwright tidak jalan", "port 3100" | `14-test-tooling.md` | `playwright.config.ts` (`webServer`) + `scripts/e2e-build.mjs` | butuh build mock; cek `NEXT_PUBLIC_ALLOW_MOCK` |
| "role=?role=owner tidak ngaruh", "login mock gagal", "guest bisa buka halaman" | `14-test-tooling.md` | `e2e/izin.spec.ts`, `test/mockParitas.test.js` | bypass role hanya di build mock; produksi R11 |
| "guard urutan salah", "guest ditolak setelah validasi body", "origin 403" | `14-test-tooling.md` | `test/guardD1.test.js`, `lib/d1/route.ts` | kontrak: origin→sesi→rate-limit→role→validasi→model |
| "sesi kedaluwarsa", "cookie tidak terbaca", "token HMAC salah", "initData tidak valid" | `14-test-tooling.md` | `test/sesi.test.js`, `test/initData.test.js` | `DASHBOARD_SESSION_SECRET` wajib; HMAC initData |
| "stok tidak sinkron", "sync stok dobel", "pushed_items", "kolom A nomor" | `14-test-tooling.md` | `test/syncStok*.test.js`, `test/sheetsClientKolom.test.js`, `scripts/verify-backfill.mjs` | mock Sheets stateful; idempotensi 2 lapis (marker + id deterministik) |
| "resi kepotong", "cetak resi", "PDF halaman salah", "watermark" | `14-test-tooling.md` | `lib/printing/watermark.test.ts`, `e2e/printing-sinkronisasi.spec.ts`, `e2e/preview-picklist.spec.ts` | pratinjau harus menghitung semua halaman |
| "picklist kosong", "preview picklist error", "tombol export hilang" | `14-test-tooling.md` | `e2e/preview-picklist.spec.ts`, `e2e/order-picklist.spec.ts`, `lib/d1/picklist.test.ts` | kontrak respons dibekukan via `page.route` |
| "laba salah hitung", "HPP tidak masuk", "perhitungan Shopee beda" | `14-test-tooling.md` | `lib/laba/laba.test.ts`, `lib/d1/labaShopee.test.ts`, `scripts/uji-laba-nyata.mjs` | skrip banding butuh file dump/xlsx lokal |
| "produk tidak muncul di stok", "filter stok salah", "paginasi lambat" | `14-test-tooling.md` | `test/bacaStokOnlineFilter.test.js`, `test/stokPaginasi.test.js`, `e2e/stok.spec.ts` | regresi "produk Kledo hilang" & DOM 1174 baris |
| "notifikasi tidak terkirim", "penerima kosong", "teks status salah" | `14-test-tooling.md` | `test/bentukHasilModel.test.js`, `test/notifikasiTeks.test.js`, `test/notifikasiError.test.js` | nama/level field hasil model & fallback teks |
| "action_type jadi object", "kodeBarang vs kode_barang", "qty tanda salah" | `14-test-tooling.md` | `test/handleScreenshotPickingList.test.js`, `test/keywordActionType.test.js`, `scripts/backfillQtyStockMovements.js` | qty = delta bertanda; action_type harus string |
| "aiKey kosong", "provider fallback tidak jalan", "chain provider salah" | `14-test-tooling.md` | `test/ai/*.test.js`, `lib/ai/provider.test.ts`, `test/providerAiParitas.test.js` | jalankan eksplisit `node --test test/ai/*.test.js` |
| "migrasi D1 gagal", "skema kurang index", "seed laba" | `14-test-tooling.md` | `test/guardD1.test.js` + `migrations/*.sql`, `scripts/muat-seed-laba.mjs` | cek index di `0002_fase1_skema.sql`; seed pakai wrangler |
| "cek data produksi", "verifikasi data nyata", "backfill" | `14-test-tooling.md` | `scripts/lib/firebaseCli.mjs`, `scripts/verify-backfill.mjs`, `scripts/backup-stock-v5.mjs` | backup dulu; dry-run dulu; jangan `--apply` tanpa baca |
| "laporan test basi", "angka test beda", "docs/test-report" | `14-test-tooling.md` | `docs/learnings.md` + `docs/test-report*.md` | laporan historis; percaya hasil runtime, jangan timpa |
| "spec mana yang menjaga halaman X", "e2e apa untuk fitur ini" | `14-test-tooling.md` | tabel spec e2e di atas + `docs/audit-e2e.md` | audit = alasan pembagian project & usulan pangkas |

## Dokumen lama / menyesatkan (jangan jadi acuan)
- `README.md` (arsitektur Vercel+Firestore; sudah diberi banner), `docs/architecture.md`, `docs/architecture-v5*.md` (snapshot historis),
  `docs/arsip-v4/**`, `docs/_archive/**`, `docs/dashboard-*.md` (era Vercel), `docs/test-report*.md` (laporan historis), `docs/audit-e2e.md` (usulan, belum tentu diterapkan).
- `api/webhook.js`, `lib/router/*`, `lib/handlers/*`, `lib/gemini/*`, `lib/models/*`, `vercel.json`, `firebase.json` = jalur lama; masih dipanggil hanya di beberapa tempat (lihat peta 11/12).

## Status verifikasi
- Setiap path dan simbol di peta area diperiksa terhadap isi repo oleh `node scripts/peta-verifikasi.mjs`; yang tidak terbukti ditulis di bagian “Belum diverifikasi” masing-masing peta.
- Peta ini statis. Kalau kode berubah dan peta tidak, peta yang salah: percayai kode, lalu perbarui peta.
