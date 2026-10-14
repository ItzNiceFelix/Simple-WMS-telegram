// lib/ai/adapterOpenrouter.ts — Adapter metadata model OpenRouter.
// BERBEDA dari adapter OpenAI-compatible lain: GET /models OpenRouter PUBLIK
// (key opsional) dan MENGEMBALIKAN modalitas + parameter reasoning per model,
// jadi tidak perlu heuristik nama untuk provider ini.
// Dependensi: lib/ai/http.ts (timeout, retry, pesan error asli).

import { panggilJson, type HasilHttp, type HasilModel } from "./http";
import { LEVEL_3, LEVEL_4, normalkanModal } from "./kapabilitas";

const URL_MODEL = "https://openrouter.ai/api/v1/models";

export type OpsiAdapterOpenrouter = { apiKey?: string; timeoutMs?: number };

type ModelOpenrouter = {
  id?: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  supported_parameters?: unknown;
};

/** GET /models (publik) → id, label, modalitas, skema reasoning, context length. */
export async function modelOpenrouter(opsi: OpsiAdapterOpenrouter = {}): Promise<HasilHttp<HasilModel[]>> {
  const apiKey = String(opsi.apiKey ?? "").trim();
  // Key opsional: endpoint ini publik, kirim header hanya bila ada kredensial.
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const h = await panggilJson<{ data?: ModelOpenrouter[] }>(URL_MODEL, { method: "GET", headers }, { timeoutMs: opsi.timeoutMs });
  if (!h.ok) return h;

  const daftar: HasilModel[] = [];
  for (const m of h.data.data ?? []) {
    const id = String(m.id ?? "").trim();
    if (!id) continue;
    const params = Array.isArray(m.supported_parameters) ? m.supported_parameters.map((p) => String(p)) : [];
    const adaEffort = params.includes("reasoning_effort");
    const adaReasoning = params.includes("reasoning");
    // effort+reasoning → keempat level; effort saja → tiga level; reasoning saja → on/off.
    const reasoningSkema = adaEffort ? (adaReasoning ? "level_4" : "level_3") : adaReasoning ? "bool" : "";
    const reasoningPilihan = reasoningSkema === "level_4" ? [...LEVEL_4] : reasoningSkema === "level_3" ? [...LEVEL_3] : [];
    daftar.push({
      id,
      label: m.name,
      modalMasuk: normalkanModal(m.architecture?.input_modalities),
      modalKeluar: normalkanModal(m.architecture?.output_modalities),
      reasoningSkema,
      reasoningPilihan,
      reasoningHilir: params.includes("include_reasoning") || adaReasoning,
      contextLength: typeof m.context_length === "number" ? m.context_length : undefined,
    });
  }
  return { ok: true, data: daftar, latencyMs: h.latencyMs };
}
