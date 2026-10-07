// test/stokGudangQty.test.js
// Wave 1 v5: paritas qty_per_gudang <-> stok_gudang_online (BR3).
// Fokus LOGIKA fungsi (murni + transaksi via mock Firestore). Ringan, tanpa network.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const stok = require("../lib/models/stok");
const { normalisasiQtyPerGudang, bacaParitasOnline, payloadQtyGudang } = require("../lib/models/stokGudang");

const KODE = "BRG-001";
const uid = "900001";

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

// --- normalisasiQtyPerGudang (murni) ---

test("normalisasi: qty_per_gudang ada -> dipakai apa adanya", () => {
  assert.deepEqual(normalisasiQtyPerGudang({ qty_per_gudang: { D12: 5, D13: 3 } }), { D12: 5, D13: 3 });
});

test("normalisasi: qty_per_gudang absen -> fallback {ONLINE: stok_gudang_online}", () => {
  assert.deepEqual(normalisasiQtyPerGudang({ stok_gudang_online: 7 }), { ONLINE: 7 });
});

test("normalisasi: dokumen kosong -> {ONLINE: 0}", () => {
  assert.deepEqual(normalisasiQtyPerGudang({}), { ONLINE: 0 });
  assert.deepEqual(normalisasiQtyPerGudang(null), { ONLINE: 0 });
});

test("normalisasi: nilai non-angka dibuang", () => {
  const hasil = normalisasiQtyPerGudang({ qty_per_gudang: { D12: 5, D13: "x", D14: null, D15: NaN, D16: 2 } });
  assert.deepEqual(hasil, { D12: 5, D16: 2 });
});

test("bacaParitasOnline = map.ONLINE (fallback stok_gudang_online)", () => {
  assert.equal(bacaParitasOnline({ qty_per_gudang: { ONLINE: 4, D12: 9 } }), 4);
  assert.equal(bacaParitasOnline({ stok_gudang_online: 6 }), 6);
  assert.equal(bacaParitasOnline({}), 0);
});

// --- payloadQtyGudang (murni) ---

test("payloadQtyGudang: gudang ONLINE -> tulis map + stok_gudang_online", () => {
  const p = payloadQtyGudang({ qty_per_gudang: { D12: 1 }, stok_gudang_online: 1 }, "ONLINE", 5);
  assert.equal(p.qty_per_gudang.ONLINE, 5);
  assert.equal(p.qty_per_gudang.D12, 1, "key lain dipertahankan");
  assert.equal(p.stok_gudang_online, 5);
});

test("payloadQtyGudang: gudang non-ONLINE -> map saja, stok_gudang_online tidak disentuh", () => {
  const p = payloadQtyGudang({ qty_per_gudang: { ONLINE: 3 }, stok_gudang_online: 3 }, "D12", 8);
  assert.equal(p.qty_per_gudang.D12, 8);
  assert.equal(p.qty_per_gudang.ONLINE, 3);
  assert.equal(p.stok_gudang_online, undefined);
});

// --- buatStokAwal: paritas awal ---

test("buatStokAwal menulis qty_per_gudang.ONLINE == stok_gudang_online", async () => {
  await stok.buatStokAwal(KODE, 10, { userId: uid });
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.stok_gudang_online, 10);
  assert.equal(doc.qty_per_gudang.ONLINE, 10);
});

// --- _ubahStokRelatif: paritas + isolasi key ---

test("tambahStok menyelaraskan stok_gudang_online dan qty_per_gudang.ONLINE", async () => {
  await stok.buatStokAwal(KODE, 10, { userId: uid });
  await stok.tambahStok(KODE, 5, uid);
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.stok_gudang_online, 15);
  assert.equal(doc.qty_per_gudang.ONLINE, 15);
});

test("kurangiStok menyelaraskan keduanya (tidak negatif-kan basis salah)", async () => {
  await stok.buatStokAwal(KODE, 10, { userId: uid });
  await stok.kurangiStok(KODE, 3, uid);
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.stok_gudang_online, 7);
  assert.equal(doc.qty_per_gudang.ONLINE, 7);
});

