// app/api/harga-jual/route.ts — Hitung harga jual per SKU.
// GET  ?aksi=komponen&presetId=&sku=          → komponen fee otomatis (dari fee_rules)
// POST { aksi:'hitung', presetId, sku, feePersen[], feeFlat[], opexBulanan, volumeBulanan,
//        iklanPersen, marginTarget, qtyPerOrder?, pembulatan? } → hasil harga jual
// POST { aksi:'komponen-banyak', presetId, sku[] } → komponen untuk banyak SKU sekaligus
import { getDb } from "@/lib/d1/db";
import { hitungHargaJual, type KomponenFee } from "@/lib/laba/hitungHargaJual";
import { muatKomponenHarga } from "@/lib/d1/hargaJualPreset";
import { bacaBody, json, sesiRoute } from "@/lib/d1/route";

function angka(v: unknown, bawaan = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : bawaan;
}

/** Baca array komponen fee dari body; tidak ada = ambil dari auto (null). */
function bacaFee(v: unknown, field: "persen" | "flat"): KomponenFee[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x): KomponenFee => ({
      nama: String(x.nama ?? x.jenis ?? "biaya"),
      jenis: String(x.jenis ?? "lain"),
      persen: angka(x.persen),
      flat: angka(x.flat),
      sumber: x.sumber === "manual" ? "manual" : "auto",
    }))
    .filter((f) => (field === "persen" ? f.persen > 0 : f.flat > 0));
}

export async function GET(request: Request) {
  const sesi = await sesiRoute(request, 120);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const url = new URL(request.url);
  const aksi = url.searchParams.get("aksi");
  const presetId = Number(url.searchParams.get("presetId"));
  if (!Number.isInteger(presetId) || presetId <= 0) return json({ ok: false, error: "presetId wajib diisi." }, 400);
  const db = getDb();

  if (aksi === "komponen") {
    const sku = (url.searchParams.get("sku") ?? "").trim().toUpperCase();
    if (!sku) return json({ ok: false, error: "sku wajib diisi." }, 400);
    const komponen = await muatKomponenHarga(db, presetId, sku);
    if (!komponen) return json({ ok: false, error: "SKU atau preset tidak ditemukan." }, 404);
    return json({ ok: true, komponen });
  }

  if (aksi === "cari-sku") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return json({ ok: true, daftar: [] });
    const pola = `%${q.toUpperCase()}%`;
    const { results } = await db.prepare(
      "SELECT sku, nama_accurate, hpp FROM products WHERE sku LIKE ? OR UPPER(nama_accurate) LIKE ? ORDER BY nama_accurate LIMIT 20"
    ).bind(pola, pola).all<{ sku: string; nama_accurate: string; hpp: number | null }>();
    return json({ ok: true, daftar: results });
  }

  return json({ ok: false, error: "Aksi tidak dikenal (komponen/cari-sku)." }, 400);
}

export async function POST(request: Request) {
  const sesi = await sesiRoute(request, 20);
  if (!sesi.ok) return json({ ok: false, error: sesi.error }, sesi.status);
  if (!sesi.user.is_admin) return json({ ok: false, error: "Akses ditolak." }, 403);

  const body = await bacaBody(request);
  if (body.aksi !== "hitung") return json({ ok: false, error: "Aksi tidak dikenal (hitung)." }, 400);

  const presetId = Number(body.presetId);
  if (!Number.isInteger(presetId) || presetId <= 0) return json({ ok: false, error: "presetId wajib diisi." }, 400);
  const sku = String(body.sku ?? "").trim().toUpperCase();
  if (!sku) return json({ ok: false, error: "sku wajib diisi." }, 400);

  const db = getDb();
  const auto = await muatKomponenHarga(db, presetId, sku);
  if (!auto) return json({ ok: false, error: "SKU atau preset tidak ditemukan." }, 404);

  // Fee: pakai kiriman user bila ada (sudah diedit), jika tidak pakai hasil auto.
  const feePersen = bacaFee(body.feePersen, "persen") ?? auto.feePersen;
  const feeFlat = bacaFee(body.feeFlat, "flat") ?? auto.feeFlat;

  const hasil = hitungHargaJual({
    hpp: body.hpp != null ? angka(body.hpp, auto.hpp) : auto.hpp,
    feePersen,
    feeFlat,
    qtyPerOrder: angka(body.qtyPerOrder, 1) || 1,
    opexBulanan: angka(body.opexBulanan),
    volumeBulanan: angka(body.volumeBulanan),
    iklanPersen: angka(body.iklanPersen),
    marginMode: body.marginMode === "nominal" ? "nominal" : "persen",
    marginTarget: angka(body.marginTarget),
    pembulatan: angka(body.pembulatan),
  });

  // Gabungkan peringatan auto (tier tak dikenal, HPP basi) dengan peringatan hitung.
  const peringatan = [...auto.peringatan, ...(hasil.ok ? hasil.peringatan : hasil.peringatan)];
  if (!hasil.ok) return json({ ok: false, error: hasil.error, peringatan, komponen: auto }, 400);
  return json({ ok: true, hasil, komponen: auto, peringatan });
}
