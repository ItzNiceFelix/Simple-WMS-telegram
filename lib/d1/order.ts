// lib/d1/order.ts — Impor pesanan + CRUD/transisi (stok). Laba pindah ke /laba per preset (A4).
import { gagal, sekarang, type Hasil } from "./db";
import { ambilProduk } from "./produk";
import { bacaQty, GUDANG_ONLINE } from "./stok";

export type OrderItem = { sku: string; qty: number; harga_satuan: number; hpp_snapshot: number };
export type OrderFee = { jenis: string; basis: "flat" | "persen"; nilai: number };
export type BarisPesanan = {
  marketplace: string; no_pesanan: string; tanggal: number; buyer: string;
  sku: string; qty: number; harga_satuan: number;
};

type ItemGrup = { sku: string; qty: number; harga: number; hpp: number };
type GrupPesanan = {
  mp: string; no: string; tanggal: number; buyer: string;
  items: ItemGrup[];
};

/** Impor batch baris pesanan: kelompok per order, beku hpp_snapshot. Idempoten. Tanpa fee/pajak (laba di /laba). */
export async function imporPesanan(db: D1Database, daftar: BarisPesanan[], oleh: string | null): Promise<Hasil<{ order: number; item: number }>> {
  void oleh;
  for (const b of daftar) {
    if (!Number.isInteger(b.qty) || b.qty < 1) return gagal(400, `Qty ${b.sku} harus bilangan bulat ≥ 1 (order ${b.no_pesanan}).`);
    if (!Number.isInteger(b.harga_satuan) || b.harga_satuan < 0) return gagal(400, `Harga ${b.sku} harus bilangan bulat ≥ 0 (order ${b.no_pesanan}).`);
  }
  const grup: Record<string, GrupPesanan> = {};
  const urutan: string[] = [];
  for (const b of daftar) {
    const k = `${b.marketplace} ${b.no_pesanan}`;
    let g = grup[k];
    if (!g) {
      g = grup[k] = { mp: b.marketplace, no: b.no_pesanan, tanggal: b.tanggal, buyer: b.buyer ?? "", items: [] };
      urutan.push(k);
    }
    g.items.push({ sku: b.sku, qty: b.qty, harga: b.harga_satuan, hpp: 0 });
  }
  for (const k of urutan) {
    const g = grup[k];
    for (const it of g.items) {
      const p = await ambilProduk(db, it.sku);
      if (!p) return gagal(400, `SKU ${it.sku} tidak dikenal (order ${g.no}).`);
      it.hpp = p.hpp ?? 0;
    }
  }
  const stmts: D1PreparedStatement[] = [];
  let nItem = 0;
  for (const k of urutan) {
    const g = grup[k];
    stmts.push(db.prepare("INSERT OR IGNORE INTO orders (marketplace, no_pesanan, tanggal, buyer) VALUES (?, ?, ?, ?)").bind(g.mp, g.no, g.tanggal, g.buyer));
    // Ruling Task 3→4: reimport UPDATE header KECUALI status_fulfill (first-wins ditolak).
    stmts.push(db.prepare("UPDATE orders SET tanggal = ?, buyer = ? WHERE marketplace = ? AND no_pesanan = ?").bind(g.tanggal, g.buyer, g.mp, g.no));
    for (const it of g.items) {
      stmts.push(db.prepare("INSERT OR REPLACE INTO order_items (marketplace, no_pesanan, sku, qty, harga_satuan, hpp_snapshot, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(g.mp, g.no, it.sku, it.qty, it.harga, it.hpp, it.qty * it.harga));
      nItem++;
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { ok: true, order: urutan.length, item: nItem };
}

export { transisiFulfill, transisiFulfillBatch, type KeFulfill, type TargetFulfill } from "./orderTransisi";

export type OrderDetail = {
  marketplace: string; no_pesanan: string; tanggal: number; buyer: string;
  status_fulfill: string; pajak_pph: boolean; pajak_ppn_persen: number;
  items: (OrderItem & { subtotal: number })[];
  fees: (OrderFee & { amount: number })[];
};

/** Header + item + fee satu pesanan; null bila tak ada. */
export async function ambilOrder(db: D1Database, mp: string, no: string): Promise<OrderDetail | null> {
  const h = await db.prepare("SELECT marketplace, no_pesanan, tanggal, buyer, status_fulfill, pajak_pph, pajak_ppn_persen FROM orders WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).first<{ marketplace: string; no_pesanan: string; tanggal: number; buyer: string; status_fulfill: string; pajak_pph: number; pajak_ppn_persen: number }>();
  if (!h) return null;
  const { results: items } = await db.prepare("SELECT sku, qty, harga_satuan, hpp_snapshot, subtotal FROM order_items WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).all<OrderItem & { subtotal: number }>();
  const { results: fees } = await db.prepare("SELECT jenis, basis, nilai, amount FROM order_fees WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).all<OrderFee & { amount: number }>();
  return { marketplace: h.marketplace, no_pesanan: h.no_pesanan, tanggal: h.tanggal, buyer: h.buyer, status_fulfill: h.status_fulfill, pajak_pph: h.pajak_pph === 1, pajak_ppn_persen: h.pajak_ppn_persen, items, fees };
}

export type FilterOrder = { mp?: string; status?: string; dari?: number; sampai?: number; limit?: number };
export type RingkasOrder = { marketplace: string; no_pesanan: string; tanggal: number; buyer: string; status_fulfill: string };

/** Daftar header order terbaru dulu; filter mp/status/periode opsional. */
export async function listOrder(db: D1Database, filter: FilterOrder): Promise<RingkasOrder[]> {
  const syarat: string[] = [];
  const args: unknown[] = [];
  if (filter.mp) { syarat.push("marketplace = ?"); args.push(filter.mp); }
  if (filter.status) { syarat.push("status_fulfill = ?"); args.push(filter.status); }
  if (filter.dari !== undefined) { syarat.push("tanggal >= ?"); args.push(filter.dari); }
  if (filter.sampai !== undefined) { syarat.push("tanggal <= ?"); args.push(filter.sampai); }
  const sql = "SELECT marketplace, no_pesanan, tanggal, buyer, status_fulfill FROM orders" + (syarat.length > 0 ? ` WHERE ${syarat.join(" AND ")}` : "") + " ORDER BY tanggal DESC LIMIT ?";
  const { results } = await db.prepare(sql).bind(...args, Math.min(filter.limit ?? 100, 500)).all<RingkasOrder>();
  return results;
}
