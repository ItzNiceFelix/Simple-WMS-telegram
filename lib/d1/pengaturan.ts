// lib/d1/pengaturan.ts — Settings + provider AI di D1 (Fase 1, paritas aiSettings.js).
import { gagal, type Hasil } from "./db";

export const PROVIDER_VALID = ["gemini", "groq", "kenari", "openai", "openrouter"] as const;

/** Sumber env: process.env (route Node) atau CloudflareEnv (Worker). Semua opsional. */
export type EnvAi = {
  AI_PROVIDER_TEXT?: string | undefined;
  GEMINI_TIMEOUT_MS?: string | undefined;
  GEMINI_TOTAL_TIMEOUT_MS?: string | undefined;
};

export type AiSettings = {
  textProvider: string;
  geminiTimeoutMs: number;
  totalTimeoutMs: number;
};

export async function ambilPengaturanAI(db: D1Database, env: EnvAi = {}): Promise<AiSettings> {
  // Normalisasi SEKALI, lalu pakai nilai itu — jangan akses env.* mentah di cabang
  // (env.AI_PROVIDER_TEXT bisa undefined → .toLowerCase() melempar, dan string kosong
  // akan lolos sebagai provider yang tidak sah).
  const providerDiminta = String(env.AI_PROVIDER_TEXT ?? "").trim().toLowerCase();
  const dasar: AiSettings = {
    textProvider: (PROVIDER_VALID as readonly string[]).includes(providerDiminta) ? providerDiminta : "groq",
    geminiTimeoutMs: Number(env.GEMINI_TIMEOUT_MS) > 0 ? Number(env.GEMINI_TIMEOUT_MS) : 120000,
    totalTimeoutMs: Number(env.GEMINI_TOTAL_TIMEOUT_MS) > 0 ? Number(env.GEMINI_TOTAL_TIMEOUT_MS) : 240000,
  };
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'ai'").bind().first<{ value: string }>();
  if (!row) return dasar;
  try {
    const data = JSON.parse(row.value) as Partial<AiSettings>;
    const tp = String(data.textProvider || dasar.textProvider).toLowerCase();
    return {
      ...dasar,
      ...data,
      textProvider: (PROVIDER_VALID as readonly string[]).includes(tp) ? tp : dasar.textProvider,
      geminiTimeoutMs: Number(data.geminiTimeoutMs || dasar.geminiTimeoutMs),
      totalTimeoutMs: Number(data.totalTimeoutMs || dasar.totalTimeoutMs),
    };
  } catch {
    return dasar;
  }
}

export async function simpanProviderAI(db: D1Database, provider: string, oleh: string | null, env: EnvAi = {}): Promise<Hasil<{ pengaturan: AiSettings }>> {
  const normal = String(provider || "").toLowerCase();
  if (!(PROVIDER_VALID as readonly string[]).includes(normal)) {
    return gagal(400, "Provider AI tidak dikenal.");
  }
  const kini = await ambilPengaturanAI(db, env);
  const baru: AiSettings = { ...kini, textProvider: normal };
  await db.prepare("INSERT INTO settings (key, value) VALUES ('ai', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ ...baru, updatedBy: oleh })).run();
  return { ok: true, pengaturan: baru };
}