test("_ubahStokRelatif TIDAK menghapus key gudang lain di qty_per_gudang", async () => {
  await db.collection("stock").doc(KODE).set({ stok_gudang_online: 4, qty_per_gudang: { ONLINE: 4, D12: 99 } });
  await stok.tambahStok(KODE, 1, uid);
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.qty_per_gudang.D12, 99, "D12 harus utuh");
  assert.equal(doc.qty_per_gudang.ONLINE, 5);
});

test("_ubahStokRelatif pada dokumen lama (tanpa map) -> paritas dibentuk dari stok_gudang_online", async () => {
  // Dokumen pra-migrasi: hanya punya stok_gudang_online.
  await db.collection("stock").doc(KODE).set({ stok_gudang_online: 8 });
  await stok.tambahStok(KODE, 2, uid);
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.stok_gudang_online, 10);
  assert.equal(doc.qty_per_gudang.ONLINE, 10);
});

// --- timpaStokOpname ---

test("timpaStokOpname menyelaraskan paritas ONLINE", async () => {
  await stok.buatStokAwal(KODE, 10, { userId: uid });
  await stok.timpaStokOpname(KODE, 4, uid);
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.stok_gudang_online, 4);
  assert.equal(doc.qty_per_gudang.ONLINE, 4);
});

test("timpaStokOpname ke gudang non-ONLINE tidak mengubah stok_gudang_online", async () => {
  await stok.buatStokAwal(KODE, 10, { userId: uid });
  await stok.timpaStokOpname(KODE, 3, uid, "D12");
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.qty_per_gudang.D12, 3);
  assert.equal(doc.stok_gudang_online, 10, "stok_gudang_online tidak disentuh gudang lain");
});

// --- setQtyGudang ---

test("setQtyGudang: dokumen tidak ada -> null (jangan buat baru)", async () => {
  const hasil = await stok.setQtyGudang("TIDAK-ADA", "D12", 5, uid);
  assert.equal(hasil, null);
  assert.equal((await db.collection("stock").doc("TIDAK-ADA").get()).exists, false);
});

test("setQtyGudang: isolasi antar key (tulis D12 tidak mengubah D13)", async () => {
  await db.collection("stock").doc(KODE).set({ stok_gudang_online: 1, qty_per_gudang: { ONLINE: 1, D12: 2, D13: 7 } });
  const hasil = await stok.setQtyGudang(KODE, "D12", 50, uid);
  assert.equal(hasil.D12, 50);
  assert.equal(hasil.D13, 7);
  assert.equal(hasil.ONLINE, 1);
});

test("setQtyGudang gudang ONLINE -> stok_gudang_online ikut berubah (BR3)", async () => {
  await stok.buatStokAwal(KODE, 10, { userId: uid });
  await stok.setQtyGudang(KODE, "ONLINE", 25, uid);
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.qty_per_gudang.ONLINE, 25);
  assert.equal(doc.stok_gudang_online, 25);
});

test("setQtyGudang gudang non-ONLINE -> stok_gudang_online tidak berubah", async () => {
  await stok.buatStokAwal(KODE, 10, { userId: uid });
  await stok.setQtyGudang(KODE, "D12", 25, uid);
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.qty_per_gudang.D12, 25);
  assert.equal(doc.stok_gudang_online, 10);
});

// --- ambilStok: boundary baca ---

test("ambilStok mengembalikan qty_per_gudang ternormalisasi walau dokumen lama", async () => {
  await db.collection("stock").doc(KODE).set({ stok_gudang_online: 6 });
  const s = await stok.ambilStok(KODE);
  assert.deepEqual(s.qty_per_gudang, { ONLINE: 6 });
});

// --- tandaiTersinkron: TIDAK menyentuh stok (kontrak 4.5) ---

test("tandaiTersinkron TIDAK mengubah stok_gudang_online maupun qty_per_gudang", async () => {
  await stok.buatStokAwal(KODE, 10, { userId: uid });
  await stok.tandaiTersinkron(KODE, 999);
  const doc = (await db.collection("stock").doc(KODE).get()).data();
  assert.equal(doc.stok_gudang_online, 10, "stok tidak berubah");
  assert.equal(doc.qty_per_gudang.ONLINE, 10, "map tidak berubah");
  assert.equal(doc.last_synced_value, 999);
});
