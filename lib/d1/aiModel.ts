// lib/d1/aiModel.ts — Katalog model AI: teks | gambar | vision, per provider.
// Sumber awal dari GET /v1/models provider; user bisa tambah manual.
import { gagal, sekarang, type Hasil } from "./db";

export const JENIS_MODEL = ["teks", "gambar", "vision"] as const;
export type JenisModel = (typeof JENIS_MODEL)[number];

export type ModelAi = {
  id: number;
  provider: string;
  model_id: string;
  label: string;
  jenis: JenisModel;
  aktif: number;
  ditambah_at: number;
};

const KOLOM = "id, provider, model_id, label, jenis, aktif, ditambah_at";

function sahJenis(v: unknown): v is JenisModel {
  return typeof v === "string" && (JENIS_MODEL as readonly string[]).includes(v);
}

export async function tambahModel(
  db: D1Database,
  data: { provider: string; model_id: string; label?: string; jenis?: string }
): Promise<Hasil<{ model: ModelAi }>> {
  const provider = String(data.provider ?? "").trim().toLowerCase();
  const modelId = String(data.model_id ?? "").trim();
  if (!provider) return gagal(400, "Provider wajib diisi.");
  if (!modelId) return gagal(400, "Nama model wajib diisi.");
  const jenis = sahJenis(data.jenis) ? data.jenis : "teks";

  // INSERT OR IGNORE: impor ulang dari provider tidak boleh menimpa label yang sudah diubah user.
  const r = await db
    .prepare("INSERT OR IGNORE INTO ai_model (provider, model_id, label, jenis, aktif, ditambah_at) VALUES (?, ?, ?, ?, 1, ?)")
    .bind(provider, modelId, String(data.label ?? "").trim().slice(0, 80), jenis, sekarang())
    .run();
  const baris = await db
    .prepare(`SELECT ${KOLOM} FROM ai_model WHERE provider = ? AND model_id = ?`)
    .bind(provider, modelId)
    .first<ModelAi>();
  if (!baris) return gagal(500, "Gagal menambah model.");
  void r;
  return { ok: true, model: baris };
}

/** Tambah banyak sekaligus (hasil tarik dari provider). Abaikan yang sudah ada. */
export async function tambahModelBanyak(
  db: D1Database,
  provider: string,
  daftar: { model_id: string; label?: string; jenis?: string }[]
): Promise<{ ditambah: number; dilewati: number }> {
  const p = String(provider ?? "").trim().toLowerCase();
  if (!p || daftar.length === 0) return { ditambah: 0, dilewati: 0 };
  const stmts = daftar.map((m) =>
    db
      .prepare("INSERT OR IGNORE INTO ai_model (provider, model_id, label, jenis, aktif, ditambah_at) VALUES (?, ?, ?, ?, 1, ?)")
      .bind(p, String(m.model_id).trim(), String(m.label ?? "").slice(0, 80), sahJenis(m.jenis) ? m.jenis : "teks", sekarang())
  );
  let ditambah = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const hasil = await db.batch(stmts.slice(i, i + 50));
    for (const h of hasil) ditambah += h.meta.changes ?? 0;
  }
  return { ditambah, dilewati: stmts.length - ditambah };
}

export async function daftarModel(db: D1Database, provider?: string, jenis?: string): Promise<ModelAi[]> {
  const syarat: string[] = [];
  const args: unknown[] = [];
  if (provider) { syarat.push("provider = ?"); args.push(provider.trim().toLowerCase()); }
  if (sahJenis(jenis)) { syarat.push("jenis = ?"); args.push(jenis); }
  const sql = `SELECT ${KOLOM} FROM ai_model${syarat.length ? ` WHERE ${syarat.join(" AND ")}` : ""} ORDER BY provider, jenis, model_id`;
  const { results } = await db.prepare(sql).bind(...args).all<ModelAi>();
  return results ?? [];
}

export async function setAktifModel(db: D1Database, id: number, aktif: boolean): Promise<Hasil<{ model: ModelAi }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const r = await db.prepare("UPDATE ai_model SET aktif = ? WHERE id = ?").bind(aktif ? 1 : 0, id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Model tidak ditemukan.");
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_model WHERE id = ?`).bind(id).first<ModelAi>();
  if (!baris) return gagal(404, "Model tidak ditemukan.");
  return { ok: true, model: baris };
}

export async function ubahLabelModel(db: D1Database, id: number, label: string): Promise<Hasil<{ model: ModelAi }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const bersih = String(label ?? "").trim().slice(0, 80);
  const r = await db.prepare("UPDATE ai_model SET label = ? WHERE id = ?").bind(bersih, id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Model tidak ditemukan.");
  const baris = await db.prepare(`SELECT ${KOLOM} FROM ai_model WHERE id = ?`).bind(id).first<ModelAi>();
  if (!baris) return gagal(404, "Model tidak ditemukan.");
  return { ok: true, model: baris };
}

export async function hapusModel(db: D1Database, id: number): Promise<Hasil<{ dihapus: true }>> {
  if (!Number.isInteger(id) || id <= 0) return gagal(400, "id tidak sah.");
  const r = await db.prepare("DELETE FROM ai_model WHERE id = ?").bind(id).run();
  if ((r.meta.changes ?? 0) === 0) return gagal(404, "Model tidak ditemukan.");
  return { ok: true, dihapus: true };
}

/** Model aktif untuk provider+jenis — dipakai adapter saat memilih model. */
export async function modelAktif(db: D1Database, provider: string, jenis: JenisModel): Promise<string | null> {
  const r = await db
    .prepare("SELECT model_id FROM ai_model WHERE provider = ? AND jenis = ? AND aktif = 1 ORDER BY id LIMIT 1")
    .bind(String(provider ?? "").trim().toLowerCase(), jenis)
    .first<{ model_id: string }>();
  return r?.model_id ?? null;
}
