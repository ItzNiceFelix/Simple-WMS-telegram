// test/ai/fallbackKeyAbsen.test.js
// D1: provider terpilih tanpa API key -> dispatcher turun ke fallback, bukan gagal total.
const crypto = require("crypto");
const test = require("node:test");
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

const { installMockFirestore } = require("../helpers/mockFirestore");
const { db } = installMockFirestore();

// Isi dokumen settings agar ambilPengaturanAI membaca dari mock, bukan Firestore nyata.
// (ambilPengaturanAI di-require setelah mock terpasang.)
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

test("provider terpilih tanpa key -> fallback ke gemini, bukan throw", async () => {
  // Text provider = kenari TANPA KENARI_API_KEY set.
  delete process.env.KENARI_API_KEY;
  process.env.GROQ_API_KEY = "dummy-groq";
  process.env.GEMINI_API_KEY = "dummy-gemini";

  await db.collection("system_settings").doc("ai").set(
    {
      textProvider: "kenari",
      fallbackChain: ["gemini"],
      totalTimeoutMs: 240000,
    },
    { merge: true }
  );

  // Paksa cache kedaluwarsa dengan menyimpan ulang lewat simpanProviderAI? Tidak —
  // cukup panggil ambilPengaturanAI({ paksa: true }) tidak tersedia di dispatcher.
  // Karena test ini file terpisah (cache kosong saat load), pembacaan pertama fresh.
  const { generateContentDenganGeminiSaja } = require("../../lib/gemini/client");
  const asliGemini = generateContentDenganGeminiSaja;
  let dipanggil = 0;
  require.cache[require.resolve("../../lib/gemini/client")].exports.generateContentDenganGeminiSaja = async () => {
    dipanggil += 1;
    return { response: { text: () => "dari gemini" } };
  };

  try {
    const hasil = await generateContentDenganFallback({
      tools: [],
      systemInstruction: "sys",
      contents: [{ role: "user", parts: [{ text: "halo" }] }],
    });
    assert.equal(dipanggil, 1, "generateContentDenganGeminiSaja harus dipanggil sebagai fallback");
    assert.equal(hasil.response.text(), "dari gemini");
  } finally {
    require.cache[require.resolve("../../lib/gemini/client")].exports.generateContentDenganGeminiSaja = asliGemini;
  }
});
