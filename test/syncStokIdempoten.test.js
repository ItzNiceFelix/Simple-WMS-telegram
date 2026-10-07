// test/syncStokIdempoten.test.js
// T4: applyDraft idempoten via draft.pushed_items[]. Retry konfirmasi tidak menggandakan
// stock_movements untuk kode yang sudah dipush.
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

// Stub sheets: A2:B berisi K1 & K2 supaya pushNilaiKeSheet menemukan baris.
const nilaiDitulis = [];
const sheetsPath = require.resolve("../lib/sheets/client");
require.cache[sheetsPath] = {
  id: sheetsPath,
  filename: sheetsPath,
  loaded: true,
  exports: {
    bacaRange: async (range) => (range.endsWith("A2:B") ? [["1", "K1"], ["2", "K2"]] : []),
    tulisRange: async (range, values) => {
      nilaiDitulis.push({ range, values });
      return { ok: true };
    },
    ambilHeader: async () => ["No", "Kode Barang"],
    tambahKolomHeader: async () => 3,
    tambahBarisBaru: async () => ({ ok: true }),
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
  nilaiDitulis.length = 0;
  invalidasiCacheProduk();
});

async function hitungMovements() {
  const snap = await db.collection("stock_movements").get();
  return snap.docs.length;
}

test("pushed_items ['K1'] -> retry: K1 tidak digandakan, K2 diproses; pushed_items bertambah", async () => {
  const uid = "111";
  const indexKolom = 2;

  await db.collection("products").doc("K1").set({ kode_barang: "K1", nama_accurate: "Satu" });
  await db.collection("products").doc("K2").set({ kode_barang: "K2", nama_accurate: "Dua" });
  await db.collection("stock").doc("K1").set({ qty_per_gudang: { ONLINE: 5 }, stok_gudang_online: 5 });
  await db.collection("stock").doc("K2").set({ qty_per_gudang: { ONLINE: 6 }, stok_gudang_online: 6 });

  // Movement K1 dari attempt pertama (sudah dipush).
  await db.collection("stock_movements").doc("mv-k1").set({
    kode_barang: "K1",
    type: "sync_confirmed",
    status: "processed",
  });

  await db.collection("sync_stok_drafts").doc("d-idem").set({
    kondisi: KONDISI.SHEETS_KETINGGALAN,
    index_kolom: indexKolom,
    status: "pending_confirmation",
    owner_user_id: uid,
    pushed_items: ["K1"], // attempt pertama sukses K1
    items: [
      { kondisi: KONDISI.SHEETS_KETINGGALAN, kode_barang: "K1", nama_accurate: "Satu", nilai_firestore: 5, index_kolom: indexKolom },
      { kondisi: KONDISI.SHEETS_KETINGGALAN, kode_barang: "K2", nama_accurate: "Dua", nilai_firestore: 6, index_kolom: indexKolom },
    ],
  });
  await db.collection("sessions").doc(uid).set({ pendingSyncStok: { chatId: 900, draftIds: ["d-idem"] } });

  const sebelum = await hitungMovements();
  assert.equal(sebelum, 1, "starting: hanya movement K1 lama");

  const hasil = await konfirmasiSyncStok(uid, `ya ${KONDISI.SHEETS_KETINGGALAN}`, { kirimNotifikasi: false });
  assert.equal(hasil.ok, true);

  const movements = (await db.collection("stock_movements").get()).docs.map((d) => d.data().kode_barang);
  assert.equal(movements.length, 2, "hanya K2 yang menambah movement baru");
  assert.equal(movements.filter((k) => k === "K1").length, 1, "K1 TIDAK digandakan");
  assert.equal(movements.filter((k) => k === "K2").length, 1, "K2 diproses");

  // Hanya K2 yang ditulis ke sheet (K1 baris 2 di-skip; K2 baris 3 ditulis).
  const rangeDitulis = nilaiDitulis.map((n) => n.range);
  assert.equal(rangeDitulis.includes("DATABASE_ACCURATE!C2"), false, "K1 baris 2 tidak ditulis ulang");
  assert.ok(rangeDitulis.includes("DATABASE_ACCURATE!C3"), "K2 baris 3 benar-benar ditulis ke sheet");

  const draft = (await db.collection("sync_stok_drafts").doc("d-idem").get()).data();
  assert.equal(draft.status, "processed");
  assert.deepEqual(draft.pushed_items.sort(), ["K1", "K2"], "pushed_items akumulatif");
});
