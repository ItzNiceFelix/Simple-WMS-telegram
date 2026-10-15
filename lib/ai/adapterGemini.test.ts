// lib/ai/adapterGemini.test.ts — Jalur STREAMING Gemini (`:streamGenerateContent?alt=sse`).
//
// KENAPA TEST INI ADA: Gemini dulu DILEWATI di `panggilTeksStream` ("jalur streaming
// belum tersedia untuk gemini"), jadi rantai produksi ["kenari","groq","gemini"] berakhir
// "tidak ada provider" walau kredensial gemini sehat. Bentuk SSE Gemini juga BEDA dari
// OpenAI (`candidates[0].content.parts[].text`, bukan `choices[0].delta.content`) — itu
// yang dikunci di sini, plus body yang benar-benar dikirim ke provider.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatGemini, streamGemini, type OpsiGemini } from "./adapterGemini";
import type { BagianChat } from "./http";
import type { MintaStream, PotonganStream } from "./stream";

const PESAN: BagianChat[] = [{ role: "user", teks: "halo" }];

/** Permintaan stream Gemini dengan nilai wajar; `tambahan` menimpa bagian yang sedang diuji. */
function minta(tambahan: Partial<MintaStream> = {}): OpsiGemini & MintaStream {
  return {
    apiKey: "key-gemini",
    baseUrl: "",
    provider: "gemini",
    model: "gemini-2.5-flash",
    pesan: PESAN,
    // Timer idle/total nyata tapi kecil: stream palsu selesai seketika, jadi timer ini
    // hanya memastikan uji tidak menggantung bila ada yang salah.
    timeoutMs: 500,
    totalMs: 2000,
    ...tambahan,
  };
}

/**
 * SSE palsu bentuk Gemini: tiap kandidat dibalas satu event `data:` bertahap lewat
 * ReadableStream, jadi parsing buffer diuji apa adanya (bukan lewat mock fungsi).
 * `mentah` untuk event yang bukan kandidat (usageMetadata, JSON cacat).
 */
function sseGemini(kandidat: unknown[][], mentah: string[] = []): ReadableStream<Uint8Array> {
  const baris = [...kandidat.map((parts) => JSON.stringify({ candidates: [{ content: { parts } }] })), ...mentah];
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of baris) c.enqueue(enc.encode(`data: ${b}\n\n`));
      c.close();
    },
  });
}

/** Jalankan stream lalu kumpulkan potongan — gagal bila `streamGemini` tidak ok. */
async function kumpulkan(m: OpsiGemini & MintaStream): Promise<{ teks: string; potongan: PotonganStream[] }> {
  const s = await streamGemini(m);
  if (!s.ok) throw new Error(`stream harus ok: ${s.error}`);
  const potongan: PotonganStream[] = [];
  for await (const p of s.iter) potongan.push(p);
  return { teks: potongan.map((p) => p.delta).join(""), potongan };
}

/** Response 200 dengan badan SSE Gemini. */
function responsSSE(body: ReadableStream<Uint8Array>): Response {
  return { ok: true, status: 200, body } as unknown as Response;
}

describe("streamGemini — bentuk SSE Gemini", () => {
  it("2-3 event parts[].text jadi delta berurutan dan teks gabungan benar", async () => {
    globalThis.fetch = (async () =>
      responsSSE(sseGemini([[{ text: "Ha" }], [{ text: "lo" }], [{ text: " dunia" }]]))) as unknown as typeof fetch;

    const { teks, potongan } = await kumpulkan(minta());
    assert.equal(teks, "Halo dunia");
    assert.deepEqual(
      potongan.map((p) => p.delta),
      ["Ha", "lo", " dunia"],
      "tiap event harus terkirim terpisah, bukan digabung di akhir"
    );
  });

  it("beberapa part dalam satu kandidat digabung", async () => {
    globalThis.fetch = (async () => responsSSE(sseGemini([[{ text: "Halo" }, { text: " dunia" }], [{ text: "!" }]]))) as unknown as typeof fetch;

    const { teks, potongan } = await kumpulkan(minta());
    assert.equal(teks, "Halo dunia!");
    assert.deepEqual(
      potongan.map((p) => p.delta),
      ["Halo dunia", "!"],
      "part dalam satu event digabung, antar event tetap terpisah"
    );
  });
});

