// lib/d1/admin.ts — Admin & role di D1 (Fase 1, paritas lib/models/admins.js).
// Hapus = soft (active=0) + access_requests → revoked agar audit utuh.
// Guard: bukan diri sendiri, owner terakhir tidak bisa didemosi/dinonaktifkan.
import { gagal, sekarang, type Hasil } from "./db";

export type AdminRow = {
  id: number; tg_id: number; username: string | null; display_name: string;
  role: string; active: number; jabatan: string | null; gudang_id: string | null;
};

export async function ambilAdmin(db: D1Database, tgId: string | number): Promise<AdminRow | null> {
  const row = await db
    .prepare(`SELECT u.*, (SELECT warehouse_id FROM user_warehouses WHERE user_id = u.id LIMIT 1) AS gudang_id
      FROM users u WHERE u.tg_id = ? AND u.active = 1`)
    .bind(Number(tgId))
    .first<AdminRow>();
  return row ?? null;
}

export function isOwner(admin: { role: string } | null): boolean {
  return admin?.role === "owner";
}

export function isAdmin(admin: { role: string } | null): boolean {
  return admin?.role === "owner" || admin?.role === "admin";
}

async function catatRole(db: D1Database, tgId: string, lama: string | null, baru: string | null, catatan: string | null, oleh: string | null): Promise<void> {
  await db.prepare("INSERT INTO admin_role_changes (tg_id, role_lama, role_baru, catatan, oleh, at) VALUES (?, ?, ?, ?, ?, ?)").bind(tgId, lama, baru, catatan, oleh, sekarang()).run();
}

export async function tambahAdmin(
  db: D1Database, tgId: string, nama: string, role: string, oleh: string | null
): Promise<Hasil<{ admin: AdminRow }>> {
  const tg = Number(tgId);
  if (!Number.isInteger(tg)) return gagal(400, "telegramId tidak valid.");
  if (!["owner", "admin", "guest"].includes(role)) return gagal(400, "Role tidak dikenal.");
  const ada = await ambilAdmin(db, tg);
  if (ada) return gagal(409, "User sudah terdaftar.");
  await db.prepare("INSERT INTO users (tg_id, display_name, role, added_at, approved_by) VALUES (?, ?, ?, ?, ?)").bind(tg, nama, role, sekarang(), oleh).run();
  await catatRole(db, String(tg), null, role, "tambah", oleh);
  const admin = await ambilAdmin(db, tg);
  if (!admin) return gagal(500, "Gagal menambah admin.");
  return { ok: true, admin };
}

export async function ubahRole(
  db: D1Database, tgId: string, roleBaru: string, oleh: string | null
): Promise<Hasil<{ admin: AdminRow }>> {
  if (String(tgId) === String(oleh)) return gagal(400, "Tidak bisa mengubah role sendiri.");
  if (!["owner", "admin", "guest"].includes(roleBaru)) return gagal(400, "Role tidak dikenal.");
  const target = await ambilAdmin(db, tgId);
  if (!target) return gagal(404, "User belum terdaftar.");
  if (target.role === "owner" && roleBaru !== "owner") {
    const sisa = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND tg_id != ?").bind(Number(tgId)).first<{ n: number }>();
    if ((sisa?.n ?? 0) === 0) return gagal(409, "Owner terakhir tidak bisa didemosi.");
  }
  const at = sekarang();
  await db.prepare("UPDATE users SET role = ?, role_updated_at = ?, role_updated_by = ? WHERE tg_id = ?").bind(roleBaru, at, oleh, Number(tgId)).run();
  await catatRole(db, String(tgId), target.role, roleBaru, null, oleh);
  const admin = await ambilAdmin(db, tgId);
  if (!admin) return gagal(500, "Gagal mengubah role.");
  return { ok: true, admin };
}

export async function hapusAdmin(
  db: D1Database, tgId: string, oleh: string | null
): Promise<Hasil<{ dihapus: true }>> {
  if (String(tgId) === String(oleh)) return gagal(400, "Tidak bisa menghapus diri sendiri.");
  const target = await ambilAdmin(db, tgId);
  if (!target) return gagal(404, "User belum terdaftar.");
  if (target.role === "owner") {
    const sisa = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND tg_id != ?").bind(Number(tgId)).first<{ n: number }>();
    if ((sisa?.n ?? 0) === 0) return gagal(409, "Owner terakhir tidak bisa dihapus.");
  }
  const at = sekarang();
  await db.batch([
    db.prepare("UPDATE users SET active = 0 WHERE tg_id = ?").bind(Number(tgId)),
    db.prepare("INSERT INTO access_requests (tg_id, status, revoked_by, revoked_at) VALUES (?, 'revoked', ?, ?) ON CONFLICT(tg_id) DO UPDATE SET status = 'revoked', revoked_by = excluded.revoked_by, revoked_at = excluded.revoked_at").bind(Number(tgId), oleh, at),
  ]);
  await catatRole(db, String(tgId), target.role, null, "hapus", oleh);
  return { ok: true, dihapus: true as const };
}

export async function setGudangUser(
  db: D1Database, tgId: string, gudangId: string | null, oleh: string | null
): Promise<Hasil<{ admin: AdminRow }>> {
  const target = await ambilAdmin(db, tgId);
  if (!target) return gagal(404, "User belum terdaftar.");
  if (gudangId != null && gudangId !== "") {
    const g = await db.prepare("SELECT id FROM warehouses WHERE id = ? AND aktif = 1").bind(gudangId).first();
    if (!g) return gagal(400, "Gudang tidak dikenal.");
  }
  const at = sekarang();
  await db.prepare("DELETE FROM user_warehouses WHERE user_id = ?").bind(target.id).run();
  if (gudangId != null && gudangId !== "") {
    await db.prepare("INSERT INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)").bind(target.id, gudangId).run();
  }
  await db.prepare("UPDATE users SET gudang_updated_at = ?, gudang_updated_by = ? WHERE id = ?").bind(at, oleh, target.id).run();
  await catatRole(db, String(tgId), target.role, target.role, "set_gudang", oleh);
  const admin = await ambilAdmin(db, tgId);
  if (!admin) return gagal(500, "Gagal mengatur gudang.");
  return { ok: true, admin };
}

export async function setJabatan(
  db: D1Database, tgId: string, jabatan: string | null, oleh: string | null
): Promise<Hasil<{ admin: AdminRow }>> {
  const target = await ambilAdmin(db, tgId);
  if (!target) return gagal(404, "User belum terdaftar.");
  const at = sekarang();
  await db.prepare("UPDATE users SET jabatan = ?, jabatan_updated_at = ?, jabatan_updated_by = ? WHERE id = ?").bind(jabatan?.trim() || null, at, oleh, target.id).run();
  const admin = await ambilAdmin(db, tgId);
  if (!admin) return gagal(500, "Gagal mengatur jabatan.");
  return { ok: true, admin };
}

export async function listAdmins(db: D1Database): Promise<AdminRow[]> {
  const { results } = await db
    .prepare(`SELECT u.*, (SELECT warehouse_id FROM user_warehouses WHERE user_id = u.id LIMIT 1) AS gudang_id
      FROM users u WHERE u.active = 1 ORDER BY u.role DESC, u.display_name ASC`)
    .all<AdminRow>();
  return results;
}
