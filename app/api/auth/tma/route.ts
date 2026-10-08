// app/api/auth/tma/route.ts — POST auto-login Telegram Mini App (initData HMAC).
// Alur: client kirim window.Telegram.WebApp.initData → verifikasiInitData
// (pakai ulang lib/dashboard/auth/initData.js, tanpa Firebase) → user HARUS
// sudah ada di D1 (fail-closed: tak dikenal → 403, arahkan /daftar dulu) →
// buatSesi + Set-Cookie swt_sesi (pola login/route.ts). Web biasa tetap /masuk.
import { createRequire } from "node:module";
import { getDb } from "@/lib/d1/db";
import { ambilPengguna, atributCookieSesi, buatSesi, catatLogin } from "@/worker/auth";
import { bacaBody, json, tolakOriginD1 } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

type InitDataError = Error & { status?: number };

const { verifikasiInitData } = require("../../../../lib/dashboard/auth/initData.js") as {
  verifikasiInitData: (
    initData: string,
    opsi: { botToken: string }
  ) => { authDate: number; user: { id: string; username: string | null; first_name: string | null } };
};

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
  const initData = typeof body.initData === "string" ? body.initData : "";
  const db = getDb();
  const { ip, ua } = ipDanUa(request);
  const url = new URL(request.url);
  const https = url.protocol === "https:";

  let hasil: { authDate: number; user: { id: string; username: string | null; first_name: string | null } };
  try {
    hasil = verifikasiInitData(initData, { botToken: process.env.TELEGRAM_BOT_TOKEN || "" });
  } catch (e) {
    const err = e as InitDataError;
    await catatLogin(db, "tma?", false, ip, ua, "initdata").catch(() => undefined);
    return json({ ok: false, error: err.message || "initData tidak valid." }, err.status ?? 401);
  }

  const tgId = hasil.user.id;
  const user = await ambilPengguna(db, tgId).catch(() => null);
  if (!user) {
    return json({ ok: false, error: "Belum terdaftar. Kirim /daftar ke bot dulu, lalu minta owner menyetujui." }, 403);
  }
  await catatLogin(db, tgId, true, ip, ua, "tma").catch(() => undefined);
  const { token } = await buatSesi(db, user.id, ip, ua);
  const res = json({ ok: true, user: { id: user.tg_id, name: user.display_name }, role: user.role });
  res.headers.append("Set-Cookie", atributCookieSesi(token, https));
  return res;
}
