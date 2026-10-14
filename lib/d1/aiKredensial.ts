// lib/d1/aiKredensial.ts — CRUD kredensial provider AI di D1.
// Plaintext hanya ada di memori sesaat: masuk lewat `simpanKredensial` (langsung
// dienkripsi) dan keluar lewat `ambilKredensial` (untuk dipakai adapter).
// `daftarKredensial` TIDAK PERNAH mengembalikan plaintext — hanya mask.
import { dekripsi, enkripsi, maskKredensial } from "@/lib/ai/kripto";
import { gagal, sekarang, type Hasil } from "./hasil";

export type KredensialRingkas = {
  id: number;
  provider: string;
  label: string;
  mask: string;
  aktif: number;
  dibuat_at: number;
  dibuat_oleh: string | null;
  uji_at: number | null;
  /** Alamat dasar provider. '' = pakai bawaan (Kenari: dari secret/env). */
  base_url: string;
  /** Hasil uji terakhir, sudah di-parse. null bila belum pernah diuji. */
  uji_hasil: { ok: boolean; latencyMs?: number; model?: string; error?: string; at?: number } | null;
};

export type KredensialPenuh = KredensialRingkas & { plaintext: string };

type Baris = {
  id: number; provider: string; label: string; ciphertext: string; iv: string; tag: string;
  ujung: string; aktif: number; dibuat_at: number; dibuat_oleh: string | null;
  uji_at: number | null; uji_hasil: string | null; base_url: string;
};

/**
 * Normalisasi alamat dasar: trim, buang garis miring di ujung, tolak skema aneh.
 * Menerima host tanpa skema (mis. "kenari.id/v1") dan menambahkan https:// sendiri,
 * karena itu kesalahan yang mudah terjadi dan pesan errornya (HTTP 530/1016) tidak jelas.
 */
export function normalBase(v: unknown): string {
  let t = String(v ?? "").trim().replace(/\/+$/, "");
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(t)) return "";
  return t.slice(0, 200);
}

/** Parse hasil uji toleran: JSON rusak / kosong → null (jangan menggagalkan daftar). */
function parseUji(v: string | null): KredensialRingkas["uji_hasil"] {
  if (!v) return null;
  try {
    const d = JSON.parse(v) as Record<string, unknown>;
    if (typeof d !== "object" || d === null) return null;
    return {
      ok: d.ok === true,
      latencyMs: typeof d.latencyMs === "number" ? d.latencyMs : undefined,
      model: typeof d.model === "string" ? d.model : undefined,
      error: typeof d.error === "string" ? d.error : undefined,
      at: typeof d.at === "number" ? d.at : undefined,
    };
  } catch {
    return null;
  }
}

function keRingkas(b: Baris): KredensialRingkas {
  return {
    id: b.id,
    provider: b.provider,
    label: b.label,
    mask: maskKredensial(b.ujung),
    base_url: b.base_url ?? "",
    aktif: b.aktif,
    dibuat_at: b.dibuat_at,
    dibuat_oleh: b.dibuat_oleh,
    uji_at: b.uji_at,
    uji_hasil: parseUji(b.uji_hasil),
  };
}

const KOLOM = "id, provider, label, ciphertext, iv, tag, ujung, aktif, dibuat_at, dibuat_oleh, uji_at, uji_hasil, base_url";

