// test/ai/urutanChainVerifier.test.js (VERIFIER M2)
// Probe: fallbackChain ["gemini","groq"], textProvider "kenari" (key ada tapi 429).
// GEMINI + GROQ key ada. Harapan: Gemini dipanggil SEBELUM groq (tidak ada fetch groq).
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-project";
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "demo@example.com";
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ||
  crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString().replace(/\n/g, "\\n");

const { installMockFirestore } = require("../helpers/mockFirestore");
const { db } = installMockFirestore();
const { generateContentDenganFallback } = require("../../lib/ai/index");

const NAMA_ENV = ["KENARI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];
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

test("M2: fallbackChain [gemini,groq] -> gemini dipanggil SEBELUM groq (tanpa fetch groq)", async () => {
  process.env.KENARI_API_KEY = "dummy-kenari";
  process.env.GROQ_API_KEY = "dummy-groq";
  process.env.GEMINI_API_KEY = "dummy-gemini";

  await db.collection("system_settings").doc("ai").set(
    { textProvider: "kenari", fallbackChain: ["gemini", "groq"], totalTimeoutMs: 240000 },
    { merge: false }
  );

  // KENARI selalu 429 supaya turun ke fallback.
  const asliFetch = global.fetch;
  const urlDipanggil = [];
  global.fetch = async (url) => {
    urlDipanggil.push(String(url));
    if (String(url).includes("kenari")) {
      return { ok: false, status: 429, text: async () => "rate limited" };
    }
    throw new Error("fetch tak terduga: " + url);
  };

  // Mock Gemini SDK supaya tidak keluar jaringan.
  require("../../lib/gemini/client"); // pastikan modul ter-cache sebelum dimock
  const modGeminiPath = require.resolve("../../lib/gemini/client");
  const asliExport = require.cache[modGeminiPath].exports;
  let geminiDipanggil = 0;
  const asliFn = asliExport.generateContentDenganGeminiSaja;
  asliExport.generateContentDenganGeminiSaja = async () => {
    geminiDipanggil += 1;
    return { response: { text: () => "dari gemini" } };
  };

  let err = null;
  let hasil = null;
  try {
    hasil = await generateContentDenganFallback({
      tools: [],
      systemInstruction: "sys",
      contents: [{ role: "user", parts: [{ text: "halo" }] }],
    });
  } catch (e) {
    err = e;
  } finally {
    aksiRestore();
  }

  function aksiRestore() {
    global.fetch = asliFetch;
    asliExport.generateContentDenganGeminiSaja = asliFn;
  }

  console.log("=== M2 PROBE ===");
  console.log("geminiDipanggil:", geminiDipanggil);
  console.log("fetchUrls:", JSON.stringify(urlDipanggil));
  console.log("hasil text:", hasil ? hasil.response.text() : "(error: " + (err && err.message) + ")");

  assert.equal(err, null, "harus sukses lewat gemini, bukan error");
  assert.equal(geminiDipanggil, 1, "gemini harus dipanggil");
  assert.equal(hasil.response.text(), "dari gemini");
  assert.ok(
    !urlDipanggil.some((u) => u.includes("groq")),
    "groq TIDAK boleh di-fetch (gemini dipanggil lebih dulu)"
  );
});

// Pasangan negatif: bila gemini gagal, groq BARU dipanggil (urutan tetap).
test("M2b: gemini gagal -> groq dipanggil SESUDAHNYA", async () => {
  process.env.KENARI_API_KEY = "dummy-kenari";
  process.env.GROQ_API_KEY = "dummy-groq";
  process.env.GEMINI_API_KEY = "dummy-gemini";

  await db.collection("system_settings").doc("ai").set(
    { textProvider: "kenari", fallbackChain: ["gemini", "groq"], totalTimeoutMs: 240000 },
    { merge: false }
  );

  const asliFetch = global.fetch;
  const urlDipanggil = [];
  global.fetch = async (url) => {
    urlDipanggil.push(String(url));
    if (String(url).includes("kenari")) {
      return { ok: false, status: 429, text: async () => "rate limited" };
    }
    if (String(url).includes("groq")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "dari groq" } }] }),
      };
    }
    throw new Error("fetch tak terduga: " + url);
  };

  require("../../lib/gemini/client"); // pastikan modul ter-cache sebelum dimock
  const modGeminiPath = require.resolve("../../lib/gemini/client");
  const asliExport = require.cache[modGeminiPath].exports;
  const asliFn = asliExport.generateContentDenganGeminiSaja;
  let geminiDipanggil = 0;
  asliExport.generateContentDenganGeminiSaja = async () => {
    geminiDipanggil += 1;
    const e = new Error("gemini 503");
    e.status = 503;
    throw e;
  };

  let err = null;
  let hasil = null;
  try {
    hasil = await generateContentDenganFallback({
      tools: [],
      systemInstruction: "sys",
      contents: [{ role: "user", parts: [{ text: "halo" }] }],
    });
  } catch (e) {
    err = e;
  } finally {
    global.fetch = asliFetch;
    asliExport.generateContentDenganGeminiSaja = asliFn;
  }

  console.log("=== M2b PROBE ===");
  console.log("geminiDipanggil:", geminiDipanggil, "| fetchUrls:", JSON.stringify(urlDipanggil));
  console.log("hasil text:", hasil ? hasil.response.text() : "(error: " + (err && err.message) + ")");

  assert.equal(err, null, "harus sukses lewat groq");
  assert.equal(geminiDipanggil, 1, "gemini dipanggil lebih dulu");
  assert.equal(hasil.response.text(), "dari groq");
  assert.ok(urlDipanggil.some((u) => u.includes("groq")), "groq dipanggil setelah gemini gagal");
});

