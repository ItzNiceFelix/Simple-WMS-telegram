// test/ai/registry.test.js
// Kontrak registry provider: daftar valid, tiap preset punya apiKeyEnv, dan
// balikanProvider TIDAK pecah saat API key absen (D1).
const test = require("node:test");
const assert = require("node:assert/strict");

const { PRESET_PROVIDER, PROVIDER_VALID, balikanProvider } = require("../../lib/ai/registry");

const HARAPAN = ["gemini", "groq", "kenari", "openai", "openrouter"];

test("PROVIDER_VALID == 5 provider tanpa duplikat", () => {
  assert.deepEqual([...PROVIDER_VALID], HARAPAN);
  assert.equal(new Set(PROVIDER_VALID).size, PROVIDER_VALID.length, "tidak boleh duplikat");
});

test("preset selain gemini punya apiKeyEnv + baseUrl + label", () => {
  for (const p of HARAPAN.filter((x) => x !== "gemini")) {
    const preset = PRESET_PROVIDER[p];
    assert.ok(preset, `preset ${p} harus ada`);
    assert.equal(typeof preset.apiKeyEnv, "string");
    assert.ok(preset.apiKeyEnv.length > 0, `${p}.apiKeyEnv harus terisi`);
    assert.equal(typeof preset.baseUrl, "string");
    assert.ok(preset.label, `${p}.label harus ada`);
  }
});

test("balikanProvider tidak throw saat API key absen (D1)", () => {
  const envName = PRESET_PROVIDER.kenari.apiKeyEnv;
  const asli = process.env[envName];
  delete process.env[envName];
  try {
    let adapter;
    assert.doesNotThrow(() => {
      adapter = balikanProvider({ ...PRESET_PROVIDER.kenari });
    });
    assert.equal(typeof adapter.panggilOpenAiCompat, "function");
    assert.equal(adapter.isGemini, false);
  } finally {
    if (asli !== undefined) process.env[envName] = asli;
  }
});

test("balikanProvider kind gemini -> isGemini true tanpa adapter fetch", () => {
  const adapter = balikanProvider({ kind: "gemini", label: "Gemini" });
  assert.equal(adapter.isGemini, true);
});
