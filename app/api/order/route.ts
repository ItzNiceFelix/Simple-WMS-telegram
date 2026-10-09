// app/api/order/route.ts — Import pesanan 2-fase + transisi fulfill + rekap laba (Fase 3a).
// POST { aksi:'preview', rows } → validasi per baris → import_batches(tipe='pesanan') + import_errors → { batch_id, total, sukses, gagal, peringatan }.
// POST { aksi:'konfirmasi', batch_id } → imporPesanan → { ok, order, item }.
// POST { aksi:'transisi', marketplace, no_pesanan, ke } → transisiFulfill.
// GET ?aksi=rekap&dari=&sampai=&mp=&status=&sku=&limit= → { ok, orders:[...rincian], agregat }.
//   sku diisi → tiap baris berisi PORSI SKU itu (porsiSku) + `porsi_sku: true`,
//   bukan total order; agregat = jumlah porsi. Lihat hitungRekap.
// GET ?aksi=pdf&<filter sama> → application/pdf (tabel rekap; baris+agregat dari hitungRekap yang sama).
//   Saat `sku` diisi, tabel PDF menganotasi " (porsi SKU X)" pada judul.
// Semua owner/admin (tulis + rekap laba sensitif).
import { getDb } from "@/lib/d1/db";
import { ambilProduk } from "@/lib/d1/produk";
import { ambilOrder, hitungLaba, imporPesanan, listOrder, porsiSku, transisiFulfill, type BarisPesanan, type OrderDetail } from "@/lib/d1/order";
import { transisiFulfillBatch, type KeFulfill } from "@/lib/d1/orderTransisi";
import { bangunPdfRekap } from "@/lib/d1/rekapPdf";
import { buatPicklist } from "@/lib/d1/picklist";
import { bangunPdfPicklist } from "@/lib/d1/picklistPdf";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { gabungkanSheetShopee, type ShopeeDisposition, type ShopeeOrderRow, type ShopeeAdvanceRow } from "@/lib/d1/orderImportShopee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Header template 12 kolom — string equality dengan Task 5 (sheet Pesanan).
const HEADER_PESANAN = ["NoPesanan*", "Marketplace*", "Tanggal*", "SKU*", "Qty*", "HargaSatuan*", "Buyer", "FeeJenis", "FeeBasis", "FeeNilai", "PPh", "PPN%"];

const FEE_VALID = ["admin", "service", "komisi", "ongkir", "voucher", "affiliate", "iklan", "lain"];
const KE_VALID = ["pack", "kirim", "selesai", "batal"];
const MAKS_BARIS = 5000;

type BarisGagal = { baris: number; pesan: string };
type RincianOrder = OrderDetail & { laba: number; margin: number; omzet: number; hpp: number; biaya: number; pph: number; ppn: number; porsi_sku?: true };
type AgregatRekap = { order: number; omzet: number; hpp: number; biaya: number; pph: number; ppn: number; laba: number; margin: number };
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
    const nilai = row["FeeNilai"] == null || row["FeeNilai"] === "" ? 0 : Number(row["FeeNilai"]);
    if (!Number.isFinite(nilai) || nilai < 0) return { ok: false, pesan: `Baris ${noBaris}: FeeNilai harus angka ≥ 0 (desimal boleh).` };
    if (feeBasis === "persen" && nilai > 100) return { ok: false, pesan: `Baris ${noBaris}: FeeNilai persen maksimal 100.` };
    feeNilai = nilai;
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

type FilterRekap = { mp?: string; status?: string; sku?: string; dari?: number; sampai?: number; limit: number };

