// lib/config/env.js
// Validasi env fail-fast per konteks. Sengaja TIDAK baca .env sendiri (tanpa dotenv):
// Vercel/GitHub Actions inject env langsung, lokal pakai `vercel dev`.
// Dipanggil di boundary (handler Vercel / main() script), bukan di dalam lib/ — biar lib/ tetap murni.

const { PRESET_PROVIDER } = require("../ai/registry");

const FIREBASE_TRIO = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];

/**
 * Soft-warn bila provider default (AI_PROVIDER_TEXT, default "groq") tidak punya API key.
 * JANGAN throw: D1 memastikan request tetap fallback ke provider lain.
 * Provider tak dikenal -> hanya warn ringan, tidak crash.
 */
function peringatkanProviderTanpaKey() {
  const nama = String(process.env.AI_PROVIDER_TEXT || "groq").toLowerCase();
  const preset = PRESET_PROVIDER[nama];
  // Satu sumber: apiKeyEnv dari registry (termasuk gemini). Tidak ada cabang hardcode.
  if (!preset || !preset.apiKeyEnv) {
    console.warn(`AI_PROVIDER_TEXT "${nama}" tidak dikenal - diabaikan.`);
    return;
  }
  if (!String(process.env[preset.apiKeyEnv] || "").trim()) {
    console.warn(
      `${preset.apiKeyEnv} belum diisi - provider ${preset.label || nama} tidak akan berfungsi (fallback provider lain tetap jalan).`
    );
  }
}

/**
 * Cek tiap nama env ada dan tidak kosong (setelah .trim()). Kumpulkan SEMUA yang hilang
 * lalu lempar SATU Error yang menyebut konteks + seluruh nama yang kurang.
 * @param {string[]} namaArray
 * @param {string} konteks label untuk pesan error, mis. "webhook"
 */
function wajibkanEnv(namaArray, konteks) {
  const hilang = namaArray.filter((nama) => !String(process.env[nama] || "").trim());
  if (hilang.length > 0) {
    throw new Error(`Env ${konteks} belum lengkap. Hilang: ${hilang.join(", ")}`);
  }
}

function validasiEnvWebhook() {
  wajibkanEnv([...FIREBASE_TRIO, "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "GEMINI_API_KEY"], "webhook");
  // Provider default boleh tanpa key (fallback tetap jalan) - peringatkan saja.
  peringatkanProviderTanpaKey();
}

function validasiEnvCronSheets() {
  wajibkanEnv(
    [...FIREBASE_TRIO, "GOOGLE_SHEETS_ID", "GOOGLE_SHEETS_CLIENT_EMAIL", "GOOGLE_SHEETS_PRIVATE_KEY"],
    "cron sync master data"
  );
}

function validasiEnvCronReminder() {
  wajibkanEnv([...FIREBASE_TRIO, "TELEGRAM_BOT_TOKEN"], "cron reminder harian");
}

function validasiEnvScript() {
  wajibkanEnv(FIREBASE_TRIO, "script");
}

module.exports = {
  wajibkanEnv,
  peringatkanProviderTanpaKey,
  validasiEnvWebhook,
  validasiEnvCronSheets,
  validasiEnvCronReminder,
  validasiEnvScript,
};
