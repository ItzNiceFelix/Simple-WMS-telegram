// app/api/stok/gudang/route.ts — POST dispatcher qty gudang (Fase 1: D1 cutover).
// aksi: set-qty | mutasi-gudang. Kontrak sama seperti versi Firestore,
// audit sudah di dalam lib/d1/stok.ts (best-effort di dalam batch).
import { getDb } from "@/lib/d1/db";
import { mutasiAntarGudang, tulisQty } from "@/lib/d1/stok";
import { ambilGudangAktif } from "@/lib/d1/gudang";
import { guardAktif, kunciGuard, SCOPE, tulisGuard } from "@/lib/d1/guard";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validasiIdGudang(id: unknown): string | null {
  if (typeof id !== "string" || !id.trim()) return null;
  const v = id.trim();
  if (v.includes("/") || v === "." || v === "..") return null;
  return v;
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 30);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  const { user } = sesi;
  if (!user.is_admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);

  const body = await bacaBody(request);
  const aksi = body.aksi;
  const db = getDb();

  if (aksi === "set-qty") {
    const kodeBarang = typeof body.kode_barang === "string" ? body.kode_barang.trim() : "";
    const gudangId = validasiIdGudang(body.gudang_id);
    const qty = body.qty;
    if (!kodeBarang || !gudangId || typeof qty !== "number" || !Number.isInteger(qty)) {
      return json({ ok: false, error: "Data tidak valid." }, 400);
    }
    if (!user.is_owner && !user.scope_gudang.includes(gudangId)) {
      return json({ ok: false, error: "Anda hanya dapat mengubah stok gudang Anda." }, 403);
    }
    if (!(await ambilGudangAktif(db, gudangId))) {
      return json({ ok: false, error: "Gudang tidak dikenal." }, 400);
    }
    const hasil = await tulisQty(db, {
      sku: kodeBarang, gudangId, qtyBaru: qty, oleh: user.tg_id,
      jenis: "koreksi_manual", source: "web_dashboard",
    });
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, qty_per_gudang: hasil.qty_per_gudang });
  }

  if (aksi === "mutasi-gudang") {
    const kodeBarang = typeof body.kode_barang === "string" ? body.kode_barang.trim() : "";
    const dariId = validasiIdGudang(body.dari_gudang_id);
    const keId = validasiIdGudang(body.ke_gudang_id);
    const qty = body.qty;
    if (!kodeBarang || !dariId || !keId || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) {
      return json({ ok: false, error: "Data tidak valid." }, 400);
    }
    if (!user.is_owner && !user.scope_gudang.includes(dariId)) {
      return json({ ok: false, error: "Anda hanya dapat memindah dari gudang Anda." }, 403);
    }
    const [dariAktif, keAktif] = await Promise.all([ambilGudangAktif(db, dariId), ambilGudangAktif(db, keId)]);
    if (!dariAktif || !keAktif) return json({ ok: false, error: "Gudang tidak dikenal." }, 400);
    try {
      const kunci = kunciGuard("mutasi-gudang", user.tg_id);
      const pembanding = { kode: kodeBarang, dari: dariId, ke: keId, qty };
      if (await guardAktif(db, SCOPE.stokGudang, kunci, pembanding)) {
        return json({ ok: false, error: "duplikat" }, 409);
      }
      await tulisGuard(db, SCOPE.stokGudang, kunci, pembanding);
    } catch {
      // best-effort
    }
    const hasil = await mutasiAntarGudang(db, kodeBarang, dariId, keId, qty, user.tg_id);
    if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
    return json({ ok: true, qty_per_gudang: hasil.qty_per_gudang });
  }

  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
