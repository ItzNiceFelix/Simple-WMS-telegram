// app/api/pengaturan/ai/route.ts
// POST /api/pengaturan/ai — ubah provider AI (owner only). PRD 11.4, 24, FR-WRITE-09.
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

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

// Satu sumber: daftar provider backend (lib/ai/registry.js), bukan hardcode lokal.
const { PROVIDER_VALID } = require("../../../../lib/ai/registry.js") as {
  PROVIDER_VALID: string[];
};

export async function POST(request: Request) {
  const origin = tolakOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, origin.status);

  const token = ambilTokenDariCookie(request.headers.get("cookie"));
  const sesi = token ? verifikasiTokenSesi(token, { now: Date.now() }) : null;
  if (!sesi) {
    return json({ ok: false, error: "Sesi kedaluwarsa. Buka ulang dari Telegram." }, 401);
  }

  const batas = cekRateLimit(`ai:${sesi.uid}`, 20);
  if (!batas.ok) return json({ ok: false, error: batas.error }, batas.status);

  let body: { provider?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  const provider = typeof body.provider === "string" ? body.provider.toLowerCase() : "";
  if (!PROVIDER_VALID.includes(provider)) {
    return json({ ok: false, error: "Provider AI tidak dikenal." }, 400);
  }

  // Role dari admins (sumber kebenaran), bukan dari sesi/body.
  let role = "guest";
  try {
    const { ambilAdmin } = require("../../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<{ role?: string } | null>;
    };
    const admin = await ambilAdmin(sesi.uid);
    if (!admin) return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
    role = admin.role === "owner" ? "owner" : admin.role === "admin" ? "admin" : "guest";
  } catch (e) {
    console.error("[ai_setting_reject]", JSON.stringify({ alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }
  if (role !== "owner") {
    return json({ ok: false, error: "Hanya owner yang dapat mengubah pengaturan." }, 403);
  }

  const { simpanProviderAI } = require("../../../../lib/models/aiSettings.js") as {
    simpanProviderAI: (p: string, oleh: string) => Promise<{ pengaturan?: unknown; error?: string }>;
  };
  const hasil = await simpanProviderAI(provider, sesi.uid);
  if (hasil.error) return json({ ok: false, error: hasil.error }, 400);

  console.info("[ai_setting_success]", JSON.stringify({ uid: sesi.uid, provider }));
  return json({ ok: true, pengaturan: hasil.pengaturan });
}
