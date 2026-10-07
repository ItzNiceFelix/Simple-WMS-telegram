// lib/dashboard/auth/guard.js
// Helper bersama route dashboard: validasi Origin (CSRF, PRD 11.10) + rate limit
// in-memory per-IP/per-user (PRD 11.9, pola lib/gemini/rateLimit.js).
"use strict";

const WINDOW_MS = 60_000;

/** Normalisasi origin: buang spasi dan trailing slash (Origin header tidak pernah punya slash). */
function normalkanOrigin(nilai) {
  return String(nilai || "")
    .trim()
    .replace(/\/+$/, "");
}

function originDiizinkan(origin) {
  const raw = process.env.DASHBOARD_ALLOWED_ORIGINS || "";
  const daftar = raw
    .split(",")
    .map((s) => normalkanOrigin(s))
    .filter(Boolean);
  if (daftar.length === 0) {
    // Belum dikonfigurasi: hanya izinkan saat bukan produksi (dev lokal).
    return process.env.NODE_ENV !== "production";
  }
  if (!origin) return false;
  return daftar.includes(normalkanOrigin(origin));
}

function tolakOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Request tanpa Origin (mis. same-origin lama/curl) -> tolak di produksi.
    if (process.env.NODE_ENV === "production") {
      return { ok: false, status: 403, error: "Origin tidak diizinkan." };
    }
    return { ok: true };
  }
  if (!originDiizinkan(origin)) {
    return { ok: false, status: 403, error: "Origin tidak diizinkan." };
  }
  return { ok: true };
}

// --- Rate limit in-memory (soft guard, per instance) ---
const _catatan = new Map();

function _bersihkan(kunci, now) {
  const arr = _catatan.get(kunci);
  if (!arr) return [];
  const segar = arr.filter((t) => now - t < WINDOW_MS);
  _catatan.set(kunci, segar);
  return segar;
}

/**
 * @returns {{ok: true} | {ok: false, status: 429, error: string}}
 */
function cekRateLimit(kunci, maksPerMenit) {
  const now = Date.now();
  const arr = _bersihkan(kunci, now);
  if (arr.length >= maksPerMenit) {
    return {
      ok: false,
      status: 429,
      error: "Terlalu banyak permintaan. Coba lagi sebentar lagi.",
    };
  }
  arr.push(now);
  _catatan.set(kunci, arr);
  return { ok: true };
}

function resetRateLimit() {
  _catatan.clear();
}

module.exports = { originDiizinkan, tolakOrigin, cekRateLimit, resetRateLimit, WINDOW_MS };
