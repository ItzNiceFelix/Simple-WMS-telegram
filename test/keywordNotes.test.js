// test/keywordNotes.test.js
// Lifecycle kamus adaptif: penanda tak dikenal -> tersimpan "guessed",
// penanda kosong/"-" -> tidak ada row sampah, penanda confirmed -> tidak duplikat.

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

const { installMockFirestore } = require("./helpers/mockFirestore");
const { db, collections } = installMockFirestore();

const { ambilActionTypeUntukPenanda } = require("../lib/models/keywordNotes");

// Mock Firestore satu instance per file -> bersihkan store tiap test.
function bersihkan() {
  const store = collections.get("keyword_notes");
  if (store) store.clear();
}

async function semuaNote() {
  const snap = await db.collection("keyword_notes").get();
  return snap.docs.map((d) => d.data());
}

test("penanda tak dikenal -> perlu_request + row guessed dibuat", async () => {
  bersihkan();
  const hasil = await ambilActionTypeUntukPenanda("Sisa Gdg");

  assert.equal(hasil.actionType, "perlu_request");
  assert.ok(hasil.note, "note baru harus dikembalikan");

  const rows = await semuaNote();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].raw_text, "sisa gdg");
  assert.equal(rows[0].confidence, "guessed");
  assert.equal(rows[0].interpreted_as, "MINTA");
  assert.equal(rows[0].usage_count, 1);
});

test("penanda empty / '-' -> default perlu_request tanpa row", async () => {
  bersihkan();
  assert.equal((await ambilActionTypeUntukPenanda("")).note, null);
  assert.equal((await ambilActionTypeUntukPenanda("   ")).note, null);
  assert.equal((await ambilActionTypeUntukPenanda("-")).note, null);
  assert.equal((await ambilActionTypeUntukPenanda("x")).note, null); // < 2 char

  assert.equal((await semuaNote()).length, 0);
});

test("penanda confirmed -> actionType terpetakan, tidak ada row baru", async () => {
  bersihkan();
  await db.collection("keyword_notes").add({
    raw_text: "sisa gdg",
    interpreted_as: "STOK",
    confidence: "confirmed",
    usage_count: 1,
  });

  const hasil = await ambilActionTypeUntukPenanda("Sisa Gdg");

  assert.equal(hasil.actionType, "kurangi_stok");
  assert.equal(hasil.note.confidence, "confirmed");
  assert.equal((await semuaNote()).length, 1, "tidak boleh ada duplikat");
});
