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
//
// Kosakata katalog provider (`max`, `xhigh`, `none`, `default`) BUKAN kosakata HTTP API.
// Semua nilai dinormalisasi ke `minimal|low|medium|high` sebelum dikirim.

import type { ProviderNama } from "@/lib/ai/provider";

/** Parameter reasoning yang siap ditempel ke body permintaan provider. */
export type ParameterReasoning = Record<string, unknown>;

/**
 * Tingkat reasoning yang diakui HTTP API provider. Inilah satu-satunya kosakata
 * yang boleh keluar dari berkas ini.
 */
const TINGKAT_SAH = ["minimal", "low", "medium", "high"];

/**
 * KENAPA normalisasi ini WAJIB ADA (keluhan utama pemilik repo: "reasoning selalu timeout"):
 * katalog provider menyimpan `reasoning_pilihan` dengan kosakata INTERNAL mereka sendiri —
 * `low,high,max` (kenari), `high,xhigh` (kenari), `none,low,high` (groq). Tapi HTTP API
 * provider hanya menerima `minimal|low|medium|high`; `max`/`xhigh`/`none` BUKAN nilai sah.
 * Dulu nilai itu diteruskan VERBATIM (`reasoning_effort: "max"`), sehingga provider menganggap
 * tingkatnya tidak dikenal lalu berpikir jauh lebih lama / menolak → percobaan melewati
 * timeout teks dan user SELALU melihat "timeout" setiap memakai level reasoning.
 *
 * Pemetaan: kosakata internal → kosakata HTTP API.
 *   max, xhigh          → high   (API tidak punya tingkat di atas high)
 *   none                → minimal
 *   on/true/1           → high ; off/false/0 → minimal (skema 'bool' cuma hidup/mati)
 *   minimal/low/high    → tetap
 *   medium              → tetap
 *   nilai tak dikenal   → medium (netral; JANGAN lempar — lebih baik satu permintaan
 *                         berjalan dengan tingkat netral daripada seluruh analisa gagal)
 */
export function normalkanTingkatReasoning(reasoning: string | undefined | null): string {
  const nilai = String(reasoning ?? "").trim().toLowerCase();
  if (nilai === "on" || nilai === "true" || nilai === "1") return "high";
  if (nilai === "off" || nilai === "false" || nilai === "0") return "minimal";
  if (nilai === "max" || nilai === "xhigh") return "high";
  if (nilai === "none") return "minimal";
  return TINGKAT_SAH.includes(nilai) ? nilai : "medium";
}

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
  // Kosong = jangan kirim parameter sama sekali, biar provider pakai defaultnya sendiri.
  if (!String(reasoning ?? "").trim()) return {};
  const hilir = opsi.hilir === true;
  // SATU pintu keluar untuk semua provider: nilai apa pun dinormalisasi ke kosakata
  // sah `minimal|low|medium|high` sebelum ditempel ke body. Lihat alasannya di
  // normalkanTingkatReasoning() — `max`/`xhigh` dari katalog provider bukan nilai sah.
  const tingkat = normalkanTingkatReasoning(reasoning);

  if (provider === "gemini") {
    // Gemini memakai thinkingConfig di dalam generationConfig.
    // Catatan: `raw` tidak berlaku di sini; Gemini memakai includeThoughts.
    const cfg: Record<string, unknown> = { thinkingLevel: tingkat };
    if (hilir) cfg.includeThoughts = true;
    return { thinkingConfig: cfg };
  }

  if (provider === "openrouter") {
    // OpenRouter memakai reasoning.effort dengan kosakata yang sama (minimal..high).
    const out: ParameterReasoning = { reasoning: { effort: tingkat } };
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
