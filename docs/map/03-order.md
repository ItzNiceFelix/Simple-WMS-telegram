# 03 — Order Shopee, Picklist & Advance

## Ringkasan area
- Siklus order keluar Shopee: impor XLSX (`orders` + `Advance Fulfilment`) -> normalisasi/klasifikasi -> simpan D1 -> transisi fulfillment -> picklist PDF -> tanda cetak picklist/resi.
- Titik masuk: `POST /api/order` (impor bertahap & legacy), `GET /api/order` (daftar + picklist PDF), `POST /api/advance` (booking pasokan), `/api/printing` (status resi tercetak).
- Impor generik 7 kolom (`NoPesanan*`, `Marketplace*`, `Tanggal*`, `SKU*`, `Qty*`, `HargaSatuan*`, `Buyer`) memakai jalur `preview`/`konfirmasi`, bukan exporter Shopee.
- BUKAN area ini: laba/omzet/fee (`lib/d1/laba*.ts`, `/laba`), master & mutasi stok (`lib/d1/stok*.ts`), katalog produk (`lib/d1/produk.ts`), komponen UI bersama di `components/dashboard/*`.
- `app/api/excel` bukan impor order — itu impor/ekspor PRODUK (`import_batches.tipe='produk'`). `app/draft` bukan order Shopee — itu konfirmasi draft picking Telegram (`pending_confirmation`).

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `lib/d1/order.ts` | CRUD/impor generik + daftar order, paginasi, laba & status cetak per halaman | `imporPesanan`, `ambilOrder`, `ambilOrderBanyak`, `listOrder`, `listOrderBerSku`, `petaCetak`, `labaPerOrder`, `urutOrder`, `KOLOM_URUT_ORDER`, `TIEBREAKER_ORDER`; re-export `transisiFulfill`/`transisiFulfillBatch` |
| `lib/d1/orderImportShopee.ts` | Normalisasi 1 workbook export Shopee; pisahkan order vs advance | `normalisasiSheetShopee`, `normalisasiStatus`, tipe `GabunganOrder`, `ShopeeBooking`, `BarisBelumSku`, `HasilImportShopee` |
| `lib/d1/orderKlasifikasi.ts` | Putusan baru/update/skip/mundur + temuan resi gabungan (read-only) | `aksiOrder`, `klasifikasikanImport`, `HasilKlasifikasi` |
| `lib/d1/orderTransisi.ts` | Mesin status fulfillment tunggal/batch atomik | `PETA_TRANSISI`, `transisiFulfill`, `transisiFulfillBatch`, `KeFulfill` |
| `lib/d1/importFingerprint.ts` | Anti-dobel berkas impor | `hitungFingerprint`, `cekFileSudahAda`, `catatImportFile` |
| `lib/d1/advanceBelumSku.ts` | Booking Advance, tebak/tag SKU, banding nama | `simpanBooking`, `listBooking`, `ambilBooking`, `kirimKeShopee`, `batalkanBooking`, `tebakSku`, `normalisasiKata`, `skorMirip`, `tandaiBelumMp`, `listBelumMp`, `hapusBelumMp`, `compareNama` |
| `lib/d1/advancePdf.ts` | PDF picklist Advance A4 (1 baris = 1 SN) | `bangunPdfAdvance`, `BarisAdvancePick` |
| `lib/d1/picklist.ts` | Agregat item untuk picklist; urutan allowlist | `buatPicklist`, `buatPicklistPaket`, `urutkanBaris`, `KUNCI_URUT_PICKLIST`, `PaketPicklist` |
| `lib/d1/picklistPdf.ts` | PDF mode `pisah` (agregat per SKU) | `bangunPdfPicklist` |
| `lib/d1/picklistPaketPdf.ts` | PDF mode `per_paket` dan `gabung` | `bangunPdfPicklistPaket`, `BarisPaket` |
| `lib/d1/picklistGabungPdf.ts` | PDF mode `gabung-order` (order + advance) | `gabungPerSku`, `urutkanBarisGabung`, `bangunPdfPicklistGabung`, `BarisPickGabung` |
| `lib/d1/picklistEkspor.ts` | Jejak picklist tercetak per (order, mode) | `MODE_EKSPOR`, `catatEksporPicklist`, `petaEkspor` |
| `lib/d1/resiGrup.ts` | Peta 1 resi -> N order (Pesanan Gabungan) | `hitungResiGrup`, `isiResiGrup`, `ambilResiGrup` |
| `lib/d1/shopeePeta.ts` | Baca/tulis peta produk Shopee & performa (analisa) | `daftarPertanyaanBelum`, `daftarPertanyaanSemua`, `simpanPertanyaan`, `simpanPetaProduk`, `jawabPertanyaan`, `daftarSkuMaster`, `semuaSkuMaster`, `petaSkuDariKodeProduk`, `simpanPerforma` |
| `lib/d1/shopeePetaImpor.ts` | Impor `parentskudetail*.xlsx` (Performa Produk) | `imporPerforma` |
| `app/api/order/route.ts` | Semua endpoint order: daftar, transisi, impor 3 jalur, picklist PDF/pratinjau, hapus | `GET`, `POST`; internal `susunPernyataanOrder`, `jalankanPernyataan`, `pakaiPerPaket`, `ambilBookingTerpilih` |
| `app/api/advance/route.ts` | Daftar/kirim/batal booking + PDF advance | `GET`, `POST` |
| `app/api/excel/route.ts` | Impor/ekspor produk (bukan order) | `GET`, `POST` |
| `app/order/page.tsx` | UI daftar order, filter/paginasi, transisi massal, mode & pratinjau picklist, hapus | komponen `HalamanOrder` (client); konstanta `MODE_PICKLIST`, `LABEL_EKSPOR` |
| `app/advance/page.tsx` | UI booking advance: centang, kirim/batal, cetak picklist | `HalamanAdvance` |
| `app/printing/page.tsx` | Guard halaman cetak resi | merender `components/dashboard/printing-workspace.tsx` (PDF dibuat di browser) |
| `app/draft/page.tsx` | Konfirmasi/batal draft picking Telegram (bukan order Shopee) | `HalamanDraft`, `gerbangAksi` |
| `components/dashboard/dialog-import-order.tsx` | Dialog impor Shopee bertahap (pemanggil `preview-shopee`/`impor-potong`) | `DialogImportOrder` |
| `docs/refactor-laba/kolom-order-shopee.md` | Bukti nama/arti kolom export Shopee (acuan normalisasi) | — |
| `docs/superpowers/plans/2026-10-13-order-toship-advance.md` | Rancangan impor toship + advance (F1-F18, fase A-G) | — |
| `docs/superpowers/specs/2026-10-09-order-shopee-picklist-design.md` | Spesifikasi awal impor/picklist (sebagian sudah diganti kode) | — |

