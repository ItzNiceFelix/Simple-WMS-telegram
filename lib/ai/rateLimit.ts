// lib/ai/rateLimit.ts — Pembatas AI per user (Fase C, §5.C3).
// Port `lib/gemini/rateLimit.js` ke jalur hidup: pola sliding window 60 detik.
// Penyimpanan memakai `cekRateLimitD1` (lib/d1/route.ts) supaya TIDAK ada tabel
// baru — itu satu-satunya limiter yang sudah dipakai jalur dashboard.
// ponytail: skipped: distributed limiter, add when multi-isolate abuse is real.
import { cekRateLimitD1 } from "@/lib/d1/rateLimit";

export async function cekBatas(
  db: D1Database,
  tgId: string,
  batasPerMenit: number
): Promise<{ ok: true } | { ok: false; error: string; sisaDetik: number }> {
  const kunci = `ai:${tgId}`;
  const batas = batasPerMenit > 0 ? batasPerMenit : 20;
  const r = cekRateLimitD1(kunci, batas);
  if (r.ok) return { ok: true };
  return {
    ok: false,
    error: `Terlalu banyak pesan ke AI (batas ${batas}/menit). Tunggu sebentar, lalu coba lagi.`,
    sisaDetik: 60,
  };
}
