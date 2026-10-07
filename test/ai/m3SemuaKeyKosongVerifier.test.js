// test/ai/m3SemuaKeyKosongVerifier.test.js (VERIFIER M3)
// Semua key provider kosong, textProvider "kenari", fallbackChain default ["gemini","groq"].
// Harapan: error akhir menyebut provider terpilih (Kenari), tidak menyesatkan, tidak crash.
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

test("M3: semua key kosong + textProvider kenari -> error rinci, sebut Kenari, tidak crash", async () => {
  for (const n of NAMA_ENV) delete process.env[n];
  // fallbackChain TIDAK di-set -> default ["gemini","groq"].
  await db.collection("system_settings").doc("ai").set(
    { textProvider: "kenari", totalTimeoutMs: 240000 },
    { merge: false }
  );

  let err = null;
  try {
    await generateContentDenganFallback({
      tools: [],
      systemInstruction: "sys",
      contents: [{ role: "user", parts: [{ text: "halo" }] }],
    });
  } catch (e) {
    err = e;
  }

  console.log("=== M3 ERROR AKHIR ===");
  console.log("name:", err && err.name);
  console.log("message:", err && err.message);
  console.log("perluFallbackProvider:", err && err.perluFallbackProvider);
  console.log("peringatanProvider:", err && err.peringatanProvider);

  assert.ok(err, "harus ada error akhir");
  assert.ok(!(err instanceof TypeError), "tidak boleh TypeError");
  assert.match(err.message, /Semua provider AI gagal\. Rincian/);
  assert.match(err.message, /Kenari/, "harus menyebut provider terpilih Kenari");
  assert.match(err.message, /KENARI_API_KEY/, "harus sebut env key yang hilang");
  assert.match(err.message, /GEMINI_API_KEY|Gemini/, "harus mencakup penyebab gemini juga");
});
