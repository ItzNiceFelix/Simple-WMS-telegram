// app/api/stok/reorder-point/route.ts — POST set reorder point (Fase 1: D1 cutover).
import { getDb } from "@/lib/d1/db";
import { setReorderPoint } from "@/lib/d1/stok";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);

  const body = await bacaBody(request);
  const kodeBarang = typeof body.kode_barang === "string" ? body.kode_barang.trim() : "";
  const rp = body.reorder_point;
  if (!kodeBarang) return json({ ok: false, error: "Kode barang wajib diisi." }, 400);
  if (rp !== null && (typeof rp !== "number" || !Number.isInteger(rp) || rp < 0)) {
    return json({ ok: false, error: "Reorder point harus bilangan bulat >= 0 atau null." }, 400);
  }
  const hasil = await setReorderPoint(getDb(), kodeBarang, rp ?? null, user.tg_id);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, reorder_point: hasil.stok_min, notifikasi_terkirim: false });
}
