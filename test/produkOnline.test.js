// test/produkOnline.test.js
// v5 F8: toggle is_online_product (model + validator) + guard route.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const { setOnlineProduk, listSemuaProduk } = require("../lib/models/produk");
const { validasiToggleOnline } = require("../lib/dashboard/validasiGudangV5");

const KODE = "B1";
const uid = "111";

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

async function seed() {
  await db.collection("products").doc(KODE).set({ nama_accurate: "Barang 1", is_online_product: false });
  await db.collection("admins").doc(uid).set({ role: "owner" });
}

test("setOnlineProduk -> is_online_product true + online_updated_by terisi", async () => {
  await seed();
  const hasil = await setOnlineProduk(KODE, true, uid);
  assert.equal(hasil.is_online_product, true);
  assert.equal(hasil.online_updated_by, uid);
  assert.ok(hasil.updated_at);
});

test("setOnlineProduk toggle balik ke false", async () => {
  await seed();
  await setOnlineProduk(KODE, true, uid);
  const hasil = await setOnlineProduk(KODE, false, uid);
  assert.equal(hasil.is_online_product, false);
});

test("setOnlineProduk kode tidak ada -> null", async () => {
  await seed();
  assert.equal(await setOnlineProduk("TIDAK-ADA", true, uid), null);
});

test("validasiToggleOnline kode kosong -> 400", () => {
  const v = validasiToggleOnline({ kode_barang: "  ", is_online: true });
  assert.equal(v.ok, false);
  assert.equal(v.status, 400);
  assert.equal(v.error, "Kode barang wajib diisi.");
});

test("validasiToggleOnline is_online bukan boolean -> 400", () => {
  const v = validasiToggleOnline({ kode_barang: "B1", is_online: "true" });
  assert.equal(v.ok, false);
  assert.equal(v.status, 400);
  assert.equal(v.error, "Status online harus boolean.");
});

test("route produk/online cek role owner+admin", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "api", "produk", "online", "route.ts"), "utf8");
  assert.match(src, /!user\.is_admin/);
  assert.match(src, /Akses ditolak\. Hubungi owner\./);
});
