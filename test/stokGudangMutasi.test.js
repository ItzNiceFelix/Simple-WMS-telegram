// test/stokGudangMutasi.test.js
// v5.2: mutasi stok antar gudang (lib/models/stok.js -> mutasiStokGudang).
// Fokus LOGIKA. Murni + mock Firestore. Cepat, tanpa network.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const stok = require("../lib/models/stok");

const K = "B1";
const uid = "111";

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

async function siapkan(map = { ONLINE: 10, D12: 30, D19: 5 }, sgo = 10) {
  await db.collection("stock").doc(K).set({ stok_gudang_online: sgo, qty_per_gudang: map });
}

async function baca() {
  return (await db.collection("stock").doc(K).get()).data();
}

async function total() {
  const d = await baca();
  return Object.values(d.qty_per_gudang).reduce((a, b) => a + b, 0);
}

// --- jalur sukses ---

test("mutasi normal: dari turun, ke naik", async () => {
  await siapkan();
  const r = await stok.mutasiStokGudang(K, "D12", "D19", 20, uid);
  assert.equal(r.ok, true);
  const d = await baca();
  assert.equal(d.qty_per_gudang.D12, 10);
  assert.equal(d.qty_per_gudang.D19, 25);
});

test("mutasi: TOTAL semua gudang KEKAL", async () => {
  await siapkan();
  const sebelum = await total();
  await stok.mutasiStokGudang(K, "D12", "D19", 20, uid);
  assert.equal(await total(), sebelum, "total harus kekal");
});

test("mutasi: gudang lain tidak tersentuh", async () => {
  await siapkan();
  await stok.mutasiStokGudang(K, "D12", "D19", 20, uid);
  const d = await baca();
  assert.equal(d.qty_per_gudang.ONLINE, 10, "ONLINE tidak berubah");
});

test("mutasi: ke gudang yang belum punya key -> key dibuat", async () => {
  await siapkan({ ONLINE: 10, D12: 30 });
  const r = await stok.mutasiStokGudang(K, "D12", "D19", 7, uid);
  assert.equal(r.ok, true);
  const d = await baca();
  assert.equal(d.qty_per_gudang.D19, 7, "key baru dibuat");
});

test("mutasi ke ONLINE: stok_gudang_online ikut naik (paritas BR3)", async () => {
  await siapkan();
  await stok.mutasiStokGudang(K, "D12", "ONLINE", 15, uid);
  const d = await baca();
  assert.equal(d.qty_per_gudang.ONLINE, 25);
  assert.equal(d.stok_gudang_online, 25, "paritas diselaraskan");
});

test("mutasi DARI ONLINE: stok_gudang_online ikut turun (paritas BR3)", async () => {
  await siapkan();
  await stok.mutasiStokGudang(K, "ONLINE", "D12", 4, uid);
  const d = await baca();
  assert.equal(d.qty_per_gudang.ONLINE, 6);
  assert.equal(d.stok_gudang_online, 6);
});

test("mutasi: seluruh stok asal (sisa 0)", async () => {
  await siapkan();
  const r = await stok.mutasiStokGudang(K, "D19", "D12", 5, uid);
  assert.equal(r.ok, true);
  const d = await baca();
  assert.equal(d.qty_per_gudang.D19, 0);
  assert.equal(d.qty_per_gudang.D12, 35);
});

test("mutasi: last_updated + last_updated_by terisi", async () => {
  await siapkan();
  await stok.mutasiStokGudang(K, "D12", "D19", 1, uid);
  const d = await baca();
  assert.ok(d.last_updated, "last_updated ada");
  assert.equal(String(d.last_updated_by), uid);
});

// --- jalur gagal ---

test("stok asal kurang -> 409, TIDAK ada perubahan (atomik)", async () => {
  await siapkan();
  const r = await stok.mutasiStokGudang(K, "D12", "D19", 999, uid);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.error, "Stok gudang asal tidak cukup.");
  const d = await baca();
  assert.equal(d.qty_per_gudang.D12, 30, "tidak berubah");
  assert.equal(d.qty_per_gudang.D19, 5, "tidak berubah");
});

test("gudang asal tanpa key (0) -> 409", async () => {
  await siapkan({ ONLINE: 10, D12: 30 });
  const r = await stok.mutasiStokGudang(K, "D19", "D12", 1, uid);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

test("dari = ke -> 400", async () => {
  await siapkan();
  const r = await stok.mutasiStokGudang(K, "D12", "D12", 1, uid);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("qty 0 / negatif / bukan integer -> 400", async () => {
  await siapkan();
  for (const q of [0, -5, 1.5]) {
    const r = await stok.mutasiStokGudang(K, "D12", "D19", q, uid);
    assert.equal(r.ok, false, "qty " + q + " harus ditolak");
    assert.equal(r.status, 400);
  }
});

test("dokumen tidak ada -> 404", async () => {
  const r = await stok.mutasiStokGudang("TIDAK-ADA", "D12", "D19", 1, uid);
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test("mutasi beruntun: hasil akhir benar", async () => {
  await siapkan();
  await stok.mutasiStokGudang(K, "D12", "D19", 10, uid);
  await stok.mutasiStokGudang(K, "D19", "ONLINE", 5, uid);
  await stok.mutasiStokGudang(K, "ONLINE", "D12", 2, uid);
  const d = await baca();
  assert.equal(d.qty_per_gudang.D12, 22, "30-10+2");
  assert.equal(d.qty_per_gudang.D19, 10, "5+10-5 = 10");
  assert.equal(d.qty_per_gudang.ONLINE, 13, "10+5-2");
  assert.equal(d.stok_gudang_online, 13, "paritas");
});

test("mutasi mengembalikan qty_per_gudang terbaru", async () => {
  await siapkan();
  const r = await stok.mutasiStokGudang(K, "D12", "D19", 3, uid);
  assert.equal(r.ok, true);
  assert.equal(r.qty_per_gudang.D12, 27);
  assert.equal(r.qty_per_gudang.D19, 8);
});