describe("streamGemini — event yang tidak berisi teks", () => {
  it("part tanpa text, usageMetadata sendiri, dan JSON cacat diabaikan tanpa melempar", async () => {
    globalThis.fetch = (async () =>
      responsSSE(
        sseGemini(
          [[{ inlineData: { mimeType: "image/png", data: "AAAA" } }], [], [{ text: "ok" }]],
          [
            JSON.stringify({ usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2 } }),
            "bukan-json",
            JSON.stringify({ candidates: [{ finishReason: "STOP" }] }),
          ]
        )
      )) as unknown as typeof fetch;

    const { teks, potongan } = await kumpulkan(minta());
    assert.equal(teks, "ok", "hanya teks yang boleh sampai ke user");
    assert.equal(potongan.filter((p) => p.delta).length, 1, "event tanpa teks tidak menghasilkan potongan teks");
  });

  it("token dari usageMetadata terbaca (usage bisa menempel di potongan berteks)", async () => {
    globalThis.fetch = (async () =>
      responsSSE(
        sseGemini([[{ text: "Halo" }]], [
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "!" }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } }),
        ])
      )) as unknown as typeof fetch;

    const { teks, potongan } = await kumpulkan(minta());
    assert.equal(teks, "Halo!");
    const akhir = potongan[potongan.length - 1];
    assert.deepEqual([akhir?.tokenMasuk, akhir?.tokenKeluar], [7, 3], "usageMetadata harus jadi agregat token di akhir stream");
  });
});

describe("streamGemini — kegagalan dan body permintaan", () => {
  it("HTTP 400 dikembalikan sebagai { ok:false, status, error } berisi potongan body, bukan dilempar", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 400,
        text: async () => '{"error":{"message":"API key not valid. Please pass a valid API key."}}',
      }) as unknown as Response) as unknown as typeof fetch;

    const s = await streamGemini(minta());
    assert.equal(s.ok, false);
    if (s.ok) return;
    assert.equal(s.status, 400, "status provider harus diteruskan apa adanya");
    assert.match(s.error, /HTTP 400/);
    assert.match(s.error, /API key not valid/, `error harus memuat potongan body asli: ${s.error}`);
  });

  it("body dikirim ke :streamGenerateContent dengan alt=sse + reasoning jadi thinkingConfig", async () => {
    let url = "";
    let body = "";
    globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      body = String(init?.body ?? "");
      return responsSSE(sseGemini([[{ text: "ok" }]]));
    }) as unknown as typeof fetch;

    await kumpulkan(minta({ reasoning: "high", maksToken: 100 }));

    assert.ok(url.includes(":streamGenerateContent"), `endpoint harus streaming, bukan generateContent: ${url}`);
    assert.ok(url.includes("alt=sse"), `SSE wajib diminta lewat alt=sse: ${url}`);
    assert.ok(url.includes("/models/gemini-2.5-flash"), `model harus ikut di URL: ${url}`);
    assert.ok(url.includes("key=key-gemini"), `API key ikut sebagai query: ${url}`);

    const data = JSON.parse(body) as {
      contents?: { role?: string; parts?: { text?: string }[] }[];
      generationConfig?: { maxOutputTokens?: number; thinkingConfig?: { thinkingBudget?: number; thinkingLevel?: string } };
    };
    assert.equal(data.contents?.[0]?.parts?.[0]?.text, "halo", "pesan user harus ikut di body");
    assert.equal(data.generationConfig?.maxOutputTokens, 100);
    // `gemini-2.5-flash` hanya menerima thinkingBudget ANGKA — thinkingLevel berbalas 400,
    // jadi bentuk per versi model inilah yang harus sampai ke Gemini.
    assert.equal(
      data.generationConfig?.thinkingConfig?.thinkingBudget,
      24576,
      "setelan reasoning harus sampai ke Gemini lewat jalur stream juga (bukan diabaikan)"
    );
  });
});

describe("streamGemini — pikiran tidak pernah masuk delta", () => {
  it("part thought:true masuk `pikir`, part biasa masuk `delta`", async () => {
    globalThis.fetch = (async () =>
      responsSSE(
        sseGemini([
          [{ text: "berpikir dulu", thought: true }],
          [{ text: "Jawaban" }],
          [{ text: " akhir", thought: true }, { text: "!" }],
        ])
      )) as unknown as typeof fetch;

    const { teks, potongan } = await kumpulkan(minta({ reasoningHilir: true }));
    assert.equal(teks, "Jawaban!", "hanya jawaban yang boleh masuk delta");
    assert.equal(potongan.map((p) => p.pikir ?? "").join(""), "berpikir dulu akhir", "teks pikiran harus lewat `pikir`");
    assert.equal(
      potongan.some((p) => p.delta.includes("berpikir") || p.delta.includes("akhir")),
      false,
      "teks pikiran TIDAK BOLEH muncul di delta"
    );
  });
});

describe("streamGemini — finishReason", () => {
  it("finishReason MAX_TOKENS diteruskan sebagai selesaiAlasan tanpa dilempar", async () => {
    globalThis.fetch = (async () =>
      responsSSE(
        sseGemini([[{ text: "terpotong" }]], [
          JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] }),
        ])
      )) as unknown as typeof fetch;

    const { potongan } = await kumpulkan(minta());
    assert.equal(potongan[potongan.length - 1]?.selesaiAlasan, "MAX_TOKENS", "alasan selesai diteruskan apa adanya");
  });
});

