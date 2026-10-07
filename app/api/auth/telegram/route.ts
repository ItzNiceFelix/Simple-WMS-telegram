// app/api/auth/telegram/route.ts
// POST /api/auth/telegram — verifikasi initData -> sesi cookie + Firebase Custom Token.
// PRD Bagian 11.1, 11.4, 11.5, 11.7, 11.9, 11.10.
import { createRequire } from "node:module";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

type InitDataError = Error & { status?: number };
type AdminDoc = { role?: string; name?: string | null; telegram_username?: string | null } | null;

const { verifikasiInitData } = require("../../../../lib/dashboard/auth/initData.js") as {
  verifikasiInitData: (
    initData: string,
    opsi: { botToken: string }
  ) => { authDate: number; user: { id: string; username: string | null; first_name: string | null } };
};
const {
  buatTokenSesi,
  atributCookie,
  UMUR_SESI_DETIK,
} = require("../../../../lib/dashboard/auth/sesi.js") as {
  buatTokenSesi: (a: { userId: string; role: string; authDate: number }) => string;
  atributCookie: (t: string, o: { maxAge: number }) => string;
  UMUR_SESI_DETIK: number;
};
const { tolakOrigin, cekRateLimit } = require("../../../../lib/dashboard/auth/guard.js") as {
  tolakOrigin: (r: Request) => { ok: true } | { ok: false; status: number; error: string };
  cekRateLimit: (k: string, maks: number) => { ok: true } | { ok: false; status: number; error: string };
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function ipDari(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  const origin = tolakOrigin(request);
  if (!origin.ok) {
    console.warn("[auth_fail]", JSON.stringify({ alasan: "origin", status: origin.status }));
    return json({ ok: false, error: origin.error }, origin.status);
  }

  const batas = cekRateLimit(`auth:${ipDari(request)}`, 30);
  if (!batas.ok) {
    console.warn("[auth_fail]", JSON.stringify({ alasan: "rate_limit", status: batas.status }));
    return json({ ok: false, error: batas.error }, batas.status);
  }

  let body: { initData?: unknown };
  try {
    body = (await request.json()) as { initData?: unknown };
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }

  let hasil;
  try {
    hasil = verifikasiInitData(String(body?.initData ?? ""), {
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    });
  } catch (e) {
    const err = e as InitDataError;
    const status = err.status ?? 401;
    console.warn("[auth_fail]", JSON.stringify({ alasan: err.message, status }));
    return json({ ok: false, error: err.message }, status);
  }

  // Re-validasi admin tiap tukar initData (PRD 11.7).
  let admin: AdminDoc = null;
  let isSuperAdminDariEnv: (id: string) => boolean = () => false;
  try {
    const admins = require("../../../../lib/models/admins.js") as {
      ambilAdmin: (id: string) => Promise<AdminDoc>;
      isSuperAdminDariEnv: (id: string) => boolean;
    };
    admin = await admins.ambilAdmin(hasil.user.id);
    isSuperAdminDariEnv = admins.isSuperAdminDariEnv;
  } catch (e) {
    console.error("[auth_fail]", JSON.stringify({ alasan: "firestore", pesan: String(e) }));
    return json({ ok: false, error: "Gagal memeriksa akses." }, 500);
  }

  if (!admin) {
    console.warn("[auth_fail]", JSON.stringify({ alasan: "bukan_admin", status: 403 }));
    return json({ ok: false, error: "Akses ditolak. Hubungi owner." }, 403);
  }

  const role = admin.role === "owner" || admin.role === "admin" ? admin.role : "guest";
  const superAdmin = isSuperAdminDariEnv(String(hasil.user.id)) || role === "owner";

  // Firebase Custom Token + CUSTOM CLAIMS (PRD 11.5). Kegagalan = 500 (kecuali mode mock).
  //
  // PENTING: createCustomToken(uid, claims) hanya menaruh claim di CUSTOM TOKEN, BUKAN
  // di ID token. Firestore rules membaca `request.auth.token.role` dari ID token, jadi
  // claim WAJIB di-set lewat setCustomUserClaims() juga - kalau tidak, authed() selalu
  // false dan SEMUA read client SDK ditolak (rules default-deny).
  let customToken: string | null = null;
  try {
    const { getAuth } = require("firebase-admin/auth") as {
      getAuth: () => {
        createCustomToken: (uid: string, claims: Record<string, unknown>) => Promise<string>;
        setCustomUserClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
      };
    };
    // Pastikan app firebase-admin terinisialisasi.
    require("../../../../lib/firebase.js");
    const claims = {
      admin: role === "owner" || role === "admin",
      role,
    };
    // Berurutan: claims dulu supaya ID token berikutnya (getIdToken(true) di klien)
    // sudah memuat role; custom token dibuat sesudahnya.
    await getAuth().setCustomUserClaims(hasil.user.id, claims);
    customToken = await getAuth().createCustomToken(hasil.user.id, claims);
  } catch (e) {
    console.error("[auth_fail]", JSON.stringify({ alasan: "custom_token", pesan: String(e) }));
    return json({ ok: false, error: "Gagal membuat sesi." }, 500);
  }

  const token = buatTokenSesi({
    userId: hasil.user.id,
    role,
    authDate: hasil.authDate,
  });

  const nama =
    admin.name ||
    [hasil.user.first_name].filter(Boolean).join(" ") ||
    null;

  console.info("[auth_success]", JSON.stringify({ uid: hasil.user.id, role }));

  const response = json({
    ok: true,
    user: { id: hasil.user.id, username: hasil.user.username, name: nama },
    role,
    superAdmin,
    firebaseToken: customToken,
  });
  response.headers.append("Set-Cookie", atributCookie(token, { maxAge: UMUR_SESI_DETIK }));
  return response;
}
