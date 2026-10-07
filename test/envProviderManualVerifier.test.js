// test/envProviderManualVerifier.test.js (VERIFIER #3)
// Panggil peringatkanProviderTanpaKey() langsung, override console.warn, cek output.
const test = require("node:test");
const assert = require("node:assert/strict");
const { peringatkanProviderTanpaKey } = require("../lib/config/env");

const NAMA_ENV = ["AI_PROVIDER_TEXT","GROQ_API_KEY","KENARI_API_KEY","GEMINI_API_KEY","OPENAI_API_KEY","OPENROUTER_API_KEY"];
const asli = {};
for (const n of NAMA_ENV) asli[n] = process.env[n];
function pulihkan() {
  for (const n of NAMA_ENV) { if (asli[n] === undefined) delete process.env[n]; else process.env[n] = asli[n]; }
}
test.afterEach(pulihkan);
test.after(pulihkan);

function tangkap(fn) {
  const out = [];
  const w = console.warn;
  console.warn = (...a) => out.push(a.join(" "));
  try { fn(); } finally { console.warn = w; }
  return out;
}

test("V3a default groq tanpa key -> warn 1x sebut GROQ_API_KEY", () => {
  delete process.env.AI_PROVIDER_TEXT;
  delete process.env.GROQ_API_KEY;
  const out = tangkap(peringatkanProviderTanpaKey);
  console.log("V3a output:", JSON.stringify(out));
  assert.equal(out.length, 1);
  assert.ok(out[0].includes("GROQ_API_KEY"));
});

test("V3b kenari key ADA -> warn 0x", () => {
  process.env.AI_PROVIDER_TEXT = "kenari";
  process.env.KENARI_API_KEY = "x";
  const out = tangkap(peringatkanProviderTanpaKey);
  console.log("V3b output:", JSON.stringify(out));
  assert.equal(out.length, 0);
});

test("V3c provider tak dikenal -> tidak crash, keluar warn informatif", () => {
  process.env.AI_PROVIDER_TEXT = "hantu";
  const out = tangkap(peringatkanProviderTanpaKey);
  console.log("V3c output:", JSON.stringify(out));
  assert.equal(out.length, 1);
  assert.ok(out[0].includes("tidak dikenal"));
});

test("V3d gemini tanpa GEMINI_API_KEY -> warn GEMINI_API_KEY", () => {
  process.env.AI_PROVIDER_TEXT = "gemini";
  delete process.env.GEMINI_API_KEY;
  const out = tangkap(peringatkanProviderTanpaKey);
  console.log("V3d output:", JSON.stringify(out));
  assert.equal(out.length, 1);
  assert.ok(out[0].includes("GEMINI_API_KEY"));
});

test("V3e provider uppercase 'KENARI' dinormalkan -> key ada -> 0 warn", () => {
  process.env.AI_PROVIDER_TEXT = "KENARI";
  process.env.KENARI_API_KEY = "x";
  const out = tangkap(peringatkanProviderTanpaKey);
  console.log("V3e output:", JSON.stringify(out));
  assert.equal(out.length, 0);
});
