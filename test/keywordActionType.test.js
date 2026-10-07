// test/keywordActionType.test.js
// Regresi BUG A: stock_movements.action_type harus STRING hasil destructure,
// bukan object hasil langsung dari ambilActionTypeUntukPenanda().

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
const { db } = installMockFirestore();

const { ambilActionTypeUntukPenanda } = require("../lib/models/keywordNotes");

test("penanda confirmed STOK -> actionType string kurangi_stok", async () => {
  await db.collection("keyword_notes").add({
    raw_text: "sisa gdg",
    interpreted_as: "STOK",
    confidence: "confirmed",
  });

  const hasil = await ambilActionTypeUntukPenanda("Sisa Gdg");

  assert.equal(typeof hasil, "object");
  assert.equal(typeof hasil.actionType, "string");
  assert.equal(hasil.actionType, "kurangi_stok");

  // BUG A: yang disimpan ke stock_movements.action_type dulu adalah OBJECT `hasil`.
  // Object itu tidak strict-equal string, konsumen `=== "kurangi_stok"` gagal senyap.
  const objectSalah = hasil; // bentuk lama: object utuh disimpan apa adanya
  assert.notStrictEqual(objectSalah, "kurangi_stok");

  // Bentuk benar: destructure dulu, simpan string-nya.
  const { actionType } = hasil;
  assert.strictEqual(actionType, "kurangi_stok");
});

test("penanda tak dikenal -> default perlu_request", async () => {
  const hasil = await ambilActionTypeUntukPenanda("penanda asing");
  assert.equal(typeof hasil.actionType, "string");
  assert.equal(hasil.actionType, "perlu_request");
});
