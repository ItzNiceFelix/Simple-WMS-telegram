// app/api/order/route.ts — Import pesanan 2-fase + transisi fulfill + daftar order (stok, tanpa laba).
// POST { aksi:'preview', rows } → validasi per baris → import_batches(tipe='pesanan') + import_errors → { batch_id, total, sukses, gagal, peringatan }.
// POST { aksi:'konfirmasi', batch_id } → imporPesanan → { ok, order, item }.
// POST { aksi:'transisi', marketplace, no_pesanan, ke } → transisiFulfill.
// POST { aksi:'hapus', targets:[{ marketplace, no_pesanan }] } → hapus baris order (koreksi salah impor).
// GET ?aksi=daftar&dari=&sampai=&mp=&status=&sku=&limit= → { ok, orders } (header+item+fee, tanpa laba).
// Semua owner/admin.
import { getDb } from "@/lib/d1/db";
import { ambilProduk } from "@/lib/d1/produk";
import { ambilOrder, imporPesanan, listOrder, transisiFulfill, type BarisPesanan, type OrderDetail } from "@/lib/d1/order";
import { transisiFulfillBatch, type KeFulfill } from "@/lib/d1/orderTransisi";
import { buatPicklist, buatPicklistPaket } from "@/lib/d1/picklist";
import { bangunPdfPicklist } from "@/lib/d1/picklistPdf";
import { bangunPdfPicklistPaket } from "@/lib/d1/picklistPaketPdf";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { normalisasiSheetShopee, normalisasiStatus, type GabunganOrder, type ShopeeAdvanceRow, type ShopeeOrderRow, type ShopeeBooking, type BarisBelumSku } from "@/lib/d1/orderImportShopee";
import { hitungFingerprint, cekFileSudahAda, catatImportFile } from "@/lib/d1/importFingerprint";
import { klasifikasikanImport, type OrderBaru } from "@/lib/d1/orderKlasifikasi";
import { simpanBooking, tebakSku, tandaiBelumMp, compareNama, type TebakanSku } from "@/lib/d1/advanceBelumSku";
import { isiResiGrup } from "@/lib/d1/resiGrup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Header template 7 kolom (tanpa fee/pajak — laba pindah ke /laba per preset).
const HEADER_PESANAN = ["NoPesanan*", "Marketplace*", "Tanggal*", "SKU*", "Qty*", "HargaSatuan*", "Buyer"];

const KE_VALID = ["pack", "kirim", "selesai", "batal"];
// B5-A: cap 500 baris (konsisten excel produk); konfirmasi batch 50 tetap.
const MAKS_BARIS = 500;
const MODE_PICKLIST = ["per_paket", "pisah", "gabung"] as const;
type ModePicklist = (typeof MODE_PICKLIST)[number];

/** Ada resi gabungan (jumlah_order > 1) di antara targets → default picklist per paket (D3). */
async function pakaiPerPaket(db: D1Database, targets: { mp: string; no: string }[]): Promise<boolean> {
  const noList = [...new Set(targets.map((t) => t.no).filter(Boolean))];
  if (noList.length === 0) return false;
  for (let i = 0; i < noList.length; i += 50) {
    const potong = noList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM orders o JOIN resi_grup g ON g.no_resi = o.no_resi WHERE o.no_pesanan IN (${tanda}) AND g.jumlah_order > 1`)
      .bind(...potong)
      .first<{ n: number }>();
    if ((row?.n ?? 0) > 0) return true;
  }
  return false;
}

/** Ringkasan review sebelum cetak: status fulfill + grup resi + sisa bayar COD (info saja). */
async function ringkasReview(db: D1Database, targets: { mp: string; no: string }[]): Promise<{ no_pesanan: string; no_resi: string; status: string; grup: number; sesuaKriteria: number }[]> {
  const noList = [...new Set(targets.map((t) => t.no).filter(Boolean))];
  const keluar: { no_pesanan: string; no_resi: string; status: string; grup: number; sesuaKriteria: number }[] = [];
  for (let i = 0; i < noList.length; i += 50) {
    const potong = noList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT o.no_pesanan, o.no_resi, o.status_fulfill, COALESCE(g.jumlah_order, 1) AS grup, COALESCE(g.sesuai_kriteria, 1) AS sesuaKriteria
         FROM orders o LEFT JOIN resi_grup g ON g.no_resi = o.no_resi WHERE o.no_pesanan IN (${tanda})`,
      )
      .bind(...potong)
      .all<{ no_pesanan: string; no_resi: string; status_fulfill: string; grup: number; sesuaKriteria: number }>();
    for (const r of results) keluar.push({ no_pesanan: r.no_pesanan, no_resi: r.no_resi, status: r.status_fulfill, grup: r.grup, sesuaKriteria: r.sesuaKriteria });
  }
  return keluar;
}

