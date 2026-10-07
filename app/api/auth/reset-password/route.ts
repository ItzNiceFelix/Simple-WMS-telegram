// app/api/auth/reset-password/route.ts — POST reset dengan kode OTP (Fase 1: D1).
import { getDb } from "@/lib/d1/db";
import { ambilPengguna, setPassword, verifikasiKode } from "@/worker/auth";
import { bacaBody, json, tolakOriginD1 } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TG_ID_RE = /^[0-9]{5,20}$/;

export async function POST(request: Request) {
  const origin = tolakOriginD1(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);
  const body = await bacaBody(request);
  const tgId = typeof body.tg_id === "string" ? body.tg_id : "";
  const kode = typeof body.kode === "string" ? body.kode : "";
  if (!TG_ID_RE.test(tgId) || !/^[0-9]{6}$/.test(kode)) {
    return json({ ok: false, error: "Data tidak valid." }, 400);
  }
  const db = getDb();
  const user = await ambilPengguna(db, tgId);
  if (!user || !(await verifikasiKode(db, tgId, "reset", kode))) {
    return json({ ok: false, error: "Kode salah atau kedaluwarsa." }, 401);
  }
  try {
    await setPassword(db, user.id, typeof body.password_baru === "string" ? body.password_baru : "");
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Gagal." }, 400);
  }
}
