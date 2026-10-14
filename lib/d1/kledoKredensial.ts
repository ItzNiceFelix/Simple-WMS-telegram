// lib/d1/kledoKredensial.ts — CRUD kredensial Kledo di D1.
// Pola SAMA dengan aiKredensial: plaintext hanya ada di memori sesaat, masuk lewat
// `simpanKledo` (langsung dienkripsi) dan keluar lewat `ambilKledo` (untuk sinkronisasi).
// `daftarKledo` TIDAK PERNAH mengembalikan plaintext — hanya mask.
//
// Kunci enkripsi memakai AI_KEY_ENCRYPTION_KEY yang sudah ada; tidak ada secret baru.
import { dekripsi, enkripsi, maskKredensial } from "@/lib/ai/kripto";
import { gagal, sekarang, type Hasil } from "./hasil";

export type KledoRingkas = {
  id: number;
  subdomain: string;
  label: string;
  mask: string;
  aktif: number;
  dibuat_at: number;
  dibuat_oleh: string | null;
  uji_at: number | null;
  uji_ok: number | null;
  uji_pesan: string | null;
};

export type KledoPenuh = KledoRingkas & { token: string };

type Baris = {
  id: number; subdomain: string; label: string; ciphertext: string; iv: string; tag: string;
  ujung: string; aktif: number; dibuat_at: number; dibuat_oleh: string | null;
  uji_at: number | null; uji_ok: number | null; uji_pesan: string | null;
};

/**
 * Normalisasi subdomain: terima "cv-hanaa-jaya", "cv-hanaa-jaya.api.kledo.com",
 * atau URL penuh "https://cv-hanaa-jaya.api.kledo.com/api/v1". Yang disimpan hanya
 * label subdomain-nya. Kesalahan bentuk di sini menghasilkan DNS error yang membingungkan.
 */
export function normalSubdomain(v: unknown): string {
  let t = String(v ?? "").trim().toLowerCase();
  if (!t) return "";
  t = t.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  t = t.replace(/\.api\.kledo\.com$/, "").replace(/\.kledo\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(t)) return "";
  return t.slice(0, 63);
}

function keRingkas(b: Baris): KledoRingkas {
  return {
    id: b.id,
    subdomain: b.subdomain,
    label: b.label,
    mask: maskKredensial(b.ujung),
    aktif: b.aktif,
    dibuat_at: b.dibuat_at,
    dibuat_oleh: b.dibuat_oleh,
    uji_at: b.uji_at,
    uji_ok: b.uji_ok,
    uji_pesan: b.uji_pesan,
  };
}

const KOLOM = "id, subdomain, label, ciphertext, iv, tag, ujung, aktif, dibuat_at, dibuat_oleh, uji_at, uji_ok, uji_pesan";

/**
 * Simpan/ganti kredensial untuk satu subdomain.
 * Subdomain adalah UNIQUE: menyimpan ulang berarti MENGGANTI token yang ada.
 */
export async function simpanKledo(
  db: D1Database,
  data: { subdomain: string; label?: string; token: string; oleh: string | null },
  kunciEnkripsi: string
): Promise<Hasil<{ kredensial: KledoRingkas }>> {
  const sub = normalSubdomain(data.subdomain);
  if (!sub) return gagal(400, `Subdomain tidak sah: "${String(data.subdomain ?? "").slice(0, 60)}". Contoh yang benar: cv-hanaa-jaya`);
  const token = String(data.token ?? "").trim();
  if (!token) return gagal(400, "Token (Personal Access Token) wajib diisi.");

  let ter;
  try {
    ter = await enkripsi(token, kunciEnkripsi);
  } catch (e) {
    return gagal(500, e instanceof Error ? e.message : String(e));
  }
  const label = String(data.label ?? "").trim().slice(0, 120);
  const at = sekarang();

  const ada = await db.prepare("SELECT id FROM kledo_kredensial WHERE subdomain = ?").bind(sub).first<{ id: number }>();
  if (ada) {
    await db
      .prepare("UPDATE kledo_kredensial SET label = ?, ciphertext = ?, iv = ?, tag = ?, ujung = ?, aktif = 1, dibuat_at = ?, dibuat_oleh = ?, uji_at = NULL, uji_ok = NULL, uji_pesan = NULL WHERE id = ?")
      .bind(label, ter.ciphertext, ter.iv, ter.tag, ter.ujung, at, data.oleh, ada.id)
      .run();
  } else {
    await db
      .prepare("INSERT INTO kledo_kredensial (subdomain, label, ciphertext, iv, tag, ujung, aktif, dibuat_at, dibuat_oleh) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)")
      .bind(sub, label, ter.ciphertext, ter.iv, ter.tag, ter.ujung, at, data.oleh)
      .run();
  }
  const baris = await db.prepare(`SELECT ${KOLOM} FROM kledo_kredensial WHERE subdomain = ?`).bind(sub).first<Baris>();
  if (!baris) return gagal(500, "Gagal menyimpan kredensial Kledo.");
  return { ok: true, kredensial: keRingkas(baris) };
}

