// test/dailyRequests.test.js
// Regresi BUG B: tambahItemKeDailyRequest harus baca item.kode_barang
// (dengan fallback item.kodeBarang), bukan cuma kodeBarang.

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

const { tambahItemKeDailyRequest } = require("../lib/models/dailyRequests");

test("item.kode_barang tersimpan, bukan undefined", async () => {
  const hasil = await tambahItemKeDailyRequest("2026-01-01", {
    kode_barang: "ABC",
    nama: "Produk",
    variasi: "-",
    qty: 3,
    buffer: false,
  });

  assert.equal(hasil.items[0].kode_barang, "ABC");
  assert.notEqual(hasil.items[0].kode_barang, undefined);
  assert.equal(hasil.items[0].qty, 3);
  assert.equal(hasil.items[0].buffer, false);
});

test("legacy item.kodeBarang masih didukung", async () => {
  const hasil = await tambahItemKeDailyRequest("2026-02-02", {
    kodeBarang: "XYZ",
    nama: "Produk Lama",
    qty: 1,
  });

  assert.equal(hasil.items[0].kode_barang, "XYZ");
});

test("item baru ditambahkan tanpa menghapus item sebelumnya", async () => {
  await tambahItemKeDailyRequest("2026-03-03", { kode_barang: "A1", nama: "A", qty: 1 });
  const hasil = await tambahItemKeDailyRequest("2026-03-03", {
    kode_barang: "B2",
    nama: "B",
    qty: 2,
  });

  assert.equal(hasil.items.length, 2);
  assert.deepEqual(
    hasil.items.map((i) => i.kode_barang),
    ["A1", "B2"]
  );
});
