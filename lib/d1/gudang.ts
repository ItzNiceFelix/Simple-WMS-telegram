// lib/d1/gudang.ts — Master gudang di D1 (Fase 1, paritas lib/models/gudang.js).
// Flat, maks 50 aktif (BR15), nama unik case-insensitive di yang aktif,
// nonaktif = soft (referensi lama tetap valid).
import { gagal, sekarang, type Hasil } from "./db";

export const MAKS_GUDANG = 50;

export type Gudang = {
  id: string;
  code: string;
  nama: string;
  aktif: number;
  urutan: number;
  is_online: number;
};

export async function ambilGudang(db: D1Database, gudangId: string): Promise<Gudang | null> {
  return db.prepare("SELECT * FROM warehouses WHERE id = ?").bind(gudangId).first<Gudang>();
}

export async function ambilGudangAktif(db: D1Database, gudangId: string): Promise<Gudang | null> {
  const g = await ambilGudang(db, gudangId);
  return g && g.aktif === 1 ? g : null;
}

export async function listGudang(db: D1Database, semua = false): Promise<Gudang[]> {
  const { results } = await db
    .prepare(`SELECT * FROM warehouses ${semua ? "" : "WHERE aktif = 1"} ORDER BY urutan ASC, nama ASC`)
    .all<Gudang>();
  return results;
}

export async function tambahGudang(
  db: D1Database,
  nama: string,
  oleh: string | null
): Promise<Hasil<{ gudang: Gudang }>> {
  const bersih = nama.trim();
  if (!bersih) return gagal(400, "Nama gudang wajib diisi.");
  const hitung = await db.prepare("SELECT COUNT(*) AS n FROM warehouses WHERE aktif = 1").first<{ n: number }>();
  if ((hitung?.n ?? 0) >= MAKS_GUDANG) return gagal(409, "Maksimum 50 gudang aktif.");
  const duplikat = await db
    .prepare("SELECT id FROM warehouses WHERE lower(nama) = lower(?) AND aktif = 1")
    .bind(bersih)
    .first();
  if (duplikat) return gagal(409, "Nama gudang sudah dipakai.");
  const id = `G${Date.now().toString(36).toUpperCase()}`;
  const at = sekarang();
  await db
    .prepare("INSERT INTO warehouses (id, code, nama, aktif, urutan, is_online, created_at, created_by) VALUES (?, ?, ?, 1, 100, 0, ?, ?)")
    .bind(id, id, bersih, at, oleh)
    .run();
  const gudang = await ambilGudang(db, id);
  if (!gudang) return gagal(500, "Gagal membuat gudang.");
  return { ok: true, gudang };
}

export async function editGudang(
  db: D1Database,
  gudangId: string,
  nama: string,
  oleh: string | null
): Promise<Hasil<{ gudang: Gudang }>> {
  const ada = await ambilGudang(db, gudangId);
  if (!ada) return gagal(404, "Gudang tidak ditemukan.");
  const bersih = nama.trim();
  if (!bersih) return gagal(400, "Nama gudang wajib diisi.");
  const duplikat = await db
    .prepare("SELECT id FROM warehouses WHERE lower(nama) = lower(?) AND aktif = 1 AND id != ?")
    .bind(bersih, gudangId)
    .first();
  if (duplikat) return gagal(409, "Nama gudang sudah dipakai.");
  await db
    .prepare("UPDATE warehouses SET nama = ?, updated_at = ?, updated_by = ? WHERE id = ?")
    .bind(bersih, sekarang(), oleh, gudangId)
    .run();
  const gudang = await ambilGudang(db, gudangId);
  if (!gudang) return gagal(500, "Gagal mengubah gudang.");
  return { ok: true, gudang };
}

export async function nonaktifGudang(
  db: D1Database,
  gudangId: string,
  oleh: string | null
): Promise<Hasil<{ gudang: Gudang; peringatan_referensi: number }>> {
  const ada = await ambilGudang(db, gudangId);
  if (!ada) return gagal(404, "Gudang tidak ditemukan.");
  if (ada.is_online === 1) return gagal(400, "Gudang ONLINE tidak bisa dinonaktifkan.");
  const ref = await hitungReferensiGudang(db, gudangId);
  await db
    .prepare("UPDATE warehouses SET aktif = 0, nonaktif_at = ?, nonaktif_by = ? WHERE id = ?")
    .bind(sekarang(), oleh, gudangId)
    .run();
  const gudang = await ambilGudang(db, gudangId);
  if (!gudang) return gagal(500, "Gagal menonaktifkan gudang.");
  return { ok: true, gudang, peringatan_referensi: ref };
}

export async function aktifkanGudang(
  db: D1Database,
  gudangId: string,
  oleh: string | null
): Promise<Hasil<{ gudang: Gudang }>> {
  const ada = await ambilGudang(db, gudangId);
  if (!ada) return gagal(404, "Gudang tidak ditemukan.");
  await db
    .prepare("UPDATE warehouses SET aktif = 1, updated_at = ?, updated_by = ? WHERE id = ?")
    .bind(sekarang(), oleh, gudangId)
    .run();
  const gudang = await ambilGudang(db, gudangId);
  if (!gudang) return gagal(500, "Gagal mengaktifkan gudang.");
  return { ok: true, gudang };
}

export async function hitungReferensiGudang(db: D1Database, gudangId: string): Promise<number> {
  const admin = await db
    .prepare("SELECT COUNT(*) AS n FROM user_warehouses WHERE warehouse_id = ?")
    .bind(gudangId)
    .first<{ n: number }>();
  const stok = await db
    .prepare("SELECT COUNT(DISTINCT sku) AS n FROM stock_by_bin WHERE warehouse_id = ?")
    .bind(gudangId)
    .first<{ n: number }>();
  return (admin?.n ?? 0) + (stok?.n ?? 0);
}

export async function pastikanGudang(
  db: D1Database,
  gudangId: string,
  nama: string
): Promise<Gudang> {
  const ada = await ambilGudang(db, gudangId);
  if (ada) return ada;
  await db
    .prepare("INSERT INTO warehouses (id, code, nama, aktif, urutan, is_online, created_at, created_by) VALUES (?, ?, ?, 1, 0, 0, ?, 'migrasi')")
    .bind(gudangId, gudangId, nama || gudangId, sekarang())
    .run();
  const buat = await ambilGudang(db, gudangId);
  if (!buat) throw new Error("Gagal memastikan gudang.");
  return buat;
}
