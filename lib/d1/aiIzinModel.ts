// lib/d1/aiIzinModel.ts — Daftar izin model AI PER ROLE dan PER TUJUAN (migrasi 0035).
//
// Kebijakan (dari pemilik produk, mengikat):
//   - `owner` melihat & memakai SEMUA model. Selamanya. Tidak butuh konfigurasi.
//   - Role lain HANYA melihat & memakai model yang diizinkan owner UNTUK ROLE ITU.
//   - Ini BLOKIR KERAS, bukan default-yang-bisa-naik. Tidak ada alur persetujuan.
//
// FAIL CLOSED — ini keputusan yang paling penting di berkas ini:
//   Tabel kosong atau kueri gagal berarti non-owner TIDAK mendapat model apa pun.
//   Arah default ini disengaja. Fitur ini ada untuk MENAHAN biaya, jadi lupa
//   mengonfigurasi harus berujung "tidak bisa dipakai" — kegagalan yang terlihat user
//   dan bisa dilaporkan — bukan "semua model terbuka", yang berarti tagihan tak
//   terduga tanpa ada yang tahu sumbernya.
//
// KENAPA cek izin ada di SINI, bukan di route:
//   Semua jalur AI (panggilTeks/panggilTeksStream/panggilGambar, plus bot Telegram)
//   bermuara ke pemilihan kandidat model. Menaruh satu fungsi izin di titik itu
//   membuat setiap entrypoint baru otomatis ikut terjaga, bukan bergantung pada
//   ingatan penulis route untuk memanggil pemeriksa izin.
import { sekarang } from "./hasil";

/** Tujuan AI yang bisa diizinkan. Disamakan dengan `ai_model.jenis` supaya bisa di-join. */
export const JENIS_IZIN = ["teks", "vision", "gambar"] as const;
export type JenisIzin = (typeof JENIS_IZIN)[number];

/** Role yang bisa dibatasi. `owner` SENGAJA tidak ada di daftar: ia tak pernah dibatasi. */
export const ROLE_DIBATASI = ["high_admin", "admin", "designer", "guest"] as const;
export type RoleDibatasi = (typeof ROLE_DIBATASI)[number];

export type IzinModel = {
  id: number;
  role: string;
  provider: string;
  model_id: string;
  jenis: string;
  allowed: number;
  at: number;
  oleh: string | null;
};

const KOLOM = "id, role, provider, model_id, jenis, allowed, at, oleh";

function sahRole(v: unknown): v is RoleDibatasi {
  return typeof v === "string" && (ROLE_DIBATASI as readonly string[]).includes(v);
}

function sahJenis(v: unknown): v is JenisIzin {
  return typeof v === "string" && (JENIS_IZIN as readonly string[]).includes(v);
}

/**
 * Semua model yang boleh dipakai satu role untuk satu jenis, sebagai himpunan
 * `provider\u0000model_id` supaya pemeriksaan per kandidat cukup O(1).
 *
 * Dipakai di jalur panas (penyusunan kandidat): satu kueri untuk seluruh role+jenis,
 * bukan satu kueri per model.
 *
 * `owner` mengembalikan `null` — artinya "tanpa batas", BUKAN "himpunan kosong".
 * Perbedaan ini penting: himpunan kosong berarti "tidak ada yang boleh" (fail closed
 * untuk non-owner), sedangkan null berarti pemanggil melewati penyaringan sepenuhnya.
 */
export async function himpunanIzin(
  db: D1Database,
  role: string,
  jenis: JenisIzin
): Promise<Set<string> | null> {
  if (role === "owner") return null;
  try {
    const { results } = await db
      .prepare("SELECT provider, model_id FROM ai_model_izin WHERE role = ? AND jenis = ? AND allowed = 1")
      .bind(role, jenis)
      .all<{ provider: string; model_id: string }>();
    return new Set((results ?? []).map((r) => kunciIzin(r.provider, r.model_id)));
  } catch {
    // Fail closed: kueri gagal = tidak ada model yang boleh.
    return new Set<string>();
  }
}

/**
 * Kunci satu izin: `provider\u0000model_id`.
 *
 * Diekspor supaya pemakai yang MENYUSUN kunci (menyaring katalog, memvalidasi pilihan
 * model yang dikirim user) memakai pemisah yang sama persis dengan penyusun himpunan di
 * atas. Dulu literal `\u0000` ditulis ulang di beberapa tempat — satu salah ketik di
 * antaranya membuat penyaringan diam-diam selalu kosong atau selalu lolos.
 * `PEMISAH_MODEL` di lib/d1/aiEditorSetting.ts menunjuk konstanta YANG SAMA ini.
 */
