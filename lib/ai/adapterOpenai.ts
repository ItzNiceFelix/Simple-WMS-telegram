// lib/ai/adapterOpenai.ts — Adapter untuk provider ber-API "OpenAI-compatible".
// Dipakai oleh: openai, groq, openrouter, dan kenari (base URL custom via
// KENARI_BASE_URL, fallback https://api.kenari.ai/v1).
// Dependensi: lib/ai/http.ts (timeout, retry, pesan error asli), Web FormData/fetch.
// Semua kegagalan diteruskan apa adanya — pemanggil (provider.ts) yang memutuskan
// pindah model/provider.

import { panggilJson, type BagianChat, type HasilHttp, type HasilModel, type JawabanChat, type PermintaanChat } from "./http";
import { normalkanModal, normalkanPilihanReasoning } from "./kapabilitas";

import { terapkanReasoning } from "./reasoning";

export type OpsiAdapter = { baseUrl: string; apiKey: string; timeoutMs?: number; /** Nama provider — dipakai memilih nama parameter reasoning yang benar. */ provider: string };

/**
 * Ubah byte gambar jadi base64 lewat Buffer.
 *
 * Kenapa BUKAN loop per byte (`biner += String.fromCharCode(b)`): itu membuat satu string
 * per byte — ~500.000 alokasi untuk gambar 500 KB, di jalur yang dipanggil tiap gambar
 * dari provider OpenAI-compatible (termasuk Kenari). Workers Free hanya punya 10 ms CPU
 * per request, jadi biayanya nyata. Terukur pada Node 22 (500 KB x 30 putaran):
 *
 *   per byte + btoa ......... 654 ms
 *   potongan 8192 + spread .. 677 ms   ← lebih LAMBAT; spread argumen berbiaya
 *   Buffer.toString("base64") . 24 ms   ← dipakai di sini, ~28x
 *
 * Semua tiga menghasilkan base64 IDENTIK (diuji, termasuk byte 0 dan >=128).
 * Buffer tersedia karena `nodejs_compat` aktif di wrangler.jsonc. Catatan memori: string
 * JS itu UTF-16, jadi 667 KB base64 tetap ~1,33 MB RAM — Buffer hanya menghemat CPU.
 */
function binerKeBase64(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64");
}

/**
 * Kebalikannya: base64 -> byte. Dulu `atob` lalu loop `charCodeAt` per byte, yang punya
 * masalah sama seperti loop di atas — dan jalur ini dijalankan untuk SETIAP gambar
 * referensi (sampai 5), jadi biayanya berlipat. `Buffer.from(s, "base64")` menghasilkan
 * byte yang sama persis, jauh lebih sedikit kerja CPU.
 */
function base64KeBiner(base64: string): Uint8Array<ArrayBuffer> {
  // Buffer.from memberi Uint8Array<ArrayBufferLike>, sedangkan Blob menuntut ArrayBuffer
  // konkret. Salin ke buffer baru — ukurannya sama, dan byte-nya sudah benar dari Buffer.
  const b = Buffer.from(base64, "base64");
  const bytes = new Uint8Array(new ArrayBuffer(b.length));
  bytes.set(b);
  return bytes;
}


/**
 * Peta rasio -> `size` untuk provider OpenAI-compatible (yang memakai ukuran, bukan rasio).
 * Hanya rasio yang punya padanan ukuran resmi; sisanya dibiarkan agar provider pakai default.
 */
const UKURAN_DARI_RASIO: Record<string, string> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "16:9": "1536x864",
  "9:16": "864x1536",
};

/**
 * Field ekstra yang MUNGKIN dikirim sebagian provider OpenAI-compatible.
 * Groq/OpenAI/Kenari nyata tidak mengirimnya — jangan diandalkan.
 */
type EkstraModel = {
  id?: string;
  name?: string;
  context_length?: number;
  context_window?: number;
  /** OpenRouter: architecture.input_modalities / output_modalities. */
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  /** Kenari: modalities.input / modalities.output — sumber otentik, bukan heuristik. */
  modalities?: { input?: unknown; output?: unknown };
  /** Kenari: daftar tingkat reasoning yang SAH untuk model itu (mis. ['low','high','max']). */
  reasoning_options?: unknown;
  /** Kenari: apakah model mendukung reasoning sama sekali. */
  reasoning?: unknown;
  reasoning_toggle?: unknown;
};

/** Provider yang mengirim daftar model dengan metadata kaya (bukan hanya id). */
const PROVIDER_KAYA = new Set(["openrouter", "kenari"]);

