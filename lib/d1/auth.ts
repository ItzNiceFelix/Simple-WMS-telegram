// lib/d1/auth.ts — Guard sesi untuk route Next.js (Fase 1).
// Memakai cookie swt_sesi (worker/auth.ts) yang diverifikasi ke tabel sessions
// D1. Route Next memanggil requireSession(request) lalu cek role/scope.
import { gagal, type Hasil } from "./hasil";

export type SesiPengguna = {
  id: number;
  tg_id: string;
  role: string;
  scope_gudang: string[];
  is_owner: boolean;
  is_admin: boolean;
};

async function sha256Hex(teks: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(teks).digest("hex");
}

export async function requireSession(
  db: D1Database,
  request: Request
): Promise<Hasil<{ user: SesiPengguna }>> {
  const cookie = request.headers.get("cookie") ?? "";
  const token = bacaCookie(cookie, "swt_sesi");
  if (!token) return gagal(401, "Belum login.");
  const tokenHash = await sha256Hex(token);
  // B8-A: 1 JOIN sesi+user (ganti 2 query sekuensial) + 1 query scope.
  const baris = await db
    .prepare(
      `SELECT s.user_id AS user_id, s.expires_at AS expires_at, u.id AS id, u.tg_id AS tg_id, u.role AS role
       FROM sessions s JOIN users u ON u.id = s.user_id AND u.active = 1
       WHERE s.token_hash = ? AND s.revoked_at IS NULL`
    )
    .bind(tokenHash)
    .first<{ user_id: number; expires_at: number; id: number; tg_id: string; role: string }>();
  if (!baris || baris.expires_at * 1000 <= Date.now()) return gagal(401, "Sesi kedaluwarsa.");
  const { results } = await db
    .prepare("SELECT warehouse_id FROM user_warehouses WHERE user_id = ?")
    .bind(baris.id)
    .all<{ warehouse_id: string }>();
  const role = ["owner", "admin", "guest"].includes(baris.role) ? baris.role : "guest";
  return {
    ok: true,
    user: {
      id: baris.id,
      tg_id: String(baris.tg_id),
      role,
      scope_gudang: results.map((r) => r.warehouse_id),
      is_owner: role === "owner",
      is_admin: role === "owner" || role === "admin",
    },
  };
}

/** Guard tulis butuh owner/admin; admin ter-scope gudang target bila ada. */
export function bolehTulisGudang(user: SesiPengguna, gudangId: string | null): boolean {
  if (user.is_owner) return true;
  if (!user.is_admin) return false;
  if (gudangId == null) return true;
  return user.scope_gudang.includes(gudangId);
}

function bacaCookie(header: string, nama: string): string | null {
  for (const bagian of header.split(";")) {
    const idx = bagian.indexOf("=");
    if (idx < 0) continue;
    if (bagian.slice(0, idx).trim() === nama) return bagian.slice(idx + 1).trim();
  }
  return null;
}
