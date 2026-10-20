# 06 — Permintaan Harian & Permintaan Antar-Gudang

## Ringkasan area
- Dua alur BERBEDA yang mudah tertukar: permintaan HARIAN (`/permintaan`, tabel `daily_requests`) vs permintaan ANTAR-GUDANG (`/permintaan-gudang`, tabel `transfers` + `transfer_destinations`).
- Antar-gudang v5.1: satu dokumen `transfers` berisi 1–20 tujuan; tiap tujuan punya `status` (penerimaan) dan `status_kirim` (setujui/kirim) SENDIRI. Status dokumen TURUNAN (`hitungStatusDokumen`), `selesai` hanya lewat aksi eksplisit.
- Semua tulis antar-gudang lewat `POST /api/permintaan-gudang` → `lib/d1/transfer.ts`; baca lewat `GET /api/baca?scope=transfer`; PDF lewat `GET|POST /api/permintaan-gudang` dengan `aksi=pdf`.
- Harian: satu dokumen per tanggal (`YYYY-MM-DD` WIB), `draft → diproses → selesai`; identitas item = `sku + variasi + buffer` (+ `status='diminta'`).
- BUKAN area ini: booking Advance/tebak SKU (`lib/d1/advanceBelumSku.ts` — milik order, lihat `03-order.md`), opname (`lib/d1/opname.ts`), master & mutasi stok (`lib/d1/stok.ts`), impor order, komponen umum `components/ui/*`.
- `lib/models/*.js` (`permintaanGudang.js`, `dailyRequests.js`) = era Firestore; hanya acuan paritas + dipakai unit test, TIDAK diimpor route D1.

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `lib/d1/transfer.ts` | Inti transfer antar-gudang D1 (558 baris) | `buatTransfer`, `setujuiTujuan`, `tolakTujuan`, `kirimTujuan`, `terimaTujuan`, `tidakTerimaTujuan`, `tutupTujuan`, `selesaiTransfer`, `batalTransfer`, `tolakDokumen`, `ubahItemTransfer`, `ambilTransfer`, `listTransfer`, `hitungStatusDokumen`, `gabungItems`, `MAKS_TUJUAN=20`, `MAKS_ITEM=200`, `MAKS_ALASAN=200` |
| `lib/d1/permintaan.ts` | Permintaan harian D1 (130 baris) | `ambilDaily`, `tambahItem`, `sesuaikanQty`, `buatForm`, `tandaiDatang`, `selesaikan`, `tanggalHariIni`; tipe `DailyDoc`, `DailyItem`, `ItemMasuk` |
| `lib/d1/permintaanPdf.ts` | Surat permintaan A4 (pdf-lib), fungsi MURNI | `bangunPdfPermintaan`, tipe `DataPermintaanPdf`, `BarisPermintaanPdf` |
| `app/api/permintaan-gudang/route.ts` | Endpoint transfer + PDF (184 baris) | `GET`, `POST`; internal `pdfPermintaan`, `barisPdf`, `headerPdf`, `namaGudangAtauId` |
| `app/api/permintaan/route.ts` | Endpoint permintaan harian (51 baris) | `POST` saja (tanpa `GET`) |
| `app/api/baca/route.ts` | Jalur BACA dashboard | `GET`; `scope=transfer` (baris 244), `scope=daily` (baris 266) |
| `lib/notifikasi/permintaanGudang.js` | Teks + kirim notif bot antar-gudang (fail-safe) | `kirimNotifikasiPermintaan`, `susunTeksBuat`, `susunTeksStatus`, `susunTeksSelesai` |
| `lib/models/permintaanGudang.js` | Model Firestore lama v5.1 (957 baris), acuan aturan | `buatPermintaan`, `setujuiTujuan`, `kirimPermintaan`, `terimaPermintaan`, `tutupTujuanPermintaan`, `selesaiPermintaan`, `hitungStatusDokumen`, `catatNotifikasi`, `STATUS_TUJUAN_FINAL` |
| `lib/dashboard/validasiPermintaanGudangV5.js` | Validator payload v5.1 (CJS murni, TANPA I/O) | `validasiAksiPermintaanGudang`, `validasiTujuan`, `validasiItems`, `validasiBuatPermintaan`, `AKSI_PERMINTAAN_GUDANG_VALID` |
| `app/permintaan-gudang/page.tsx` | UI H12 (2018 baris): buat/filter/daftar, aksi per tujuan | `HalamanPermintaanGudang`, `PermintaanGudang`, `KartuPermintaan`, `BarisTujuan`, `AksiTujuanSederhana`, `DialogBuatPermintaan`, `DialogUbahItem`, `DialogTutupTujuan`, `AKSI_TUJUAN` |
| `app/permintaan/page.tsx` | UI H6 permintaan harian (459 baris) | `HalamanPermintaan`, `Permintaan`, `LABEL_STATUS`; testid `h6-permintaan`, `tombol-*` |
| `components/dashboard/dialog-permintaan-export.tsx` | Dialog ekspor: PDF (server) + JPG (kanvas klien) | `DialogPermintaanExport`; `window.open('/api/permintaan-gudang?aksi=pdf&id=…')` |
| `components/dashboard/dialog-ubah-jumlah.tsx` | Dialog ubah qty harian | `DialogUbahJumlah`, `kunciItem` (`sku::variasi::buffer`) |
| `components/dashboard/dialog-barang-datang.tsx` | Dialog tandai barang datang per item | memanggil `data.tandaiPermintaanDatang` |
| `lib/dashboard/data/real.ts` | Pemetaan UI → endpoint | `listDailyRequests`, `sesuaikanQtyPermintaan`, `kirimFormPermintaan`, `tandaiPermintaanDatang`, `selesaikanPermintaan`, `listPermintaanGudang`, `buatPermintaanGudang`, `setujuiTujuanGudang`, `kirimPermintaanGudang`, `terimaPermintaanGudang`, `tidakTerimaPermintaanGudang`, `tutupTujuanPermintaanGudang`, `batalPermintaanGudang`, `selesaiPermintaanGudang` |
| `lib/dashboard/data/mock.ts` | Sumber data mode mock (dipakai e2e) | `hitungStatusDokumenMock`, seed `MOCK_PERMINTAAN_GUDANG` di `mock-data.ts:595` (`pg-001`) |
| `migrations/0002_fase1_skema.sql` | Skema D1 kedua area (baris 139–190, 228–266) | `transfers`, `transfer_destinations`, `transfer_items`, `transfer_status_log`, `daily_requests`, `daily_request_items`, `daily_request_changes` |

