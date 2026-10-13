// lib/d1/pengaturan.ts — Settings + provider AI di D1 (Fase 1, paritas aiSettings.js).
import { gagal, type Hasil } from "./hasil";

export const PROVIDER_VALID = ["gemini", "groq", "kenari", "openai", "openrouter"] as const;

/** Sumber env: process.env (route Node) atau CloudflareEnv (Worker). Semua opsional. */
export type EnvAi = {
  AI_PROVIDER_TEXT?: string | undefined;
  GEMINI_TIMEOUT_MS?: string | undefined;
  GEMINI_TOTAL_TIMEOUT_MS?: string | undefined;
  /** Dipakai provider.ts (dekripsi kredensial) + adapter kenari. Opsional. */
  AI_KEY_ENCRYPTION_KEY?: string | undefined;
  KENARI_BASE_URL?: string | undefined;
};

export type AiSettings = {
  /** Provider utama untuk chat teks. */
  textProvider: string;
  /** Provider utama untuk image gen. */
  imageProvider: string;
  /** Urutan cadangan provider bila yang utama gagal (fallback ANTAR provider). */
  chainTeks: string[];
  chainGambar: string[];
  /** Model terpilih per provider. Kosong = pakai model aktif pertama di katalog ai_model. */
  modelTeks: Record<string, string>;
  modelGambar: Record<string, string>;
  modelVision: Record<string, string>;
  /** Hemat token. */
  maksRiwayat: number;
  maksLoopTool: number;
  /** Saat tak ada kata kunci yang cocok: kirim semua tool aktif, atau balas tidak paham. */
  saatTakCocok: "semua_tool" | "tolak";
  /** Prompt sistem, bisa diedit dari UI. */
  promptSistem: string;
  /** Batas pesan AI per user per menit (jaga biaya). */
  rateLimitPerMenit: number;
  geminiTimeoutMs: number;
  totalTimeoutMs: number;
};

/** Nilai default — dipakai sebagai dasar sebelum DB menimpa. */
export function dasarPengaturan(env: EnvAi = {}): AiSettings {
  const providerDiminta = String(env.AI_PROVIDER_TEXT ?? "").trim().toLowerCase();
  return {
    textProvider: (PROVIDER_VALID as readonly string[]).includes(providerDiminta) ? providerDiminta : "groq",
    imageProvider: "gemini",
    chainTeks: ["groq", "gemini"],
    chainGambar: ["gemini"],
    modelTeks: {},
    modelGambar: {},
    modelVision: {},
    maksRiwayat: 10,
    maksLoopTool: 5,
    saatTakCocok: "semua_tool",
    promptSistem: "",
    rateLimitPerMenit: 20,
    geminiTimeoutMs: Number(env.GEMINI_TIMEOUT_MS) > 0 ? Number(env.GEMINI_TIMEOUT_MS) : 120000,
    totalTimeoutMs: Number(env.GEMINI_TOTAL_TIMEOUT_MS) > 0 ? Number(env.GEMINI_TOTAL_TIMEOUT_MS) : 240000,
  };
}

/** Bersihkan daftar provider: hanya yang sah, tanpa duplikat, urutan dipertahankan. */
function bersihkanChain(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const keluar: string[] = [];
  for (const x of v) {
    const p = String(x ?? "").trim().toLowerCase();
    if ((PROVIDER_VALID as readonly string[]).includes(p) && !keluar.includes(p)) keluar.push(p);
  }
  return keluar.length > 0 ? keluar : fallback;
}

/** Bersihkan peta model: hanya provider sah, nilai string tidak kosong. */
function bersihkanPetaModel(v: unknown): Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const keluar: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const p = String(k).trim().toLowerCase();
    const m = String(val ?? "").trim();
    if ((PROVIDER_VALID as readonly string[]).includes(p) && m) keluar[p] = m.slice(0, 120);
  }
  return keluar;
}

