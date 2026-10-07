// test/gudangMaster.test.js
// Wave 2 v5: master gudang (F1) - logika model. Ringan, murni mock Firestore.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const gudang = require("../lib/models/gudang");
const uid = "900000";

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

test("tambah: sukses, aktif true, urutan naik", async () => {
  const a = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  const b = await gudang.tambahGudang({ nama: "D13", oleh: uid });
  assert.equal(a.ok, true);
  assert.equal(a.gudang.aktif, true);
  assert.equal(b.gudang.urutan, a.gudang.urutan + 1);
});

test("tambah: nama kosong ditolak route (validasi terpisah); model trim nama", async () => {
  const a = await gudang.tambahGudang({ nama: "  D12  ", oleh: uid });
  assert.equal(a.gudang.nama, "D12");
});

test("tambah: duplikat nama (case-insensitive, trim) -> 409", async () => {
  await gudang.tambahGudang({ nama: "Gudang Utama", oleh: uid });
  const d = await gudang.tambahGudang({ nama: "  gudang utama ", oleh: uid });
  assert.equal(d.ok, false);
  assert.equal(d.status, 409);
  assert.equal(d.error, "Nama gudang sudah dipakai.");
});

test("tambah: gudang ke-51 ditolak 400 (BR15)", async () => {
  for (let i = 0; i < 50; i++) await gudang.tambahGudang({ nama: "G" + i, oleh: uid });
  assert.equal(await gudang.jumlahGudang(), 50);
  const ke51 = await gudang.tambahGudang({ nama: "G-51", oleh: uid });
  assert.equal(ke51.ok, false);
  assert.equal(ke51.status, 400);
  assert.equal(ke51.error, "Maksimal 50 gudang.");
  assert.equal(await gudang.jumlahGudang(), 50, "tidak menulis dokumen");
});

test("tambah: gudang nonaktif dengan nama sama TIDAK menghalangi", async () => {
  const a = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  await gudang.nonaktifGudang(a.gudang.gudang_id, { oleh: uid });
  const b = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  assert.equal(b.ok, true);
});

test("edit: nama berubah, updated_at terisi", async () => {
  const a = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  const e = await gudang.editGudang(a.gudang.gudang_id, { nama: "Gudang D12", oleh: uid });
  assert.equal(e.ok, true);
  assert.equal(e.gudang.nama, "Gudang D12");
  assert.ok(e.gudang.updated_at);
});

test("edit: id tidak ada -> 404", async () => {
  const e = await gudang.editGudang("TIDAK-ADA", { nama: "X", oleh: uid });
  assert.equal(e.status, 404);
});

test("edit: nama duplikat gudang aktif lain -> 409", async () => {
  const a = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  await gudang.tambahGudang({ nama: "D13", oleh: uid });
  const e = await gudang.editGudang(a.gudang.gudang_id, { nama: "D13", oleh: uid });
  assert.equal(e.status, 409);
});

test("edit: nama sama dengan dirinya sendiri -> sukses (kecualiId)", async () => {
  const a = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  const e = await gudang.editGudang(a.gudang.gudang_id, { nama: "D12", oleh: uid });
  assert.equal(e.ok, true);
});

test("nonaktif: aktif jadi false, dokumen tetap ada", async () => {
  const a = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  const n = await gudang.nonaktifGudang(a.gudang.gudang_id, { oleh: uid });
  assert.equal(n.gudang.aktif, false);
  const masih = await gudang.ambilGudang(a.gudang.gudang_id);
  assert.ok(masih, "dokumen tidak dihapus");
});

test("nonaktif: peringatan_referensi menghitung admin + key stock (T11c)", async () => {
  const a = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  await db.collection("admins").doc("111").set({ name: "A", role: "admin", gudang_id: a.gudang.gudang_id });
  await db.collection("admins").doc("222").set({ name: "B", role: "admin", gudang_id: "LAIN" });
  await db.collection("stock").doc("B1").set({ stok_gudang_online: 1, qty_per_gudang: { [a.gudang.gudang_id]: 5 } });
  await db.collection("stock").doc("B2").set({ stok_gudang_online: 1, qty_per_gudang: { LAIN: 5 } });
  const n = await gudang.nonaktifGudang(a.gudang.gudang_id, { oleh: uid });
  assert.equal(n.peringatan_referensi, 2, "1 admin + 1 key stock");
});

test("aktifkan: aktif kembali true", async () => {
  const a = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  await gudang.nonaktifGudang(a.gudang.gudang_id, { oleh: uid });
  const ak = await gudang.aktifkanGudang(a.gudang.gudang_id, { oleh: uid });
  assert.equal(ak.gudang.aktif, true);
});

test("ambilSemuaGudang: default hanya aktif, {semua:true} menyertakan nonaktif", async () => {
  const a = await gudang.tambahGudang({ nama: "D12", oleh: uid });
  await gudang.tambahGudang({ nama: "D13", oleh: uid });
  await gudang.nonaktifGudang(a.gudang.gudang_id, { oleh: uid });
  assert.equal((await gudang.ambilSemuaGudang()).length, 1);
  assert.equal((await gudang.ambilSemuaGudang({ semua: true })).length, 2);
});

test("pastikanGudang: idempoten (ada -> tidak menimpa)", async () => {
  const a = await gudang.pastikanGudang("ONLINE", { nama: "ONLINE" });
  assert.equal(a.sudahAda, false);
  const b = await gudang.pastikanGudang("ONLINE", { nama: "DIUBAH" });
  assert.equal(b.sudahAda, true);
  assert.equal(b.gudang.nama, "ONLINE", "nama tidak ditimpa");
});

test("idGudangValid: tolak path separator & id terlarang", () => {
  assert.equal(gudang.idGudangValid("D12"), true);
  assert.equal(gudang.idGudangValid("a/b"), false);
  assert.equal(gudang.idGudangValid(".."), false);
  assert.equal(gudang.idGudangValid(""), false);
});

test("MAX: tepat 50 sukses, ke-51 gagal (batas inklusif)", async () => {
  for (let i = 0; i < 49; i++) await gudang.tambahGudang({ nama: "G" + i, oleh: uid });
  const ke50 = await gudang.tambahGudang({ nama: "G49", oleh: uid });
  assert.equal(ke50.ok, true, "gudang ke-50 sukses");
  const ke51 = await gudang.tambahGudang({ nama: "G50", oleh: uid });
  assert.equal(ke51.ok, false);
});
