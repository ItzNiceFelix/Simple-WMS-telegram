// app/api/permintaan-gudang/route.ts — POST transfer antar-gudang (Fase 1: D1 cutover).
// aksi: buat | ubah-item | setujui-tujuan | tolak-tujuan | tolak | batal |
//       kirim | terima | tidak-terima | tutup-tujuan | selesai
import { getDb } from "@/lib/d1/db";
import {
  ambilTransfer, batalTransfer, buatTransfer, kirimTujuan, selesaiTransfer,
  terimaTujuan, tidakTerimaTujuan, setujuiTujuan, tolakDokumen, tolakTujuan, tutupTujuan,
  ubahItemTransfer,
} from "@/lib/d1/transfer";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);

  const body = await bacaBody(request);
  const aksi = body.aksi as string;
  const db = getDb();
  const uid = user.tg_id;

  if (aksi === "buat") {
    const dariId = typeof body.dari_gudang_id === "string" ? body.dari_gudang_id.trim() : "";
    if (!user.is_owner && !user.scope_gudang.includes(dariId)) {
      return json({ ok: false, error: "Anda hanya dapat meminta dari gudang Anda." }, 403);
    }
    const tujuan = Array.isArray(body.tujuan) ? body.tujuan : [];
    const items = Array.isArray(body.items) ? body.items : [];
    const hasil = await buatTransfer(db, dariId, tujuan as never, items as never, uid);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, permintaan: hasil.transfer });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const tujuanIndex = typeof body.tujuan_index === "number" ? body.tujuan_index : -1;
  if (!id) return json({ ok: false, error: "ID permintaan wajib diisi." }, 400);
  if (aksi === "ubah-item") {
    const items = Array.isArray(body.items) ? body.items : [];
    const h = await ubahItemTransfer(db, id, items as never, uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, permintaan: h.transfer });
  }
  if (aksi === "tolak") {
    const h = await tolakDokumen(db, id, uid);
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return json({ ok: true, permintaan: h.transfer });
  }
  const perluIndeks = ["setujui-tujuan", "tolak-tujuan", "kirim", "terima", "tidak-terima", "tutup-tujuan"].includes(aksi);
  if (perluIndeks && (!Number.isInteger(tujuanIndex) || tujuanIndex < 0)) {
    return json({ ok: false, error: "Indeks tujuan tidak valid." }, 400);
  }
  const t = await ambilTransfer(db, id);
  if (!t) return json({ ok: false, error: "Permintaan tidak ditemukan." }, 404);
  const isPembuat = t.created_by === uid;

  switch (aksi) {
    case "setujui-tujuan": {
      const h = await setujuiTujuan(db, id, tujuanIndex, uid, user.is_owner);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      return json({ ok: true, permintaan: h.transfer });
    }
    case "tolak-tujuan": {
      const h = await tolakTujuan(db, id, tujuanIndex, uid, user.is_owner);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      return json({ ok: true, permintaan: h.transfer });
    }
    case "kirim": {
      const h = await kirimTujuan(db, id, tujuanIndex, uid, user.is_owner);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      return json({ ok: true, permintaan: h.transfer, ...(h.peringatan_audit ? { peringatan_audit: true } : {}) });
    }
    case "terima": {
      const h = await terimaTujuan(db, id, tujuanIndex, uid, isPembuat || user.is_owner);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      return json({ ok: true, permintaan: h.transfer });
    }
    case "tidak-terima": {
      const h = await tidakTerimaTujuan(db, id, tujuanIndex, uid, isPembuat || user.is_owner);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      return json({ ok: true, permintaan: h.transfer });
    }
    case "tutup-tujuan": {
      const h = await tutupTujuan(db, id, tujuanIndex, typeof body.catatan === "string" ? body.catatan : "", uid, user.is_owner);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      return json({ ok: true, permintaan: h.transfer });
    }
    case "selesai": {
      const h = await selesaiTransfer(db, id, uid, isPembuat || user.is_owner);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      return json({ ok: true, permintaan: h.transfer });
    }
    case "batal": {
      const h = await batalTransfer(db, id, uid, isPembuat || user.is_owner);
      if (!h.ok) return json({ ok: false, error: h.error }, h.status);
      return json({ ok: true, permintaan: h.transfer });
    }
    default:
      return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
  }
}
