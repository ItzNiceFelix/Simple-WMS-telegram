// app/api/gudang/route.ts
// POST /api/gudang - master gudang (v5 F1). Owner only.
//   aksi: tambah | edit | nonaktif | aktifkan
// Pola guard: tolakOrigin -> sesi -> rate limit -> role -> validasi -> model (urutan v5 T18).
import { createRequire } from "node:module";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

const { verifikasiTokenSesi, ambilTokenDariCookie } = require("../../../lib/dashboard/auth/sesi.js") as {
  verifikasiTokenSesi: (t: string, o: { now: number }) => { uid: string; role: string } | null;
  ambilTokenDariCookie: (c: string | null) => string | null;
};
const { tolakOrigin, cekRateLimit } = require("../../../lib/dashboard/auth/guard.js") as {
  tolakOrigin: (r: Request) => { ok: true } | { ok: false; status: number; error: string };
  cekRateLimit: (k: string, maks: number) => { ok: true } | { ok: false; status: number; error: string };
};
const { validasiAksiGudang } = require("../../../lib/dashboard/validasiGudangV5.js") as {
  validasiAksiGudang: (b: unknown) =>
    | { ok: true; status: number; aksi: string; nama?: string; gudangId?: string }
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

  const batas = cekRateLimit(`gudang:${sesi.uid}`, 20);
  if (!batas.ok) return json({ ok: false, error: batas.error }, batas.status);

  // Role dari admins (sumber kebenaran). Owner only untuk semua aksi master gudang.
  let role = "guest";
  try {
    const { ambilAdmin } = require("../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
  } catch (e) {
    console.error("[gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }

  if (role !== "owner") {
    console.warn("[gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "bukan_owner" }));
    return json({ ok: false, error: "Hanya owner yang dapat mengelola gudang." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiAksiGudang(body);
  if (!valid.ok) {
    console.warn("[gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, valid.status);
  }

  const { tambahGudang, editGudang, nonaktifGudang, aktifkanGudang } = require("../../../lib/models/gudang.js") as {
    tambahGudang: (a: { nama: string; oleh: string }) => Promise<{ ok: boolean; status?: number; error?: string; gudang?: unknown }>;
    editGudang: (id: string, a: { nama: string; oleh: string }) => Promise<{ ok: boolean; status?: number; error?: string; gudang?: unknown }>;
    nonaktifGudang: (id: string, a: { oleh: string }) => Promise<{ ok: boolean; status?: number; error?: string; gudang?: unknown; peringatan_referensi?: number }>;
    aktifkanGudang: (id: string, a: { oleh: string }) => Promise<{ ok: boolean; status?: number; error?: string; gudang?: unknown }>;
  };

  try {
    if (valid.aksi === "tambah") {
      const hasil = await tambahGudang({ nama: valid.nama as string, oleh: sesi.uid });
      if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
      console.info("[gudang_v5_success]", JSON.stringify({ uid: sesi.uid, aksi: "tambah" }));
      return json({ ok: true, gudang: hasil.gudang });
    }
    if (valid.aksi === "edit") {
      const hasil = await editGudang(valid.gudangId as string, { nama: valid.nama as string, oleh: sesi.uid });
      if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
      console.info("[gudang_v5_success]", JSON.stringify({ uid: sesi.uid, aksi: "edit" }));
      return json({ ok: true, gudang: hasil.gudang });
    }
    if (valid.aksi === "nonaktif") {
      const hasil = await nonaktifGudang(valid.gudangId as string, { oleh: sesi.uid });
      if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
      console.info("[gudang_v5_success]", JSON.stringify({ uid: sesi.uid, aksi: "nonaktif" }));
      return json({ ok: true, gudang: hasil.gudang, peringatan_referensi: hasil.peringatan_referensi });
    }
    if (valid.aksi === "aktifkan") {
      const hasil = await aktifkanGudang(valid.gudangId as string, { oleh: sesi.uid });
      if (!hasil.ok) return json({ ok: false, error: hasil.error }, hasil.status);
      console.info("[gudang_v5_success]", JSON.stringify({ uid: sesi.uid, aksi: "aktifkan" }));
      return json({ ok: true, gudang: hasil.gudang });
    }
  } catch (e) {
    console.error("[gudang_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal menyimpan gudang." }, 500);
  }

  return json({ ok: false, error: "Aksi tidak dikenal." }, 400);
}
