// test/providerAiTipeParitas.test.js
// D2: tipe union di providerAi.d.ts harus sinkron dengan nilai PROVIDER_AI di .js.
// tsc hanya baca .d.ts; test ini penjaga drift antara nilai (runtime) dan tipe.
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { PROVIDER_AI, LABEL_PROVIDER } = require("../lib/dashboard/providerAi.js");

const HARAPAN = ["gemini", "groq", "kenari", "openai", "openrouter"];

function bacaUnionDts() {
  const file = path.join(__dirname, "..", "lib", "dashboard", "providerAi.d.ts");
  const teks = fs.readFileSync(file, "utf8");
  const match = teks.match(/export\s+type\s+ProviderAi\s*=\s*([^;]+);/);
  assert.ok(match, "deklarasi `export type ProviderAi = ...;` harus ada di providerAi.d.ts");
  return match[1]
    .split("|")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

test("union di .d.ts == PROVIDER_AI di .js", () => {
  assert.deepEqual([...bacaUnionDts()].sort(), [...PROVIDER_AI].sort());
});

test("LABEL_PROVIDER punya key sama persis dengan PROVIDER_AI", () => {
  assert.deepEqual(Object.keys(LABEL_PROVIDER).sort(), [...PROVIDER_AI].sort());
});

test("panjang 5 dan isi persis 5 provider", () => {
  assert.equal(PROVIDER_AI.length, 5);
  assert.deepEqual([...PROVIDER_AI], HARAPAN);
});
