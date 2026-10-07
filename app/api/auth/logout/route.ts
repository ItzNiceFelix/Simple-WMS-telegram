// app/api/auth/logout/route.ts + me/route.ts — sesi web D1 (Fase 1).
// Dipakai halaman /masuk (logout) dan provider sesi dashboard (/api/me).
import { getDb } from "@/lib/d1/db";
import { ambilTokenDariCookie, cabutSesi, cookieHapusSesi } from "@/worker/auth";
import { json, tolakOriginD1 } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = tolakOriginD1(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);
  const token = ambilTokenDariCookie(request.headers.get("cookie"));
  if (token) await cabutSesi(getDb(), token);
  const url = new URL(request.url);
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", cookieHapusSesi(url.protocol === "https:"));
  return res;
}
