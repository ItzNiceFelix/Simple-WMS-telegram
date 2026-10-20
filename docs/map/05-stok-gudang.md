# 05 — Stok, Produk & Gudang (D1)

## Ringkasan area
- Sumber angka stok = tabel `stock_by_bin` (PK `sku`+`warehouse_id`); `stock_moves` = ledger append-only. Tidak ada kolom stok di `products` — `stok_gudang_online` hanya nama field keluaran API.
- Gudang virtual `ONLINE` adalah **baris biasa** di `warehouses` + `stock_by_bin`, bukan kolom. Konstanta `GUDANG_ONLINE = "ONLINE"` ada di `lib/d1/stok.ts` dan `lib/d1/stokOnline.ts`.
- Penulis stok D1: `stok.ts`, `opname.ts`, `transfer.ts`, `produk.ts` (stok awal), `stokOnline.ts` (potong picklist), `app/api/excel/route.ts` (impor), `lib/kledo/sinkron.ts` (timpa non-ONLINE). Pembaca: `ledger.ts`, `app/api/baca/route.ts`, `worker/bot.ts`, `worker/notify.ts`.
- TIDAK termasuk: order/picklist PDF (`03-order.md`), laba & analisa (`09-dashboard-analisa.md`), auth/role (`10-auth-akses.md`), bot Telegram (`11-telegram-bot.md`), sinkron Kledo/Sheets (`12-integrasi-sinkron.md`), primitif UI (`13-ui-komponen.md`).