export function kunciIzin(provider: string, modelId: string): string {
  return `${provider}\u0000${modelId}`;
}

/** Seluruh baris izin, untuk editor owner. Urut role lalu jenis supaya stabil di UI. */
export async function daftarIzin(db: D1Database): Promise<IzinModel[]> {
  const { results } = await db
    .prepare(`SELECT ${KOLOM} FROM ai_model_izin ORDER BY role, jenis, provider, model_id`)
    .all<IzinModel>();
  return results ?? [];
}

/**
 * Pasang/ubah satu izin. Validasi bentuk di sini (bukan di route) supaya jalur tulis
 * lain tidak bisa menyelipkan role `owner` atau jenis asing ke tabel.
 */
export async function simpanIzin(
  db: D1Database,
  data: { role: unknown; provider: unknown; model_id: unknown; jenis: unknown; allowed: unknown },
  oleh: string | null
): Promise<{ ok: true; izin: IzinModel } | { ok: false; error: string }> {
  if (!sahRole(data.role)) return { ok: false, error: `Role harus salah satu dari: ${ROLE_DIBATASI.join(", ")}.` };
  if (!sahJenis(data.jenis)) return { ok: false, error: `Tujuan harus salah satu dari: ${JENIS_IZIN.join(", ")}.` };
  const provider = String(data.provider ?? "").trim().toLowerCase();
  const modelId = String(data.model_id ?? "").trim();
  if (!provider) return { ok: false, error: "Provider wajib diisi." };
  if (!modelId) return { ok: false, error: "Model wajib diisi." };
  const allowed = data.allowed === false || data.allowed === 0 || data.allowed === "0" ? 0 : 1;

  await db
    .prepare(
      "INSERT INTO ai_model_izin (role, provider, model_id, jenis, allowed, at, oleh) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(role, provider, model_id, jenis) DO UPDATE SET allowed = excluded.allowed, at = excluded.at, oleh = excluded.oleh"
    )
    .bind(data.role, provider, modelId, data.jenis, allowed, sekarang(), oleh)
    .run();
  const baris = await db
    .prepare(`SELECT ${KOLOM} FROM ai_model_izin WHERE role = ? AND jenis = ? AND provider = ? AND model_id = ?`)
    .bind(data.role, data.jenis, provider, modelId)
    .first<IzinModel>();
  if (!baris) return { ok: false, error: "Gagal menyimpan izin." };
  return { ok: true, izin: baris };
}

/**
 * Hapus satu izin (role kembali tidak punya akses ke model itu).
 * Menghapus baris dan menyetel allowed=0 punya arti yang sama bagi penegakan; hapus
 * dipakai UI saat owner mencabut centang supaya tabel tidak menumpuk baris mati.
 */
export async function hapusIzin(
  db: D1Database,
  data: { role: unknown; provider: unknown; model_id: unknown; jenis: unknown }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sahRole(data.role)) return { ok: false, error: "Role tidak sah." };
  if (!sahJenis(data.jenis)) return { ok: false, error: "Tujuan tidak sah." };
  const provider = String(data.provider ?? "").trim().toLowerCase();
  const modelId = String(data.model_id ?? "").trim();
  if (!provider || !modelId) return { ok: false, error: "Provider dan model wajib diisi." };
  await db
    .prepare("DELETE FROM ai_model_izin WHERE role = ? AND jenis = ? AND provider = ? AND model_id = ?")
    .bind(data.role, data.jenis, provider, modelId)
    .run();
  return { ok: true };
}

/**
 * Jumlah model aktif di katalog per (jenis) yang BELUM punya izin untuk role mana pun.
 * Dipakai editor supaya owner melihat akibat dari tabel kosong tanpa harus mencoba
 * memakai role itu sendiri.
 */
export async function ringkasIzin(db: D1Database): Promise<{ total: number; perRole: Record<string, number> }> {
  const { results } = await db
    .prepare("SELECT role, COUNT(*) AS n FROM ai_model_izin WHERE allowed = 1 GROUP BY role")
    .all<{ role: string; n: number }>();
  const perRole: Record<string, number> = {};
  let total = 0;
  for (const r of results ?? []) {
    perRole[r.role] = r.n;
    total += r.n;
  }
  return { total, perRole };
}
