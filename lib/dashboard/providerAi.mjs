// lib/dashboard/providerAi.mjs
// Runtime ESM (browser-safe) untuk daftar provider AI. Satu-satunya literal di UI;
// `providerAi.d.ts` memberi tipenya, dan test paritas memuatnya via dynamic `import()`.
// WAJIB sinkron dengan PROVIDER_VALID di lib/ai/registry.js + lib/models/aiSettings.js
// (dijaga test/providerAiParitas.test.js).
//
// ESM, bukan CJS: berkas ini masuk GRAFIK KLIEN (mock.ts/real.ts -> sumber-data.tsx
// ber-"use client"), dan CJS di grafik klien membuat `next dev` gagal
// "Cannot use 'import.meta' outside a module".
//
// @typedef {"gemini" | "groq" | "kenari" | "openai" | "openrouter"} ProviderAi
// @typedef {"Gemini" | "Groq" | "Kenari" | "OpenAI" | "OpenRouter"} LabelProviderAi

/** @type {readonly ProviderAi[]} */
export const PROVIDER_AI = ["gemini", "groq", "kenari", "openai", "openrouter"];

/** @type {Record<ProviderAi, LabelProviderAi>} */
export const LABEL_PROVIDER = {
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
export function adalahProviderAi(v) {
  return PROVIDER_AI.includes(v);
}

export default { PROVIDER_AI, LABEL_PROVIDER, adalahProviderAi };
