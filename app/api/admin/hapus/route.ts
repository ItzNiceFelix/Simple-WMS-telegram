// app/api/admin/hapus/route.ts — forwarder ke /api/admin (Fase 1: D1 cutover).
// Header asli diteruskan (termasuk Origin) agar guard dalam tidak menolak 403 di produksi.
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { POST as adminPost } from "../route";
import { forwardKeAdmin } from "@/lib/d1/forwardAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
  const body = await bacaBody(request);
  return adminPost(
    forwardKeAdmin(request, { ...body, target_user_id: body.telegram_user_id }, "hapus-admin")
  );
}
