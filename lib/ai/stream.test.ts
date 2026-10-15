// lib/ai/stream.test.ts — Jalur STREAMING OpenAI-compatible (`/chat/completions`).
//
// KENAPA TEST INI ADA: tiga cacat di jalur ini tidak kelihatan dari kode biasa —
// (1) `await fetch` tanpa timer fase hubung menggantung selamanya saat provider menahan
// header, (2) timer "total" yang dibuat ulang tiap iterasi membuat cabang timeout total
// jadi KODE MATI sehingga stream bisa berjalan tanpa akhir, (3) teks pikiran
// (`delta.reasoning_content`) tercampur ke jawaban user. Semua dikunci di sini.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { streamJson, type MintaStream, type PotonganStream } from "./stream";
import type { BagianChat } from "./http";

const PESAN: BagianChat[] = [{ role: "user", teks: "halo" }];

/** Permintaan stream dengan nilai wajar; `tambahan` menimpa bagian yang sedang diuji. */
function minta(tambahan: Partial<MintaStream> = {}): MintaStream {
  return {
    baseUrl: "https://contoh.test/v1",
    apiKey: "key-uji",
    provider: "kenari",
    model: "model-uji",
    pesan: PESAN,
    // Timer nyata tapi kecil: stream palsu selesai seketika, jadi nilai ini hanya memastikan
    // uji tidak menggantung bila ada yang salah.
    timeoutMs: 500,
    totalMs: 2000,
    ...tambahan,
  };
}

/** Response 200 dengan badan SSE. */
function responsSSE(body: ReadableStream<Uint8Array>): Response {
  return { ok: true, status: 200, body } as unknown as Response;
}

/** SSE palsu bentuk OpenAI: satu event per baris, ditutup `[DONE]`. */
function sseOpenai(baris: unknown[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of baris) c.enqueue(enc.encode(`data: ${JSON.stringify(b)}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

/** Jalankan stream lalu kumpulkan potongan — gagal bila `streamJson` tidak ok. */
async function kumpulkan(m: MintaStream): Promise<PotonganStream[]> {
  const s = await streamJson(m);
  if (!s.ok) throw new Error(`stream harus ok: ${s.error}`);
  const potongan: PotonganStream[] = [];
  for await (const p of s.iter) potongan.push(p);
  return potongan;
}

describe("streamJson — pikiran tidak pernah masuk delta", () => {
  it("delta.reasoning_content masuk `pikir`, bukan `delta`", async () => {
    globalThis.fetch = (async () =>
      responsSSE(
        sseOpenai([
          { choices: [{ delta: { reasoning_content: "mikir" } }] },
          { choices: [{ delta: { content: "Jawaban" } }] },
          { choices: [{ delta: { content: "", reasoning_content: " lagi" } }] },
        ])
      )) as unknown as typeof fetch;

    const potongan = await kumpulkan(minta());
    assert.equal(potongan.map((p) => p.delta).join(""), "Jawaban", "hanya jawaban yang boleh masuk delta");
    assert.equal(potongan.map((p) => p.pikir ?? "").join(""), "mikir lagi", "teks pikiran harus lewat `pikir`");
  });

  it("delta.reasoning (OpenRouter) juga masuk `pikir`", async () => {
    globalThis.fetch = (async () =>
      responsSSE(
        sseOpenai([
          { choices: [{ delta: { reasoning: "mikir" } }] },
          { choices: [{ delta: { content: "Jawaban" } }] },
        ])
      )) as unknown as typeof fetch;

    const potongan = await kumpulkan(minta({ provider: "openrouter" }));
    assert.equal(potongan.map((p) => p.delta).join(""), "Jawaban");
    assert.equal(potongan.map((p) => p.pikir ?? "").join(""), "mikir");
  });
});

describe("streamJson — finish_reason", () => {
  it("finish_reason length diteruskan sebagai selesaiAlasan tanpa dilempar", async () => {
    globalThis.fetch = (async () =>
      responsSSE(
        sseOpenai([
          { choices: [{ delta: { content: "terpotong" } }] },
          { choices: [{ delta: {}, finish_reason: "length" }] },
        ])
      )) as unknown as typeof fetch;

    const potongan = await kumpulkan(minta());
    assert.equal(potongan[potongan.length - 1]?.selesaiAlasan, "length", "alasan selesai harus diteruskan apa adanya");
  });
});

describe("streamJson — pagar waktu", () => {
  it("fetch yang tidak membalas header digagalkan timeout fase hubung (bukan menggantung)", async () => {
    // Provider yang mengantre dan belum mengirim header: fetch palsu ini hanya selesai
    // kalau signal di-abort — persis perilaku fetch asli saat AbortController menyala.
    // Timer NYATA (kecil) disengaja di sini: yang diuji justru jam dinding — plafon
    // fase hubung pada fetch/AbortController asli, yang tidak bisa digerakkan jam palsu.
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
    const s = await streamJson(minta({ timeoutMs: 40, totalMs: 5000 }));
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
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: `x${n++}` } }] })}\n\n`));
      },
    });
    globalThis.fetch = (async () => responsSSE(banjir)) as unknown as typeof fetch;

    const s = await streamJson(minta({ timeoutMs: 80, totalMs: 300 }));
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
