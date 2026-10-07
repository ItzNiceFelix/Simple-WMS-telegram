// test/ai/openaiCompatKeyAbsen.test.js
// D1: provider OpenAI-compatible tanpa API key TIDAK boleh fatal saat dibuat.
// Adapter tetap ada; pemanggilan melempar error bertanda perluFallbackProvider.
const test = require("node:test");
const assert = require("node:assert/strict");

const { buatProviderOpenAiCompat } = require("../../lib/ai/adapters/openaiCompat");

const ENV_KEY = "KENARI_API_KEY";
const asli = process.env[ENV_KEY];
delete process.env[ENV_KEY];

test.after(() => {
  if (asli === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = asli;
});

test("key absen: pembuatan adapter tidak throw", () => {
  assert.doesNotThrow(() =>
    buatProviderOpenAiCompat({
      label: "Kenari",
      baseUrl: "https://api.kenari.id/v1/chat/completions",
      apiKeyEnv: ENV_KEY,
      model: "gpt-oss-120b",
      models: ["gpt-oss-120b"],
    })
  );
});

test("key absen: panggilOpenAiCompat reject dengan perluFallbackProvider", async () => {
  const adapter = buatProviderOpenAiCompat({
    label: "Kenari",
    baseUrl: "https://api.kenari.id/v1/chat/completions",
    apiKeyEnv: ENV_KEY,
    model: "gpt-oss-120b",
    models: ["gpt-oss-120b"],
  });

  await assert.rejects(
    () => adapter.panggilOpenAiCompat({ contents: [] }),
    (err) => {
      assert.equal(err.perluFallbackProvider, true);
      assert.ok(err.message.includes(ENV_KEY), "pesan menyebut nama env key");
      assert.ok(err.message.includes("Kenari"), "pesan menyebut label provider");
      return true;
    }
  );
});

test("key absen: apakahErrorBolehFallback(err) === true", async () => {
  const adapter = buatProviderOpenAiCompat({
    label: "Kenari",
    baseUrl: "https://api.kenari.id/v1/chat/completions",
    apiKeyEnv: ENV_KEY,
    model: "gpt-oss-120b",
    models: ["gpt-oss-120b"],
  });

  let err;
  try {
    await adapter.panggilOpenAiCompat({ contents: [] });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "harus throw");
  assert.equal(adapter.apakahErrorBolehFallback(err), true);
});
