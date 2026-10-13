// lib/d1/rateLimit.ts — Rate limit sliding window in-memory, TANPA dependensi.
// Dipisah dari route.ts supaya kode Worker (lib/ai/*, bot) bisa memakainya tanpa
// ikut menarik next/server ke bundel.
// Catatan: peta ini per-isolat Worker — batas global butuh Durable Object/KV.
// ponytail: cukup untuk mencegah spam satu user; naikkan ke KV bila butuh lintas isolat.

const _catatan = new Map<string, number[]>();
const WINDOW_MS = 60_000;

/** Cek & catat satu permintaan. Kunci biasanya `d1:<tg_id>`. */
export function cekRateLimitD1(kunci: string, maksPerMenit: number): { ok: true } | { ok: false; status: number; error: string } {
  const now = Date.now();
  const arr = (_catatan.get(kunci) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= maksPerMenit) {
    return { ok: false, status: 429, error: "Terlalu banyak permintaan. Coba lagi sebentar lagi." };
  }
  arr.push(now);
  _catatan.set(kunci, arr);
  return { ok: true };
}
