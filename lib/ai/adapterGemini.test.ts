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
  assert.equal(s.ok, true, `stream harus ok: ${s.ok ? "" : s.error}`);
  if (!s.ok) throw new Error(s.error);
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
      generationConfig?: { maxOutputTokens?: number; thinkingConfig?: { thinkingLevel?: string } };
    };
    assert.equal(data.contents?.[0]?.parts?.[0]?.text, "halo", "pesan user harus ikut di body");
    assert.equal(data.generationConfig?.maxOutputTokens, 100);
    assert.equal(
      data.generationConfig?.thinkingConfig?.thinkingLevel,
      "high",
      "setelan reasoning harus sampai ke Gemini lewat jalur stream juga (bukan diabaikan)"
    );
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
    const dengan = JSON.parse(bodyTerkirim[0] ?? "{}") as { generationConfig?: { thinkingConfig?: { thinkingLevel?: string } } };
    // `max` dinormalisasi ke `high` di lib/ai/reasoning.ts — nilai sah HTTP API.
    assert.equal(dengan.generationConfig?.thinkingConfig?.thinkingLevel, "high");

    const h2 = await chatGemini(opsi, { model: "gemini-2.5-flash", pesan: PESAN });
    assert.equal(h2.ok, true, `chatGemini harus ok: ${h2.ok ? "" : h2.error}`);
    const tanpa = JSON.parse(bodyTerkirim[1] ?? "{}") as Record<string, unknown>;
    assert.equal("generationConfig" in tanpa, false, "tanpa reasoning tidak boleh ada generationConfig sama sekali");
  });
});
