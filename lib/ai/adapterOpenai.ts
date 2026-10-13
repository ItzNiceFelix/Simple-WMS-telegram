// lib/ai/adapterOpenai.ts — Adapter untuk provider ber-API "OpenAI-compatible".
// Dipakai oleh: openai, groq, openrouter, dan kenari (base URL custom via
// KENARI_BASE_URL, fallback https://api.kenari.ai/v1).
// Dependensi: lib/ai/http.ts (timeout, retry, pesan error asli), Web FormData/fetch.
// Semua kegagalan diteruskan apa adanya — pemanggil (provider.ts) yang memutuskan
// pindah model/provider.

import { panggilJson, pesanServer, type BagianChat, type HasilHttp, type HasilModel, type JawabanChat, type PermintaanChat } from "./http";

export type OpsiAdapter = { baseUrl: string; apiKey: string; timeoutMs?: number };

/** Base URL bawaan provider. Kenari tidak di sini — base URL-nya dari env. */
export const BASE_OPENAI: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/** Kenari tanpa env: pakai domain resmi. */
export function baseKenari(env?: { KENARI_BASE_URL?: string } | null | object): string {
  const k = env as { KENARI_BASE_URL?: string } | null | undefined;
  return (k?.KENARI_BASE_URL ?? "").trim().replace(/\/+$/, "") || "https://api.kenari.ai/v1";
}

type BagianIsiOpenai = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type IsiOpenai = string | BagianIsiOpenai[];

type PesanOpenai = { role: string; content: IsiOpenai | null; tool_call_id?: string; name?: string; tool_calls?: unknown[] };

/** BagianChat → format OpenAI. String bila tanpa gambar (lebih hemat token & kompatibel). */
export function kePesanOpenai(b: BagianChat): PesanOpenai {
  if (!b.gambar || b.gambar.length === 0) {
    const pesan: PesanOpenai = { role: b.role, content: b.teks };
    if (b.role === "tool") {
      pesan.tool_call_id = b.toolCallId ?? "";
      pesan.name = b.namaTool ?? "";
    }
    return pesan;
  }
  const daftar: BagianIsiOpenai[] = [];
  if (b.teks) daftar.push({ type: "text", text: b.teks });
  for (const g of b.gambar) daftar.push({ type: "image_url", image_url: { url: `data:${g.mime};base64,${g.base64}` } });
  return { role: b.role, content: daftar };
}

type ResponsChat = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** POST {baseUrl}/chat/completions. Tool call dikembalikan dengan arguments STRING apa adanya. */
export async function chatOpenai(opsi: OpsiAdapter, permintaan: PermintaanChat): Promise<HasilHttp<JawabanChat>> {
  const body: Record<string, unknown> = {
    model: permintaan.model,
    messages: permintaan.pesan.map(kePesanOpenai),
  };
  if (permintaan.tool && permintaan.tool.length > 0) body.tools = permintaan.tool;
  if (permintaan.maksToken !== undefined) body.max_tokens = permintaan.maksToken;
  if (permintaan.suhu !== undefined) body.temperature = permintaan.suhu;
  if (permintaan.jsonMode) body.response_format = { type: "json_object" };

  const h = await panggilJson<ResponsChat>(
    `${opsi.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opsi.apiKey}` },
      body: JSON.stringify(body),
    },
    { timeoutMs: opsi.timeoutMs }
  );
  if (!h.ok) return h;

  const pesan = h.data.choices?.[0]?.message;
  if (!pesan) {
    return {
      ok: false,
      status: 502,
      error: `Provider tidak mengirim pilihan jawaban: ${JSON.stringify(h.data).slice(0, 300)}`,
      latencyMs: h.latencyMs,
    };
  }
  const toolCall: { id: string; nama: string; argumen: string }[] = [];
  for (const t of pesan.tool_calls ?? []) {
    toolCall.push({ id: t.id ?? "", nama: t.function?.name ?? "", argumen: t.function?.arguments ?? "" });
  }
  return {
    ok: true,
    latencyMs: h.latencyMs,
    data: {
      teks: pesan.content ?? "",
      toolCall: toolCall.length > 0 ? toolCall : undefined,
      tokenMasuk: h.data.usage?.prompt_tokens,
      tokenKeluar: h.data.usage?.completion_tokens,
      raw: h.data,
    },
  };
}

