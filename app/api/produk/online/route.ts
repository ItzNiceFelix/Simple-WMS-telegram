// app/api/produk/online/route.ts — POST toggle is_online_product (Fase 1: D1 cutover).
import { getDb } from "@/lib/d1/db";
import { toggleOnline } from "@/lib/d1/produk";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 40);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);

  const body = await bacaBody(request);
  const kodeBarang = typeof body.kode_barang === "string" ? body.kode_barang.trim() : "";
  if (!kodeBarang || typeof body.is_online !== "boolean") {
    return json({ ok: false, error: "Data tidak valid." }, 400);
  }
  const hasil = await toggleOnline(getDb(), kodeBarang, body.is_online, user.tg_id);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, produk: { kode_barang: kodeBarang, is_online_product: hasil.is_online_product } });
}
