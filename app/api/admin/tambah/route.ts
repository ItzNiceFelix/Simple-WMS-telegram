// app/api/admin/tambah/route.ts — forwarder ke /api/admin (Fase 1: D1 cutover).
// Kontrak body sama; logika tunggal di route gabungan.
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
    new Request(request.url.replace(/\/tambah\/?$/, ""), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: request.headers.get("cookie") ?? "" },
      body: JSON.stringify({ ...body, aksi: "tambah-admin", target_user_id: body.telegram_user_id, nama: body.name, role: body.role }),
    })
  );
}
