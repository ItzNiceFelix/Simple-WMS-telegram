// test/groqClient.test.js
// Kontrak adaptor Groq (lib/gemini/groqClient.js) — stub global.fetch, tanpa jaringan.
// Mengunci 3 bug yg pernah lolos: parallel_tool_calls tanpa tools, teks assistant
// yg dibuang saat ada tool_call, dan respons non-JSON yg harus layak fallback.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GROQ_API_KEY = "uji";
const { panggilGroq, apakahErrorGroqBolehFallback } = require("../lib/gemini/groqClient");

function tangkapBody(responsSukses) {
  const direkam = [];
  global.fetch = async (url, opts) => {
    direkam.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => responsSukses };
  };
  return direkam;
}

test("tanpa tools -> body TIDAK memuat parallel_tool_calls", async () => {
  const rekam = tangkapBody({ choices: [{ message: { content: "hi" } }] });
  await panggilGroq({ systemInstruction: "sys", contents: [{ role: "user", parts: [{ text: "halo" }] }] });
  assert.equal(rekam[0].tools, undefined);
  assert.equal(
    "parallel_tool_calls" in rekam[0],
    false,
    "parallel_tool_calls tanpa tools bikin Groq balas 400"
  );
});

test("dengan tools -> parallel_tool_calls true", async () => {
  const rekam = tangkapBody({ choices: [{ message: { content: "hi" } }] });
  const tools = [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }];
  await panggilGroq({ tools, systemInstruction: "sys", contents: [{ role: "user", parts: [{ text: "halo" }] }] });
  assert.equal(rekam[0].parallel_tool_calls, true);
  assert.equal(rekam[0].tools[0].type, "function");
});

test("text + functionCall dalam parts yg sama -> text TIDAK hilang", async () => {
  const rekam = tangkapBody({ choices: [{ message: { content: "hi" } }] });
  const tools = [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }];
  await panggilGroq({
    tools,
    systemInstruction: "sys",
    contents: [
      { role: "user", parts: [{ text: "halo" }] },
      { role: "model", parts: [{ text: "sebentar ya" }, { functionCall: { name: "t", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "t", response: { ok: 1 } } }] },
    ],
  });
  const assistant = rekam[0].messages.find((m) => m.tool_calls);
  assert.equal(assistant.content, "sebentar ya", "kalimat model sebelum tool call harus ikut terkirim");
  const toolMsg = rekam[0].messages.find((m) => m.role === "tool");
  assert.equal(toolMsg.tool_call_id, assistant.tool_calls[0].id, "id tool harus cocok dgn id tool_call");
});

test("respons OK tapi body non-JSON -> error layak fallback", async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    },
  });
  await assert.rejects(
    () => panggilGroq({ tools: [{ name: "t", description: "d", parameters: {} }], systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "x" }] }] }),
    (err) => {
      assert.equal(apakahErrorGroqBolehFallback(err), true, "harus jatuh ke Gemini, bukan mati");
      return true;
    }
  );
});

test("429 -> layak fallback; 400 -> TIDAK", async () => {
  global.fetch = async () => ({ ok: false, status: 429, text: async () => "rate limited", json: async () => ({}) });
  await assert.rejects(
    () => panggilGroq({ tools: [{ name: "t", description: "d", parameters: {} }], systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "x" }] }] }),
    (err) => {
      assert.equal(apakahErrorGroqBolehFallback(err), true);
      return true;
    }
  );

  global.fetch = async () => ({ ok: false, status: 400, text: async () => "bad request", json: async () => ({}) });
  await assert.rejects(
    () => panggilGroq({ tools: [{ name: "t", description: "d", parameters: {} }], systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "x" }] }] }),
    (err) => {
      assert.equal(apakahErrorGroqBolehFallback(err), false, "400 = masalah request, jangan fallback");
      return true;
    }
  );
});