/**
 * Terjemahkan daftar `reasoning_options` provider menjadi skema + pilihan kita.
 * Kenari memberi daftar PERSIS per model (mis. ['low','high','xhigh','max']),
 * jadi tidak perlu heuristik — pakai apa adanya.
 */
function skemaDariPilihan(pilihan: string[]): string {
  if (pilihan.length === 0) return "";
  if (pilihan.length === 2 && pilihan.every((p) => p === "high" || p === "xhigh")) return "level_3";
  return "level_4";
}

/** Base URL bawaan provider. Kenari tidak di sini — base URL-nya dari env. */
export const BASE_OPENAI: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/** Kenari tanpa env: pakai domain resmi. Dokumentasi resmi: base URL https://kenari.id/v1 */
export function baseKenari(env?: { KENARI_BASE_URL?: string } | null | object): string {
  const k = env as { KENARI_BASE_URL?: string } | null | undefined;
  return (k?.KENARI_BASE_URL ?? "").trim().replace(/\/+$/, "") || BASE_KENARI;
}

/** Domain resmi Kenari. Sebelumnya salah tulis `kenari.ai` → Cloudflare 530/1016 (DNS gagal). */
export const BASE_KENARI = "https://kenari.id/v1";

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

/**
 * SpesifikasiTool internal (`{nama, deskripsi, parameter}`) → format OpenAI
 * (`{type:"function", function:{name, description, parameters}}`).
 *
 * Dua bentuk diterima:
 * 1. Bentuk internal flat: `{nama, deskripsi, parameter}`.
 * 2. Bentuk wire OpenAI yang sudah dibungkus: `{type:"function", function:{name, description, parameters}}`.
 *
 * MASALAH YANG DIPERBAIKI: satu pemanggil (route editor layout) mengirim SKEMA_TOOL_EDITOR
 * yang SUDAH dalam bentuk wire, sehingga `nama` tidak ada dan `name` menjadi string kosong —
 * provider menolak dengan "invalid_request_error" (HTTP 400). Nama kosong itulah penyebabnya,
 * jadi nama akhir selalu fallback ke "tool".
 */
function keToolOpenai(t: unknown): Record<string, unknown> {
  const s = (t ?? {}) as Record<string, unknown>;
  const fn = s.function;
  const sudahWire = s.type === "function" && typeof fn === "object" && fn !== null;
  const f = (sudahWire ? fn : s) as Record<string, unknown>;

  const nama = String((sudahWire ? f.name : f.nama) ?? "").trim();
  const deskripsi = String((sudahWire ? f.description : f.deskripsi) ?? "");
  const params = sudahWire ? f.parameters : f.parameter;

  return {
    type: "function",
    function: {
      name: nama === "" ? "tool" : nama,
      description: deskripsi,
      parameters:
        typeof params === "object" && params !== null ? params : { type: "object", properties: {} },
    },
  };
}

