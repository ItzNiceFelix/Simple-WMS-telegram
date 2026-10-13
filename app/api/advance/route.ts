// app/api/advance/route.ts — Fase C3: daftar booking Advance + kirim/batal + picklist PDF.
// GET  ?aksi=daftar&status=&limit= → { ok, booking }
// POST { aksi:'kirim'|'batal', booking_sn } → stok ONLINE turun + ledger 'kirim_advance'.
// GET  ?aksi=picklist-pdf&status= → PDF A4 (1 baris = 1 booking SN).
import { getDb } from "@/lib/d1/db";
import { ambilBooking, batalkanBooking, kirimKeShopee, listBooking } from "@/lib/d1/advanceBelumSku";
import { bangunPdfAdvance, type BarisAdvancePick } from "@/lib/d1/advancePdf";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_VALID = ["menunggu", "terkirim", "batal", "timeout"];

const teks = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 60);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi") ?? "daftar";
  const db = getDb();
  const statusParam = (url.searchParams.get("status") ?? "").trim();
  const status = STATUS_VALID.includes(statusParam) ? statusParam : undefined;

  if (aksi === "picklist-pdf") {
    const booking = await listBooking(db, { status: status ?? "menunggu", limit: 500 });
    if (booking.length === 0) return json({ ok: false, error: "Tidak ada booking untuk dicetak." }, 400);
    const skuList = [...new Set(booking.map((b) => b.sku))];
    const lokasi = new Map<string, string>();
    for (let i = 0; i < skuList.length; i += 50) {
      const potong = skuList.slice(i, i + 50);
      const tanda = potong.map(() => "?").join(",");
      const { results } = await db
        .prepare(`SELECT sku, lokasi FROM products WHERE sku IN (${tanda})`)
        .bind(...potong)
        .all<{ sku: string; lokasi: string | null }>();
      for (const r of results) lokasi.set(r.sku, r.lokasi ?? "");
    }
    const rows: BarisAdvancePick[] = booking.map((b) => ({
      booking_sn: b.booking_sn,
      sku: b.sku,
      nama: b.nama_produk,
      variasi: b.variasi,
      qty: b.qty,
      lokasi: lokasi.get(b.sku) ?? "",
    }));
    const batchImport = booking[0]?.batch_import ?? null;
    const bytes = await bangunPdfAdvance(rows, { gudang: "Gudang ONLINE", batchImport });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="picklist-advance.pdf"`,
        "cache-control": "no-store",
      },
    });
  }

  if (aksi === "detail") {
    const sn = teks(url.searchParams.get("booking_sn"));
    if (!sn) return json({ ok: false, error: "booking_sn wajib diisi." }, 400);
    const booking = await ambilBooking(db, sn);
    if (!booking) return json({ ok: false, error: "Booking tidak ditemukan." }, 404);
    return json({ ok: true, booking });
  }

  if (aksi !== "daftar") return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
  const limitRaw = Number(url.searchParams.get("limit"));
  const booking = await listBooking(db, { status, limit: Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 200 });
  const ringkas = { menunggu: 0, terkirim: 0, batal: 0, timeout: 0 };
  for (const b of booking) if (b.status in ringkas) ringkas[b.status as keyof typeof ringkas]++;
  return json({ ok: true, booking, ringkas });
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);
  const body = await bacaBody(request);
  const aksi = teks(body.aksi);
  const db = getDb();

  // Borongan: satu klik untuk banyak booking.
  if (aksi === "kirim-massal" || aksi === "batal-massal") {
    const daftar = Array.isArray(body.booking_sn) ? (body.booking_sn as unknown[]).map(teks).filter(Boolean) : [];
    if (daftar.length === 0) return json({ ok: false, error: "Daftar booking kosong." }, 400);
    if (daftar.length > 200) return json({ ok: false, error: "Maksimal 200 booking per aksi." }, 400);
    const gagalKirim: { booking_sn: string; error: string }[] = [];
    let sukses = 0;
    for (const sn of daftar) {
      const r = aksi === "kirim-massal" ? await kirimKeShopee(db, sn, String(sesi.user.tg_id)) : await batalkanBooking(db, sn, String(sesi.user.tg_id));
      if (r.ok) sukses++;
      else gagalKirim.push({ booking_sn: sn, error: r.error });
    }
    return json({ ok: true, sukses, gagal: gagalKirim });
  }

  if (aksi !== "kirim" && aksi !== "batal") return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
  const bookingSn = teks(body.booking_sn);
  if (!bookingSn) return json({ ok: false, error: "booking_sn wajib diisi." }, 400);
  if (aksi === "kirim") {
    const hasil = await kirimKeShopee(db, bookingSn, String(sesi.user.tg_id));
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, booking_sn: hasil.booking_sn, qty: hasil.qty, stok_negatif: hasil.stok_negatif, stok_akhir: hasil.stok_akhir });
  }
  const hasil = await batalkanBooking(db, bookingSn, String(sesi.user.tg_id));
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, booking_sn: hasil.booking_sn });
}
