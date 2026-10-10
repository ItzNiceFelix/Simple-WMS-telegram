import X from "xlsx";
import fs from "node:fs";
import { hitungLabaPreset } from "../lib/laba/hitungLabaPreset.js";
// --- data ---
const wbI = X.readFile("C:/Users/Hanaa/Documents/Data/Income.sudah dilepas.id.20261005_20261010.xlsx");
const ri = X.utils.sheet_to_json(wbI.Sheets["Penghasilan"], { header: 1, defval: null });
const hi = ri[2].map((x) => (x ?? "").toString());
const C = (n) => hi.indexOf(n);
const num = (v) => (typeof v === "number" ? Math.round(v) : Number((v ?? "").toString().replace(/[^0-9-]/g, "")) || 0);
// kategori export per IDP
const wb2 = X.readFile("C:/Users/Hanaa/Documents/Data/Export data produk/mass_update_dts_info_9277069_20261010141748.xlsx");
const rd = X.utils.sheet_to_json(wb2.Sheets.Sheet1, { header: 1, defval: null });
const katByKode = new Map();
for (const r of rd.slice(3)) {
  const kode = (r[0] ?? "").toString();
  if (kode && r[5] && !katByKode.has(kode)) katByKode.set(kode, r[5].toString().trim());
}
// rules/tier/kat D1
const rules = JSON.parse(fs.readFileSync("dump-aktif2.json", "utf8"));
const tiers = JSON.parse(fs.readFileSync("dump-tier.json", "utf8"))[0].results;
const katRows = JSON.parse(fs.readFileSync("kat-d1.json", "utf8"))[0].results;
const tierMap = new Map(tiers.map((t) => [t.tier, t.persen_final]));
const katMap = new Map(katRows.map((r) => [r.kategori_path, r.tier]));
const { kategoriExportKeID } = await import("../lib/laba/petaKategoriShopee.js").catch(() => ({}));
let konversi = kategoriExportKeID;
if (!konversi) {
  const src = fs.readFileSync("lib/laba/petaKategoriShopee.ts", "utf8");
  const ambil = (nama) => {
    const i = src.indexOf("const " + nama);
    const j = src.indexOf("};", i) + 2;
    return eval("(" + src.slice(i).replace(/^const \w+(: Record<string, string>)? =/, "").slice(0, j - i - src.slice(i).indexOf("=") + 1).trim().replace(/;$/, "") + ")");
  };
  const PETA = ambil("PETA"), PETA_FULL = ambil("PETA_FULL");
  const PN = Object.fromEntries(Object.entries(PETA).map(([k, v]) => [k.toLowerCase(), v]));
  konversi = (katEn) => {
    const segs = katEn.replace(/^\d+\s*-\s*/, "").split("/").map((s) => (PN[s.toLowerCase().trim()] ?? s).trim()).filter(Boolean)
      .filter((s, i, a) => i === 0 || s.toLowerCase() !== a[i - 1].toLowerCase());
    if (!segs.length) return null;
    const g = segs.join(" > ");
    return PETA_FULL[g.toLowerCase()] ?? g;
  };
}
// path -> tier/go
const pathInfo = new Map(katRows.map((r) => [r.kategori_path.toLowerCase(), r]));
function resolveID(id) {
  let d = id ? pathInfo.get(id.toLowerCase()) : null;
  if (d) return { d, cara: "persis" };
  const bag = (id ?? "").split(" > ");
  for (let i = bag.length - 1; i >= 1; i--) {
    const ind = bag.slice(0, i).join(" > ");
    d = pathInfo.get(ind.toLowerCase());
    if (d) return { d, cara: "prefix" };
  }
  return { d: null, cara: "UNKNOWN" };
}
// --- kumpulkan per order: item (harga, idp->kategori) + biaya Shopee agregat (baris Order) ---
const orders = new Map();
for (const row of ri.slice(3)) {
  const no = (row[C("No. Pesanan")] ?? "").toString();
  if (!no) continue;
  if (!orders.has(no)) orders.set(no, { items: [], shopee: null });
  const o = orders.get(no);
  if (row[1] === "Sku") {
    const idp = (row[C("ID Produk")] ?? "").toString();
    const katEn = katByKode.get(idp) ?? null;
    const id = katEn ? konversi(katEn) : null;
    const { d } = resolveID(id);
    o.items.push({ harga: num(row[C("Harga Produk")]), tier: d ? d.tier : null, grup: d ? d.grup_go : null, idp });
  } else if (row[1] === "Order") {
    o.shopee = {
      admin: -num(row[C("Biaya Administrasi")]),
      proses: -num(row[C("Biaya Proses Pesanan")]),
      go: -(num(row[C("Biaya Gratis Ongkir XTRA - Ukuran Khusus (Kategori F)")]) + num(row[C("Biaya Gratis Ongkir XTRA - Ukuran Khusus (Kategori H)")]) + num(row[C("Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)")]) + num(row[C("Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori F)")]) + num(row[C("Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori G)")]) + num(row[C("Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori H)")])) || 0,
      promo: -num(row[C("Biaya Layanan Promo XTRA+")]),
      kampanye: -num(row[C("Biaya Kampanye")]),
      ams: -num(row[C("Biaya Komisi AMS")]),
      transaksi: -num(row[C("Biaya Transaksi")]),
      pph: -num(row[C("PPh 22")]),
    };
  }
}
console.log("ORDERS:" + orders.size);
// --- hitung mesin per order (tanpa HPP: HPP=0, fokus biaya) ---
// ukuran khusus: tidak diketahui per item dari Income -> asumsikan biasa (catat bila GO shopee = tarif khusus)
let n = 0, cocokAdmin = 0, cocokGO = 0, cocokPromo = 0, cocokProses = 0, cocokPph = 0, bedaList = [];
for (const [no, o] of orders) {
  if (!o.shopee || !o.items.length) continue;
  if (o.items.some((i) => !i.tier)) continue; // kategori tak petakan -> skip
  n++;
  const rows = o.items.map((it, ix) => ({
    "No. Pesanan": no, "Status Pesanan": "Selesai", "Nomor Referensi SKU": "SKU" + ix,
    "Jumlah": 1, "Returned quantity": 0, "Harga Awal": it.harga, "Harga Setelah Diskon": it.harga,
    "Subtotal Pesanan": it.harga, "Diskon Dari Penjual": 0, "Voucher Ditanggung Penjual": 0, "Paket Diskon (Diskon dari Penjual)": 0,
    _tier: it.tier, _grup: it.grup,
  }));
  const ambilSku = async (sku) => {
    const ix = Number(sku.replace("SKU", ""));
    const it = o.items[ix];
    return { hpp: 0, kategori: "__x__", tierOverride: it.tier, preOrder: false, ukuranKhusus: false, goOverride: it.grup };
  };
  const h = await hitungLabaPreset(rows, {
    preset: { id: 2, status_toko: "star_plus" }, tanggal: "2026-10-08", rules,
    tierAdmin: tierMap, kategoriTabel: new Map([["__x__", "T10"]]), ambilSku,
    konteks: { iklanPersen: null, pesananKumulatif: null, bergabungSejak: null, uploadPertama: null },
    grupGo: new Map(),
  });
  // bedah mesin: hitung ulang komponen dari rules (admin per tier + go per grup biasa + promo + proses + pph)
  const s = o.shopee;
  const adminMesin = o.items.reduce((a, it) => a + Math.round((it.harga * (tierMap.get(it.tier) ?? 0)) / 100), 0);
  if (adminMesin === s.admin) cocokAdmin++;
  const goMesin = o.items.reduce((a, it) => {
    const r = rules.find((x) => x.kode_program === "gratis_ongkir_xtra" && x.kategori === it.grup && x.ukuran === "biasa" && x.valid_from <= "2026-10-08" && (!x.valid_to || x.valid_to >= "2026-10-08"));
    if (!r) return a - 999999;
    return a + Math.min(Math.round((it.harga * r.nilai) / 100), r.plafon_per_qty * 1);
  }, 0);
  if (goMesin === s.go) cocokGO++;
  const promoMesin = o.items.reduce((a, it) => a + Math.min(Math.round((it.harga * 6.5) / 100), 80000), 0);
  // promo hanya bila shopee kenakan (toggle per order tak diketahui) -> banding bila s.promo>0
  if (s.promo > 0 ? promoMesin === s.promo : true) cocokPromo++;
  if (1250 === s.proses) cocokProses++;
  const pphMesin = o.items.reduce((a, it) => a + Math.round((it.harga * 0.5) / 100), 0);
  if (pphMesin === s.pph) cocokPph++;
  else if (bedaList.length < 15) bedaList.push({ no, bagian: "pph", mesin: pphMesin, shopee: s.pph, items: o.items.map((i) => i.harga + "/" + i.tier + "/" + i.grup).join(",") });
  if (bedaList.length < 15 && adminMesin !== s.admin) bedaList.push({ no, bagian: "admin", mesin: adminMesin, shopee: s.admin, items: o.items.map((i) => i.harga + "/" + i.tier).join(",") });
  if (bedaList.length < 25 && goMesin !== s.go && goMesin >= 0) bedaList.push({ no, bagian: "go", mesin: goMesin, shopee: s.go, items: o.items.map((i) => i.harga + "/" + i.grup).join(",") });
  void h;
}
console.log("DIBANDING:" + n);
console.log("COCOK admin:" + cocokAdmin + " go:" + cocokGO + " promo:" + cocokPromo + " proses:" + cocokProses + " pph:" + cocokPph);
for (const b of bedaList) console.log(" BEDA " + b.bagian + " " + b.no + " mesin=" + b.mesin + " shopee=" + b.shopee + " [" + b.items + "]");
