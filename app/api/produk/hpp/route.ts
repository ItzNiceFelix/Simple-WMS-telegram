// app/api/produk/hpp/route.ts — POST ubah HPP (Fase 1: D1 cutover). Owner only.
// Idempotent: tanpa perubahan riil → sukses tanpa tulis/audit.
import { getDb } from "@/lib/d1/db";
import { ambilProduk, ubahHpp } from "@/lib/d1/produk";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_owner) return json({ ok: false, error: "Hanya owner yang dapat mengubah HPP." }, 403);

  const body = await bacaBody(request);
  const kodeBarang = typeof body.kode_barang === "string" ? body.kode_barang.trim() : "";
  if (!kodeBarang) return json({ ok: false, error: "Kode barang wajib diisi." }, 400);
  const adaHpp = body.hpp !== undefined;
  const hpp = typeof body.hpp === "number" && Number.isInteger(body.hpp) && body.hpp >= 0 ? body.hpp : null;
  if (adaHpp && hpp === null) return json({ ok: false, error: "HPP harus bilangan bulat >= 0." }, 400);

  const db = getDb();
  const produk = await ambilProduk(db, kodeBarang);
  if (!produk) return json({ ok: false, error: "Produk tidak ditemukan." }, 404);
  if (!adaHpp || produk.hpp === hpp) {
    return json({ ok: true, produk: { kode_barang: kodeBarang, hpp: produk.hpp, hpp_baru: produk.hpp_baru } });
  }
  const hasil = await ubahHpp(db, kodeBarang, hpp as number, user.tg_id);
  if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
  return json({ ok: true, produk: { kode_barang: kodeBarang, hpp: hasil.hpp, hpp_baru: produk.hpp_baru } });
}
