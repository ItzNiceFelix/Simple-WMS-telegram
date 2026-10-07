// test/syncStokMovementIdempotensi.test.js
// R1: jaminan anti-dobel TIDAK bergantung pada marker `pushed_items`. Walau marker absen
// (window crash antara movement dan marker), retry menulis movement ke id deterministik
// yang SAMA -> overwrite, bukan dokumen baru.
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
  id: kirimPath, filename: kirimPath, loaded: true,
  exports: {
    kirimPesan: async (chatId, teks) => { terkirim.push({ chatId, teks }); return { ok: true }; },
    kirimPesanDenganTombol: async (chatId, teks) => { terkirim.push({ chatId, teks, tombol: true }); return { ok: true }; },
  },
};

// A2:B punya K1 row 2; tulisRange spy.
const nilaiDitulis = [];
const sheetsPath = require.resolve("../lib/sheets/client");
require.cache[sheetsPath] = {
  id: sheetsPath, filename: sheetsPath, loaded: true,
  exports: {
    bacaRange: async (range) => (range.endsWith("A2:B") ? [["1", "K1"]] : []),
    tulisRange: async (range, values) => { nilaiDitulis.push({ range, values }); return { ok: true }; },
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

async function siapkanDraft(uid) {
  await db.collection("products").doc("K1").set({ kode_barang: "K1", nama_accurate: "Satu", is_online_product: true });
  await db.collection("stock").doc("K1").set({ qty_per_gudang: { ONLINE: 5 }, stok_gudang_online: 5, last_synced_value: 1 });
  await db.collection("sync_stok_drafts").doc("d-r1").set({
    kondisi: KONDISI.SHEETS_KETINGGALAN,
    index_kolom: 2,
    status: "pending_confirmation",
    owner_user_id: uid,
    items: [{ kondisi: KONDISI.SHEETS_KETINGGALAN, kode_barang: "K1", nama_accurate: "Satu", nilai_firestore: 5, index_kolom: 2 }],
  });
  await db.collection("sessions").doc(uid).set({ pendingSyncStok: { chatId: 900, draftIds: ["d-r1"] } });
}

test("R1: retry dua kali dgn marker ABSEN -> movement tetap 1, id = sync_<draftId>_<kode>", async () => {
  const uid = "111";
  await siapkanDraft(uid);

  // Attempt 1.
  await konfirmasiSyncStok(uid, `ya ${KONDISI.SHEETS_KETINGGALAN}`, { kirimNotifikasi: false });
  // Buang marker (simulasi crash tepat setelah movement, sebelum marker tersimpan)
  // + reset status supaya retry tidak di-skip.
  await db.collection("sync_stok_drafts").doc("d-r1").update({ pushed_items: null, status: "pending_confirmation" });
  await db.collection("sessions").doc(uid).set({ pendingSyncStok: { chatId: 900, draftIds: ["d-r1"] } });

  // Attempt 2 (marker absen).
  await konfirmasiSyncStok(uid, `ya ${KONDISI.SHEETS_KETINGGALAN}`, { kirimNotifikasi: false });

  const movements = (await db.collection("stock_movements").get()).docs;
  assert.equal(movements.length, 1, "marker absen pun retry TIDAK menggandakan movement");
  assert.equal(movements[0].id, "sync_d-r1_K1", "id movement deterministik");
});
