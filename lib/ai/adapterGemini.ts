// lib/ai/adapterGemini.ts — Adapter REST langsung ke Google Generative Language API.
// SENGAJA tanpa SDK: Worker/route Next.js cukup fetch, dan tidak menambah bundle.
// Dependensi: lib/ai/http.ts (timeout, retry, pesan error asli).
// Basis: https://generativelanguage.googleapis.com/v1beta (api key sebagai query `key`).

import { panggilJson, type BagianChat, type HasilHttp, type HasilModel, type JawabanChat, type PermintaanChat } from "./http";
import { terapkanReasoning } from "./reasoning";
import type { MintaStream, PotonganStream } from "./stream";

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

/**
 * SpesifikasiTool internal (`{nama, deskripsi, parameter}`) → format Gemini
 * (`{name, description, parameters}`).
 *
 * MASALAH YANG DIPERBAIKI: sebelumnya dikirim APA ADANYA, sehingga Gemini menerima
 * field `nama`/`deskripsi`/`parameter` yang tidak dikenal dan tool-nya tidak berfungsi.
 */
function keToolGemini(t: unknown): Record<string, unknown> {
  const s = t as { nama?: string; deskripsi?: string; parameter?: Record<string, unknown> };
  return {
    name: String(s.nama ?? ""),
    description: String(s.deskripsi ?? ""),
    parameters: s.parameter ?? { type: "object", properties: {} },
  };
}

/**
 * Body permintaan Gemini dari `PermintaanChat` — SATU pembangun untuk jalur non-stream
 * (`chatGemini`) dan streaming (`streamGemini`), supaya keduanya tidak bisa menyimpang.
 *
 * Reasoning ikut di sini: sebelumnya `chatGemini` mengabaikannya sama sekali (padahal
 * `gambarGemini` di berkas yang sama sudah memanggil `terapkanReasoning`), sehingga
 * setelan reasoning user tidak pernah sampai ke model teks Gemini.
 */
function bangunBody(permintaan: PermintaanChat): Record<string, unknown> {
  const { sistem, isi } = pisahSistem(permintaan.pesan);
  const body: Record<string, unknown> = { contents: isi };
  if (sistem) body.systemInstruction = { parts: [{ text: sistem }] };
  if (permintaan.tool && permintaan.tool.length > 0) body.tools = [{ functionDeclarations: permintaan.tool.map(keToolGemini) }];
  const generasi: Record<string, unknown> = {
    ...terapkanReasoning("gemini", permintaan.reasoning, { hilir: permintaan.reasoningHilir }),
  };
  if (permintaan.maksToken !== undefined) generasi.maxOutputTokens = permintaan.maksToken;
  if (permintaan.suhu !== undefined) generasi.temperature = permintaan.suhu;
  if (permintaan.jsonMode) generasi.responseMimeType = "application/json";
  if (Object.keys(generasi).length > 0) body.generationConfig = generasi;
  return body;
}

