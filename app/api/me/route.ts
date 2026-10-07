// app/api/me/route.ts — GET profil sesi web (Fase 1: D1).
// Dipakai provider sesi dashboard (pengganti /api/auth/telegram + Firebase).
import { getDb } from "@/lib/d1/db";
import { ambilTokenDariCookie, verifikasiSesi } from "@/worker/auth";
import { json, tolakOriginD1 } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = tolakOriginD1(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);
  const token = ambilTokenDariCookie(request.headers.get("cookie"));
  const user = token ? await verifikasiSesi(getDb(), token) : null;
  if (!user) return json({ ok: false, error: "Belum login." }, 401);
  return json({
    ok: true,
    user: { id: user.tg_id, username: user.username, name: user.display_name },
    role: user.role,
    scope_gudang: user.scope_gudang,
    password_set: user.password_hash !== null,
  });
}
