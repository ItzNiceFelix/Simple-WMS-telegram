// test/providerAiParitas.test.js
// Paritas daftar provider AI: shim TS (UI/bot) == registry backend == model aiSettings.
// Menangkap drift bila salah satu daftar diubah tanpa yang lain (gate plan-provider-ui.md).
const crypto = require("crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-project";
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "demo@example.com";
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ||
  crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .replace(/\n/g, "\\n");

const { installMockFirestore } = require("./helpers/mockFirestore");
installMockFirestore();

// Runtime shim = CJS browser-safe (providerAi.ts hanya facade tipe di atasnya).
const { PROVIDER_AI, LABEL_PROVIDER, adalahProviderAi } = require("../lib/dashboard/providerAi.js");
const { PROVIDER_VALID: REGISTRY_VALID } = require("../lib/ai/registry.js");
const { PROVIDER_VALID: MODEL_VALID } = require("../lib/models/aiSettings.js");

const HARAPAN = ["gemini", "groq", "kenari", "openai", "openrouter"];

test("daftar shim == registry == model", () => {
  assert.deepEqual([...PROVIDER_AI], HARAPAN);
  assert.deepEqual([...REGISTRY_VALID], HARAPAN);
  assert.deepEqual([...MODEL_VALID], HARAPAN);
  assert.deepEqual([...PROVIDER_AI], [...REGISTRY_VALID]);
  assert.deepEqual([...PROVIDER_AI], [...MODEL_VALID]);
});

test("LABEL_PROVIDER lengkap 5 entri dengan label benar", () => {
  assert.equal(Object.keys(LABEL_PROVIDER).length, 5);
  assert.deepEqual(LABEL_PROVIDER, {
    gemini: "Gemini",
    groq: "Groq",
    kenari: "Kenari",
    openai: "OpenAI",
    openrouter: "OpenRouter",
  });
});

test("adalahProviderAi: true untuk 5 provider, false untuk tak dikenal", () => {
  for (const p of HARAPAN) {
    assert.equal(adalahProviderAi(p), true, `${p} harus valid`);
  }
  for (const v of ["foo", "", "GEMINI", "gpt-4o", "kenari "]) {
    assert.equal(adalahProviderAi(v), false, `${JSON.stringify(v)} harus ditolak`);
  }
});

// --- Paritas handler Telegram (B1 review: daftar/label handler tak boleh drift) ---
const { tombolSettings, LABEL_PROVIDER: HANDLER_LABEL } = require("../lib/handlers/handleSettings.js");

test("daftar tombol handler == PROVIDER_AI (tidak bisa drift)", () => {
  const callbackData = tombolSettings("gemini").flat().map((b) => b.callback_data);
  const dariCallback = callbackData.map((c) => c.replace("settings_ai:", ""));
  assert.deepEqual(dariCallback, [...PROVIDER_AI]);

  const labelDariTombol = tombolSettings("gemini").flat().map((b) => b.text.replace("✅ ", ""));
  assert.deepEqual(labelDariTombol, PROVIDER_AI.map((p) => LABEL_PROVIDER[p]));
});

test("LABEL_PROVIDER handler identik dengan shim UI", () => {
  assert.deepEqual(HANDLER_LABEL, LABEL_PROVIDER);
});