// app/api/produk/online/route.ts
// POST /api/produk/online - toggle is_online_product (v5 F8). Admin + owner.
// Pola guard: tolakOrigin -> sesi -> rate limit -> role -> validasi -> model (urutan v5 T18).
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
const { validasiToggleOnline } = require("../../../../lib/dashboard/validasiGudangV5.js") as {
  validasiToggleOnline: (b: unknown) =>
    | { ok: true; status: number; aksi: string; kodeBarang: string; isOnline: boolean }
    | { ok: false; status: number; error: string };
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

  const batas = cekRateLimit(`produk-online:${sesi.uid}`, 40);
  if (!batas.ok) {
    console.warn("[produk_online_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  // Role dari admins (sumber kebenaran). F8: admin + owner boleh toggle.
  let role = "guest";
  try {
    const { ambilAdmin } = require("../../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
  } catch (e) {
    console.error("[produk_online_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }

  if (role !== "owner" && role !== "admin") {
    console.warn("[produk_online_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "guest" }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiToggleOnline(body);
  if (!valid.ok) {
    console.warn("[produk_online_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, valid.status);
  }

  const { setOnlineProduk } = require("../../../../lib/models/produk.js") as {
    setOnlineProduk: (kode: string, isOnline: boolean, oleh: string) => Promise<Record<string, unknown> | null>;
  };

  try {
    const produk = await setOnlineProduk(valid.kodeBarang, valid.isOnline, sesi.uid);
    if (produk === null) return json({ ok: false, error: "Produk tidak ditemukan." }, 404);

    console.info("[produk_online_v5_success]", JSON.stringify({ uid: sesi.uid, kode: valid.kodeBarang, is_online: valid.isOnline }));
    return json({ ok: true, produk });
  } catch (e) {
    console.error("[produk_online_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memperbarui status online." }, 500);
  }
}
