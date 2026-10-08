// scripts/buat-template-excel.mjs — Generator template import resmi (Fase 2, PRD F3).
// Header: SKU* | Nama* | Kategori | Satuan* | StokAwal | HPP | HargaJual |
//         RakBin | StokMin | Barcode | Expired | Aktif + sheet PANDUAN.
// Export memakai header SAMA (round-trip). Jalankan: node scripts/buat-template-excel.mjs
import XLSX from "xlsx";
import { writeFileSync } from "node:fs";

const HEADER = ["SKU*", "Nama*", "Kategori", "Satuan*", "StokAwal", "HPP", "HargaJual", "RakBin", "StokMin", "Barcode", "Expired(YYYY-MM-DD)", "Aktif"];
const CONTOH = [
  ["BRG-001", "Kemeja Lengan Panjang", "Pakaian", "pcs", 100, 75000, 129000, "A-01", 10, "8991234567890", "", "YA"],
  ["BRG-002", "Celana Chino Slim", "Pakaian", "pcs", 50, 95000, 159000, "A-02", 5, "", "", "YA"],
  ["BRG-003", "Kopi Bubuk 250g", "Makanan", "pcs", 200, 28000, 45000, "B-01", 20, "", "2027-12-31", "YA"],
];
const PANDUAN = [
  ["Kolom", "Wajib", "Aturan"],
  ["SKU*", "Ya", "Unik, tanpa spasi. Contoh: BRG-001"],
  ["Nama*", "Ya", "Nama produk Accurate/master"],
  ["Kategori", "Tidak", "Bebas, untuk filter"],
  ["Satuan*", "Ya", "pcs/dus/pak/dll"],
  ["StokAwal", "Tidak", "Bilangan bulat >= 0, default 0"],
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
];
// Header Pesanan: string-equality dengan HEADER_PESANAN di app/api/order/route.ts.
const HEADER_PESANAN = ["NoPesanan*", "Marketplace*", "Tanggal*", "SKU*", "Qty*", "HargaSatuan*", "Buyer", "FeeJenis", "FeeBasis", "FeeNilai", "PPh", "PPN%"];
const CONTOH_PESANAN = [
  ["ORD-001", "shopee", "2026-10-01", "BRG-001", 2, 129000, "Budi", "admin", "persen", 5, "YA", 11],
  ["ORD-001", "shopee", "2026-10-01", "BRG-002", 1, 159000, "Budi", "admin", "persen", 5, "YA", 11],
  ["ORD-002", "tiktok", "2026-10-02", "BRG-003", 3, 45000, "Siti", "", "", "", "TIDAK", 0],
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...CONTOH]), "Produk");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["SKU*", "QtyFisik*", "Catatan"], ["BRG-001", 98, "hasil hitung"], ["BRG-002", 50, ""]]), "StokOpname");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["SKU*", "HPPBaru*"], ["BRG-001", 78000]]), "HPP-Update");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER_PESANAN, ...CONTOH_PESANAN]), "Pesanan");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(PANDUAN), "PANDUAN");
XLSX.writeFile(wb, "public/template-import-produk.xlsx");
console.log("[template] public/template-import-produk.xlsx ditulis");
