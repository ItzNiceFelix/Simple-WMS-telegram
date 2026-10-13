// app/api/profil/password/route.ts — POST set/ganti password sendiri.
import { getDb } from "@/lib/d1/db";
import { setPasswordSendiri } from "@/lib/d1/profil";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const body = await bacaBody(request);
  const password = typeof body.password === "string" ? body.password : "";
  const konfirmasi = typeof body.konfirmasi === "string" ? body.konfirmasi : "";
  if (password !== konfirmasi) return json({ ok: false, error: "Konfirmasi password tidak sama." }, 400);
  const hasil = await setPasswordSendiri(getDb(), sesi.user.tg_id, password);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, diset: true });
}
