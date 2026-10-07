// test/reorderPoint.test.js
// Uji model setReorderPoint (F2) + REGRESI B1: notifikasi reorder point harus
// dikirim ke admin.telegram_user_id, BUKAN admin.id (yg selalu undefined).
// Test B1 WAJIB gagal sebelum fix lib/reminder/cekReorderPoint.js.
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

// Stub kirimPesan lewat require cache SEBELUM modul yg memakainya di-load.
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

const stok = require("../lib/models/stok");
const { catatPerubahanProduk } = require("../lib/models/productChanges");

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}

async function seedStok(kode, nilai, reorder = null) {
  await db.collection("stock").doc(kode).set({
    stok_gudang_online: nilai,
    reorder_point: reorder,
    last_updated: new Date(),
  });
  await db.collection("products").doc(kode).set({
    nama_accurate: `Produk ${kode}`,
    is_online_product: true,
  });
}

beforeEach(() => {
  resetStore();
  stok.invalidasiCacheStok();
  terkirim.length = 0;
});

test("setReorderPoint menyimpan nilai di dokumen stock", async () => {
  await seedStok("K1", 10);
  const hasil = await stok.setReorderPoint("K1", 15, "111");
  assert.equal(hasil.stok.reorder_point, 15);
  const doc = await db.collection("stock").doc("K1").get();
  assert.equal(doc.data().reorder_point, 15);
  assert.equal(doc.data().last_updated_by, "111");
});

test("setReorderPoint menginvalidasi cache stok", async () => {
  await seedStok("K2", 10);
  // Isi cache dulu dengan kondisi reorder null (tidak muncul di listing).
  assert.equal((await stok.cariStokDiBawahReorderPoint()).length, 0);
  await stok.setReorderPoint("K2", 15, "111");
  const bawah = await stok.cariStokDiBawahReorderPoint();
  assert.equal(bawah.length, 1);
  assert.equal(bawah[0].kode_barang, "K2");
});

test("setReorderPoint(null) menyimpan null & mengeluarkan produk dari listing", async () => {
  await seedStok("K3", 10, 15);
  const hasil = await stok.setReorderPoint("K3", null, "111");
  assert.equal(hasil.stok.reorder_point, null);
  const bawah = await stok.cariStokDiBawahReorderPoint();
  assert.equal(bawah.length, 0);
});

test("setReorderPoint null bila dokumen stock tidak ada (TIDAK membuat dokumen)", async () => {
  const hasil = await stok.setReorderPoint("TIDAK-ADA", 15, "111");
  assert.equal(hasil, null);
  const doc = await db.collection("stock").doc("TIDAK-ADA").get();
  assert.equal(doc.exists, false);
});

test("setReorderPoint memicu notifikasi saat stok (10) <= reorder baru (15)", async () => {
  await seedStok("K4", 10);
  const hasil = await stok.setReorderPoint("K4", 15, "111");
  assert.equal(hasil.notifikasi, true);
});

test("setReorderPoint TIDAK memicu notifikasi saat stok (10) > reorder baru (5)", async () => {
  await seedStok("K5", 10);
  const hasil = await stok.setReorderPoint("K5", 5, "111");
  assert.equal(hasil.notifikasi, false);
});

test("B1: notifikasi reorder dikirim ke telegram_user_id admin (bukan undefined)", async () => {
  await seedStok("K9", 10);
  await db.collection("admins").doc("111").set({ name: "Bos", role: "owner" });
  await db.collection("admins").doc("222").set({ name: "Adm", role: "admin" });

  const hasil = await stok.setReorderPoint("K9", 15, "111");

  assert.equal(hasil.notifikasi, true);
  assert.equal(terkirim.length, 2, "kirimPesan harus dipanggil utk owner + admin");
  const tujuan = terkirim.map((t) => t.chatId);
  assert.ok(tujuan.includes("111"), "owner pakai telegram_user_id 111");
  assert.ok(tujuan.includes("222"), "admin pakai telegram_user_id 222");
  for (const t of terkirim) {
    assert.notEqual(t.chatId, undefined, "chatId TIDAK boleh undefined (bug B1 admin.id)");
  }
});

test("validasiReorderPoint: key hilang -> error, null sah, string ditolak", () => {
  const { validasiReorderPoint } = require("../lib/dashboard/validasiTulisV2");
  let r = validasiReorderPoint({ kode_barang: "K1" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Reorder point wajib diisi.");

  r = validasiReorderPoint({ kode_barang: "K1", reorder_point: null });
  assert.equal(r.ok, true);
  assert.equal(r.reorderPoint, null);

  r = validasiReorderPoint({ kode_barang: "K1", reorder_point: "15" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Reorder point harus bilangan bulat >= 0.");

  r = validasiReorderPoint({ kode_barang: "K1", reorder_point: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.reorderPoint, 0);

  r = validasiReorderPoint({ kode_barang: "", reorder_point: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Kode barang wajib diisi.");
});

test("catatPerubahanProduk menulis 1 baris per field", async () => {
  const baris = await catatPerubahanProduk({
    kodeBarang: "K9",
    field: "reorder_point",
    nilaiLama: null,
    nilaiBaru: 15,
    changedBy: 111,
  });
  assert.equal(baris.kode_barang, "K9");
  assert.equal(baris.field, "reorder_point");
  assert.equal(baris.nilai_baru, 15);
  assert.equal(baris.changed_by, "111");
  assert.ok(baris.id);
  const snap = await db.collection("product_changes").get();
  assert.equal(snap.docs.length, 1);
});
