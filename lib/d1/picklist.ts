// lib/d1/picklist.ts — Agregat read-only item order pending untuk picklist.
import { gagal, type Hasil } from "./db";

export type PickTarget = { mp: string; no: string };
export type PickRow = { sku: string; nama: string; qty: number };
export type Picklist = { orders: number; units: number; rows: PickRow[] };

/** Kumpulkan item dari order pending terpilih, agregat per SKU master, urut SKU. */
export async function buatPicklist(db: D1Database, targets: PickTarget[]): Promise<Hasil<Picklist>> {
  const unik = [...new Map(targets.map((t) => [`${t.mp}|${t.no}`, t])).values()];
  if (unik.length === 0) return gagal(400, "Pilih minimal satu order.");
  const rows: PickRow[] = [];
  for (const target of unik) {
    const order = await db
      .prepare("SELECT status_fulfill FROM orders WHERE marketplace = ? AND no_pesanan = ?")
      .bind(target.mp, target.no)
      .first<{ status_fulfill: string }>();
    if (!order) return gagal(404, `Pesanan ${target.no} tidak ditemukan.`);
    if (order.status_fulfill !== "pending") return gagal(409, `Pesanan ${target.no} bukan pending.`);
    const items = await db
      .prepare("SELECT i.sku, p.nama_accurate AS nama, i.qty FROM order_items i JOIN products p ON p.sku = i.sku WHERE i.marketplace = ? AND i.no_pesanan = ?")
      .bind(target.mp, target.no)
      .all<PickRow>();
    for (const item of items.results) {
      if (!item.nama) return gagal(409, `SKU ${item.sku} (order ${target.no}) tidak ada di master stok.`);
      rows.push({ sku: item.sku, nama: item.nama, qty: Number(item.qty) });
    }
  }
  const bySku = new Map<string, PickRow>();
  for (const row of rows) {
    const lama = bySku.get(row.sku);
    bySku.set(row.sku, lama ? { ...lama, qty: lama.qty + row.qty } : row);
  }
  const hasil = [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  return { ok: true, orders: unik.length, units: hasil.reduce((sum, row) => sum + row.qty, 0), rows: hasil };
}