## Peta file
| file | peran | export/entry penting |
|---|---|---|
| `lib/d1/stok.ts` (158) | Operasi stok inti + ledger atomik | `GUDANG_ONLINE`, `bacaQtyPerGudang`, `bacaQty`, `tulisQty`, `ubahRelatif`, `mutasiAntarGudang`, `setReorderPoint`, `stokDiBawahReorder` |
| `lib/d1/produk.ts` (143) | Master produk + stok awal | `normalisasiNama`, `ambilProduk`, `ambilProdukBanyak`, `tambahProduk`, `ubahHpp`, `toggleOnline`, `cariProduk`, `tambahKeyword` |
| `lib/d1/stokOnline.ts` (179) | Potong stok ONLINE saat picklist dicetak | `GUDANG_ONLINE`, `ambilSkuOnline`, `potongOnlineUntukOrder` |
| `lib/d1/gudang.ts` (142) | Master gudang (maks 50 aktif) | `MAKS_GUDANG`, `ambilGudang`, `ambilGudangAktif`, `listGudang`, `tambahGudang`, `editGudang`, `nonaktifGudang`, `aktifkanGudang`, `hitungReferensiGudang`, `pastikanGudang` |
| `lib/d1/opname.ts` (156) | Opname + approval owner (CAS T9) | `buatOpname`, `ambilOpname`, `setujuiOpname`, `tolakOpname`, `listOpname` |
| `lib/d1/transfer.ts` (558) | Transfer antar gudang per-tujuan | `hitungStatusDokumen`, `gabungItems`, `buatTransfer`, `setujuiTujuan`, `tolakTujuan`, `kirimTujuan`, `terimaTujuan`, `tidakTerimaTujuan`, `tutupTujuan`, `selesaiTransfer`, `ubahItemTransfer`, `tolakDokumen`, `batalTransfer`, `listTransfer`, `ambilTransfer` |
| `lib/d1/adsProduk.ts` (243) | Impor CSV Shopee Ads per produk/hari | `bacaCsv`, `cariBarisHeader`, `bacaPeriode`, `parseIklan`, `imporIklan`, `totalIklan` |
| `lib/d1/hargaJualPreset.ts` (138) | Auto-fee harga jual per SKU/preset | `muatKomponenHarga`, tipe `KomponenAuto` |
| `lib/d1/ledger.ts` (65) | Baca ledger (read-only) | `listMovements`, `kartuStok` |
| `app/api/baca/route.ts` (455) | Endpoint baca utama dashboard | `GET`; scope `stok`, `kekurangan`, `produk`, `gudang`, `opname`, `transfer`, `histori`, `ringkasan` (+ `daily`, `admin`, `akses`, `ai`, `model-terpakai`) |
| `app/api/stok/gudang/route.ts` (80) | Set qty / mutasi antar gudang | `POST` aksi `set-qty`, `mutasi-gudang` |
| `app/api/stok/mutasi/route.ts` (73) | Tambah/kurangi/timpa stok ONLINE | `POST` mode `tambah`, `kurangi`, `timpa` |
| `app/api/stok/reorder-point/route.ts` (25) | Set `products.stok_min` | `POST` |
| `app/api/gudang/route.ts` (47) | CRUD gudang (owner) | `POST` aksi `tambah`, `edit`, `nonaktif`, `aktifkan` |
| `app/api/opname-gudang/route.ts` (49) | Opname (buat admin, setujui/tolak owner) | `POST` aksi `buat`, `setujui`, `tolak` |
| `app/api/permintaan-gudang/route.ts` (184) | Transfer antar gudang + PDF | `GET` (`?aksi=pdf`), `POST` (`buat`, `ubah-item`, `setujui-tujuan`, `tolak-tujuan`, `kirim`, `terima`, `tidak-terima`, `tutup-tujuan`, `selesai`, `batal`, `tolak`) |
| `app/api/produk/[sku]/route.ts` (74) | Field master produk (owner) | `PATCH` `kategori`/`tier_override`/`pre_order`/`ukuran_khusus`/`go_override` |
| `app/api/produk/massal/route.ts` (83) | Aksi massal ≤500 SKU | `POST` `set-kategori`, `set-pre-order`, `set-ukuran`, `set-go`, `set-penghitung` |
| `app/api/produk/kategori/route.ts` (70) | Kategori + tier | `GET`, `PATCH` |
| `app/api/produk/online/route.ts` (23) | Toggle `is_online_product` | `POST` → `toggleOnline` |
| `app/api/produk/hpp/route.ts` (32) | Ubah HPP (owner, idempoten) | `POST` → `ubahHpp` |
| `app/api/excel/route.ts` (278) | Impor 2-fase (produk+stok) & ekspor | `POST` (multipart / `aksi:"konfirmasi"`), `GET ?format=export&tipe=produk\|stok\|hpp` |
| `app/stok/page.tsx` (942) | H2 Stok: tabel/kartu, filter, paginasi server | `HalamanStok`, `DaftarStok` |
| `app/gudang/page.tsx` (255) | H10 Master gudang (owner) | `HalamanGudang`, `MasterGudang` |
| `app/opname-gudang/page.tsx` (551) | H11 Opname + approval | `HalamanOpnameGudang`, `OpnameGudang` |
| `app/produk/[kode]/page.tsx` (391) | H3 Detail produk + 20 movement terakhir | `HalamanDetailProduk`, `DetailProduk` |
| `app/harga-jual/page.tsx` (448) | Hitung harga jual per SKU | `HalamanHargaJual`, `HitungHarga` |
| `lib/models/*.js` (legacy) | CRUD Firestore era lama (lihat bagian legacy) | `stok.js`, `produk.js`, `stockMovements.js`, `gudang.js`, `stokGudang.js`, `opnameGudang.js` |

