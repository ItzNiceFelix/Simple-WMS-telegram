// app/api/ai/analisa/setting/route.ts — Setting analisa mendalam PER USER (halaman /analisa).
// GET  → setting user + daftar reasoning sah untuk model teks global.
// POST → simpan setting; reasoning divalidasi terhadap katalog ai_model.
//
// GATE: user biasa BOLEH (sesiRoute saja, TANPA is_admin). Tiap user berhak mengatur
// reasoning-nya sendiri; model teks tetap mengikuti pengaturan global, jadi user tidak
// bisa membelokkan biaya ke model yang tidak disiapkan admin.
//
// Kolom kapabilitas (0022) dibaca defensif: agen lain mungkin belum apply migrasinya.
import { getDb, getEnvAi } from "@/lib/d1/db";
import { ambilSettingAnalisa, simpanSettingAnalisa } from "@/lib/d1/aiAnalisaSetting";
import { ambilPengaturanAI } from "@/lib/d1/pengaturan";
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
  // Skema 'bool' tidak menyimpan daftar nilai di DB (cuma hidup/mati) — turunkan di sini.
  const skema = teks(baris?.reasoning_skema);
  if (skema === "bool") return ["on", "off"];
  if (skema === "level_4" || skema === "effort_openai") return ["minimal", "low", "medium", "high"];
  if (skema === "level_3") return ["low", "medium", "high"];
  return [];
}

/**
 * Provider + model teks yang SEDANG dipakai, diambil dari pengaturan GLOBAL.
 * Urutan: pilihan user di `modelTeks[provider]`, lalu model teks aktif pertama di
 * katalog — sama dengan urutan yang dipakai lib/ai/provider.ts saat benar-benar
 * memanggil model, jadi daftar reasoning yang ditampilkan cocok dengan yang dipakai.
 */
async function modelTeksGlobal(db: D1Database): Promise<{ provider: string; model_id: string }> {
  const set = await ambilPengaturanAI(db, getEnvAi());
  const provider = set.textProvider || set.chainTeks[0] || "";
  if (!provider) return { provider: "", model_id: "" };
  const dipilih = teks(set.modelTeks[provider]);
  if (dipilih) return { provider, model_id: dipilih };
  const aktif = await db
    .prepare("SELECT model_id FROM ai_model WHERE provider = ? AND jenis = 'teks' AND aktif = 1 ORDER BY id LIMIT 1")
    .bind(provider)
    .first<{ model_id: string }>();
  return { provider, model_id: teks(aktif?.model_id) };
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  // Preferensi pribadi: user login mana pun boleh, KECUALI guest.
  if (sesi.user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
  const db = getDb();
  const setting = await ambilSettingAnalisa(db, sesi.user.tg_id);
  const model = await modelTeksGlobal(db);
  return json({ ok: true, setting, model, reasoning_pilihan: await pilihanReasoning(db, model.provider, model.model_id) });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  // Sama seperti GET: preferensi pribadi, guest dikecualikan.
  if (sesi.user.role === "guest") return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const db = getDb();
  const model = await modelTeksGlobal(db);
  const pilihan = await pilihanReasoning(db, model.provider, model.model_id);
  const reasoning = teks(body.reasoning);

  if (reasoning) {
    if (pilihan.length === 0) {
      return json({ ok: false, error: "Model teks ini tidak punya pengaturan reasoning." }, 400);
    }
    if (!pilihan.includes(reasoning)) {
      return json({ ok: false, error: `Nilai reasoning tidak sah untuk model ini. Pilihan: ${pilihan.join(", ")}.` }, 400);
    }
  }

  const h = await simpanSettingAnalisa(db, sesi.user.tg_id, {
    reasoning,
    maks_token: body.maks_token,
    kedalaman: body.kedalaman,
  });
  if (!h.ok) return json({ ok: false, error: h.error }, h.status);
  return json({ ok: true, setting: h.setting, model, reasoning_pilihan: pilihan });
}
