// worker/notify.ts — Notify queue + cron drain (Fase 2, port scaFlow notify.js).
// Pola: notify_queue(kind, payload, target_user/group, sent_at, attempts,
// last_error) + batch per menit (limit 25, retry max 5) + migrasi supergroup
// otomatis + laporan stok harian. Tabel dibuat di migrasi 0004.
import type { Env } from "./api";
import { kirimPesanBot } from "./bot";

const DRAIN_LIMIT = 25;
const MAX_ATTEMPTS = 5;

export async function antreNotifikasi(
  db: D1Database,
  kind: "problem" | "report" | "info",
  teks: string,
  targetUser: number | null = null,
  targetGroup: number | null = null
): Promise<void> {
  await db
    .prepare("INSERT INTO notify_queue (kind, payload, target_user, target_group) VALUES (?, ?, ?, ?)")
    .bind(kind, teks, targetUser, targetGroup)
    .run();
}

/** Fan-out ke semua subscriber (users notify_problem=1 + groups aktif). */
export async function fanoutNotifikasi(db: D1Database, kind: "problem" | "report" | "info", teks: string): Promise<number> {
  const { results: users } = await db
    .prepare("SELECT tg_id FROM users WHERE notify_problem = 1 AND active = 1")
    .bind()
    .all<{ tg_id: number }>()
    .catch(() => ({ results: [] as { tg_id: number }[] }));
  const { results: groups } = await db
    .prepare("SELECT chat_id FROM groups WHERE status = 'active' AND notify_problem = 1")
    .bind()
    .all<{ chat_id: number }>()
    .catch(() => ({ results: [] as { chat_id: number }[] }));
  const stmts: D1PreparedStatement[] = [];
  for (const u of users) stmts.push(db.prepare("INSERT INTO notify_queue (kind, payload, target_user) VALUES (?, ?, ?)").bind(kind, teks, u.tg_id));
  for (const g of groups) stmts.push(db.prepare("INSERT INTO notify_queue (kind, payload, target_group) VALUES (?, ?, ?)").bind(kind, teks, g.chat_id));
  if (stmts.length === 0) return 0;
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return stmts.length;
}

/** Drain antrean: kirim ≤25, retry max 5, tangani grup termigrasi/ditendang. */
export async function drainQueue(env: Env): Promise<{ terkirim: number; gagal: number }> {
  let terkirim = 0;
  let gagal = 0;
  const { results } = await env.DB.prepare(
    "SELECT id, kind, payload, target_user, target_group, attempts FROM notify_queue WHERE sent_at IS NULL AND attempts < ? ORDER BY created_at ASC LIMIT ?"
  ).bind(MAX_ATTEMPTS, DRAIN_LIMIT).all<{ id: number; kind: string; payload: string; target_user: number | null; target_group: number | null; attempts: number }>();
  for (const q of results) {
    const target = q.target_user ?? q.target_group;
    if (target == null) {
      await env.DB.prepare("DELETE FROM notify_queue WHERE id = ?").bind(q.id).run();
      continue;
    }
    try {
      await kirimPesanBot(env, target, q.payload);
      await env.DB.prepare("UPDATE notify_queue SET sent_at = ? WHERE id = ?").bind(Math.floor(Date.now() / 1000), q.id).run();
      terkirim++;
    } catch (e) {
      const pesan = e instanceof Error ? e.message : String(e);
      // Grup upgrade ke supergroup → catat, migrasi ditangani webhook (FIX_NOTES v13)
      // Grup/user mati → hapus dari subscriber + tandai antrean
      if (/kicked|not enough rights|chat not found|bot was blocked|user is deactivated/i.test(pesan)) {
        if (q.target_group != null) {
          await env.DB.prepare("UPDATE groups SET status = 'left', last_error = ? WHERE chat_id = ?").bind(pesan.slice(0, 200), q.target_group).run().catch(() => undefined);
        }
        await env.DB.prepare("UPDATE notify_queue SET attempts = ?, last_error = ? WHERE id = ?").bind(q.attempts + 1, pesan.slice(0, 300), q.id).run();
      } else {
        await env.DB.prepare("UPDATE notify_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?").bind(pesan.slice(0, 300), q.id).run();
      }
      gagal++;
    }
  }
  return { terkirim, gagal };
}

/** Laporan stok harian: tabel per gudang + top menipis. */
export async function bangunLaporanHarian(db: D1Database): Promise<string> {
  const { results: gudang } = await db.prepare("SELECT id, nama FROM warehouses WHERE aktif = 1 ORDER BY urutan ASC").bind().all<{ id: string; nama: string }>();
  const baris: string[] = ["<b>Laporan stok harian</b>"];
  for (const g of gudang) {
    const total = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(qty),0) AS s FROM stock_by_bin WHERE warehouse_id = ?").bind(g.id).first<{ n: number; s: number }>();
    baris.push(`${g.nama}: ${total?.n ?? 0} SKU, total ${total?.s ?? 0} pcs`);
  }
  const { results: tipis } = await db.prepare(
    `SELECT p.sku, b.qty, p.stok_min FROM products p JOIN stock_by_bin b ON b.sku = p.sku
     WHERE p.stok_min IS NOT NULL AND b.qty < p.stok_min AND b.warehouse_id = 'ONLINE'
     ORDER BY b.qty ASC LIMIT 10`
  ).bind().all<{ sku: string; qty: number; stok_min: number }>();
  if (tipis.length > 0) {
    baris.push("");
    baris.push("<b>Menipis:</b>");
    for (const t of tipis) baris.push(`• ${t.sku}: ${t.qty} (min ${t.stok_min})`);
  }
  return baris.join("\n");
}

/** Tick cron: drain antrean; tiap jam 07:00 WIB kirim laporan harian. */
export async function drainTick(env: Env): Promise<void> {
  await drainQueue(env);
  const wibJam = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
  const wibMenit = new Date(Date.now() + 7 * 3600 * 1000).getUTCMinutes();
  if (wibJam === 7 && wibMenit < 5) {
    const teks = await bangunLaporanHarian(env.DB);
    await fanoutNotifikasi(env.DB, "report", teks);
    await drainQueue(env);
  }
}