## Alur data
1. **Buat (antar-gudang)**: `POST /api/permintaan-gudang {aksi:"buat", dari_gudang_id, tujuan[], items[]}` → `sesiRoute` → gate `is_admin` → gate scope (`!is_owner && !scope_gudang.includes(dari_gudang_id)` = 403 "Anda hanya dapat meminta dari gudang Anda.") → `buatTransfer`: validasi `warehouses.aktif=1`, penerima harus `users.active=1`, `gabungItems` (sku sama dijumlah, qty<1 dibuang), insert `transfers(status='menunggu')` + `transfer_destinations` + `transfer_items` + `transfer_status_log('menunggu')`. ID = `T` + `Date.now().toString(36).toUpperCase()`.
2. **Setujui/kirim per tujuan**: `setujuiTujuan`/`tolakTujuan`/`kirimTujuan` memakai indeks array tujuan (`tujuan_index`). CAS `UPDATE … WHERE status_kirim = <harap>` + cek `meta.changes === 1` (409 bila balapan). Gate = `isOwner || tujuan.user_penerima_id === uid`; bila penerima `null` HANYA owner.
3. **Kirim** (`status_kirim` `disetujui → dikirim`): cek `bacaQty(stock_by_bin)` per item ≥ qty, lalu stok asal turun + `stock_moves` `TRANSFER_OUT` dalam satu `batch` (kegagalan audit tidak rollback, balikan `peringatan_audit`).
4. **Terima / tidak-terima**: gate `isPembuat || isOwner`. `terimaTujuan` menaikkan `stock_by_bin` gudang tujuan + `TRANSFER_IN`; `tidakTerimaTujuan` mengembalikan stok ke gudang ASAL (`status='tidak_terima'`).
5. **Tutup tujuan** (owner-only, alasan wajib ≤200): `status='ditutup'`, stok tidak berubah. **Selesai** (`selesaiTransfer`, pembuat/owner) hanya bila tak ada tujuan `status='menunggu'`; menulis `transfers.status='selesai'`. **Batal** (`batalTransfer`) ditolak bila ada tujuan `status_kirim='dikirim'`.
6. **Status dokumen** selalu ditulis lewat `tulisStatusDokumen(db,id,oleh,'auto')` → `hitungStatusDokumen`: semua `menunggu` → `menunggu`; ada `menunggu` → `disetujui`; semua `dikirim` + ada `ditolak` → `ditolak`; semua `dikirim` → `dikirim`; selain itu `disetujui`. Fungsi ini TIDAK pernah mengembalikan `selesai`.
7. **Baca**: `GET /api/baca?scope=transfer&status=&dari_gudang_id=&tujuan_id=` → `listTransfer` (limit default 20, cap 200, 3 query batch: header+tujuan+items) → UI `app/permintaan-gudang/page.tsx`. `guest` 403.
8. **PDF** (dibuat ON-DEMAND saat tombol Ekspor/unduh diklik, TIDAK dibuat saat `buat`): `GET /api/permintaan-gudang?aksi=pdf&id=…` atau `POST {aksi:"pdf",id}` → `pdfPermintaan`: ambil transfer, gabungkan item SEMUA tujuan per SKU (qty dijumlah), nama dari `products.nama_accurate`, gudang asal dari `ambilGudang`, pembuat = `sesi.user.tg_id || created_by` → `bangunPdfPermintaan` → `content-disposition: attachment; filename="permintaan-<id>.pdf"`.
9. **Notifikasi Telegram** (modul `lib/notifikasi/permintaanGudang.js`, saat ini TIDAK dipanggil route/worker mana pun): `kirimNotifikasiPermintaan({aksi, permintaan, tujuan})` → `{terkirim}` dan tidak pernah throw. `aksi` `buat`/`selesai`/`batal`/`tolak` = broadcast ke semua penerima tiap tujuan (`chatPenerima`: `user_penerima_id`, fallback semua owner via `ambilSemuaAdminByRole("owner")`, dedupe); `setujui`/`kirim`/`terima`/`tidak-terima`/`tolak-tujuan`/`tutup-tujuan` = satu pesan ke pembuat (`chatPembuat` = `created_by || oleh`); `ubah-item` = tidak kirim. Isi: `buat` → "Permintaan baru dari <gudang asal>\n<n> item\nBuka dashboard untuk menyetujui."; status → "<gudang tujuan> menyetujui|mengirim|menerima|tidak menerima|menolak …"; `selesai` → "Permintaan <id> selesai. Terima kasih."; fallback aksi tak dikenal "Status permintaan <asal>: <aksi>." Pengiriman lewat `kirimPesan(chatId, teks, {parseMode:"Markdown"})`; handler callback bot (`worker/bot.ts`) TIDAK punya tombol permintaan — hanya prefix `ai:` lalu `jawabCallback(..., "Diproses di dashboard (bot penuh Fase 2).")`.
10. **Harian**: UI `/permintaan` → `GET /api/baca?scope=daily` (default `tanggalHariIni()` = WIB+7 jam) → `POST /api/permintaan {aksi, tanggal}` dengan aksi `sesuaikan` (`sesuaikanQty` per item, maks 50 riwayat di `daily_request_changes`), `buat-form` (`buatForm`: snapshot `qty_diminta`, status `diproses`), `datang` (`tandaiDatang`: item → `datang`, auto-`selesai` bila semua item `datang` atau `(qty_diminta ?? qty) === 0`), `selesai` (`selesaikan`, butuh minimal satu `datang` ATAU semua qty 0).

