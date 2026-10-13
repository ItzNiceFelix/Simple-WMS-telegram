// app/api/admin/ubah-nama/route.ts — forwarder ke /api/admin (ubah-nama).
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
    forwardKeAdmin(request, { ...body, target_user_id: body.target_user_id }, "ubah-nama")
  );
}
