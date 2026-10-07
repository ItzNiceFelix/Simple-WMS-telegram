// test/routeFotoOpname.test.js
// Kontrak pemilihan alur foto di lib/router/routePesan.js: caption mengandung kata
// "opname" (whole-word, case-insensitive) ATAU diawali (setelah spasi pembuka) "hitung"
// -> foto opname; selain itu (termasuk caption kosong) -> picking list.
//
// Helper `adalahFotoOpname` di-export dari routePesan.js supaya kontrak ini terkunci
// dengan test otomatis (sebelumnya lokal & tak teruji).

const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

// routePesan.js menarik handler/model yang init Firebase saat load — isi env dummy
// supaya require tidak gagal. Test ini cuma menguji helper regex, tidak sentuh Firestore.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-project";
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "demo@example.com";
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ||
  crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .replace(/\n/g, "\\n");
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-gemini-key";

const { adalahFotoOpname } = require("../lib/router/routePesan");

test("caption 'opname' -> true", () => {
  assert.strictEqual(adalahFotoOpname("opname"), true);
});

test("caption 'Opname' (case-insensitive) -> true", () => {
  assert.strictEqual(adalahFotoOpname("Opname"), true);
});

test("caption 'hitung stok' -> true", () => {
  assert.strictEqual(adalahFotoOpname("hitung stok"), true);
});

test("caption kosong '' -> false", () => {
  assert.strictEqual(adalahFotoOpname(""), false);
});

test("caption undefined -> false", () => {
  assert.strictEqual(adalahFotoOpname(undefined), false);
});

test("caption 'picking list' -> false", () => {
  assert.strictEqual(adalahFotoOpname("picking list"), false);
});

test("caption 'toko opname' (opname bukan di awal) -> true", () => {
  assert.strictEqual(adalahFotoOpname("toko opname"), true);
});

// Edge: caption " hitung" (spasi di depan) harus tetap terdeteksi — dulu MISS karena
// /^hitung\b/ tidak toleran spasi pembuka. Sekarang /^\s*hitung\b/i.
test("caption ' hitung' (spasi pembuka) -> true", () => {
  assert.strictEqual(adalahFotoOpname(" hitung"), true);
});

// Pastikan "menghitung" (hitung bukan whole-word di awal) TIDAK lolos.
test("caption 'menghitung' -> false", () => {
  assert.strictEqual(adalahFotoOpname("menghitung"), false);
});
