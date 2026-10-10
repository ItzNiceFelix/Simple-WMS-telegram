import { hitungLabaPreset } from "../lib/laba/hitungLabaPreset.js";
import fs from "node:fs";
const rules = JSON.parse(fs.readFileSync("dump-aktif2.json", "utf8"));
const dump = JSON.parse(fs.readFileSync("dump-master.json", "utf8"));
const tiers = dump[0].results;
const prods = dump[1].results;
const tierMap = new Map(tiers.map((t) => [t.tier, t.persen_final]));
const katRows = JSON.parse(fs.readFileSync("kat-d1.json", "utf8"))[0].results;
const katMap = new Map(katRows.map((r) => [r.kategori_path, r.tier]));
const goMap = new Map(katRows.filter((r) => r.grup_go).map((r) => [r.kategori_path, r.grup_go]));
const prodMap = new Map(prods.map((p) => [p.sku.toUpperCase(), p]));
prodMap.get("001597").ukuran_khusus = 1;
const ambilSku = async (sku) => {
  const p = prodMap.get(sku.toUpperCase());
  if (!p) return null;
  return { hpp: p.hpp, kategori: p.kategori, tierOverride: p.tier_override, preOrder: !!p.pre_order, ukuranKhusus: !!p.ukuran_khusus, goOverride: p.go_override ?? null };
};
const baris = (sku, subtotal) => ({
  "No. Pesanan": "UJI-" + sku,
  "Status Pesanan": "Selesai",
  "Nomor Referensi SKU": sku,
  "SKU Induk": "",
  "Jumlah": 1,
  "Returned quantity": 0,
  "Harga Awal": subtotal,
  "Harga Setelah Diskon": subtotal,
  "Subtotal Pesanan": subtotal,
  "Diskon Dari Penjual": 0,
  "Voucher Ditanggung Penjual": 0,
  "Paket Diskon (Diskon dari Penjual)": 0,
});
async function uji(sku, subtotal) {
  const h = await hitungLabaPreset([baris(sku, subtotal)], {
    preset: { id: 2, status_toko: "star_plus" },
    tanggal: "2026-10-10",
    rules,
    tierAdmin: tierMap,
    kategoriTabel: katMap,
    ambilSku,
    konteks: { iklanPersen: null, pesananKumulatif: null, bergabungSejak: null, uploadPertama: null },
    grupGo: goMap,
  });
  console.log(sku, JSON.stringify({ omzet: h.omzet, hpp: h.hpp, biaya: h.biaya, laba: h.laba, peringatan: h.peringatan, tolak: h.tolak }));
}
await uji("001597", 107000);
await uji("100331", 10879);