/** Filter query string untuk rekap JSON & PDF (satu sumber agar tak drift). */
function filterDariQuery(url: URL): { ok: true; filter: FilterRekap } | { ok: false; error: string } {
  const dariTeks = url.searchParams.get("dari") || "";
  const sampaiTeks = url.searchParams.get("sampai") || "";
  const filter: FilterRekap = {
    mp: url.searchParams.get("mp")?.trim().toLowerCase() || undefined,
    status: url.searchParams.get("status")?.trim() || undefined,
    sku: url.searchParams.get("sku")?.trim().toUpperCase() || undefined,
    limit: ((): number => {
      const n = Number(url.searchParams.get("limit"));
      return Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 100;
    })(),
  };
  if (dariTeks) {
    const d = tanggalKeEpoch(dariTeks);
    if (d === null) return { ok: false, error: "Param dari harus YYYY-MM-DD." };
    filter.dari = d;
  }
  if (sampaiTeks) {
    const s = tanggalKeEpoch(sampaiTeks);
    if (s === null) return { ok: false, error: "Param sampai harus YYYY-MM-DD." };
    filter.sampai = s + 86399;
  }
  return { ok: true, filter };
}

/** Baris + agregat rekap (dipakai JSON ?aksi=rekap dan PDF ?aksi=pdf). */
async function hitungRekap(db: D1Database, f: FilterRekap): Promise<{ orders: RincianOrder[]; agregat: AgregatRekap }> {
  const daftar = await listOrder(db, { mp: f.mp, status: f.status, dari: f.dari, sampai: f.sampai, limit: f.limit });
  const orders: RincianOrder[] = [];
  const agregat = { order: 0, omzet: 0, hpp: 0, biaya: 0, pph: 0, ppn: 0, laba: 0, margin: 0 };
  for (const h of daftar) {
    const d = await ambilOrder(db, h.marketplace, h.no_pesanan);
    if (!d) continue;
    if (f.sku && !d.items.some((i) => i.sku === f.sku)) continue;
    const r = hitungLaba(d.items, d.fees, d.pajak_pph, d.pajak_ppn_persen);
    // Filter sku = rekap per SKU: angka baris HARUS porsi SKU itu, bukan total order
    // (order multi-SKU akan menyesatkan bila total). Tanpa filter sku: total order.
    const angka = f.sku ? porsiSku(d.items, r, f.sku) : { omzet: r.omzet, hpp: r.hpp, biaya: r.biaya, pph: r.pph, ppn: r.ppn, laba: r.laba, margin: r.margin };
    orders.push({ ...d, ...angka });
    agregat.order += 1;
    agregat.omzet += angka.omzet; agregat.hpp += angka.hpp; agregat.biaya += angka.biaya;
    agregat.pph += angka.pph; agregat.ppn += angka.ppn; agregat.laba += angka.laba;
  }
  agregat.margin = agregat.omzet > 0 ? (agregat.laba / agregat.omzet) * 100 : 0;
  return { orders, agregat };
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi");
  if (aksi === "picklist-pdf") {
    const db = getDb();
    const raw = url.searchParams.get("targets") ?? "[]";
    let targets: { mp: string; no: string }[];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("bukan array");
      targets = (parsed as Record<string, unknown>[]).map((t) => ({ mp: teks(t.marketplace).toLowerCase(), no: teks(t.no_pesanan) }));
    } catch {
      return json({ ok: false, error: "Parameter targets tidak valid." }, 400);
    }
    const pick = await buatPicklist(db, targets);
    if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
    const bytes = await bangunPdfPicklist(pick.rows, pick.orders);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="picklist.pdf"`,
        "cache-control": "no-store",
      },
    });
  }
  if (aksi !== "rekap" && aksi !== "pdf" && aksi !== "preset") return json({ ok: true, header: HEADER_PESANAN });
  if (aksi === "preset") {
    const db = getDb();
    const { results } = await db.prepare("SELECT marketplace, jenis, basis, nilai FROM mp_fee_presets ORDER BY marketplace, jenis").all<{ marketplace: string; jenis: string; basis: string; nilai: number }>();
    return json({ ok: true, presets: results });
  }
  const f = filterDariQuery(url);
  if (!f.ok) return json({ ok: false, error: f.error }, 400);
  const db = getDb();
  const { orders, agregat } = await hitungRekap(db, f.filter);
  if (aksi === "rekap") return json({ ok: true, orders, agregat });
  const bytes = await bangunPdfRekap(
    orders.map((o) => ({
      no_pesanan: o.no_pesanan, marketplace: o.marketplace,
      omzet: o.omzet, hpp: o.hpp, biaya: o.biaya, pph: o.pph, ppn: o.ppn, laba: o.laba,
    })),
    agregat,
    f.filter.sku ? `porsi SKU ${f.filter.sku}` : undefined
  );
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="rekap-laba.pdf"`,
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const db = getDb();

  if (aksi === "preset-tambah") {
    const mp = teks(body.marketplace).toLowerCase();
    const jenis = teks(body.jenis).toLowerCase();
    const basis = teks(body.basis).toLowerCase();
    const nilai = body.nilai;
    if (!mp) return json({ ok: false, error: "Marketplace wajib diisi." }, 400);
    if (!FEE_VALID.includes(jenis)) return json({ ok: false, error: "Jenis fee tak dikenal (admin/service/komisi/ongkir/voucher/affiliate/iklan/lain)." }, 400);
    if (basis !== "flat" && basis !== "persen") return json({ ok: false, error: "Basis harus flat/persen." }, 400);
    if (typeof nilai !== "number" || !Number.isFinite(nilai) || nilai < 0) return json({ ok: false, error: "Nilai harus angka ≥ 0 (desimal boleh, mis. 3.5)." }, 400);
    if (basis === "persen" && nilai > 100) return json({ ok: false, error: "Persen maksimal 100." }, 400);
    await db.prepare("INSERT OR REPLACE INTO mp_fee_presets (marketplace, jenis, basis, nilai) VALUES (?, ?, ?, ?)").bind(mp, jenis, basis, nilai).run();
    return json({ ok: true });
  }

  if (aksi === "preset-hapus") {
    const mp = teks(body.marketplace).toLowerCase();
    const jenis = teks(body.jenis).toLowerCase();
    if (!mp || !jenis) return json({ ok: false, error: "Marketplace + jenis wajib diisi." }, 400);
    await db.prepare("DELETE FROM mp_fee_presets WHERE marketplace = ? AND jenis = ?").bind(mp, jenis).run();
    return json({ ok: true });
  }

  if (aksi === "transisi-batch") {
    const daftar = Array.isArray(body.targets) ? body.targets : [];
    if (daftar.length === 0) return json({ ok: false, error: "Daftar order kosong." }, 400);
    if (daftar.length > 200) return json({ ok: false, error: "Maksimal 200 order per aksi." }, 400);
    const targets: { mp: string; no: string; ke: KeFulfill }[] = [];
    for (const t of daftar as Record<string, unknown>[]) {
      const mp = teks(t.marketplace).toLowerCase();
      const no = teks(t.no_pesanan);
      const ke = teks(t.ke);
      if (!mp || !no) return json({ ok: false, error: "Marketplace + NoPesanan wajib diisi." }, 400);
      if (!KE_VALID.includes(ke)) return json({ ok: false, error: "Transisi tidak dikenal (pack/kirim/selesai/batal)." }, 400);
      targets.push({ mp, no, ke: ke as KeFulfill });
    }
    const hasil = await transisiFulfillBatch(db, targets, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, count: hasil.count, status: hasil.status });
  }

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
  if (aksi === "preview-shopee") {
    const orderRows = Array.isArray(body.ordersRows) ? body.ordersRows as ShopeeOrderRow[] : [];
    const advanceRows = Array.isArray(body.advanceRows) ? body.advanceRows as ShopeeAdvanceRow[] : [];
    if (orderRows.length === 0 && advanceRows.length === 0) return json({ ok: false, error: "Sheet orders/Advance Fulfilment kosong." }, 400);
    const dispositions = body.dispositions && typeof body.dispositions === "object" ? body.dispositions as Record<string, ShopeeDisposition> : {};
    const gabung = await gabungkanSheetShopee(orderRows, advanceRows, async (sku) => Boolean(await ambilProduk(db, sku)), dispositions);
    const file = typeof body.file === "string" ? body.file.trim().slice(0, 120) : "orders.xlsx";
    const ins = await db.prepare("INSERT INTO import_batches (tipe, file, total, sukses, gagal, gudang_id, payload_json, status, at, by) VALUES ('pesanan_shopee', ?, ?, ?, ?, 'ONLINE', ?, 'preview', ?, ?)").bind(file, orderRows.length + advanceRows.length, gabung.orders.length, gabung.gagal.length, JSON.stringify(gabung.orders), Math.floor(Date.now() / 1000), user.tg_id).run();
    return json({ ok: true, batch_id: Number(ins.meta.last_row_id), orders: gabung.orders, review: gabung.review, gagal: gabung.gagal });
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

  if (aksi === "konfirmasi-shopee") {
    if (typeof body.batch_id !== "number") return json({ ok: false, error: "batch_id wajib angka." }, 400);
    const batch = await db.prepare("SELECT id, payload_json FROM import_batches WHERE id = ? AND status = 'preview' AND tipe = 'pesanan_shopee'").bind(body.batch_id).first<{ id: number; payload_json: string }>();
    if (!batch) return json({ ok: false, error: "Batch tidak ditemukan / sudah diproses." }, 404);
    let daftar: { no_pesanan: string; tanggal: number; buyer: string; noResi: string; statusAwal: "pending" | "kirim"; items: { sku: string; qty: number; hargaSatuan: number; subtotal: number }[] }[];
    try { daftar = JSON.parse(batch.payload_json) as typeof daftar; } catch { return json({ ok: false, error: "Payload batch rusak." }, 500); }
    if (!Array.isArray(daftar) || daftar.length === 0) return json({ ok: false, error: "Tak ada order valid untuk disimpan." }, 400);
    const stmts: D1PreparedStatement[] = [];
    for (const o of daftar) {
      stmts.push(db.prepare("INSERT INTO orders (marketplace, no_pesanan, tanggal, buyer, status_fulfill, pajak_pph, pajak_ppn_persen, stok_dikurangi, no_resi) VALUES ('shopee', ?, ?, ?, ?, 0, 0, 0, ?) ON CONFLICT(marketplace, no_pesanan) DO UPDATE SET tanggal = excluded.tanggal, buyer = excluded.buyer, no_resi = excluded.no_resi, status_fulfill = CASE WHEN orders.status_fulfill = 'pending' THEN excluded.status_fulfill ELSE orders.status_fulfill END").bind(o.no_pesanan, o.tanggal, o.buyer, o.statusAwal, o.noResi));
      stmts.push(db.prepare("DELETE FROM order_items WHERE marketplace = 'shopee' AND no_pesanan = ?").bind(o.no_pesanan));
      for (const item of o.items) stmts.push(db.prepare("INSERT INTO order_items (marketplace, no_pesanan, sku, qty, harga_satuan, hpp_snapshot, subtotal) VALUES ('shopee', ?, ?, ?, ?, COALESCE((SELECT hpp FROM products WHERE sku = ?), 0), ?)").bind(o.no_pesanan, item.sku, item.qty, item.hargaSatuan, item.sku, item.subtotal));
    }
    await db.batch(stmts);
    await db.prepare("UPDATE import_batches SET status = 'done', sukses = ? WHERE id = ?").bind(daftar.reduce((n, o) => n + o.items.length, 0), batch.id).run();
    return json({ ok: true, order: daftar.length, item: daftar.reduce((n, o) => n + o.items.length, 0) });
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
    const hasil = await imporPesanan(db, daftar, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    await db.prepare("UPDATE import_batches SET status = 'done', sukses = ? WHERE id = ?").bind(hasil.item, batch.id).run();
    return json({ ok: true, order: hasil.order, item: hasil.item, batch_id: batch.id });
  }

  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
