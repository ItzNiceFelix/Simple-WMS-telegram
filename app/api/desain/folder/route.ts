// app/api/desain/folder/route.ts — CRUD folder Studio Gambar (Fase 4). Tulis admin.
// Folder disimpan DATAR; klien menyusun pohon dari `parent_id`.
// Aturan preset + verifikasi folder induk ada di lib/d1/desain.ts; rute ini hanya meneruskan.
import { getDb } from "@/lib/d1/db";
import { daftarFolder, hapusFolder, simpanFolder, ubahNamaFolder } from "@/lib/d1/desain";
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

/** `parentId` absen/null = folder akar; angka > 0 = induk. */
function parentDari(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = angka(v, NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const presetId = presetIdDari(new URL(request.url).searchParams.get("presetId"));
  if (presetId === null) return json({ ok: false, error: "presetId wajib angka > 0." }, 400);
  const folder = await daftarFolder(getDb(), presetId);
  return json({ ok: true, folder });
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
    const hasil = await simpanFolder(db, presetId, teks(body.nama), parentDari(body.parentId), sesi.user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id });
  }
  if (aksi === "ubah-nama") {
    const hasil = await ubahNamaFolder(db, presetId, angka(body.id), teks(body.nama));
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true });
  }
  if (aksi === "hapus") {
    const hasil = await hapusFolder(db, presetId, angka(body.id));
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true });
  }
  return json({ ok: false, error: "Aksi tidak dikenal (simpan/ubah-nama/hapus)." }, 400);
}
