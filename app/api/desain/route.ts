// app/api/desain/route.ts — CRUD desain editor (Fase 4). Tulis admin, baca admin.
//
// Semua aturan berat (ukuran preset, batas dokumen, kepemilikan preset) hidup di
// lib/d1/desain.ts; rute ini hanya menerjemahkan HTTP → fungsi lapisan data.
import { getDb } from "@/lib/d1/db";
import {
  ambilDesain, daftarDesain, hapusDesain, pindahDesainFolder, simpanDesain,
} from "@/lib/d1/desain";
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

/** `presetId` wajib angka > 0 di setiap operasi; 0/NaN berarti klien tidak tahu preset mana. */
function presetIdDari(v: unknown): number | null {
  const n = angka(v);
  return n > 0 ? n : null;
}

/**
 * Terjemahkan parameter folderId dari query/body.
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
    const desain = await ambilDesain(db, presetId, angka(idParam));
    if (!desain) return json({ ok: false, error: "Desain tidak ditemukan." }, 404);
    return json({ ok: true, desain });
  }

  const desain = await daftarDesain(db, presetId, {
    folderId: folderDari(url.searchParams.get("folderId") ?? undefined),
    q: teks(url.searchParams.get("q")),
    limit: angka(url.searchParams.get("limit"), 100),
    offset: angka(url.searchParams.get("offset"), 0),
  });
  return json({ ok: true, desain });
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
  const oleh = sesi.user.tg_id;

  if (aksi === "simpan") {
    const hasil = await simpanDesain(db, presetId, {
      id: body.id === undefined || body.id === null ? undefined : angka(body.id),
      nama: teks(body.nama),
      ukuran: teks(body.ukuran),
      dokumen_json: teks(body.dokumen_json),
      folder_id: body.folderId === null ? null : folderDari(body.folderId) ?? null,
      latar_id: body.latar_id === undefined || body.latar_id === null ? null : angka(body.latar_id),
      oleh,
    });
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id, updated_at: hasil.updated_at });
  }
  if (aksi === "hapus") {
    const hasil = await hapusDesain(db, presetId, angka(body.id));
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true });
  }
  if (aksi === "pindah") {
    const hasil = await pindahDesainFolder(db, presetId, angka(body.id), folderDari(body.folderId) ?? null);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true });
  }
  return json({ ok: false, error: "Aksi tidak dikenal (simpan/hapus/pindah)." }, 400);
}
