// app/api/permintaan/route.ts — POST permintaan harian (Fase 1: D1 cutover).
// aksi: sesuaikan | buat-form | datang | selesai
import { getDb } from "@/lib/d1/db";
import { buatForm, selesaikan, sesuaikanQty, tandaiDatang } from "@/lib/d1/permintaan";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);

  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const tanggal = typeof body.tanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.tanggal) ? body.tanggal : null;
  if (!tanggal) return json({ ok: false, error: "Tanggal tidak valid (YYYY-MM-DD)." }, 400);
  const db = getDb();
  const uid = user.tg_id;

  if (aksi === "sesuaikan") {
    const daftar = Array.isArray(body.qty) ? body.qty : [];
    if (daftar.length === 0) return json({ ok: false, error: "Qty tidak valid." }, 400);
    let doc = null;
    for (const q of daftar) {
      const h = await sesuaikanQty(db, tanggal, String(q.kode_barang ?? ""), String(q.variasi ?? "-"), q.buffer === true, Number(q.qty), uid);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      doc = h.doc;
    }
    return json({ ok: true, permintaan: doc });
  }
  if (aksi === "buat-form") {
    const h = await buatForm(db, tanggal, uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, permintaan: h.doc });
  }
  if (aksi === "datang") {
    const item = (body.item ?? {}) as { kode_barang?: string; variasi?: string; buffer?: boolean };
    const h = await tandaiDatang(db, tanggal, String(item.kode_barang ?? ""), String(item.variasi ?? "-"), item.buffer === true, Number(body.qty_datang ?? 0), uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, permintaan: h.doc, selesai_otomatis: h.selesai_otomatis });
  }
  if (aksi === "selesai") {
    const h = await selesaikan(db, tanggal, uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, permintaan: h.doc });
  }
  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