/** GET {baseUrl}/models → daftar id model. */
export async function modelOpenai(opsi: OpsiAdapter): Promise<HasilHttp<HasilModel[]>> {
  const h = await panggilJson<{ data?: { id?: string }[] }>(
    `${opsi.baseUrl.replace(/\/+$/, "")}/models`,
    { method: "GET", headers: { Authorization: `Bearer ${opsi.apiKey}` } },
    { timeoutMs: opsi.timeoutMs }
  );
  if (!h.ok) return h;
  const daftar = (h.data.data ?? [])
    .map((m) => String(m.id ?? "").trim())
    .filter(Boolean)
    .map((id) => ({ id }));
  return { ok: true, data: daftar, latencyMs: h.latencyMs };
}

/** POST /images/generations, atau /images/edits (multipart) bila ada referensi. */
export async function gambarOpenai(
  opsi: OpsiAdapter,
  minta: { model: string; prompt: string; referensi?: { mime: string; base64: string }[] }
): Promise<HasilHttp<{ base64: string; mime: string }>> {
  const base = opsi.baseUrl.replace(/\/+$/, "");
  const referensi = minta.referensi ?? [];

  if (referensi.length === 0) {
    const h = await panggilJson<{ data?: { b64_json?: string; url?: string }[]; error?: unknown }>(
      `${base}/images/generations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opsi.apiKey}` },
        body: JSON.stringify({ model: minta.model, prompt: minta.prompt, n: 1 }),
      },
      { timeoutMs: opsi.timeoutMs }
    );
    if (!h.ok) return h;
    const b64 = h.data.data?.[0]?.b64_json;
    if (!b64) {
      return {
        ok: false,
        status: 502,
        error: `Provider tidak mengembalikan gambar: ${h.data.data?.[0]?.url ?? JSON.stringify(h.data).slice(0, 300)}`,
        latencyMs: h.latencyMs,
      };
    }
    return { ok: true, data: { base64: b64, mime: "image/png" }, latencyMs: h.latencyMs };
  }

  // Multipart: provider OpenAI-compatible menerima berkas "image" + field prompt/model.
  const form = new FormData();
  form.set("model", minta.model);
  form.set("prompt", minta.prompt);
  for (const [i, r] of referensi.entries()) {
    const biner = atob(r.base64);
    const bytes = new Uint8Array(new ArrayBuffer(biner.length));
    for (let j = 0; j < biner.length; j++) bytes[j] = biner.charCodeAt(j);
    const ext = r.mime.split("/")[1] ?? "png";
    form.append(referensi.length > 1 ? `image[${i}]` : "image", new Blob([bytes], { type: r.mime }), `referensi-${i + 1}.${ext}`);
  }
  const h = await panggilJson<{ data?: { b64_json?: string; url?: string }[]; error?: unknown; message?: unknown }>(
    `${base}/images/edits`,
    { method: "POST", headers: { Authorization: `Bearer ${opsi.apiKey}` }, body: form },
    { timeoutMs: opsi.timeoutMs }
  );
  if (!h.ok) return h;
  const b64 = h.data.data?.[0]?.b64_json;
  if (!b64) {
    const sisa = pesanServer(h.data);
    return { ok: false, status: 502, error: `Provider tidak mengembalikan gambar: ${sisa.slice(0, 300)}`, latencyMs: h.latencyMs };
  }
  return { ok: true, data: { base64: b64, mime: "image/png" }, latencyMs: h.latencyMs };
}