## Alur data
1. **Stok masuk/keluar (web).** `POST /api/stok/mutasi` → `sesiRoute` → cek `user.is_admin` → `ambilProduk` → `guardAktif`/`tulisGuard` (10 dtk, best-effort) → hitung `qtyBaru` dari `bacaQty(db, sku, "ONLINE")` → `tulisQty` → batch: upsert `stock_by_bin` + `INSERT stock_moves` (qty = **selisih**) + update `products.last_stock_updated`. `mode:"timpa"` memakai `jenis:"opname"`.
2. **Set qty / mutasi gudang.** `POST /api/stok/gudang` aksi `set-qty` → `tulisQty` (absolut, `jenis:"koreksi_manual"`); aksi `mutasi-gudang` → `mutasiAntarGudang` → cek cukup di gudang asal, lalu batch 4 statement (turun asal, naik tujuan, `TRANSFER_OUT`, `TRANSFER_IN`). Admin dibatasi `user.scope_gudang`.
3. **Tambah produk.** `POST /api/admin` aksi `tambah-produk` → `tambahProduk` → batch `products` + `stock_by_bin(gudangId="ONLINE")` + `stock_moves` `jenis:"OPENING"`.
4. **Impor Excel.** `POST /api/excel` → `import_batches` (payload JSON, status `preview`) → `POST {aksi:"konfirmasi"}` → per 50 baris: upsert `products`, upsert `stock_by_bin`, `INSERT stock_moves jenis:"restock"`. Scope gudang dicek per baris (`user.scope_gudang`), default gudang `ONLINE`.
5. **Transfer.** `buatTransfer` menulis `transfers` + `transfer_destinations` (per tujuan) + `transfer_items` + `transfer_status_log`. `kirimTujuan` (penerima/owner) → CAS `status_kirim: disetujui→dikirim` → stok asal **turun** + `TRANSFER_OUT`; `terimaTujuan` (pembuat/owner) → CAS `status: menunggu→diterima` → stok tujuan **naik** + `TRANSFER_IN`; `tidakTerimaTujuan` → qty **kembali** ke asal + `TRANSFER_IN`; `tutupTujuan` (owner, alasan wajib) hanya status. Status dokumen = turunan `hitungStatusDokumen` via `tulisStatusDokumen` — jangan ditulis manual.
6. **Opname.** `buatOpname` menghitung `qty_sistem`/`selisih` di server. Semua selisih 0 → langsung `disetujui` + `terapkanHasilOpname` (batch upsert `stock_by_bin` + `stock_moves jenis:"opname"`); ada selisih → `menunggu_approval` tanpa ubah qty. `setujuiOpname` (owner) = CAS T9: bandingkan `qty_sistem` tersimpan vs `bacaQty` sekarang; beda → 409 "Buat ulang". Gagal audit → `peringatan_audit: true`, bukan rollback.
7. **Reorder point.** `POST /api/stok/reorder-point` → `setReorderPoint` (UPDATE `products.stok_min`). Pembaca: `stokDiBawahReorder` (query langsung `stock_by_bin` JOIN `products`, tanpa pemanggil produksi), query inline serupa di `app/api/baca` (`scope=stok`/`ringkasan`), `worker/notify.ts:bangunLaporanHarian`, dan `lib/ai/tools.ts` (~baris 320).
8. **Stok ONLINE (tanggung jawab user, commit `4d33f54`).** `GET /api/order?aksi=picklist-pdf` (mode selain `gabung-order`) → `potongOnlineUntukOrder` → hanya SKU `products.is_online_product = 1` → potong **maksimal sampai 0**, sisa dicatat `kurang[]` → ledger `jenis:"keluar_resi"`, `source:"web_dashboard"`, `action_type:"picklist_online"` → tandai `orders.stok_dikurangi = 1` untuk SEMUA order (termasuk yang kurang) agar cetak ulang tidak memotong dua kali. Migrasi `0029_stok_online.sql` me-reset semua `is_online_product = 0`.
9. **adsProduk.** `POST /api/analisa` aksi `impor-iklan` → `parseIklan` (CSV RFC 4180, kolom `KOL`) → peta `Kode Produk`→SKU dari `shopee_produk` → `imporIklan` (akumulasi `biaya = excluded.biaya + biaya` pada PK `(preset_id, tanggal, sku)`, batch 50). Pembaca: `lib/d1/analisa.ts` (`totalIklanPeriode`, `metrikIklanPerSku`, `iklanHarianPerSku`). `totalIklan` di `adsProduk.ts` hanya dipakai test — `app/api/ads` membaca `ads_harian`.
10. **Legacy Firestore (`lib/models/*.js`).** Hidup HANYA di jalur Vercel `api/webhook.js` → `lib/router/routePesan.js` → `lib/gemini/chatHandler.js|tools.js`, `lib/handlers/*`, `lib/sheets/syncStokDuaArah.js`, `lib/reminder/cekReorderPoint.js`, `lib/matching/*` (koleksi `products`, `stock`, `stock_movements`, `gudang`, `opname_gudang`). `lib/models/opnameGudang.js` + `permintaanGudang.js` kini hanya dipakai `test/*.test.js`; `stokGudang.js` hanya helper murni untuk `stok.js`/`opnameGudang.js`/`permintaanGudang.js`. Worker aktif (`worker/bot.ts`) tidak menyentuhnya.
11. **hargaJualPreset.** `GET /api/harga-jual?aksi=komponen|cari-sku` dan `POST {aksi:"hitung"}` → `muatKomponenHarga` (fee admin per tier, program aktif, pajak, flat) → `hitungHargaJual`. Tidak menulis stok.