Commit terakhir per modul inti: `lib/d1/order.ts` b29d844; `orderImportShopee.ts` fad46e0; `orderKlasifikasi.ts` 9ad68db; `orderTransisi.ts` d377d16; `importFingerprint.ts` 38d90b1; `advancePdf.ts` 9e9a92e; `advanceBelumSku.ts` fad46e0; `picklist.ts` cef5f4b; `picklistGabungPdf.ts` cef5f4b; `picklistPdf.ts` 4473e3b; `picklistPaketPdf.ts` 9ad68db; `picklistEkspor.ts` 4c001bb; `resiGrup.ts` 38d90b1; `shopeePeta.ts`/`shopeePetaImpor.ts` 5becf5b; `app/api/order/route.ts` b29d844; `app/api/excel/route.ts` 302e10e; `app/api/advance/route.ts` d377d16; `app/order/page.tsx` b29d844; `app/advance/page.tsx` d377d16; `app/draft/page.tsx` 4d33f54.

## Alur data
1. **Impor Shopee — preview.** `DialogImportOrder` membaca XLSX, wajib sheet `orders`, opsional `Advance Fulfilment`, lalu `POST /api/order {aksi:"preview-shopee", ordersRows, advanceRows, file}`. `normalisasiSheetShopee` mengelompokkan per `No. Pesanan`, memakai SKU `Nomor Referensi SKU` lalu fallback `SKU Induk` (uppercase), qty = `max(1, Jumlah - Returned quantity)`, status dinormalkan `normalisasiStatus`.
2. **Saring status.** Hanya `perlu_dikirim|sedang_dikirim|telah_dikirim|selesai` yang masuk `orders`. `statusAwal` = `pending` hanya untuk `perlu_dikirim`, lainnya `kirim`. Baris tanpa SKU / SKU tak ada master TIDAK membuang order: masuk `belumSku` (dikelompokkan per nama_shopee+variasi) dan item tetap dibuat saat commit (SKU penanda atau SKU manual).
3. **Anti-dobel.** `hitungFingerprint` = SHA-256 atas baris ternormalisasi-urut + nama berkas; `cekFileSudahAda("orders_toship", hash)` menolak 409 bila `import_files.batch_id` sudah terisi. Pencatatan dilakukan di akhir impor (`selesai-impor`/`konfirmasi-shopee`), jadi berkas yang gagal di tengah boleh diunggah ulang.
4. **Klasifikasi.** `klasifikasikanImport` menghitung `baru/update/skip/mundur` (aturan T3), `gandaDalamFile`, `resiMultiOrder`, `kriteriaGabungan` (jasa/layanan beda, COD, pre-order), serta `advanceBaru/advanceSkip`. Ini HANYA untuk peringatan/UI; penulisan tetap upsert semua order yang dikirim klien.
5. **Commit bertahap (dipakai UI sekarang).** `mulai-impor` membuat/melanjutkan `import_batches` (`mode_impor='bertahap'`, resume per nama berkas). `impor-potong` (maks 200 order, `presetId` wajib, potongan harus berurutan, nomor lama idempoten) memanggil `susunPernyataanOrder`: prefetch HPP via `ambilProdukBanyak`, upsert `orders` (`INSERT ... ON CONFLICT`), hapus lalu tulis ulang `order_items`, sisipkan produk penanda untuk baris `perlu_sku`, lalu `jalankanPernyataan` (batch 50 + fallback per pernyataan, batas 30). `selesai-impor` menyimpan booking (`simpanBooking`), membangun `resi_grup` (`isiResiGrup`), mencatat fingerprint, menutup batch.
6. **Commit legacy.** `preview`/`konfirmasi` (7 kolom generik) memakai `imporPesanan` (grup per order, `hpp_snapshot` dibekukan, `INSERT OR REPLACE` item). `konfirmasi-shopee` membaca `payload_json` batch lama dan mensyaratkan `payload.hash`; kedua jalur ini dipertahankan untuk batch lama.
7. **Transisi fulfillment.** `PETA_TRANSISI`: `pending -> pack|batal`, `pack -> kirim|batal`, `kirim -> selesai|batal`, `selesai`/`batal` terminal. `transisiFulfillBatch` melakukan preflight SEMUA target dulu (404/409), lalu satu `db.batch` update status. Stok tidak disentuh (dipotong Kledo).
8. **Picklist.** `GET /api/order?aksi=picklist-pdf&targets=[...]&mode=&urut=&arah=&inline=&booking=`. Tanpa `mode`: `pakaiPerPaket` memilih `per_paket` bila ada `resi_grup.jumlah_order > 1`, else `pisah`. Mode lain: `potongOnlineUntukOrder` memotong stok gudang ONLINE sekali per order (`orders.stok_dikurangi`), lalu `buatPicklistPaket` (per_paket/gabung) atau `buatPicklist` (pisah). `gabung-order` mengambil booking `menunggu` (atau SN terpilih), menamai dari master + lokasi gudang, `gabungPerSku`, lalu `bangunPdfPicklistGabung`; cabang ini TIDAK memotong stok.
9. **Pemanggil PDF.** `pisah` -> `bangunPdfPicklist`; `per_paket`/`gabung` -> `bangunPdfPicklistPaket`; `gabung-order` -> `bangunPdfPicklistGabung`; Advance murni -> `/api/advance?aksi=picklist-pdf` -> `bangunPdfAdvance`. Setelah PDF jadi, `catatEksporPicklist` meng-upsert `picklist_ekspor`.
10. **Urutan baris.** `pisah` default = SKU A-Z (`localeCompare`); `per_paket`/`gabung` default = urutan target/paket apa adanya; `gabung-order` default = lokasi lalu nama (`urutkanBarisGabung`). `urut=sku|nama|lokasi` mengurutkan baris DAN paket (`urutkanPaket`); `default` di `urutkanBaris` berarti "jangan sentuh".
11. **Pratinjau.** `GET ?aksi=preview-picklist` memakai fungsi yang sama dengan PDF, memberi nomor setelah urutan final; mode `gabung-order` memakai `gabungPerSku` yang sama. `mode=review` di cabang `picklist-pdf` mengembalikan JSON `ringkasReview` (tanpa pemanggil UI saat ini).
12. **Cetak resi.** `components/dashboard/printing-workspace.tsx` membuat PDF ber-watermark di browser; `GET /api/printing` mencocokkan nomor, `POST /api/printing` meng-upsert `order_cetak` hanya untuk order yang dikenal `preset_id` tersebut. `petaCetak` menampilkan waktu cetak terakhir di `/order`.

