// lib/d1/preset.ts — CRUD preset toko + aturan + program (A1/A2/A-R1).
// Tulis: owner. Baca: admin. Hapus preset bersnapshot = soft delete.
import { gagal, sekarang, type Hasil } from "./db";

export type Preset = {
  id: number; nama: string; marketplace: string; status_toko: string;
  aktif: number; status_berlaku_sejak: string | null; dihapus_at: number | null;
  jml_aturan?: number;
};

const STATUS_VALID = ["non_star", "star", "star_plus"];
const VERIFIKASI_VALID = ["resmi", "resmi_cuplikan", "sekunder", "belum"];

export function validasiNama(nama: string): string | null {
  const n = nama.trim();
  if (!n) return "Nama preset wajib diisi.";
  if (n.length > 80) return "Nama preset maksimal 80 karakter.";
  return null;
}

/** Daftar preset aktif (termasuk hitung aturan). */
export async function listPreset(db: D1Database): Promise<Preset[]> {
  const { results } = await db.prepare(
    "SELECT p.id, p.nama, p.marketplace, p.status_toko, p.aktif, p.status_berlaku_sejak, p.dihapus_at, " +
    "(SELECT COUNT(*) FROM fee_rules r WHERE r.preset_id = p.id) AS jml_aturan " +
    "FROM seller_presets p WHERE p.dihapus_at IS NULL ORDER BY p.id"
  ).all<Preset>();
  return results;
}

export async function tambahPreset(
  db: D1Database, nama: string, statusToko: string
): Promise<Hasil<{ id: number }>> {
  const err = validasiNama(nama);
  if (err) return gagal(400, err);
  if (!STATUS_VALID.includes(statusToko)) return gagal(400, "Status toko tak dikenal (non_star/star/star_plus).");
  const ins = await db.prepare(
    "INSERT INTO seller_presets (nama, marketplace, status_toko) VALUES (?, 'shopee', ?)"
  ).bind(nama.trim(), statusToko).run();
  const id = Number(ins.meta.last_row_id);
  // Seed default program toggle (nonaktif) agar matriks UI lengkap.
  const { results: progs } = await db.prepare("SELECT kode_program FROM program_katalog").all<{ kode_program: string }>();
  for (const p of progs) {
    await db.prepare(
      "INSERT OR IGNORE INTO preset_program (preset_id, kode_program, aktif) VALUES (?, ?, 0)"
    ).bind(id, p.kode_program).run();
  }
  await db.prepare("INSERT OR IGNORE INTO preset_penghitung (preset_id) VALUES (?)").bind(id).run();
  return { ok: true, id };
}

