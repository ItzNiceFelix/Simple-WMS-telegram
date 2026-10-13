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
export const getEnvAi = cache((): { AI_PROVIDER_TEXT?: string; GEMINI_TIMEOUT_MS?: string; GEMINI_TOTAL_TIMEOUT_MS?: string } => {
  const { env } = getCloudflareContext();
  return {
    AI_PROVIDER_TEXT: env.AI_PROVIDER_TEXT as string | undefined,
    GEMINI_TIMEOUT_MS: env.GEMINI_TIMEOUT_MS as string | undefined,
    GEMINI_TOTAL_TIMEOUT_MS: env.GEMINI_TOTAL_TIMEOUT_MS as string | undefined,
  };
});

/** Unix epoch detik saat ini. */
export function sekarang(): number {
  return Math.floor(Date.now() / 1000);
}

/** Hasil bisnis standar: ok:true + data, atau ok:false + status HTTP + error. */
export type Hasil<T> = { ok: true } & T | { ok: false; status: number; error: string };

export function gagal(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}
