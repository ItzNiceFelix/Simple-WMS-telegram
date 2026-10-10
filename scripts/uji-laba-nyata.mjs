// scripts/uji-laba-nyata.mjs — Banding mesin lama vs baru di Order.all nyata.
// Duncan: D1 prod (rules aktif preset 1, tier, kategori, HPP). Tanpa tulis snapshot.
// Pakai: node scripts/uji-laba-nyata.mjs
import X from "xlsx";
import fs from "node:fs";
import { hitungLabaPreset } from "../lib/laba/hitungLabaPreset.js";
import { hitungLabaShopee } from "../lib/d1/labaShopee.js";

const FILE = process.env.UJI_FILE || "C:/Users/Hanaa/Documents/Data/Order.shipping.20261008_20261008.xlsx";
const TGL = process.env.UJI_TGL || "2026-10-08";
const wb = X.readFile(FILE);
const head = X.utils.sheet_to_json(wb.Sheets.orders, { header: 1, defval: null });
const kolom = head[0];
const rows = head.slice(1).map((r) => Object.fromEntries(kolom.map((k, i) => [k, r[i]])));
const dump = JSON.parse(fs.readFileSync("dump-hitung.json", "utf8"));
const [rules, tiers, prods] = dump.map((r) => r.results);
const tierMap = new Map(tiers.map((t) => [t.tier, t.persen_final]));
const katMap = new Map(JSON.parse(fs.readFileSync("kat-d1.json", "utf8"))[0].results.map((r) => [r.kategori_path, r.tier]));
const prodMap = new Map(prods.map((p) => [p.sku.toUpperCase(), p]));

// --- LAMA ---
const presetsLama = rules.filter((r) => !r.kode_program && r.kategori === "*").map((r) => ({ basis: r.basis, nilai: r.nilai }));
const ambilHpp = async (sku) => prodMap.get(sku.toUpperCase())?.hpp ?? null;
const lama = await hitungLabaShopee(rows, ambilHpp, presetsLama);
console.log("LAMA:", JSON.stringify({ order: lama.jml_order, baris: lama.jml_baris, omzet: lama.omzet, hpp: lama.hpp, biaya: lama.biaya, laba: lama.laba, tolak: lama.tolak.length }));

// --- BARU ---
const ambilSku = async (sku) => {
  const p = prodMap.get(sku.toUpperCase());
  if (!p) return null;
  return { hpp: p.hpp, kategori: p.kategori, tierOverride: p.tier_override, preOrder: !!p.pre_order, ukuranKhusus: !!p.ukuran_khusus };
};
const baru = await hitungLabaPreset(rows, {
  preset: { id: 1, status_toko: "non_star" },
  tanggal: TGL,
  rules,
  tierAdmin: tierMap,
  kategoriTabel: katMap,
  ambilSku,
  konteks: { iklanPersen: null, pesananKumulatif: null, bergabungSejak: null, uploadPertama: null },
  grupGo: new Map(),
});
console.log("BARU:", JSON.stringify({ order: baru.jml_order, baris: baru.jml_baris, omzet: baru.omzet, hpp: baru.hpp, biaya: baru.biaya, laba: baru.laba, tolak: baru.tolak.length, belum: baru.jml_baris_belum_terpetakan }));
console.log("SELISIH omzet/hpp/biaya/laba:", [baru.omzet - lama.omzet, baru.hpp - lama.hpp, baru.biaya - lama.biaya, baru.laba - lama.laba].join("/"));
console.log("PERINGATAN:", JSON.stringify(baru.peringatan.slice(0, 8)));
console.log("TOLAK_CONTOH:", JSON.stringify(baru.tolak.slice(0, 5)));