export async function duplikatPreset(
  db: D1Database, id: number
): Promise<Hasil<{ id: number }>> {
  const asal = await db.prepare(
    "SELECT id, nama, marketplace, status_toko FROM seller_presets WHERE id = ? AND dihapus_at IS NULL"
  ).bind(id).first<{ id: number; nama: string; marketplace: string; status_toko: string }>();
  if (!asal) return gagal(404, "Preset tidak ditemukan.");
  const ins = await db.prepare(
    "INSERT INTO seller_presets (nama, marketplace, status_toko) VALUES (?, ?, ?)"
  ).bind(`${asal.nama} (salinan)`, asal.marketplace, asal.status_toko).run();
  const baru = Number(ins.meta.last_row_id);
  // Salin seluruh aturan (id baru).
  const { results: rules } = await db.prepare("SELECT * FROM fee_rules WHERE preset_id = ?").bind(id).all<Record<string, unknown>>();
  for (const r of rules) {
    const cols = Object.keys(r).filter((c) => c !== "id");
    const vals = cols.map((c) => (c === "preset_id" ? baru : r[c]));
    await db.prepare(
      `INSERT INTO fee_rules (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
    ).bind(...vals).run();
  }
  const { results: progs } = await db.prepare(
    "SELECT kode_program, aktif, aktif_sejak, aktif_sampai FROM preset_program WHERE preset_id = ?"
  ).bind(id).all<{ kode_program: string; aktif: number; aktif_sejak: string | null; aktif_sampai: string | null }>();
  for (const p of progs) {
    await db.prepare(
      "INSERT INTO preset_program (preset_id, kode_program, aktif, aktif_sejak, aktif_sampai) VALUES (?, ?, ?, ?, ?)"
    ).bind(baru, p.kode_program, p.aktif, p.aktif_sejak, p.aktif_sampai).run();
  }
  return { ok: true, id: baru };
}

export async function ubahPreset(
  db: D1Database, id: number, patch: { nama?: string; status_toko?: string; status_berlaku_sejak?: string | null }
): Promise<Hasil<{ id: number }>> {
  const asal = await db.prepare(
    "SELECT id FROM seller_presets WHERE id = ? AND dihapus_at IS NULL"
  ).bind(id).first<{ id: number }>();
  if (!asal) return gagal(404, "Preset tidak ditemukan.");
  if (patch.nama !== undefined) {
    const err = validasiNama(patch.nama);
    if (err) return gagal(400, err);
    await db.prepare("UPDATE seller_presets SET nama = ?, diubah_at = ? WHERE id = ?")
      .bind(patch.nama.trim(), sekarang(), id).run();
  }
  if (patch.status_toko !== undefined) {
    if (!STATUS_VALID.includes(patch.status_toko)) return gagal(400, "Status toko tak dikenal.");
    await db.prepare("UPDATE seller_presets SET status_toko = ?, status_berlaku_sejak = ?, diubah_at = ? WHERE id = ?")
      .bind(patch.status_toko, patch.status_berlaku_sejak ?? null, sekarang(), id).run();
  }
  return { ok: true, id };
}

export async function hapusPreset(db: D1Database, id: number): Promise<Hasil<{ id: number; lunak: boolean }>> {
  const snap = await db.prepare(
    "SELECT COUNT(*) AS n FROM laba_snapshot WHERE preset_id = ?"
  ).bind(id).first<{ n: number }>();
  if ((snap?.n ?? 0) > 0) {
    await db.prepare("UPDATE seller_presets SET dihapus_at = ?, diubah_at = ? WHERE id = ?")
      .bind(sekarang(), sekarang(), id).run();
    return { ok: true, id, lunak: true };
  }
  await db.prepare("DELETE FROM seller_presets WHERE id = ?").bind(id).run();
  return { ok: true, id, lunak: false };
}

// --- Aturan (A2) ---

const JENIS_FEE = ["admin", "komisi", "program", "proses", "layanan", "pajak_pph", "pajak_ppn", "voucher", "iklan", "ongkir", "lain"];

export type AturanBaru = {
  jenis: string; kode_program?: string | null; kategori?: string; status_toko?: string | null;
  ukuran?: string | null; basis: string; unit?: string; nilai: number; plafon?: number | null;
  plafon_per_qty?: number | null; priority?: number; valid_from: string; valid_to?: string | null;
  syarat_json?: string | null; sumber?: string | null; verifikasi?: string; catatan?: string | null;
};

export function validasiAturan(a: AturanBaru): string | null {
  if (!JENIS_FEE.includes(a.jenis)) return `Jenis tak dikenal (${JENIS_FEE.join("/")}).`;
  if (typeof a.nilai !== "number" || !Number.isFinite(a.nilai) || a.nilai < 0) return "Nilai harus angka ≥ 0.";
  if (a.basis !== "persen" && a.basis !== "flat") return "Basis harus persen/flat.";
  if (a.basis === "persen" && a.nilai > 100) return "Persen maksimal 100.";
  if (a.unit !== undefined && a.unit !== "per_baris" && a.unit !== "per_order") return "Unit harus per_baris/per_order.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.valid_from)) return "valid_from harus YYYY-MM-DD.";
  if (a.valid_to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.valid_to)) return "valid_to harus YYYY-MM-DD.";
    if (a.valid_to < a.valid_from) return "valid_to ≥ valid_from.";
  }
  if (a.verifikasi !== undefined && !VERIFIKASI_VALID.includes(a.verifikasi)) {
    return `Verifikasi tak dikenal (${VERIFIKASI_VALID.join("/")}).`;
  }
  if (a.syarat_json) {
    try {
      const o = JSON.parse(a.syarat_json) as unknown;
      if (!o || typeof o !== "object" || Array.isArray(o)) return "syarat_json harus objek JSON.";
    } catch {
      return "syarat_json bukan JSON valid.";
    }
  }
  return null;
}

export async function tambahAturan(
  db: D1Database, presetId: number, a: AturanBaru
): Promise<Hasil<{ id: number }>> {
  const err = validasiAturan(a);
  if (err) return gagal(400, err);
  const ins = await db.prepare(
    "INSERT INTO fee_rules (preset_id, jenis, kode_program, kategori, status_toko, ukuran, basis, unit, nilai, " +
    "plafon, plafon_per_qty, priority, valid_from, valid_to, syarat_json, sumber, verifikasi, catatan) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    presetId, a.jenis, a.kode_program ?? null, a.kategori ?? "*", a.status_toko ?? null,
    a.ukuran ?? null, a.basis, a.unit ?? "per_baris", a.nilai, a.plafon ?? null,
    a.plafon_per_qty ?? null, a.priority ?? 0, a.valid_from, a.valid_to ?? null,
    a.syarat_json ?? null, a.sumber ?? null, a.verifikasi ?? "belum", a.catatan ?? null
  ).run();
  return { ok: true, id: Number(ins.meta.last_row_id) };
}

export async function ubahAturan(
  db: D1Database, presetId: number, id: number, a: Partial<AturanBaru> & { aktif?: number }
): Promise<Hasil<{ id: number }>> {
  const asal = await db.prepare(
    "SELECT id FROM fee_rules WHERE id = ? AND preset_id = ?"
  ).bind(id, presetId).first<{ id: number }>();
  if (!asal) return gagal(404, "Aturan tidak ditemukan.");
  const kolom: string[] = [];
  const vals: unknown[] = [];
  const boleh: (keyof typeof a)[] = ["jenis", "kode_program", "kategori", "status_toko", "ukuran", "basis",
    "unit", "nilai", "plafon", "plafon_per_qty", "priority", "valid_from", "valid_to",
    "syarat_json", "sumber", "verifikasi", "catatan", "aktif"];
  for (const k of boleh) {
    if (a[k] !== undefined) { kolom.push(`${k} = ?`); vals.push(a[k]); }
  }
  if (kolom.length === 0) return gagal(400, "Tak ada field diubah.");
  // Validasi ringan nilai bila diubah.
  if (a.nilai !== undefined && (typeof a.nilai !== "number" || a.nilai < 0)) return gagal(400, "Nilai harus angka ≥ 0.");
  if (a.basis === "persen" || (a as { nilai?: number }).nilai !== undefined) {
    const cek = await db.prepare("SELECT basis, nilai FROM fee_rules WHERE id = ?").bind(id)
      .first<{ basis: string; nilai: number }>();
    const basis = a.basis ?? cek?.basis;
    const nilai = (a as { nilai?: number }).nilai ?? cek?.nilai ?? 0;
    if (basis === "persen" && nilai > 100) return gagal(400, "Persen maksimal 100.");
  }
  vals.push(id);
  await db.prepare(`UPDATE fee_rules SET ${kolom.join(", ")} WHERE id = ?`).bind(...vals).run();
  return { ok: true, id };
}

export async function hapusAturan(
  db: D1Database, presetId: number, id: number
): Promise<Hasil<{ id: number; lunak: boolean }>> {
  const snap = await db.prepare(
    "SELECT COUNT(*) AS n FROM laba_snapshot WHERE preset_id = ?"
  ).bind(presetId).first<{ n: number }>();
  if ((snap?.n ?? 0) > 0) {
    await db.prepare("UPDATE fee_rules SET aktif = 0 WHERE id = ? AND preset_id = ?").bind(id, presetId).run();
    return { ok: true, id, lunak: true };
  }
  await db.prepare("DELETE FROM fee_rules WHERE id = ? AND preset_id = ?").bind(id, presetId).run();
  return { ok: true, id, lunak: false };
}

/** Reset ke seed: ganti aturan bersumber seed: dengan data seed baru. */
export async function resetSeed(
  db: D1Database, presetId: number, seedRules: AturanBaru[]
): Promise<Hasil<{ diubah: number }>> {
  const hapus = await db.prepare(
    "DELETE FROM fee_rules WHERE preset_id = ? AND sumber LIKE 'seed:%'"
  ).bind(presetId).run();
  void hapus;
  let n = 0;
  for (const r of seedRules) {
    const h = await tambahAturan(db, presetId, r);
    if (h.ok) n++;
  }
  return { ok: true, diubah: n };
}

// --- Program toggle (A-R1) ---

export async function listProgram(db: D1Database, presetId: number) {
  const { results } = await db.prepare(
    "SELECT k.kode_program, k.nama, COALESCE(p.aktif, 0) AS aktif, p.aktif_sejak, p.aktif_sampai " +
    "FROM program_katalog k LEFT JOIN preset_program p ON p.kode_program = k.kode_program AND p.preset_id = ? " +
    "ORDER BY k.kode_program"
  ).bind(presetId).all<{
    kode_program: string; nama: string; aktif: number; aktif_sejak: string | null; aktif_sampai: string | null;
  }>();
  return results;
}

export async function setProgram(
  db: D1Database, presetId: number, kode: string, aktif: boolean,
  sejak: string | null, sampai: string | null
): Promise<Hasil<{ kode: string }>> {
  const ada = await db.prepare("SELECT kode_program FROM program_katalog WHERE kode_program = ?")
    .bind(kode).first<{ kode_program: string }>();
  if (!ada) return gagal(404, "Program tidak dikenal.");
  await db.prepare(
    "INSERT INTO preset_program (preset_id, kode_program, aktif, aktif_sejak, aktif_sampai) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(preset_id, kode_program) DO UPDATE SET aktif = excluded.aktif, aktif_sejak = excluded.aktif_sejak, aktif_sampai = excluded.aktif_sampai"
  ).bind(presetId, kode, aktif ? 1 : 0, sejak, sampai).run();
  return { ok: true, kode };
}
