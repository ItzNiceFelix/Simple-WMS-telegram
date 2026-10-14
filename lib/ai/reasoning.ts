// lib/ai/reasoning.ts — Terjemah satu nilai reasoning ke parameter asli tiap provider.
// Nilai reasoning disimpan sebagai string sederhana ('low', 'high', ...). Tiap provider
// menamai parameternya sendiri, jadi pemetaannya terpusat di sini — bukan di adapter,
// bukan di UI. Adapter hanya memanggil `terapkanReasoning()`.
//
// Skema sah (dari riset dokumentasi resmi, lihat lib/ai/kapabilitas.ts):
//   Groq       : reasoning_effort = none|default|low|medium|high
//   Gemini     : thinkingConfig.thinkingLevel = minimal|low|medium|high
//   OpenRouter : reasoning: { effort } + include_reasoning
//   OpenAI     : reasoning_effort = minimal|low|medium|high

import type { ProviderNama } from "@/lib/ai/provider";

/** Parameter reasoning yang siap ditempel ke body permintaan provider. */
export type ParameterReasoning = Record<string, unknown>;

/**
 * Ubah satu nilai reasoning menjadi parameter provider. Kembalikan objek KOSONG
 * bila reasoning kosong/tidak dikenal — pemanggil TIDAK boleh menambahkan
 * parameter sama sekali, biar provider memakai defaultnya sendiri.
 */
export function terapkanReasoning(
  provider: ProviderNama | string,
  reasoning: string | undefined | null,
  opsi: { hilir?: boolean; jsonMode?: boolean; adaTool?: boolean } = {}
): ParameterReasoning {
  const nilai = String(reasoning ?? "").trim().toLowerCase();
  if (!nilai) return {};
  const hilir = opsi.hilir === true;
  // Skema 'bool' hanya punya hidup/mati. Petakan ke nilai netral tiap provider
  // supaya model seperti gemini-3-pro-image tetap dapat parameter yang sah.
  const on = nilai === "on" || nilai === "true" || nilai === "1";
  const off = nilai === "off" || nilai === "false" || nilai === "0";
  const bool = on || off;
  const tingkat = on ? "high" : off ? "minimal" : nilai;

  if (provider === "gemini") {
    // Gemini memakai thinkingConfig di dalam generationConfig.
    // Catatan: `raw` tidak berlaku di sini; Gemini memakai includeThoughts.
    const cfg: Record<string, unknown> = { thinkingLevel: tingkat };
    if (hilir) cfg.includeThoughts = true;
    return { thinkingConfig: cfg };
  }

  if (provider === "openrouter") {
    const out: ParameterReasoning = { reasoning: { effort: bool ? (on ? "high" : "low") : nilai } };
    if (hilir) out.include_reasoning = true;
    return out;
  }

  if (provider === "groq") {
    // Groq: reasoning_format dan include_reasoning SALING EKSKLUSIF.
    // Dengan tool calling / JSON mode, reasoning_format TIDAK BOLEH 'raw' (400).
    const out: ParameterReasoning = { reasoning_effort: tingkat };
    if (hilir) {
      if (opsi.jsonMode || opsi.adaTool) out.reasoning_format = "parsed";
      else out.reasoning_format = "raw";
    }
    return out;
  }

  // OpenAI dan provider OpenAI-compatible lain (kenari).
  return { reasoning_effort: tingkat };
}
