// app/api/desain/elemen/route.ts — Pustaka ELEMEN VEKTOR editor (migrasi 0036). Tulis admin.
//
// ATURAN YANG SAMA DENGAN /api/desain/latar: daftar TIDAK PERNAH mengembalikan `svg`
// (puluhan KB × 200 baris). Markup hanya keluar lewat `?id=` untuk satu elemen yang
// benar-benar disisipkan. Yang membedakannya dari latar: di sini kolom beratnya TEKS,
// bukan base64 — jadi tidak ada jalur thumbnail, tapi daftarnya tetap ringan.
//
// Endpoint ini juga yang dilayani ROUTE AI untuk mencari elemen (server-side, satu
// permintaan): AI harus tahu elemen apa yang tersedia sebelum boleh memilih `elemen_id`.
import { getDb } from "@/lib/d1/db";
import { ambilElemen, daftarElemen, hapusElemen, simpanElemen } from "@/lib/d1/elemenDesain";
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
    const elemen = await ambilElemen(db, presetId, angka(idParam));
    if (!elemen) return json({ ok: false, error: "Elemen tidak ditemukan." }, 404);
    return json({ ok: true, elemen });
  }

  const elemen = await daftarElemen(db, presetId, {
    kategori: teks(url.searchParams.get("kategori")),
    q: teks(url.searchParams.get("q")),
    limit: angka(url.searchParams.get("limit"), 200),
  });
  return json({ ok: true, elemen });
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
    const hasil = await simpanElemen(db, presetId, {
      id: body.id === undefined || body.id === null ? undefined : angka(body.id),
      nama: body.nama,
      kategori: body.kategori,
      svg: body.svg,
      elemen: body.elemen,
      folder_id: body.folderId === undefined || body.folderId === null ? null : angka(body.folderId),
      oleh: sesi.user.tg_id,
    });
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id });
  }
  if (aksi === "hapus") {
    const hasil = await hapusElemen(db, presetId, angka(body.id));
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true });
  }
  return json({ ok: false, error: "Aksi tidak dikenal (simpan/hapus)." }, 400);
}