/** Daftar kredensial — SELALU tanpa plaintext. */
export async function daftarKledo(db: D1Database): Promise<KledoRingkas[]> {
  const { results } = await db
    .prepare(`SELECT ${KOLOM} FROM kledo_kredensial ORDER BY aktif DESC, dibuat_at DESC`)
    .all<Baris>();
  return (results ?? []).map(keRingkas);
}

/** Kredensial aktif — ini satu-satunya jalur keluar plaintext. */
export async function ambilKledo(db: D1Database, kunciEnkripsi: string): Promise<KledoPenuh | null> {
  const baris = await db
    .prepare(`SELECT ${KOLOM} FROM kledo_kredensial WHERE aktif = 1 ORDER BY dibuat_at DESC LIMIT 1`)
    .first<Baris>();
  if (!baris) return null;
  let token = "";
  try {
    token = await dekripsi({ ciphertext: baris.ciphertext, iv: baris.iv, tag: baris.tag }, kunciEnkripsi);
  } catch {
    return null; // kunci enkripsi berubah / rusak → perlakukan sebagai tidak ada kredensial
  }
  return { ...keRingkas(baris), token };
}

/** Nyalakan/matikan kredensial. */
export async function setAktifKledo(db: D1Database, id: number, aktif: boolean): Promise<Hasil<{ kredensial: KledoRingkas }>> {
  const ada = await db.prepare("SELECT id FROM kledo_kredensial WHERE id = ?").bind(id).first();
  if (!ada) return gagal(404, "Kredensial tidak ditemukan.");
  await db.prepare("UPDATE kledo_kredensial SET aktif = ? WHERE id = ?").bind(aktif ? 1 : 0, id).run();
  const baris = await db.prepare(`SELECT ${KOLOM} FROM kledo_kredensial WHERE id = ?`).bind(id).first<Baris>();
  if (!baris) return gagal(500, "Gagal mengubah kredensial.");
  return { ok: true, kredensial: keRingkas(baris) };
}

/** Hapus permanen. */
export async function hapusKledo(db: D1Database, id: number): Promise<Hasil<{ dihapus: true }>> {
  await db.prepare("DELETE FROM kledo_kredensial WHERE id = ?").bind(id).run();
  return { ok: true, dihapus: true };
}

/** Catat hasil uji koneksi terakhir. */
export async function catatUjiKledo(
  db: D1Database,
  id: number,
  hasil: { ok: boolean; pesan?: string }
): Promise<void> {
  await db
    .prepare("UPDATE kledo_kredensial SET uji_at = ?, uji_ok = ?, uji_pesan = ? WHERE id = ?")
    .bind(sekarang(), hasil.ok ? 1 : 0, String(hasil.pesan ?? "").slice(0, 300), id)
    .run();
}

/** Ambil kredensial berdasarkan id (untuk uji tombol "Uji koneksi" pada baris tertentu). */
export async function ambilKledoById(db: D1Database, id: number, kunciEnkripsi: string): Promise<KledoPenuh | null> {
  const baris = await db.prepare(`SELECT ${KOLOM} FROM kledo_kredensial WHERE id = ?`).bind(id).first<Baris>();
  if (!baris) return null;
  let token = "";
  try {
    token = await dekripsi({ ciphertext: baris.ciphertext, iv: baris.iv, tag: baris.tag }, kunciEnkripsi);
  } catch {
    return null;
  }
  return { ...keRingkas(baris), token };
}
