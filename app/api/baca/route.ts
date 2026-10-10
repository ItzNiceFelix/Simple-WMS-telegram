// app/api/baca/route.ts — GET baca server D1 untuk dashboard (Fase 1 cutover).
// Menggantikan baca Firestore client SDK (real.ts). Scope: ?scope=stok|
// produk|gudang|opname|transfer|daily|admin|akses|histori|keyword|ai|ringkasan.
// Auth: cookie swt_sesi (D1). Filter gudang ditegakkan di server (RBAC scope).
import { getDb } from "@/lib/d1/db";
import { bacaQtyPerGudang } from "@/lib/d1/stok";
import { listGudang } from "@/lib/d1/gudang";
import { listOpname } from "@/lib/d1/opname";
import { listTransfer } from "@/lib/d1/transfer";
import { ambilDaily, tanggalHariIni } from "@/lib/d1/permintaan";
import { listAdmins } from "@/lib/d1/admin";
import { listAkses } from "@/lib/d1/akses";
import { listKeywords } from "@/lib/d1/kamus";
import { listMovements } from "@/lib/d1/ledger";
import { ambilPengaturanAI } from "@/lib/d1/pengaturan";
import { json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function keIso(epoch: number | null): string | null {
  if (epoch == null) return null;
  return new Date(epoch * 1000).toISOString();
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 120);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  const db = getDb();
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");

  if (scope === "stok") {
    const gudangFilter = url.searchParams.get("gudang_id");
    const onlineSaja = url.searchParams.get("is_online") !== "false";
    let sql = `SELECT p.sku, p.nama_accurate, p.hpp, p.is_online_product, p.stok_min, p.kategori, p.tier_override, b.warehouse_id, b.qty
      FROM products p LEFT JOIN stock_by_bin b ON b.sku = p.sku`;
    const args: unknown[] = [];
    if (onlineSaja) sql += " WHERE p.is_online_product = 1";
    sql += " ORDER BY p.sku ASC LIMIT 2000";
    const { results } = await db.prepare(sql).bind(...args).all<{
      sku: string; nama_accurate: string; hpp: number | null; is_online_product: number; stok_min: number | null;
      kategori: string | null; tier_override: string | null;
      warehouse_id: string | null; qty: number | null;
    }>();
    const { results: paths } = await db.prepare("SELECT kategori_path FROM kategori_tarif").all<{ kategori_path: string }>();
    const himpunan = new Set(paths.map((p) => p.kategori_path));
    const grup = new Map<string, { p: (typeof results)[number]; qtyMap: Record<string, number> }>();
    for (const r of results) {
      let g = grup.get(r.sku);
      if (!g) { g = { p: r, qtyMap: {} }; grup.set(r.sku, g); }
      if (r.warehouse_id != null && r.qty != null) g.qtyMap[r.warehouse_id] = r.qty;
    }
    const baris = [];
    for (const { p, qtyMap } of grup.values()) {
      const nilai = gudangFilter ? (qtyMap[gudangFilter] ?? 0) : (qtyMap.ONLINE ?? 0);
      if (gudangFilter && !(gudangFilter in qtyMap)) continue;
      const status = nilai < 0 ? "minus" : p.stok_min != null && nilai < p.stok_min ? "menipis" : "aman";
      const terpetakan = !!p.tier_override || (!!p.kategori && himpunan.has(p.kategori));
      baris.push({
        kode_barang: p.sku, nama_accurate: p.nama_accurate, hpp: p.hpp,
        stok_gudang_online: nilai, qty_per_gudang: qtyMap,
        is_online_product: p.is_online_product === 1, reorder_point: p.stok_min,
        status, kekurangan: status === "aman" ? 0 : (p.stok_min ?? 0) - nilai,
        kategori: p.kategori, terpetakan,
      });
    }
    return json({ ok: true, rows: baris });
  }

  if (scope === "produk") {
    const kode = url.searchParams.get("kode");
    if (kode) {
      const p = await db.prepare("SELECT * FROM products WHERE sku = ?").bind(kode).first<Record<string, unknown>>();
      if (!p) return json({ ok: false, error: "Produk tidak ditemukan." }, 404);
      const { results: varian } = await db.prepare("SELECT variasi FROM product_variants WHERE sku = ?").bind(kode).all<{ variasi: string }>();
      const { results: kw } = await db.prepare("SELECT keyword FROM product_search_keywords WHERE sku = ?").bind(kode).all<{ keyword: string }>();
      const qtyMap = await bacaQtyPerGudang(db, kode);
      return json({
        ok: true,
        produk: {
          kode_barang: kode, nama_accurate: p.nama_accurate, hpp: p.hpp, hpp_baru: p.hpp_baru,
          is_online_product: p.is_online_product === 1,
          kategori: p.kategori ?? null, tier_override: p.tier_override ?? null,
          pre_order: p.pre_order === 1, ukuran_khusus: p.ukuran_khusus === 1,
          go_override: (p.go_override as string | null) ?? null,
          variants: varian.map((v) => ({ variasi: v.variasi })),
          search_keywords: kw.map((k) => k.keyword), updated_at: keIso(p.updated_at as number | null),
        },
        stok: { kode_barang: kode, stok_gudang_online: qtyMap.ONLINE ?? null, reorder_point: p.stok_min ?? null },
      });
    }
    const { results } = await db
      .prepare("SELECT sku, nama_accurate, hpp, is_online_product FROM products ORDER BY sku ASC LIMIT 2000")
      .all<{ sku: string; nama_accurate: string; hpp: number | null; is_online_product: number }>();
    return json({ ok: true, rows: results });
  }

  if (scope === "gudang") {
    const semua = url.searchParams.get("semua") === "true";
    if (semua && !user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const daftar = await listGudang(db, semua);
    return json({
      ok: true,
      rows: daftar.map((g) => ({ gudang_id: g.id, nama: g.nama, aktif: g.aktif === 1, urutan: g.urutan })),
    });
  }

  if (scope === "opname") {
    const daftar = await listOpname(db, url.searchParams.get("status") ?? undefined, url.searchParams.get("gudang_id") ?? undefined);
    return json({
      ok: true,
      rows: daftar.map((o) => ({
        id: o.id, gudang_id: o.warehouse_id, status: o.status, created_by: "",
        created_at: keIso(o.created_at),
        items: o.items.map((i) => ({ kode_barang: i.sku, qty_sistem: i.qty_sistem, qty_fisik: i.qty_fisik, selisih: i.selisih, belum_terdaftar: i.belum_terdaftar === 1 })),
      })),
    });
  }

  if (scope === "transfer") {
    const daftar = await listTransfer(db, {
      status: url.searchParams.get("status") ?? undefined,
      dari_gudang_id: url.searchParams.get("dari_gudang_id") ?? undefined,
      tujuan_id: url.searchParams.get("tujuan_id") ?? undefined,
    });
    return json({
      ok: true,
      rows: daftar.map((t) => ({
        id: t.id, dari_gudang_id: t.dari_warehouse_id, status: t.status,
        created_by: t.created_by, created_at: keIso(t.created_at),
        tujuan: t.tujuan.map((d) => ({
          tipe: "gudang", id: d.dest_warehouse_id, status: d.status, status_kirim: d.status_kirim,
          user_penerima_id: d.user_penerima_id, items: d.items.map((i) => ({ kode_barang: i.sku, qty: i.qty })),
        })),
        tujuan_ids: t.tujuan.map((d) => `gudang:${d.dest_warehouse_id}`),
        items: t.tujuan.flatMap((d) => d.items.map((i) => ({ kode_barang: i.sku, qty: i.qty }))),
      })),
    });
  }

  if (scope === "daily") {
    const tanggal = url.searchParams.get("tanggal") ?? tanggalHariIni();
    const doc = await ambilDaily(db, tanggal);
    if (!doc) return json({ ok: true, rows: [] });
    return json({
      ok: true,
      rows: [{
        tanggal: doc.tanggal, status: doc.status,
        items: doc.items.map((i) => ({
          kode_barang: i.sku, nama: i.nama, variasi: i.variasi, qty: i.qty,
          buffer: i.buffer === 1, status: i.status, qty_diminta: i.qty_diminta,
          qty_datang: i.qty_datang, datang_at: null, datang_by: null,
        })),
      }],
    });
  }

  if (scope === "admin") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const daftar = await listAdmins(db);
    return json({
      ok: true,
      rows: daftar.map((a) => ({
        telegram_user_id: String(a.tg_id), name: a.display_name,
        telegram_username: a.username, role: a.role,
      })),
    });
  }

  if (scope === "akses") {
    if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
    const daftar = await listAkses(db);
    return json({
      ok: true,
      rows: daftar.map((a) => ({
        telegram_user_id: String(a.tg_id), status: a.status,
        requested_at: keIso(a.requested_at), telegram_username: a.telegram_username,
        telegram_display_name: a.telegram_display_name, rejected_until: keIso(a.rejected_until),
      })),
    });
  }

  if (scope === "histori") {
    const daftar = await listMovements(db, {
      sku: url.searchParams.get("kode") ?? undefined,
      jenis: url.searchParams.get("type") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      created_by: url.searchParams.get("created_by") ?? undefined,
      dari: url.searchParams.get("dari") ? Math.floor(new Date(url.searchParams.get("dari") as string).getTime() / 1000) : undefined,
      sampai: url.searchParams.get("sampai") ? Math.floor(new Date(url.searchParams.get("sampai") as string).getTime() / 1000) : undefined,
      limit: Number(url.searchParams.get("limit") ?? 50),
    });
    return json({
      ok: true,
      rows: daftar.map((m) => ({
        id: String(m.id), kode_barang: m.sku, nama_terbaca: m.nama_terbaca, variasi: m.variasi,
        qty: m.qty, type: m.jenis, action_type: m.action_type, qty_sistem: m.qty_sistem,
        qty_fisik: m.qty_fisik, selisih: m.selisih, catatan: m.catatan, source: m.source,
        status: m.status, created_at: keIso(m.at),
        created_by: m.created_by, created_by_username: null, created_by_name: null,
        requested_by: null, requested_by_username: null, requested_by_name: null,
        confirmed_by: null, resolved_by: null, penanda: null,
      })),
    });
  }

  if (scope === "keyword") {
    if (!user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
    const daftar = await listKeywords(db);
    return json({
      ok: true,
      rows: daftar.map((k) => ({
        id: String(k.id), raw_text: k.raw_text, interpreted_as: k.interpreted_as,
        confidence: k.confidence, usage_count: k.usage_count, last_used: null,
        first_seen: null, confirmed_by: null, confirmed_at: null,
      })),
    });
  }

  if (scope === "ai") {
    const s = await ambilPengaturanAI(db);
    return json({ ok: true, settings: { textProvider: s.textProvider, updatedAt: null, updatedBy: null } });
  }

  if (scope === "ringkasan") {
    const stokRes = await db.prepare("SELECT p.sku, p.stok_min, b.qty FROM products p JOIN stock_by_bin b ON b.sku = p.sku WHERE p.is_online_product = 1 AND b.warehouse_id = 'ONLINE' LIMIT 2000").all<{ sku: string; stok_min: number | null; qty: number }>();
    let menipis = 0;
    let minus = 0;
    for (const r of stokRes.results) {
      if (r.qty < 0) minus++;
      else if (r.stok_min != null && r.qty < r.stok_min) menipis++;
    }
    return json({ ok: true, ringkasan: { totalProdukOnline: stokRes.results.length, itemMenipis: menipis, itemMinus: minus } });
  }

  return json({ ok: false, error: "Scope tidak dikenal." }, 400);
}
