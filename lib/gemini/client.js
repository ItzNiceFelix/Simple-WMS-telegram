// lib/gemini/client.js
// Init Gemini SDK (singleton) — model Flash, free tier
// Dispatcher sekarang di lib/ai/index.js (generateContentDenganFallback)

const { GoogleGenerativeAI } = require("@google/generative-ai");

// JANGAN throw di top-level: `require` modul ini harus selalu berhasil agar dispatcher
// (lib/ai/index.js) bisa memperlakukan key absen sebagai kegagalan yang layak fallback,
// bukan crash saat import. Error baru dilempar saat benar-benar dipakai.
let genAI = null;
function ambilGenAI() {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error("GEMINI_API_KEY belum di-set di environment variable");
    err.perluFallbackProvider = true;
    throw err;
  }
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI;
}

const NAMA_MODEL_UTAMA = "gemini-flash-latest";
const NAMA_MODEL_CADANGAN = "gemini-flash-lite-latest";
const BATAS_WAKTU_GEMINI_MS = Number(process.env.GEMINI_TIMEOUT_MS) > 0 ? Number(process.env.GEMINI_TIMEOUT_MS) : 120000;
const BATAS_TOTAL_GEMINI_MS = Number(process.env.GEMINI_TOTAL_TIMEOUT_MS) > 0 ? Number(process.env.GEMINI_TOTAL_TIMEOUT_MS) : 240000;

function ambilModel({ tools, systemInstruction, nama = NAMA_MODEL_UTAMA, timeout = BATAS_WAKTU_GEMINI_MS } = {}) {
  return ambilGenAI().getGenerativeModel({
    model: nama,
    systemInstruction,
    tools: tools && tools.length ? [{ functionDeclarations: tools }] : undefined,
  }, { timeout });
}

function apakahErrorBolehFallback(err) {
  const status = err?.status || err?.response?.status;
  if (status === 429 || status === 503) return true;
  if (err?.name === "AbortError") return true;
  const pesan = String(err?.message || "").toLowerCase();
  return (
    pesan.includes("429") ||
    pesan.includes("503") ||
    pesan.includes("quota") ||
    pesan.includes("rate limit") ||
    pesan.includes("service unavailable") ||
    pesan.includes("overloaded") ||
    pesan.includes("high demand") ||
    pesan.includes("aborted") ||
    pesan.includes("timed out") ||
    pesan.includes("timeout")
  );
}

async function generateContentDenganGeminiSaja({ tools, systemInstruction, contents, pengaturan }) {
  const batasWaktu = pengaturan?.geminiTimeoutMs || BATAS_WAKTU_GEMINI_MS;
  const batasTotal = pengaturan?.totalTimeoutMs || BATAS_TOTAL_GEMINI_MS;
  const batasAkhir = Date.now() + batasTotal;

  try {
    const modelUtama = ambilModel({ tools, systemInstruction, nama: NAMA_MODEL_UTAMA, timeout: Math.min(batasWaktu, batasTotal) });
    return await modelUtama.generateContent({ contents });
  } catch (err) {
    if (!apakahErrorBolehFallback(err)) throw err;
    const jenisGangguan = /aborted|timed out|timeout/i.test(String(err?.message || "")) ? "timeout" : err?.status || "unknown";
    console.error(`Gagal di ${NAMA_MODEL_UTAMA} (${jenisGangguan}), fallback ke ${NAMA_MODEL_CADANGAN}.`);

    const waktuTersisa = Math.max(1000, batasAkhir - Date.now());
    const modelCadangan = ambilModel({ tools, systemInstruction, nama: NAMA_MODEL_CADANGAN, timeout: Math.min(batasWaktu, waktuTersisa) });
    return await modelCadangan.generateContent({ contents });
  }
}

// Export dispatcher utama dari lib/ai/index.js
const { generateContentDenganFallback: dispatcherFallback, apakahErrorBolehFallback: globalFallbackDetector } = require("../ai/index");

module.exports = {
  ambilGenAI,
  ambilModel,
  generateContentDenganGeminiSaja,
  // Re-export dispatcher utama (alias untuk backward compat)
  generateContentDenganFallback: dispatcherFallback,
  apakahErrorBolehFallback: globalFallbackDetector,
  NAMA_MODEL_UTAMA,
  NAMA_MODEL_CADANGAN,
};