describe("streamGemini — pagar waktu", () => {
  it("fetch yang tidak membalas header digagalkan timeout fase hubung (bukan menggantung)", async () => {
    // fetch palsu yang hanya selesai kalau signal di-abort = provider yang menahan header.
    // Timer NYATA (kecil) disengaja: yang diuji justru plafon jam dinding pada
    // fetch/AbortController asli, yang tidak bisa digerakkan oleh jam palsu.
    globalThis.fetch = ((_u: unknown, init?: RequestInit) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      // Jaring: kalau timer fase hubung hilang, uji ini GAGAL cepat alih-alih menggantung.
      // Batas 3s jauh di atas timeoutMs 40ms, jadi tidak pernah menyala di jalur yang benar;
      // pesannya sengaja TIDAK memuat "fase hubung" supaya kegagalan tidak lolos pemeriksaan.
      const jaring = setTimeout(() => reject(new Error("provider tidak pernah membalas header")), 3000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(jaring);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
      return promise;
    }) as unknown as typeof fetch;

    const mulai = Date.now();
    const s = await streamGemini(minta({ timeoutMs: 40, totalMs: 5000 }));
    assert.equal(s.ok, false, "menahan header tidak boleh dianggap sukses");
    if (s.ok) return;
    assert.equal(s.status, 0);
    assert.match(s.error, /Gagal menghubungi provider/);
    assert.match(s.error, /fase hubung/, "pesan harus menyebut fase hubung, beda dari timeout antar-potongan");
    assert.ok(Date.now() - mulai < 2000, "harus gagal lewat timeout hubung, bukan menunggu tanpa batas");
  });

  it("potongan yang terus mengalir tetap dihentikan saat deadline total tercapai", async () => {
    const enc = new TextEncoder();
    let n = 0;
    // Pasokan potongan DIBATASI (tapi koneksi tidak pernah ditutup) supaya regresi — pagar
    // total mati lagi — berakhir sebagai KEGAGALAN cepat lewat timeout idle, bukan uji yang
    // menggantung selamanya. 30 potongan × 20ms = 600ms, jauh melewati totalMs 300ms.
    let sisa = 30;
    // Potongan datang tiap 20ms, lebih cepat daripada idleMs — inilah bentuk stream yang dulu
    // berjalan selamanya karena pagar total tidak pernah menyala. Jeda nyata dipakai karena
    // jeda antar-potongan ITU yang diuji; ReadableStream asli tidak bisa didorong jam palsu.
    const banjir = new ReadableStream<Uint8Array>({
      async pull(c) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 20);
        await promise;
        if (sisa-- <= 0) return;
        c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: `x${n++}` }] } }] })}\n\n`));
      },
    });
    globalThis.fetch = (async () => responsSSE(banjir)) as unknown as typeof fetch;

    const s = await streamGemini(minta({ timeoutMs: 80, totalMs: 300 }));
    assert.equal(s.ok, true, `stream harus ok: ${s.ok ? "" : s.error}`);
    if (!s.ok) return;

    const mulai = Date.now();
    let teks = "";
    let galat = "";
    try {
      for await (const p of s.iter) teks += p.delta;
    } catch (e) {
      galat = e instanceof Error ? e.message : String(e);
    }
    assert.match(galat, /Timeout total 300ms/, "stream yang tidak menutup koneksi harus dihentikan pagar total, bukan timeout idle");
    assert.ok(teks.length > 0, "potongan harus sempat mengalir sebelum pagar total menyala");
    assert.ok(Date.now() - mulai < 2000, "pagar total harus menghentikan stream, bukan menunggu tanpa batas");
  });
});

describe("chatGemini — pembangun body yang sama", () => {
  it("reasoning ikut dikirim di jalur non-stream; tanpa reasoning tidak ada generationConfig", async () => {
    const bodyTerkirim: string[] = [];
    globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      bodyTerkirim.push(String(init?.body ?? ""));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const opsi: OpsiGemini = { apiKey: "key-gemini", timeoutMs: 500 };
    const h1 = await chatGemini(opsi, { model: "gemini-2.5-flash", pesan: PESAN, reasoning: "max", maksToken: 100 });
    assert.equal(h1.ok, true, `chatGemini harus ok: ${h1.ok ? "" : h1.error}`);
    const dengan = JSON.parse(bodyTerkirim[0] ?? "{}") as { generationConfig?: { thinkingConfig?: { thinkingBudget?: number; thinkingLevel?: string } } };
    // `max` dinormalisasi ke tingkat `high` di lib/ai/reasoning.ts, lalu dipetakan ke bentuk
    // yang sah untuk `gemini-2.5-flash`: thinkingBudget ANGKA (thinkingLevel berbalas 400).
    assert.equal(dengan.generationConfig?.thinkingConfig?.thinkingBudget, 24576);

    const h2 = await chatGemini(opsi, { model: "gemini-2.5-flash", pesan: PESAN });
    assert.equal(h2.ok, true, `chatGemini harus ok: ${h2.ok ? "" : h2.error}`);
    const tanpa = JSON.parse(bodyTerkirim[1] ?? "{}") as Record<string, unknown>;
    assert.equal("generationConfig" in tanpa, false, "tanpa reasoning tidak boleh ada generationConfig sama sekali");
  });
});