/** POST {base}/models/{model}:generateContent?key=… */
export async function chatGemini(opsi: OpsiGemini, permintaan: PermintaanChat): Promise<HasilHttp<JawabanChat>> {
  const body = bangunBody(permintaan);

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

/**
 * Baca satu baris `data: {...}` SSE Gemini dan kembalikan potongan teksnya.
 *
 * Bentuk SSE Gemini BEDA dari OpenAI-compatible: teks ada di
 * `candidates[0].content.parts[].text` (bukan `choices[0].delta.content`), dan satu
 * kandidat bisa membawa beberapa part. Bentuk lain — part tanpa `text`, event yang
 * hanya berisi `usageMetadata`, JSON cacat — DIABAIKAN tanpa melempar: satu event
 * asing tidak boleh menggagalkan seluruh jawaban (sama seperti lib/ai/stream.ts).
 */
function potonganDariBarisGemini(baris: string): PotonganStream | null {
  const data = baris.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  let v: ResponsGemini;
  try {
    v = JSON.parse(data) as ResponsGemini;
  } catch {
    return null;
  }
  const potong: PotonganStream = { delta: "" };
  for (const p of v.candidates?.[0]?.content?.parts ?? []) {
    if ("text" in p && typeof p.text === "string") potong.delta += p.text;
  }
  // `usageMetadata` bisa datang di potongan mana pun, bukan hanya yang terakhir.
  if (v.usageMetadata?.promptTokenCount !== undefined) potong.tokenMasuk = v.usageMetadata.promptTokenCount;
  if (v.usageMetadata?.candidatesTokenCount !== undefined) potong.tokenKeluar = v.usageMetadata.candidatesTokenCount;
  return potong.delta || potong.tokenMasuk !== undefined || potong.tokenKeluar !== undefined ? potong : null;
}

/**
 * POST {base}/models/{model}:streamGenerateContent?alt=sse&key=…
 *
 * KENAPA ADA: `panggilTeksStream` (provider.ts) dulu MELEWATI gemini dengan alasan
 * "jalur streaming belum tersedia", sehingga kredensial yang sehat tidak pernah
 * dicoba dan user hanya melihat "tidak ada provider". streamJson TIDAK dipakai di
 * sini karena ia membaca bentuk SSE OpenAI (`choices[0].delta.content`); Gemini
 * memakai bentuknya sendiri, jadi parsing-nya ditangani adapter ini.
 *
 * SEMUA kegagalan dikembalikan sebagai `{ ok:false, error }` — tidak dilempar —
 * supaya pemanggil bisa pindah kandidat berikutnya. Retry sengaja TIDAK ada (sama
 * seperti streamJson): badan respons sudah mulai terkirim ke user, jadi mengulang
 * hanya akan menggandakan teks yang sudah tampil.
 */
export async function streamGemini(
  minta: OpsiGemini & MintaStream
): Promise<{ ok: true; iter: AsyncGenerator<PotonganStream>; batalkan: () => void } | { ok: false; error: string; status: number }> {
  const idleMs = minta.timeoutMs && minta.timeoutMs > 0 ? minta.timeoutMs : 35000;
  const totalMs = minta.totalMs && minta.totalMs > 0 ? minta.totalMs : idleMs;
  const ac = new AbortController();
  const batalkan = (): void => ac.abort();
  let masukMs = 0;
  let keluarMs = 0;

  // Body dari pembangun yang SAMA dengan chatGemini → reasoning (thinkingConfig),
  // tools, dan systemInstruction pasti ikut di jalur stream juga.
  const body = bangunBody({
    model: minta.model,
    pesan: minta.pesan,
    tool: minta.tool,
    maksToken: minta.maksToken,
    reasoning: minta.reasoning,
    reasoningHilir: minta.reasoningHilir,
  });

  let res: Response;
  try {
    res = await fetch(
      `${(minta.baseUrl || BASE).replace(/\/+$/, "")}/models/${encodeURIComponent(minta.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(minta.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: ac.signal,
      }
    );
  } catch (e) {
    return { ok: false, status: 0, error: `Gagal menghubungi provider: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Bukan 2xx: body dibaca sebagai teks dan dilaporkan apa adanya (status + potongan
  // body), TIDAK dilempar — pemanggil yang memutuskan pindah kandidat.
  if (!res.ok) {
    const teks = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: `Provider menolak (HTTP ${res.status}): ${teks.slice(0, 300) || "(body kosong)"}` };
  }
  if (!res.body) return { ok: false, status: 502, error: "Provider tidak mengirim badan respons streaming." };

  async function* jalan(): AsyncGenerator<PotonganStream> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let habis = false;
    try {
      while (!habis) {
        const baca = reader.read();
        // Timer ganda: `idle` untuk jeda antar-potongan (model berpikir), `total`
        // sebagai pagar terakhir supaya koneksi menggantung tidak menahan request.
        // Keduanya WAJIB dibersihkan setelah balapan selesai: tanpa `clearTimeout`, tiap
        // potongan meninggalkan dua timer yang tetap hidup sampai waktunya habis, sehingga
        // proses (mis. uji) ikut tertahan menunggu event loop kosong.
        let tIdle: ReturnType<typeof setTimeout> | undefined;
        let tTotal: ReturnType<typeof setTimeout> | undefined;
        let hasil: { jenis: "baca"; r: ReadableStreamReadResult<Uint8Array> } | { jenis: "idle" } | { jenis: "total" };
        try {
          hasil = await Promise.race([
            baca.then((r) => ({ jenis: "baca" as const, r })),
            new Promise<{ jenis: "idle" }>((r) => {
              tIdle = setTimeout(() => r({ jenis: "idle" }), idleMs);
            }),
            new Promise<{ jenis: "total" }>((r) => {
              tTotal = setTimeout(() => r({ jenis: "total" }), totalMs);
            }),
          ]);
        } finally {
          clearTimeout(tIdle);
          clearTimeout(tTotal);
        }
        if (hasil.jenis !== "baca") {
          batalkan();
          throw new Error(hasil.jenis === "idle" ? `Timeout provider setelah ${idleMs}ms tanpa potongan.` : `Timeout total ${totalMs}ms.`);
        }
        if (hasil.r.done) break;
        buffer += decoder.decode(hasil.r.value, { stream: true });
        // SSE memisah event dengan baris kosong; `\r\n` dinormalkan dulu karena
        // sebagian proxy memakai CRLF dan tanpa ini event tidak pernah terpisah.
        buffer = buffer.replace(/\r\n/g, "\n");
        const bagian = buffer.split("\n\n");
        buffer = bagian.pop() ?? "";
        for (const satu of bagian) {
          for (const baris of satu.split("\n")) {
            if (!baris.startsWith("data:")) continue;
            if (baris.slice(5).trim() === "[DONE]") {
              habis = true;
              continue;
            }
            const potong = potonganDariBarisGemini(baris);
            if (!potong) continue;
            if (potong.tokenMasuk !== undefined) masukMs = potong.tokenMasuk;
            if (potong.tokenKeluar !== undefined) keluarMs = potong.tokenKeluar;
            if (potong.delta) yield { delta: potong.delta };
          }
        }
      }
    } finally {
      reader.releaseLock();
      if (masukMs > 0 || keluarMs > 0) yield { delta: "", tokenMasuk: masukMs, tokenKeluar: keluarMs };
    }
  }

  return { ok: true, iter: jalan(), batalkan };
}

/** POST {base}/models/{model}:generateContent untuk gambar; baca inlineData dari parts. */
export async function gambarGemini(
  opsi: OpsiGemini,
  minta: { model: string; prompt: string; referensi?: { mime: string; base64: string }[]; reasoning?: string; aspekRasio?: string }
): Promise<HasilHttp<{ base64: string; mime: string }>> {
  const parts: BagianGemini[] = [{ text: minta.prompt }];
  for (const r of minta.referensi ?? []) parts.push({ inline_data: { mime_type: r.mime, data: r.base64 } });
  const base = (opsi.baseUrl ?? BASE).replace(/\/+$/, "");
  const body: Record<string, unknown> = { contents: [{ role: "user", parts }] };
  // Reasoning model gambar (mis. Gemini 3.1 Flash Lite Image): thinkingLevel minimal|high.
  // Kosong = jangan kirim, biar provider pakai defaultnya.
  const paramReasoning = terapkanReasoning("gemini", minta.reasoning);
  const generasi: Record<string, unknown> = { ...paramReasoning };
  // Rasio gambar: Gemini memakai imageConfig.aspectRatio.
  if (minta.aspekRasio) generasi.imageConfig = { aspectRatio: minta.aspekRasio };
  if (Object.keys(generasi).length > 0) body.generationConfig = generasi;
  const h = await panggilJson<{
    candidates?: { content?: { parts?: ({ inlineData?: { mimeType?: string; data?: string } } | { text?: string })[] } }[];
    error?: unknown;
  }>(
    `${base}/models/${encodeURIComponent(minta.model)}:generateContent?key=${encodeURIComponent(opsi.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

/**
 * GET {base}/models?key=… → hanya model yang bisa generateContent, prefix `models/` dibuang.
 * Gemini TIDAK memberi modalitas — modalMasuk/modalKeluar sengaja dibiarkan undefined
 * (heuristik di lib/ai/kapabilitas.ts yang mengisi saat disimpan).
 */
export async function modelGemini(opsi: OpsiGemini): Promise<HasilHttp<HasilModel[]>> {
  const base = (opsi.baseUrl ?? BASE).replace(/\/+$/, "");
  const h = await panggilJson<{
    models?: {
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
      thinking?: boolean;
      inputTokenLimit?: number;
      outputTokenLimit?: number;
    }[];
    error?: unknown;
  }>(`${base}/models?key=${encodeURIComponent(opsi.apiKey)}&pageSize=1000`, { method: "GET" }, { timeoutMs: opsi.timeoutMs });
  if (!h.ok) return h;
  const daftar: HasilModel[] = [];
  for (const m of h.data.models ?? []) {
    if (!(m.supportedGenerationMethods ?? []).includes("generateContent")) continue;
    const id = String(m.name ?? "").replace(/^models\//, "").trim();
    if (!id) continue;
    // `thinking` cuma boolean tanpa level — skema detail per model diisi heuristik.
    const bisaBerpikir = m.thinking === true;
    daftar.push({
      id,
      label: m.displayName,
      reasoningSkema: bisaBerpikir ? "bool" : "",
      reasoningPilihan: [],
      reasoningHilir: bisaBerpikir,
      contextLength: m.inputTokenLimit,
    });
  }
  return { ok: true, data: daftar, latencyMs: h.latencyMs };
}