## Endpoint & tabel terkait
- `POST /api/permintaan` → `app/api/permintaan/route.ts::POST` → `sesuaikanQty` | `buatForm` | `tandaiDatang` | `selesaikan`. Gate: `sesiRoute(request, 30)` + `user.is_admin`. Tanggal wajib `^\d{4}-\d{2}-\d{2}$`.
- `POST /api/permintaan-gudang` → `route.ts::POST` aksi: `buat`, `ubah-item`, `tolak`, `pdf`, `setujui-tujuan`, `tolak-tujuan`, `kirim`, `terima`, `tidak-terima`, `tutup-tujuan`, `selesai`, `batal`. Gate sama (`sesiRoute(...,30)` + `is_admin`), scope gudang hanya dicek pada `buat`.
- `GET /api/permintaan-gudang?aksi=pdf&id=` → `route.ts::GET` → `pdfPermintaan` (satu-satunya aksi GET).
- `GET /api/baca?scope=transfer` / `?scope=daily` → `app/api/baca/route.ts` → `listTransfer` / `ambilDaily`; `guest` 403.
- Tabel D1 → penulis/pembaca → migrasi (semua di `migrations/0002_fase1_skema.sql`; tidak ada migrasi 0003–0043 yang menyentuhnya):
  - `transfers` (`status` CHECK: menunggu/disetujui/ditolak/dibatalkan/dikirim/selesai) → tulis `lib/d1/transfer.ts`; baca `listTransfer`, bot `/transfer`.
  - `transfer_destinations` (`status` CHECK: menunggu/diterima/tidak_terima/ditolak/ditutup; `status_kirim` CHECK: menunggu/disetujui/dikirim; `UNIQUE(transfer_id, idx_tujuan)`) → tulis `transfer.ts`; baca `ambilTujuan`, `listTransfer`.
  - `transfer_items` (FK `destination_id`, `qty >= 1`) → tulis `buatTransfer`/`ubahItemTransfer`.
  - `transfer_status_log` → tulis `tulisStatusDokumen`, `buatTransfer`, `selesai/batal/tolak/ubah-item`.
  - `daily_requests` (`status` CHECK: draft/diproses/selesai, PK `tanggal`) → `lib/d1/permintaan.ts`.
  - `daily_request_items` (`status` CHECK: diminta/datang, `UNIQUE(tanggal,sku,variasi,buffer,status)`) → `tambahItem`, `sesuaikanQty`, `buatForm`, `tandaiDatang`.
  - `daily_request_changes` (retensi 50 baris/tanggal) → `tambahItem`, `sesuaikanQty`.
  - Efek samping stok: `stock_by_bin` + `stock_moves` (`TRANSFER_OUT`/`TRANSFER_IN`) oleh `kirimTujuan`/`terimaTujuan`/`tidakTerimaTujuan`; referensi `warehouses`, `users`, `products`.

