// test/handleScreenshotPickingList.test.js
// Regresi BUG A (P0): jalur NYATA handleScreenshotPickingList -> prosesSemuaBaris ->
// catatPergerakanStok harus menyimpan stock_movements.action_type sebagai STRING
// ("kurangi_stok"), bukan object hasil mentah ambilActionTypeUntukPenanda().
//
// Ini menutup kelemahan test/keywordActionType.test.js yang hanya menguji helper
// ambilActionTypeUntukPenanda() di isolasi: kalau destructure
//   const { actionType } = await ambilActionTypeUntukPenanda(...)
// di prosesSemuaBaris() di-revert jadi
//   const actionType = await ambilActionTypeUntukPenanda(...)
// maka action_type yang tertulis di Firestore berisi OBJECT { actionType, note }.
// Test ini meng-exercise handler lewat require.cache mock (pola sama spt
// notifikasiError.test.js) dan membaca langsung nilai yang ditulis ke Firestore.

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

// --- Mock dependency lewat require.cache SEBELUM handler di-load ---
function stubModule(relPath, exports) {
  const full = require.resolve(relPath);
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
}

// Gemini vision: kembalikan SATU baris tetap, tanpa network.
stubModule("../lib/gemini/ekstrakPickingList", {
  ekstrakPickingList: async () => [
    { nama_terbaca: "Produk", variasi: "-", qty: 2, penanda: "sisa gdg" },
  ],
});

// Fuzzy matching: langsung "jelas" pilih produk ABC.
stubModule("../lib/matching/cariProdukByNama", {
  cariProdukByNama: async () => ({
    status: "jelas",
    produkTerpilih: { kode_barang: "ABC", nama_accurate: "Produk" },
    kandidat: [],
  }),
});

// Master produk: fake, listSemuaProduk cuma butuh array kosong (matching di-mock).
stubModule("../lib/models/produk", {
  listSemuaProduk: async () => [],
});

// Telegram: semua no-op supaya handler gak nyentuh network.
stubModule("../lib/telegram/kirimPesan", {
  kirimPesan: async () => ({ ok: true, result: { message_id: 1 } }),
  kirimPesanDenganTombol: async () => ({ ok: true }),
  editPesan: async () => ({ ok: true }),
  hapusPesan: async () => ({ ok: true }),
});

const { db, collections } = installMockFirestore();

// keyword_notes: bikin penanda confirmed STOK supaya ambilActionTypeUntukPenanda
// mengembalikan { actionType: "kurangi_stok", note } — bentuk OBJECT yang dulu
// salah tersimpan utuh.
const { handleScreenshotPickingList } = require("../lib/handlers/handleScreenshotPickingList");

function resetStore() {
  for (const key of collections.keys()) collections.get(key).clear();
}

test("P0-A: handleScreenshotPickingList menulis stock_movements.action_type sebagai string kurangi_stok", async () => {
  resetStore();
  await db.collection("keyword_notes").add({
    raw_text: "sisa gdg",
    interpreted_as: "STOK",
    confidence: "confirmed",
  });

  await handleScreenshotPickingList({
    telegramUserId: "123",
    chatId: "456",
    base64Image: "ZmFrZQ==",
    mimeType: "image/jpeg",
  });

  const semuaMovement = await db.collection("stock_movements").get();
  assert.equal(semuaMovement.docs.length, 1, "satu baris harus tercatat sebagai stock_movement");

  const tersimpan = semuaMovement.docs[0].data();
  const storedActionType = tersimpan.action_type;

  // Inti regresi: harus STRING, dan nilainya tepat "kurangi_stok".
  assert.strictEqual(typeof storedActionType, "string");
  assert.strictEqual(storedActionType, "kurangi_stok");
  assert.notStrictEqual(storedActionType, null);
  assert.notStrictEqual(storedActionType, undefined);

  // Regresi kontrak delta bertanda: keluar_resi mengurangi stok -> qty harus NEGATIF.
  assert.strictEqual(tersimpan.type, "keluar_resi");
  assert.strictEqual(tersimpan.qty, -2, "qty movement keluar_resi harus negatif (delta bertanda)");
});

test("P0-B: penanda perlu_request -> qty tetap POSITIF (magnitudo permintaan, bukan delta stok)", async () => {
  resetStore();
  // Tanpa keyword_notes "sisa gdg" -> default aman perlu_request.

  await handleScreenshotPickingList({
    telegramUserId: "123",
    chatId: "456",
    base64Image: "ZmFrZQ==",
    mimeType: "image/jpeg",
  });

  const semuaMovement = await db.collection("stock_movements").get();
  assert.equal(semuaMovement.docs.length, 1);
  const tersimpan = semuaMovement.docs[0].data();

  assert.strictEqual(tersimpan.action_type, "perlu_request");
  assert.strictEqual(tersimpan.qty, 2, "perlu_request bukan delta stok, qty harus tetap positif");
});