## Endpoint & tabel terkait
- `GET /api/order` -> `app/api/order/route.ts` `GET`: tanpa `aksi` balas header template; `aksi=daftar` (`mp,status,sku,dari,sampai,tanggal,presetId,urut,arah,halaman,ukuran`), `aksi=picklist-pdf`, `aksi=preview-picklist`.
- `POST /api/order` -> `POST`: `transisi`, `transisi-batch` (maks 200), `preview`, `konfirmasi`, `preview-shopee`, `mulai-impor`, `impor-potong` (maks 200, `presetId` wajib), `selesai-impor`, `konfirmasi-shopee` (`presetId` wajib), `hapus` (maks 200).
- `GET /api/advance` -> `app/api/advance/route.ts` `GET`: `aksi=daftar|detail|picklist-pdf`.
- `POST /api/advance` -> `POST`: `kirim`, `batal`, `kirim-massal`, `batal-massal` (maks 200).
- `GET/POST /api/excel` -> impor/ekspor produk; guard `bolehBukaHalaman(role,"/stok")` untuk GET, `is_admin` untuk POST.
- `GET/POST /api/preset` + `app/api/preset/[id]/aturan|program` -> `lib/d1/preset.ts`; GET `is_admin`, POST owner-only.
- `GET/POST /api/printing` -> baca/upsert `order_cetak`; `is_admin`.
- Tabel: `orders` (PK marketplace+no_pesanan; status_fulfill, no_resi, jasa_kirim, tipe_layanan, cod, preorder, status_mp, asal_import, batch_import, preset_id, stok_dikurangi) — migrasi 0006, 0009, 0019, 0040; indeks 0039.
- `order_items` (PK marketplace+no_pesanan+sku+variasi; qty, harga_satuan, hpp_snapshot, subtotal, nama_shopee, perlu_sku, sku_asal; FK `products`) — 0006, 0019 (PK+variasi), 0030.
- `order_fees` — 0006, 0012; `import_batches`/`import_errors` — 0005, 0034; `import_files` — 0019.
- `advance_bookings` + `resi_grup` — 0019; `sku_belum_mp` — 0019 + 0030 (kolom sumber/sku_asal/qty_total).
- `picklist_ekspor` — 0032; `order_cetak` — 0042.
- `peta_putusan`, `shopee_produk`, `performa_produk` — 0027, 0041.

