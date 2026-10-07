// lib/ai/registry.js
// Daftar preset provider OpenAI-compatible.
// Setiap preset mengarah ke baseUrl, apiKeyEnv, defaultModel, alternative models.

const { buatProviderOpenAiCompat } = require("./adapters/openaiCompat");

// Preset default — bisa dioverride lewat Firestore settings
const PRESET_PROVIDER = {
  gemini: {
    // Google Gemini SDK — dipanggil lewat client.js, BUKAN fetch OpenAI-compatible.
    // `kind` menandai ini supaya balikanProvider tidak membangun adapter fetch.
    kind: "gemini",
    label: "Gemini",
    apiKeyEnv: "GEMINI_API_KEY",
  },
  groq: {
    label: "Groq",
    baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    model: process.env.GROQ_MODEL_TEXT || "openai/gpt-oss-120b",
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
    timeoutMs: 30000,
  },
  kenari: {
    label: "Kenari",
    baseUrl: process.env.KENARI_BASE_URL || "https://api.kenari.id/v1/chat/completions",
    apiKeyEnv: "KENARI_API_KEY",
    model: process.env.KENARI_MODEL_TEXT || "gpt-oss-120b",
    models: ["gpt-oss-120b", "gpt-oss-20b", "qwen-qwen3-32b"],
    timeoutMs: 30000,
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4"],
    timeoutMs: 60000,
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    apiKeyEnv: "OPENROUTER_API_KEY",
    model: "openai/gpt-oss-120b",
    models: ["openai/gpt-oss-120b", "openai/gpt-4o-mini"],
    timeoutMs: 30000,
  },
};

// PRESET_PROVIDER sudah memuat key "gemini" (placeholder), jadi cukup keys-nya.
// Sebelumnya `.concat(["gemini"])` membuat "gemini" duplikat (6 entri, bukan 5).
const PROVIDER_VALID = Object.keys(PRESET_PROVIDER);

/**
 * Balikan instance adapter untuk provider tertentu.
 * @param {object} providerConfig - config dari settings (harus punya kind: "openai" | "anthropic" | "gemini")
 * @param {object} globalSetting - setting timeoutMs dsb (optional)
 * @returns {object} { panggil(), apakahErrorBolehFallback(), label, isGemini }
 */
function balikanProvider(providerConfig, globalSetting = {}) {
  const label = providerConfig.label || providerConfig.name || "custom";

  if (providerConfig.kind === "gemini") {
    // Bukan adapter fetch: pemanggilan Gemini ditangani lib/gemini/client.js.
    // Tanda isGemini dipakai dispatcher untuk memilih jalur yang benar.
    return {
      isGemini: true,
      label,
    };
  }

  // Default: buat adapter openai-compat
  const adapter = buatProviderOpenAiCompat({
    label,
    baseUrl: providerConfig.baseUrl,
    apiKeyEnv: providerConfig.apiKeyEnv,
    model: providerConfig.model,
    models: providerConfig.models,
    timeoutMs: providerConfig.timeoutMs || globalSetting.timeoutMs || 30000,
  });

  return {
    ...adapter,
    isGemini: false,
  };
}

module.exports = { PRESET_PROVIDER, PROVIDER_VALID, balikanProvider };