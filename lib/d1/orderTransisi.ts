// lib/d1/orderTransisi.ts — Transisi fulfillment (tunggal + batch atomik).
// Aturan stok: WMS TIDAK memotong stok; Kledo yang memotong (sinkron Kledo
// menimpa penuh stock_by_bin gudang non-ONLINE). Transisi hanya mengubah status.
// Flag `stok_dikurangi` dipertahankan sebagai penanda data lama:
//   0 = stok tidak pernah dipotong WMS (semua order baru);
//   1 = order lama era WMS yang memotong stok saat pack.
import { gagal, type Hasil } from "./hasil";

export const PETA_TRANSISI: Record<string, readonly string[]> = {
  pending: ["pack", "batal"],
  pack: ["kirim", "batal"],
  kirim: ["selesai", "batal"],
  selesai: [],
  batal: [],
};

export type KeFulfill = "pack" | "kirim" | "selesai" | "batal";
export type TargetFulfill = { mp: string; no: string; ke: KeFulfill };

type MuatanOrder = { target: TargetFulfill; status: string };

/** Preflight satu order: order ada dan transisi sah menurut PETA_TRANSISI. */
async function preflight(db: D1Database, target: TargetFulfill): Promise<Hasil<{ muatan: MuatanOrder }>> {
  const order = await db
    .prepare("SELECT status_fulfill FROM orders WHERE marketplace = ? AND no_pesanan = ?")
    .bind(target.mp, target.no)
    .first<{ status_fulfill: string }>();
  if (!order) return gagal(404, `Order ${target.no} tidak ditemukan.`);
  if (!PETA_TRANSISI[order.status_fulfill]?.includes(target.ke)) {
    return gagal(409, `Transisi ${order.status_fulfill} → ${target.ke} tidak diizinkan (${target.no}).`);
  }
  return { ok: true, muatan: { target, status: order.status_fulfill } };
}

/** Susun statement status saja; stok tidak disentuh (dipotong Kledo). */
function susunStatements(db: D1Database, muatan: MuatanOrder[]): D1PreparedStatement[] {
  return muatan.map((m) =>
    db
      .prepare("UPDATE orders SET status_fulfill = ? WHERE marketplace = ? AND no_pesanan = ?")
      .bind(m.target.ke, m.target.mp, m.target.no)
  );
}

/** Transisi satu order: preflight → satu batch (status). */
export async function transisiFulfill(db: D1Database, mp: string, no: string, ke: KeFulfill, oleh: string | null): Promise<Hasil<{ status: string }>> {
  const hasil = await transisiFulfillBatch(db, [{ mp, no, ke }], oleh);
  if (!hasil.ok) return hasil;
  return { ok: true, status: ke };
}

/**
 * Transisi banyak order secara atomik: SELURUH preflight lulus dulu, baru satu
 * `db.batch` menulis. Satu gagal → tidak ada perubahan.
 */
export async function transisiFulfillBatch(db: D1Database, targets: TargetFulfill[], oleh: string | null): Promise<Hasil<{ count: number; status: string }>> {
  const unik = [...new Map(targets.map((t) => [`${t.mp}|${t.no}`, t])).values()];
  if (unik.length === 0) return gagal(400, "Pilih minimal satu order.");

  const muatan: MuatanOrder[] = [];
  for (const target of unik) {
    const pf = await preflight(db, target);
    if (!pf.ok) return pf;
    muatan.push(pf.muatan);
  }

  await db.batch(susunStatements(db, muatan));
  return { ok: true, count: muatan.length, status: unik[0].ke };
}
