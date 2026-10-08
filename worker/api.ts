// worker/api.ts — Endpoint /api/* Simple-WMS-telegram (Fase 0: health + auth).
// Auth mengikuti PRD F1: login telegramId+password, set password (via sesi,
// dipanggil dari Profile TMA), lupa password via kode verifikasi yang dikirim
// bot Telegram. Semua query prepared + .bind() (skill cloudflare-d1).
import {
  ambilPengguna,
  ambilTokenDariCookie,
  atributCookieSesi,
  bootstrapOwner,
  buatSesi,
  cabutSesi,
  catatLogin,
  cookieHapusSesi,
  loginTerkunci,
  setPassword,
  terbitkanKode,
  verifikasiKode,
  verifikasiPassword,
  verifikasiSesi,
} from "./auth";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  SUPER_ADMIN_ID?: string;
};

function json(body: unknown, status = 200, cookie?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

async function bacaBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return typeof b === "object" && b !== null ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Kirim pesan via Bot API (pola scaFlow callBot: lempar bila gagal). */
async function kirimViaBot(env: Env, chatId: string, teks: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum diset.");
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: teks }),
  });
  if (!res.ok) throw new Error(`sendMessage gagal: ${res.status}`);
}

function ipDanUa(request: Request): { ip: string; ua: string } {
  const fwd = request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip");
  return {
    ip: fwd ? fwd.split(",")[0].trim() : "unknown",
    ua: request.headers.get("user-agent")?.slice(0, 200) ?? "unknown",
  };
}

const TG_ID_RE = /^[0-9]{5,20}$/;

