// lib/dashboard/providerAi.js
// Runtime CJS (browser-safe) untuk daftar provider AI. Satu-satunya literal di UI;
// `providerAi.ts` mengekspor ulang dengan tipe, dan test paritas me-require file ini.
// WAJIB sinkron dengan PROVIDER_VALID di lib/ai/registry.js + lib/models/aiSettings.js
// (dijaga test/providerAiParitas.test.js).
//
// @typedef {"gemini" | "groq" | "kenari" | "openai" | "openrouter"} ProviderAi
// @typedef {"Gemini" | "Groq" | "Kenari" | "OpenAI" | "OpenRouter"} LabelProviderAi

/** @type {readonly ProviderAi[]} */
const PROVIDER_AI = ["gemini", "groq", "kenari", "openai", "openrouter"];

/** @type {Record<ProviderAi, LabelProviderAi>} */
const LABEL_PROVIDER = {
  gemini: "Gemini",
  groq: "Groq",
  kenari: "Kenari",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

/**
 * @param {string} v
 * @returns {v is ProviderAi}
 */
function adalahProviderAi(v) {
  return PROVIDER_AI.includes(v);
}

module.exports = { PROVIDER_AI, LABEL_PROVIDER, adalahProviderAi };