## Test terkait
- Unit colocated: `lib/d1/order.test.ts`, `orderImportShopee.test.ts`, `orderKlasifikasi.test.ts`, `importFingerprint.test.ts`, `picklist.test.ts`, `picklistEkspor.test.ts`, `picklistGabungPdf.test.ts`, `picklistPaket.test.ts`, `resiGrup.test.ts`, `advanceBelumSku.test.ts`, `shopeePeta*.test.ts`.
- Route: `app/api/order/route.test.ts` (butuh alias `@/lib/d1/route=./test/alias-route-order.mjs`; lihat `scripts/jalankan-tes-worker.mjs`).
- CJS cermin UI: `test/orderPaginasiSort.test.js` (`node --test test/orderPaginasiSort.test.js`).
- E2E: `e2e/order-picklist.spec.ts`, `e2e/preview-picklist.spec.ts`, `e2e/advance-pilih.spec.ts`, `e2e/excel.spec.ts`, `e2e/printing-sinkronisasi.spec.ts`, `e2e/order-laba.spec.ts`; jalankan satu: `npx playwright test e2e/order-picklist.spec.ts --project=desktop`.
- Satu unit test: bundle dulu `npx esbuild lib/d1/picklist.test.ts --bundle --platform=node --format=esm --outfile=.tmp-t.mjs --define:__dirname="'.'"` lalu `node --test .tmp-t.mjs`; semua unit: `npm run test:worker`.

