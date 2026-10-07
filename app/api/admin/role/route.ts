// app/api/admin/role/route.ts
// POST /api/admin/role — ubah role admin (owner only). PRD §4.7.
// Audit ditulis DI DALAM model updateRoleAdmin (Opsi D) — route TIDAK mencatat audit.
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
const { validasiRole } = require("../../../../lib/dashboard/validasiTulisV2.js") as {
  validasiRole: (b: unknown) => { ok: true; targetUserId: string; roleBaru: string } | { ok: false; error: string };
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

  const batas = cekRateLimit(`adminrole:${sesi.uid}`, 10);
  if (!batas.ok) {
    console.warn("[admin_role_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  let body: { target_user_id?: unknown; role_baru?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiRole(body);
  if (!valid.ok) {
    console.warn("[admin_role_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, 400);
  }
  const { targetUserId, roleBaru } = valid;

  const { ambilAdmin, updateRoleAdmin } = require("../../../../lib/models/admins.js") as {
    ambilAdmin: (id: string) => Promise<{ role?: string; name?: string | null } | null>;
    updateRoleAdmin: (
      id: string,
      role: string,
      oleh: string
    ) => Promise<{
      error?: string;
      adminLama?: { role?: string };
      adminBaru?: { role?: string };
      peringatan_audit?: boolean;
    }>;
  };

  // Role requester dari admins (sumber kebenaran), bukan sesi/body.
  let role = "guest";
  try {
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
  } catch (e) {
    console.error("[admin_role_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }
  if (role !== "owner") {
    console.warn("[admin_role_reject]", JSON.stringify({ uid: sesi.uid, alasan: "bukan_owner" }));
    return json({ ok: false, error: "Hanya owner yang dapat mengubah role." }, 403);
  }

  let hasil: {
    error?: string;
    adminLama?: { role?: string };
    adminBaru?: { role?: string };
    peringatan_audit?: boolean;
  };
  try {
    // Audit berjalan DI DALAM model (Opsi D). Audit gagal TIDAK melempar — dilaporkan
    // lewat `peringatan_audit`. Throw di sini = kegagalan update()/baca nyata -> 500.
    hasil = await updateRoleAdmin(targetUserId, roleBaru, sesi.uid);
  } catch (e) {
    console.error("[admin_role_reject]", JSON.stringify({ uid: sesi.uid, alasan: "model", pesan: String(e) }));
    return json({ ok: false, error: "Gagal mengubah role." }, 500);
  }

  // Guard model memetakan kesalahan input domain ke 400 (pesan model apa adanya).
  if (hasil.error) return json({ ok: false, error: hasil.error }, 400);

  console.info("[admin_role_success]", JSON.stringify({ uid: sesi.uid, target: targetUserId, role_baru: roleBaru }));
  const respons: Record<string, unknown> = {
    ok: true,
    target_user_id: targetUserId,
    role_lama: hasil.adminLama?.role ?? "guest",
    role_baru: hasil.adminBaru?.role ?? roleBaru,
  };
  if (hasil.peringatan_audit) respons.peringatan_audit = true;
  return json(respons);
}
