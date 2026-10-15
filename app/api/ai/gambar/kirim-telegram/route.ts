// app/api/ai/gambar/kirim-telegram/route.ts — Kirim hasil gambar ke chat Telegram
// PEMINTA (Fase D). Tidak menyimpan apa pun ke D1: kirim lalu selesai.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { ROLE_GAMBAR } from "@/lib/d1/akses-halaman";
import type { Role } from "@/lib/d1/peran";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Batas aman Telegram untuk sendPhoto adalah 10 MB; base64 membengkakkan ~33%, jadi
// batas base64 ditekan ke 9 MB agar berkas hasil dekode tetap di bawah 10 MB.
const BATAS_BASE64 = 9 * 1024 * 1024;
/** Tebakan ukuran berkas setelah base64 didekode (3 byte per 4 karakter). */
function perkiraanByte(base64: string): number {
  const isi = base64.endsWith("==") ? base64.length - 2 : base64.endsWith("=") ? base64.length - 1 : base64.length;
  return Math.floor((isi * 3) / 4);
}

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  // Studio Gambar: owner, high_admin, admin, designer. Guest tak punya halamannya,
  // jadi tak boleh memakai jalur kirimnya (bot token + kuota Telegram).
  if (!ROLE_GAMBAR.includes(sesi.user.role as Role)) {
    return json({ ok: false, error: "Akses ditolak." }, 403);
  }
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const body = await bacaBody(request);
  const mentah = teks(body.base64);
  const base64 = mentah.startsWith("data:") && mentah.indexOf(",") > 0 ? mentah.slice(mentah.indexOf(",") + 1) : mentah;
  if (!base64) return json({ ok: false, error: "Gambar belum ada." }, 400);
  if (base64.length > BATAS_BASE64) {
    const mb = (perkiraanByte(base64) / 1024 / 1024).toFixed(1);
    return json(
      {
        ok: false,
        error:
          `Gambar terlalu besar untuk Telegram: sekitar ${mb} MB, batasnya 10 MB. ` +
          `Kecilkan lewat aspek rasio/jumlah di Pengaturan studio, atau pakai "Simpan lokal" lalu kirim manual.`,
      },
      413
    );
  }

  const mime = teks(body.mime) || "image/png";
  const caption = teks(body.caption).slice(0, 1024);

  const token = getCloudflareContext().env.TELEGRAM_BOT_TOKEN;
  if (!token) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN belum diset." }, 500);

  // Multipart, BUKAN JSON+base64: Telegram membatasi 10 MB untuk unggahan berkas dan
  // JSON base64 membuat payload membengkak ~33% sehingga gambar yang sebenarnya
  // kecil tetap ditolak dengan "file is too big".
  const biner = atob(base64);
  const byte = new Uint8Array(new ArrayBuffer(biner.length));
  for (let i = 0; i < biner.length; i++) byte[i] = biner.charCodeAt(i);
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  const form = new FormData();
  form.set("chat_id", String(sesi.user.tg_id));
  form.set("photo", new Blob([byte], { type: mime }), `gambar-produk.${ext}`);
  if (caption) form.set("caption", caption);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  const d = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
  if (!res.ok || !d?.ok) {
    const pesan = d?.description || `HTTP ${res.status}`;
    // Terjemahkan pesan asli Telegram yang tidak informatif bagi user.
    const ramah = /too big|Request Entity Too Large/i.test(pesan)
      ? `Telegram menolak: ukuran gambar melebihi batas. ${pesan}`
      : pesan;
    return json({ ok: false, error: ramah }, 502);
  }
  return json({ ok: true, messageId: d.result?.message_id ?? null });
}
