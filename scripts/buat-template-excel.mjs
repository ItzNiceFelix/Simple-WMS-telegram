// scripts/buat-template-excel.mjs — Generator template import resmi (Fase 2, PRD F3).
// Header: SKU* | Nama* | Kategori | Satuan* | StokAwal | HPP | HargaJual |
//         RakBin | StokMin | Barcode | Expired | Aktif + sheet PANDUAN.
// Export memakai header SAMA (round-trip). Jalankan: node scripts/buat-template-excel.mjs
import XLSX from "xlsx";
import { writeFileSync } from "node:fs";

const HEADER = ["SKU*", "Nama*", "Kategori", "Satuan*", "StokAwal", "Gudang", "HPP", "HargaJual", "RakBin", "StokMin", "Barcode", "Expired(YYYY-MM-DD)", "Aktif"];
const CONTOH = [
  ["BRG-001", "Kemeja Lengan Panjang", "Pakaian", "pcs", 100, "ONLINE", 75000, 129000, "A-01", 10, "8991234567890", "", "YA"],
  ["BRG-001", "Kemeja Lengan Panjang", "Pakaian", "pcs", 20, "GUDANG-A", 75000, 129000, "A-01", 10, "8991234567890", "", "YA"],
  ["BRG-002", "Celana Chino Slim", "Pakaian", "pcs", 50, "", 95000, 159000, "A-02", 5, "", "", "YA"],
  ["BRG-003", "Kopi Bubuk 250g", "Makanan", "pcs", 200, "ONLINE", 28000, 45000, "B-01", 20, "", "2027-12-31", "YA"],
];
const PANDUAN = [
  ["Kolom", "Wajib", "Aturan"],
  ["SKU*", "Ya", "Unik, tanpa spasi. Contoh: BRG-001"],
  ["Nama*", "Ya", "Nama produk Accurate/master"],
  ["Kategori", "Tidak", "Bebas, untuk filter"],
  ["Satuan*", "Ya", "pcs/dus/pak/dll"],
  ["StokAwal", "Tidak", "Bilangan bulat >= 0, default 0. Ditulis ke gudang kolom Gudang."],
  ["Gudang", "Tidak", "ID gudang terdaftar (huruf besar). Kosong = gudang pilihan saat import. Satu SKU boleh multi-baris untuk gudang berbeda. Gudang belum terdaftar = baris ditolak."],
  ["HPP", "Tidak", "Bilangan bulat >= 0 (rupiah)"],
  ["HargaJual", "Tidak", "Bilangan bulat >= 0 (rupiah)"],
  ["RakBin", "Tidak", "Kode rak/bin, dicatat (bin penuh Fase 2 lanjutan)"],
  ["StokMin", "Tidak", "Reorder point, default kosong"],
  ["Barcode", "Tidak", "Harus unik bila diisi"],
  ["Expired", "Tidak", "Format YYYY-MM-DD atau kosong"],
  ["Aktif", "Tidak", "YA/TIDAK, default YA"],
  ["", "", ""],
  ["Alur import: upload → preview sukses/gagal per baris → Konfirmasi → tulis atomik."],
  ["SKU yang sudah ada = UPDATE (upsert), baru = INSERT."],
  ["", "", ""],
  ["Sheet Pesanan (kirim ke /api/order, 2-fase: preview → konfirmasi).", "", ""],
  ["NoPesanan*", "Ya", "Kode pesanan marketplace, dikelompokkan per (Marketplace, NoPesanan)"],
  ["Marketplace*", "Ya", "Bebas (shopee/tiktok/tokopedia/dll), dinormalkan lowercase"],
  ["Tanggal*", "Ya", "Format YYYY-MM-DD valid"],
  ["SKU*", "Ya", "Harus ada di master produk"],
  ["Qty*", "Ya", "Bilangan bulat >= 1"],
  ["HargaSatuan*", "Ya", "Bilangan bulat >= 0 (rupiah)"],
  ["Buyer", "Tidak", "Nama pembeli, bebas"],
  ["FeeJenis", "Tidak", "admin/service/komisi/ongkir/voucher/affiliate/iklan/lain; kosong = tanpa fee"],
  ["FeeBasis", "Tidak", "flat/persen, default flat bila FeeJenis diisi"],
  ["FeeNilai", "Tidak", "Bilangan bulat >= 0; persen = % dari (Qty x HargaSatuan)"],
  ["PPh", "Tidak", "YA/TIDAK, default YA"],
  ["PPN%", "Tidak", "Angka >= 0, default 0"],
  ["", "", ""],
  ["Satu order boleh multi-baris (satu baris = satu SKU)."],
  ["Peringatan (tak blokir): order campur baris ber-fee + tanpa-fee."],
  ["", "", ""],
  ["Sheet orders + Advance Fulfilment (format export Shopee).", "", ""],
  ["No. Pesanan", "Ya", "ID order Shopee (satu order boleh multi-baris)"],
  ["Nomor Referensi SKU", "Ya*", "SKU master; kosong = pakai SKU Induk"],
  ["Jumlah", "Ya", "Qty baris orders; ditambah jumlah baris Advance untuk SKU sama"],
  ["No. Resi", "Tidak", "Terisi = wajib review: sudah/belum diserahkan ke ekspedisi"],
  ["Booking SN", "Ya", "Sama dengan No. Pesanan; setiap baris Advance bernilai qty 1"],
  ["", "", ""],
  ["Status internal selalu masuk 'pending' (atau 'kirim' bila resi ditandai sudah diserahkan)."],
  ["Import TIDAK mengubah stok; pemotongan stok hanya saat aksi Pack."],
];
// Header Pesanan: string-equality dengan HEADER_PESANAN di app/api/order/route.ts.
const HEADER_PESANAN = ["NoPesanan*", "Marketplace*", "Tanggal*", "SKU*", "Qty*", "HargaSatuan*", "Buyer", "FeeJenis", "FeeBasis", "FeeNilai", "PPh", "PPN%"];
const CONTOH_PESANAN = [
  ["ORD-001", "shopee", "2026-10-01", "BRG-001", 2, 129000, "Budi", "admin", "persen", 5, "YA", 11],
  ["ORD-001", "shopee", "2026-10-01", "BRG-002", 1, 159000, "Budi", "admin", "persen", 5, "YA", 11],
  ["ORD-002", "tiktok", "2026-10-02", "BRG-003", 3, 45000, "Siti", "", "", "", "TIDAK", 0],
];

