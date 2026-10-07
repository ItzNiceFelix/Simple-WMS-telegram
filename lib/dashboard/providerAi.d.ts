// Type declaration untuk providerAi.js (CJS) supaya import TS dapat tipe nyata.
export type ProviderAi = "gemini" | "groq" | "kenari" | "openai" | "openrouter";
export const PROVIDER_AI: readonly ProviderAi[];
export const LABEL_PROVIDER: Record<ProviderAi, string>;
export function adalahProviderAi(v: unknown): v is ProviderAi;