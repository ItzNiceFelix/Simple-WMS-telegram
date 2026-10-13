// lib/d1/db.ts — Akses D1 request-scoped untuk route Next.js (Fase 1).
// Pola skill cloudflare-nextjs: getCloudflareContext() + react cache() agar
// satu request memakai satu konteks binding (hindari "Cannot perform I/O on
// behalf of a different request"). Fungsi bisnis menerima `db: D1Database`
// eksplisit supaya testable dengan mock (lihat d1.library.test.ts).
import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const getDb = cache((): D1Database => {
  const { env } = getCloudflareContext();
  return env.DB;
});

/**
 * Vars AI dari binding Worker (wrangler.jsonc), bukan process.env.
 * Lebih akurat: getCloudflareContext() membaca binding asli, sedangkan process.env
 * bergantung pada penyuntikan OpenNext. Dipakai route /api/baca?scope=ai.
 */
export const getEnvAi = cache((): { AI_PROVIDER_TEXT?: string; GEMINI_TIMEOUT_MS?: string; GEMINI_TOTAL_TIMEOUT_MS?: string; AI_KEY_ENCRYPTION_KEY?: string; KENARI_BASE_URL?: string } => {
  const { env } = getCloudflareContext();
  return {
    AI_PROVIDER_TEXT: env.AI_PROVIDER_TEXT as string | undefined,
    GEMINI_TIMEOUT_MS: env.GEMINI_TIMEOUT_MS as string | undefined,
    GEMINI_TOTAL_TIMEOUT_MS: env.GEMINI_TOTAL_TIMEOUT_MS as string | undefined,
    AI_KEY_ENCRYPTION_KEY: env.AI_KEY_ENCRYPTION_KEY as string | undefined,
    KENARI_BASE_URL: env.KENARI_BASE_URL as string | undefined,
  };
});

/** Kunci enkripsi kredensial. Terpisah agar pemanggilnya jelas butuh rahasia ini. */
export const getKunciEnkripsi = cache((): string => {
  const { env } = getCloudflareContext();
  return (env.AI_KEY_ENCRYPTION_KEY as string | undefined) ?? "";
});

/** Unix epoch detik saat ini. */
// Hasil, gagal, sekarang tinggal di lib/d1/hasil.ts (tanpa dependensi) supaya kode
// Worker bisa memakainya tanpa ikut menarik next/server. Di-re-export agar pemakai lama tetap jalan.
export { gagal, sekarang, type Hasil } from "./hasil";
