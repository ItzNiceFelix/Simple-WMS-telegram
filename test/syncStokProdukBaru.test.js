// test/syncStokProdukBaru.test.js
// T3: applyDraftProdukBaru mengisi kolom A (No) nomor urut berikutnya.
// Jalur nyata: konfirmasiSyncStok(uid, "ya produk_baru").
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

// Stub sheets client: bacaRange(A2:A) -> [["1"],["2"]]; tambahBarisBaru spy.
const barisDitambah = [];
let kolomAStub = [["1"], ["2"]];
const sheetsPath = require.resolve("../lib/sheets/client");
require.cache[sheetsPath] = {
  id: sheetsPath,
  filename: sheetsPath,
  loaded: true,
  exports: {
    bacaRange: async (range) => (range.endsWith("A2:A") ? kolomAStub : []),
    tulisRange: async () => ({ ok: true }),
    ambilHeader: async () => ["No"],
    tambahKolomHeader: async () => 5,
    tambahBarisBaru: async (namaSheet, row) => {
      barisDitambah.push({ namaSheet, row });
      return { ok: true };
    },
    angkaKeHurufKolom: (i) => String.fromCharCode(65 + i),
  },
};

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;
const { konfirmasiSyncStok, KONDISI } = require("../lib/sheets/syncStokDuaArah");
const { invalidasiCacheProduk } = require("../lib/models/produk");

beforeEach(() => {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  terkirim.length = 0;
  barisDitambah.length = 0;
  kolomAStub = [["1"], ["2"]];
  invalidasiCacheProduk();
});

test("produk_baru: row[0] = nomor lanjut, kode & stok di posisi benar, last_synced ter-set", async () => {
  const uid = "111";
  await db.collection("sessions").doc(uid).set({ pendingSyncStok: { chatId: 900, draftIds: ["d-pb"] } });
  const indexKolom = 5;
  await db.collection("sync_stok_drafts").doc("d-pb").set({
    kondisi: KONDISI.PRODUK_BARU,
    index_kolom: indexKolom,
    status: "pending_confirmation",
    owner_user_id: uid,
    items: [
      {
        kondisi: KONDISI.PRODUK_BARU,
        kode_barang: "PB1",
        nama_accurate: "Produk Baru 1",
        hpp: 250,
        nilai_firestore: 11,
        index_kolom: indexKolom,
      },
    ],
  });
  await db.collection("products").doc("PB1").set({ kode_barang: "PB1", nama_accurate: "Produk Baru 1" });
  await db.collection("stock").doc("PB1").set({ qty_per_gudang: { ONLINE: 0 }, stok_gudang_online: 0 });

  const hasil = await konfirmasiSyncStok(uid, `ya ${KONDISI.PRODUK_BARU}`, { kirimNotifikasi: false });
  assert.equal(hasil.ok, true);

  assert.equal(barisDitambah.length, 1);
  const { namaSheet, row } = barisDitambah[0];
  assert.equal(namaSheet, "DATABASE_ACCURATE");
  assert.equal(row[0], 3, "kolom A = jumlah baris berisi (2) + 1");
  assert.equal(row[1], "PB1", "kolom B = kode");
  assert.equal(row[2], "Produk Baru 1");
  assert.equal(row[3], 250, "kolom D = hpp");
  assert.equal(row[indexKolom], 11, "kolom Stok Online = nilai firestore");
  assert.ok(row.length >= indexKolom + 1, "panjang baris cukup sampai kolom stok");

  const stok = (await db.collection("stock").doc("PB1").get()).data();
  assert.equal(stok.last_synced_value, 11, "last_synced_value ter-set");
});
