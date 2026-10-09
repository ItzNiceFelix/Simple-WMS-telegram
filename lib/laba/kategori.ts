// lib/laba/kategori.ts — Resolver tier kategori murni (E-R1, tanpa D1).
// Urutan §2.1 v2: tier_override → path persis → prefix induk terpanjang → belum terpetakan.

export const TIER_UNKNOWN = "T_UNKNOWN";

/** Normalisasi path: rapikan spasi dan pemisah '>'. */
export function normalisasiPath(path: string): string {
  return path.split(">").map((s) => s.trim()).filter(Boolean).join(" > ");
}

/**
 * Cari tier untuk satu produk.
 * @param tabel map path ternormalisasi → tier
 * @returns tier + path yang cocok (null bila belum terpetakan)
 */
export function resolveTier(
  kategori: string | null,
  overrideTier: string | null,
  tabel: Map<string, string>
): { tier: string; pathCocok: string | null } {
  if (overrideTier && overrideTier.trim()) return { tier: overrideTier.trim(), pathCocok: null };
  if (!kategori || !kategori.trim()) return { tier: TIER_UNKNOWN, pathCocok: null };
  const path = normalisasiPath(kategori);
  const langsung = tabel.get(path);
  if (langsung) return { tier: langsung, pathCocok: path };
  // Prefix induk terpanjang: "A > B > C" → coba "A > B", lalu "A".
  const bagian = path.split(" > ");
  for (let n = bagian.length - 1; n >= 1; n--) {
    const induk = bagian.slice(0, n).join(" > ");
    const tier = tabel.get(induk);
    if (tier) return { tier, pathCocok: induk };
  }
  return { tier: TIER_UNKNOWN, pathCocok: null };
}