## Test terkait
- Unit (node:test, `npm test`): `test/permintaanGudang.test.js` (549 baris, model Firestore v5.1: gate, CAS, stok per tujuan), `test/casModelFirestore.test.js` (203, race dua transaksi), `test/paritasPermintaanV51.test.js` (407, paritas `mock.ts` ↔ model, termasuk penanda `KETIDAKSESUAIAN`), `test/notifikasiTeks.test.js` (59, teks per aksi + regresi "tolak-tujuan" tidak boleh "menyetujui"), `test/bentukHasilModel.test.js` (112, bentuk `{ok, permintaan}`), `test/permintaanHarian.test.js` (571) + `test/permintaanRoute.test.js` (222) + `test/dailyRequests.test.js` (era Firestore/harian).
- Unit lapisan D1 (TS, jalankan `npm run test:worker`): `lib/d1/d1.library.test.ts` — `hitungStatusDokumen` (4 kasus) + `gabungItems`.
- E2E (`npm run e2e:fast`, Playwright mode MOCK, server `next start -p 3100`): `e2e/permintaan.spec.ts` (17 test), `e2e/permintaan-antar-gudang-v51.spec.ts` (10), `e2e/permintaan-antar-gudang.spec.ts` (6), `e2e/permintaan-gudang.spec.ts` (6).
- Satu test: `node --test test/permintaanGudang.test.js`; satu kasus: `node --test --test-name-pattern="gate terima" test/permintaanGudang.test.js`; e2e satu file: `npx playwright test e2e/permintaan-antar-gudang-v51.spec.ts --project=desktop`.

