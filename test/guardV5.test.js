// test/guardV5.test.js
// Wave 2 v5: guard dobel-proses (BR11 kategori A). Murni logika + mock.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const guard = require("../lib/dashboard/guardV5");

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

test("guardAktif: dokumen belum ada -> false", async () => {
  assert.equal(await guard.guardAktif(db, guard.KOLEKSI.gudang, "tambah:1"), false);
});

test("guardAktif: setelah tulisGuard -> true", async () => {
  await guard.tulisGuard(db, guard.KOLEKSI.gudang, "tambah:1", { nama: "D12" });
  assert.equal(await guard.guardAktif(db, guard.KOLEKSI.gudang, "tambah:1"), true);
});

test("guardAktif: lewat TTL -> false", async () => {
  await guard.tulisGuard(db, guard.KOLEKSI.gudang, "tambah:1", {});
  const nanti = Date.now() + guard.TTL_MS + 1;
  assert.equal(await guard.guardAktif(db, guard.KOLEKSI.gudang, "tambah:1", null, nanti), false);
});

test("guardAktif: pembanding cocok -> true (duplikat)", async () => {
  await guard.tulisGuard(db, guard.KOLEKSI.permintaan, "buat:1", { dari: "D12", tujuan: ["G2"] });
  const dup = await guard.guardAktif(db, guard.KOLEKSI.permintaan, "buat:1", { dari: "D12", tujuan: ["G2"] });
  assert.equal(dup, true);
});

test("guardAktif: pembanding beda -> false (aksi berbeda boleh jalan)", async () => {
  await guard.tulisGuard(db, guard.KOLEKSI.permintaan, "buat:1", { dari: "D12" });
  const beda = await guard.guardAktif(db, guard.KOLEKSI.permintaan, "buat:1", { dari: "G99" });
  assert.equal(beda, false);
});

test("kunciGuard memisahkan aksi per uid", () => {
  assert.equal(guard.kunciGuard("buat", "1"), "buat:1");
  assert.notEqual(guard.kunciGuard("buat", "1"), guard.kunciGuard("kirim", "1"));
});

test("tulisGuard menimpa (merge false) - tidak menumpuk field lama", async () => {
  await guard.tulisGuard(db, guard.KOLEKSI.stokGudang, "set-qty:1", { kode: "B1", qty: 5 });
  await guard.tulisGuard(db, guard.KOLEKSI.stokGudang, "set-qty:1", { kode: "B2", qty: 9 });
  const doc = (await db.collection(guard.KOLEKSI.stokGudang).doc("set-qty:1").get()).data();
  assert.equal(doc.kode, "B2");
  assert.equal(doc.qty, 9);
});

test("normalisasiMillis: number, Date, sentinel Timestamp", () => {
  assert.equal(guard.normalisasiMillis(1000), 1000);
  assert.equal(guard.normalisasiMillis(new Date(2000)), 2000);
  assert.equal(guard.normalisasiMillis({ seconds: 3 }), 3000);
  assert.ok(Number.isNaN(guard.normalisasiMillis("x")));
});

test("guard best-effort: koleksi berbeda tidak saling ganggu", async () => {
  await guard.tulisGuard(db, guard.KOLEKSI.opname, "buat:1", {});
  assert.equal(await guard.guardAktif(db, guard.KOLEKSI.opname, "buat:1"), true);
  assert.equal(await guard.guardAktif(db, guard.KOLEKSI.gudang, "buat:1"), false);
});