## Gotcha / konvensi
- Guard seragam: `sesiRoute` (cek origin + rate limit per user; GET 60/menit, POST 20/menit) lalu `user.is_admin`; `preset` menulis khusus `is_owner`. `ButuhAkses` hanya UI, bukan pengaman.
- `presetId` WAJIB di `impor-potong` dan `konfirmasi-shopee`. Tanpa itu order masuk ke toko yang salah; `orders.preset_id` sengaja NULL untuk data lama.
- Klasifikasi (`baru/update/skip/mundur`) tidak memfilter penulisan. Yang menentukan status saat upsert adalah `aturStatusFulfill`: tanpa `perbaruiStatus`, hanya order `pending` yang mengikuti status berkas; dengan centang, semua kecuali `batal` mengikuti berkas.
- Reimport MENGHAPUS seluruh `order_items` order itu lalu menulis ulang: koreksi manual item hilang. `imporPesanan` generik memakai `INSERT OR REPLACE` dan tidak menyimpan variasi.
- Baris `perlu_sku` memakai SKU sintetis (`skuPenandaPerluSku`) karena FK ke `products`; produk penanda harus disisipkan lebih dulu. Picklist memakai LEFT JOIN agar baris bermasalah tidak raib.
- Anggaran Worker Free ~50 kueri/invokasi: potongan impor 200 order, batch 50, prefetch `ambilProdukBanyak`, chunk 90 untuk `IN`, fallback per pernyataan dibatasi 30.
- Dua kebenaran urutan: `urutkanBaris` (`default` = jangan urutkan) vs `urutkanBarisGabung` (`default` = lokasi->nama). Jangan diseragamkan; cetak ulang lama harus identik.
- Stok: transisi & advance tidak pernah memotong stok (Kledo). Hanya `picklist-pdf` non-`gabung-order` memotong stok gudang ONLINE sekali; kekurangan dilaporkan lewat header `x-kurang-online`. `gabung-order` melewati pemotongan.
- `mode` kosong ditentukan `resi_grup`; order tanpa resi menjadi paket sendiri (`NO-RESI:<no>`), bukan digabung.
- `targets`/`booking` adalah JSON array; nilai `urut`/`arah` tak dikenal jatuh ke default, bukan 400. `inline=1` membuat PDF tampil di tab, bukan unduhan.
- Filter tanggal memakai epoch tengah malam UTC (`tanggalKeEpoch`), bukan WIB; UI memakai WIB. `sampai` ditambah 86399 detik.
- Output `preview-shopee` tidak menyimpan payload (klien memegang baris); `konfirmasi-shopee` menolak batch lama tanpa `hash` di payload.
- Hapus order menghapus header+item+fee, tetapi tidak `picklist_ekspor`, `order_cetak`, `advance_bookings`, `resi_grup`.
- `ambilBookingTerpilih` memverifikasi SN hanya dalam jendela 500 booking terbaru; antrean lebih besar bisa salah "tidak ditemukan" (fail closed, lihat komentar di route).

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, termasuk sinonim/typo umum) | file pertama yang dibuka | catatan |
|---|---|---|
| "impor Shopee gagal", "file sudah pernah diimpor", "dobel impor", "hash beda" | `app/api/order/route.ts` (`preview-shopee`, `selesai-impor`) + `lib/d1/importFingerprint.ts` | fingerprint atas baris mentah + nama file; cek `import_files`. |
| "SKU tidak ada di master", "perlu SKU", "belum di MP", "barang raib dari picklist", "sku asal" | `lib/d1/orderImportShopee.ts` + `advanceBelumSku.ts` + `susunPernyataanOrder` | jalur `belumSku`, `skuManual`, `tandaiBelumMp`, `skuPenandaPerluSku`. |
| "status order tidak berubah setelah impor", "status mundur", "beda dengan Shopee", "batal hidup lagi" | `lib/d1/orderKlasifikasi.ts` + `aturStatusFulfill` di route | `aksiOrder`, `perbaruiStatus`, `mundur` (F10), `batal` final. |
| "tidak bisa ubah status", "transisi ditolak 409", "tombol kirim/pack hilang", "selesai tidak bisa dibatalkan" | `lib/d1/orderTransisi.ts` + `app/order/page.tsx` | `PETA_TRANSISI`, preflight batch atomik, label `pack` = "Disiapkan". |
| "picklist kosong", "urutan picklist tidak sesuai", "cetak ulang beda urutan", "urut nama tidak ngaruh" | `lib/d1/picklist.ts` + `picklistGabungPdf.ts` + route `picklist-pdf` | `default` berbeda antar mode; hanya order `pending` untuk mode `pisah`. |
| "resi gabungan", "satu resi banyak order", "paket kepisah", "default per paket" | `lib/d1/resiGrup.ts` + `buatPicklistPaket` + `pakaiPerPaket` | `resi_grup.jumlah_order`, `no_json`, kriteria gabungan. |
| "stok ONLINE berkurang setelah cetak", "stok minus", "potong dua kali" | `lib/d1/stokOnline.ts` + blok `picklist-pdf` | idempoten via `orders.stok_dikurangi`; `gabung-order` tidak memotong. |
| "PDF picklist kepotong", "kolom tumpang tindih", "halaman kosong", "qty total salah" | `picklistPdf.ts` / `picklistPaketPdf.ts` / `picklistGabungPdf.ts` | `potong()` memotong teks; `perluSku` dipisah ke tabel kedua. |
| "booking advance tidak muncul", "tidak bisa kirim ke Shopee", "booking sudah terkirim" | `lib/d1/advanceBelumSku.ts` + `app/api/advance/route.ts` + `app/advance/page.tsx` | status `menunggu/terkirim/batal/timeout`; qty 1 per SN. |
| "import order besar timeout", "413", "anggaran kueri habis", "potongan ditolak" | route `mulai-impor`/`impor-potong` + `UKURAN_POTONG` | resume per `batchId`; `progressBaris` = jumlah order. |
| "order masuk toko yang salah", "laba campur", "preset kosong" | `app/api/order/route.ts` + `migrations/0040_orders_preset.sql` | `presetId` wajib saat tulis; NULL = data lama. |
| "cetak resi tidak tercatat", "status cetak tidak muncul", "resi asing" | `app/api/printing/route.ts` + `petaCetak` + `printing-workspace.tsx` | hanya nomor yang dikenal `preset_id` yang di-upsert ke `order_cetak`. |
| "draft picking tidak bisa dikonfirmasi", "picking pending" | `app/draft/page.tsx` + `lib/dashboard/data/real.ts` (`listPickingDrafts`) | BUKAN order Shopee; data movement `pending_confirmation`. |
| "impor Excel produk", "template produk", "export stok/hpp" | `app/api/excel/route.ts` | `import_batches.tipe='produk'`; bukan impor order Shopee. |
