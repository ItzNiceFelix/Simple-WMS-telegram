// app/api/order/route.ts — Import pesanan 2-fase + transisi fulfill + rekap laba (Fase 3a).
// POST { aksi:'preview', rows } → validasi per baris → import_batches(tipe='pesanan') + import_errors → { batch_id, total, sukses, gagal, peringatan }.
// POST { aksi:'konfirmasi', batch_id } → imporPesanan → { ok, order, item }.
// POST { aksi:'transisi', marketplace, no_pesanan, ke } → transisiFulfill.
// GET ?aksi=rekap&dari=&sampai=&mp=&status=&sku=&limit= → { ok, orders:[...rincian], agregat }.
// Semua owner/admin (tulis + rekap laba sensitif).
import { getDb } from "@/lib/d1/db";
import { ambilProduk } from "@/lib/d1/produk";
import { ambilOrder, hitungLaba, imporPesanan, listOrder, transisiFulfill, type BarisPesanan, type OrderDetail } from "@/lib/d1/order";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Header template 12 kolom — string equality dengan Task 5 (sheet Pesanan).
const HEADER_PESANAN = ["NoPesanan*", "Marketplace*", "Tanggal*", "SKU*", "Qty*", "HargaSatuan*", "Buyer", "FeeJenis", "FeeBasis", "FeeNilai", "PPh", "PPN%"];

const FEE_VALID = ["admin", "service", "komisi", "ongkir", "voucher", "affiliate", "iklan", "lain"];
const KE_VALID = ["pack", "kirim", "selesai", "batal"];
const MAKS_BARIS = 5000;

type BarisGagal = { baris: number; pesan: string };
type RincianOrder = OrderDetail & { laba: number; margin: number; omzet: number };
function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function intBaris(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : (NaN as unknown as null);
}

function tanggalKeEpoch(t: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return null;
  return Math.floor(dt.getTime() / 1000);
}

