# Inventaris Kategori di D1 — T-V2 (Fase 0)

Sumber: D1 remote `simple-wms.products` (482 SKU, 482 ada HPP), dump penuh `SELECT sku, nama_accurate ORDER BY sku`.
Skema `products` (migrasi `0002`, D1 remote terkonfirmasi): **TIDAK ADA kolom kategori sama sekali** — kolom yang ada: `sku, nama_accurate, nama_accurate_normalized, hpp, hpp_baru, is_online_product, online_updated_by, updated_at, stok_min, last_stock_updated(*), last_synced_at, last_synced_value`.

## 1. Hasil hitung
- Produk dengan kategori yang cocok path Shopee: **0 dari 482 (0%)**.
- Produk yang kategorinya tidak cocok / belum ada kolom kategori: **482 dari 482 (100%)**.
- Nilai `nama_accurate_normalized`: terisi (dipakai fuzzy-match bot), bukan kategori.

## 2. Kelompok internal → usulan path Shopee (untuk R-R2 / U-M2 aksi massal)
Distribusi nama produk (regex atas `nama_accurate`, satu SKU bisa masuk dua kelompok — angka aproksimasi):

| Kelompok internal | ±SKU | Contoh | Usulan path Shopee (verifikasi di edu/7882 via R-R1) |
|---|---|---|---|
| Piring/mangkok/gelas/sendok + wadah makan-minum | ~165 | Piring Kupu Jumbo, Mangkok Royal Melamin, Rice Bucket Tri J, Lunch Box Garuda, Tudung Saji Peri, Toples Sealware | `Rumah Tangga > Peralatan Makan` / `... > Penyimpanan Makanan` |
| Lemari/rak/box + storage plastik | ~171 | Lemari Magnolia Tri J, Rak TV Korea, Box Container, Dispenser Beras, Keranjang Parcel | `Rumah Tangga > Perabotan` / `... > Penyimpanan` |
| Masak/dapur (wajan, cetakan, kompor, selang) | ~42 | Cetakan Happycall, Wajan Konduksi, Kompor RRT, Selang Gascomp, Regulator | `Rumah Tangga > Peralatan Masak` |
| Kebersihan (sapu, pel, keset, tikar) | ~37 | Sapu Ijuk, Pel Sumbu, Keset, Tikar Hajat | `Rumah Tangga > Kebersihan` |
| Kasur/tidur | ~14 | Kasur Palembang, Kasur Lipat | `Rumah Tangga > Kamar Tidur` |
| Lainnya (campuran) | ~58 | Hanger, Gayung, Bubble wrap, Stop kontak, Kursi, Pot bunga, Speaker | per-SKU, lihat §3 |

## 3. Daftar "lainnya" (58 SKU, wajib petakan manual satu-per-satu di U-M1)
`001326 Lepek Sambel | 001385 Box Fan | 001488 Hanger Dewasa | 001562 Gayung Siba | 001749 T matahari | 001750 pengaman TBL | 001759 TDC kawat | 001762 multy kotak | 001773 catok LPG | 001804 dispenser asta | 001824/001830/001831 HP set | 001841 Barner | 001888 klem kupu | 001909 Celengan | 0092/0204/100079 RPL 03 | 0137 Clamp | 0236 Tiang Bendera | 0543 Mainan Anak | 0572 Kaligrafi Jam | 0581 Tempat Kue | 0629 Amazing Shoes | 0662 Kursi Bakso | 0697 Knop Baut | 0707 Meja Cafe | 100027 Kursi Camilo | 100031/032/033/100358 Gayung | 100121 Standfan | 100201 Rafia | 100313/100357/100360/100361 Bubble | 100318 Lakban | 100359/100364/100400 Hanger | 100391 Stop Kontak | 100393/100394 Roll kabel | 1112 Tombol Electric | 1203 Alas Setrika | 1295 Kempyeng | 1387 Hand Tap | 1447 Tempat Sampah | 1808 Tobaki | 1853/SKU/01124 CB | 1979 Pot Bunga | SKU/01126 Bangku | SKU/01132 Wakul | SPRADV-K651 Speaker | TKRHJT-ALDN Tikar Aladin`

## 4. Keputusan untuk D-R1/D-R2/U-M2
1. Kolom `products.kategori` (v1) + `kategori/tier_override/pre_order/ukuran_khusus` (v2 §3) dibuat di migrasi — tidak ada data lama yang perlu dipindahkan (nol kategori existing).
2. Seluruh 482 produk mulai sebagai `belum_terpetakan` — U5/U-M1 wajib bulk-set per kelompok §2 (pilih N SKU → set 1 path), bukan satu-per-satu 482 kali.
3. `tier_override` hanya untuk pengecualian; default alur = `kategori_tarif[path].tier`.
4. `nama_accurate_normalized` tidak dipakai untuk tarif — hanya untuk fuzzy-match bot (tetap).
5. Seed `kategori_tarif_contoh` (5 path Fashion) tidak cocok satu pun dengan katalog ini (rumah tangga/plastik) — R-R2 wajib isi path rumah tangga dari edu/7882, bukan contoh Fashion.
