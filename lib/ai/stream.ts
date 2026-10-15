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

/**
 * Satu potongan dari provider, sudah siap dikirim ke user.
 *
 * `pikir` TERPISAH dari `delta` dengan sengaja: teks penalaran model (`reasoning_content` /
 * `reasoning` pada OpenAI-compatible, part `thought` pada Gemini) BUKAN jawaban. Kalau
 * keduanya digabung ke `delta`, jawaban user berisi curahan pikiran model.
 *
 * `selesaiAlasan` = `finish_reason` (OpenAI) / `finishReason` (Gemini) apa adanya. Tidak
 * pernah melempar: `length` (jawaban terpotong plafon token) dan `content_filter`
 * (diblokir) hanya DILAPORKAN supaya pemanggil bisa menjelaskan ke user.
 */
export type PotonganStream = {
  delta: string;
  pikir?: string;
  selesaiAlasan?: string;
  tokenMasuk?: number;
  tokenKeluar?: number;
};

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
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Baca satu baris `data: {...}` dari SSE dan kembalikan potongannya (null bila bentuknya
 * tidak memuat apa pun yang kita pakai: role-only, tool_call, atau JSON cacat).
 *
 * Teks pikiran (`delta.reasoning_content` / `delta.reasoning`) masuk `pikir`, TIDAK PERNAH
 * ke `delta`: mencampurnya berarti jawaban user berisi curahan pikiran model.
 * `finish_reason` diteruskan apa adanya lewat `selesaiAlasan` (mis. `length` = terpotong).
 *
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
  const c = v.choices?.[0];
  const potong: PotonganStream = { delta: "" };
  const isi = c?.delta?.content;
  if (typeof isi === "string" && isi) potong.delta = isi;
  // Nama field pikiran beda per provider (DeepSeek/Kenari `reasoning_content`, OpenRouter
  // `reasoning`), jadi ambil yang pertama ada.
  const pikir = c?.delta?.reasoning_content ?? c?.delta?.reasoning;
  if (typeof pikir === "string" && pikir) potong.pikir = pikir;
  if (typeof c?.finish_reason === "string" && c.finish_reason) potong.selesaiAlasan = c.finish_reason;
  if (v.usage?.prompt_tokens !== undefined) potong.tokenMasuk = v.usage.prompt_tokens;
  if (v.usage?.completion_tokens !== undefined) potong.tokenKeluar = v.usage.completion_tokens;
  return potong.delta ||
    potong.pikir ||
    potong.selesaiAlasan ||
    potong.tokenMasuk !== undefined ||
    potong.tokenKeluar !== undefined
    ? potong
    : null;
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
  // FASE HUBUNG: timer dipasang SEBELUM `await fetch`. `ac.abort()` hanya dipanggil dari
  // `batalkan()`, dan generator baru berjalan setelah dikonsumsi — jadi tanpa timer ini
  // provider yang menahan header (mis. mengantre varian `:free`) menggantung TANPA BATAS
  // dan user tidak menerima apa pun. Batasnya `idleMs`, bukan `totalMs`: provider yang lambat
  // menjawab header tidak boleh dianggap gagal lebih cepat daripada model yang lambat berpikir.
  // Dibersihkan di `finally` supaya tidak menahan event loop.
  const tHubung = setTimeout(() => ac.abort(), idleMs);
  try {
    res = await fetch(`${minta.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${minta.apiKey}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    const sebab = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 0,
      error: ac.signal.aborted
        ? `Gagal menghubungi provider: timeout fase hubung ${idleMs}ms tanpa balasan header.`
        : `Gagal menghubungi provider: ${sebab}`,
    };
  } finally {
    clearTimeout(tHubung);
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
    // SATU deadline kumulatif untuk seluruh stream. Sebelumnya timer "total" dibuat ulang dan
    // dibersihkan pada SETIAP iterasi, jadi ia tidak pernah sempat menyala: cabang `"total"`
    // adalah KODE MATI dan stream yang mengirim satu potongan tiap (idle-1)ms berjalan
    // selamanya. Sekarang sisanya dihitung dari deadline ini dan timer yang dipasang adalah
    // `min(idleMs, sisa)`, sehingga potongan yang mengalir terus TETAP dihentikan saat deadline.
    const batas = Date.now() + totalMs;
    try {
      while (!habis) {
        const sisa = batas - Date.now();
        if (sisa <= 0) {
          batalkan();
          throw new Error(`Timeout total ${totalMs}ms.`);
        }
        const tunggu = Math.min(idleMs, sisa);
        const baca = reader.read();
        const jedaIdle = Promise.withResolvers<{ jenis: "idle" }>();
        // Timer idle dibersihkan setelah balapan selesai: tanpa `clearTimeout`, tiap potongan
        // meninggalkan timer yang tetap hidup sampai waktunya habis sehingga proses (mis. uji)
        // ikut tertahan menunggu event loop kosong.
        const tIdle = setTimeout(() => jedaIdle.resolve({ jenis: "idle" }), tunggu);
        let hasil: { jenis: "baca"; r: ReadableStreamReadResult<Uint8Array> } | { jenis: "idle" };
        try {
          hasil = await Promise.race([baca.then((r) => ({ jenis: "baca" as const, r })), jedaIdle.promise]);
        } finally {
          clearTimeout(tIdle);
        }
        if (hasil.jenis !== "baca") {
          batalkan();
          throw new Error(
            tunggu < idleMs ? `Timeout total ${totalMs}ms.` : `Timeout provider setelah ${idleMs}ms tanpa potongan.`
          );
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
            // Pikiran dan alasan selesai diteruskan apa adanya; `delta` tetap hanya jawaban.
            if (potong.delta || potong.pikir || potong.selesaiAlasan) yield potong;
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
