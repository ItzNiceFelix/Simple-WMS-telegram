// app/api/pengaturan/ai/route.ts — POST ubah provider AI (Fase 1: D1 cutover).
import { getDb } from "@/lib/d1/db";
import { PROVIDER_VALID, simpanProviderAI } from "@/lib/d1/pengaturan";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah pengaturan." }, 403);
  const body = await bacaBody(request);
  const provider = typeof body.provider === "string" ? body.provider.toLowerCase() : "";
  if (!(PROVIDER_VALID as readonly string[]).includes(provider)) {
    return json({ ok: false, error: "Provider AI tidak dikenal." }, 400);
  }
  const hasil = await simpanProviderAI(getDb(), provider, sesi.user.tg_id);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, pengaturan: hasil.pengaturan });
}
