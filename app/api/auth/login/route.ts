// app/api/auth/login/route.ts — POST login web telegramId+password (Fase 1: D1).
// Meneruskan ke logika yang sama dengan worker/api.ts (cookie swt_sesi).
// Dipakai halaman /masuk. Rate-limit via login_audit (5 gagal/15 mnt).
import { getDb } from "@/lib/d1/db";
import {
  ambilPengguna, atributCookieSesi, buatSesi, catatLogin,
  loginTerkunci, verifikasiPassword,
} from "@/worker/auth";
import { bacaBody, json, tolakOriginD1 } from "@/lib/d1/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TG_ID_RE = /^[0-9]{5,20}$/;

function ipDanUa(request: Request): { ip: string; ua: string } {
  const fwd = request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip");
  return {
    ip: fwd ? fwd.split(",")[0].trim() : "unknown",
    ua: request.headers.get("user-agent")?.slice(0, 200) ?? "unknown",
  };
}

export async function POST(request: Request) {
  const origin = tolakOriginD1(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);
  const body = await bacaBody(request);
  const tgId = typeof body.tg_id === "string" ? body.tg_id : "";
  const password = typeof body.password === "string" ? body.password : "";
  const db = getDb();
  const { ip, ua } = ipDanUa(request);
  const url = new URL(request.url);
  const https = url.protocol === "https:";

  if (!TG_ID_RE.test(tgId) || !password) {
    return json({ ok: false, error: "telegramId atau password salah." }, 401);
  }
  if (await loginTerkunci(db, tgId, Math.floor(Date.now() / 1000))) {
    await catatLogin(db, tgId, false, ip, ua, "terkunci");
    return json({ ok: false, error: "Terlalu banyak gagal. Coba lagi 15 menit." }, 429);
  }
  const user = await ambilPengguna(db, tgId);
  const cocok = user?.password_hash ? await verifikasiPassword(password, user.password_hash) : false;
  if (!user || !cocok) {
    await catatLogin(db, tgId, false, ip, ua, "kredensial");
    return json({ ok: false, error: "telegramId atau password salah." }, 401);
  }
  await catatLogin(db, tgId, true, ip, ua, null);
  const { token } = await buatSesi(db, user.id, ip, ua);
  const res = json({ ok: true, user: { id: user.tg_id, name: user.display_name }, role: user.role });
  res.headers.append("Set-Cookie", atributCookieSesi(token, https));
  return res;
}
