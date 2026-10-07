// test/ai/fallbackTanpaChain.test.js (VERIFIER - skenario terburuk #1)
// textProvider "kenari", KENARI_API_KEY kosong, dan dokumen TIDAK punya fallbackChain.
// Bahwa pesan tetap sampai ke provider kerja (bukan throw fatal).
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

test("WORST#1: kenari tanpa key + TANPA fallbackChain di dokumen -> sampai provider kerja", async () => {
  delete process.env.KENARI_API_KEY;
  process.env.GROQ_API_KEY = "dummy-groq";
  delete process.env.GEMINI_API_KEY;

  // Sengaja TIDAK ada field fallbackChain -> default ["gemini","groq"] dipakai.
  await db.collection("system_settings").doc("ai").set(
    { textProvider: "kenari", totalTimeoutMs: 240000 },
    { merge: false }
  );

  const urls = [];
  const fetchAsli = global.fetch;
  global.fetch = async (url) => {
    urls.push(url);
    if (String(url).includes("groq")) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "dari groq", tool_calls: [] } }] }) };
    }
    // kenari TIDAK boleh pernah di-fetch (key absen -> throw sebelum fetch).
    throw new Error("fetch tak terduga: " + url);
  };

  try {
    const hasil = await generateContentDenganFallback({
      tools: [],
      systemInstruction: "sys",
      contents: [{ role: "user", parts: [{ text: "halo" }] }],
    });
    assert.equal(hasil.response.text(), "dari groq", "harus dapat jawaban dari provider kerja (groq)");
    assert.equal(urls.some((u) => String(u).includes("kenari")), false, "kenari tidak boleh di-fetch (key absen)");
    assert.ok(urls.some((u) => String(u).includes("groq")), "groq harus dicoba");
  } finally {
    global.fetch = fetchAsli;
  }
});
