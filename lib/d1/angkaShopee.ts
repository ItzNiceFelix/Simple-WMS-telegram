// lib/d1/angkaShopee.ts — Parse angka export Shopee.
export function angkaShopee(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v !== "string") return 0;
  const n = Number(v.trim().replace(/\./g, "").replace(/,/g, "."));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