## Endpoint & tabel terkait
- Endpoint: `GET /api/baca?scope=stok` → `app/api/baca/route.ts` → SQL langsung (`products` LEFT JOIN `stock_by_bin`, 2 query: SKU halaman + detail); filter `q`, `status` (`menipis`/`minus`), `gudang_id`, `is_online`, `limit` (cap 200, default 2000), `offset`; `total` = `COUNT(*)` di lapisan produk.
- Endpoint: `GET /api/baca?scope=kekurangan` → hitung ulang dari `order_items` + `stock_by_bin ONLINE` (tanpa tabel simpanan).
- Endpoint: `GET /api/baca?scope=produk&kode=` → produk + varian + keyword + `bacaQtyPerGudang` (satu SKU terbuka untuk guest).
- Endpoint: `GET /api/baca?scope=gudang|opname|transfer|histori` → `listGudang`, `listOpname`, `listTransfer`, `listMovements`.
- Endpoint: `POST /api/stok/mutasi`, `POST /api/stok/gudang`, `POST /api/stok/reorder-point`, `POST /api/gudang`, `POST /api/opname-gudang`, `POST /api/permintaan-gudang`.
- Endpoint: `PATCH /api/produk/[sku]`, `POST /api/produk/massal`, `GET|PATCH /api/produk/kategori`, `POST /api/produk/online`, `POST /api/produk/hpp`, `POST /api/admin` (`tambah-produk`), `POST /api/excel`.
- Endpoint: `GET|POST /api/harga-jual`, `POST /api/analisa` (`impor-iklan`), `GET /api/order?aksi=picklist-pdf` (pemicu potong ONLINE).
- Tabel D1: `products` → penulis `produk.ts`, `app/api/produk/[sku]/route.ts`, `app/api/produk/massal/route.ts`, `app/api/excel/route.ts`, `lib/kledo/sinkron.ts`; pembaca `stok.ts`, `baca`, `hargaJualPreset` → `0002` (alter `0013`,`0014`,`0015`,`0025`; index `0038`).
- Tabel D1: `stock_by_bin` → penulis `stok.ts`, `opname.ts`, `transfer.ts`, `produk.ts`, `stokOnline.ts`, `app/api/excel/route.ts`, `lib/kledo/sinkron.ts` → `0002` (`idx_sbb_sku`, `idx_sbb_wh`).
- Tabel D1: `stock_moves` → penulis sama + `lib/kledo/sinkron.ts`; pembaca `ledger.ts`, `baca` scope `histori`/`ringkasan` → `0002`, rebuild `0006`, `0019` (`idx_moves_sku`, `idx_moves_pending`, `idx_moves_gudang`).
- Tabel D1: `stock_counts`, `count_lines`, `count_status_log` → `opname.ts` → `0002` (`idx_counts_status`, `idx_clines_count`; kolom `freeze` belum dipakai kode).
- Tabel D1: `transfers`, `transfer_destinations`, `transfer_items`, `transfer_status_log` → `transfer.ts` → `0002` (`idx_transfers_status`, `idx_dest_wh`, `idx_dest_transfer`, `idx_titem_dest`, `idx_tlog_transfer`).
- Tabel D1: `warehouses` → `gudang.ts`, `lib/kledo/sinkron.ts`, `pastikanGudang` → `0001`, rebuild `0002`, alter `0025` (`idx_wh_kledo`).
- Tabel D1: `product_changes` → `ubahHpp` (audit HPP) → `0002`; `ads_produk` → `imporIklan` → `0027` (`idx_ads_produk_tgl`); `ads_harian` → `app/api/ads` → `0014`; `orders.stok_dikurangi` → `stokOnline.ts` → `0009`.

