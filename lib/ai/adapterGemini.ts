// lib/ai/adapterGemini.ts — Adapter REST langsung ke Google Generative Language API.
// SENGAJA tanpa SDK: Worker/route Next.js cukup fetch, dan tidak menambah bundle.
// Dependensi: lib/ai/http.ts (timeout, retry, pesan error asli).
// Basis: https://generativelanguage.googleapis.com/v1beta (api key sebagai query `key`).

import { panggilJson, type BagianChat, type HasilHttp, type HasilModel, type JawabanChat, type PermintaanChat } from "./http";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type OpsiGemini = { apiKey: string; baseUrl?: string; timeoutMs?: number };

type BagianGemini = { text: string } | { inline_data: { mime_type: string; data: string } };
type IsiGemini = { role: "user" | "model"; parts: BagianGemini[] };

/** BagianChat → contents Gemini. `system` TIDAK boleh masuk contents (lihat pemisahan di bawah). */
function keIsiGemini(b: BagianChat): IsiGemini | null {
  if (b.role === "system") return null;
  const parts: BagianGemini[] = [];
  if (b.teks) parts.push({ text: b.teks });
  for (const g of b.gambar ?? []) parts.push({ inline_data: { mime_type: g.mime, data: g.base64 } });
  return { role: b.role === "assistant" ? "model" : "user", parts };
}

/** Pisahkan prompt sistem: Gemini memakai systemInstruction, bukan rolesystem di contents. */
function pisahSistem(pesan: BagianChat[]): { sistem: string; isi: IsiGemini[] } {
  const sistem: string[] = [];
  const isi: IsiGemini[] = [];
  for (const p of pesan) {
    if (p.role === "system") {
      if (p.teks) sistem.push(p.teks);
      continue;
    }
    const bagian = keIsiGemini(p);
    if (bagian) isi.push(bagian);
  }
  return { sistem: sistem.join("\n\n"), isi };
}

type ResponsGemini = {
  candidates?: {
    content?: { parts?: ({ text?: string } | { functionCall?: { name?: string; args?: unknown } })[] };
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: unknown;
};

/** Baca candidates[0].content.parts → teks + functionCall (argumen jadi STRING JSON). */
function bacaKandidat(d: ResponsGemini): JawabanChat | null {
  const parts = d.candidates?.[0]?.content?.parts;
  if (!parts) return null;
  let teks = "";
  const toolCall: { id: string; nama: string; argumen: string }[] = [];
  for (const p of parts) {
    if ("text" in p && typeof p.text === "string") teks += p.text;
    if ("functionCall" in p && p.functionCall) {
      const fc = p.functionCall;
      toolCall.push({ id: fc.name ?? "", nama: fc.name ?? "", argumen: JSON.stringify(fc.args ?? {}) });
    }
  }
  return {
    teks,
    toolCall: toolCall.length > 0 ? toolCall : undefined,
    tokenMasuk: d.usageMetadata?.promptTokenCount,
    tokenKeluar: d.usageMetadata?.candidatesTokenCount,
    raw: d,
  };
}

/** POST {base}/models/{model}:generateContent?key=… */
export async function chatGemini(opsi: OpsiGemini, permintaan: PermintaanChat): Promise<HasilHttp<JawabanChat>> {
  const { sistem, isi } = pisahSistem(permintaan.pesan);
  const body: Record<string, unknown> = { contents: isi };
  if (sistem) body.systemInstruction = { parts: [{ text: sistem }] };
  if (permintaan.tool && permintaan.tool.length > 0) body.tools = [{ functionDeclarations: permintaan.tool }];
  const generasi: Record<string, unknown> = {};
  if (permintaan.maksToken !== undefined) generasi.maxOutputTokens = permintaan.maksToken;
  if (permintaan.suhu !== undefined) generasi.temperature = permintaan.suhu;
  if (permintaan.jsonMode) generasi.responseMimeType = "application/json";
  if (Object.keys(generasi).length > 0) body.generationConfig = generasi;

  const base = (opsi.baseUrl ?? BASE).replace(/\/+$/, "");
  const h = await panggilJson<ResponsGemini>(
    `${base}/models/${encodeURIComponent(permintaan.model)}:generateContent?key=${encodeURIComponent(opsi.apiKey)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    { timeoutMs: opsi.timeoutMs }
  );
  if (!h.ok) return h;

  const jawaban = bacaKandidat(h.data);
  if (!jawaban) {
    return {
      ok: false,
      status: 502,
      error: `Gemini tidak mengembalikan kandidat: ${JSON.stringify(h.data).slice(0, 300)}`,
      latencyMs: h.latencyMs,
    };
  }
  return { ok: true, data: jawaban, latencyMs: h.latencyMs };
}

/** POST {base}/models/{model}:generateContent untuk gambar; baca inlineData dari parts. */
export async function gambarGemini(
  opsi: OpsiGemini,
  minta: { model: string; prompt: string; referensi?: { mime: string; base64: string }[] }
): Promise<HasilHttp<{ base64: string; mime: string }>> {
  const parts: BagianGemini[] = [{ text: minta.prompt }];
  for (const r of minta.referensi ?? []) parts.push({ inline_data: { mime_type: r.mime, data: r.base64 } });
  const base = (opsi.baseUrl ?? BASE).replace(/\/+$/, "");
  const h = await panggilJson<{
    candidates?: { content?: { parts?: ({ inlineData?: { mimeType?: string; data?: string } } | { text?: string })[] } }[];
    error?: unknown;
  }>(
    `${base}/models/${encodeURIComponent(minta.model)}:generateContent?key=${encodeURIComponent(opsi.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }] }),
    },
    { timeoutMs: opsi.timeoutMs }
  );
  if (!h.ok) return h;

  const balik = h.data.candidates?.[0]?.content?.parts ?? [];
  for (const p of balik) {
    const inline = "inlineData" in p ? p.inlineData : undefined;
    if (inline?.data) return { ok: true, data: { base64: inline.data, mime: inline.mimeType ?? "image/png" }, latencyMs: h.latencyMs };
  }
  return {
    ok: false,
    status: 502,
    error: `Gemini tidak mengembalikan gambar: ${JSON.stringify(h.data).slice(0, 300)}`,
    latencyMs: h.latencyMs,
  };
}

/** GET {base}/models?key=… → hanya model yang bisa generateContent, prefix `models/` dibuang. */
export async function modelGemini(opsi: OpsiGemini): Promise<HasilHttp<HasilModel[]>> {
  const base = (opsi.baseUrl ?? BASE).replace(/\/+$/, "");
  const h = await panggilJson<{
    models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    error?: unknown;
  }>(`${base}/models?key=${encodeURIComponent(opsi.apiKey)}&pageSize=1000`, { method: "GET" }, { timeoutMs: opsi.timeoutMs });
  if (!h.ok) return h;
  const daftar: HasilModel[] = [];
  for (const m of h.data.models ?? []) {
    if (!(m.supportedGenerationMethods ?? []).includes("generateContent")) continue;
    const id = String(m.name ?? "").replace(/^models\//, "").trim();
    if (!id) continue;
    daftar.push({ id, label: m.displayName });
  }
  return { ok: true, data: daftar, latencyMs: h.latencyMs };
}
