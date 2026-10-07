// app/api/stok/reorder-point/route.ts
// POST /api/stok/reorder-point — set reorder point (owner+admin). PRD §3.7, F2.
import { createRequire } from "node:module";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

const { verifikasiTokenSesi, ambilTokenDariCookie } = require("../../../../lib/dashboard/auth/sesi.js") as {
  verifikasiTokenSesi: (t: string, o: { now: number }) => { uid: string; role: string } | null;
  ambilTokenDariCookie: (c: string | null) => string | null;
};
const { tolakOrigin, cekRateLimit } = require("../../../../lib/dashboard/auth/guard.js") as {
  tolakOrigin: (r: Request) => { ok: true } | { ok: false; status: number; error: string };
  cekRateLimit: (k: string, maks: number) => { ok: true } | { ok: false; status: number; error: string };
};
const { validasiReorderPoint } = require("../../../../lib/dashboard/validasiTulisV2.js") as {
  validasiReorderPoint: (b: unknown) => { ok: true; kodeBarang: string; reorderPoint: number | null } | { ok: false; error: string };
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const origin = tolakOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);

  const token = ambilTokenDariCookie(request.headers.get("cookie"));
  const sesi = token ? verifikasiTokenSesi(token, { now: Date.now() }) : null;
  if (!sesi) {
    return json({ ok: false, error: "Sesi kedaluwarsa. Buka ulang dari Telegram." }, 401);
  }

  const batas = cekRateLimit(`reorder:${sesi.uid}`, 20);
  if (!batas.ok) {
    console.warn("[reorder_point_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  let body: { kode_barang?: unknown; reorder_point?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiReorderPoint(body);
  if (!valid.ok) {
    console.warn("[reorder_point_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, 400);
  }
  const { kodeBarang, reorderPoint } = valid;

  // Role dari admins (sumber kebenaran), bukan sesi/body.
  let role = "guest";
  try {
    const { ambilAdmin } = require("../../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" || admin.role === "admin" ? admin.role : "guest";
  } catch (e) {
    console.error("[reorder_point_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }
  if (role === "guest") {
    console.warn("[reorder_point_reject]", JSON.stringify({ uid: sesi.uid, alasan: "guest" }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  const { ambilProdukByKode } = require("../../../../lib/models/produk.js") as {
    ambilProdukByKode: (k: string) => Promise<{ kode_barang: string } | null>;
  };
  let produk: { kode_barang: string } | null;
  try {
    produk = await ambilProdukByKode(kodeBarang);
  } catch (e) {
    console.error("[reorder_point_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memperbarui reorder point." }, 500);
  }
  if (!produk) return json({ ok: false, error: "Produk tidak ditemukan." }, 404);

  const { ambilStok, setReorderPoint } = require("../../../../lib/models/stok.js") as {
    ambilStok: (k: string) => Promise<{ kode_barang: string; reorder_point?: number | null } | null>;
    setReorderPoint: (
      k: string,
      n: number | null,
      o: string
    ) => Promise<{ stok: { reorder_point?: number | null }; notifikasi: boolean } | null>;
  };
  const { catatPerubahanProduk } = require("../../../../lib/models/productChanges.js") as {
    catatPerubahanProduk: (p: Record<string, unknown>) => Promise<{ id: string }>;
  };

  let stokLama: { kode_barang: string; reorder_point?: number | null } | null;
  try {
    stokLama = await ambilStok(kodeBarang);
  } catch (e) {
    console.error("[reorder_point_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memperbarui reorder point." }, 500);
  }
  if (!stokLama) return json({ ok: false, error: "Data stok produk belum ada." }, 404);

  // Idempotent: nilai sama -> balas sukses tanpa tulis & tanpa audit.
  if ((stokLama.reorder_point ?? null) === (reorderPoint ?? null)) {
    return json({ ok: true, reorder_point: reorderPoint, notifikasi_terkirim: false });
  }

  let hasil: { stok: { reorder_point?: number | null }; notifikasi: boolean } | null;
  try {
    hasil = await setReorderPoint(kodeBarang, reorderPoint, sesi.uid);
  } catch (e) {
    console.error("[reorder_point_reject]", JSON.stringify({ uid: sesi.uid, alasan: "model", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memperbarui reorder point." }, 500);
  }

  const notifikasiTerkirim = hasil ? hasil.notifikasi === true : false;

  // Audit. Gagal audit tidak rollback.
  let peringatanAudit = false;
  try {
    await catatPerubahanProduk({
      kodeBarang,
      field: "reorder_point",
      nilaiLama: stokLama.reorder_point ?? null,
      nilaiBaru: reorderPoint ?? null,
      changedBy: sesi.uid,
    });
  } catch (e) {
    console.error("[audit_write_failed]", JSON.stringify({ kode_barang: kodeBarang, field: "reorder_point", pesan: String(e) }));
    peringatanAudit = true;
  }

  console.info("[reorder_point_success]", JSON.stringify({ uid: sesi.uid, kode: kodeBarang, reorder_point: reorderPoint }));

  const respons: Record<string, unknown> = { ok: true, reorder_point: reorderPoint, notifikasi_terkirim: notifikasiTerkirim };
  if (peringatanAudit) respons.peringatan_audit = true;
  return json(respons);
}
