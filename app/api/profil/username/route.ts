// app/api/profil/username/route.ts — POST ubah username; { cek: true } = cek saja.
import { getDb } from "@/lib/d1/db";
import { ubahUsername, validasiUsername } from "@/lib/d1/profil";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const body = await bacaBody(request);
  const username = typeof body.username === "string" ? body.username : "";
  const db = getDb();
  // Pratinjau ketersediaan (dipanggil saat mengetik) tidak menyimpan apa pun.
  if (body.cek === true) {
    const hasil = await validasiUsername(db, username, sesi.user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error, tersedia: false }, hasil.status);
    return json({ ok: true, username: hasil.username, tersedia: true });
  }
  const hasil = await ubahUsername(db, sesi.user.tg_id, username);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, username: hasil.username });
}
