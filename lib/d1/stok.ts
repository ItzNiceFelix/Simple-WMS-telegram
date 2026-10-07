// lib/d1/stok.ts — Operasi stok di D1 (Fase 1, paritas lib/models/stok.js).
// Paritas BR3: baris `stock_by_bin(sku,'ONLINE')` adalah sumber angka online
// (kolom stok_gudang_online TIDAK ada di D1 — dihitung). Setiap perubahan
// qty menulis baris stock_moves (ledger). Stok negatif = fitur (keputusan I1).
import { gagal, sekarang, type Hasil } from "./db";

export const GUDANG_ONLINE = "ONLINE";

export type QtyMap = Record<string, number>;

export async function bacaQtyPerGudang(db: D1Database, sku: string): Promise<QtyMap> {
  const { results } = await db
    .prepare("SELECT warehouse_id, qty FROM stock_by_bin WHERE sku = ?")
    .bind(sku)
    .all<{ warehouse_id: string; qty: number }>();
  const map: QtyMap = {};
  for (const r of results) map[r.warehouse_id] = r.qty;
  return map;
}

export async function bacaQty(db: D1Database, sku: string, gudangId: string): Promise<number> {
  const row = await db
    .prepare("SELECT qty FROM stock_by_bin WHERE sku = ? AND warehouse_id = ?")
    .bind(sku, gudangId)
    .first<{ qty: number }>();
  return row?.qty ?? 0;
}

type TulisStok = {
  sku: string;
  gudangId: string;
  qtyBaru: number;
  oleh: string | null;
  jenis: "restock" | "koreksi_manual" | "opname" | "TRANSFER_IN" | "TRANSFER_OUT" | "OPENING";
  action_type?: string | null;
  qty_sistem?: number | null;
  qty_fisik?: number | null;
  source?: string;
};

/** Tulis qty absolut + baris ledger, atomik via batch. Produk/gudang harus ada. */
export async function tulisQty(
  db: D1Database,
  t: TulisStok
): Promise<Hasil<{ qty_per_gudang: QtyMap }>> {
  const produk = await db.prepare("SELECT sku FROM products WHERE sku = ?").bind(t.sku).first();
  if (!produk) return gagal(404, "Produk tidak ditemukan.");
  const gudang = await db.prepare("SELECT id FROM warehouses WHERE id = ?").bind(t.gudangId).first();
  if (!gudang) return gagal(400, "Gudang tidak dikenal.");
  const lama = await bacaQty(db, t.sku, t.gudangId);
  const selisih = t.qtyBaru - lama;
  const at = sekarang();
  await db.batch([
    db
      .prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty")
      .bind(t.sku, t.gudangId, t.qtyBaru),
    db
      .prepare(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, action_type, qty_sistem, qty_fisik,
        selisih, source, status, created_by, at, by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processed', ?, ?, ?)`)
      .bind(
        t.sku, selisih, t.jenis, t.gudangId, t.action_type ?? null,
        t.qty_sistem ?? lama, t.qty_fisik ?? t.qtyBaru, selisih,
        t.source ?? "web_dashboard", t.oleh, at, t.oleh
      ),
    db
      .prepare("UPDATE products SET last_stock_updated = ?, last_stock_updated_by = ? WHERE sku = ?")
      .bind(at, t.oleh, t.sku),
  ]);
  return { ok: true, qty_per_gudang: await bacaQtyPerGudang(db, t.sku) };
}

/** Ubah relatif satu gudang (basis = qty baris itu; ONLINE = paritas lama). */
export async function ubahRelatif(
  db: D1Database,
  sku: string,
  gudangId: string,
  delta: number,
  oleh: string | null,
  jenis: TulisStok["jenis"] = "koreksi_manual",
  source = "web_dashboard"
): Promise<Hasil<{ qty_per_gudang: QtyMap; nilai_baru: number }>> {
  const basis = await bacaQty(db, sku, gudangId);
  const r = await tulisQty(db, { sku, gudangId, qtyBaru: basis + delta, oleh, jenis, source });
  if (!r.ok) return r;
  return { ok: true, qty_per_gudang: r.qty_per_gudang, nilai_baru: basis + delta };
}

/** Pindah qty antar dua gudang (v5.2): cek cukup di dalam batch CAS. */
export async function mutasiAntarGudang(
  db: D1Database,
  sku: string,
  dariId: string,
  keId: string,
  qty: number,
  oleh: string | null
): Promise<Hasil<{ qty_per_gudang: QtyMap }>> {
  if (!Number.isInteger(qty) || qty < 1) return gagal(400, "Jumlah harus bilangan bulat >= 1.");
  if (dariId === keId) return gagal(400, "Gudang asal dan tujuan sama.");
  const produk = await db.prepare("SELECT sku FROM products WHERE sku = ?").bind(sku).first();
  if (!produk) return gagal(404, "Produk tidak ditemukan.");
  const qtyDari = await bacaQty(db, sku, dariId);
  if (qtyDari < qty) return gagal(409, "Stok gudang asal tidak cukup.");
  const qtyKe = await bacaQty(db, sku, keId);
  const at = sekarang();
  await db.batch([
    db
      .prepare("UPDATE stock_by_bin SET qty = ? WHERE sku = ? AND warehouse_id = ?")
      .bind(qtyDari - qty, sku, dariId),
    db
      .prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty")
      .bind(sku, keId, qtyKe + qty),
    db
      .prepare(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, action_type, source, status, created_by, at, by)
        VALUES (?, ?, 'TRANSFER_OUT', ?, 'mutasi_gudang', 'web_dashboard', 'processed', ?, ?, ?)`)
      .bind(sku, -qty, dariId, oleh, at, oleh),
    db
      .prepare(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, action_type, source, status, created_by, at, by)
        VALUES (?, ?, 'TRANSFER_IN', ?, 'mutasi_gudang', 'web_dashboard', 'processed', ?, ?, ?)`)
      .bind(sku, qty, keId, oleh, at, oleh),
  ]);
  return { ok: true, qty_per_gudang: await bacaQtyPerGudang(db, sku) };
}

/** Set reorder point (products.stok_min). Produk harus ada. */
export async function setReorderPoint(
  db: D1Database,
  sku: string,
  nilai: number | null,
  oleh: string | null
): Promise<Hasil<{ stok_min: number | null }>> {
  if (nilai !== null && (!Number.isInteger(nilai) || nilai < 0)) {
    return gagal(400, "Reorder point harus bilangan bulat >= 0 atau null.");
  }
  const produk = await db.prepare("SELECT sku FROM products WHERE sku = ?").bind(sku).first();
  if (!produk) return gagal(404, "Produk tidak ditemukan.");
  await db
    .prepare("UPDATE products SET stok_min = ?, last_stock_updated = ?, last_stock_updated_by = ? WHERE sku = ?")
    .bind(nilai, sekarang(), oleh, sku);
  return { ok: true, stok_min: nilai };
}

/** Stok di bawah reorder (pengganti full-scan Firestore; query langsung). */
export async function stokDiBawahReorder(
  db: D1Database,
  gudangId: string | null = null
): Promise<{ sku: string; qty: number; stok_min: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT b.sku AS sku, b.qty AS qty, p.stok_min AS stok_min
       FROM stock_by_bin b JOIN products p ON p.sku = b.sku
       WHERE p.stok_min IS NOT NULL AND b.qty < p.stok_min
       ${gudangId ? "AND b.warehouse_id = ?" : "AND b.warehouse_id = 'ONLINE'"}`
    )
    .bind(...(gudangId ? [gudangId] : []))
    .all<{ sku: string; qty: number; stok_min: number }>();
  return results;
}
