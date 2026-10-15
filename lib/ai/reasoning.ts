// lib/ai/reasoning.ts — Terjemah satu nilai reasoning ke parameter asli tiap provider.
// Nilai reasoning disimpan sebagai string sederhana ('low', 'high', ...). Tiap provider
// menamai parameternya sendiri, jadi pemetaannya terpusat di sini — bukan di adapter,
// bukan di UI. Adapter hanya memanggil `terapkanReasoning()`.
//
// Skema sah (dari riset dokumentasi resmi, lihat lib/ai/kapabilitas.ts):
//   Groq       : reasoning_effort = none|default|low|medium|high (+ reasoning_format "parsed")
//   Gemini 3+  : thinkingConfig.thinkingLevel = minimal|low|medium|high
//                (khusus varian pro: HANYA low|high)
//   Gemini 2.5 : thinkingConfig.thinkingBudget = ANGKA token (bukan level)
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
 * Perkiraan anggaran pikiran (`thinkingBudget`, satuan token) untuk seri Gemini 2.5.
 * PERKIRAAN WAJAR, BUKAN angka resmi: seri 2.5 hanya menerima `thinkingBudget` ANGKA
 * (lihat `terapkanReasoning`), dan harga per tingkat tidak dipublikasikan seragam untuk
 * semua varian. Bila model Gemini 2.5 baru muncul atau dokumentasinya berubah, ANGKA INI
 * HARUS DIVERIFIKASI ke dokumentasi resmi Google — nilai di luar rentang model berbalas 400.
 */
const BUDGET_2_5: Record<string, number> = { minimal: 128, low: 1024, medium: 8192, high: 24576 };

/**
 * Ubah satu nilai reasoning menjadi parameter provider. Kembalikan objek KOSONG
 * bila reasoning kosong/tidak dikenal — pemanggil TIDAK boleh menambahkan
 * parameter sama sekali, biar provider memakai defaultnya sendiri.
 *
 * `opsi.model` = nama model yang akan dipanggil, dipakai provider yang parameternya
 * BERGANTUNG VERSI MODEL (Gemini). Opsional: pemanggil yang tidak mengisinya tetap
 * mendapat perilaku lama.
 */
export function terapkanReasoning(
  provider: ProviderNama | string,
  reasoning: string | undefined | null,
  opsi: { hilir?: boolean; jsonMode?: boolean; adaTool?: boolean; model?: string } = {}
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
    //
    // Parameternya BERGANTUNG VERSI MODEL (dokumentasi resmi Google, dibaca 2026-10-15):
    // Gemini 3 ke atas memakai `thinkingLevel` (minimal|low|medium|high), sedangkan seri 2.5
    // memakai `thinkingBudget` berupa ANGKA. Mengirim bentuk yang salah berbalas 400, jadi
    // reasoning mati total di jalur itu — dan katalog produksi memakai KEDUA versi
    // (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3-flash-preview`, varian `*-latest`).
    // Nama model kosong/tak dikenal (mis. jalur gambar) memakai perilaku lama `thinkingLevel`
    // supaya tidak ada pemanggil yang rusak karena perubahan ini.
    const model = String(opsi.model ?? "").trim().toLowerCase();
    // Varian `gemini-3-*-pro` hanya menerima `low`/`high` (minimal/medium dikirim = 400),
    // jadi tingkat netral hasil normalisasi (`minimal` dari `none`, `medium` dari nilai tak
    // dikenal) dipetakan ke tetangga terdekatnya. Gemini 3 non-pro dan nama model
    // kosong/tak dikenal memakai tingkat apa adanya (perilaku lama).
    const pro3 = model.includes("gemini-3") && model.includes("pro");
    const level = pro3 ? (tingkat === "medium" || tingkat === "high" ? "high" : "low") : tingkat;
    const cfg: Record<string, unknown> = model.includes("gemini-2.5")
      ? { thinkingBudget: BUDGET_2_5[tingkat] }
      : { thinkingLevel: level };
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
    // Groq: reasoning dikembalikan lewat field TERSENDIRI (`reasoning`) memakai
    // reasoning_format "parsed".
    // KENAPA BUKAN "raw": format `raw` menaruh teks pikiran DI DALAM `content` dengan tag
    // ` thinking`, sedangkan parser kita membaca `delta.content` sebagai narasi user — jadi
    // `raw` akan MENCAMPUR pikiran model ke jawaban. "parsed" memisahkannya ke field
    // sendiri, dan aman juga saat jsonMode/tool (raw memang terlarang di dua mode itu).
    const out: ParameterReasoning = { reasoning_effort: tingkat };
    if (hilir) out.reasoning_format = "parsed";
    return out;
  }

  // OpenAI dan provider OpenAI-compatible lain (kenari).
  return { reasoning_effort: tingkat };
}