## Test terkait
- Unit TS (colocated, `npm run test:worker`): `lib/d1/stokOnline.test.ts` (9 kasus: potong sekali, tidak minus, kurang tercatat), `lib/d1/adsProduk.test.ts` (parser + akumulasi `ON CONFLICT`), `lib/d1/d1.library.test.ts` (`hitungStatusDokumen`, `gabungItems`, `normalisasiNama`). Tidak ada `stok.test.ts`/`opname.test.ts`/`transfer.test.ts` khusus.
- Unit CJS (`npm test`): `test/stokPaginasi.test.js`, `test/bacaStokOnlineFilter.test.js` (cermin ekspresi route, bukan impor route), `test/mutasiStok.test.js`, `test/stokGudangQty.test.js`, `test/stokGudangMutasi.test.js`, `test/opnameGudang.test.js`, `test/permintaanGudang.test.js`, `test/paritasPermintaanV51.test.js`, `test/produkOnline.test.js`, `test/reorderPoint.test.js`, `test/gudangMaster.test.js`, `test/editProduk.test.js`, `test/syncStok*.test.js`.
- E2E (Playwright, selalu mock): `e2e/stok.spec.ts`, `e2e/stok-mutasi.spec.ts`, `e2e/opname-gudang.spec.ts`, `e2e/gudang-v5.spec.ts`, `e2e/permintaan-antar-gudang-v51.spec.ts`, `e2e/tambah-produk.spec.ts`.
- Satu test CJS: `node --test test/stokPaginasi.test.js`. Satu test TS: `npx esbuild lib/d1/stokOnline.test.ts --bundle --platform=node --format=esm --outfile=.tmp.test.mjs --define:__dirname="'.'" --external:react --external:@opennextjs/cloudflare && node --test .tmp.test.mjs`. Satu spec: `npm run e2e:build && npx playwright test e2e/stok.spec.ts --project=desktop`.