/** Simpan kredensial baru (selalu INSERT — satu provider boleh punya beberapa kunci). */
export async function simpanKredensial(
  db: D1Database,
  data: { provider: string; label?: string; apiKey: string; baseUrl?: string; oleh: string | null },
  kunciEnkripsi: string
): Promise<Hasil<{ kredensial: KredensialRingkas }>> {
  const provider = String(data.provider ?? "").trim().toLowerCase();
  if (!provider) return gagal(400, "Provider wajib diisi.");
  const label = String(data.label ?? "").trim().slice(0, 60);
  if (!String(data.apiKey ?? "").trim()) return gagal(400, "API key wajib diisi.");

  let t;
  try {
    t = await enkripsi(data.apiKey, kunciEnkripsi);
  } catch (e) {
    return gagal(500, e instanceof Error ? e.message : "Gagal mengenkripsi kredensial.");
  }

  const baseUrl = normalBase(data.baseUrl);
  const r = await db
    .prepare(
      "INSERT INTO ai_kredensial (provider, label, ciphertext, iv, tag, ujung, aktif, dibuat_at, dibuat_oleh, base_url) " +
        "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)"
    )
    .bind(provider, label, t.ciphertext, t.iv, t.tag, t.ujung, sekarang(), data.oleh, baseUrl)
    .run();
  const id = Number(r.meta.last_row_id);
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_kredensial WHERE id = ?`).bind(id).first<Baris>();
  if (!baris) return gagal(500, "Gagal menyimpan kredensial.");
  return { ok: true, kredensial: keRingkas(baris) };
}

/** Daftar kredensial — SELALU tanpa plaintext. Provider opsional untuk filter. */
export async function daftarKredensial(db: D1Database, provider?: string): Promise<KredensialRingkas[]> {
  const p = (provider ?? "").trim().toLowerCase();
  const sql = p
    ? `SELECT ${KOLOM} FROM ai_kredensial WHERE provider = ? ORDER BY aktif DESC, id DESC`
    : `SELECT ${KOLOM} FROM ai_kredensial ORDER BY provider, aktif DESC, id DESC`;
  const { results } = await db.prepare(sql).bind(...(p ? [p] : [])).all<Baris>();
  return (results ?? []).map(keRingkas);
}

/** Kredensial aktif pertama untuk provider — ini satu-satunya jalur keluar plaintext. */
export async function ambilKredensial(db: D1Database, provider: string, kunciEnkripsi: string): Promise<KredensialPenuh | null> {
  const p = String(provider ?? "").trim().toLowerCase();
  if (!p) return null;
  const baris = await db
    .prepare(`SELECT ${KOLOM} FROM ai_kredensial WHERE provider = ? AND aktif = 1 ORDER BY id DESC LIMIT 1`)
    .bind(p)
    .first<Baris>();
  if (!baris) return null;
  try {
    const plaintext = await dekripsi(baris, kunciEnkripsi);
    return { ...keRingkas(baris), plaintext };
  } catch {
    // Kunci enkripsi berubah / data rusak → anggap tidak ada, jangan bocorkan detail.
    return null;
  }
}

/** Ubah alamat dasar kredensial yang sudah ada (tanpa perlu isi ulang API key). */
export async function setBaseKredensial(db: D1Database, id: number, baseUrl: string): Promise<Hasil<{ kredensial: KredensialRingkas }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const bersih = normalBase(baseUrl);
  // Pemanggil boleh sengaja mengosongkan (kembali ke bawaan provider).
  if (String(baseUrl ?? "").trim() !== "" && !bersih) {
    return gagal(400, "Alamat dasar tidak sah. Contoh yang benar: https://kenari.id/v1");
  }
  const r = await db.prepare("UPDATE ai_kredensial SET base_url = ? WHERE id = ?").bind(bersih, id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Kredensial tidak ditemukan.");
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_kredensial WHERE id = ?`).bind(id).first<Baris>();
  if (!baris) return gagal(404, "Kredensial tidak ditemukan.");
  return { ok: true, kredensial: keRingkas(baris) };
}

/** Nyalakan/matikan kredensial. */
export async function setAktifKredensial(db: D1Database, id: number, aktif: boolean): Promise<Hasil<{ kredensial: KredensialRingkas }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const r = await db.prepare("UPDATE ai_kredensial SET aktif = ? WHERE id = ?").bind(aktif ? 1 : 0, id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Kredensial tidak ditemukan.");
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_kredensial WHERE id = ?`).bind(id).first<Baris>();
  if (!baris) return gagal(404, "Kredensial tidak ditemukan.");
  return { ok: true, kredensial: keRingkas(baris) };
}

/** Hapus permanen. */
export async function hapusKredensial(db: D1Database, id: number): Promise<Hasil<{ dihapus: true }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const r = await db.prepare("DELETE FROM ai_kredensial WHERE id = ?").bind(id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Kredensial tidak ditemukan.");
  return { ok: true, dihapus: true };
}

/** Catat hasil uji koneksi terakhir untuk satu kredensial. */
export async function catatUji(
  db: D1Database,
  id: number,
  hasil: { ok: boolean; latencyMs?: number; model?: string; error?: string }
): Promise<void> {
  await db
    .prepare("UPDATE ai_kredensial SET uji_at = ?, uji_hasil = ? WHERE id = ?")
    .bind(sekarang(), JSON.stringify({ ...hasil, at: sekarang() }), id)
    .run();
}