export async function ambilPengaturanAI(db: D1Database, env: EnvAi = {}): Promise<AiSettings> {
  const dasar = dasarPengaturan(env);
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'ai'").bind().first<{ value: string }>();
  if (!row) return dasar;
  try {
    const data = JSON.parse(row.value) as Partial<AiSettings>;
    const tp = String(data.textProvider || dasar.textProvider).toLowerCase();
    const ip = String(data.imageProvider || dasar.imageProvider).toLowerCase();
    const angka = (v: unknown, fallback: number, min: number, maks: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= maks ? Math.floor(n) : fallback;
    };
    return {
      textProvider: (PROVIDER_VALID as readonly string[]).includes(tp) ? tp : dasar.textProvider,
      imageProvider: (PROVIDER_VALID as readonly string[]).includes(ip) ? ip : dasar.imageProvider,
      chainTeks: bersihkanChain(data.chainTeks, dasar.chainTeks),
      chainGambar: bersihkanChain(data.chainGambar, dasar.chainGambar),
      modelTeks: bersihkanPetaModel(data.modelTeks),
      modelGambar: bersihkanPetaModel(data.modelGambar),
      modelVision: bersihkanPetaModel(data.modelVision),
      maksRiwayat: angka(data.maksRiwayat, dasar.maksRiwayat, 0, 50),
      maksLoopTool: angka(data.maksLoopTool, dasar.maksLoopTool, 1, 20),
      saatTakCocok: data.saatTakCocok === "tolak" ? "tolak" : "semua_tool",
      promptSistem: typeof data.promptSistem === "string" ? data.promptSistem.slice(0, 8000) : dasar.promptSistem,
      rateLimitPerMenit: angka(data.rateLimitPerMenit, dasar.rateLimitPerMenit, 1, 300),
      geminiTimeoutMs: Number(data.geminiTimeoutMs) > 0 ? Number(data.geminiTimeoutMs) : dasar.geminiTimeoutMs,
      totalTimeoutMs: Number(data.totalTimeoutMs) > 0 ? Number(data.totalTimeoutMs) : dasar.totalTimeoutMs,
    };
  } catch {
    return dasar;
  }
}

/** Tulis utuh: dipakai UI pengaturan (banyak field sekaligus). */
export async function simpanPengaturanAI(
  db: D1Database,
  patch: Partial<AiSettings>,
  oleh: string | null,
  env: EnvAi = {}
): Promise<Hasil<{ pengaturan: AiSettings }>> {
  const kini = await ambilPengaturanAI(db, env);
  const gabung: AiSettings = { ...kini, ...patch };
  // Validasi bentuk akhir (bukan patch) supaya nilai sah tak bisa dirusak sebagian.
  const tp = String(gabung.textProvider).toLowerCase();
  const ip = String(gabung.imageProvider).toLowerCase();
  if (!(PROVIDER_VALID as readonly string[]).includes(tp)) return gagal(400, "Provider teks tidak dikenal.");
  if (!(PROVIDER_VALID as readonly string[]).includes(ip)) return gagal(400, "Provider gambar tidak dikenal.");
  const bersih: AiSettings = {
    ...gabung,
    textProvider: tp,
    imageProvider: ip,
    chainTeks: bersihkanChain(gabung.chainTeks, kini.chainTeks),
    chainGambar: bersihkanChain(gabung.chainGambar, kini.chainGambar),
    modelTeks: bersihkanPetaModel(gabung.modelTeks),
    modelGambar: bersihkanPetaModel(gabung.modelGambar),
    modelVision: bersihkanPetaModel(gabung.modelVision),
    maksRiwayat: Math.max(0, Math.min(50, Math.floor(Number(gabung.maksRiwayat) || kini.maksRiwayat))),
    maksLoopTool: Math.max(1, Math.min(20, Math.floor(Number(gabung.maksLoopTool) || kini.maksLoopTool))),
    saatTakCocok: gabung.saatTakCocok === "tolak" ? "tolak" : "semua_tool",
    promptSistem: String(gabung.promptSistem ?? "").slice(0, 8000),
    rateLimitPerMenit: Math.max(1, Math.min(300, Math.floor(Number(gabung.rateLimitPerMenit) || kini.rateLimitPerMenit))),
    geminiTimeoutMs: Number(gabung.geminiTimeoutMs) > 0 ? Number(gabung.geminiTimeoutMs) : kini.geminiTimeoutMs,
    totalTimeoutMs: Number(gabung.totalTimeoutMs) > 0 ? Number(gabung.totalTimeoutMs) : kini.totalTimeoutMs,
  };
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('ai', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify({ ...bersih, updatedBy: oleh }))
    .run();
  return { ok: true, pengaturan: bersih };
}

/** Jalur cepat lama: hanya ganti provider teks (dipakai UI provider sederhana). */
export async function simpanProviderAI(db: D1Database, provider: string, oleh: string | null, env: EnvAi = {}): Promise<Hasil<{ pengaturan: AiSettings }>> {
  const normal = String(provider || "").toLowerCase();
  if (!(PROVIDER_VALID as readonly string[]).includes(normal)) {
    return gagal(400, "Provider AI tidak dikenal.");
  }
  return simpanPengaturanAI(db, { textProvider: normal }, oleh, env);
}
