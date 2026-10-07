// test/syncStokParitas.test.js
// T2: bandingkanNilai pakai paritas online (key "ONLINE" di qty_per_gudang, fallback
// stok_gudang_online utk dokumen lama). Diuji lewat jalur NYATA mulaiSyncStok -> draft.
// Stub sheets client + telegram, Firestore pakai mock.
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

// Stub telegram sebelum modul pemakainya di-load.
const terkirim = [];
const kirimPath = require.resolve("../lib/telegram/kirimPesan");
require.cache[kirimPath] = {
  id: kirimPath,
  filename: kirimPath,
  loaded: true,
  exports: {
    kirimPesan: async (chatId, teks) => {
      terkirim.push({ chatId, teks });
      return { ok: true };
    },
    kirimPesanDenganTombol: async (chatId, teks) => {
      terkirim.push({ chatId, teks, tombol: true });
      return { ok: true };
    },
  },
};

// Stub sheets client. Header punya "Stok Online" di index 6.
let barisSheetStub = [];
const sheetsPath = require.resolve("../lib/sheets/client");
require.cache[sheetsPath] = {
  id: sheetsPath,
  filename: sheetsPath,
  loaded: true,
  exports: {
    bacaRange: async () => barisSheetStub,
    tulisRange: async () => ({ ok: true }),
    ambilHeader: async () => ["No", "Kode Barang", "Nama Accurate", "HPP", "is_online", "HPP Baru", "Stok Online"],
    tambahKolomHeader: async () => 6,
    tambahBarisBaru: async () => ({ ok: true }),
    angkaKeHurufKolom: (i) => String.fromCharCode(65 + i),
  },
};

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;
const { mulaiSyncStok } = require("../lib/sheets/syncStokDuaArah");
const { invalidasiCacheProduk } = require("../lib/models/produk");

beforeEach(() => {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  terkirim.length = 0;
  barisSheetStub = [];
  invalidasiCacheProduk(); // cache module-level produk lintas-test — reset supaya tiap test lihat data mock baru
});

async function seedProduk(kode) {
  await db.collection("products").doc(kode).set({
    kode_barang: kode,
    nama_accurate: `Produk ${kode}`,
    is_online_product: true,
  });
}

async function hitungDraft() {
  const snap = await db.collection("sync_stok_drafts").get();
  return snap.docs.length;
}

test("paritas map: qty_per_gudang.ONLINE=7 (stok_gudang_online=3 basi), sheet 7, last_synced 7 -> TIDAK ada draft", async () => {
  await seedProduk("K1");
  await db.collection("stock").doc("K1").set({
    qty_per_gudang: { ONLINE: 7 },
    stok_gudang_online: 3, // basi — harus diabaikan, pakai map
    last_synced_value: 7,
  });
  barisSheetStub = [["1", "K1", "Produk K1", "100", "TRUE", "", 7]];

  await mulaiSyncStok("111", 900);

  assert.equal(await hitungDraft(), 0, "map 7 == sheet 7 == last_synced 7 -> sinkron, tanpa draft");
});

test("fallback dokumen lama: tanpa qty_per_gudang, stok_gudang_online=5, sheet 5, last_synced 5 -> TIDAK ada draft", async () => {
  await seedProduk("K2");
  await db.collection("stock").doc("K2").set({
    stok_gudang_online: 5,
    last_synced_value: 5,
  });
  barisSheetStub = [["2", "K2", "Produk K2", "100", "TRUE", "", 5]];

  await mulaiSyncStok("111", 900);

  assert.equal(await hitungDraft(), 0, "fallback paritas 5 == sheet 5 -> sinkron tanpa draft");
});

test("sanity: nilai Firestore beda dgn sheet -> draft dibuat (bukti jalur aktif)", async () => {
  await seedProduk("K3");
  await db.collection("stock").doc("K3").set({
    qty_per_gudang: { ONLINE: 9 },
    stok_gudang_online: 9,
    last_synced_value: 9,
  });
  barisSheetStub = [["3", "K3", "Produk K3", "100", "TRUE", "", 4]];

  await mulaiSyncStok("111", 900);

  assert.equal(await hitungDraft(), 1, "sheet 4 vs firestore 9 -> ada draft");
});
