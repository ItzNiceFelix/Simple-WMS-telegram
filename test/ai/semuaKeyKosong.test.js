// test/ai/semuaKeyKosong.test.js (VERIFIER - skenario terburuk #1b)
// Semua key provider OpenAI-compatible kosong + textProvider "kenari".
// Cek: error akhir jelas (bukan crash/TypeError membingungkan).
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

const NAMA_ENV = ["KENARI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];
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

test("WORST#1b: semua key kompatibel kosong -> error akhir jelas, bukan crash", async () => {
  for (const n of NAMA_ENV) delete process.env[n];
  // fallbackChain memuat semua provider kompatibel; gemini dilewati lewat key absen.
  await db.collection("system_settings").doc("ai").set(
    { textProvider: "kenari", fallbackChain: ["kenari", "groq", "openai", "openrouter"], totalTimeoutMs: 240000 },
    { merge: false }
  );

  const fetchAsli = global.fetch;
  let fetchCount = 0;
  global.fetch = async () => { fetchCount++; throw new Error("fetch tidak boleh terjadi - semua key kosong"); };

  let err;
  try {
    await generateContentDenganFallback({
      tools: [],
      systemInstruction: "sys",
      contents: [{ role: "user", parts: [{ text: "halo" }] }],
    });
  } catch (e) {
    err = e;
  } finally {
    global.fetch = fetchAsli;
  }

  assert.ok(err, "harus ada error akhir (semua provider gagal)");
  console.log("=== ERROR AKHIR ===");
  console.log("name:", err.name, "| message:", err.message, "| perluFallbackProvider:", err.perluFallbackProvider);
  assert.equal(fetchCount, 0, "tak ada fetch karena semua key kosong");
  // Error akhir berasal dari jalur Gemini (fallback terakhir), bukan TypeError.
  assert.ok(!(err instanceof TypeError), "tidak boleh TypeError (crash tak terkendali)");
});
