// app/api/opname-gudang/route.ts — POST opname per gudang (Fase 1: D1 cutover).
// aksi: buat (admin/owner, scope gudang) | setujui (owner) | tolak (owner)
import { getDb } from "@/lib/d1/db";
import { buatOpname, setujuiOpname, tolakOpname } from "@/lib/d1/opname";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);

  const body = await bacaBody(request);
  const aksi = body.aksi;
  const db = getDb();

  if (aksi === "buat") {
    const gudangId = typeof body.gudang_id === "string" ? body.gudang_id.trim() : "";
    const items = Array.isArray(body.items) ? body.items : [];
    if (!gudangId) return json({ ok: false, error: "Gudang wajib diisi." }, 400);
    if (!user.is_owner && !user.scope_gudang.includes(gudangId)) {
      return json({ ok: false, error: "Anda hanya dapat opname gudang Anda." }, 403);
    }
    const valid = items
      .filter((it) => it && typeof it.kode_barang === "string" && Number.isInteger(it.qty_fisik) && it.qty_fisik >= 0)
      .map((it) => ({ sku: it.kode_barang.trim(), qty_fisik: it.qty_fisik }));
    if (valid.length === 0) return json({ ok: false, error: "Item opname tidak valid." }, 400);
    const hasil = await buatOpname(db, gudangId, valid, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, opname: hasil.opname, langsung: hasil.langsung });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return json({ ok: false, error: "ID opname wajib diisi." }, 400);
  if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
  if (aksi === "setujui") {
    const hasil = await setujuiOpname(db, id, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, opname: hasil.opname, ...(hasil.peringatan_audit ? { peringatan_audit: true } : {}) });
  }
  if (aksi === "tolak") {
    const hasil = await tolakOpname(db, id, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, opname: hasil.opname });
  }
  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