## Gotcha / konvensi
- **Jangan tulis `transfers.status` manual**: pakai `tulisStatusDokumen(..., 'auto')`. `hitungStatusDokumen` tidak punya cabang `selesai`; auto-selesai adalah bug desain (P6).
- **Dua kolom status**: `status` = penerimaan, `status_kirim` = setujui/kirim. `tolakTujuan` menulis `status='ditolak'` TAPI `status_kirim='dikirim'` (supaya dokumen bisa dinilai `ditolak`).
- **Gate tidak seragam**: `ubah-item` dan `tolak` (dokumen) di route hanya dicek `is_admin` — TIDAK ada cek pembuat/owner, berbeda dari `batal`/`selesai`/`terima` (`isPembuat || isOwner`) dan `tutup-tujuan` (owner-only). `setujui`/`kirim` = penerima tujuan atau owner; penerima `null` = hanya owner.
- **Scope gudang hanya di `buat`**: `dari_gudang_id` harus ada di `scope_gudang` non-owner. Gudang tujuan tidak dicek scope.
- **`sesiRoute` = origin → sesi → rate limit** (30/menit untuk kedua route tulis; `baca` 120/menit). Guest/designer 403 karena `is_admin` false.
- **`notifikasi_terkirim` praktis mati di D1**: kolomnya ada, tetapi `transfer.ts` tidak pernah menulisnya dan mapping `scope=transfer` tidak mengirimnya, sehingga badge "Notifikasi gagal terkirim" (`app/permintaan-gudang/page.tsx:618`) tidak akan muncul di mode real.
- **`lib/notifikasi/permintaanGudang.js` belum tersambung**: tidak ada pemanggil produksi (hanya `test/notifikasiTeks.test.js`); `kirimNotifikasiPermintaan` tidak pernah throw, `aksi:"ubah-item"` langsung `{terkirim:false}`.
- **Bot tidak punya tombol aksi permintaan**: `worker/bot.ts` callback_query hanya `ai:` lalu menjawab "Diproses di dashboard (bot penuh Fase 2)"; jalur lama `lib/router/routePesan.js::routeCallbackQuery` hanya `settings_ai:`, `approve:/reject:/revoke_*`, `pa:/pb:/op:/ss:/kolom:/pl:/cp:`.
- **PDF menggabung item lintas tujuan** (qty dijumlah per SKU); JPG di klien memakai `permintaan.items` (level dokumen) — bisa beda angka dengan PDF.
- **Harian**: `tambahItem` diekspor tetapi TIDAK dipanggil siapa pun; tidak ada endpoint/worker D1 yang membuat baris `daily_request_items` baru (jalur Firestore `tambahItemKeDailyRequest` di `lib/handlers/konfirmasiPickingList.js` masih Firestore). `scripts/migrate-firestore-to-d1.mjs` menunda `permintaan_gudang`/`daily_requests` ke "bagian 2" yang tidak ada.
- **UI harian mengharapkan field yang tidak dikirim route D1**: `res.dikirim_ulang`, `res.peringatan_kirim`, `res.kirim_terkirim`, `res.kirim_gagal` dibaca `app/permintaan/page.tsx`; `POST /api/permintaan` hanya membalas `{ok, permintaan, selesai_otomatis?}`.
- **`lib/dashboard/validasiPermintaanGudangV5.js` adalah orphan**: hanya dirujuk dokumen; route D1 memvalidasi inline. Jangan berasumsi pesannya dipakai produksi.
- **`e2e/permintaan-gudang.spec.ts` isinya uji STOK** (filter gudang F9), bukan permintaan antar-gudang — jangan tersesat di sana.

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, sinonim/typo) | file pertama | catatan |
|---|---|---|
| permintaan antar gudang macet, status tidak maju, "Tujuan sudah diproses" | `lib/d1/transfer.ts` | CAS `status_kirim` + `meta.changes`; cek `tulisStatusDokumen` |
| stok gudang tujuan tidak naik setelah diterima | `lib/d1/transfer.ts::terimaTujuan` | batch `stock_by_bin` + `stock_moves TRANSFER_IN`; cek `dest_warehouse_id` & gudang aktif |
| stok asal tidak turun / turun dua kali saat kirim | `lib/d1/transfer.ts::kirimTujuan` | stok turun PER TUJUAN; `bacaQty` dari `stock_by_bin` |
| "Stok … di gudang asal tidak cukup" | `lib/d1/stok.ts::bacaQty` | 409 sebelum CAS; cek baris `stock_by_bin` |
| tidak bisa setujui/kirim, 403 "Hanya penerima tujuan atau owner" | `lib/d1/transfer.ts` + `app/permintaan-gudang/page.tsx::BarisTujuan` | `user_penerima_id` null = hanya owner |
| tidak bisa terima/selesai/batal, 403 "Hanya pembuat atau owner" | `lib/d1/transfer.ts` | bandingkan `transfers.created_by` dengan `tg_id` sesi |
| tombol aksi abu-abu di UI, alasan disabled | `app/permintaan-gudang/page.tsx` | `penerimaSaya`, `pembuatSaya`, `perluSetujui/perluKirim/perluTerima` |
| dokumen tetap "Dikirim" walau semua tujuan selesai | `lib/d1/transfer.ts::hitungStatusDokumen` | P6: `selesai` aksi eksplisit, bukan turunan |
| tidak bisa batal, "Sudah ada tujuan yang dikirim" | `lib/d1/transfer.ts::batalTransfer` | cek `status_kirim='dikirim'` di semua tujuan |
| tutup tujuan gagal, alasan wajib / maksimal 200 | `lib/d1/transfer.ts::tutupTujuan` | owner-only; `catatan_alasan` |
| notifikasi bot permintaan tidak terkirim / "Notifikasi gagal" | `lib/notifikasi/permintaanGudang.js` | modul belum dipanggil produksi; `notifikasi_terkirim` tidak ditulis D1 |
| PDF permintaan kosong / salah qty / nama produk hilang | `app/api/permintaan-gudang/route.ts::pdfPermintaan` + `lib/d1/permintaanPdf.ts` | item digabung lintas tujuan; fallback `nama_accurate → nama → sku` |
| unduh PDF 400 "Permintaan belum punya item" | `app/api/permintaan-gudang/route.ts::pdfPermintaan` | `transfer_items` kosong untuk semua tujuan; `ubahItemTransfer` hanya MENGISI tujuan yang items-nya kosong, tidak pernah menghapus/mengganti |
| "Gudang asal tidak dikenal" / "Anda hanya dapat meminta dari gudang Anda" | `app/api/permintaan-gudang/route.ts` + `lib/d1/auth.ts` | `scope_gudang` dari `user_warehouses`; gudang harus `aktif=1` |
| "Pilih minimal satu tujuan" / "Maksimal 20 tujuan" / "Maksimal 200 item" | `lib/d1/transfer.ts` (`MAKS_TUJUAN`, `MAKS_ITEM`) + `lib/dashboard/validasiPermintaanGudangV5.js` | batas kembar: konstanta D1 vs validator orphan |
| permintaan harian tidak muncul hari ini | `app/api/baca/route.ts` (`scope=daily`) + `lib/d1/permintaan.ts::tanggalHariIni` | tanggal WIB (+7 jam), bukan UTC; default `?tanggal` |
| qty permintaan harian salah / item dobel | `lib/d1/permintaan.ts` | identitas `sku+variasi+buffer+status='diminta'`; `qty_diminta` snapshot saat `buat-form` |
| "Semua item sudah datang." saat kirim form | `lib/d1/permintaan.ts::buatForm` + `efektifSelesai` | item qty 0 / `qty_diminta` 0 dianggap selesai |
| "Belum ada item yang datang." saat selesai manual | `lib/d1/permintaan.ts::selesaikan` | butuh ≥1 `datang` ATAU semua qty 0 |
| badge "Berubah sejak form terakhir dikirim" muncul terus | `app/permintaan/page.tsx` (`adaDesync`) | `qty !== (qty_diminta ?? qty)` pada status `diproses` |
| "Form terkirim" tapi tidak ada pesan Telegram | `app/api/permintaan/route.ts` + `lib/models/dailyRequests.js::kirimFormPermintaan` | route D1 TIDAK mengirim Telegram dan tidak membalas `dikirim_ulang` |
| tombol Barang Datang tidak ada saat draft | `app/permintaan/page.tsx` | guard UI B1 (draft tidak merender tombol) |
| guest bisa/tidak bisa buka halaman | `lib/d1/akses-halaman.ts` + `components/dashboard/nav-config.ts` | `/permintaan` & `/permintaan-gudang` untuk owner/high_admin/admin |
| 403 "Origin tidak diizinkan" saat POST | `lib/d1/route.ts::tolakOriginD1` | `DASHBOARD_ALLOWED_ORIGINS`; POST tanpa Origin ditolak di produksi |
| 401 "Sesi kedaluwarsa" saat aksi | `lib/d1/auth.ts::requireSession` | cookie `swt_sesi`; UI menampilkan "Buka ulang" |
| 429 terlalu banyak permintaan | `lib/d1/route.ts::sesiRoute` | 30/menit untuk kedua route tulis, 120/menit `baca` |
| e2e permintaan gagal setelah ubah UI | `e2e/permintaan*.spec.ts` | testid `h6-permintaan`, `h12-permintaan-gudang`, `status-permintaan`, `kartu-permintaan-*` |
| data seed/paritas mock berbeda dengan server | `lib/dashboard/data/mock.ts` + `lib/dashboard/data/mock-data.ts:595` | `pg-001` menunggu, penerima null; paritas dikunci `test/paritasPermintaanV51.test.js` |

## Belum diverifikasi
- Isi data produksi D1 untuk `daily_request_items` (apakah sudah ada baris hasil migrasi) — tidak bisa dibaca tanpa akses `wrangler`/DB.
- Apakah `lib/notifikasi/permintaanGudang.js` akan disambungkan di Fase 2 bot; saat ini tidak ada pemanggil.
- Apakah jalur lama `api/webhook.js` + `lib/models/permintaanGudang.js` masih menerima traffic di deployment aktif.
