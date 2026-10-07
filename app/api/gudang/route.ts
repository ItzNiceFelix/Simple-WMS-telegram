// app/api/gudang/route.ts — POST master gudang (Fase 1: D1 cutover). Owner only.
// aksi: tambah | edit | nonaktif | aktifkan
import { getDb } from "@/lib/d1/db";
import { aktifkanGudang, editGudang, nonaktifGudang, tambahGudang } from "@/lib/d1/gudang";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_owner) return json({ ok: false, error: "Hanya owner." }, 403);

  const body = await bacaBody(request);
  const aksi = body.aksi;
  const db = getDb();

  if (aksi === "tambah") {
    const nama = typeof body.nama === "string" ? body.nama : "";
    if (!nama.trim() || nama.trim().length > 60) return json({ ok: false, error: "Nama gudang 1–60 karakter." }, 400);
    const hasil = await tambahGudang(db, nama, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, gudang: { gudang_id: hasil.gudang.id, nama: hasil.gudang.nama, aktif: true, urutan: hasil.gudang.urutan } });
  }
  const gudangId = typeof body.gudang_id === "string" ? body.gudang_id.trim() : "";
  if (!gudangId) return json({ ok: false, error: "ID gudang wajib diisi." }, 400);
  if (aksi === "edit") {
    const nama = typeof body.nama === "string" ? body.nama : "";
    if (!nama.trim() || nama.trim().length > 60) return json({ ok: false, error: "Nama gudang 1–60 karakter." }, 400);
    const hasil = await editGudang(db, gudangId, nama, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, gudang: { gudang_id: hasil.gudang.id, nama: hasil.gudang.nama } });
  }
  if (aksi === "nonaktif") {
    const hasil = await nonaktifGudang(db, gudangId, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, gudang: { gudang_id: hasil.gudang.id }, peringatan_referensi: hasil.peringatan_referensi });
  }
  if (aksi === "aktifkan") {
    const hasil = await aktifkanGudang(db, gudangId, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, gudang: { gudang_id: hasil.gudang.id } });
  }
  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
