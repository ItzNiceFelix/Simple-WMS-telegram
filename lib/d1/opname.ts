// lib/d1/opname.ts — Opname gudang di D1 (Fase 1, paritas lib/models/opnameGudang.js).
// qty_sistem/selisih DIHITUNG SERVER. Setujui = CAS T9 (qty berubah → 409)
// lalu tulis qty_fisik + stock_moves jenis opname. Gagal audit ≠ rollback.
import { gagal, sekarang, type Hasil } from "./db";
import { bacaQty } from "./stok";

export type OpnameItem = { sku: string; qty_fisik: number };
export type OpnameDoc = {
  id: string;
  warehouse_id: string;
  status: string;
  created_at: number;
  created_by: string | null;
  items: { sku: string; qty_sistem: number | null; qty_fisik: number; selisih: number; belum_terdaftar: number }[];
};

export async function buatOpname(
  db: D1Database,
  gudangId: string,
  items: OpnameItem[],
  oleh: string | null
): Promise<Hasil<{ opname: OpnameDoc; langsung: boolean }>> {
  const g = await db.prepare("SELECT id FROM warehouses WHERE id = ? AND aktif = 1").bind(gudangId).first();
  if (!g) return gagal(400, "Gudang tidak dikenal.");
  if (!Array.isArray(items) || items.length === 0) return gagal(400, "Item opname kosong.");
  const id = `O${Date.now().toString(36).toUpperCase()}`;
  const at = sekarang();
  const baris: OpnameDoc["items"] = [];
  for (const it of items) {
    const sku = String(it.sku);
    const fisik = Math.floor(Number(it.qty_fisik));
    if (!sku || !Number.isInteger(fisik) || fisik < 0) return gagal(400, `Item ${sku || "?"} tidak valid.`);
    const p = await db.prepare("SELECT sku FROM products WHERE sku = ?").bind(sku).first();
    if (!p) return gagal(404, `Produk ${sku} tidak ditemukan.`);
    const row = await db.prepare("SELECT qty FROM stock_by_bin WHERE sku = ? AND warehouse_id = ?").bind(sku, gudangId).first<{ qty: number }>();
    const sistem = row ? row.qty : null;
    baris.push({ sku, qty_sistem: sistem, qty_fisik: fisik, selisih: sistem === null ? 0 : fisik - sistem, belum_terdaftar: sistem === null ? 1 : 0 });
  }
  const adaSelisih = baris.some((b) => b.belum_terdaftar === 0 && b.selisih !== 0);
  const status = adaSelisih ? "menunggu_approval" : "disetujui";
  await db.prepare("INSERT INTO stock_counts (id, warehouse_id, status, created_at, created_by, disetujui_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, gudangId, status, at, oleh, adaSelisih ? null : at).run();
  for (const b of baris) {
    await db.prepare("INSERT INTO count_lines (count_id, sku, qty_sistem, qty_fisik, selisih, belum_terdaftar) VALUES (?, ?, ?, ?, ?, ?)").bind(id, b.sku, b.qty_sistem, b.qty_fisik, b.selisih, b.belum_terdaftar).run();
  }
  await db.prepare("INSERT INTO count_status_log (count_id, status, oleh, at) VALUES (?, ?, ?, ?)").bind(id, status, oleh, at).run();
  if (!adaSelisih) {
    await terapkanHasilOpname(db, id, gudangId, baris, oleh, at);
  }
  const opname = await ambilOpname(db, id);
  if (!opname) return gagal(500, "Gagal membaca opname.");
  return { ok: true, opname, langsung: !adaSelisih };
}

async function terapkanHasilOpname(db: D1Database, id: string, gudangId: string, baris: OpnameDoc["items"], oleh: string | null, at: number): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const b of baris) {
    stmts.push(
      db.prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty").bind(b.sku, gudangId, b.qty_fisik),
      db.prepare(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, qty_sistem, qty_fisik, selisih, source, status, created_by, at, by)
        VALUES (?, ?, 'opname', ?, ?, ?, ?, 'web_dashboard', 'processed', ?, ?, ?)`).bind(b.sku, b.qty_fisik - (b.qty_sistem ?? 0), gudangId, b.qty_sistem, b.qty_fisik, b.selisih, oleh, at, oleh)
    );
  }
  await db.batch(stmts);
  void id;
}

export async function ambilOpname(db: D1Database, id: string): Promise<OpnameDoc | null> {
  const h = await db.prepare("SELECT * FROM stock_counts WHERE id = ?").bind(id).first<{ id: string; warehouse_id: string; status: string; created_at: number; created_by: string | null }>();
  if (!h) return null;
  const { results } = await db.prepare("SELECT sku, qty_sistem, qty_fisik, selisih, belum_terdaftar FROM count_lines WHERE count_id = ?").bind(id).all<OpnameDoc["items"][number]>();
  return { ...h, items: results };
}

export async function setujuiOpname(
  db: D1Database,
  id: string,
  oleh: string | null
): Promise<Hasil<{ opname: OpnameDoc; peringatan_audit: boolean }>> {
  const op = await ambilOpname(db, id);
  if (!op) return gagal(404, "Opname tidak ditemukan.");
  if (op.status !== "menunggu_approval") return gagal(409, "Opname sudah diproses.");
  // CAS T9: qty sistem harus sama seperti saat dibuat
  for (const b of op.items) {
    if (b.belum_terdaftar === 1) continue;
    if ((await bacaQty(db, b.sku, op.warehouse_id)) !== b.qty_sistem) {
      return gagal(409, "Stok berubah sejak opname dibuat. Buat ulang.");
    }
  }
  const at = sekarang();
  const r = await db.prepare("UPDATE stock_counts SET status = 'disetujui', disetujui_oleh = ?, disetujui_at = ? WHERE id = ? AND status = 'menunggu_approval'").bind(oleh, at, id).run();
  if ((r.meta.changes ?? 0) !== 1) return gagal(409, "Opname sudah diproses.");
  let peringatan = false;
  try {
    await terapkanHasilOpname(db, id, op.warehouse_id, op.items, oleh, at);
  } catch {
    peringatan = true;
  }
  await db.prepare("INSERT INTO count_status_log (count_id, status, oleh, at) VALUES (?, 'disetujui', ?, ?)").bind(id, oleh, at).run();
  const segar = await ambilOpname(db, id);
  if (!segar) return gagal(500, "Gagal membaca opname.");
  return { ok: true, opname: segar, peringatan_audit: peringatan };
}

export async function tolakOpname(
  db: D1Database,
  id: string,
  oleh: string | null
): Promise<Hasil<{ opname: OpnameDoc }>> {
  const op = await ambilOpname(db, id);
  if (!op) return gagal(404, "Opname tidak ditemukan.");
  if (op.status !== "menunggu_approval") return gagal(409, "Opname sudah diproses.");
  const at = sekarang();
  const r = await db.prepare("UPDATE stock_counts SET status = 'ditolak', ditolak_oleh = ?, ditolak_at = ? WHERE id = ? AND status = 'menunggu_approval'").bind(oleh, at, id).run();
  if ((r.meta.changes ?? 0) !== 1) return gagal(409, "Opname sudah diproses.");
  await db.prepare("INSERT INTO count_status_log (count_id, status, oleh, at) VALUES (?, 'ditolak', ?, ?)").bind(id, oleh, at).run();
  const segar = await ambilOpname(db, id);
  if (!segar) return gagal(500, "Gagal membaca opname.");
  return { ok: true, opname: segar };
}

export async function listOpname(db: D1Database, status?: string, gudangId?: string, limit = 50): Promise<OpnameDoc[]> {
  let sql = "SELECT id FROM stock_counts WHERE 1=1";
  const args: unknown[] = [];
  if (status) {
    sql += " AND status = ?";
    args.push(status);
  }
  if (gudangId) {
    sql += " AND warehouse_id = ?";
    args.push(gudangId);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(Math.min(limit, 200));
  const { results } = await db.prepare(sql).bind(...args).all<{ id: string }>();
  const keluar: OpnameDoc[] = [];
  for (const r of results) {
    const o = await ambilOpname(db, r.id);
    if (o) keluar.push(o);
  }
  return keluar;
}