/** POST {baseUrl}/chat/completions. Tool call dikembalikan dengan arguments STRING apa adanya. */
export async function chatOpenai(opsi: OpsiAdapter, permintaan: PermintaanChat): Promise<HasilHttp<JawabanChat>> {
  const body: Record<string, unknown> = {
    model: permintaan.model,
    messages: permintaan.pesan.map(kePesanOpenai),
  };
  if (permintaan.tool && permintaan.tool.length > 0) body.tools = permintaan.tool.map(keToolOpenai);
  if (permintaan.maksToken !== undefined) body.max_tokens = permintaan.maksToken;
  if (permintaan.suhu !== undefined) body.temperature = permintaan.suhu;
  if (permintaan.jsonMode) body.response_format = { type: "json_object" };
  // Reasoning: nama parameternya beda per provider, jadi peta-nya ada di reasoning.ts.
  const paramReasoning = terapkanReasoning(opsi.provider, permintaan.reasoning, {
    hilir: permintaan.reasoningHilir,
    jsonMode: permintaan.jsonMode,
    adaTool: !!permintaan.tool?.length,
  });
  Object.assign(body, paramReasoning);

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

/**
 * GET {baseUrl}/models → daftar id model.
 * Groq/OpenAI terverifikasi hanya memberi `id`; field kapabilitas di bawah ini
 * hanya terisi bila provider tertentu (varian OpenAI-compatible) menyertakannya.
 * Kalau kosong, heuristik di lib/ai/kapabilitas.ts yang mengisi saat disimpan.
 */
export async function modelOpenai(opsi: OpsiAdapter): Promise<HasilHttp<HasilModel[]>> {
  const h = await panggilJson<{ data?: (EkstraModel & { id?: string })[] }>(
    `${opsi.baseUrl.replace(/\/+$/, "")}/models`,
    { method: "GET", headers: { Authorization: `Bearer ${opsi.apiKey}` } },
    { timeoutMs: opsi.timeoutMs }
  );
  if (!h.ok) return h;
  const daftar: HasilModel[] = [];
  for (const m of h.data.data ?? []) {
    const id = String(m.id ?? "").trim();
    if (!id) continue;
    const masuk = normalkanModal(m.architecture?.input_modalities ?? m.modalities?.input);
    const keluar = normalkanModal(m.architecture?.output_modalities ?? m.modalities?.output);
    const ctx = m.context_length ?? m.context_window;
    const model: HasilModel = { id };
    if (m.name && m.name !== id) model.label = String(m.name).slice(0, 120);
    if (masuk.length) model.modalMasuk = masuk;
    if (keluar.length) model.modalKeluar = keluar;
    if (typeof ctx === "number") model.contextLength = ctx;
    // Kenari memberi daftar tingkat reasoning PERSIS per model — pakai apa adanya.
    const pilihan = normalkanPilihanReasoning(m.reasoning_options);
    if (pilihan.length > 0) {
      model.reasoningSkema = skemaDariPilihan(pilihan);
      model.reasoningPilihan = pilihan;
      model.reasoningHilir = true;
    } else if (m.reasoning === true || m.reasoning_toggle === true) {
      // Hanya tahu "bisa reasoning" tanpa daftar tingkat → hidup/mati.
      model.reasoningSkema = "bool";
      model.reasoningPilihan = ["on", "off"];
      model.reasoningHilir = true;
    }
    daftar.push(model);
  }
  return { ok: true, data: daftar, latencyMs: h.latencyMs };
}

/** True bila provider ini mengirim metadata kaya; heuristik hanya dipakai bila false. */
export function providerKaya(provider: string): boolean {
  return PROVIDER_KAYA.has(String(provider ?? "").trim().toLowerCase());
}

/**
 * Baca gambar dari respons provider, toleran terhadap TIGA bentuk yang nyata dipakai:
 *   1. `b64_json` — OpenAI klasik.
 *   2. `url` berisi DATA URL (`data:image/png;base64,iVBOR...`) — dipakai Kenari dan
 *      sebagian provider OpenAI-compatible.
 *   3. `url` biasa (http) — perlu diunduh dulu.
 *
 * Sebelumnya hanya bentuk 1 yang dibaca, sehingga gambar Kenari dianggap gagal
 * ("Provider tidak mengembalikan gambar") padahal gambarnya ADA di `url` sebagai
 * data URL. Akibatnya sistem diam-diam jatuh ke model lain.
 */
async function bacaHasilGambar(
  data: { data?: { b64_json?: string; url?: string }[]; error?: unknown },
  latencyMs: number,
  apiKey: string
): Promise<HasilHttp<{ base64: string; mime: string }>> {
  const item = data.data?.[0];
  if (item?.b64_json) {
    return { ok: true, data: { base64: item.b64_json, mime: "image/png" }, latencyMs };
  }
  const url = String(item?.url ?? "");
  if (url.startsWith("data:")) {
    // data URL: ambil mime + base64 setelah koma. Bentuk ini yang dipakai Kenari.
    const koma = url.indexOf(",");
    const kepala = url.slice(5, koma); // mis. "image/png;base64"
    const mime = kepala.split(";")[0] || "image/png";
    const b64 = koma > 0 ? url.slice(koma + 1) : "";
    if (!b64) {
      return { ok: false, status: 502, error: "Provider mengirim data URL tanpa isi.", latencyMs };
    }
    return { ok: true, data: { base64: b64, mime }, latencyMs };
  }
  if (url) {
    // URL http: unduh isinya. Sebagian provider hanya memberi tautan sementara.
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) {
        return { ok: false, status: 502, error: `Gagal mengunduh gambar dari ${url.slice(0, 80)} (HTTP ${res.status}).`, latencyMs };
      }
      const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
      const buf = new Uint8Array(await res.arrayBuffer());
      return { ok: true, data: { base64: binerKeBase64(buf), mime }, latencyMs };
    } catch (e) {
      return { ok: false, status: 502, error: `Gagal mengunduh gambar: ${e instanceof Error ? e.message : "tidak diketahui"}.`, latencyMs };
    }
  }
  return {
    ok: false,
    status: 502,
    error: `Provider tidak mengembalikan gambar: ${JSON.stringify(data).slice(0, 300)}`,
    latencyMs,
  };
}

