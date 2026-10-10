// scripts/isi-kategori-export.mjs — Isi products.kategori D1 dari export Shopee (2026-10-10).
// Join: SKU varian (prioritas) lalu SKU Induk. Kategori EN -> path ID via konverter modul.
// Validasi: path HARUS ada di kategori_tarif. Tanpa flag = dry-run (tulis SQL ke isi-kategori.sql).
// Pakai: node scripts/isi-kategori-export.mjs [--tulis]
import X from "xlsx";
import fs from "node:fs";

const TULIS = process.argv.includes("--tulis");
const D = "C:/Users/Hanaa/Documents/Data/Export data produk/";

let wb = X.readFile(D + "mass_update_dts_info_9277069_20261010141748.xlsx");
let rows = X.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: null });
const dts = new Map();
for (const r of rows.slice(3)) {
  const kode = (r[0] ?? "").toString().trim();
  if (!kode) continue;
  dts.set(kode, { induk: (r[1] ?? "").toString().trim().toUpperCase(), kat: (r[5] ?? "").toString().trim() });
}
wb = X.readFile(D + "mass_update_sales_info_9277069_20261010141913.xlsx");
rows = X.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: null });
const perKode = new Map();
for (const r of rows.slice(3)) {
  const kode = (r[0] ?? "").toString().trim();
  if (!kode) continue;
  if (!perKode.has(kode)) perKode.set(kode, { kat: "", skus: new Set(), induks: new Set() });
  const g = perKode.get(kode);
  const sku = (r[5] ?? "").toString().trim().toUpperCase();
  const induk = (r[4] ?? "").toString().trim().toUpperCase();
  if (sku) g.skus.add(sku);
  if (induk) g.induks.add(induk);
  const d = dts.get(kode);
  if (d) {
    if (d.induk) g.induks.add(d.induk);
    if (!g.kat && d.kat) g.kat = d.kat;
  }
}
const d1sku = new Map(JSON.parse(fs.readFileSync("dump-produk.json", "utf8"))[0].results.map((r) => [r.sku.toUpperCase(), r.kategori]));
const d1paths = new Set(JSON.parse(fs.readFileSync("kat-d1.json", "utf8"))[0].results.map((r) => r.kategori_path));
console.log("D1 produk:", d1sku.size, "| kategori_tarif:", d1paths.size);

// Konverter: impor modul TS via kompilasi esbuild sekali (atau fallback eval sudah dibuktikan).
// Di sini: baca PETA dari modul lalu eval (skrip sekali jalan, bukan runtime).
const src = fs.readFileSync("lib/laba/petaKategoriShopee.ts", "utf8");
function ambil(nama) {
  const i = src.indexOf("const " + nama);
  let j = src.indexOf("};", i) + 2;
  return eval("(" + src.slice(i).replace(/^const \w+(: Record<string, string>)? =/, "").slice(0, j - i - src.slice(i).indexOf("=") + 1).trim().replace(/;$/, "") + ")");
}
const PETA = ambil("PETA");
const PETA_FULL = ambil("PETA_FULL");
const PN = Object.fromEntries(Object.entries(PETA).map(([k, v]) => [k.toLowerCase(), v]));
const konversi = (katEn) => {
  const segs = katEn.replace(/^\d+\s*-\s*/, "").split("/").map((s) => (PN[s.toLowerCase().trim()] ?? s).trim()).filter(Boolean)
    .filter((s, i, a) => i === 0 || s.toLowerCase() !== a[i - 1].toLowerCase());
  if (!segs.length) return null;
  const g = segs.join(" > ");
  return PETA_FULL[g.toLowerCase()] ?? g;
};

const suara = new Map();
let katTakPeta = new Map();
for (const g of perKode.values()) {
  if (!g.kat) continue;
  let id = konversi(g.kat);
  if (!id || !d1paths.has(id)) {
    let ok = null;
    const bag = (id ?? "").split(" > ");
    for (let i = bag.length - 1; i >= 1; i--) {
      const ind = bag.slice(0, i).join(" > ");
      if (d1paths.has(ind)) { ok = ind; break; }
    }
    if (!ok) { katTakPeta.set(g.kat, (katTakPeta.get(g.kat) || 0) + 1); continue; }
    id = ok;
  }
  for (const s of g.skus) {
    if (!d1sku.has(s)) continue;
    if (!suara.has(s)) suara.set(s, []);
    suara.get(s).push({ id, varian: true });
  }
  for (const s of g.induks) {
    if (!d1sku.has(s)) continue;
    if (!suara.has(s)) suara.set(s, []);
    suara.get(s).push({ id, varian: false });
  }
}
const final = new Map();
for (const [s, daftar] of suara) {
  const vv = daftar.filter((d) => d.varian);
  const pool = vv.length ? vv : daftar;
  const hit = {};
  for (const d of pool) hit[d.id] = (hit[d.id] || 0) + 1;
  final.set(s, Object.entries(hit).sort((a, b) => b[1] - a[1])[0][0]);
}
const MANUAL = {
  "RTLH-TRI": "Perlengkapan Rumah > Organizer Rumah",
  "001717": "Perlengkapan Rumah > Furniture",
  "100256": "Perlengkapan Rumah > Organizer Rumah",
};
for (const [s, id] of Object.entries(MANUAL)) if (final.has(s)) final.set(s, id);

let benar = 0;
const tulis = [];
const timpa = [];
for (const [s, id] of final) {
  const lama = d1sku.get(s);
  if (lama === id) benar++;
  else { tulis.push([s, id]); if (lama) timpa.push({ sku: s, lama, baru: id }); }
}
console.log("terpetakan:", final.size, "| sudah benar:", benar, "| akan ditulis:", tulis.length, "| timpa lama:", timpa.length);
for (const t of timpa.slice(0, 10)) console.log(" TIMPA", t.sku, JSON.stringify(t.lama), "->", JSON.stringify(t.baru));
if (katTakPeta.size) { console.log("KAT_TAK_PETA:"); for (const [k, n] of katTakPeta) console.log("  " + n + "x " + k); }
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
fs.writeFileSync("isi-kategori.sql", tulis.map(([s, id]) => `UPDATE products SET kategori = ${q(id)} WHERE sku = ${q(s)};`).join("\n") + "\n");
console.log("SQL ditulis: isi-kategori.sql (" + tulis.length + " stmt)");
if (!TULIS) { console.log("DRY-RUN selesai."); process.exit(0); }
if (timpa.length) { console.log("BATAL: ada kategori lama yang akan ditimpa."); process.exit(1); }
console.log("Jalankan SQL via: wrangler d1 execute --remote --file isi-kategori.sql (dibagi chunk bila perlu)");
