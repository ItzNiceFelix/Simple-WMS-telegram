// Pengaturan provider AI yang dapat diubah tanpa redeploy.
const { db } = require("../firebase");

const KOLEKSI = "system_settings";
const ID_DOKUMEN = "ai";
const MASA_CACHE_MS = 30000;

// Provider valid — didefinisikan di sini, sinkron dengan PRESET_PROVIDER di lib/ai/registry.js
const PROVIDER_VALID = ["gemini", "groq", "kenari", "openai", "openrouter"];

let cache = null;
let cacheBerakhirPada = 0;

function pengaturanDefault() {
  const providerEnv = String(process.env.AI_PROVIDER_TEXT || "groq").toLowerCase();
  return {
    textProvider: PROVIDER_VALID.includes(providerEnv) ? providerEnv : "groq",
    geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) > 0 ? Number(process.env.GEMINI_TIMEOUT_MS) : 120000,
    totalTimeoutMs: Number(process.env.GEMINI_TOTAL_TIMEOUT_MS) > 0 ? Number(process.env.GEMINI_TOTAL_TIMEOUT_MS) : 240000,
  };
}

function normalisasiPengaturan(data = {}) {
  const dasar = pengaturanDefault();
  const textProvider = String(data.textProvider || dasar.textProvider).toLowerCase();
  return {
    ...dasar,
    ...data,
    textProvider: PROVIDER_VALID.includes(textProvider) ? textProvider : dasar.textProvider,
    geminiTimeoutMs: Number(data.geminiTimeoutMs || dasar.geminiTimeoutMs),
    totalTimeoutMs: Number(data.totalTimeoutMs || dasar.totalTimeoutMs),
  };
}

async function ambilPengaturanAI({ paksa = false } = {}) {
  if (!paksa && cache && Date.now() < cacheBerakhirPada) return cache;

  const snapshot = await db.collection(KOLEKSI).doc(ID_DOKUMEN).get();
  cache = normalisasiPengaturan(snapshot.exists ? snapshot.data() : {});
  cacheBerakhirPada = Date.now() + MASA_CACHE_MS;
  return cache;
}

async function simpanProviderAI(provider, diubahOleh) {
  const providerNormal = String(provider || "").toLowerCase();
  if (!PROVIDER_VALID.includes(providerNormal)) {
    return { error: "Provider AI tidak dikenal." };
  }

  const payload = {
    textProvider: providerNormal,
    updatedAt: new Date(),
    updatedBy: String(diubahOleh),
  };
  await db.collection(KOLEKSI).doc(ID_DOKUMEN).set(payload, { merge: true });
  cache = normalisasiPengaturan({ ...(cache || {}), ...payload });
  cacheBerakhirPada = Date.now() + MASA_CACHE_MS;
  return { pengaturan: cache };
}

module.exports = { ambilPengaturanAI, simpanProviderAI, PROVIDER_VALID };