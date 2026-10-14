// app/api/desain/latar/route.ts — CRUD latar Studio Gambar (Fase 4). Tulis admin.
//
// ATURAN KUOTA: daftar latar TIDAK PERNAH mengembalikan base64 (bisa megabita × ratusan
// baris). `total_byte` dari SUM(byte) memberi indikator kuota tanpa menyentuh gambar.
// Base64 hanya keluar lewat `?id=` untuk satu latar yang benar-benar dipakai.
import { getDb } from "@/lib/d1/db";
import { ambilLatar, daftarLatar, hapusLatar, pindahLatarFolder, simpanLatar, totalByteLatar } from "@/lib/d1/desain";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function angka(v: unknown, bawaan = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : bawaan;
}

/** `presetId` wajib angka > 0 di setiap operasi. */
function presetIdDari(v: unknown): number | null {
  const n = angka(v);
  return n > 0 ? n : null;
}

/**
 * absen → undefined ("semua folder"), "root"/null → null ("tanpa folder"), angka → id.
 * Beda absen vs null inilah yang dijaga lapisan data; jangan disatukan.
 */
function folderDari(v: unknown): number | null | undefined {
  if (v === undefined || v === "") return undefined;
  if (v === null || v === "root") return null;
  const n = angka(v, NaN);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  const presetId = presetIdDari(url.searchParams.get("presetId"));
  if (presetId === null) return json({ ok: false, error: "presetId wajib angka > 0." }, 400);
  const db = getDb();

  const idParam = url.searchParams.get("id");
  if (idParam) {
    const latar = await ambilLatar(db, presetId, angka(idParam));
    if (!latar) return json({ ok: false, error: "Latar tidak ditemukan." }, 404);
    return json({ ok: true, latar });
  }

  const [latar, total_byte] = await Promise.all([
    daftarLatar(db, presetId, {
      folderId: folderDari(url.searchParams.get("folderId") ?? undefined),
      q: teks(url.searchParams.get("q")),
      limit: angka(url.searchParams.get("limit"), 100),
      offset: angka(url.searchParams.get("offset"), 0),
    }),
    totalByteLatar(db, presetId),
  ]);
  return json({ ok: true, latar, total_byte });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 10);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const presetId = presetIdDari(body.presetId);
  if (presetId === null) return json({ ok: false, error: "presetId wajib angka > 0." }, 400);
  const aksi = teks(body.aksi);
  const db = getDb();

  if (aksi === "simpan") {
    const hasil = await simpanLatar(db, presetId, {
      id: body.id === undefined || body.id === null ? undefined : angka(body.id),
      nama: teks(body.nama),
      mime: teks(body.mime),
      base64: typeof body.base64 === "string" ? body.base64 : "",
      folder_id: body.folderId === null ? null : folderDari(body.folderId) ?? null,
      folder_manual: body.folder_manual === true,
      oleh: sesi.user.tg_id,
    });
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id });
  }
  if (aksi === "hapus") {
    const hasil = await hapusLatar(db, presetId, angka(body.id));
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true });
  }
  if (aksi === "pindah") {
    const hasil = await pindahLatarFolder(db, presetId, angka(body.id), folderDari(body.folderId) ?? null);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true });
  }
  return json({ ok: false, error: "Aksi tidak dikenal (simpan/hapus/pindah)." }, 400);
}