/** POST /images/generations, atau /images/edits (multipart) bila ada referensi. */
export async function gambarOpenai(
  opsi: OpsiAdapter,
  minta: { model: string; prompt: string; referensi?: { mime: string; base64: string }[]; reasoning?: string; aspekRasio?: string; jumlah?: number }
): Promise<HasilHttp<{ base64: string; mime: string }>> {
  const base = opsi.baseUrl.replace(/\/+$/, "");
  const referensi = minta.referensi ?? [];
  // Reasoning gambar opsional: hanya dikirim bila provider+model memang mendukung
  // (mis. OpenRouter model gambar dengan `reasoning.effort`). Kosong = jangan kirim.
  const paramReasoning = terapkanReasoning(opsi.provider, minta.reasoning);

  if (referensi.length === 0) {
    const bodyGambar: Record<string, unknown> = { model: minta.model, prompt: minta.prompt, n: Math.min(4, Math.max(1, Math.floor(Number(minta.jumlah) || 1))) };
    Object.assign(bodyGambar, paramReasoning);
    // Ukuran gambar OpenAI-compatible memakai `size` (bukan rasio). Petakan rasio
    // ke ukuran yang dikenal; rasio tak dikenal dibiarkan (provider pakai default).
    const ukuran = UKURAN_DARI_RASIO[minta.aspekRasio ?? ""];
    if (ukuran) bodyGambar.size = ukuran;
    const h = await panggilJson<{ data?: { b64_json?: string; url?: string }[]; error?: unknown }>(
      `${base}/images/generations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opsi.apiKey}` },
        body: JSON.stringify(bodyGambar),
      },
      { timeoutMs: opsi.timeoutMs }
    );
    if (!h.ok) return h;
    return bacaHasilGambar(h.data, h.latencyMs, opsi.apiKey);
  }

  // Multipart: provider OpenAI-compatible menerima berkas "image" + field prompt/model.
  //
  // MASALAH YANG DIPERBAIKI: sebelumnya berkas ke-2 dst. dikirim sebagai `image[0]`,
  // `image[1]`, ... Kenari menolaknya dengan "field 'image' is required" (HTTP 400) —
  // jadi MUSTAHIL mengirim lebih dari satu referensi, walau UI mengizinkan 5.
  // Nama field diulang dengan nama yang SAMA adalah cara standar multipart mengirim
  // daftar berkas, dan itu yang diterima Kenari/OpenAI. Diverifikasi lewat uji nyata:
  // 1 referensi lolos, 2+ gagal "field 'image' is required".
  const form = new FormData();
  form.set("model", minta.model);
  form.set("prompt", minta.prompt);
  for (const [i, r] of referensi.entries()) {
    const ext = r.mime.split("/")[1] ?? "png";
    form.append("image", new Blob([base64KeBiner(r.base64)], { type: r.mime }), `referensi-${i + 1}.${ext}`);
  }
  const h = await panggilJson<{ data?: { b64_json?: string; url?: string }[]; error?: unknown; message?: unknown }>(
    `${base}/images/edits`,
    { method: "POST", headers: { Authorization: `Bearer ${opsi.apiKey}` }, body: form },
    { timeoutMs: opsi.timeoutMs }
  );
  // Sebagian provider hanya menerima `image[]` (bukan `image` berulang) untuk banyak gambar.
  // Bila provider menolak karena field-nya, ulangi sekali dengan nama itu. Hanya dilakukan
  // saat ada >1 referensi — dengan satu gambar `image` sudah pasti benar.
  if (!h.ok && referensi.length > 1 && /field .?image/i.test(h.error)) {
    const form2 = new FormData();
    form2.set("model", minta.model);
    form2.set("prompt", minta.prompt);
    for (const [i, r] of referensi.entries()) {
      const ext = r.mime.split("/")[1] ?? "png";
      form2.append("image[]", new Blob([base64KeBiner(r.base64)], { type: r.mime }), `referensi-${i + 1}.${ext}`);
    }
    const h2 = await panggilJson<{ data?: { b64_json?: string; url?: string }[]; error?: unknown; message?: unknown }>(
      `${base}/images/edits`,
      { method: "POST", headers: { Authorization: `Bearer ${opsi.apiKey}` }, body: form2 },
      { timeoutMs: opsi.timeoutMs }
    );
    if (h2.ok) return bacaHasilGambar(h2.data, h2.latencyMs, opsi.apiKey);
    // Dua-duanya gagal: laporkan yang PERTAMA karena itu bentuk yang kita pilih sengaja.
    return h;
  }
  if (!h.ok) return h;
  return bacaHasilGambar(h.data, h.latencyMs, opsi.apiKey);
}
