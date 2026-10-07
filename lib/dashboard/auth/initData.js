// lib/dashboard/auth/initData.js
// Verifikasi Telegram WebApp initData (HMAC-SHA256) sesuai spesifikasi Telegram.
// PRD dashboard Bagian 11.1 langkah 1-8. CommonJS agar bisa dipakai route Next dan node:test.
"use strict";

const crypto = require("node:crypto");

const BATAS_UMUR_DETIK = 3600; // 60 menit (PRD 11.2)
const TOLERANSI_MASA_DEPAN_DETIK = 60;

/**
 * Error dengan kode HTTP agar route bisa memetakan ke status yang tepat.
 */
class InitDataError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "InitDataError";
    this.status = status;
  }
}

/**
 * Susun data_check_string: semua param kecuali hash, urut abjad key ASCII, "key=value" digabung "\n".
 */
function susunDataCheckString(params) {
  const entries = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    entries.push([key, value]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join("\n");
}

function hitungSecretKey(botToken) {
  return crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
}

function hitungHash(dataCheckString, botToken) {
  const secret = hitungSecretKey(botToken);
  return crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

/**
 * Bandingkan hash waktu-konstan. Panjang beda => 401 (bukan 500).
 */
function bandingkanHash(hashDiterima, hashHitung) {
  const a = String(hashDiterima || "").toLowerCase();
  const b = String(hashHitung || "").toLowerCase();
  if (!a || a.length !== b.length) {
    throw new InitDataError("initData tidak valid", 401);
  }
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    throw new InitDataError("initData tidak valid", 401);
  }
}

/**
 * Verifikasi initData mentah. Mengembalikan objek user + auth_date.
 * Melempar InitDataError dengan status 400/401 bila gagal (PRD 11.1).
 */
function verifikasiInitData(initData, { botToken, now = Date.now() } = {}) {
  if (typeof initData !== "string" || initData.length === 0) {
    throw new InitDataError("initData wajib diisi", 400);
  }
  if (!botToken) {
    throw new InitDataError("Konfigurasi server tidak lengkap", 500);
  }

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    throw new InitDataError("initData tidak valid", 401);
  }

  const hash = params.get("hash");
  if (!hash) {
    throw new InitDataError("initData tidak valid", 400);
  }

  const dataCheckString = susunDataCheckString(params);
  const hashHitung = hitungHash(dataCheckString, botToken);
  bandingkanHash(hash, hashHitung);

  // auth_date wajib integer finite (review B2).
  const authDateRaw = params.get("auth_date");
  const authDateNum = Number(authDateRaw);
  if (!authDateRaw || !Number.isInteger(authDateNum)) {
    throw new InitDataError("initData tidak valid", 401);
  }
  const nowDetik = Math.floor(now / 1000);
  if (nowDetik - authDateNum > BATAS_UMUR_DETIK) {
    throw new InitDataError("initData kedaluwarsa", 401);
  }
  if (authDateNum > nowDetik + TOLERANSI_MASA_DEPAN_DETIK) {
    throw new InitDataError("initData tidak valid", 401);
  }

  // Parse user dengan aman (review B1).
  const userRaw = params.get("user");
  if (!userRaw) {
    throw new InitDataError("initData tidak valid", 401);
  }
  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new InitDataError("initData tidak valid", 401);
  }
  if (typeof user !== "object" || user === null || Array.isArray(user)) {
    throw new InitDataError("initData tidak valid", 401);
  }
  if (user.id === undefined || user.id === null || typeof user.id === "object") {
    throw new InitDataError("initData tidak valid", 401);
  }

  return {
    authDate: authDateNum,
    user: {
      id: String(user.id),
      username: typeof user.username === "string" ? user.username : null,
      first_name: typeof user.first_name === "string" ? user.first_name : null,
      last_name: typeof user.last_name === "string" ? user.last_name : null,
    },
  };
}

/**
 * Helper untuk tes/produksi: susun initData bertanda tangan valid.
 */
function buatInitData({ botToken, user, authDate, extra = {} }) {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAHdF6IQAAAAAN0XohDhrOrc");
  params.set("user", JSON.stringify(user));
  for (const [k, v] of Object.entries(extra || {})) params.set(k, String(v));
  const dataCheckString = susunDataCheckString(params);
  params.set("hash", hitungHash(dataCheckString, botToken));
  return params.toString();
}

module.exports = {
  InitDataError,
  BATAS_UMUR_DETIK,
  susunDataCheckString,
  hitungHash,
  verifikasiInitData,
  buatInitData,
};
