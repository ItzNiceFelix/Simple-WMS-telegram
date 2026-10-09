// lib/d1/orderImportShopee.ts — Gabung sheet orders + Advance Fulfilment.
import { angkaShopee } from "./angkaShopee";
export type ShopeeOrderRow = Record<string, unknown>;
export type ShopeeAdvanceRow = Record<string, unknown>;
export type ShopeeDisposition = "belum_diserahkan" | "sudah_diserahkan";
export type ShopeeItem = { sku: string; qty: number; hargaSatuan: number; subtotal: number };
export type GabunganOrder = { marketplace: "shopee"; no_pesanan: string; tanggal: number; buyer: string; noResi: string; statusAwal: "pending" | "kirim"; items: ShopeeItem[] };
export type GagalShopee = { no_pesanan: string; sku?: string; pesan: string };
export type ReviewShopee = { no_pesanan: string; no_resi: string };
type Group = { no: string; tanggal: number; buyer: string; noResi: string; items: Map<string, ShopeeItem>; invalid: boolean };
const text = (v: unknown): string => typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
const dateEpoch = (v: unknown, fallback: unknown): number => { const ms = Date.parse((text(v) || text(fallback)).replace(" ", "T")); return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000); };
const skuOf = (row: ShopeeOrderRow): string => (text(row["Nomor Referensi SKU"]) || text(row["SKU Induk"])).toUpperCase();
function addItem(group: Group, sku: string, qty: number, subtotal: number, hargaSatuan: number): void { const old = group.items.get(sku); group.items.set(sku, { sku, qty: (old?.qty ?? 0) + qty, hargaSatuan: old?.hargaSatuan ?? hargaSatuan, subtotal: (old?.subtotal ?? 0) + subtotal }); }
export async function gabungkanSheetShopee(ordersRows: ShopeeOrderRow[], advanceRows: ShopeeAdvanceRow[], resolveSku: (sku: string) => Promise<boolean>, dispositions: Record<string, ShopeeDisposition> = {}): Promise<{ orders: GabunganOrder[]; gagal: GagalShopee[]; review: ReviewShopee[] }> {
  const groups = new Map<string, Group>(); const gagal: GagalShopee[] = [];
  for (const row of ordersRows) { const no = text(row["No. Pesanan"]); if (!no) continue; const g = groups.get(no) ?? { no, tanggal: dateEpoch(row["Waktu Pesanan Dibuat"], row["Waktu Pembayaran Dilakukan"]), buyer: text(row["Username (Pembeli)"]), noResi: text(row["No. Resi"]), items: new Map(), invalid: false }; groups.set(no, g); g.noResi ||= text(row["No. Resi"]); const sku = skuOf(row); if (!sku) { g.invalid = true; gagal.push({ no_pesanan: no, pesan: "SKU kosong (Nomor Referensi SKU + SKU Induk kosong)." }); continue; } const qty = angkaShopee(row["Jumlah"]); if (qty < 1) { g.invalid = true; gagal.push({ no_pesanan: no, sku, pesan: "Jumlah harus minimal 1." }); continue; } addItem(g, sku, qty, angkaShopee(row["Subtotal Pesanan"]), angkaShopee(row["Harga Setelah Diskon"])); }
  for (const row of advanceRows) { const no = text(row["Booking SN"]); if (!no) continue; const g = groups.get(no) ?? { no, tanggal: dateEpoch(row["Booking Creation Date"], row["Waktu Pembayaran Dilakukan"]), buyer: "", noResi: text(row["No. Resi"]), items: new Map(), invalid: false }; groups.set(no, g); g.noResi ||= text(row["No. Resi"]); const sku = skuOf(row); if (!sku) { g.invalid = true; gagal.push({ no_pesanan: no, pesan: "SKU kosong pada Advance Fulfilment." }); continue; } addItem(g, sku, 1, 0, 0); }
  const review = [...groups.values()].filter((g) => g.noResi).map((g) => ({ no_pesanan: g.no, no_resi: g.noResi })); const orders: GabunganOrder[] = [];
  for (const g of groups.values()) { const missing: string[] = []; for (const sku of g.items.keys()) if (!(await resolveSku(sku))) missing.push(sku); for (const sku of missing) gagal.push({ no_pesanan: g.no, sku, pesan: `SKU ${sku} tidak ditemukan di master stok.` }); const disposition = g.noResi ? dispositions[g.no] : undefined; if (g.invalid || missing.length || g.items.size === 0 || (g.noResi && !disposition)) continue; orders.push({ marketplace: "shopee", no_pesanan: g.no, tanggal: g.tanggal, buyer: g.buyer, noResi: g.noResi, statusAwal: disposition === "sudah_diserahkan" ? "kirim" : "pending", items: [...g.items.values()] }); }
  return { orders, gagal, review };
}
