// lib/ai/index.js
// Dispatcher utama untuk generateContent. Menyeleksi provider berdasarkan settings,
// mengatur fallback chain, dan mengembalikan bentuk Gemini ke chatHandler.js.

const { ambilPengaturanAI } = require("../models/aiSettings");
const { PRESET_PROVIDER, balikanProvider, PROVIDER_VALID } = require("./registry");

// Helper error detection yang reusable (sama di openaiCompat.js & gemini client.js)
function apakahErrorBolehFallback(err) {
  // D1: config tak lengkap (mis. API key absen) = layak fallback, bukan fatal.
  if (err?.perluFallbackProvider) return true;
  const status = err?.status;
  if (status === 429 || status === 503) return true;
  if (err?.isNetworkError) return true;
  const pesan = String(err?.message || "").toLowerCase();
  return (
    pesan.includes("429") ||
    pesan.includes("503") ||
    pesan.includes("rate limit") ||
    pesan.includes("service unavailable") ||
    pesan.includes("overloaded") ||
    pesan.includes("failed to fetch") ||
    pesan.includes("network")
  );
}

/**
 * Generate content utama — pilih provider, atur timeout total, fallback chain.
 * @param {object} opts
 * @param {object[]} opts.tools - function declarations
 * @param {string} opts.systemInstruction
 * @param {object[]} opts.contents - gaya Gemini {role, parts:[{text}|{functionCall}|{functionResponse}]}
 */
async function generateContentDenganFallback({ tools, systemInstruction, contents }) {
  const pengaturan = await ambilPengaturanAI();
  const textProvider = (pengaturan.textProvider || "groq").toLowerCase();

  // Build provider config: dari preset + override Firestore
  const preset = { ...PRESET_PROVIDER[textProvider] };
  const providerConfig = {
    ...preset,
    ...(pengaturan[textProvider] || {}), // override lewat Firestore
  };

  // Jalankan satu provider: gemini lewat SDK, lainnya lewat adapter fetch.
  async function jalankanProvider(nama, konfigurasi, batas) {
    const adapter = balikanProvider(konfigurasi, batas);
    if (adapter.isGemini) {
      const { generateContentDenganGeminiSaja } = require("../gemini/client");
      return generateContentDenganGeminiSaja({ tools, systemInstruction, contents, pengaturan: batas });
    }
    return adapter.panggilOpenAiCompat({ tools, systemInstruction, contents });
  }

  const labelDari = (nama) => PRESET_PROVIDER[nama]?.label || nama;

  // Provider utama (textProvider)
  if (providerConfig.kind === "gemini" || textProvider === "gemini") {
    return jalankanProvider(textProvider, providerConfig, pengaturan);
  }

  // Timeout total untuk semua percobaan provider (pakai batasTotal dari settings)
  const batasAkhir = Date.now() + (pengaturan.totalTimeoutMs || 240000);

  try {
    return await jalankanProvider(textProvider, providerConfig, pengaturan);
  } catch (err) {
    if (!apakahErrorBolehFallback(err)) throw err;

    console.error(`${labelDari(textProvider)} gagal (${err.message}), coba provider lain...`);

    // Chain fallback: HORMATI urutan pengaturan.fallbackChain (termasuk "gemini").
    const chain = pengaturan.fallbackChain || ["gemini", "groq"];
    const urutan = chain.filter((p) => p !== textProvider);
    const kegagalan = [`${labelDari(textProvider)}: ${err.message}`];

    for (const prov of urutan) {
      const sisaWaktu = Math.max(1000, batasAkhir - Date.now());
      if (sisaWaktu <= 0) {
        console.error(`Timeout total tercapai, fallback gagal ke ${labelDari(prov)}`);
        kegagalan.push(`LEWAT batas waktu total sebelum ${labelDari(prov)}`);
        break;
      }

      const nextConfig = { ...PRESET_PROVIDER[prov], ...(pengaturan[prov] || {}) };
      try {
        return await jalankanProvider(prov, nextConfig, { ...pengaturan, totalTimeoutMs: sisaWaktu });
      } catch (err2) {
        if (!apakahErrorBolehFallback(err2)) throw err2;
        console.error(`${labelDari(prov)} juga gagal (${err2.message})`);
        kegagalan.push(`${labelDari(prov)}: ${err2.message}`);
      }
    }

    // Jaring terakhir: Gemini langsung (perilaku lama), kalau belum dicoba di chain.
    if (!urutan.includes("gemini") && textProvider !== "gemini") {
      try {
        return await jalankanProvider("gemini", { ...PRESET_PROVIDER.gemini }, pengaturan);
      } catch (err3) {
        kegagalan.push(`Gemini: ${err3.message}`);
      }
    }

    // Semua provider gagal → error akhir yang menyebut SEMUA penyebab (tidak menyesatkan).
    const errAkhir = new Error(
      `Semua provider AI gagal. Rincian - ${kegagalan.join(" | ")}`
    );
    errAkhir.peringatanProvider = true;
    throw errAkhir;
  }
}

module.exports = {
  generateContentDenganFallback,
  apakahErrorBolehFallback,
  PROVIDER_VALID,
};