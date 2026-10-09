// scripts/mutasi-batch2.mjs — Pindahkan 252 SKU batch-2 dari gudang asal ke D19.
// Cara pakai: node scripts/mutasi-batch2.mjs <ID_GUDANG_D19> [--jalan]
//   Tanpa --jalan = mode cek saja (bandingkan qty file vs qty tampil di gudang asal).
//   Dengan --jalan = eksekusi mutasi per SKU via POST /api/stok/gudang (butuh cookie sesi via SW_COOKIE).
// Env: SW_BASE (default https://simple-wms-telegram.bagus-deva-nov-p.workers.dev), SW_COOKIE="swt_sesi=...".
// Ambil cookie: login di browser > DevTools > Application > Cookies > salin nilai swt_sesi.
import { readFileSync } from "node:fs";

const BASE = process.env.SW_BASE ?? "https://simple-wms-telegram.bagus-deva-nov-p.workers.dev";
const COOKIE = process.env.SW_COOKIE ?? "";
const TUJUAN = process.argv[2];
const JALAN = process.argv.includes("--jalan");
if (!TUJUAN) {
  console.error("Pakai: node scripts/mutasi-batch2.mjs <ID_GUDANG_D19> [--jalan]");
  process.exit(1);
}

const { asal: ASAL, items } = JSON.parse(readFileSync(new URL("./data-batch2.json", import.meta.url), "utf8"));
console.log(`ASAL=${ASAL} TUJUAN=${TUJUAN} SKU=${items.length} mode=${JALAN ? "JALAN" : "CEK"}`);

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

async function bacaStok() {
  const out = new Map();
  let sudah = 0;
  // Paginasi via scope=stok tanpa filter gudang (limit 2000, produk < itu).
  const res = await fetch(`${BASE}/api/baca?scope=stok&is_online=false`, { headers: { cookie: COOKIE } });
  const data = await res.json();
  if (!data.ok) throw new Error(`baca stok gagal: ${data.error}`);
  for (const r of data.rows) out.set(r.kode_barang, r.qty_per_gudang ?? {});
  sudah = data.rows.length;
  console.log(`baca: ${sudah} produk`);
  return out;
}

const peta = await bacaStok();
let cocok = 0;
const selisih = [];
for (const it of items) {
  const qtyTampil = peta.get(it.sku)?.[ASAL] ?? null;
  if (qtyTampil === it.qty) cocok++;
  else selisih.push({ sku: it.sku, file: it.qty, tampil: qtyTampil });
}
console.log(`cocok: ${cocok}/${items.length} | selisih: ${selisih.length}`);
for (const s of selisih.slice(0, 20)) console.log("  SELISIH", s.sku, `file=${s.file} tampil=${s.tampil}`);
if (selisih.length > 20) console.log(`  ... +${selisih.length - 20} lagi`);

if (!JALAN) {
  console.log("Mode CEK selesai. Tambah --jalan untuk eksekusi (hanya SKU yang cocok).");
  process.exit(selisih.length > 0 ? 2 : 0);
}
if (!COOKIE) throw new Error("SW_COOKIE kosong — butuh cookie sesi untuk tulis.");

let ok = 0;
const gagalMutasi = [];
for (const it of items) {
  if ((peta.get(it.sku)?.[ASAL] ?? null) !== it.qty) continue; // lewati yang selisih
  const res = await fetch(`${BASE}/api/stok/gudang`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: COOKIE, origin: BASE },
    body: JSON.stringify({ aksi: "mutasi-gudang", kode_barang: it.sku, dari_gudang_id: ASAL, ke_gudang_id: TUJUAN, qty: it.qty }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok) { ok++; if (ok % 25 === 0) console.log(`  ...${ok} ok`); }
  else { gagalMutasi.push({ sku: it.sku, error: data.error ?? res.status }); console.log("  GAGAL", it.sku, data.error ?? res.status); }
  await tidur(1500); // guard hanya blokir payload identik 10 dtk; SKU selalu beda
}
console.log(`SELESAI ok=${ok} gagal=${gagalMutasi.length} dilewati=${selisih.length}`);
