// app/api/stok/mutasi/route.ts — POST /api/stok/mutasi (Fase 1: D1 cutover).
// Kontrak sama seperti versi Firestore: mode tambah|kurangi|timpa, audit
// stock_moves, guard duplikat 10 dtk. Beda: sesi cookie swt_sesi (D1),
// model lib/d1/stok.ts. Stok negatif = fitur (I1).
import { getDb } from "@/lib/d1/db";
import { bacaQty, tulisQty } from "@/lib/d1/stok";
import { ambilProduk } from "@/lib/d1/produk";
import { guardAktif, kunciGuard, SCOPE, tulisGuard } from "@/lib/d1/guard";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MutasiMode = "tambah" | "kurangi" | "timpa";
const MODE_VALID: MutasiMode[] = ["tambah", "kurangi", "timpa"];

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);

  const body = await bacaBody(request);
  const kodeBarang = typeof body.kode_barang === "string" ? body.kode_barang.trim() : "";
  const mode = body.mode as MutasiMode;
  if (!kodeBarang) return json({ ok: false, error: "Kode barang wajib diisi." }, 400);
  if (!MODE_VALID.includes(mode)) return json({ ok: false, error: "Mode tidak dikenal." }, 400);

  const qtyRaw = body.qty;
  if (typeof qtyRaw !== "number" || !Number.isInteger(qtyRaw)) {
    return json({ ok: false, error: mode === "timpa" ? "Jumlah fisik harus bilangan bulat >= 0." : "Jumlah harus bilangan bulat >= 1." }, 400);
  }
  if (mode === "timpa" && qtyRaw < 0) return json({ ok: false, error: "Jumlah fisik harus bilangan bulat >= 0." }, 400);
  if (mode !== "timpa" && qtyRaw < 1) return json({ ok: false, error: "Jumlah harus bilangan bulat >= 1." }, 400);
  const qty = qtyRaw;
  const catatan = typeof body.catatan === "string" && body.catatan.trim() ? body.catatan.trim() : null;

  const db = getDb();
  const produk = await ambilProduk(db, kodeBarang);
  if (!produk) return json({ ok: false, error: "Produk tidak ditemukan." }, 404);

  // Guard duplikat best-effort 10 dtk
  try {
    const kunci = kunciGuard("mutasi", user.tg_id);
    if (await guardAktif(db, SCOPE.mutasi, kunci, { kode_barang: kodeBarang, mode, qty })) {
      return json({ ok: false, error: "duplikat" }, 409);
    }
    await tulisGuard(db, SCOPE.mutasi, kunci, { kode_barang: kodeBarang, mode, qty });
  } catch {
    // best-effort: jangan blokir tulis sah
  }

  const sebelum = await bacaQty(db, kodeBarang, "ONLINE");
  let qtyBaru: number;
  if (mode === "tambah") qtyBaru = sebelum + Math.abs(qty);
  else if (mode === "kurangi") qtyBaru = sebelum - Math.abs(qty);
  else qtyBaru = qty;

  const hasil = await tulisQty(db, {
    sku: kodeBarang,
    gudangId: "ONLINE",
    qtyBaru,
    oleh: user.tg_id,
    jenis: mode === "timpa" ? "opname" : "koreksi_manual",
    action_type: mode === "tambah" ? "tambah_stok" : "kurangi_stok",
    qty_sistem: mode === "timpa" ? sebelum : sebelum,
    qty_fisik: mode === "timpa" ? qtyBaru : null,
    source: "web_dashboard",
  });
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  void catatan;
  return json({ ok: true, stok_baru: qtyBaru, movement_id: "" });
}
