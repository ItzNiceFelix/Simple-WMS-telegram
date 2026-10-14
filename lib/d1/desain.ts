// lib/d1/desain.ts — Lapisan data Studio Gambar mode Editor (migrasi 0028).
//
// Dipisah dari rute API supaya aturan server (batas ukuran, preset ukuran, kepemilikan
// preset) diuji/dibaca di satu tempat, bukan tersebar di handler.
//
// DUA ATURAN YANG MENGIKAT:
//   1. Fungsi daftar (`daftarDesain`, `daftarLatar`) TIDAK BOLEH menyentuh kolom berat
//      (`dokumen_json`, `base64`). Daftar dibuka jauh lebih sering daripada satu dokumen
//      dibuka; menarik megabita di setiap daftar membakar kuota baca D1 dan memperlambat
//      halaman. Metadata + panjang/byte sudah cukup untuk tampilan daftar.
//   2. Setiap fungsi yang menyentuh SATU baris WAJIB memfilter `preset_id`. Tanpa itu id
//      dari toko lain bisa terbaca/tertimpa hanya karena id-nya kebetulan cocok.
import { gagal, sekarang, type Hasil } from "./hasil";

/** Preset ukuran yang sah. Sumber kebenaran tunggal — klien TIDAK dipercaya soal ini. */
export const UKURAN_SAH = ["1080x1080", "1080x1350", "1200x628"] as const;
export type UkuranDesain = (typeof UKURAN_SAH)[number];

/** Batas dokumen elemen. Normalnya 2–20 KB; 256 KB adalah jaring pengaman. */
const MAKS_DOKUMEN = 256 * 1024;
/** Batas satu latar base64. Di atas ini gambar sebaiknya tidak dipakai sebagai latar. */
const MAKS_LATAR = 4 * 1024 * 1024;
/** Batas nama (folder/latar/desain) — melindungi UI dari nama sepanjang novel. */
const MAKS_NAMA = 120;
/** Batas halaman daftar supaya satu permintaan tidak pernah menarik seluruh tabel. */
const MAKS_LIMIT = 500;
/** Batas parameter query D1 (100) — menyisakan ruang untuk klausa lain. */
const POTONG = 50;

export type FolderDesain = {
  id: number;
  nama: string;
  parent_id: number | null;
  at: number;
  oleh: string | null;
};

/** Metadata desain; `panjang_dokumen` MENGGANTIKAN dokumen penuh di daftar. */
export type DesainRingkas = {
  id: number;
  nama: string;
  ukuran: string;
  folder_id: number | null;
  latar_id: number | null;
  panjang_dokumen: number;
  at: number;
  updated_at: number;
  oleh: string | null;
};

export type DesainPenuh = DesainRingkas & { dokumen_json: string };

/** Metadata latar; `base64` sengaja TIDAK ada di sini. */
export type LatarRingkas = {
  id: number;
  nama: string;
  mime: string;
  byte: number;
  folder_id: number | null;
  folder_manual: number;
  at: number;
  oleh: string | null;
};

export type LatarPenuh = LatarRingkas & { base64: string };

function batasi(v: number | undefined, min: number, maks: number, bawaan: number): number {
  if (v === undefined || !Number.isFinite(v)) return bawaan;
  return Math.min(Math.max(Math.trunc(v), min), maks);
}

/** Nama bersih: dipangkas, dipotong 120. Kosong → null supaya pemanggil memakai default DB. */
function namaBersih(nama: string | null | undefined): string | null {
  const bersih = String(nama ?? "").trim().slice(0, MAKS_NAMA);
  return bersih === "" ? null : bersih;
}

// ── Folder ────────────────────────────────────────────────────────────────

/** Daftar folder DATAR untuk satu preset; klien yang menyusun pohon dari `parent_id`. */
export async function daftarFolder(db: D1Database, presetId: number): Promise<FolderDesain[]> {
  const { results } = await db
    .prepare("SELECT id, nama, parent_id, at, oleh FROM desain_folder WHERE preset_id = ? ORDER BY nama ASC")
    .bind(presetId)
    .all<FolderDesain>();
  return results ?? [];
}

/**
 * Buat folder. `parentId` null = folder akar.
 * Folder induk diverifikasi satu preset — kalau tidak, folder toko lain bisa jadi induk
 * dan menghapus toko lain ikut membuang folder kita.
 */
