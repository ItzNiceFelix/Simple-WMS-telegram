// test/reminderHarian.test.js
// Regresi: qty stock_movements = delta bertanda (negatif utk keluar_resi). Pemakaian harian
// harus dihitung sebagai magnitudo, bukan penjumlahan mentah (yg bikin total negatif &
// guard `<= 0` melewati SEMUA produk -> reminder mati).
const crypto = require("crypto");
const { test } = require("node:test");
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

// Stub kirimPesan lewat require cache SEBELUM reminderHarian di-load (B1).
const kirimPesanPath = require.resolve("../lib/telegram/kirimPesan");
const terkirim = [];
require.cache[kirimPesanPath] = {
  id: kirimPesanPath,
  filename: kirimPesanPath,
  loaded: true,
  exports: {
    kirimPesan: async (chatId, teks) => {
      terkirim.push({ chatId, teks });
      return { ok: true };
    },
  },
};

const mock = installMockFirestore();
const db = mock.db;

const { hitungRataRataPemakaianHarian, jalankanReminderHarian } = require("../lib/reminder/reminderHarian");
const produk = require("../lib/models/produk");
const stok = require("../lib/models/stok");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}

test("pemakaian harian pakai magnitudo delta negatif (bukan dijumlah mentah)", async () => {
  resetStore();
  const batas = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  await db.collection("stock_movements").doc("m1").set({
    kode_barang: "A1",
    qty: -3,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    status: "processed",
    created_at: new Date(),
  });
  await db.collection("stock_movements").doc("m2").set({
    kode_barang: "A1",
    qty: -2,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    status: "processed",
    created_at: new Date(),
  });

  const rata = await hitungRataRataPemakaianHarian("A1", batas);
  assert.ok(rata > 0, "pemakaian harian harus positif agar proyeksi jalan");
  assert.equal(rata, 5 / 7); // total magnitudo 5 / JUMLAH_HARI_TREN (7)
});

test("B1: reminder harian kirim ke telegram_user_id admin (bukan undefined)", async () => {
  resetStore();
  terkirim.length = 0;
  produk.invalidasiCacheProduk();
  stok.invalidasiCacheStok();

  await db.collection("products").doc("B1").set({
    nama_accurate: "Produk B1",
    is_online_product: true,
  });
  await db.collection("stock").doc("B1").set({
    stok_gudang_online: 2,
    reorder_point: null,
    last_updated: new Date(),
  });
  // Pemakaian 7/hari -> 2 stok habis dalam 0.28 hari (<= ambang 3 hari).
  await db.collection("stock_movements").doc("m1").set({
    kode_barang: "B1",
    qty: -49,
    type: "keluar_resi",
    action_type: "kurangi_stok",
    status: "processed",
    created_at: new Date(),
  });
  await db.collection("admins").doc("111").set({ name: "Bos", role: "owner" });
  await db.collection("admins").doc("222").set({ name: "Adm", role: "admin" });

  const hasil = await jalankanReminderHarian();
  assert.equal(hasil.jumlahPerluDiperhatikan, 1);
  assert.equal(terkirim.length, 2);
  const tujuan = terkirim.map((t) => t.chatId);
  assert.ok(tujuan.includes("111"), "owner pakai telegram_user_id 111");
  assert.ok(tujuan.includes("222"), "admin pakai telegram_user_id 222");
});