## Gotcha / konvensi
- **Invariant ledger:** setiap tulis `stock_by_bin` wajib disertai `INSERT stock_moves` di `db.batch` yang sama. `qty` ledger = delta/selisih, bukan qty absolut — kecuali `app/api/excel/route.ts` yang menulis `qty = stokAwal` (absolut) meski upsert-nya absolut; jangan meniru.
- `tulisQty` menerima `jenis` terbatas (`restock|koreksi_manual|opname|TRANSFER_IN|TRANSFER_OUT|OPENING`). `keluar_resi` (stokOnline) dan `sync_confirmed` (Kledo) menulis SQL sendiri karena di luar tipe itu.
- Stok negatif = fitur lewat `tulisQty`/`ubahRelatif` (dipakai `/kurangi` bot dan `mode:"kurangi"`). Hanya `mutasiAntarGudang` yang menolak stok kurang (409) dan `stokOnline` yang berhenti di 0.
- `ONLINE` bukan kolom: jangan mencari `products.stok_gudang_online`. `warehouses.is_online = 1` tidak bisa dinonaktifkan (`nonaktifGudang` → 400).
- `is_online` pada `GET /api/baca?scope=stok` bersifat **opt-in** (`=== "true"`); parameter tidak dikirim berarti tidak menyaring (regresi lama: 692/1174 produk hilang).
- Paginasi `scope=stok` dipasang di lapisan `products` (`LIMIT/OFFSET` pada SKU), lalu qty semua gudang diambil per SKU. Memasang LIMIT pada hasil JOIN memotong di tengah produk.
- Guard dobel-proses hanya di `/api/stok/mutasi` dan `aksi:"mutasi-gudang"` (TTL 10 dtk, `lib/d1/guard.ts`), dan sengaja best-effort: error I/O tidak memblokir tulis sah. Pengaman utama = CAS (`meta.changes`).
- Transfer: status dokumen TURUNAN (`hitungStatusDokumen`). Gate beda per aksi: `kirim` = penerima/owner, `terima|tidak-terima|selesai|batal` = pembuat/owner, `tutup-tujuan` = owner.
- Opname: `qty_sistem`/`selisih` DIHITUNG SERVER; jangan kirim dari klien. Setelah disetujui, perubahan stok memakai CAS T9 — opname lama tidak bisa diterapkan di atas stok baru.
- `stokDiBawahReorder` tidak punya pemanggil produksi; `lib/ai/tools.ts` menduplikasi query-nya. Ubah keduanya bila logika reorder berubah.
- Kledo menimpa penuh `stock_by_bin` gudang non-ONLINE dan hanya mencatat DRIFT (satu baris `sync_confirmed` per SKU). Menulis stok WMS untuk gudang non-ONLINE akan dibalik sinkron berikutnya.
- Legacy `lib/models/*.js` (Firestore) hanya hidup di jalur Vercel `api/webhook.js` → `lib/router/routePesan.js` → `lib/gemini|handlers|sheets|matching|reminder` + `scripts/*`. `lib/models/opnameGudang.js` dan `lib/models/permintaanGudang.js` kini hanya dipakai `test/*.test.js`; `lib/models/gudang.js`/`stokGudang.js` hanya dipakai model legacy itu. Worker (`worker/bot.ts`) memakai `lib/d1/*` saja.
- `lib/models/stok.js` memakai cache 60 dtk untuk `cariStokDiBawahReorderPoint`; `lib/d1/*` tidak punya cache (query langsung). Jangan mencampur asumsi keduanya.