async function validasiBarisPesanan(db: D1Database, row: Record<string, unknown>, noBaris: number, cekSku: Map<string, boolean>): Promise<{ ok: true; data: BarisPesanan } | { ok: false; pesan: string }> {
  const no = teks(row["NoPesanan*"]);
  const mp = teks(row["Marketplace*"]).toLowerCase();
  if (!no) return { ok: false, pesan: `Baris ${noBaris}: NoPesanan wajib diisi.` };
  if (!mp) return { ok: false, pesan: `Baris ${noBaris}: Marketplace wajib diisi.` };
  const tanggal = tanggalKeEpoch(teks(row["Tanggal*"]));
  if (tanggal === null) return { ok: false, pesan: `Baris ${noBaris}: Tanggal harus YYYY-MM-DD valid.` };
  const sku = teks(row["SKU*"] ?? row["SKU"]).toUpperCase();
  if (!sku) return { ok: false, pesan: `Baris ${noBaris}: SKU wajib diisi.` };
  let ada = cekSku.get(sku);
  if (ada === undefined) {
    ada = (await ambilProduk(db, sku)) !== null;
    cekSku.set(sku, ada);
  }
  if (!ada) return { ok: false, pesan: `Baris ${noBaris}: SKU ${sku} tidak dikenal.` };
  const qty = intBaris(row["Qty*"]);
  if (qty === null || Number.isNaN(qty as unknown as number) || (qty as number) < 1) return { ok: false, pesan: `Baris ${noBaris}: Qty harus bilangan bulat ≥ 1.` };
  const harga = intBaris(row["HargaSatuan*"]);
  if (harga === null || Number.isNaN(harga as unknown as number) || (harga as number) < 0) return { ok: false, pesan: `Baris ${noBaris}: HargaSatuan harus bilangan bulat ≥ 0.` };
  const feeJenis = teks(row["FeeJenis"]).toLowerCase();
  if (feeJenis && !FEE_VALID.includes(feeJenis)) return { ok: false, pesan: `Baris ${noBaris}: FeeJenis tak dikenal (${FEE_VALID.join("/")}).` };
  let feeBasis: "flat" | "persen" = "flat";
  let feeNilai = 0;
  if (feeJenis) {
    const basis = teks(row["FeeBasis"]).toLowerCase() || "flat";
    if (basis !== "flat" && basis !== "persen") return { ok: false, pesan: `Baris ${noBaris}: FeeBasis harus flat/persen.` };
    feeBasis = basis;
    const nilai = row["FeeNilai"] == null || row["FeeNilai"] === "" ? 0 : intBaris(row["FeeNilai"]);
    if (nilai === null || Number.isNaN(nilai as unknown as number) || (nilai as number) < 0) return { ok: false, pesan: `Baris ${noBaris}: FeeNilai harus bilangan bulat ≥ 0.` };
    feeNilai = nilai as number;
  }
  const pph = teks(row["PPh"]).toUpperCase() || "YA";
  if (pph !== "YA" && pph !== "TIDAK") return { ok: false, pesan: `Baris ${noBaris}: PPh harus YA/TIDAK.` };
  const ppnTeks = teks(row["PPN%"]);
  const ppn = ppnTeks === "" ? 0 : Number(ppnTeks);
  if (!Number.isFinite(ppn) || ppn < 0) return { ok: false, pesan: `Baris ${noBaris}: PPN% harus angka ≥ 0.` };
  return {
    ok: true,
    data: {
      marketplace: mp, no_pesanan: no, tanggal, buyer: teks(row["Buyer"]), sku,
      qty: qty as number, harga_satuan: harga as number,
      ...(feeJenis ? { fee_jenis: feeJenis, fee_basis: feeBasis, fee_nilai: feeNilai } : {}),
      pajak_pph: pph === "YA", pajak_ppn_persen: ppn,
    },
  };
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  if (url.searchParams.get("aksi") !== "rekap") return json({ ok: true, header: HEADER_PESANAN });
  const dariTeks = url.searchParams.get("dari") || "";
  const sampaiTeks = url.searchParams.get("sampai") || "";
  let dari: number | undefined;
  let sampai: number | undefined;
  if (dariTeks) {
    dari = tanggalKeEpoch(dariTeks) ?? undefined;
    if (dari === undefined) return json({ ok: false, error: "Param dari harus YYYY-MM-DD." }, 400);
  }
  if (sampaiTeks) {
    const s = tanggalKeEpoch(sampaiTeks);
    if (s === null) return json({ ok: false, error: "Param sampai harus YYYY-MM-DD." }, 400);
    sampai = s + 86399;
  }
  const db = getDb();
  const mp = url.searchParams.get("mp")?.trim().toLowerCase() || undefined;
  const status = url.searchParams.get("status")?.trim() || undefined;
  const sku = url.searchParams.get("sku")?.trim().toUpperCase() || undefined;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
  const daftar = await listOrder(db, { mp, status, dari, sampai, limit });
  const orders: RincianOrder[] = [];
  const agregat = { order: 0, omzet: 0, hpp: 0, biaya: 0, pph: 0, ppn: 0, laba: 0, margin: 0 };
  for (const h of daftar) {
    const d = await ambilOrder(db, h.marketplace, h.no_pesanan);
    if (!d) continue;
    if (sku && !d.items.some((i) => i.sku === sku)) continue;
    const r = hitungLaba(d.items, d.fees, d.pajak_pph, d.pajak_ppn_persen);
    orders.push({ ...d, omzet: r.omzet, laba: r.laba, margin: r.margin });
    agregat.order += 1;
    agregat.omzet += r.omzet; agregat.hpp += r.hpp; agregat.biaya += r.biaya;
    agregat.pph += r.pph; agregat.ppn += r.ppn; agregat.laba += r.laba;
  }
  agregat.margin = agregat.omzet > 0 ? (agregat.laba / agregat.omzet) * 100 : 0;
  return json({ ok: true, orders, agregat });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const db = getDb();

  if (aksi === "transisi") {
    const mp = teks(body.marketplace).toLowerCase();
    const no = teks(body.no_pesanan);
    const ke = teks(body.ke);
    if (!mp || !no) return json({ ok: false, error: "Marketplace + NoPesanan wajib diisi." }, 400);
    if (!KE_VALID.includes(ke)) return json({ ok: false, error: "Transisi tidak dikenal (pack/kirim/selesai/batal)." }, 400);
    const hasil = await transisiFulfill(db, mp, no, ke as "pack" | "kirim" | "selesai" | "batal", user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, status: hasil.status });
  }

  if (aksi === "preview") {
    const rows = body.rows;
    if (!Array.isArray(rows) || rows.length === 0) return json({ ok: false, error: "Rows kosong." }, 400);
    if (rows.length > MAKS_BARIS) return json({ ok: false, error: `Maksimal ${MAKS_BARIS} baris per import.` }, 400);
    const sukses: BarisPesanan[] = [];
    const gagal: BarisGagal[] = [];
    const cekSku = new Map<string, boolean>();
    const lihatItem = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const noBaris = i + 2;
      const r = rows[i] as Record<string, unknown>;
      if (typeof r !== "object" || r === null) {
        gagal.push({ baris: noBaris, pesan: `Baris ${noBaris}: format baris tak dikenal.` });
        continue;
      }
      const v = await validasiBarisPesanan(db, r, noBaris, cekSku);
      if (!v.ok) {
        gagal.push({ baris: noBaris, pesan: v.pesan });
        continue;
      }
      const kunci = `${v.data.marketplace} ${v.data.no_pesanan} ${v.data.sku}`;
      if (lihatItem.has(kunci)) {
        gagal.push({ baris: noBaris, pesan: `Baris ${noBaris}: duplikat (Marketplace, NoPesanan, SKU) dalam file.` });
        continue;
      }
      lihatItem.add(kunci);
      sukses.push(v.data);
    }
    // Ruling controller: warning info (tak blokir) bila order campur baris ber-fee + tanpa-fee.
    const feePerOrder = new Map<string, { ada: number; total: number }>();
    for (const b of sukses) {
      const k = `${b.marketplace} ${b.no_pesanan}`;
      const c = feePerOrder.get(k) ?? { ada: 0, total: 0 };
      c.total += 1;
      if (b.fee_jenis) c.ada += 1;
      feePerOrder.set(k, c);
    }
    const peringatan = [...feePerOrder].filter(([, c]) => c.ada > 0 && c.ada < c.total)
      .map(([k]) => `Order ${k}: sebagian baris tanpa FeeJenis (fee hanya dari baris ber-fee; preset tak dipakai).`);
    const namaFile = typeof body.file === "string" && body.file.trim() ? body.file.trim().slice(0, 120) : "pesanan.json";
    const ins = await db.prepare("INSERT INTO import_batches (tipe, file, total, sukses, gagal, gudang_id, payload_json, status, at, by) VALUES ('pesanan', ?, ?, ?, ?, 'ONLINE', ?, 'preview', ?, ?)")
      .bind(namaFile, rows.length, sukses.length, gagal.length, JSON.stringify(sukses), Math.floor(Date.now() / 1000), user.tg_id).run();
    const batchId = Number(ins.meta.last_row_id);
    for (let i = 0; i < gagal.length; i += 100) {
      const chunk = gagal.slice(i, i + 100);
      await db.batch(chunk.map((g) => db.prepare("INSERT INTO import_errors (batch_id, baris, pesan) VALUES (?, ?, ?)").bind(batchId, g.baris, g.pesan)));
    }
    return json({ ok: true, batch_id: batchId, total: rows.length, sukses: sukses.length, gagal, peringatan });
  }

  if (aksi === "konfirmasi") {
    if (typeof body.batch_id !== "number") return json({ ok: false, error: "batch_id wajib angka." }, 400);
    const batch = await db.prepare("SELECT * FROM import_batches WHERE id = ? AND status = 'preview' AND tipe = 'pesanan'").bind(body.batch_id).first<{ id: number; payload_json: string }>();
    if (!batch) return json({ ok: false, error: "Batch tidak ditemukan / sudah diproses." }, 404);
    let daftar: BarisPesanan[] = [];
    try {
      daftar = JSON.parse(batch.payload_json) as BarisPesanan[];
    } catch {
      return json({ ok: false, error: "Payload batch rusak." }, 500);
    }
    if (!Array.isArray(daftar) || daftar.length === 0) return json({ ok: false, error: "Payload batch kosong." }, 400);
    const hasil = await imporPesanan(db, daftar, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    await db.prepare("UPDATE import_batches SET status = 'done', sukses = ? WHERE id = ?").bind(hasil.item, batch.id).run();
    return json({ ok: true, order: hasil.order, item: hasil.item, batch_id: batch.id });
  }

  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
