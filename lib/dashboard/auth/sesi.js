// lib/dashboard/auth/sesi.js
// Sesi cookie HttpOnly bertanda tangan (HMAC) untuk dashboard.
// PRD 11.2: umur = auth_date + 60 menit; TIDAK diperpanjang sliding.
"use strict";

const crypto = require("node:crypto");

const NAMA_COOKIE = "dat_sesi";
const UMUR_SESI_DETIK = 3600; // sama dengan freshness initData (60 menit)

function rahasiaSesi() {
  return (
    process.env.DASHBOARD_SESSION_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ""
  );
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function tandaTangan(payloadB64) {
  return crypto
    .createHmac("sha256", rahasiaSesi())
    .update(payloadB64)
    .digest("base64url");
}

/**
 * Buat token sesi: base64url(payload).signature
 * payload = { uid, role, exp }
 */
function buatTokenSesi({ userId, role, authDate }) {
  const exp = Math.floor(authDate) + UMUR_SESI_DETIK; // detik UNIX
  const payload = { uid: String(userId), role, exp };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${tandaTangan(payloadB64)}`;
}

/**
 * Verifikasi token sesi. Mengembalikan payload atau null bila tidak valid/kedaluwarsa.
 */
function verifikasiTokenSesi(token, { now = Date.now() } = {}) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const sigHitung = tandaTangan(payloadB64);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(sigHitung, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.uid !== "string" || typeof payload.role !== "string") return null;
  if (!Number.isInteger(payload.exp)) return null;
  if (Math.floor(now / 1000) >= payload.exp) return null;

  return payload;
}

/** Atribut cookie sesuai PRD 11.1 langkah 10. */
function atributCookie(token, { maxAge }) {
  const bagian = [
    `${NAMA_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  return bagian.join("; ");
}

function cookiePenghapus() {
  return `${NAMA_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Baca token sesi dari header Cookie request. */
function ambilTokenDariCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const bagian of cookieHeader.split(";")) {
    const [nama, ...sisa] = bagian.trim().split("=");
    if (nama === NAMA_COOKIE) return sisa.join("=");
  }
  return null;
}

module.exports = {
  NAMA_COOKIE,
  UMUR_SESI_DETIK,
  buatTokenSesi,
  verifikasiTokenSesi,
  atributCookie,
  cookiePenghapus,
  ambilTokenDariCookie,
};
