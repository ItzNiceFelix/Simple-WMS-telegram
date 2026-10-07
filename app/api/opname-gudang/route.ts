// app/api/opname-gudang/route.ts
// POST /api/opname-gudang - stok opname per gudang (v5 F7).
//   aksi: buat (admin/owner) | setujui (owner) | tolak (owner)
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
const { validasiAksiOpnameGudang } = require("../../../lib/dashboard/validasiOpnameGudangV5.js") as {
  validasiAksiOpnameGudang: (b: unknown) =>
    | { ok: true; status: number; aksi: string; gudangId: string; items: { kode_barang: string; qty_fisik: number }[] }
    | { ok: true; status: number; aksi: string; id: string }
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

  const batas = cekRateLimit(`opname-gudang:${sesi.uid}`, 20);
  if (!batas.ok) {
    console.warn("[opname_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  // Role dari admins (sumber kebenaran). Guest (termasuk tanpa dokumen admin) ditolak di sini.
  let role = "guest";
  let gudangUser: string | null = null;
  try {
    const { ambilAdmin } = require("../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string; gudang_id?: string | null } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
    gudangUser = admin.gudang_id ? String(admin.gudang_id) : null;
  } catch (e) {
    console.error("[opname_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }

  if (role === "guest") {
    console.warn("[opname_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "guest" }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiAksiOpnameGudang(body);
  if (!valid.ok) {
    console.warn("[opname_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, valid.status);
  }

  const { buatOpname, setujuiOpname, tolakOpname } = require("../../../lib/models/opnameGudang.js") as {
    buatOpname: (a: { gudang_id: string; items: { kode_barang: string; qty_fisik: number }[]; oleh: string }) => Promise<
      { ok: true; opname: unknown; status: string; langsung: boolean } | { ok: false; status: number; error: string }
    >;
    setujuiOpname: (id: string, oleh: string) => Promise<{ ok: true; opname: unknown } | { ok: false; status: number; error: string }>;
    tolakOpname: (id: string, oleh: string) => Promise<{ ok: true; opname: unknown } | { ok: false; status: number; error: string }>;
  };

  try {
    if (valid.aksi === "buat") {
      const v = valid as { gudangId: string; items: { kode_barang: string; qty_fisik: number }[] };
      // Scope tulis (BR7, F7 AC): admin hanya boleh opname gudang miliknya. Owner bebas.
      if (role === "admin" && gudangUser && v.gudangId !== gudangUser) {
        console.warn("[opname_v5_reject]", JSON.stringify({ uid: sesi.uid, aksi: "buat", alasan: "scope_gudang" }));
        return json({ ok: false, error: "Anda hanya dapat opname gudang Anda." }, 403);
      }
      if (role === "admin" && !gudangUser) {
        return json({ ok: false, error: "Akun Anda belum punya gudang." }, 403);
      }
      const hasil = await buatOpname({ gudang_id: v.gudangId, items: v.items, oleh: sesi.uid });
      if (!hasil.ok) {
        console.warn("[opname_v5_reject]", JSON.stringify({ uid: sesi.uid, aksi: "buat", alasan: hasil.error }));
        return json({ ok: false, error: hasil.error }, hasil.status);
      }
      console.info("[opname_v5_success]", JSON.stringify({ uid: sesi.uid, aksi: "buat" }));
      return json({ ok: true, opname: hasil.opname, status: hasil.status, langsung: hasil.langsung });
    }

    // setujui / tolak: OWNER ONLY.
    if (role !== "owner") {
      console.warn("[opname_v5_reject]", JSON.stringify({ uid: sesi.uid, aksi: valid.aksi, alasan: "bukan_owner" }));
      return json({ ok: false, error: "Hanya owner yang dapat menyetujui opname." }, 403);
    }

    const v = valid as { id: string };
    const hasil = valid.aksi === "setujui" ? await setujuiOpname(v.id, sesi.uid) : await tolakOpname(v.id, sesi.uid);
    if (!hasil.ok) {
      console.warn("[opname_v5_reject]", JSON.stringify({ uid: sesi.uid, aksi: valid.aksi, alasan: hasil.error }));
      return json({ ok: false, error: hasil.error }, hasil.status);
    }
    console.info("[opname_v5_success]", JSON.stringify({ uid: sesi.uid, aksi: valid.aksi }));
    return json({ ok: true, opname: hasil.opname });
  } catch (e) {
    console.error("[opname_v5_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memproses opname." }, 500);
  }
}
