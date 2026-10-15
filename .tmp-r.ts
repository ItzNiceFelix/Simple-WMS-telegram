import { bangunPdfPicklistGabung, type BarisPickGabung } from "./lib/d1/picklistGabungPdf";
const baris: BarisPickGabung[] = [
  { jenis:"order", sku:"100235", nama:"Piring 9 Jago Putih - SY", lokasi:"Gudang D19", lokasiLain:"", qty:2, kunci:"SPXID06556490134A", kirimKe:"261015N5MCBPBE", perluSku:false, skuAsal:"" },
  { jenis:"order", sku:"100235", nama:"Piring 9 Jago Putih - SY", lokasi:"Gudang D19", lokasiLain:"", qty:1, kunci:"SPXID06258391972A", kirimKe:"261014M176HS98", perluSku:false, skuAsal:"" },
  { jenis:"advance", sku:"100235", nama:"Piring 9 Jago Putih - SY", lokasi:"Gudang D19", lokasiLain:"", qty:1, kunci:"261014AASCJM2D6JJLI", kirimKe:"Pickup", perluSku:false, skuAsal:"" },
  { jenis:"order", sku:"100057", nama:"Talenan Kayu Jati", lokasi:"Gudang D19", lokasiLain:"+Gudang D12", qty:24, kunci:"R1", kirimKe:"A", perluSku:false, skuAsal:"" },
  { jenis:"advance", sku:"0518", nama:"Kemoceng", lokasi:"Gudang D12", lokasiLain:"", qty:1, kunci:"B1", kirimKe:"Pickup", perluSku:false, skuAsal:"" },
  { jenis:"order", sku:"+PERLU-SKU-AB1", nama:"Centong Pelangi", lokasi:"", lokasiLain:"", qty:4, kunci:"C1", kirimKe:"", perluSku:true, skuAsal:"SKU-SALAH-99" },
  { jenis:"advance", sku:"+PERLU-SKU-AB2", nama:"Saringan Kelapa", lokasi:"", lokasiLain:"", qty:2, kunci:"D1", kirimKe:"", perluSku:true, skuAsal:"" },
];
const bytes = await bangunPdfPicklistGabung(baris, { gudangDefault: "Semua gudang" });
const { writeFileSync } = await import("node:fs");
writeFileSync(".tmp-picklist.pdf", bytes);
console.log("PDF:", bytes.length, "byte");
