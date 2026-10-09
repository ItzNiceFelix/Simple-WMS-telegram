// lib/d1/akses.ts — Permintaan akses di D1 (Fase 1, paritas accessRequests.js).
// CAS: hanya status pending yang bisa diproses. Cooldown 1 jam setelah tolak.
import { gagal, sekarang, type Hasil } from "./db";

export const COOLDOWN_DETIK = 3600;

export type Akses = {
  tg_id: number; status: string; requested_at: number | null;
  telegram_username: string | null; telegram_display_name: string | null;
  rejected_until: number | null;
};

export async function mintaAkses(db: D1Database, tgId: number, username: string | null, displayName: string | null): Promise<Hasil<{ status: string }>> {
  const ada = await db.prepare("SELECT status, rejected_until FROM access_requests WHERE tg_id = ?").bind(tgId).first<{ status: string; rejected_until: number | null }>();
  const at = sekarang();
  if (ada) {
    if (ada.status === "pending") return gagal(409, "Permintaan masih menunggu.");
    if (ada.status === "approved") return gagal(409, "Sudah disetujui.");
    if (ada.rejected_until != null && ada.rejected_until > at) return gagal(429, "Coba lagi setelah cooldown.");
  }
  await db.prepare("INSERT INTO access_requests (tg_id, status, requested_at, telegram_username, telegram_display_name) VALUES (?, 'pending', ?, ?, ?) ON CONFLICT(tg_id) DO UPDATE SET status = 'pending', requested_at = excluded.requested_at").bind(tgId, at, username, displayName).run();
  return { ok: true, status: "pending" };
}

export async function putuskanAkses(db: D1Database, tgId: number, setuju: boolean, oleh: string | null): Promise<Hasil<{ status: string }>> {
  const at = sekarang();
  if (setuju) {
    // Ambil nama dari request sebelum status berubah.
    const req = await db
      .prepare("SELECT telegram_display_name, telegram_username FROM access_requests WHERE tg_id = ? AND status = 'pending'")
      .bind(tgId)
      .first<{ telegram_display_name: string | null; telegram_username: string | null }>();
    if (!req) return gagal(409, "Permintaan sudah diproses atau tidak ada.");
    const r = await db
      .prepare("UPDATE access_requests SET status = 'approved', resolved_by = ?, resolved_at = ?, rejected_until = NULL WHERE tg_id = ? AND status = 'pending'")
      .bind(oleh, at, tgId)
      .run();
    if ((r.meta.changes ?? 0) !== 1) return gagal(409, "Permintaan sudah diproses atau tidak ada.");
    // Resmikan langsung jadi users role guest — sesi kenalan legacy tak ada di worker,
    // tanpa baris users user nyangkut approved selamanya (gateAdmin tolak).
    await db
      .prepare("INSERT INTO users (tg_id, username, display_name, role, active, added_at, approved_by) VALUES (?, ?, ?, 'guest', 1, ?, ?) ON CONFLICT(tg_id) DO UPDATE SET active = 1, approved_by = excluded.approved_by")
      .bind(String(tgId), req.telegram_username, req.telegram_display_name ?? String(tgId), at, oleh)
      .run();
    return { ok: true, status: "approved" };
  }
  const r = await db
    .prepare("UPDATE access_requests SET status = 'rejected', resolved_by = ?, resolved_at = ?, rejected_until = ? WHERE tg_id = ? AND status = 'pending'")
    .bind(oleh, at, at + COOLDOWN_DETIK, tgId)
    .run();
  if ((r.meta.changes ?? 0) !== 1) return gagal(409, "Permintaan sudah diproses atau tidak ada.");
  return { ok: true, status: "rejected" };
}

export async function listAkses(db: D1Database, status?: string): Promise<Akses[]> {
  const { results } = await db
    .prepare(`SELECT tg_id, status, requested_at, telegram_username, telegram_display_name, rejected_until FROM access_requests ${status ? "WHERE status = ?" : ""} ORDER BY requested_at DESC LIMIT 200`)
    .bind(...(status ? [status] : []))
    .all<Akses>();
  return results;
}