export async function tanganiApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const https = url.protocol === "https:";
  if (!path.startsWith("/api/")) return null;

  // GET /api/health — tanpa auth
  if (path === "/api/health" && request.method === "GET") {
    let dbOk = false;
    try {
      await env.DB.prepare("SELECT 1").first();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return json({ ok: true, db: dbOk ? "up" : "down", fase: 0 });
  }

  // POST /api/setup/owner — hanya bila users kosong (sekali pakai)
  if (path === "/api/setup/owner" && request.method === "POST") {
    const body = await bacaBody(request);
    const tgId = String(body.tg_id ?? "");
    const nama = String(body.display_name ?? "").slice(0, 80) || "Owner";
    const password = String(body.password ?? "");
    if (!TG_ID_RE.test(tgId)) return json({ ok: false, error: "telegramId tidak valid." }, 400);
    const { ip, ua } = ipDanUa(request);
    try {
      const user = await bootstrapOwner(env.DB, tgId, nama, password);
      const { token } = await buatSesi(env.DB, user.id, ip, ua);
      return json(
        { ok: true, user: { id: user.tg_id, name: user.display_name }, role: user.role },
        200,
        atributCookieSesi(token, https)
      );
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : "Gagal setup." }, 400);
    }
  }

  // POST /api/auth/login { tg_id, password }
  if (path === "/api/auth/login" && request.method === "POST") {
    const body = await bacaBody(request);
    const tgId = String(body.tg_id ?? "");
    const password = String(body.password ?? "");
    const { ip, ua } = ipDanUa(request);
    if (!TG_ID_RE.test(tgId) || !password) {
      await catatLogin(env.DB, tgId || "?", false, ip, ua, "input");
      return json({ ok: false, error: "telegramId atau password salah." }, 401);
    }
    if (await loginTerkunci(env.DB, tgId, Math.floor(Date.now() / 1000))) {
      await catatLogin(env.DB, tgId, false, ip, ua, "terkunci");
      return json({ ok: false, error: "Terlalu banyak gagal. Coba lagi 15 menit." }, 429);
    }
    const user = await ambilPengguna(env.DB, tgId);
    const cocok = user?.password_hash ? await verifikasiPassword(password, user.password_hash) : false;
    if (!user || !cocok) {
      await catatLogin(env.DB, tgId, false, ip, ua, "kredensial");
      return json({ ok: false, error: "telegramId atau password salah." }, 401);
    }
    await catatLogin(env.DB, tgId, true, ip, ua, null);
    const { token } = await buatSesi(env.DB, user.id, ip, ua);
    return json(
      { ok: true, user: { id: user.tg_id, username: user.username, name: user.display_name }, role: user.role },
      200,
      atributCookieSesi(token, https)
    );
  }

  // POST /api/auth/logout
  if (path === "/api/auth/logout" && request.method === "POST") {
    const token = ambilTokenDariCookie(request.headers.get("cookie"));
    if (token) await cabutSesi(env.DB, token);
    return json({ ok: true }, 200, cookieHapusSesi(https));
  }

  // GET /api/me — profil + role + scope (butuh sesi)
  if (path === "/api/me" && request.method === "GET") {
    const token = ambilTokenDariCookie(request.headers.get("cookie"));
    const user = token ? await verifikasiSesi(env.DB, token) : null;
    if (!user) return json({ ok: false, error: "Belum login." }, 401);
    return json({
      ok: true,
      user: { id: user.tg_id, username: user.username, name: user.display_name },
      role: user.role,
      scope_gudang: user.scope_gudang,
      password_set: user.password_hash !== null,
    });
  }

  // POST /api/auth/set-password { password_baru } — butuh sesi (dipanggil dari Profile TMA)
  if (path === "/api/auth/set-password" && request.method === "POST") {
    const token = ambilTokenDariCookie(request.headers.get("cookie"));
    const user = token ? await verifikasiSesi(env.DB, token) : null;
    if (!user) return json({ ok: false, error: "Belum login." }, 401);
    const body = await bacaBody(request);
    try {
      await setPassword(env.DB, user.id, String(body.password_baru ?? ""));
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : "Gagal." }, 400);
    }
  }

  // POST /api/auth/minta-kode { tg_id } — kirim kode reset via bot
  if (path === "/api/auth/minta-kode" && request.method === "POST") {
    const body = await bacaBody(request);
    const tgId = String(body.tg_id ?? "");
    if (!TG_ID_RE.test(tgId)) return json({ ok: false, error: "telegramId tidak valid." }, 400);
    const user = await ambilPengguna(env.DB, tgId);
    // Selalu balas sukses generik agar tg_id tidak bisa di-enumerasi; kode hanya
    // diterbitkan bila user ada.
    if (user) {
      const { kode } = await terbitkanKode(env.DB, tgId, "reset");
      try {
        await kirimViaBot(env, tgId, `Kode reset password Simple-WMS: ${kode}\nBerlaku 10 menit. Jangan berikan ke siapa pun.`);
      } catch (e) {
        return json(
          { ok: false, error: e instanceof Error ? e.message : "Gagal kirim via bot." },
          503
        );
      }
    }
    return json({ ok: true, pesan: "Bila telegramId terdaftar, kode dikirim via bot." });
  }

  // POST /api/auth/reset-password { tg_id, kode, password_baru }
  if (path === "/api/auth/reset-password" && request.method === "POST") {
    const body = await bacaBody(request);
    const tgId = String(body.tg_id ?? "");
    const kode = String(body.kode ?? "");
    if (!TG_ID_RE.test(tgId) || !/^[0-9]{6}$/.test(kode)) {
      return json({ ok: false, error: "Data tidak valid." }, 400);
    }
    const user = await ambilPengguna(env.DB, tgId);
    if (!user || !(await verifikasiKode(env.DB, tgId, "reset", kode))) {
      return json({ ok: false, error: "Kode salah atau kedaluwarsa." }, 401);
    }
    try {
      await setPassword(env.DB, user.id, String(body.password_baru ?? ""));
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : "Gagal." }, 400);
    }
  }

  // Path /api/* lain (milik Next: /api/stok, /api/produk, ...) → null agar
  // diteruskan ke handler OpenNext, BUKAN 404.
  return null;
}
