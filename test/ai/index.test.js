// test/ai/index.test.js
// Kontrak dispatcher fallback chain: dispatch ke provider terpilih, fallback antar
// provider, dan jalur langsung Gemini. Pakai mock Firestore (bukan Module.require drop-in).
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

// Env Firebase dummy supaya lib/firebase.js bisa load (dipakai lewat mock).
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-project";
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "demo@example.com";
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ||
  crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .replace(/\n/g, "\\n");

const { installMockFirestore } = require("../helpers/mockFirestore");
const { db } = installMockFirestore();

const { generateContentDenganFallback } = require("../../lib/ai/index");

const KUNCI_ENV = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  kenari: "KENARI_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};
for (const k of Object.keys(KUNCI_ENV)) process.env[KUNCI_ENV[k]] = "test-key";

// ambilPengaturanAI punya cache 30s. Test menulis dokumen berbeda tiap test, jadi
// paksa cache segar dengan reset modul aiSettings (dan index) sebelum tiap test.
function muatUlang() {
  for (const m of ["../../lib/models/aiSettings", "../../lib/ai/index"]) {
    const p = require.resolve(m);
    if (require.cache[p]) {
      const mod = require.cache[p].exports;
      if (mod) {
        try {
          Object.keys(mod).forEach((k) => delete mod[k]);
        } catch {
          /* modul frozen: abaikan */
        }
      }
    }
  }
  delete require.cache[require.resolve("../../lib/models/aiSettings")];
  delete require.cache[require.resolve("../../lib/ai/index")];
  return require("../../lib/ai/index").generateContentDenganFallback;
}

async function setSettings(data) {
  await db.collection("system_settings").doc("ai").set(data, { merge: false });
}

test("dispatch ke provider yang dipilih (kenari)", async () => {
  await setSettings({ textProvider: "kenari", totalTimeoutMs: 10000 });
  const dispatcher = muatUlang();

  let fetchCallCount = 0;
  const fetchAsli = global.fetch;
  global.fetch = async (url, opts) => {
    fetchCallCount++;
    assert.equal(url, "https://api.kenari.id/v1/chat/completions");
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers["Content-Type"], "application/json");
    assert.equal(opts.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(opts.body);
    assert.equal(body.model, "gpt-oss-120b");
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "dari kenari", tool_calls: [] } }] }),
    };
  };

  try {
    const result = await dispatcher({
      tools: [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }],
      systemInstruction: "system pesan",
      contents: [{ role: "user", parts: [{ text: "halo" }] }],
    });
    assert.equal(fetchCallCount, 1, "seharusnya hanya satu pemanggilan fetch");
    assert.equal(result.response.text(), "dari kenari");
  } finally {
    global.fetch = fetchAsli;
  }
});

test("fallback chain: kenari 429 -> groq", async () => {
  await setSettings({
    textProvider: "kenari",
    totalTimeoutMs: 10000,
    fallbackChain: ["kenari", "groq", "gemini"],
  });
  const dispatcher = muatUlang();

  const fetchCalls = [];
  const fetchAsli = global.fetch;
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    if (url.includes("kenari")) {
      return { ok: false, status: 429, text: async () => "rate limited" };
    }
    if (url.includes("groq")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "dari groq fallback", tool_calls: [] } }] }),
      };
    }
    throw new Error("tidak seharusnya memanggil gemini karena groq sudah sukses");
  };

  try {
    const result = await dispatcher({
      systemInstruction: "system",
      contents: [{ role: "user", parts: [{ text: "halo" }] }],
    });
    assert.equal(fetchCalls.length, 2, "harus ada dua percobaan fetch (kenari lalu groq)");
    assert.equal(fetchCalls[0].url.includes("kenari"), true, "pertama kenari");
    assert.equal(fetchCalls[1].url.includes("groq"), true, "kedua groq");
    assert.equal(result.response.text(), "dari groq fallback");
  } finally {
    global.fetch = fetchAsli;
  }
});

test("gemini provider langsung memakai generateContentDenganGeminiSaja", async () => {
  await setSettings({ textProvider: "gemini", totalTimeoutMs: 10000 });
  const dispatcher = muatUlang();

  const geminiPath = require.resolve("../../lib/gemini/client");
  const sebelum = require.cache[geminiPath] ? require.cache[geminiPath].exports : null;
  const asliFn = sebelum && sebelum.generateContentDenganGeminiSaja;
  // Paksa load modul klien lalu ganti fungsinya (index.js require lazy saat dipanggil).
  const klien = require("../../lib/gemini/client");
  const spill = klien.generateContentDenganGeminiSaja;
  klien.generateContentDenganGeminiSaja = async () => ({ response: { text: () => "dari gemini langsung" } });

  try {
    const result = await dispatcher({ contents: [{ role: "user", parts: [{ text: "hai" }] }] });
    assert.equal(result.response.text(), "dari gemini langsung");
  } finally {
    if (asliFn) klien.generateContentDenganGeminiSaja = asliFn;
    else klien.generateContentDenganGeminiSaja = spill;
  }
});
