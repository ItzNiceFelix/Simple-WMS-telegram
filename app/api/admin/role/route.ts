// app/api/admin/role/route.ts — forwarder ke /api/admin (Fase 1: D1 cutover).
// PENTING: header Origin + cookie diteruskan apa adanya. Tanpa Origin, handler dalam
// akan melihat "POST tanpa Origin" dan menolak 403 di produksi (bug: owner tak bisa ubah role).
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { forwardKeAdmin } from "@/lib/d1/forwardAdmin";
import { POST as adminPost } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);
  const body = await bacaBody(request);
  // UI mengirim `role_baru`; handler gabungan membaca `role`. Petakan keduanya.
  const role = body.role ?? body.role_baru;
  return adminPost(forwardKeAdmin(request, { ...body, role }, "ubah-role"));
}
