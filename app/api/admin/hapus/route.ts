// app/api/admin/hapus/route.ts
// POST /api/admin/hapus — hapus admin (owner only). PRD §5.7.
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
const { validasiHapusAdmin, alasanTolakHapus } = require("../../../../lib/dashboard/validasiTulisV2.js") as {
  validasiHapusAdmin: (b: unknown) => { ok: true; telegramUserId: string } | { ok: false; error: string };
  alasanTolakHapus: (a: {
    requesterId: string;
    targetId: string;
    targetAdmin: { role?: string } | null;
    jumlahOwner: number;
    superAdminEnv: boolean;
  }) => { ok: true } | { ok: false; status: number; error: string };
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

  const batas = cekRateLimit(`adminhapus:${sesi.uid}`, 10);
  if (!batas.ok) {
    console.warn("[admin_hapus_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  let body: { telegram_user_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiHapusAdmin(body);
  if (!valid.ok) {
    console.warn("[admin_hapus_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, 400);
  }
  const { telegramUserId } = valid;

  const { ambilAdmin, ambilSemuaAdminByRole, hapusAdmin, isSuperAdminDariEnv } = require("../../../../lib/models/admins.js") as {
    ambilAdmin: (id: string) => Promise<{ role?: string; name?: string | null } | null>;
    ambilSemuaAdminByRole: (role: string) => Promise<unknown[]>;
    hapusAdmin: (id: string) => Promise<void>;
    isSuperAdminDariEnv: (id: string) => boolean;
  };
  const { catatPerubahanRole } = require("../../../../lib/models/adminRoleChanges.js") as {
    catatPerubahanRole: (p: Record<string, unknown>) => Promise<{ id: string }>;
  };
  const { revokeAccessRequest } = require("../../../../lib/models/accessRequests.js") as {
    revokeAccessRequest: (id: string, oleh: string) => Promise<unknown>;
  };

  // Role requester dari admins (sumber kebenaran), bukan sesi/body.
  let role = "guest";
  try {
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
  } catch (e) {
    console.error("[admin_hapus_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }
  if (role !== "owner") {
    console.warn("[admin_hapus_reject]", JSON.stringify({ uid: sesi.uid, alasan: "bukan_owner" }));
    return json({ ok: false, error: "Hanya owner yang dapat menghapus admin." }, 403);
  }

  let targetAdmin: { role?: string; name?: string | null } | null;
  let jumlahOwner = 0;
  try {
    targetAdmin = await ambilAdmin(telegramUserId);
    if (targetAdmin?.role === "owner") {
      jumlahOwner = (await ambilSemuaAdminByRole("owner")).length;
    }
  } catch (e) {
    console.error("[admin_hapus_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal menghapus admin." }, 500);
  }

  const tolak = alasanTolakHapus({
    requesterId: sesi.uid,
    targetId: telegramUserId,
    targetAdmin,
    jumlahOwner,
    superAdminEnv: isSuperAdminDariEnv(telegramUserId),
  });
  if (!tolak.ok) return json({ ok: false, error: tolak.error }, tolak.status);

  try {
    await hapusAdmin(telegramUserId);
  } catch (e) {
    console.error("[admin_hapus_reject]", JSON.stringify({ uid: sesi.uid, alasan: "model", pesan: String(e) }));
    return json({ ok: false, error: "Gagal menghapus admin." }, 500);
  }

  // Tutup akses lama supaya user perlu request ulang (WAJIB, paritas bot — PRD §5.3/Q2).
  // Karena hapus sudah commit, kegagalan revoke dicatat + ditandai di respons, TIDAK rollback.
  let peringatanRevoke = false;
  try {
    await revokeAccessRequest(telegramUserId, sesi.uid);
  } catch (e) {
    console.error("[access_request_revoke_failed]", JSON.stringify({ target: telegramUserId, pesan: String(e) }));
    peringatanRevoke = true;
  }

  // Audit. Gagal audit tidak rollback.
  let peringatanAudit = false;
  try {
    await catatPerubahanRole({
      targetUserId: telegramUserId,
      targetName: targetAdmin?.name ?? null,
      roleLama: targetAdmin?.role ?? null,
      roleBaru: "dihapus",
      changedBy: sesi.uid,
    });
  } catch (e) {
    console.error("[audit_write_failed]", JSON.stringify({ target: telegramUserId, pesan: String(e) }));
    peringatanAudit = true;
  }

  console.info("[admin_hapus_success]", JSON.stringify({ uid: sesi.uid, target: telegramUserId }));

  const respons: Record<string, unknown> = {
    ok: true,
    telegram_user_id: telegramUserId,
    nama: targetAdmin?.name ?? null,
  };
  if (peringatanAudit) respons.peringatan_audit = true;
  if (peringatanRevoke) respons.peringatan_revoke = true;
  return json(respons);
}
