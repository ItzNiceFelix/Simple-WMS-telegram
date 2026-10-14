// app/api/ai/gambar/setting/route.ts — Setting gambar PER USER (halaman /ai-gambar).
// GET  → setting user + daftar reasoning sah untuk model terpilih.
// POST → simpan setting; reasoning divalidasi terhadap katalog ai_model.
// Kolom kapabilitas (0022) dibaca defensif: agen lain mungkin belum apply migrasinya.
import { getDb } from "@/lib/d1/db";
import { ambilSettingGambar, simpanSettingGambar } from "@/lib/d1/aiGambarSetting";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** Daftar reasoning sah untuk (provider, model_id). SELECT * + akses defensif kolom 0022. */
async function pilihanReasoning(db: D1Database, provider: string, modelId: string): Promise<string[]> {
  if (!provider || !modelId) return [];
  const baris = await db
    .prepare("SELECT * FROM ai_model WHERE provider = ? AND model_id = ? LIMIT 1")
    .bind(provider, modelId)
    .first<Record<string, unknown>>();
  const csv = teks(baris?.reasoning_pilihan);
  const dariCsv = csv ? csv.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (dariCsv.length > 0) return dariCsv;
  // Skema 'bool' tidak menyimpan daftar nilai di DB (cuma hidup/mati) — turunkan di sini
  // supaya model seperti gemini-3-pro-image tetap bisa dipilih, bukan ditolak.
  const skema = teks(baris?.reasoning_skema);
  if (skema === "bool") return ["on", "off"];
  if (skema === "level_4" || skema === "effort_openai") return ["minimal", "low", "medium", "high"];
  if (skema === "level_3") return ["low", "medium", "high"];
  return [];
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const db = getDb();
  const setting = await ambilSettingGambar(db, sesi.user.tg_id);
  const url = new URL(request.url);
  // Pratinjau: UI boleh menanyakan pilihan reasoning untuk model yang BELUM disimpan.
  const provider = teks(url.searchParams.get("provider")) || setting.provider;
  const modelId = teks(url.searchParams.get("model_id")) || setting.model_id;
  return json({ ok: true, setting, reasoning_pilihan: await pilihanReasoning(db, provider, modelId) });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const body = await bacaBody(request);
  const db = getDb();
  const lama = await ambilSettingGambar(db, sesi.user.tg_id);

  const provider = teks(body.provider) || lama.provider;
  const modelId = teks(body.model_id);
  const reasoning = teks(body.reasoning);
  const pilihan = await pilihanReasoning(db, provider, modelId);

  if (reasoning) {
    if (pilihan.length === 0) {
      return json({ ok: false, error: "Model ini tidak punya pengaturan reasoning." }, 400);
    }
    if (!pilihan.includes(reasoning)) {
      return json({ ok: false, error: `Nilai reasoning tidak sah untuk model ini. Pilihan: ${pilihan.join(", ")}.` }, 400);
    }
  }

  const h = await simpanSettingGambar(db, sesi.user.tg_id, {
    provider,
    model_id: modelId,
    reasoning,
    aspek_rasio: body.aspek_rasio,
    jumlah: body.jumlah,
  });
  if (!h.ok) return json({ ok: false, error: h.error }, h.status);
  return json({ ok: true, setting: h.setting, reasoning_pilihan: pilihan });
}