type BarisGagal = { baris: number; pesan: string };
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
  return {
    ok: true,
    data: {
      marketplace: mp, no_pesanan: no, tanggal, buyer: teks(row["Buyer"]), sku,
      qty: qty as number, harga_satuan: harga as number,
    },
  };
}

type FilterDaftar = { mp?: string; status?: string; sku?: string; dari?: number; sampai?: number; limit: number };

/** Filter query string untuk daftar order. */
function filterDariQuery(url: URL): { ok: true; filter: FilterDaftar } | { ok: false; error: string } {
  const dariTeks = url.searchParams.get("dari") || "";
  const sampaiTeks = url.searchParams.get("sampai") || "";
  const filter: FilterDaftar = {
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
    // D7-T7: per_paket = 1 lembar per no_resi (default utk resi gabungan); pisah = agregat per SKU (mode lama).
    const modeMinta = (url.searchParams.get("mode") ?? "").trim();
    if (modeMinta === "review") {
      const ringkas = await ringkasReview(db, targets);
      return json({ ok: true, ringkas });
    }
    const mode = modeMinta === "" ? ((await pakaiPerPaket(db, targets)) ? "per_paket" : "pisah") : modeMinta;
    if (mode !== "per_paket" && mode !== "pisah" && mode !== "gabung") return json({ ok: false, error: "Mode harus per_paket/pisah/gabung." }, 400);
    const namaFile = mode === "per_paket" ? "picklist-per-paket.pdf" : mode === "gabung" ? "picklist-gabung.pdf" : "picklist.pdf";
    const header = {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${namaFile}"`,
        "cache-control": "no-store",
      },
    };
    if (mode === "gabung") {
      const pick = await buatPicklistPaket(db, targets);
      if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
      const semua = pick.paket.flatMap((p) => p.rows.map((r) => ({ sku: r.sku, nama: r.nama, qty: r.qty, variasi: r.variasi ?? "", no_resi: p.no_resi })));
      if (semua.length === 0) return json({ ok: false, error: "Tak ada item untuk dicetak." }, 400);
      const bytes = await bangunPdfPicklistPaket(semua, { mode: "gabung", judul: "PICKLIST ORDER — GABUNG PER PAKET", subjudul: `${pick.paket.length} paket`, gudang: "Gudang ONLINE" });
      return new Response(new Uint8Array(bytes), header);
    }
    if (mode === "per_paket") {
      const pick = await buatPicklistPaket(db, targets);
      if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
      const bytes = await bangunPdfPicklistPaket(pick.paket, { mode: "per_paket", judul: "PICKLIST ORDER — PER PAKET", subjudul: "", gudang: "Gudang ONLINE" });
      return new Response(new Uint8Array(bytes), header);
    }
    const pick = await buatPicklist(db, targets);
    if (!pick.ok) return json({ ok: false, error: pick.error }, pick.status);
    const bytes = await bangunPdfPicklist(pick.rows, pick.orders);
    return new Response(new Uint8Array(bytes), header);
  }
  if (aksi !== "daftar") return json({ ok: true, header: HEADER_PESANAN });
  const f = filterDariQuery(url);
  if (!f.ok) return json({ ok: false, error: f.error }, 400);
  const db = getDb();
  const daftar = await listOrder(db, { mp: f.filter.mp, status: f.filter.status, dari: f.filter.dari, sampai: f.filter.sampai, limit: f.filter.limit });
  const orders: OrderDetail[] = [];
  for (const h of daftar) {
    const d = await ambilOrder(db, h.marketplace, h.no_pesanan);
    if (!d) continue;
    if (f.filter.sku && !d.items.some((i) => i.sku === f.filter.sku)) continue;
    orders.push(d);
  }
  return json({ ok: true, orders });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const db = getDb();

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
    const orderRows = Array.isArray(body.ordersRows) ? (body.ordersRows as ShopeeOrderRow[]) : [];
    const advanceRows = Array.isArray(body.advanceRows) ? (body.advanceRows as ShopeeAdvanceRow[]) : [];
    if (orderRows.length === 0 && advanceRows.length === 0) return json({ ok: false, error: "Sheet orders/Advance Fulfilment kosong." }, 400);
    const file = typeof body.file === "string" ? body.file.trim().slice(0, 120) : "orders.xlsx";
    // T2: fingerprint + 3a tolak file sama.
    const hash = await hitungFingerprint([...orderRows, ...advanceRows], file);
    const sudah = await cekFileSudahAda(db, "orders_toship", hash);
    if (sudah && sudah.batch_id !== null) {
      return json({ ok: false, error: `File ini sudah pernah diimpor (batch #${sudah.batch_id}, ${sudah.file}).` }, 409);
    }
    const cekSku = new Map<string, boolean>();
    const adaSku = async (sku: string): Promise<boolean> => {
      const lama = cekSku.get(sku);
      if (lama !== undefined) return lama;
      const ada = Boolean(await ambilProduk(db, sku));
      cekSku.set(sku, ada);
      return ada;
    };
    const skuAda = new Set<string>();
    for (const r of [...orderRows, ...advanceRows]) {
      const sku = String(r["Nomor Referensi SKU"] ?? r["SKU Induk"] ?? "").trim().toUpperCase();
      if (sku) skuAda.add(sku);
    }
    for (const sku of skuAda) await adaSku(sku);
    const normal = normalisasiSheetShopee(orderRows, advanceRows, (sku) => cekSku.get(sku) === true);
    // Tebak SKU per GRUP (nama+variasi identik), bukan per baris: satu grup = satu tebakan.
    // Sebelum pengelompokan ini, 176 baris = 176 query (dipotong 100); kini ~20 grup = 20 query.
    const belumSku: (BarisBelumSku & { tebakan: TebakanSku })[] = [];
    for (const b of normal.belumSku.slice(0, 100)) belumSku.push({ ...b, tebakan: await tebakSku(db, b.nama_shopee, b.variasi) });
    for (const b of normal.belumSku.slice(100)) belumSku.push({ ...b, tebakan: { sku: "", perlu_pilih_manual: true, kandidat: [] } });
    // Klasifikasi T3/T3b (blokir/peringatan sebelum tulis).
    const orderBaru: OrderBaru[] = normal.orders.map((o) => ({
      no_pesanan: o.no_pesanan,
      no_resi: o.noResi,
      statusFile: o.statusFile,
      jasaKirim: o.jasaKirim,
      tipeLayanan: o.tipeLayanan,
      cod: o.cod,
      preorder: o.preorder,
    }));
    const klasifikasi = await klasifikasikanImport(db, orderBaru, normal.advance.map((a) => ({ booking_sn: a.booking_sn, no_resi: a.no_resi })));
    // D3: compare nama (peringatan saja).
    const pasangan = normal.orders.flatMap((o) => o.items.map((i) => ({ sku: i.sku, nama_shopee: i.nama_shopee })));
    const compare = await compareNama(db, pasangan);
    const payload = { orders: normal.orders, advance: normal.advance, hash, file };
    const ins = await db
      .prepare("INSERT INTO import_batches (tipe, file, total, sukses, gagal, gudang_id, payload_json, status, at, by) VALUES ('pesanan_shopee', ?, ?, ?, ?, 'ONLINE', ?, 'preview', ?, ?)")
      .bind(file, orderRows.length + advanceRows.length, normal.orders.length, normal.gagal.length, JSON.stringify(payload), Math.floor(Date.now() / 1000), user.tg_id)
      .run();
    return json({
      ok: true,
      batch_id: Number(ins.meta.last_row_id),
      hash,
      file,
      orders: normal.orders,
      advance: normal.advance,
      belumSku,
      gagal: normal.gagal,
      klasifikasi: {
        baru: klasifikasi.baru.length,
        update: klasifikasi.update.length,
        skip: klasifikasi.skip.length,
        mundur: klasifikasi.mundur,
        resiMultiOrder: klasifikasi.resiMultiOrder,
        gandaDalamFile: klasifikasi.gandaDalamFile,
        kriteriaGabungan: klasifikasi.kriteriaGabungan,
        advanceSkip: klasifikasi.advanceSkip,
      },
      compareNama: compare,
    });
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
    const peringatan: string[] = [];
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
    const batch = await db
      .prepare("SELECT id, file, payload_json, by FROM import_batches WHERE id = ? AND status = 'preview' AND tipe = 'pesanan_shopee'")
      .bind(body.batch_id)
      .first<{ id: number; file: string; payload_json: string; by: string | null }>();
    if (!batch) return json({ ok: false, error: "Batch tidak ditemukan / sudah diproses." }, 404);
    let payload: { orders: GabunganOrder[]; advance: ShopeeBooking[]; hash?: string };
    try {
      payload = JSON.parse(batch.payload_json) as typeof payload;
    } catch {
      return json({ ok: false, error: "Payload batch rusak." }, 500);
    }
    const orders = Array.isArray(payload.orders) ? payload.orders : [];
    const advance = Array.isArray(payload.advance) ? payload.advance : [];
    if (orders.length === 0 && advance.length === 0) return json({ ok: false, error: "Tak ada order valid untuk disimpan." }, 400);
    // Tanpa hash asli, anti-dobel kosong → tolak. Jangan mengarang hash (hash array kosong
    // akan identik untuk SEMUA file sehingga file berbeda ditolak sebagai "sudah diimpor").
    if (typeof payload.hash !== "string" || payload.hash === "") {
      return json({ ok: false, error: "Batch lama tanpa fingerprint — ulangi preview file ini." }, 409);
    }
    // SKU manual dari UI (baris tanpa SKU di MP) — dipetakan ke barisnya saat commit.
    const skuManual = new Map<string, string>();
    if (Array.isArray(body.skuManual)) {
      for (const m of body.skuManual as Record<string, unknown>[]) {
        const ref = teks(m.order_ref);
        const nama = teks(m.nama_shopee);
        const variasi = teks(m.variasi);
        const sku = teks(m.sku).toUpperCase();
        if (ref && sku) skuManual.set(`${ref}\u0000${nama}\u0000${variasi}`, sku);
      }
    }
    const stmts: D1PreparedStatement[] = [];
    let nItem = 0;
    const noList: string[] = [];
    // Item tanpa SKU yang ditandai "belum ada di MP": dicatat di sku_belum_mp untuk diurus
    // nanti, dan TIDAK ditulis ke order_items (belum punya SKU master untuk dirujuk).
    const kunciBelumMp = new Set<string>();
    if (Array.isArray(body.tandaiBelumMp)) {
      for (const t of body.tandaiBelumMp as Record<string, unknown>[]) {
        const namaShopee = teks(t.nama_shopee);
        if (!namaShopee) continue;
        const variasi = teks(t.variasi);
        const orderRef = teks(t.order_ref);
        kunciBelumMp.add(`${orderRef}\u0000${namaShopee}\u0000${variasi}`);
        await tandaiBelumMp(db, { namaShopee, variasi, orderRef, oleh: String(user.tg_id) });
      }
    }
    for (const o of orders) {
      noList.push(o.no_pesanan);
      stmts.push(
        db
          .prepare(
            `INSERT INTO orders (marketplace, no_pesanan, tanggal, buyer, status_fulfill, pajak_pph, pajak_ppn_persen, stok_dikurangi, no_resi,
              asal_import, opsi_kirim, antar_ke, status_mp, batch_import, jasa_kirim, tipe_layanan, cod, preorder, item_json)
             VALUES ('shopee', ?, ?, ?, ?, 0, 0, 0, ?, 'orders_toship', ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(marketplace, no_pesanan) DO UPDATE SET
               tanggal = excluded.tanggal, buyer = excluded.buyer, no_resi = CASE WHEN excluded.no_resi = '' THEN orders.no_resi ELSE excluded.no_resi END,
               opsi_kirim = excluded.opsi_kirim, antar_ke = excluded.antar_ke, status_mp = excluded.status_mp, batch_import = excluded.batch_import,
               jasa_kirim = excluded.jasa_kirim, tipe_layanan = excluded.tipe_layanan, cod = excluded.cod, preorder = excluded.preorder, item_json = excluded.item_json,
               asal_import = CASE WHEN orders.asal_import = '' THEN excluded.asal_import ELSE orders.asal_import END,
               status_fulfill = CASE WHEN orders.status_fulfill = 'pending' THEN excluded.status_fulfill ELSE orders.status_fulfill END`,
          )
          .bind(
            o.no_pesanan, o.tanggal, o.buyer, o.statusAwal, o.noResi,
            o.opsiKirim, o.antarKe, o.statusMp, batch.id, o.jasaKirim, o.tipeLayanan, o.cod ? 1 : 0, o.preorder ? 1 : 0, JSON.stringify(o.items),
          ),
      );
      stmts.push(db.prepare("DELETE FROM order_items WHERE marketplace = 'shopee' AND no_pesanan = ?").bind(o.no_pesanan));
      for (const item of o.items) {
        const kunci = `${o.no_pesanan}\u0000${item.nama_shopee}\u0000${item.variasi}`;
        const skuFinal = skuManual.get(kunci) ?? item.sku;
        // Belum ada SKU sama sekali (tidak dipilih manual, tidak ditandai belum-MP):
        // hentikan supaya tidak menulis item tanpa rujukan produk.
        if (!skuFinal) {
          if (kunciBelumMp.has(kunci)) continue;
          return json(
            { ok: false, error: `Baris "${item.nama_shopee}" (order ${o.no_pesanan}) belum dipilih SKU — pilih SKU atau centang "Belum di MP".` },
            400,
          );
        }
        const hpp = await ambilProduk(db, skuFinal);
        if (!hpp) return json({ ok: false, error: `SKU ${skuFinal} belum ada di master stok (order ${o.no_pesanan}).` }, 400);
        stmts.push(
          db
            .prepare(
              "INSERT INTO order_items (marketplace, no_pesanan, sku, variasi, nama_shopee, qty, harga_satuan, hpp_snapshot, subtotal) VALUES ('shopee', ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(o.no_pesanan, skuFinal, item.variasi, item.nama_shopee, item.qty, item.harga_satuan, hpp.hpp ?? 0, item.subtotal),
        );
        nItem++;
      }
    }
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
    const bookingBaru = await simpanBooking(db, advance, batch.id);
    const jmlResi = await isiResiGrup(db, batch.id);
    await catatImportFile(db, {
      tipe: "orders_toship",
      file: batch.file,
      hash: payload.hash,
      no_json: [...noList, ...advance.map((a) => a.booking_sn)],
      batch_id: batch.id,
      by: String(user.tg_id),
    });
    await db.prepare("UPDATE import_batches SET status = 'done', sukses = ? WHERE id = ?").bind(nItem, batch.id).run();
    return json({ ok: true, order: orders.length, item: nItem, advance: bookingBaru, advance_skip: advance.length - bookingBaru, resi_grup: jmlResi, batch_id: batch.id });
  }
  if (aksi === "hapus") {
    const daftar = Array.isArray(body.targets) ? body.targets : [];
    if (daftar.length === 0) return json({ ok: false, error: "Daftar order kosong." }, 400);
    if (daftar.length > 200) return json({ ok: false, error: "Maksimal 200 order per aksi." }, 400);
    const targets: { mp: string; no: string }[] = [];
    for (const t of daftar as Record<string, unknown>[]) {
      const mp = teks(t.marketplace).toLowerCase();
      const no = teks(t.no_pesanan);
      if (!mp || !no) return json({ ok: false, error: "Marketplace + NoPesanan wajib diisi." }, 400);
      targets.push({ mp, no });
    }
    // Hapus = koreksi salah impor: hanya baris order (header + anak). Jalur laba (fee dihitung
    // ulang dari preset saat /laba) dan jalur stok (potong stok ada di Kledo, bukan di sini)
    // tidak disentuh — jadi tak ada angka yang perlu dikembalikan.
    // Anak (order_items, order_fees) dihapus lebih dulu: FK-nya ON DELETE CASCADE ke orders.
    let dihapus = 0;
    for (let i = 0; i < targets.length; i += 50) {
      const batch = targets.slice(i, i + 50);
      const stmts: D1PreparedStatement[] = [];
      for (const t of batch) {
        stmts.push(db.prepare("DELETE FROM order_items WHERE marketplace = ? AND no_pesanan = ?").bind(t.mp, t.no));
        stmts.push(db.prepare("DELETE FROM order_fees WHERE marketplace = ? AND no_pesanan = ?").bind(t.mp, t.no));
        stmts.push(db.prepare("DELETE FROM orders WHERE marketplace = ? AND no_pesanan = ?").bind(t.mp, t.no));
      }
      const hasil = await db.batch(stmts);
      for (let j = 2; j < hasil.length; j += 3) dihapus += hasil[j].meta.changes ?? 0;
    }
    return json({ ok: true, dihapus });
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
