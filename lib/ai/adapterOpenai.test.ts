// lib/ai/adapterOpenai.test.ts — Bentuk `tools[]` yang benar-benar dikirim ke provider
// OpenAI-compatible (openai/groq/openrouter/kenari).
//
// KENAPA TEST INI ADA (dari kegagalan produksi "Sunting kanvas"):
//   Route editor kanvas mengirim SKEMA_TOOL_EDITOR yang SUDAH berbentuk wire
//   (`{type:"function", function:{name,…}}`) ke jalur spesifikasi internal. `keToolOpenai`
//   waktu itu hanya membaca `s.nama`, jadi `name` menjadi STRING KOSONG dan Groq/Kenari
//   menolaknya dengan `invalid_request_error` (HTTP 400). Nama kosong = penyebab sebenarnya,
//   bukan prompt atau kredensial. Test ini mengunci KEDUA bentuk input (wire & flat) supaya
//   name tidak pernah kosong lagi, dan mengunci body permintaan apa adanya (bukan hasil olah
//   ulang di memori), karena yang diperiksa provider adalah body itu.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatOpenai, type OpsiAdapter } from "./adapterOpenai";
import { SKEMA_TOOL_EDITOR, SPESIFIKASI_TOOL_EDITOR } from "../desain/aiEditor";
import type { BagianChat } from "./http";

const PESAN: BagianChat[] = [{ role: "user", teks: "tambah teks Halo" }];

/** Opsi adapter dengan nilai wajar; baseUrl TANPA garis miring di akhir (diuji di URL). */
function opsi(tambahan: Partial<OpsiAdapter> = {}): OpsiAdapter {
  return { baseUrl: "https://api.kenari.id/v1", apiKey: "key-uji", provider: "kenari", timeoutMs: 500, ...tambahan };
}

/**
 * Response 200 bentuk chat completion minimal. Stub `fetch` di bawah yang menangkap body
 * permintaan, jadi yang diuji adalah body nyata, bukan fungsi `keToolOpenai` (tidak diekspor).
 */
function responsSukses(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
  } as unknown as Response;
}

/** Jalankan `chatOpenai` sambil menangkap body permintaan; gagal bila hasilnya bukan ok. */
async function jalankan(
  permintaan: Parameters<typeof chatOpenai>[1],
  o = opsi()
): Promise<{ body: Record<string, unknown>; url: string; header: Record<string, string> }> {
  let url = "";
  let init: RequestInit | undefined;
  globalThis.fetch = (async (u: unknown, i?: RequestInit) => {
    url = String(u);
    init = i;
    return responsSukses();
  }) as unknown as typeof fetch;

  const h = await chatOpenai(o, permintaan);
  if (!h.ok) throw new Error(`permintaan harus ok: ${h.error}`);

  return {
    body: JSON.parse(String(init?.body ?? "")) as Record<string, unknown>,
    url,
    header: (init?.headers ?? {}) as Record<string, string>,
  };
}

describe("chatOpenai — tool bentuk wire (penyebab 400 'Sunting kanvas')", () => {
  it("SKEMA_TOOL_EDITOR dibungkus sekali lagi, name terisi, tanpa kunci flat yang tersisa", async () => {
    const { body, url, header } = await jalankan({ model: "solar-mini4", pesan: PESAN, tool: [SKEMA_TOOL_EDITOR] });

    const tools = body.tools as { type?: string; function?: Record<string, unknown>; nama?: unknown; deskripsi?: unknown; parameter?: unknown }[];
    assert.equal(tools.length, 1, "satu tool masuk, satu tool keluar");
    assert.equal(tools[0].type, "function");
    assert.equal(
      tools[0].function?.name,
      "terapkan_operasi_kanvas",
      "name kosong membuat provider menolak dengan invalid_request_error (HTTP 400)"
    );
    const params = tools[0].function?.parameters as { properties?: Record<string, unknown> };
    assert.ok(params.properties?.operasi, "skema parameter asli harus ikut utuh, bukan dibuang");

    // Bentuk flat yang ikut terbawa akan membuat provider melihat kunci asing di level tool.
    assert.equal(tools[0].nama, undefined);
    assert.equal(tools[0].deskripsi, undefined);
    assert.equal(tools[0].parameter, undefined);

    assert.equal(url, "https://api.kenari.id/v1/chat/completions", "endpoint harus persis ini");
    assert.equal(header.Authorization, "Bearer key-uji");
  });

  it("SPESIFIKASI_TOOL_EDITOR menghasilkan tool yang IDENTIK dengan bentuk wire", async () => {
    const wire = await jalankan({ model: "solar-mini4", pesan: PESAN, tool: [SKEMA_TOOL_EDITOR] });
    const flat = await jalankan({ model: "solar-mini4", pesan: PESAN, tool: [SPESIFIKASI_TOOL_EDITOR] });

    assert.deepEqual(
      (flat.body.tools as unknown[])[0],
      (wire.body.tools as unknown[])[0],
      "keduanya dibangun dari TOOL_EDITOR yang sama, jadi wire-nya tidak boleh berbeda"
    );
  });
});

describe("chatOpenai — tool bentuk flat lama & batas lain", () => {
  it("bentuk flat internal {nama, deskripsi, parameter} tetap diterjemahkan", async () => {
    const { body } = await jalankan({
      model: "solar-mini4",
      pesan: PESAN,
      tool: [{ nama: "cekStok", deskripsi: "y", parameter: { type: "object", properties: {} } }],
    });

    const tools = body.tools as { function?: Record<string, unknown> }[];
    assert.equal(tools[0].function?.name, "cekStok", "kontrak lib/ai/tools.ts tidak boleh rusak oleh perbaikan ini");
    assert.equal(tools[0].function?.description, "y");
    assert.deepEqual(tools[0].function?.parameters, { type: "object", properties: {} });
  });

  it("wire dengan name kosong tidak pernah keluar sebagai name kosong", async () => {
    const { body } = await jalankan({
      model: "solar-mini4",
      pesan: PESAN,
      tool: [{ type: "function", function: { name: "", description: "d", parameters: { type: "object" } } }],
    });

    const tools = body.tools as { function?: { name?: string } }[];
    assert.notEqual(
      tools[0].function?.name,
      "",
      "name kosong = HTTP 400 invalid_request_error; fallback harus mengisinya"
    );
  });

  it("tanpa tool, kunci tools tidak dikirim sama sekali", async () => {
    const { body } = await jalankan({ model: "solar-mini4", pesan: PESAN });
    assert.equal(body.tools, undefined);
  });
});
