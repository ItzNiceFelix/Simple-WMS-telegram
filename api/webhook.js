// api/webhook.js
// Entry point Vercel Serverless Function — menerima update dari Telegram Bot API.
// URL ini yang didaftarkan sebagai webhook via BotFather / setWebhook.

const { routePesan } = require("../lib/router/routePesan");
const { waitUntil } = require("@vercel/functions");
const { validasiEnvWebhook } = require("../lib/config/env");

// Cek header rahasia Telegram (secret_token yang di-set saat setWebhook) supaya endpoint
// ini tidak bisa dipanggil sembarangan orang yang tahu URL-nya — bukan cuma andalkan
// "URL-nya susah ditebak".
function apakahRequestValid(req) {
  const secretDariEnv = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secretDariEnv) {
    // Belum di-set — jangan block, tapi ini seharusnya diisi sebelum production.
    console.warn(
      "TELEGRAM_WEBHOOK_SECRET belum diisi di env — webhook belum divalidasi secret-nya."
    );
    return true;
  }
  const secretDariHeader = req.headers["x-telegram-bot-api-secret-token"];
  return secretDariHeader === secretDariEnv;
}

module.exports = async function handler(req, res) {
  // Validasi env di dalam handler (bukan top-level) supaya deploy salah-konfigurasi
  // balikin 500 rapi, bukan bikin function gagal cold start.
  try {
    validasiEnvWebhook();
  } catch (error) {
    console.error("Validasi env webhook gagal:", error.message);
    res.status(500).json({ ok: false, error: "Konfigurasi server tidak lengkap" });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!apakahRequestValid(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  // Telegram harus segera menerima 200. waitUntil menjaga proses bot tetap berjalan
  // setelah response dikirim tanpa membuat webhook menunggu AI/Firestore/Telegram.
  waitUntil(
    routePesan(req.body).catch((error) => {
      console.error("Error tak terduga di webhook handler:", error);
    })
  );
  res.status(200).json({ ok: true });
};
