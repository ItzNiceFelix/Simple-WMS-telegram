// app/api/admin/tambah/route.ts
// POST /api/admin/tambah — tambah admin baru (owner only). PRD §5.7.
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
const { validasiTambahAdmin } = require("../../../../lib/dashboard/validasiTulisV2.js") as {
  validasiTambahAdmin: (b: unknown) =>
    | { ok: true; telegramUserId: string; name: string; username: string | null; role: string }
    | { ok: false; error: string };
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

  const batas = cekRateLimit(`admintambah:${sesi.uid}`, 10);
  if (!batas.ok) {
    console.warn("[admin_tambah_reject]", JSON.stringify({ uid: sesi.uid, alasan: "rate_limit" }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  let body: {
    telegram_user_id?: unknown;
    name?: unknown;
    telegram_username?: unknown;
    role?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const valid = validasiTambahAdmin(body);
  if (!valid.ok) {
    console.warn("[admin_tambah_reject]", JSON.stringify({ uid: sesi.uid, alasan: "validasi" }));
    return json({ ok: false, error: valid.error }, 400);
  }
  const { telegramUserId, name, username, role: roleBaru } = valid;

  // Role requester dari admins (sumber kebenaran), bukan sesi/body.
  let role = "guest";
  try {
    const { ambilAdmin } = require("../../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
  } catch (e) {
    console.error("[admin_tambah_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }
  if (role !== "owner") {
    console.warn("[admin_tambah_reject]", JSON.stringify({ uid: sesi.uid, alasan: "bukan_owner" }));
    return json({ ok: false, error: "Hanya owner yang dapat menambah admin." }, 403);
  }

  const { ambilAdmin, tambahAdmin } = require("../../../../lib/models/admins.js") as {
    ambilAdmin: (id: string) => Promise<unknown | null>;
    tambahAdmin: (
      id: string,
      o: { name: string; role: string; approvedBy: string; username: string | null }
    ) => Promise<Record<string, unknown>>;
  };
  const { catatPerubahanRole } = require("../../../../lib/models/adminRoleChanges.js") as {
    catatPerubahanRole: (p: Record<string, unknown>) => Promise<{ id: string }>;
  };

  // CRITICAL: tambahAdmin pakai set() tanpa merge — user yang sudah ada akan ditimpa.
  // Tolak lebih dulu supaya data lama tidak hilang.
  let sudahAda: unknown;
  try {
    sudahAda = await ambilAdmin(telegramUserId);
  } catch (e) {
    console.error("[admin_tambah_reject]", JSON.stringify({ uid: sesi.uid, alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal menambah admin." }, 500);
  }
  if (sudahAda) return json({ ok: false, error: "User sudah terdaftar sebagai admin." }, 409);

  let admin: Record<string, unknown>;
  try {
    admin = await tambahAdmin(telegramUserId, { name, role: roleBaru, approvedBy: sesi.uid, username });
  } catch (e) {
    console.error("[admin_tambah_reject]", JSON.stringify({ uid: sesi.uid, alasan: "model", pesan: String(e) }));
    return json({ ok: false, error: "Gagal menambah admin." }, 500);
  }

  // Audit. Gagal audit tidak rollback.
  let peringatanAudit = false;
  try {
    await catatPerubahanRole({
      targetUserId: telegramUserId,
      targetName: name,
      roleLama: null,
      roleBaru,
      changedBy: sesi.uid,
    });
  } catch (e) {
    console.error("[audit_write_failed]", JSON.stringify({ target: telegramUserId, pesan: String(e) }));
    peringatanAudit = true;
  }

  console.info("[admin_tambah_success]", JSON.stringify({ uid: sesi.uid, target: telegramUserId, role: roleBaru }));

  const respons: Record<string, unknown> = { ok: true, admin };
  if (peringatanAudit) respons.peringatan_audit = true;
  return json(respons, 201);
}