// Header persis seperti export Shopee (dipakai Order import + Laba).
const HEADER_ORDERS = ["No. Pesanan", "Status Pesanan", "Status Pembatalan/ Pengembalian", "No. Resi", "Waktu Pesanan Dibuat", "Metode Pembayaran", "SKU Induk", "Nama Produk", "Nomor Referensi SKU", "Nama Variasi", "Harga Awal", "Harga Setelah Diskon", "Jumlah", "Returned quantity", "Subtotal Pesanan", "Diskon Dari Penjual", "Voucher Ditanggung Penjual", "Paket Diskon (Diskon dari Penjual)", "Username (Pembeli)", "Waktu Pesanan Selesai"];
const CONTOH_ORDERS = [
  ["261010AAA1", "Perlu Dikirim", "", "", "2026-10-10 09:15", "COD (Bayar di Tempat)", "", "Lunch Box TRI J 4in1", "001916", "PINK", "20.000", "18.232", "1", "0", "18.232", "0", "0", "0", "buyer1", ""],
  ["261010AAA2", "Telah Dikirim", "", "SPXID0000000001A", "2026-10-10 10:02", "Online Payment", "", "Pisau Set Dapur 3in1", "100331", "", "10.999", "10.879", "1", "0", "10.879", "0", "0", "0", "buyer2", ""],
];
const HEADER_ADVANCE = ["Booking SN", "No. Resi", "Opsi Pengiriman", "Booking Creation Date", "Waktu Pembayaran Dilakukan", "Nama Produk", "Nomor Referensi SKU", "SKU Induk", "Nama Variasi", "Alamat Pengiriman"];
const CONTOH_ADVANCE = [
  ["261010AAA1", "", "SPX Hemat", "2026-10-10 09:16", "2026-10-10 09:15", "Lunch Box TRI J 4in1", "001916", "", "PINK", "Jl. Contoh No.1, KOTA BANDUNG JAWA BARAT"],
  ["261010AAA1", "", "SPX Hemat", "2026-10-10 09:16", "2026-10-10 09:15", "Lunch Box TRI J 4in1", "001916", "", "BIRU", "Jl. Contoh No.1, KOTA BANDUNG JAWA BARAT"],
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...CONTOH]), "Produk");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["SKU*", "QtyFisik*", "Catatan"], ["BRG-001", 98, "hasil hitung"], ["BRG-002", 50, ""]]), "StokOpname");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["SKU*", "HPPBaru*"], ["BRG-001", 78000]]), "HPP-Update");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER_PESANAN, ...CONTOH_PESANAN]), "Pesanan");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER_ORDERS, ...CONTOH_ORDERS]), "orders");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER_ADVANCE, ...CONTOH_ADVANCE]), "Advance Fulfilment");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(PANDUAN), "PANDUAN");
XLSX.writeFile(wb, "public/template-import-produk.xlsx");
console.log("[template] public/template-import-produk.xlsx ditulis");
