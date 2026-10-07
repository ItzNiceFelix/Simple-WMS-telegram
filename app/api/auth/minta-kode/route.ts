// app/api/auth/minta-kode/route.ts — POST kirim kode reset via bot (Fase 1: D1).
import { getDb } from "@/lib/d1/db";
import { ambilPengguna, terbitkanKode } from "@/worker/auth";
import { bacaBody, json, tolakOriginD1 } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TG_ID_RE = /^[0-9]{5,20}$/;

async function kirimViaBot(chatId: string, teks: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN belum diset.");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: teks }),
  });
  if (!res.ok) throw new Error(`sendMessage gagal: ${res.status}`);
}

export async function POST(request: Request) {
  const origin = tolakOriginD1(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);
  const body = await bacaBody(request);
  const tgId = typeof body.tg_id === "string" ? body.tg_id : "";
  if (!TG_ID_RE.test(tgId)) return json({ ok: false, error: "telegramId tidak valid." }, 400);
  const db = getDb();
  const user = await ambilPengguna(db, tgId);
  if (user) {
    const { kode } = await terbitkanKode(db, tgId, "reset");
    try {
      await kirimViaBot(tgId, `Kode reset password Simple-WMS: ${kode}\nBerlaku 10 menit. Jangan berikan ke siapa pun.`);
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : "Gagal kirim via bot." }, 503);
    }
  }
  return json({ ok: true, pesan: "Bila telegramId terdaftar, kode dikirim via bot." });
}
