// lib/d1/ledger.ts — Ledger + kartu stok di D1 (Fase 1).
// stock_moves immutable: baca saja, tulis hanya via modul stok/transfer/opname.
export type Movement = {
  id: number; sku: string; nama_terbaca: string | null; variasi: string | null;
  qty: number | null; jenis: string; gudang_id: string | null; action_type: string | null;
  qty_sistem: number | null; qty_fisik: number | null; selisih: number | null;
  catatan: string | null; source: string | null; status: string;
  created_by: string | null; at: number;
};

export type MovementFilter = {
  sku?: string; jenis?: string; status?: string; gudang_id?: string;
  created_by?: string; dari?: number; sampai?: number; limit?: number;
};

export async function listMovements(db: D1Database, f: MovementFilter = {}): Promise<Movement[]> {
  let sql = "SELECT * FROM stock_moves WHERE 1=1";
  const args: unknown[] = [];
  if (f.sku) {
    sql += " AND sku = ?";
    args.push(f.sku);
  }
  if (f.jenis) {
    sql += " AND jenis = ?";
    args.push(f.jenis);
  }
  if (f.status) {
    sql += " AND status = ?";
    args.push(f.status);
  }
  if (f.gudang_id) {
    sql += " AND gudang_id = ?";
    args.push(f.gudang_id);
  }
  if (f.created_by) {
    sql += " AND created_by = ?";
    args.push(f.created_by);
  }
  if (f.dari != null) {
    sql += " AND at >= ?";
    args.push(f.dari);
  }
  if (f.sampai != null) {
    sql += " AND at <= ?";
    args.push(f.sampai);
  }
  sql += " ORDER BY at DESC, id DESC LIMIT ?";
  args.push(Math.min(f.limit ?? 50, 500));
  const { results } = await db.prepare(sql).bind(...args).all<Movement>();
  return results;
}

/** Kartu stok = ledger per SKU (+ gudang opsional), kronologis menaik. */
export async function kartuStok(db: D1Database, sku: string, gudangId?: string, limit = 200): Promise<Movement[]> {
  let sql = "SELECT * FROM stock_moves WHERE sku = ?";
  const args: unknown[] = [sku];
  if (gudangId) {
    sql += " AND gudang_id = ?";
    args.push(gudangId);
  }
  sql += " ORDER BY at ASC, id ASC LIMIT ?";
  args.push(Math.min(limit, 1000));
  const { results } = await db.prepare(sql).bind(...args).all<Movement>();
  return results;
}
