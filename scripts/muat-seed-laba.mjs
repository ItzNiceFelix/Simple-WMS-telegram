// scripts/muat-seed-laba.mjs — Seed remote D1 via wrangler batch (D-R2 + koreksi R-R3).
// Pakai: node scripts/muat-seed-laba.mjs (dari repo, butuh wrangler login).
// Idempoten: hanya timpa sumber LIKE 'seed:%'; manual owner utuh.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DB = "simple-wms";
const R = "/sdcard/Download/Simple-WMS-telegram/repo";
const seed = JSON.parse(readFileSync(`${R}/bundle/seed/shopee_fees_id.json`, "utf8"));
const kat = JSON.parse(readFileSync(`${R}/docs/riset-shopee/render/kategori-tarif.json`, "utf8"));
const go = JSON.parse(readFileSync(`${R}/docs/riset-shopee/render/go-tarif.json`, "utf8"));

const q = (v) => v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

function wrangler(sql) {
  const out = execFileSync("wrangler", ["d1", "execute", DB, "--remote", "--command", sql, "--json"],
    { cwd: R, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out);
}

// 1. Preset Shopee Utama
let r = wrangler(`SELECT id FROM seller_presets WHERE nama = 'Shopee Utama' AND dihapus_at IS NULL;`);
let pid = r[0]?.results?.[0]?.id;
if (!pid) {
  r = wrangler(`INSERT INTO seller_presets (nama, marketplace, status_toko) VALUES ('Shopee Utama','shopee','non_star') RETURNING id;`);
  pid = r[0]?.results?.[0]?.id;
}
console.log("preset_id:", pid);

// 2. tier_admin dari seed (upsert)
for (const t of seed.kategori_tier_admin) {
  wrangler(`INSERT INTO tier_admin (tier, persen_dasar, diskon_persen, persen_final, verifikasi) VALUES (${q(t.tier)}, NULL, 0, ${t.persen}, ${q(t.verifikasi)}) ON CONFLICT(tier) DO UPDATE SET persen_final = excluded.persen_final, verifikasi = excluded.verifikasi;`);
}
console.log("tier:", seed.kategori_tier_admin.length);

// 2b. Dasar resmi 12,5% + diskon 20% untuk tier final 10% (7882/3489 resmi)
wrangler(`UPDATE tier_admin SET persen_dasar = 12.5, diskon_persen = 20 WHERE tier = 'T10';`);
wrangler(`UPDATE tier_admin SET verifikasi = 'resmi' WHERE tier IN ('T10','T9_5','T9','T8_25','T6_75','T6_5','T5_25','T4_25','T2_5');`);

// 3. program_katalog + toggle default
for (const p of seed.programs) {
  wrangler(`INSERT INTO program_katalog (kode_program, nama, opsional) VALUES (${q(p.kode_program)}, ${q(p.nama)}, ${p.opsional ? 1 : 0}) ON CONFLICT(kode_program) DO UPDATE SET nama = excluded.nama;`);
  wrangler(`INSERT INTO preset_program (preset_id, kode_program, aktif) VALUES (${pid}, ${q(p.kode_program)}, 0) ON CONFLICT(preset_id, kode_program) DO NOTHING;`);
}
// Program baru resmi 3489
for (const [kode, nama] of [["promo_xtra_plus", "Promo XTRA+"], ["live_xtra", "Shopee Live XTRA"], ["video_xtra", "Shopee Video XTRA"]]) {
  wrangler(`INSERT INTO program_katalog (kode_program, nama, opsional) VALUES (${q(kode)}, ${q(nama)}, 1) ON CONFLICT(kode_program) DO UPDATE SET nama = excluded.nama;`);
  wrangler(`INSERT INTO preset_program (preset_id, kode_program, aktif) VALUES (${pid}, ${q(kode)}, 0) ON CONFLICT(preset_id, kode_program) DO NOTHING;`);
}
console.log("program: OK");

// 4. kategori_tarif dari render R-R2 (upsert per path)
let nKat = 0;
for (const k of kat) {
  wrangler(`INSERT INTO kategori_tarif (kategori_path, tier, grup_go, sumber, verifikasi) VALUES (${q(k.kategori_path)}, ${q(k.tier)}, ${q(k.grup_go ?? null)}, 'seed:https://seller.shopee.co.id/edu/article/7882 (render 2026-10-10)', 'resmi') ON CONFLICT(kategori_path) DO UPDATE SET tier = excluded.tier, grup_go = excluded.grup_go, verifikasi = excluded.verifikasi;`);
  nKat++;
}
console.log("kategori_tarif:", nKat);

// 5. fee_rules: hapus seed lama, insert seed + koreksi R-R3
wrangler(`DELETE FROM fee_rules WHERE preset_id = ${pid} AND sumber LIKE 'seed:%';`);
const ins = (o) => wrangler(
  `INSERT INTO fee_rules (preset_id, jenis, kode_program, kategori, status_toko, ukuran, basis, unit, nilai, plafon, plafon_per_qty, priority, valid_from, valid_to, aktif, sumber, verifikasi, status_verifikasi, syarat_json, catatan) VALUES (${pid}, ${q(o.jenis)}, ${q(o.kode_program ?? null)}, ${q(o.kategori ?? "*")}, ${q(o.status_toko ?? null)}, ${q(o.ukuran ?? null)}, ${q(o.basis)}, ${q(o.unit ?? "per_baris")}, ${o.nilai}, ${q(o.plafon ?? null)}, ${q(o.plafon_per_qty ?? null)}, 0, ${q(o.valid_from)}, ${q(o.valid_to ?? null)}, ${o.aktif === false ? 0 : 1}, 'seed:${(o.sumber ?? "").replace(/'/g, "''")}', ${q(o.verifikasi ?? "belum")}, ${(o.verifikasi === "resmi" || o.verifikasi === "resmi_cuplikan") ? "'terverifikasi'" : "'belum_diverifikasi'"}, ${o.syarat ? q(JSON.stringify(o.syarat)) : "NULL"}, ${q(o.catatan ?? null)});`);

let n = 0;
// 5a. Seed v0.1 dengan koreksi R-R3: GO T10->G; promo 2%->4.5%/60rb; PPh->resmi; proses->resmi; pre-order->resmi; spaylater->resmi
for (const rule of seed.rules) {
  const o = { ...rule, syarat: rule.syarat ?? null, plafon: rule.plafon ?? null };
  if (o.jenis === "program" && o.kode_program === "gratis_ongkir_xtra" && (o.kategori === "T10" || o.kategori === "E")) {
    o.kategori = o.kategori === "T10" ? "G" : "E"; // grup huruf resmi 24877
    o.verifikasi = "resmi"; // persen cocok render Mei 2026
  }
  if (o.kode_program === "promo_xtra") { o.nilai = 4.5; o.plafon_per_qty = 60000; o.verifikasi = "resmi"; o.sumber = "Ringkasan resmi seller.shopee.co.id/edu/article/3489: Promo XTRA 4,50%, plafon Rp60.000/kuantitas"; }
  if (o.jenis === "proses") { o.verifikasi = "resmi"; o.sumber = "Ringkasan resmi seller.shopee.co.id/edu/article/3489: Rp1.250 per pesanan terselesaikan"; }
  if (o.jenis === "pajak_pph") { o.verifikasi = "resmi"; o.sumber = "pajak.go.id: PPh 22 marketplace 0,5% + PP 55/2022"; }
  if (o.kode_program === "pre_order") { o.verifikasi = "resmi"; o.sumber = "Ringkasan resmi seller.shopee.co.id/edu/article/3489: Pre-Order 3,00% kecuali kategori tertentu"; }
  if (o.kode_program === "spaylater_xtra") { o.verifikasi = "resmi"; o.sumber = "Ringkasan resmi seller.shopee.co.id/edu/article/3489: 2,5% tenor 3 bulan"; }
  if (o.jenis === "admin") o.verifikasi = "resmi"; // cocok render 7882 penuh
  ins(o); n++;
}
// 5b. Rule baru resmi 3489
const baru = [
  { jenis: "program", kode_program: "spaylater_xtra", kategori: "*", basis: "persen", unit: "per_baris", nilai: 4.0, valid_from: "2026-01-01", aktif: false, sumber: "Ringkasan resmi 3489: SPayLater 4,0% tenor 6 bulan", verifikasi: "resmi", syarat: { tenor_bulan: 6 }, catatan: "Nonaktif default" },
  { jenis: "program", kode_program: "promo_xtra_plus", kategori: "*", basis: "persen", unit: "per_baris", nilai: 6.5, plafon_per_qty: 80000, valid_from: "2026-01-01", aktif: false, sumber: "Ringkasan resmi 3489: Promo XTRA+ 6,50%, plafon Rp80.000", verifikasi: "resmi", catatan: "Nonaktif default" },
  { jenis: "program", kode_program: "live_xtra", kategori: "*", basis: "persen", unit: "per_baris", nilai: 3.0, plafon_per_qty: 20000, valid_from: "2026-01-01", aktif: false, sumber: "Ringkasan resmi 3489: Live XTRA 3% (2% bila ikut Promo)", verifikasi: "resmi", catatan: "Nonaktif default" },
  { jenis: "program", kode_program: "video_xtra", kategori: "*", basis: "persen", unit: "per_baris", nilai: 3.0, plafon_per_qty: 20000, valid_from: "2026-01-01", aktif: false, sumber: "Ringkasan resmi 3489: Video XTRA 3% (2% bila ikut Promo)", verifikasi: "resmi", catatan: "Nonaktif default" },
];
// 5c. GO grup resmi Mei 2026 (30 baris) — nonaktif default, aktifkan per preset bila ikut program
for (const m of go.mei2026) {
  baru.push({ jenis: "program", kode_program: "gratis_ongkir_xtra", kategori: m.grup, basis: "persen", unit: "per_baris", nilai: Number(m.biasa.replace(",", ".")), plafon_per_qty: 40000, valid_from: "2026-05-02", aktif: false, sumber: "Resmi seller.shopee.co.id/edu/article/24877 (render 2026-10-10): GO biasa + plafon Rp40.000", verifikasi: "resmi", catatan: `${m.kat} (ukuran biasa)` });
  baru.push({ jenis: "program", kode_program: "gratis_ongkir_xtra", kategori: m.grup, basis: "persen", unit: "per_baris", nilai: Number(m.khusus.replace(",", ".")), plafon_per_qty: 60000, valid_from: "2026-05-02", aktif: false, sumber: "Resmi seller.shopee.co.id/edu/article/24877 (render 2026-10-10): GO khusus + plafon Rp60.000", verifikasi: "resmi", catatan: `${m.kat} (ukuran khusus)` });
}
// 5d. Tarif Des 2026 (mendatang) — valid_from 2026-12-01, nonaktif sampai berlaku
for (const m of go.des2026) {
  baru.push({ jenis: "program", kode_program: "gratis_ongkir_xtra", kategori: m.grup, basis: "persen", unit: "per_baris", nilai: Number(m.biasa.replace(",", ".")), plafon_per_qty: 40000, valid_from: "2026-12-01", aktif: false, sumber: "Resmi seller.shopee.co.id/edu/article/24877 (render 2026-10-10): tarif 1 Des 2026", verifikasi: "resmi", catatan: `${m.kat} (Des 2026, biasa)` });
  baru.push({ jenis: "program", kode_program: "gratis_ongkir_xtra", kategori: m.grup, basis: "persen", unit: "per_baris", nilai: Number(m.khusus.replace(",", ".")), plafon_per_qty: 60000, valid_from: "2026-12-01", aktif: false, sumber: "Resmi seller.shopee.co.id/edu/article/24877 (render 2026-10-10): tarif 1 Des 2026", verifikasi: "resmi", catatan: `${m.kat} (Des 2026, khusus)` });
}
for (const b of baru) { ins(b); n++; }
console.log("fee_rules seed:", n);

// 6. penghitung default
wrangler(`INSERT INTO preset_penghitung (preset_id) VALUES (${pid}) ON CONFLICT(preset_id) DO NOTHING;`);
console.log("SEED_DONE preset:", pid);
