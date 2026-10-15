// lib/ai/stream.ts — Jalur HTTP STREAMING untuk provider OpenAI-compatible.
// Dipakai `panggilTeksStream` di provider.ts. Fungsi di sini TIDAK mengubah
// lib/ai/http.ts: jalur non-stream tetap memakai panggilJson apa adanya.
// Dependensi: hanya API runtime (fetch, AbortController, TextDecoder).

import type { BagianChat } from "./http";
import { terapkanReasoning } from "./reasoning";

/**
 * KENAPA STREAMING DIPAKAI (keluhan pemilik repo: "reasoning selalu timeout"):
 * model penalaran bisa berpikir lebih lama daripada batas tunggu mana pun yang masih
 * masuk akal untuk dipegang user. Tanpa streaming, satu-satunya ukuran keberhasilan
 * adalah respons SELESAI — jadi permintaan yang sebenarnya berjalan baik tetap dicap
 * gagal (timeout) hanya karena totalnya lama. Dengan streaming, potongan pertama tiba
 * dalam hitungan detik dan langsung diteruskan ke user; request tidak lagi dianggap
 * gagal karena totalnya panjang, dan user melihat kemajuan alih-alih layar kosong.
 */

/** Satu potongan teks dari provider, sudah siap dikirim ke user. */
export type PotonganStream = { delta: string; tokenMasuk?: number; tokenKeluar?: number };

export type MintaStream = {
  baseUrl: string;
  apiKey: string;
  /** Nama provider — dipakai memilih nama parameter reasoning yang benar. */
  provider: string;
  model: string;
  pesan: BagianChat[];
  tool?: unknown[];
  maksToken?: number;
  /** Nilai reasoning dari setting ('low','high',...). Kosong = provider pakai default. */
  reasoning?: string;
  /** True bila sistem boleh membaca reasoning yang dihasilkan model. */
  reasoningHilir?: boolean;
  /** Batas waktu TANPA potongan: timer direset setiap potongan tiba. */
  timeoutMs?: number;
  /** Pagar waktu TOTAL percobaan ini (bukan idle). */
  totalMs?: number;
};

type DataSSE = {
  choices?: { delta?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Baca satu baris `data: {...}` dari SSE dan kembalikan potongan teksnya (null bila
 * bentuknya bukan delta teks yang kita pakai: role-only, tool_call, `usage`, atau JSON cacat).
 * SENGAJA tidak melempar: provider berbeda-beda bentuknya, dan satu baris asing tidak
 * boleh menggagalkan seluruh jawaban.
 */
function potonganDariBaris(baris: string): PotonganStream | null {
  const data = baris.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  let v: DataSSE;
  try {
    v = JSON.parse(data) as DataSSE;
  } catch {
    return null;
  }
  const potong: PotonganStream = { delta: "" };
  const isi = v.choices?.[0]?.delta?.content;
  if (typeof isi === "string" && isi) potong.delta = isi;
  if (v.usage?.prompt_tokens !== undefined) potong.tokenMasuk = v.usage.prompt_tokens;
  if (v.usage?.completion_tokens !== undefined) potong.tokenKeluar = v.usage.completion_tokens;
  return potong.delta || potong.tokenMasuk !== undefined || potong.tokenKeluar !== undefined ? potong : null;
}

/**
 * POST {baseUrl}/chat/completions dengan `stream: true`; kembalikan async iterator
 * potongan teks. SEMUA kegagalan dikembalikan sebagai `{ ok:false, error }` — tidak
 * dilempar — supaya pemanggil bisa pindah kandidat berikutnya.
 *
 * Retry TIDAK ADA di sini (beda dari panggilJson): badan respons sudah mulai terkirim
 * ke user, jadi mengulang permintaan hanya akan menggandakan teks yang sudah tampil.
 */
export async function streamJson(
  minta: MintaStream
): Promise<{ ok: true; iter: AsyncGenerator<PotonganStream>; batalkan: () => void } | { ok: false; error: string; status: number }> {
  const idleMs = minta.timeoutMs && minta.timeoutMs > 0 ? minta.timeoutMs : 35000;
  const totalMs = minta.totalMs && minta.totalMs > 0 ? minta.totalMs : idleMs;
  const ac = new AbortController();
  const batalkan = (): void => ac.abort();
  let masukMs = 0;
  let keluarMs = 0;

  const body: Record<string, unknown> = { model: minta.model, messages: minta.pesan, stream: true, stream_options: { include_usage: true } };
  if (minta.tool && minta.tool.length > 0) body.tools = minta.tool;
  if (minta.maksToken !== undefined) body.max_tokens = minta.maksToken;
  // Reasoning: nama parameternya beda per provider, jadi pemetaannya di reasoning.ts
  // (SATU pintu keluar, sama seperti jalur non-stream di adapterOpenai.ts).
  Object.assign(
    body,
    terapkanReasoning(minta.provider, minta.reasoning, { hilir: minta.reasoningHilir, adaTool: !!minta.tool?.length })
  );

  let res: Response;
  try {
    res = await fetch(`${minta.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${minta.apiKey}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Gagal menghubungi provider: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Bukan 2xx: body dibaca sebagai teks dan dilaporkan apa adanya (status + potongan body),
  // TIDAK dilempar — pemanggil yang memutuskan pindah kandidat.
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
        // Timer ganda: `idle` untuk jeda antar-potongan (model berpikir), `total` sebagai
        // pagar terakhir supaya koneksi menggantung tidak menahan request selamanya.
        const hasil = await Promise.race([
          baca.then((r) => ({ jenis: "baca" as const, r })),
          new Promise<{ jenis: "idle" }>((r) => setTimeout(() => r({ jenis: "idle" }), idleMs)),
          new Promise<{ jenis: "total" }>((r) => setTimeout(() => r({ jenis: "total" }), totalMs)),
        ]);
        if (hasil.jenis !== "baca") {
          batalkan();
          throw new Error(hasil.jenis === "idle" ? `Timeout provider setelah ${idleMs}ms tanpa potongan.` : `Timeout total ${totalMs}ms.`);
        }
        if (hasil.r.done) break;
        buffer += decoder.decode(hasil.r.value, { stream: true });
        // SSE memisah event dengan baris kosong. Sisa buffer disimpan untuk potongan berikutnya.
        // `\r\n` dinormalkan dulu: sebagian provider memakai CRLF, dan tanpa ini event mereka
        // tidak pernah terpisah (potongan baru muncul setelah koneksi ditutup).
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
            const potong = potonganDariBaris(baris);
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
