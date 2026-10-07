// test/envProvider.test.js
// D3: peringatkanProviderTanpaKey() soft-warn provider default tanpa key.
const test = require("node:test");
const assert = require("node:assert/strict");

const { peringatkanProviderTanpaKey } = require("../lib/config/env");

const NAMA_ENV = [
  "AI_PROVIDER_TEXT",
  "GROQ_API_KEY",
  "KENARI_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
];
const asli = {};
for (const n of NAMA_ENV) asli[n] = process.env[n];

function pulihkan() {
  for (const n of NAMA_ENV) {
    if (asli[n] === undefined) delete process.env[n];
    else process.env[n] = asli[n];
  }
}
test.afterEach(pulihkan);
test.after(pulihkan);

// Tangkap console.warn sementara.
function tangkapWarn(fn) {
  const pesan = [];
  const asliWarn = console.warn;
  console.warn = (...args) => pesan.push(args.join(" "));
  try {
    fn();
  } finally {
    console.warn = asliWarn;
  }
  return pesan;
}

test("provider default groq + GROQ_API_KEY kosong -> warn menyebut GROQ_API_KEY", () => {
  process.env.AI_PROVIDER_TEXT = "groq";
  delete process.env.GROQ_API_KEY;
  const pesan = tangkapWarn(() => peringatkanProviderTanpaKey());
  assert.equal(pesan.length, 1);
  assert.ok(pesan[0].includes("GROQ_API_KEY"), `warn harus sebut GROQ_API_KEY, dapat: ${pesan[0]}`);
});

test("provider kenari + KENARI_API_KEY diisi -> TIDAK warn", () => {
  process.env.AI_PROVIDER_TEXT = "kenari";
  process.env.KENARI_API_KEY = "ada-key";
  const pesan = tangkapWarn(() => peringatkanProviderTanpaKey());
  assert.equal(pesan.length, 0);
});

test("provider default tanpa key + key provider lain diisi -> tetap warn provider default", () => {
  process.env.AI_PROVIDER_TEXT = "kenari";
  delete process.env.KENARI_API_KEY;
  process.env.GROQ_API_KEY = "isi-provider-lain";
  const pesan = tangkapWarn(() => peringatkanProviderTanpaKey());
  assert.equal(pesan.length, 1);
  assert.ok(pesan[0].includes("KENARI_API_KEY"), `warn harus sebut KENARI_API_KEY, dapat: ${pesan[0]}`);
});

test("AI_PROVIDER_TEXT tak dikenal -> tidak throw", () => {
  process.env.AI_PROVIDER_TEXT = "provider-hantu";
  assert.doesNotThrow(() => tangkapWarn(() => peringatkanProviderTanpaKey()));
});
