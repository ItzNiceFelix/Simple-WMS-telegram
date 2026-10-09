# Inventaris Laba — T0.1 (Fase 0)

Sumber: `grep -rn "laba\|hitungLaba\|porsiSku\|alokasiLabaSku\|FeeJenis\|mp_fee_presets\|rekap" app components lib e2e test` di repo `/sdcard/Download/Simple-WMS-telegram/repo` (HEAD `8ea1855`).
Belum ada perubahan kode — daftar ini acuan Fase 4 (A4/X1) + §6.3 PRD v1.

## A. Mesin laba ganda (sumber duplikasi)

| File | Simbol / baris | Status PRD |
|---|---|---|
| `lib/d1/labaShopee.ts` | `hitungLabaShopee` (L80–212), `ambilHppDb`, `simpanLabaHarian`/`muatLabaHarian`/`listTanggalLaba`, `STATUS_HITUNG` (L55, allowlist `telah/​sedang dikirim+selesai` — **belum** termasuk `Perlu Dikirim`), `angkaShopee`, `tanggalJakarta` | PERTAHANKAN sebagai basis `hitungLabaPreset` (E2); tambah allowlist §5.1 + dasar resmi §4.1 v2 |
| `lib/d1/order.ts` | `hitungLaba` (L18–26, PPh hardcode `*5/1000` L22), `alokasiLabaSku` (L29), `porsiSku` (L42), `RingkasanLaba`/`PorsiSku`/`OrderFee`, `BarisPesanan.fee_*`+`pajak_*` (L61–66), validasi fee (L79–86), fallback preset `mp_fee_presets` (L108–118), `amount` persen (L133) | HAPUS rumus (`hitungLaba`, `alokasiLabaSku`, `porsiSku`) di A4; pertahankan `imporPesanan` (stok), `ambilOrder`, `listOrder`, transisi |
| `lib/d1/orderTransisi.ts` | `transisiFulfill`, `transisiFulfillBatch` (re-export di `order.ts` L140) | PERTAHANKAN (stok/fulfill, bukan laba) |
| `lib/d1/orderImportShopee.ts` | `gabungkanSheetShopee` (dipakai `preview-shopee`) | PERTAHANKAN (jalur stok Shopee, bukan laba) |
| `lib/d1/rekapPdf.ts` + `rekapPdf.test.ts` | `bangunPdfRekap`, `BarisRekapPdf`, `AgregatRekapPdf` (kolom omzet/hpp/biaya/pph/ppn/laba) | HAPUS di A4 (pdf rekap laba order); PDF laba baru milik `/laba` bila perlu |

## B. API

| File | Aksi / baris | Status PRD |
|---|---|---|
| `app/api/laba/route.ts` (83 baris) | `presetsMp` (L24–30, `SELECT basis,nilai FROM mp_fee_presets`), `hitungLabaShopee` (L74), `hitung`/`simpan`/`muat`/`list`, `MAKS_BARIS=10000`, default tanggal `tanggalJakarta()` | UBAH di A3: `presetId` wajib, `laba_snapshot(preset_id,tanggal)`; `presetsMp` pindah ke `/api/preset` |
| `app/api/order/route.ts` (361 baris) | `HEADER_PESANAN` 12 kolom incl `FeeJenis,FeeBasis,FeeNilai,PPh,PPN%` (L25); `FEE_VALID` (L27); `RincianOrder`/`AgregatRekap` laba (L32–33); `hitungRekap` pakai `hitungLaba`+`porsiSku` (L129–148); `GET rekap` (L150–206); `GET pdf` via `bangunPdfRekap`; `POST preset-tambah`/`preset-hapus` (L218–242, tulis `mp_fee_presets`); `validasiBarisPesanan` fee (L52–98); warning campur fee `feePerOrder` (L303–310, = peringatan `fee per order` §6.3 — hapus); `preview`/`konfirmasi` impor; `preview-shopee`/`konfirmasi-shopee`, `transisi`, `transisi-batch` | HAPUS di A4: `preset-tambah`/`preset-hapus`, kolom fee + logika laba `preview`/`rekap`/`pdf`, `hitungRekap`, warning fee. PERTAHANKAN: `preview`/`konfirmasi` (stok), `preview-shopee`/`konfirmasi-shopee`, `transisi`, `transisi-batch` |

## C. UI

| File | Elemen | Status PRD |
|---|---|---|
| `app/laba/page.tsx` | `DialogLabaShopee`, fetch `/api/laba` list/muat, `kartu-agregat-laba`, `tolak-laba`, `rincian-sku-laba`, `filter-tanggal-laba`, `hitung-laba`, `muat-ulang-laba` | UBAH di U2/U3/U4: kartu upload per preset + tag, filter preset, tanggal WIB |
| `components/dashboard/dialog-laba-shopee.tsx` | baca sheet `orders` via xlsx, `POST /api/laba hitung/simpan`, `file-laba-shopee`, `preview-laba-shopee`, `hitung-laba-shopee`, `tanggal-simpan-laba`, `simpan-laba-shopee` | UBAH di U2: pilih preset per kartu + konfirmasi `Simpan ke preset "<nama>" tanggal <tgl>?` |
| `app/order/page.tsx` | `RincianOrder` (+laba/margin/omzet L56), fetch `aksi=rekap` (L156), kolom `formatRupiah(o.laba)` (L364), tombol transisi | HAPUS kolom laba di A4/U (cari `o.laba`, `o.omzet`); pertahankan tabel stok + transisi + bulk |
| `components/dashboard/biaya-mp.tsx` (267 baris) | `BiayaMp`, fetch `/api/order?aksi=preset`, `JENIS_FEE`, tambah/hapus preset per MP | GANTI total di U1 (`preset-toko.tsx` + `editor-preset.tsx`) |
| `components/dashboard/nav-config.ts` | nav `/laba`, `/order` | pertahankan (label tetap) |
| `/stok` (hal. stok/gudang — belum dipetakan detail) | belum ada kolom kategori / badge / filter | TAMBAH di U5 + U-M1/M2 (§6 + §11.1 v2) |

