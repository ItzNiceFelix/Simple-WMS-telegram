// test/adminGudangJabatan.test.js
// Wave 2 v5: set-gudang-user + set-jabatan (F3/F4) + AK (T12: jabatan bukan otorisasi).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const admins = require("../lib/models/admins");
const uid = "900000";
const target = "900002";

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

async function siapkanTarget(extra = {}) {
  await db.collection("admins").doc(target).set({ name: "Budi", role: "admin", ...extra });
}

test("setGudangUser: menulis gudang_id, role TIDAK berubah", async () => {
  await siapkanTarget();
  const h = await admins.setGudangUser(target, "D12", uid);
  assert.equal(h.ok, true);
  assert.equal(h.admin.gudang_id, "D12");
  assert.equal(h.admin.role, "admin", "role tidak berubah");
});

test("setGudangUser: gudang_id null menghapus penetapan", async () => {
  await siapkanTarget({ gudang_id: "D12" });
  const h = await admins.setGudangUser(target, null, uid);
  assert.equal(h.admin.gudang_id, null);
});

test("setGudangUser: user tidak ada -> 404", async () => {
  const h = await admins.setGudangUser("999999", "D12", uid);
  assert.equal(h.status, 404);
  assert.equal(h.error, "User belum terdaftar.");
});

test("setGudangUser: audit tercatat di admin_role_changes dengan catatan set_gudang", async () => {
  await siapkanTarget();
  await admins.setGudangUser(target, "D12", uid);
  const snap = await db.collection("admin_role_changes").get();
  assert.equal(snap.docs.length, 1);
  const a = snap.docs[0].data();
  assert.equal(a.catatan, "set_gudang");
  assert.equal(a.old_role, a.new_role, "role tidak berubah di audit");
});

test("setJabatan: menulis jabatan, role TIDAK berubah", async () => {
  await siapkanTarget();
  const h = await admins.setJabatan(target, "Admin Stok", uid);
  assert.equal(h.admin.jabatan, "Admin Stok");
  assert.equal(h.admin.role, "admin");
});

test("setJabatan: kosong -> null (hapus label)", async () => {
  await siapkanTarget({ jabatan: "Lama" });
  const h = await admins.setJabatan(target, "   ", uid);
  assert.equal(h.admin.jabatan, null);
});

test("setJabatan: user tidak ada -> 404", async () => {
  const h = await admins.setJabatan("999999", "X", uid);
  assert.equal(h.status, 404);
});

test("T12: jabatan bernilai 'owner' TIDAK menaikkan permission (role tetap)", async () => {
  await db.collection("admins").doc(target).set({ name: "G", role: "guest" });
  await admins.setJabatan(target, "owner", uid);
  const a = await admins.ambilAdmin(target);
  assert.equal(a.jabatan, "owner", "label tersimpan");
  assert.equal(a.role, "guest", "permission TIDAK berubah");
  assert.equal(await admins.isSuperAdmin(target), false, "bukan super admin");
});

test("T12: perubahan jabatan TIDAK menghasilkan audit role berubah", async () => {
  await siapkanTarget();
  await admins.setJabatan(target, "Admin Stok", uid);
  const snap = await db.collection("admin_role_changes").get();
  assert.equal(snap.docs.length, 0, "set-jabatan tidak menulis audit role");
});

test("ambilAdminBergudang: hanya user dengan gudang_id terisi (Q5a)", async () => {
  await db.collection("admins").doc("111").set({ name: "A", role: "admin", gudang_id: "D12" });
  await db.collection("admins").doc("222").set({ name: "B", role: "guest" });
  await db.collection("admins").doc("333").set({ name: "C", role: "admin", gudang_id: null });
  const hasil = await admins.ambilAdminBergudang();
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].telegram_user_id, "111");
});

test("tambahAdmin: menerima jabatan + gudang_id opsional", async () => {
  const a = await admins.tambahAdmin("555", { name: "X", role: "admin", jabatan: "Admin Stok", gudang_id: "D12" });
  assert.equal(a.jabatan, "Admin Stok");
  assert.equal(a.gudang_id, "D12");
});
