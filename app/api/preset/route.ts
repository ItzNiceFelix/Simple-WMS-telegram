// app/api/preset/route.ts — Kelola preset toko (A1). Tulis owner, baca admin.
import { getDb } from "@/lib/d1/db";
import {
  duplikatPreset, hapusPreset, listPreset, tambahPreset, ubahPreset,
} from "@/lib/d1/preset";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const presets = await listPreset(getDb());
  return json({ ok: true, presets });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah preset." }, 403);
  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const db = getDb();

  if (aksi === "tambah") {
    const hasil = await tambahPreset(db, teks(body.nama), teks(body.status_toko) || "non_star");
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id });
  }
  if (aksi === "duplikat") {
    if (typeof body.id !== "number") return json({ ok: false, error: "id wajib angka." }, 400);
    const hasil = await duplikatPreset(db, body.id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id });
  }
  if (aksi === "ubah-nama") {
    if (typeof body.id !== "number") return json({ ok: false, error: "id wajib angka." }, 400);
    const hasil = await ubahPreset(db, body.id, { nama: teks(body.nama) });
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id });
  }
  if (aksi === "ubah-status") {
    if (typeof body.id !== "number") return json({ ok: false, error: "id wajib angka." }, 400);
    const sejak = body.status_berlaku_sejak === null ? null : teks(body.status_berlaku_sejak) || null;
    if (sejak && !/^\d{4}-\d{2}-\d{2}$/.test(sejak)) {
      return json({ ok: false, error: "status_berlaku_sejak harus YYYY-MM-DD." }, 400);
    }
    const hasil = await ubahPreset(db, body.id, { status_toko: teks(body.status_toko), status_berlaku_sejak: sejak });
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id });
  }
  if (aksi === "hapus") {
    if (typeof body.id !== "number") return json({ ok: false, error: "id wajib angka." }, 400);
    const hasil = await hapusPreset(db, body.id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, id: hasil.id, lunak: hasil.lunak });
  }
  return json({ ok: false, error: "Aksi tidak dikenal (tambah/duplikat/ubah-nama/ubah-status/hapus)." }, 400);
}