export async function simpanFolder(
  db: D1Database,
  presetId: number,
  nama: string,
  parentId: number | null,
  oleh: string | null,
): Promise<Hasil<{ id: number }>> {
  const bersih = namaBersih(nama);
  if (!bersih) return gagal(400, "Nama folder wajib diisi");
  if (parentId !== null && parentId !== undefined) {
    const induk = await db
      .prepare("SELECT id FROM desain_folder WHERE id = ? AND preset_id = ?")
      .bind(parentId, presetId)
      .first<{ id: number }>();
    if (!induk) return gagal(404, "Folder induk tidak ditemukan");
  }
  const r = await db
    .prepare("INSERT INTO desain_folder (preset_id, nama, parent_id, at, oleh) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(presetId, bersih, parentId ?? null, sekarang(), oleh)
    .first<{ id: number }>();
  if (!r) return gagal(500, "Gagal menyimpan folder");
  return { ok: true, id: r.id };
}

/** Ganti nama folder. Hanya folder milik preset ini yang boleh tersentuh. */
export async function ubahNamaFolder(
  db: D1Database,
  presetId: number,
  id: number,
  nama: string,
): Promise<Hasil<Record<string, never>>> {
  const bersih = namaBersih(nama);
  if (!bersih) return gagal(400, "Nama folder wajib diisi");
  const r = await db
    .prepare("UPDATE desain_folder SET nama = ? WHERE id = ? AND preset_id = ?")
    .bind(bersih, id, presetId)
    .run();
  if (!r.meta.changes) return gagal(404, "Folder tidak ditemukan");
  return { ok: true };
}

/**
 * Hapus folder. Anak folder ikut terhapus (CASCADE); desain/latar di dalamnya TIDAK
 * terhapus, hanya kehilangan folder (SET NULL) — menghapus folder tidak boleh membuang
 * pekerjaan yang tidak diminta dihapus.
 */
export async function hapusFolder(
  db: D1Database,
  presetId: number,
  id: number,
): Promise<Hasil<Record<string, never>>> {
  const r = await db.prepare("DELETE FROM desain_folder WHERE id = ? AND preset_id = ?").bind(id, presetId).run();
  if (!r.meta.changes) return gagal(404, "Folder tidak ditemukan");
  return { ok: true };
}

// ── Desain ────────────────────────────────────────────────────────────────

export type FilterDesain = { folderId?: number | null; q?: string; limit?: number; offset?: number };

/**
 * Daftar desain RINGAN (tanpa `dokumen_json`).
 * `folderId` = -1 sengaja dipakai untuk "tanpa folder" (folder_id IS NULL), karena
 * null di sini berarti "semua folder" — UI butuh keduanya.
 */
export async function daftarDesain(
  db: D1Database,
  presetId: number,
  filter: FilterDesain = {},
): Promise<DesainRingkas[]> {
  const where = ["preset_id = ?"];
  const bind: (number | string)[] = [presetId];
  if (filter.folderId === null) where.push("folder_id IS NULL");
  else if (filter.folderId !== undefined) {
    where.push("folder_id = ?");
    bind.push(filter.folderId);
  }
  const q = String(filter.q ?? "").trim();
  if (q) {
    where.push("nama LIKE ?");
    bind.push(`%${q}%`);
  }
  bind.push(batasi(filter.limit, 1, MAKS_LIMIT, 100), batasi(filter.offset, 0, Number.MAX_SAFE_INTEGER, 0));
  const { results } = await db
    .prepare(
      "SELECT id, nama, ukuran, folder_id, latar_id, length(dokumen_json) AS panjang_dokumen, at, updated_at, oleh " +
        `FROM ai_desain WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...bind)
    .all<DesainRingkas>();
  return results ?? [];
}

/** Dokumen penuh satu desain (termasuk `dokumen_json`). null bila tidak ada / preset lain. */
export async function ambilDesain(db: D1Database, presetId: number, id: number): Promise<DesainPenuh | null> {
  const r = await db
    .prepare(
      "SELECT id, nama, ukuran, folder_id, latar_id, dokumen_json, length(dokumen_json) AS panjang_dokumen, " +
        "at, updated_at, oleh FROM ai_desain WHERE id = ? AND preset_id = ?",
    )
    .bind(id, presetId)
    .first<DesainPenuh>();
  return r ?? null;
}

export type InputDesain = {
  id?: number;
  nama?: string;
  ukuran: string;
  dokumen_json?: string;
  folder_id?: number | null;
  latar_id?: number | null;
  oleh?: string | null;
};

/**
 * Simpan desain baru atau perbarui yang lama (`id` ada = update).
 * `ukuran` dan panjang `dokumen_json` diverifikasi DI SINI, bukan di klien.
 */
export async function simpanDesain(
  db: D1Database,
  presetId: number,
  data: InputDesain,
): Promise<Hasil<{ id: number; updated_at: number }>> {
  if (!(UKURAN_SAH as readonly string[]).includes(data.ukuran)) {
    return gagal(400, `Ukuran harus salah satu dari: ${UKURAN_SAH.join(", ")}`);
  }
  const dokumen = data.dokumen_json ?? "{}";
  if (dokumen.length > MAKS_DOKUMEN) return gagal(413, "Dokumen desain terlalu besar (maks 256 KB)");
  const at = sekarang();
  const nama = namaBersih(data.nama) ?? "Tanpa nama";

  if (data.id === undefined) {
    const r = await db
      .prepare(
        "INSERT INTO ai_desain (preset_id, folder_id, nama, ukuran, dokumen_json, latar_id, at, updated_at, oleh) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, updated_at",
      )
      .bind(presetId, data.folder_id ?? null, nama, data.ukuran, dokumen, data.latar_id ?? null, at, at, data.oleh ?? null)
      .first<{ id: number; updated_at: number }>();
    if (!r) return gagal(500, "Gagal menyimpan desain");
    return { ok: true, id: r.id, updated_at: r.updated_at };
  }

  const r = await db
    .prepare(
      "UPDATE ai_desain SET nama = ?, ukuran = ?, dokumen_json = ?, folder_id = ?, latar_id = ?, updated_at = ?, oleh = ? " +
        "WHERE id = ? AND preset_id = ?",
    )
    .bind(nama, data.ukuran, dokumen, data.folder_id ?? null, data.latar_id ?? null, at, data.oleh ?? null, data.id, presetId)
    .run();
  if (!r.meta.changes) return gagal(404, "Desain tidak ditemukan");
  return { ok: true, id: data.id, updated_at: at };
}

/** Hapus desain. Hanya milik preset ini. */
export async function hapusDesain(
  db: D1Database,
  presetId: number,
  id: number,
): Promise<Hasil<Record<string, never>>> {
  const r = await db.prepare("DELETE FROM ai_desain WHERE id = ? AND preset_id = ?").bind(id, presetId).run();
  if (!r.meta.changes) return gagal(404, "Desain tidak ditemukan");
  return { ok: true };
}

/**
 * Pindahkan desain ke folder lain (`folderId` null = tanpa folder).
 * Folder tujuan diverifikasi satu preset supaya desain tidak menempel ke folder toko lain.
 */
export async function pindahDesainFolder(
  db: D1Database,
  presetId: number,
  id: number,
  folderId: number | null,
): Promise<Hasil<Record<string, never>>> {
  if (folderId !== null && folderId !== undefined) {
    const induk = await db
      .prepare("SELECT id FROM desain_folder WHERE id = ? AND preset_id = ?")
      .bind(folderId, presetId)
      .first<{ id: number }>();
    if (!induk) return gagal(404, "Folder tidak ditemukan");
  }
  const r = await db
    .prepare("UPDATE ai_desain SET folder_id = ?, updated_at = ? WHERE id = ? AND preset_id = ?")
    .bind(folderId ?? null, sekarang(), id, presetId)
    .run();
  if (!r.meta.changes) return gagal(404, "Desain tidak ditemukan");
  return { ok: true };
}

// ── Latar ─────────────────────────────────────────────────────────────────

export type FilterLatar = { folderId?: number | null; q?: string; limit?: number; offset?: number };

/** Daftar latar RINGAN (tanpa `base64`); `byte` sudah cukup untuk indikator kuota. */
export async function daftarLatar(
  db: D1Database,
  presetId: number,
  filter: FilterLatar = {},
): Promise<LatarRingkas[]> {
  const where = ["preset_id = ?"];
  const bind: (number | string)[] = [presetId];
  if (filter.folderId === null) where.push("folder_id IS NULL");
  else if (filter.folderId !== undefined) {
    where.push("folder_id = ?");
    bind.push(filter.folderId);
  }
  const q = String(filter.q ?? "").trim();
  if (q) {
    where.push("nama LIKE ?");
    bind.push(`%${q}%`);
  }
  bind.push(batasi(filter.limit, 1, MAKS_LIMIT, 100), batasi(filter.offset, 0, Number.MAX_SAFE_INTEGER, 0));
  const { results } = await db
    .prepare(
      "SELECT id, nama, mime, byte, folder_id, folder_manual, at, oleh FROM ai_latar " +
        `WHERE ${where.join(" AND ")} ORDER BY at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...bind)
    .all<LatarRingkas>();
  return results ?? [];
}

/** Total byte semua latar satu preset — indikator kuota TANPA membaca base64. */
export async function totalByteLatar(db: D1Database, presetId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COALESCE(SUM(byte), 0) AS total FROM ai_latar WHERE preset_id = ?")
    .bind(presetId)
    .first<{ total: number }>();
  return Number(r?.total ?? 0);
}

/** Latar penuh termasuk `base64`. null bila tidak ada / preset lain. */
export async function ambilLatar(db: D1Database, presetId: number, id: number): Promise<LatarPenuh | null> {
  const r = await db
    .prepare(
      "SELECT id, nama, mime, base64, byte, folder_id, folder_manual, at, oleh FROM ai_latar WHERE id = ? AND preset_id = ?",
    )
    .bind(id, presetId)
    .first<LatarPenuh>();
  return r ?? null;
}

export type InputLatar = {
  id?: number;
  nama?: string;
  mime: string;
  base64: string;
  byte?: number;
  folder_id?: number | null;
  folder_manual?: boolean;
  oleh?: string | null;
};

/**
 * Simpan latar baru atau perbarui yang lama.
 * `byte` dihitung dari panjang base64 bila tidak diberikan — kolom itu dipakai indikator
 * kuota, jadi tidak boleh kosong meski pemanggil lupa mengisinya.
 */
export async function simpanLatar(
  db: D1Database,
  presetId: number,
  data: InputLatar,
): Promise<Hasil<{ id: number }>> {
  if (!data.base64) return gagal(400, "Data latar kosong");
  if (data.base64.length > MAKS_LATAR) return gagal(413, "Latar terlalu besar (maks 4 MB)");
  const at = sekarang();
  const nama = namaBersih(data.nama) ?? "Latar";
  const byte = data.byte !== undefined ? Math.trunc(data.byte) : data.base64.length;

  if (data.id === undefined) {
    const r = await db
      .prepare(
        "INSERT INTO ai_latar (preset_id, folder_id, nama, mime, base64, byte, folder_manual, at, oleh) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
      )
      .bind(presetId, data.folder_id ?? null, nama, data.mime, data.base64, byte, data.folder_manual ? 1 : 0, at, data.oleh ?? null)
      .first<{ id: number }>();
    if (!r) return gagal(500, "Gagal menyimpan latar");
    return { ok: true, id: r.id };
  }

  const r = await db
    .prepare(
      "UPDATE ai_latar SET nama = ?, mime = ?, base64 = ?, byte = ?, folder_id = ?, folder_manual = ? " +
        "WHERE id = ? AND preset_id = ?",
    )
    .bind(nama, data.mime, data.base64, byte, data.folder_id ?? null, data.folder_manual ? 1 : 0, data.id, presetId)
    .run();
  if (!r.meta.changes) return gagal(404, "Latar tidak ditemukan");
  return { ok: true, id: data.id };
}

/**
 * Hapus latar. Desain yang memakainya tidak ikut terhapus — `ai_desain.latar_id` menjadi
 * NULL lewat SET NULL; pekerjaan pengguna tidak boleh hilang karena latarnya dibuang.
 */
export async function hapusLatar(
  db: D1Database,
  presetId: number,
  id: number,
): Promise<Hasil<Record<string, never>>> {
  const r = await db.prepare("DELETE FROM ai_latar WHERE id = ? AND preset_id = ?").bind(id, presetId).run();
  if (!r.meta.changes) return gagal(404, "Latar tidak ditemukan");
  return { ok: true };
}

/** Pindahkan latar ke folder lain (`folderId` null = tanpa folder). */
export async function pindahLatarFolder(
  db: D1Database,
  presetId: number,
  id: number,
  folderId: number | null,
): Promise<Hasil<Record<string, never>>> {
  if (folderId !== null && folderId !== undefined) {
    const induk = await db
      .prepare("SELECT id FROM desain_folder WHERE id = ? AND preset_id = ?")
      .bind(folderId, presetId)
      .first<{ id: number }>();
    if (!induk) return gagal(404, "Folder tidak ditemukan");
  }
  const r = await db
    .prepare("UPDATE ai_latar SET folder_id = ? WHERE id = ? AND preset_id = ?")
    .bind(folderId ?? null, id, presetId)
    .run();
  if (!r.meta.changes) return gagal(404, "Latar tidak ditemukan");
  return { ok: true };
}
