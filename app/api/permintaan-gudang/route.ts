// app/api/permintaan-gudang/route.ts — POST transfer antar-gudang (Fase 1: D1 cutover).
// aksi: buat | ubah-item | setujui-tujuan | tolak-tujuan | tolak | batal |
//       kirim | terima | tidak-terima | tutup-tujuan | selesai | pdf
// GET ?aksi=pdf&id= → unduh surat permintaan (dipakai window.open di klien).
import { getDb } from "@/lib/d1/db";
import {
  ambilTransfer, batalTransfer, buatTransfer, kirimTujuan, selesaiTransfer,
  terimaTujuan, tidakTerimaTujuan, setujuiTujuan, tolakDokumen, tolakTujuan, tutupTujuan,
  ubahItemTransfer,
} from "@/lib/d1/transfer";
import { ambilGudang } from "@/lib/d1/gudang";
import { bangunPdfPermintaan } from "@/lib/d1/permintaanPdf";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nama gudang untuk header PDF; jatuh ke id bila master tak ada. */
async function namaGudangAtauId(db: D1Database, id: string): Promise<string> {
  const g = await ambilGudang(db, id);
  return g?.nama ?? id;
}

/** Susun tabel PDF: nama produk dari master products (nama_accurate), fallback SKU. */
async function barisPdf(
  db: D1Database,
  items: { sku: string; nama: string | null; qty: number }[]
): Promise<{ nama: string; sku: string; qty: number }[]> {
  const keluar: { nama: string; sku: string; qty: number }[] = [];
  for (const it of items) {
    const p = await db
      .prepare("SELECT nama_accurate FROM products WHERE sku = ?")
      .bind(it.sku)
      .first<{ nama_accurate: string | null }>();
    keluar.push({ nama: p?.nama_accurate ?? it.nama ?? it.sku, sku: it.sku, qty: it.qty });
  }
  return keluar;
}

/** Bytes PDF + nama berkas untuk satu permintaan; error teks bila tak ditemukan. */
async function pdfPermintaan(
  db: D1Database,
  id: string,
  pembuat: string
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: number; error: string }> {
  const t = await ambilTransfer(db, id);
  if (!t) return { ok: false, status: 404, error: "Permintaan tidak ditemukan." };
  const items = t.tujuan.flatMap((x) => x.items);
  // Item dokumen TIDAK ada di header transfer: tabel PDF = gabungan item tiap tujuan.
  const unik = new Map<string, number>();
  for (const it of items) unik.set(it.sku, (unik.get(it.sku) ?? 0) + it.qty);
  if (unik.size === 0) return { ok: false, status: 400, error: "Permintaan belum punya item." };
  const bytes = await bangunPdfPermintaan({
    id,
    asal: await namaGudangAtauId(db, t.dari_warehouse_id),
    pembuat: pembuat || t.created_by || "-",
    baris: await barisPdf(
      db,
      [...unik].map(([sku, qty]) => ({ sku, nama: null, qty }))
    ),
  });
  return { ok: true, bytes };
}

/** Header unduhan PDF yang sama untuk POST maupun GET. */
function headerPdf(id: string): { status: number; headers: Record<string, string> } {
  return {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="permintaan-${id}.pdf"`,
      "cache-control": "no-store",
    },
  };
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  const url = new URL(request.url);
  if (url.searchParams.get("aksi") !== "pdf") return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) return json({ ok: false, error: "ID permintaan wajib diisi." }, 400);
  const h = await pdfPermintaan(getDb(), id, String(sesi.user.tg_id));
  if (!h.ok) return json({ ok: false, error: h.error }, h.status);
  return new Response(new Uint8Array(h.bytes), headerPdf(id));
}

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
  if (aksi === "pdf") {
    const h = await pdfPermintaan(db, id, String(user.tg_id));
    if (!h.ok) return json({ ok: false, error: h.error }, h.status);
    return new Response(new Uint8Array(h.bytes), headerPdf(id));
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
