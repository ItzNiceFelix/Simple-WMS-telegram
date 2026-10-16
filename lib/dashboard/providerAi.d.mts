// Type declaration untuk providerAi.mjs (ESM) supaya import TS dapat tipe nyata.
// Ekstensi .d.mts WAJIB: ia memasangkan tipe ke providerAi.mjs.
export type ProviderAi = "gemini" | "groq" | "kenari" | "openai" | "openrouter";
export const PROVIDER_AI: readonly ProviderAi[];
export const LABEL_PROVIDER: Record<ProviderAi, string>;
export function adalahProviderAi(v: unknown): v is ProviderAi;