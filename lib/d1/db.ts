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

/** Unix epoch detik saat ini. */
export function sekarang(): number {
  return Math.floor(Date.now() / 1000);
}

/** Hasil bisnis standar: ok:true + data, atau ok:false + status HTTP + error. */
export type Hasil<T> = { ok: true } & T | { ok: false; status: number; error: string };

export function gagal(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}
