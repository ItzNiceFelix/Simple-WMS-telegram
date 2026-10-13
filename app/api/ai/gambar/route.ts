// app/api/ai/gambar/route.ts — Generate/edit gambar produk (Fase D).
// Hasil TIDAK masuk database — dikembalikan base64 ke klien, selesai di situ.
// Pagar server: sesi + rate limit ketat (10/menit) + batas ukuran muatan 12 MB.
import { getDb, getEnvAi, getKunciEnkripsi } from "@/lib/d1/db";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";
import { panggilGambar, panggilTeks, type Konteks } from "@/lib/ai/provider";
import { kalimatIdentifikasi, promptInpainting, uraikanArea, type AreaGambar } from "@/lib/ai/areaGambar";
import type { BagianChat, JawabanChat } from "@/lib/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batas muatan total base64 (perkiraan; base64 ~33% lebih besar dari byte asli). */
const BATAS_BASE64 = 12 * 1024 * 1024;
const MAKS_REFERENSI = 5;
const MAKS_ANOTASI = 10;

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** Buang prefix `data:image/...;base64,` bila klien mengirim data URL. */
function buangPrefix(b64: string): string {
  const koma = b64.indexOf(",");
  return b64.startsWith("data:") && koma > 0 ? b64.slice(koma + 1) : b64;
}

function sahArea(v: unknown): v is AreaGambar {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  const pusat = a.pusat as Record<string, unknown> | undefined;
  if (!pusat || typeof pusat !== "object") return false;
  const x = Number(pusat.x);
  const y = Number(pusat.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (a.jenis !== "titik" && a.jenis !== "lingkaran") return false;
  if (a.jenis === "lingkaran" && !Number.isFinite(Number(a.radius))) return false;
  return true;
}

/** Normalisasi area dari body → bentuk kanonik (0–1 terjepit). */
function normalkan(v: unknown): AreaGambar | null {
  if (!sahArea(v)) return null;
  const a = v;
  const jepit = (n: number) => Math.min(1, Math.max(0, n));
  return {
    jenis: a.jenis,
    pusat: { x: jepit(Number(a.pusat.x)), y: jepit(Number(a.pusat.y)) },
    ...(a.jenis === "lingkaran" ? { radius: jepit(Number(a.radius)) } : {}),
    komentar: teks(a.komentar).slice(0, 400),
  };
}

/** Label objek untuk satu area: coba vision, jatuh balik ke komentar user. */
async function labelArea(ctx: Konteks, area: AreaGambar, gambarAcuan: { mime: string; base64: string }): Promise<string> {
  const pesan: BagianChat[] = [
    { role: "user", teks: kalimatIdentifikasi(area), gambar: [gambarAcuan] },
  ];
  const r = await panggilTeks(ctx, { pesan }, "vision");
  if (!r.ok) {
    // Langkah identifikasi gagal ≠ gagal total: pakai komentar user apa adanya,
    // plus uraian posisi supaya model tetap tahu area mana yang dimaksud.
    return area.komentar ? `${area.komentar} (${uraikanArea(area)})` : uraikanArea(area);
  }
  const bersih = r.teks.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
  try {
    const d = JSON.parse(bersih) as JawabanChat & { label?: unknown };
    const label = teks((d as Record<string, unknown>).label);
    if (label) return label.slice(0, 200);
  } catch {
    // bukan JSON — pakai teks mentah bila pendek dan masuk akal
    const satuBaris = bersih.replace(/\s+/g, " ").slice(0, 200);
    if (satuBaris && satuBaris.length < 120) return satuBaris;
  }
  return area.komentar ? `${area.komentar} (${uraikanArea(area)})` : uraikanArea(area);
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);

  const body = await bacaBody(request);
  const prompt = teks(body.prompt);
  if (!prompt) return json({ ok: false, error: "Prompt wajib diisi." }, 400);

  const mimeReferensi = teks(body.mimeReferensi) || "image/jpeg";
  const referensiMentah = Array.isArray(body.referensi) ? body.referensi : [];
  if (referensiMentah.length > MAKS_REFERENSI) {
    return json({ ok: false, error: `Maksimal ${MAKS_REFERENSI} gambar referensi.` }, 400);
  }
  const referensi = referensiMentah
    .map((v) => buangPrefix(teks(v)))
    .filter((v) => v.length > 0)
    .map((v) => ({ mime: mimeReferensi, base64: v }));

  const totalBase64 = referensi.reduce((n, r) => n + r.base64.length, 0);
  if (totalBase64 > BATAS_BASE64) {
    return json({ ok: false, error: "Ukuran gambar terlalu besar (maksimal sekitar 12 MB total)." }, 413);
  }

  const kunci = getKunciEnkripsi();
  if (!kunci) return json({ ok: false, error: "Kunci enkripsi AI belum diset." }, 500);
  const ctx: Konteks = { db: getDb(), kunci, env: getEnvAi() };

  const modelGambar = teks(body.modelGambar);
  const anotasiMentah = Array.isArray(body.anotasi) ? body.anotasi.slice(0, MAKS_ANOTASI) : [];
  const anotasi = anotasiMentah.map(normalkan).filter((a): a is AreaGambar => a !== null);

  let promptFinal = prompt;
  // Mode revisi: user menandai area di gambar sebelumnya → terjemahkan area jadi label objek.
  if (anotasi.length > 0 && referensi.length > 0) {
    const label: string[] = [];
    for (const area of anotasi) {
      const bagian = await labelArea(ctx, area, referensi[0]);
      if (bagian) label.push(bagian);
    }
    if (label.length > 0) promptFinal = promptInpainting(label.join(" and "), prompt);
  }

  const hasil = await panggilGambar(ctx, {
    prompt: promptFinal,
    referensi: referensi.length > 0 ? referensi : undefined,
  });
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);

  return json({ ok: true, base64: hasil.base64, mime: hasil.mime, provider: hasil.provider, model: hasil.model });
}
