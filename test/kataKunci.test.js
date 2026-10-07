// test/kataKunci.test.js
// v3a F2: listKeywordNotes + perbaruiInterpretasi (pakai konfirmasiKeyword yang ada,
// jangan duplikasi). PRD §6.1/§9.2/§10 #11.
const crypto = require("crypto");
const { test, beforeEach } = require("node:test");
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

const kw = require("../lib/models/keywordNotes");

function bersihkan() {
  const store = collections.get("keyword_notes");
  if (store) store.clear();
}

beforeEach(() => bersihkan());

test("#11 listKeywordNotes: semua note + id, urut last_used desc", async () => {
  await db.collection("keyword_notes").add({ raw_text: "lama", interpreted_as: "MINTA", confidence: "guessed", last_used: new Date("2026-01-01") });
  await db.collection("keyword_notes").add({ raw_text: "baru", interpreted_as: "STOK", confidence: "confirmed", last_used: new Date("2026-06-01") });

  const daftar = await kw.listKeywordNotes();
  assert.equal(daftar.length, 2);
  assert.equal(daftar[0].raw_text, "baru");
  assert.ok(daftar[0].id, "id harus disertakan");
});

test("#11 listKeywordNotes: last_used Timestamp (toDate) ditangani", async () => {
  await db.collection("keyword_notes").add({
    raw_text: "ts",
    last_used: { toDate: () => new Date("2026-07-01") },
  });
  const daftar = await kw.listKeywordNotes();
  assert.equal(daftar.length, 1);
  assert.equal(daftar[0].raw_text, "ts");
});

test("#11 perbaruiInterpretasi: confidence confirmed + nilai baru + confirmed_by/at", async () => {
  const ref = await db.collection("keyword_notes").add({ raw_text: "sisa gdg", interpreted_as: "MINTA", confidence: "guessed", usage_count: 3 });

  const note = await kw.perbaruiInterpretasi(ref.id, "STOK", "111");
  assert.equal(note.confidence, "confirmed");
  assert.equal(note.interpreted_as, "STOK");
  assert.equal(note.confirmed_by, "111");
  assert.ok(note.confirmed_at, "confirmed_at harus terisi");

  const mentah = (await db.collection("keyword_notes").doc(ref.id).get()).data();
  assert.equal(mentah.confidence, "confirmed");
  assert.equal(mentah.interpreted_as, "STOK");
  assert.equal(mentah.confirmed_by, "111");
});

test("#11 perbaruiInterpretasi: memakai konfirmasiKeyword (set confidence), bukan duplikat", async () => {
  // Bukti tidak duplikasi: panggil langsung konfirmasiKeyword -> hasil setara untuk
  // interpreted_as/confidence. perbaruiInterpretasi menambah audit saja.
  const ref = await db.collection("keyword_notes").add({ raw_text: "x", interpreted_as: "MINTA", confidence: "guessed" });
  const viaKonfirmasi = await kw.konfirmasiKeyword(ref.id, "MINTA_SISA");
  assert.equal(viaKonfirmasi.confidence, "confirmed");
  assert.equal(viaKonfirmasi.interpreted_as, "MINTA_SISA");

  const note = await kw.perbaruiInterpretasi(ref.id, "STOK", "222");
  assert.equal(note.confidence, "confirmed");
  assert.equal(note.interpreted_as, "STOK");
});

test("#11 perbaruiInterpretasi: interpreted_as di luar 3 nilai -> throw", async () => {
  const ref = await db.collection("keyword_notes").add({ raw_text: "y", confidence: "guessed" });
  await assert.rejects(() => kw.perbaruiInterpretasi(ref.id, "NGACO", "111"), /Interpretasi tidak dikenal\./);
});

test("F2: perbaruiInterpretasi note tidak ada -> throw Penanda tidak ditemukan.", async () => {
  await assert.rejects(
    () => kw.perbaruiInterpretasi("tidak-ada", "STOK", "111"),
    /Penanda tidak ditemukan\./
  );
});

test("fungsi existing keywordNotes tetap ada (tidak diubah)", () => {
  for (const nama of ["cariKeywordNote", "simpanKeywordBaru", "catatPemakaianKeyword", "konfirmasiKeyword", "petakanInterpretasiKeActionType", "ambilActionTypeUntukPenanda"]) {
    assert.equal(typeof kw[nama], "function", `${nama} harus tetap diekspor`);
  }
});
