// app/api/profil/route.ts — GET profil sesi web (telegramId, username, nama, role).
import { getDb } from "@/lib/d1/db";
import { ambilProfil } from "@/lib/d1/profil";
import { json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sesi = await sesiRoute(request);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const profil = await ambilProfil(getDb(), sesi.user.tg_id);
  if (!profil) return json({ ok: false, error: "User tidak ditemukan." }, 404);
  return json({ ok: true, profil });
}