## Kalau masalahnya ... buka ...
| gejala / kata kunci (Indonesia, sinonim/typo) | file pertama | catatan |
|---|---|---|
| stok tidak sesuai / stok tidak sinkron / qty beda antar gudang / stok online salah / "stok gudang online" | `lib/d1/stok.ts` | `bacaQty`, `bacaQtyPerGudang`, `tulisQty`; `ONLINE` = baris `stock_by_bin` |
| stok berubah tapi riwayat kosong / kartu stok kosong / histori hilang | `lib/d1/ledger.ts` + `lib/d1/stok.ts` | ledger wajib satu batch; `listMovements` hanya baca |
| stok dobel / klik dua kali / "duplikat" / mutasi ganda | `lib/d1/guard.ts` + `app/api/stok/mutasi/route.ts` | guard 10 dtk best-effort; `ref_client_id` tidak dipakai runtime |
| stok minus / minus tidak wajar / "stok negatif" | `lib/d1/stokOnline.ts` | jalur ini berhenti di 0; minus hanya dari input manual |
| produk Kledo tidak muncul / daftar stok kosong / cari gagal | `app/api/baca/route.ts` (scope `stok`) | `is_online` harus opt-in; paginasi di lapisan produk |
| halaman stok berat / lambat / 1174 baris / paginasi salah | `app/stok/page.tsx` + `app/api/baca/route.ts` | limit cap 200; `total` dari COUNT produk |
| selisih opname aneh / tidak bisa setujui / "stok berubah sejak opname" | `lib/d1/opname.ts` | CAS T9; status `menunggu_approval`; `freeze` belum dipakai |
| opname tidak mengubah stok / approval tidak jalan | `app/api/opname-gudang/route.ts` | `buat` = admin+scope gudang, `setujui`/`tolak` = owner |
| transfer macet / stok tujuan tidak naik / status dokumen aneh | `lib/d1/transfer.ts` | `status_kirim` per tujuan; status dokumen turunan |
| kirim transfer tidak boleh / 403 pada penerima | `lib/d1/transfer.ts:kirimTujuan` | gate = penerima tujuan atau owner |
| stok kembali ke asal / tidak-terima / retur transfer | `lib/d1/transfer.ts:tidakTerimaTujuan` | menulis `TRANSFER_IN` di gudang asal |
| reorder point tidak tersimpan / notifikasi menipis tidak jalan | `lib/d1/stok.ts:setReorderPoint` + `worker/notify.ts:bangunLaporanHarian` | `products.stok_min`; laporan harian pakai `warehouse_id='ONLINE'` |
| HPP salah / edit HPP tidak tercatat / "hanya owner" | `lib/d1/produk.ts:ubahHpp` + `app/api/produk/hpp/route.ts` | audit `product_changes`; idempoten bila nilai sama |
| toggle produk online tidak berpengaruh / potong picklist | `app/api/produk/online/route.ts` + `lib/d1/stokOnline.ts` | hanya `is_online_product = 1` yang dipotong |
| tambah produk gagal / kode duplikat / stok awal salah | `lib/d1/produk.ts:tambahProduk` + `app/api/admin/route.ts` | batch `products`+`stock_by_bin`+`OPENING` |
| impor Excel stok salah / batch tidak bisa dikonfirmasi | `app/api/excel/route.ts` | 2 fase `import_batches`; ledger `restock` memakai qty absolut |
| kategori/tier produk tidak terpetakan / aksi massal gagal | `app/api/produk/kategori/route.ts` + `app/api/produk/massal/route.ts` | validasi ke `kategori_tarif`/`tier_admin`; maks 500 SKU |
| gudang tidak bisa dinonaktifkan / nama gudang duplikat / maks 50 | `lib/d1/gudang.ts` | `MAKS_GUDANG`, cek `lower(nama)` pada yang aktif |
| biaya iklan per produk salah / dobel / impor Ads gagal | `lib/d1/adsProduk.ts` | akumulasi `ON CONFLICT`; parser CSV menghormati kutip |
| harga jual auto salah / fee tidak muncul / tier unknown | `lib/d1/hargaJualPreset.ts` | fee admin/program/pajak; OPEX & volume manual |
| data stok beda dengan Kledo / sinkron membalik angka | `lib/kledo/sinkron.ts` | timpa penuh non-ONLINE; ledger hanya drift |
| bot `/stok`, `/tambah`, `/kurangi` salah angka | `worker/bot.ts` | memakai `bacaQtyPerGudang`/`ubahRelatif` gudang ONLINE |
| model Firestore lama dipanggil / "firebase-admin" di jalur stok | `lib/models/stok.js` + `api/webhook.js` | hanya jalur Vercel legacy + `scripts/*`, bukan Worker |

## Belum diverifikasi
- Inventaris tugas menyebut `app/api/produk/route.ts`; berkas itu TIDAK ada di repo (`git ls-files` hanya memuat `[sku]/`, `hpp/`, `kategori/`, `massal/`, `online/`).
- Apakah `migrations/0029_stok_online.sql` sudah dijalankan di D1 produksi (hanya membaca berkas migrasi, tidak menyentuh DB).
- Perilaku `meta.changes` D1 pada CAS saat baris tidak berubah nilainya (diasumsikan 1 bila WHERE cocok) — tidak diuji di repo.
- Kinerja `scope=stok` pada limit default 2000 dengan ~1174 SKU × 6 gudang tidak diukur di sini; hanya dibaca dari komentar commit `4d33f54`.
