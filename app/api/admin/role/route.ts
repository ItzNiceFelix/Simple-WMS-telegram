// app/api/admin/role/route.ts — forwarder ke /api/admin (Fase 1: D1 cutover).
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { POST as adminPost } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
  const body = await bacaBody(request);
  return adminPost(
    new Request(request.url.replace(/\/role\/?$/, ""), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: request.headers.get("cookie") ?? "" },
      body: JSON.stringify({ ...body, aksi: "ubah-role", target_user_id: body.target_user_id, role: body.role_baru ?? body.role }),
    })
  );
}
