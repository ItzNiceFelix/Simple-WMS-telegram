// app/api/produk/hpp/route.ts
// POST /api/produk/hpp — ubah HPP & HPP baru (owner only). PRD §2.7, 24, FR-WRITE-01.
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
const { validasiHpp } = require("../../../../lib/dashboard/validasiTulisV2.js") as {
  validasiHpp: (b: unknown) =>
    | { ok: true; kodeBarang: string; adaHpp: boolean; hpp?: number; adaHppBaru: boolean; hppBaru?: number | null }
    | { ok: false; error: string };
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

type Produk = { kode_barang: string; hpp?: number | null; hpp_baru?: number | null };

export async function POST(request: Request) {
  const origin = tolakOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);

  const token = ambilTokenDariCookie(request.headers.get("cookie"));
  const sesi = token ? verifikasiTokenSesi(token, { now: Date.now() }) : null;
  if (!sesi) {
    return json({ ok: false, error: "Sesi kedaluwarsa. Buka ulang dari Telegram." }, 401);
  }

  const batas = cekRateLimit(`hpp:${sesi.uid}`, 20);
  if (!batas.ok) {
    console.warn("[product_change_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  let body: { kode_barang?: unknown; hpp?: unknown; hpp_baru?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiHpp(body);
  if (!valid.ok) {
    console.warn("[product_change_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, 400);
  }
  const { kodeBarang, adaHpp, hpp, adaHppBaru, hppBaru } = valid;

  // Role dari admins (sumber kebenaran), bukan sesi/body.
  let role = "guest";
  try {
    const { ambilAdmin } = require("../../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
  } catch (e) {
    console.error("[product_change_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }
  if (role !== "owner") {
    console.warn("[product_change_reject]", JSON.stringify({ uid: sesi.uid, alasan: "bukan_owner" }));
    return json({ ok: false, error: "Hanya owner yang dapat mengubah HPP." }, 403);
  }

  const { ambilProdukByKode, updateProduk } = require("../../../../lib/models/produk.js") as {
    ambilProdukByKode: (k: string) => Promise<Produk | null>;
    updateProduk: (k: string, p: Record<string, unknown>) => Promise<Produk | null>;
  };
  const { catatPerubahanProduk } = require("../../../../lib/models/productChanges.js") as {
    catatPerubahanProduk: (p: Record<string, unknown>) => Promise<{ id: string }>;
  };

  let produk: Produk | null;
  try {
    produk = await ambilProdukByKode(kodeBarang);
  } catch (e) {
    console.error("[product_change_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memperbarui HPP." }, 500);
  }
  if (!produk) return json({ ok: false, error: "Produk tidak ditemukan." }, 404);

  // Idempotent: tidak ada perubahan riil -> balas sukses tanpa tulis & tanpa audit.
  const hppSama = !adaHpp || produk.hpp === hpp;
  const hppBaruSama = !adaHppBaru || (produk.hpp_baru ?? null) === (hppBaru ?? null);
  if (hppSama && hppBaruSama) {
    return json({ ok: true, produk });
  }

  const partial: Record<string, unknown> = {};
  if (adaHpp) partial.hpp = hpp;
  if (adaHppBaru) partial.hpp_baru = hppBaru;

  let produkBaru: Produk | null;
  try {
    produkBaru = await updateProduk(kodeBarang, partial);
  } catch (e) {
    console.error("[product_change_reject]", JSON.stringify({ uid: sesi.uid, alasan: "model", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memperbarui HPP." }, 500);
  }

  // Audit satu baris per field yang BENAR-BENAR berubah. Gagal audit tidak rollback.
  let peringatanAudit = false;
  const perubahan: { field: string; nilaiLama: number | null; nilaiBaru: number | null }[] = [];
  if (adaHpp && produk.hpp !== hpp) {
    perubahan.push({ field: "hpp", nilaiLama: produk.hpp ?? null, nilaiBaru: hpp ?? null });
  }
  if (adaHppBaru && (produk.hpp_baru ?? null) !== (hppBaru ?? null)) {
    perubahan.push({ field: "hpp_baru", nilaiLama: produk.hpp_baru ?? null, nilaiBaru: hppBaru ?? null });
  }

  for (const p of perubahan) {
    try {
      await catatPerubahanProduk({
        kodeBarang,
        field: p.field,
        nilaiLama: p.nilaiLama,
        nilaiBaru: p.nilaiBaru,
        changedBy: sesi.uid,
      });
    } catch (e) {
      console.error(
        "[audit_write_failed]",
        JSON.stringify({ kode_barang: kodeBarang, field: p.field, pesan: String(e) })
      );
      peringatanAudit = true;
    }
  }

  console.info("[product_change_success]", JSON.stringify({ uid: sesi.uid, kode: kodeBarang }));

  return json(peringatanAudit ? { ok: true, produk: produkBaru, peringatan_audit: true } : { ok: true, produk: produkBaru });
}