## D. Migrasi / skema

| File | Tabel | Status PRD |
|---|---|---|
| `migrations/0006_fase3_order.sql` | `orders`, `order_items`, `order_fees`, `mp_fee_presets` (+seed contoh admin 4%/service 3%…), `stock_moves` recreate | `mp_fee_presets` dimigrasi ke `fee_rules` (D2/D-R3); `orders/order_items/order_fees` tetap (stok) |
| `migrations/0008_laba_shopee.sql` | `laba_harian(tanggal PK, marketplace, jml_*, omzet/hpp/biaya/laba, tolak_json, file, at, by)` | dimigrasi ke `laba_snapshot` (D2, `preset_id` = Shopee Utama); drop terpisah di X1 |
| `migrations/0010_laba_rincian.sql` | `ALTER laba_harian ADD rincian_json` | ikut migrasi ke `laba_snapshot.rincian_json` |
| `migrations/0012_fee_desimal.sql` | `order_fees.nilai` + `mp_fee_presets.nilai` INTEGER→REAL | nilai desimal dipertahankan di `fee_rules.nilai REAL` |
| Baru (belum ada) | `seller_presets`, `fee_rules`, `laba_snapshot` (0011 v1) + `kategori_tarif`, `tier_admin`, `program_katalog`, `preset_program`, `ads_harian`, `preset_penghitung` + kolom §3 v2 (0012 v2) | buat di D1/D-R1 |

## E. Test / e2e

| File | Isi | Status PRD |
|---|---|---|
| `lib/d1/labaShopee.test.ts` | `hitungLabaShopee`: allowlist `Batal+Belum Bayar+Perlu Dikirim dibuang`, qty bersih, rincian SKU, tolak | UBAH di E2: `Perlu Dikirim` dihitung; tambah Batal/Belum Bayar/retur parsial/pajak configurable |
| `lib/d1/order.test.ts` | `hitungLaba` (omzet-hpp-biaya-pph-ppn, flat fee, desimal 3.5%), `alokasiLabaSku`, `porsiSku`, mock `mp_fee_presets`, `imporPesanan`, `listOrder`, transisi | SESUAIKAN di A4: hapus bagian laba; pertahankan impor/transisi |
| `e2e/order-laba.spec.ts` | mock `api/order?*rekap*` (laba 71000), mock `api/laba muat/list`, assert `hitung-laba`, `kartu-agregat-laba`, `tolak-laba`, `rincian-sku-laba` | SESUAIKAN di U1–U4 + A3/A4 (presetId, kartu per preset) |
| `e2e/order-picklist.spec.ts` | mock rekap laba (80000/40000) untuk picklist bulk | pertahankan picklist; ganti mock laba bila rekap dihapus |
| `lib/d1/rekapPdf.test.ts` | `bangunPdfRekap` %PDF/%%EOF | hapus/arsip bila `rekapPdf.ts` dihapus |

## F. Grep pola §6.3 (wajib bersih di A4)

- `hitungLaba` → `app/api/order/route.ts` (L13, L137), `lib/d1/order.ts` (L18, test L8/L20/L30/L43/L184), `e2e/order-laba.spec.ts` (L7)
- `porsiSku` → `app/api/order/route.ts` (L6, L13, L140), `lib/d1/order.ts` (L42–43), `lib/d1/order.test.ts` (L3, L178–185)
- `alokasiLabaSku` → `lib/d1/order.ts` (L29, L43), `lib/d1/order.test.ts` (L3, L44)
- `FeeJenis/FeeBasis/FeeNilai` → `app/api/order/route.ts` (L25, L71–79 + validasi L52–98), `lib/d1/order.ts` (L79–86), `components/biaya-mp.tsx` (komentar L4/L135)
- `mp_fee_presets` → `app/api/laba/route.ts` (L26), `app/api/order/route.ts` (POST preset-*), `lib/d1/order.ts` (L114), `lib/d1/labaShopee.ts` (komentar L78), `migrations/0006` + `0012`, mock `order.test.ts` (L141–142)
- `rekap` (order) → `app/api/order/route.ts` (`hitungRekap`, GET rekap/pdf), `app/order/page.tsx` (L156), `lib/d1/rekapPdf*`, e2e mocks
- Hardcode tarif (§E3/X-R1: `* 5 / 1000`, `1250`, `0.5`) → `lib/d1/order.ts` L22 (`*5/1000` PPh); `1250`/proses belum ada di kode (hadir hanya di seed/docs) — verifikasi ulang via `grep -rn "1250\|0\.5\|5) / 1000" lib app components` di E3
