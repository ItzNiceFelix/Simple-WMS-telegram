// lib/d1/orderTransisi.ts — Transisi fulfillment (tunggal + batch atomik).
// Flag `stok_dikurangi` memisahkan dua makna status `kirim`:
//   0 = order diserahkan eksternal (sebelum WMS) → stok TIDAK pernah dipotong di sini;
//   1 = order dipack di WMS → stok sudah dipotong, wajib dikembalikan bila dibatalkan.
import { gagal, sekarang, type Hasil } from "./db";
import { bacaQty, GUDANG_ONLINE } from "./stok";

export const PETA_TRANSISI: Record<string, readonly string[]> = {
  pending: ["pack", "batal"],
  pack: ["kirim", "batal"],
  kirim: ["selesai", "batal"],
  selesai: [],
  batal: [],
};

export type KeFulfill = "pack" | "kirim" | "selesai" | "batal";
export type TargetFulfill = { mp: string; no: string; ke: KeFulfill };

type BarisItem = { sku: string; qty: number };
type MuatanOrder = { target: TargetFulfill; status: string; stokDikurangi: number; items: BarisItem[] };

async function ambilItems(db: D1Database, mp: string, no: string): Promise<BarisItem[]> {
  const { results } = await db
    .prepare("SELECT sku, qty FROM order_items WHERE marketplace = ? AND no_pesanan = ?")
    .bind(mp, no)
    .all<BarisItem>();
  return results;
}

/** Preflight satu order: status ada, transisi sah, dan stok cukup bila pack. */
async function preflight(db: D1Database, target: TargetFulfill, diperlukan: Map<string, number>): Promise<Hasil<{ muatan: MuatanOrder }>> {
  const order = await db
    .prepare("SELECT status_fulfill, stok_dikurangi FROM orders WHERE marketplace = ? AND no_pesanan = ?")
    .bind(target.mp, target.no)
    .first<{ status_fulfill: string; stok_dikurangi: number }>();
  if (!order) return gagal(404, `Order ${target.no} tidak ditemukan.`);
  if (!PETA_TRANSISI[order.status_fulfill]?.includes(target.ke)) {
    return gagal(409, `Transisi ${order.status_fulfill} → ${target.ke} tidak diizinkan (${target.no}).`);
  }
  const items = await ambilItems(db, target.mp, target.no);
  if (target.ke === "pack") {
    for (const it of items) diperlukan.set(it.sku, (diperlukan.get(it.sku) ?? 0) + it.qty);
  }
  return { ok: true, muatan: { target, status: order.status_fulfill, stokDikurangi: order.stok_dikurangi ?? 0, items } };
}

/** Cek agregat stok sekali untuk seluruh batch pack. */
async function cukupStok(db: D1Database, diperlukan: Map<string, number>): Promise<Hasil<{ kosong: true }>> {
  for (const [sku, qty] of diperlukan) {
    const stok = await bacaQty(db, sku, GUDANG_ONLINE);
    if (stok < qty) return gagal(400, `Stok ${sku} tidak cukup untuk pilihan ini (${stok} < ${qty}).`);
  }
  return { ok: true, kosong: true };
}

/** Susun statement stok+status; akumulasi delta per SKU supaya batch menulis nilai akhir, bukan nilai basi. */
async function susunStatements(db: D1Database, muatan: MuatanOrder[], oleh: string | null): Promise<D1PreparedStatement[]> {
  const stmts: D1PreparedStatement[] = [];
  const at = sekarang();
  const delta = new Map<string, number>();
  for (const m of muatan) {
    const kurangi = m.target.ke === "pack";
    const kembalikan = m.target.ke === "batal" && m.stokDikurangi === 1;
    if (!kurangi && !kembalikan) continue;
    for (const it of m.items) {
      const d = kurangi ? -it.qty : it.qty;
      delta.set(it.sku, (delta.get(it.sku) ?? 0) + d);
      stmts.push(
        db
          .prepare("INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, created_by, at, by) VALUES (?, ?, ?, ?, 'web_dashboard', 'processed', ?, ?, ?)")
          .bind(it.sku, d, kurangi ? "jual_mp" : "retur_mp", GUDANG_ONLINE, oleh, at, oleh)
      );
    }
  }
  const stokStmts: D1PreparedStatement[] = [];
  for (const [sku, d] of delta) {
    const lama = await bacaQty(db, sku, GUDANG_ONLINE);
    stokStmts.push(
      db
        .prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty")
        .bind(sku, GUDANG_ONLINE, lama + d)
    );
  }
  const statusStmts = muatan.map((m) => {
    const kurangi = m.target.ke === "pack";
    const flagBaru = kurangi ? 1 : m.target.ke === "batal" ? 0 : m.stokDikurangi;
    return db
      .prepare("UPDATE orders SET status_fulfill = ?, stok_dikurangi = ? WHERE marketplace = ? AND no_pesanan = ?")
      .bind(m.target.ke, flagBaru, m.target.mp, m.target.no);
  });
  return [...stokStmts, ...stmts, ...statusStmts];
}

/** Transisi satu order: preflight → satu batch (stok + status). */
export async function transisiFulfill(db: D1Database, mp: string, no: string, ke: KeFulfill, oleh: string | null): Promise<Hasil<{ status: string }>> {
  const hasil = await transisiFulfillBatch(db, [{ mp, no, ke }], oleh);
  if (!hasil.ok) return hasil;
  return { ok: true, status: ke };
}

/**
 * Transisi banyak order secara atomik: SELURUH preflight (status + stok agregat)
 * lulus dulu, baru satu `db.batch` menulis. Satu gagal → tidak ada perubahan.
 */
export async function transisiFulfillBatch(db: D1Database, targets: TargetFulfill[], oleh: string | null): Promise<Hasil<{ count: number; status: string }>> {
  const unik = [...new Map(targets.map((t) => [`${t.mp}|${t.no}`, t])).values()];
  if (unik.length === 0) return gagal(400, "Pilih minimal satu order.");

  const diperlukan = new Map<string, number>();
  const muatan: MuatanOrder[] = [];
  for (const target of unik) {
    const pf = await preflight(db, target, diperlukan);
    if (!pf.ok) return pf;
    muatan.push(pf.muatan);
  }
  const cukup = await cukupStok(db, diperlukan);
  if (!cukup.ok) return cukup;

  const stmts = await susunStatements(db, muatan, oleh);
  await db.batch(stmts);
  return { ok: true, count: muatan.length, status: unik[0].ke };
}
