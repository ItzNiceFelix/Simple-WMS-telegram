// test/ai/clientGeminiKeyAbsenVerifier.test.js (VERIFIER bug baru client.js)
// Tanpa GEMINI_API_KEY: require modul TIDAK boleh throw; pemanggilan harus reject
// dengan err.perluFallbackProvider === true (fallback terkelola, bukan crash import).
const test = require("node:test");
const assert = require("node:assert/strict");

const asli = process.env.GEMINI_API_KEY;

test("bug client.js: require tanpa GEMINI_API_KEY tidak throw", () => {
  delete process.env.GEMINI_API_KEY;
  let errRequire = null;
  let mod = null;
  try {
    mod = require("../../lib/gemini/client");
  } catch (e) {
    errRequire = e;
  }
  console.log("=== CLIENT PROBE ===");
  console.log("require throw?", errRequire ? errRequire.message : "TIDAK");
  assert.equal(errRequire, null, "require TIDAK boleh throw saat key absen");
  assert.equal(typeof mod.generateContentDenganGeminiSaja, "function");
  assert.equal(typeof mod.ambilGenAI, "function");
});

test("bug client.js: ambilGenAI() melempar perluFallbackProvider saat key absen", () => {
  delete process.env.GEMINI_API_KEY;
  const { ambilGenAI } = require("../../lib/gemini/client");
  let err = null;
  try {
    ambilGenAI();
  } catch (e) {
    err = e;
  }
  assert.ok(err, "ambilGenAI harus melempar saat key absen");
  assert.equal(err.perluFallbackProvider, true, "harus ditandai perluFallbackProvider");
  console.log("ambilGenAI err:", err.message, "| perluFallbackProvider:", err.perluFallbackProvider);
});

test("bug client.js: generateContentDenganGeminiSaja reject dgn perluFallbackProvider", async () => {
  delete process.env.GEMINI_API_KEY;
  const { generateContentDenganGeminiSaja } = require("../../lib/gemini/client");
  let err = null;
  try {
    await generateContentDenganGeminiSaja({
      tools: [],
      systemInstruction: "sys",
      contents: [{ role: "user", parts: [{ text: "halo" }] }],
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "harus reject saat key absen");
  assert.equal(err.perluFallbackProvider, true, "harus ditandai perluFallbackProvider (bukan crash)");
  console.log("generateContent err:", err.message, "| perluFallbackProvider:", err.perluFallbackProvider);
});

test.after(() => {
  if (asli === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = asli;
});
