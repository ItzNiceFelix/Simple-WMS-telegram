// app/api/ai/gambar/kirim-telegram/route.ts — Kirim hasil gambar ke chat Telegram
// PEMINTA (Fase D). Tidak menyimpan apa pun ke D1: kirim lalu selesai.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATAS_BASE64 = 12 * 1024 * 1024;

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);

  const body = await bacaBody(request);
  const koma = teks(body.base64);
  const base64 = koma.startsWith("data:") && koma.indexOf(",") > 0 ? koma.slice(koma.indexOf(",") + 1) : koma;
  if (!base64) return json({ ok: false, error: "Gambar belum ada." }, 400);
  if (base64.length > BATAS_BASE64) {
    return json({ ok: false, error: "Ukuran gambar terlalu besar (maksimal sekitar 12 MB)." }, 413);
  }

  const mime = teks(body.mime) || "image/png";
  const caption = teks(body.caption).slice(0, 1024);

  const token = getCloudflareContext().env.TELEGRAM_BOT_TOKEN;
  if (!token) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN belum diset." }, 500);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: sesi.user.tg_id,
      photo: `data:${mime};base64,${base64}`,
      ...(caption ? { caption } : {}),
    }),
  });
  const d = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
  if (!res.ok || !d?.ok) {
    return json({ ok: false, error: d?.description || `Gagal mengirim ke Telegram (HTTP ${res.status}).` }, 502);
  }
  return json({ ok: true, messageId: d.result?.message_id ?? null });
}
