// test/ai/adapters/openaiCompat.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.TEST_API_KEY = "sk-test";
const { buatProviderOpenAiCompat } = require("../../../lib/ai/adapters/openaiCompat");

function testFactory(overrides = {}) {
  const defaultConfig = {
    label: "test",
    baseUrl: "https://example.test/v1/chat/completions",
    apiKeyEnv: "TEST_API_KEY",
    model: "test-model",
    models: ["test-model-a", "test-model-b"],
    timeoutMs: 5000,
  };
  return buatProviderOpenAiCompat({ ...defaultConfig, ...overrides });
}

let rekam = [];

function buatStubFetch(responses) {
  let index = 0;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    rekam.push(body);
    const res = responses[index++] || responses[0];
    if (typeof res === "function") return res(body);
    return { ok: true, status: 200, json: async () => res };
  };
}

test.beforeEach(() => {
  rekam = [];
});

test("tanpa tools => body TIDAK memuat parallel_tool_calls", async () => {
  const factory = testFactory();
  buatStubFetch([{ choices: [{ message: { content: "hi" } }] }]);
  await factory.panggilOpenAiCompat({ systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "halo" }] }] });
  assert.equal(rekam[0].parallel_tool_calls, undefined, "parallel_tool_calls harus absen");
});

test("dengan tools => parallel_tool_calls true", async () => {
  const factory = testFactory();
  const tools = [{ name: "t", description: "d", parameters: {} }];
  buatStubFetch([{ choices: [{ message: { content: "ok", tool_calls: [] } }] }]);
  await factory.panggilOpenAiCompat({ tools, systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "halo" }] }] });
  assert.equal(rekam[0].parallel_tool_calls, true);
});

test("text + functionCall dalam parts yg sama => text TIDAK hilang", async () => {
  const factory = testFactory();
  const tools = [{ name: "t", description: "d", parameters: {} }];
  buatStubFetch([
    { choices: [{ message: { content: "sebentar", tool_calls: [{ id: "call_1", type: "function", function: { name: "t", arguments: "{}" } }] } }] },
  ]);
  const contents = [
    { role: "user", parts: [{ text: "halo" }] },
    { role: "model", parts: [{ text: "sebentar" }, { functionCall: { name: "t", args: {} } }] },
  ];
  await factory.panggilOpenAiCompat({ tools, systemInstruction: "s", contents });
  // Cek bahwa messages[1] (assistant) punya content "sebentar"
  const assistantMsg = rekam[0].messages.find((m) => m.role === "assistant" && m.tool_calls); assert.equal(assistantMsg.content, "sebentar", "text assistant harus tetap ada");
});

test("respons OK tapi body non-JSON => error layak fallback", async () => {
  const factory = testFactory();
  global.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } });
  await assert.rejects(
    factory.panggilOpenAiCompat({ systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "x" }] }] }),
    (err) => {
      assert.equal(err.isNetworkError, true, "harus flagged sbg network error");
      return true;
    }
  );
});

test("429 => fallback; 400 => TIDAK fallback", async () => {
  const factory = testFactory();
  global.fetch = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  await assert.rejects(
    factory.panggilOpenAiCompat({ systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "x" }] }] }),
    (err) => {
      assert.equal(factory.apakahErrorBolehFallback(err), true, "429 harus fallback");
      return true;
    }
  );

  global.fetch = async () => ({ ok: false, status: 400, text: async () => "bad request" });
  await assert.rejects(
    factory.panggilOpenAiCompat({ systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "x" }] }] }),
    (err) => {
      assert.equal(factory.apakahErrorBolehFallback(err), false, "400 jangan fallback");
      return true;
    }
  );
});

test("model override lewat modelIndex (jika models tersedia)", async () => {
  const factory = testFactory();
  buatStubFetch([{ choices: [{ message: { content: "final" } }] }]);
  await factory.panggilOpenAiCompat({ systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "halo" }] }], modelIndex: 1 });
  assert.equal(rekam[0].model, "test-model-b", "harus pakai model ke-2");

  rekam = [];
  await factory.panggilOpenAiCompat({ systemInstruction: "s", contents: [{ role: "user", parts: [{ text: "halo" }] }], modelIndex: 99 });
  assert.equal(rekam[0].model, "test-model", "out-of-range => default");
});