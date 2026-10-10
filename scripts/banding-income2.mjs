import X from "xlsx";
import fs from "node:fs";
// Banding final: biaya Income vs mesin preset 2, grup+ukuran dari master D1 (go_override hasil bukti Income).
const wbI = X.readFile("C:/Users/Hanaa/Documents/Data/Income.sudah dilepas.id.20261005_20261010.xlsx");
const ri = X.utils.sheet_to_json(wbI.Sheets["Penghasilan"], { header: 1, defval: null });
const hi = ri[2].map((x) => (x ?? "").toString());
const C = (n) => hi.indexOf(n);
const num = (v) => (typeof v === "number" ? Math.round(v) : Number((v ?? "").toString().replace(/[^0-9-]/g, "")) || 0);
// IDP -> SKU master (varian dulu)
const wb = X.readFile("C:/Users/Hanaa/Documents/Data/Export data produk/mass_update_sales_info_9277069_20261010141913.xlsx");
const rs = X.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: null });
const skuByKode = new Map();
for (const r of rs.slice(3)) {
  const kode = (r[0] ?? "").toString();
  if (!kode) continue;
  if (!skuByKode.has(kode)) skuByKode.set(kode, { v: [], i: [] });
  const sku = (r[5] ?? "").toString().trim().toUpperCase();
  const ind = (r[4] ?? "").toString().trim().toUpperCase();
  if (sku) skuByKode.get(kode).v.push(sku);
  else if (ind) skuByKode.get(kode).i.push(ind);
}
const master = new Map(JSON.parse(fs.readFileSync("dump-master.json", "utf8"))[1].results.map((r) => [r.sku.toUpperCase(), r]));
const tiers = new Map(JSON.parse(fs.readFileSync("dump-tier.json", "utf8"))[0].results.map((t) => [t.tier, t.persen_final]));
const katRows = JSON.parse(fs.readFileSync("kat-d1.json", "utf8"))[0].results;
const katTier = new Map(katRows.map((r) => [r.kategori_path, r.tier]));
const katGo = new Map(katRows.filter((r) => r.grup_go).map((r) => [r.kategori_path, r.grup_go]));
function tierOf(m) {
  if (m.tier_override) return m.tier_override;
  return katTier.get(m.kategori) ?? null;
}
function grupOf(m) {
  if (m.go_override) return m.go_override;
  return katGo.get(m.kategori) ?? null;
}
const GOS = ["Biaya Gratis Ongkir XTRA - Ukuran Khusus (Kategori F)", "Biaya Gratis Ongkir XTRA - Ukuran Khusus (Kategori H)", "Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)", "Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori F)", "Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori G)", "Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori H)"];
// kumpulkan per order
const orders = new Map();
for (const row of ri.slice(3)) {
  const no = (row[C("No. Pesanan")] ?? "").toString();
  if (!no) continue;
  if (!orders.has(no)) orders.set(no, { items: [], shopee: null });
  const o = orders.get(no);
  if (row[1] === "Sku") {
    const idp = (row[C("ID Produk")] ?? "").toString();
    const g = skuByKode.get(idp);
    const cands = [...(g?.v ?? []), ...(g?.i ?? [])].filter((s) => master.has(s));
    o.items.push({ harga: num(row[C("Harga Produk")]), idp, skus: cands });
  } else if (row[1] === "Order") {
    o.shopee = {
      admin: -num(row[C("Biaya Administrasi")]), proses: -num(row[C("Biaya Proses Pesanan")]),
      go: -GOS.reduce((a, k) => a + num(row[C(k)]), 0),
      promo: -num(row[C("Biaya Layanan Promo XTRA+")]), pph: -num(row[C("PPh 22")]),
    };
  }
}
// GO rule lookup
const rules = JSON.parse(fs.readFileSync("dump-aktif2.json", "utf8"));
function goRule(grup, khusus) {
  const c = rules.filter((x) => x.kode_program === "gratis_ongkir_xtra" && x.kategori === grup && (x.ukuran === (khusus ? "khusus" : "biasa")) && x.valid_from <= "2026-10-08");
  c.sort((a, b) => b.id - a.id);
  return c[0] ?? null;
}
let n = 0, cA = 0, cG = 0, cP = 0, cPr = 0, cPh = 0;
const beda = [];
for (const [no, o] of orders) {
  if (!o.shopee || !o.items.length) continue;
  if (o.items.some((i) => !i.skus.length)) continue;
  n++;
  // admin: tier per SKU pertama (varian utama); bila multi-SKU beda tier, pakai proporsi? sederhanakan: SKU pertama
  let adminM = 0, goM = 0, promoM = 0;
  for (const it of o.items) {
    const m = master.get(it.skus[0]);
    const t = tierOf(m);
    adminM += Math.round((it.harga * (tiers.get(t) ?? 0)) / 100);
    const gr = grupOf(m);
    const r = gr ? goRule(gr, !!m.ukuran_khusus) : null;
    if (r) goM += Math.min(Math.round((it.harga * r.nilai) / 100), r.plafon_per_qty);
    promoM += Math.min(Math.round((it.harga * 6.5) / 100), 80000);
  }
  const pphM = Math.round((o.items.reduce((a, i) => a + i.harga, 0) * 0.5) / 100);
  const s = o.shopee;
  if (adminM === s.admin) cA++;
  else if (beda.length < 12) beda.push({ no, b: "admin", m: adminM, s: s.admin });
  if (goM === s.go) cG++;
  else if (beda.length < 24) beda.push({ no, b: "go", m: goM, s: s.go });
  if (s.promo > 0 ? promoM === s.promo : true) cP++;
  if (s.proses === 1250) cPr++;
  if (pphM === s.pph) cPh++;
  else if (beda.length < 30) beda.push({ no, b: "pph", m: pphM, s: s.pph });
}
console.log("DIBANDING:" + n + " admin:" + cA + " go:" + cG + " promo:" + cP + " proses:" + cPr + " pph:" + cPh);
for (const b of beda) console.log(" BEDA " + b.b + " " + b.no + " mesin=" + b.m + " shopee=" + b.s);
