// test/envM4Verifier.test.js (VERIFIER M4)
// env.js tidak boleh hardcode GEMINI_API_KEY; apiKeyEnv gemini dari registry.
const test = require("node:test");
const assert = require("node:assert/strict");

const { PRESET_PROVIDER } = require("../lib/ai/registry");
const { peringatkanProviderTanpaKey } = require("../lib/config/env");

const asliProvider = process.env.AI_PROVIDER_TEXT;
const asliGemini = process.env.GEMINI_API_KEY;
const asliWarn = console.warn;
function pulihkan() {
  if (asliProvider === undefined) delete process.env.AI_PROVIDER_TEXT; else process.env.AI_PROVIDER_TEXT = asliProvider;
  if (asliGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = asliGemini;
  console.warn = asliWarn;
}
test.afterEach(pulihkan);
test.after(pulihkan);

test("M4: registry gemini punya apiKeyEnv GEMINI_API_KEY", () => {
  assert.equal(PRESET_PROVIDER.gemini.apiKeyEnv, "GEMINI_API_KEY");
  assert.equal(PRESET_PROVIDER.gemini.kind, "gemini");
  assert.equal(PRESET_PROVIDER.gemini.label, "Gemini");
  console.log("=== M4 REGISTRY ===");
  console.log("gemini:", JSON.stringify(PRESET_PROVIDER.gemini));
});

test("M4: env gemini tanpa key -> warn menyebut GEMINI_API_KEY", () => {
  process.env.AI_PROVIDER_TEXT = "gemini";
  delete process.env.GEMINI_API_KEY;
  const pesan = [];
  console.warn = (...a) => pesan.push(a.join(" "));
  peringatkanProviderTanpaKey();
  console.warn = asliWarn;
  console.log("=== M4 WARN (key kosong) ===");
  console.log(JSON.stringify(pesan));
  assert.equal(pesan.length, 1);
  assert.match(pesan[0], /GEMINI_API_KEY/);
});

test("M4: env gemini dengan key -> TIDAK warn", () => {
  process.env.AI_PROVIDER_TEXT = "gemini";
  process.env.GEMINI_API_KEY = "dummy";
  const pesan = [];
  console.warn = (...a) => pesan.push(a.join(" "));
  peringatkanProviderTanpaKey();
  console.warn = asliWarn;
  console.log("=== M4 WARN (key ada) ===", JSON.stringify(pesan));
  assert.equal(pesan.length, 0);
});
