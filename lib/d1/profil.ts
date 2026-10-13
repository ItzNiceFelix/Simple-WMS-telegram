// lib/d1/profil.ts — Profil user (username, password) untuk halaman /profil.
// Dipakai route /api/profil/*. Hash password memakai pola PERSIS worker/auth.ts
// (PBKDF2-SHA256 100k, salt 16 byte) agar kompatibel dengan login.
import type { Hasil } from "./hasil";
import { hashPassword } from "@/worker/auth";

export type HasilProfil = Hasil<{ username: string }>;

/** Username yang tidak boleh dipakai (mirip role/kanal internal). */
export const KATA_TERLARANG = ["admin", "owner", "root", "telegram"];

export type Profil = { tg_id: string; username: string | null; nama: string; role: string };

/** Trim + lowercase (username selalu lowercase). */
export function normalUsername(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * Validasi username terhadap aturan + bentrok DB.
 * Aturan: 3–20 char, ^[a-z0-9_]+$, bukan kata terlarang, tidak sama dengan
 * tg_id user lain, dan belum dipakai user lain (lower(username) unik).
 */
export async function validasiUsername(
  db: D1Database,
  username: string,
  tgIdPemilik: string
): Promise<HasilProfil> {
  const u = normalUsername(username);
  if (u.length < 3 || u.length > 20) return { ok: false, status: 400, error: "Username harus 3–20 karakter." };
  if (!/^[a-z0-9_]+$/.test(u)) {
    return { ok: false, status: 400, error: "Username hanya boleh huruf kecil, angka, dan garis bawah (_)." };
  }
  if (KATA_TERLARANG.includes(u)) return { ok: false, status: 400, error: "Username itu tidak boleh dipakai." };
  // Angka murni akan bentrok dengan bentuk telegramId saat login — tolak sejak awal.
  if (/^[0-9]+$/.test(u)) {
    return { ok: false, status: 400, error: "Username tidak boleh angka semua agar tidak rancu dengan telegramId." };
  }
  // Username tidak boleh menyerupai telegramId user lain (bikin login ambigu).
  const bentrokTg = await db
    .prepare("SELECT 1 AS n FROM users WHERE tg_id = ? AND tg_id != ?")
    .bind(u, tgIdPemilik)
    .first<{ n: number }>();
  if (bentrokTg) return { ok: false, status: 409, error: "Username sama dengan telegramId user lain." };
  const dipakai = await db
    .prepare("SELECT 1 AS n FROM users WHERE lower(username) = ? AND tg_id != ?")
    .bind(u, tgIdPemilik)
    .first<{ n: number }>();
  if (dipakai) return { ok: false, status: 409, error: "Username sudah dipakai." };
  return { ok: true, username: u };
}

/** Validasi lalu simpan username baru untuk user tgId. */
export async function ubahUsername(db: D1Database, tgId: string, usernameBaru: string): Promise<HasilProfil> {
  const cek = await validasiUsername(db, usernameBaru, tgId);
  if (!cek.ok) return cek;
  try {
    const hasil = await db.prepare("UPDATE users SET username = ? WHERE tg_id = ?").bind(cek.username, tgId).run();
    if (!hasil.meta.changes) return { ok: false, status: 404, error: "User tidak ditemukan." };
  } catch (e) {
    // Balapan: user lain menyimpan username sama setelah validasi → UNIQUE gagal.
    if (String(e).includes("SQLITE_CONSTRAINT")) {
      return { ok: false, status: 409, error: "Username sudah dipakai." };
    }
    throw e;
  }
  return { ok: true, username: cek.username };
}

/** Profil ringkas untuk halaman /profil. */
export async function ambilProfil(db: D1Database, tgId: string): Promise<Profil | null> {
  return db
    .prepare("SELECT tg_id, username, display_name AS nama, role FROM users WHERE tg_id = ?")
    .bind(tgId)
    .first<Profil>();
}

/** Set/ganti password sendiri; hash mengikuti pola worker/auth.ts. */
export async function setPasswordSendiri(
  db: D1Database,
  tgId: string,
  passwordBaru: string
): Promise<Hasil<{ diset: true }>> {
  if (passwordBaru.length < 6) return { ok: false, status: 400, error: "Password minimal 6 karakter." };
  const hash = await hashPassword(passwordBaru);
  const hasil = await db
    .prepare("UPDATE users SET password_hash = ?, password_set_at = ? WHERE tg_id = ?")
    .bind(hash, Math.floor(Date.now() / 1000), tgId)
    .run();
  if (!hasil.meta.changes) return { ok: false, status: 404, error: "User tidak ditemukan." };
  return { ok: true, diset: true };
}
