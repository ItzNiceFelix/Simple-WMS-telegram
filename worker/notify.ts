// worker/notify.ts — Notify queue + cron drain (Fase 2, port scaFlow notify.js).
// Pola: notify_queue(kind, payload, target_user/group, sent_at, attempts,
// last_error) + batch per menit (limit 25, retry max 5) + migrasi supergroup
// otomatis + laporan stok harian. Tabel dibuat di migrasi 0004.
import type { Env } from "./api";
import { kirimPesanBot } from "./bot";

const DRAIN_LIMIT = 25;
const MAX_ATTEMPTS = 5;
/** B2-A: cap fanout per panggilan (drain 25/tick tetap jadi katup). */
const MAKS_FANOUT = 200;
/** B2-A: konkurensi kirim drain (ganti loop sekuensial). */
const KONKURENSI_DRAIN = 5;

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
    .prepare("SELECT tg_id FROM users WHERE notify_problem = 1 AND active = 1 LIMIT ?")
    .bind(MAKS_FANOUT)
    .all<{ tg_id: number }>()
    .catch(() => ({ results: [] as { tg_id: number }[] }));
  const sisa = MAKS_FANOUT - users.length;
  const { results: groups } = sisa <= 0 ? { results: [] as { chat_id: number }[] } : await db
    .prepare("SELECT chat_id FROM groups WHERE status = 'active' AND notify_problem = 1 LIMIT ?")
    .bind(sisa)
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
  const { results } = await env.DB.prepare(
    "SELECT id, kind, payload, target_user, target_group, attempts FROM notify_queue WHERE sent_at IS NULL AND attempts < ? ORDER BY created_at ASC LIMIT ?"
  ).bind(MAX_ATTEMPTS, DRAIN_LIMIT).all<{ id: number; kind: string; payload: string; target_user: number | null; target_group: number | null; attempts: number }>();
  let terkirim = 0;
  let gagal = 0;
  // B2-A: kirim paralel terbatas (ganti loop sekuensial) — hemat CPU-time.
  for (let i = 0; i < results.length; i += KONKURENSI_DRAIN) {
    const hasil = await Promise.allSettled(results.slice(i, i + KONKURENSI_DRAIN).map((q) => kirimSatu(env, q)));
    for (const h of hasil) {
      if (h.status === "fulfilled" && h.value === "terkirim") terkirim++;
      else gagal++;
    }
  }
  return { terkirim, gagal };
}

type BarisAntre = { id: number; kind: string; payload: string; target_user: number | null; target_group: number | null; attempts: number };

/** Kirim satu baris antrean; "terkirim" | "gagal". */
async function kirimSatu(env: Env, q: BarisAntre): Promise<"terkirim" | "gagal"> {
  const target = q.target_user ?? q.target_group;
  if (target == null) {
    await env.DB.prepare("DELETE FROM notify_queue WHERE id = ?").bind(q.id).run();
    return "gagal";
  }
  try {
    await kirimPesanBot(env, target, q.payload);
    await env.DB.prepare("UPDATE notify_queue SET sent_at = ? WHERE id = ?").bind(Math.floor(Date.now() / 1000), q.id).run();
    return "terkirim";
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    // Grup upgrade ke supergroup → update chat_id + retry sekali ke chat baru (pola scaFlow v13).
    const param = (e as Error & { telegram?: { parameters?: { migrate_to_chat_id?: number } } })?.telegram?.parameters?.migrate_to_chat_id;
    const upgraded = q.target_group != null && (param != null || /upgraded to a supergroup/i.test(pesan));
    if (upgraded && q.target_group != null) {
      const cocok = pesan.match(/-100\d+/);
      const chatBaru = Number(param ?? (cocok ? cocok[0] : q.target_group));
      await env.DB.prepare("UPDATE groups SET chat_id = ?, chat_type = 'supergroup', last_error = NULL WHERE chat_id = ?").bind(chatBaru, q.target_group).run().catch(() => undefined);
      await env.DB.prepare("UPDATE notify_queue SET target_group = ? WHERE target_group = ? AND sent_at IS NULL").bind(chatBaru, q.target_group).run().catch(() => undefined);
      await env.DB.prepare("DELETE FROM groups WHERE chat_id = ? AND id NOT IN (SELECT MIN(id) FROM groups WHERE chat_id = ?)").bind(chatBaru, chatBaru).run().catch(() => undefined);
      try {
        await kirimPesanBot(env, chatBaru, q.payload);
        await env.DB.prepare("UPDATE notify_queue SET sent_at = ?, last_error = NULL WHERE id = ?").bind(Math.floor(Date.now() / 1000), q.id).run();
        return "terkirim";
      } catch (e2) {
        const pesan2 = e2 instanceof Error ? e2.message : String(e2);
        await env.DB.prepare("UPDATE notify_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?").bind(pesan2.slice(0, 300), q.id).run();
        return "gagal";
      }
    }
    // Grup/user mati → hapus dari subscriber + tandai antrean
    if (/kicked|not enough rights|chat not found|bot was blocked|user is deactivated/i.test(pesan)) {
      if (q.target_group != null) {
        await env.DB.prepare("UPDATE groups SET status = 'left', last_error = ? WHERE chat_id = ?").bind(pesan.slice(0, 200), q.target_group).run().catch(() => undefined);
      }
      await env.DB.prepare("UPDATE notify_queue SET attempts = ?, last_error = ? WHERE id = ?").bind(q.attempts + 1, pesan.slice(0, 300), q.id).run();
    } else {
      await env.DB.prepare("UPDATE notify_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?").bind(pesan.slice(0, 300), q.id).run();
    }
    return "gagal";
  }
}

/** Laporan stok harian: tabel per gudang + top menipis (B7-A: 1 query GROUP BY). */
export async function bangunLaporanHarian(db: D1Database): Promise<string> {
  const { results: agregat } = await db.prepare(
    `SELECT w.id AS id, w.nama AS nama, COUNT(b.sku) AS n, COALESCE(SUM(b.qty), 0) AS s
     FROM warehouses w LEFT JOIN stock_by_bin b ON b.warehouse_id = w.id
     WHERE w.aktif = 1 GROUP BY w.id, w.nama ORDER BY w.urutan ASC`
  ).bind().all<{ id: string; nama: string; n: number; s: number }>();
  const baris: string[] = ["<b>Laporan stok harian</b>"];
  for (const g of agregat) {
    baris.push(`${g.nama}: ${g.n ?? 0} SKU, total ${g.s ?? 0} pcs`);
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

/** Cron laporan harian 00:05 UTC = 07:05 WIB (B1-A: pisah dari tick drain). */
export const LAPORAN_CRON = "5 0 * * *";

/** Tick cron: selalu drain antrean; laporan harian hanya pada cron-nya sendiri. */
export async function drainTick(env: Env, cron?: string): Promise<void> {
  await drainQueue(env);
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  const jendelaLama = wib.getUTCHours() === 7 && wib.getUTCMinutes() < 5;
  if (cron != null ? cron === LAPORAN_CRON : jendelaLama) {
    const teks = await bangunLaporanHarian(env.DB);
    await fanoutNotifikasi(env.DB, "report", teks);
    await drainQueue(env);
  }
}
