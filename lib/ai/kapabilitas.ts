// lib/ai/kapabilitas.ts — Kapabilitas model: modalitas masuk/keluar + skema reasoning.
// Dua sumber data: (1) API provider (hanya OpenRouter & sebagian Gemini yang memberi),
// (2) HEURISTIK dari nama model. Heuristik adalah TERKAAN — jangan dianggap fakta;
// selalu ditandai sumber='heuristik' di DB supaya user bisa koreksi manual.
// Dependensi: tidak ada (murni fungsi).

export type Modalitas = { masuk: string[]; keluar: string[] };

export type SkemaReasoning = "" | "level_4" | "level_3" | "effort_openai" | "bool";

export const LEVEL_4 = ["minimal", "low", "medium", "high"];
export const LEVEL_3 = ["low", "medium", "high"];

const MODAL_SAH = ["text", "image", "audio", "video", "file", "pdf"];

/**
 * Normalisasi input modalitas: terima array atau string CSV apa adanya dari provider.
 * lowercase → trim → buang kosong/duplikat → hanya nilai yang dikenal.
 */
export function normalkanModal(v: unknown): string[] {
  const bahan = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const hasil: string[] = [];
  for (const x of bahan) {
    const t = String(x ?? "").trim().toLowerCase();
    if (!t || !MODAL_SAH.includes(t) || hasil.includes(t)) continue;
    hasil.push(t);
  }
  return hasil;
}

/**
 * TEBAKAN modalitas dari nama model. Hanya dipakai bila provider tidak memberi metadata.
 * Aturan sengaja konservatif: tanpa indikasi apa pun → text→text.
 */
export function tebakModalDariNama(provider: string, modelId: string): Modalitas {
  const n = `${provider}/${modelId}`.toLowerCase();
  const hit = (kunci: string[]): boolean => kunci.some((k) => n.includes(k));
  const keluar = hit(["image", "dall-e", "dalle", "flux", "banana", "imagen", "stable-diffusion", "sd3", "sdxl", "gpt-image"])
    ? ["image"]
    : ["text"];
  const masuk: string[] = ["text"];
  if (hit(["vision", "-vl", "_vl", "multimodal", "omni", "banana", "imagen", "gpt-image", "dall-e", "dalle", "stable-diffusion"])) masuk.push("image");
  if (hit(["whisper", "audio", "tts", "-asr"])) masuk.push("audio");
  return { masuk, keluar };
}

/**
 * TEBAKAN skema reasoning dari nama model. Basis: riset empiris per provider
 * (Gemini: 'thinking' cuma boolean tanpa level; Groq/OpenAI: /models kosong).
 * openrouter sengaja '' — di sana data reasoning datang dari API, bukan tebakan.
 */
export function tebakSkemaReasoning(provider: string, modelId: string): { skema: SkemaReasoning; pilihan: string[] } {
  const p = String(provider ?? "").trim().toLowerCase();
  const id = String(modelId ?? "").trim().toLowerCase();
  const hit = (kunci: string[]): boolean => kunci.some((k) => id.includes(k));

  if (p === "groq") {
    // Qwen 3.8 27B: satu-satunya yang menerima none/default selain low/medium/high.
    if (hit(["qwen3.8", "qwen/qwen3.8"])) return { skema: "level_4", pilihan: ["none", "default", ...LEVEL_3] };
    if (hit(["gpt-oss"])) return { skema: "level_3", pilihan: [...LEVEL_3] };
    return { skema: "", pilihan: [] };
  }

  if (p === "gemini") {
    // Flash-Lite Image hanya menerima minimal|high; Flash-Lite teks menerima keempatnya.
    if (hit(["flash-lite", "nano-banana"])) {
      return hit(["image", "banana"])
        ? { skema: "level_4", pilihan: ["minimal", "high"] }
        : { skema: "level_4", pilihan: [...LEVEL_4] };
    }
    if (hit(["argon"])) return { skema: "level_3", pilihan: [...LEVEL_3] };
    // Gemini 3.8 Flash menolak 'minimal'; sisanya menerima keempat level.
    if (hit(["gemini-3"])) {
      return hit(["3.8"]) ? { skema: "level_4", pilihan: [...LEVEL_3] } : { skema: "level_4", pilihan: [...LEVEL_4] };
    }
    return { skema: "", pilihan: [] };
  }

  if (p === "openai") {
    // Model gambar OpenAI tidak punya reasoning.
    if (hit(["dall-e", "dalle", "gpt-image"])) return { skema: "", pilihan: [] };
    if (hit(["gpt-5", "o1", "o3", "o4"])) return { skema: "effort_openai", pilihan: [...LEVEL_4] };
    return { skema: "", pilihan: [] };
  }

  return { skema: "", pilihan: [] };
}

/**
 * Aturan gabung: kalau data modal dari provider tidak ada (dua-duanya kosong), pakai tebakan.
 * Pemanggil yang menentukan `sumber`; di sini hanya memutuskan sumber datanya.
 */
export function gabungModal(dataProvider: Partial<Modalitas> | null | undefined, tebakan: Modalitas): Modalitas {
  if (dataProvider?.masuk?.length || dataProvider?.keluar?.length) {
    return { masuk: dataProvider.masuk ?? tebakan.masuk, keluar: dataProvider.keluar ?? tebakan.keluar };
  }
  return tebakan;
}
