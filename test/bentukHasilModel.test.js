// test/bentukHasilModel.test.js
// REGRESI: route membaca field dengan nama/level SALAH dari hasil model -> notifikasi gagal
// senyap ("tidak ada penerima") padahal data benar.
//
// Kejadian nyata (produksi): route baca `hasil.tujuan` dan `hasil.permintaan_id`, padahal
// model mengembalikan { ok, permintaan: { permintaan_id, tujuan, items, ... } }.
// Akibat: tujuanNotif undefined + idNotif "undefined".
//
// Kelas bug ini lolos tsc karena tipe hasil route memakai index signature
// ({ ok: boolean; [k: string]: unknown }), dan lolos test route karena test memakai SPY
// yang return-nya tidak mencerminkan bentuk model asli.
//
// Test ini MENGUNCI bentuk hasil model supaya route yang salah baca ketahuan.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const m = require("../lib/models/permintaanGudang");

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

async function siapkan() {
  await db.collection("gudang").doc("D12").set({ nama: "Gudang D12", aktif: true });
  await db.collection("gudang").doc("D13").set({ nama: "Gudang D13", aktif: true });
  await db.collection("admins").doc("111").set({ name: "Pembuat", role: "admin", gudang_id: "D12" });
  await db.collection("admins").doc("222").set({ name: "Penerima", role: "admin", gudang_id: "D13" });
  await db.collection("admins").doc("900001").set({ name: "Owner", role: "owner" });
  await db.collection("stock").doc("B1").set({
    stok_gudang_online: 10,
    qty_per_gudang: { ONLINE: 10, D12: 10 },
  });
}

async function buat() {
  await siapkan();
  return m.buatPermintaan({
    dari_gudang_id: "D12",
    tujuan: [{ tipe: "gudang", id: "D13", user_penerima_id: "222", items: [{ kode_barang: "B1", qty: 2 }] }],
    items: [{ kode_barang: "B1", qty: 2 }],
    oleh: "111",
  });
}

test("buatPermintaan: dokumen ada di hasil.permintaan (BUKAN level atas)", async () => {
  const hasil = await buat();
  assert.equal(hasil.ok, true);
  assert.ok(hasil.permintaan, "harus ada hasil.permintaan");
  assert.equal(hasil.tujuan, undefined, "hasil.tujuan TIDAK ada di level atas");
  assert.equal(hasil.permintaan_id, undefined, "hasil.permintaan_id TIDAK ada di level atas");
});

test("buatPermintaan: hasil.permintaan punya permintaan_id + tujuan + items", async () => {
  const hasil = await buat();
  const dok = hasil.permintaan;
  assert.ok(typeof dok.permintaan_id === "string" && dok.permintaan_id.length > 0, "permintaan_id ada");
  assert.ok(Array.isArray(dok.tujuan) && dok.tujuan.length === 1, "tujuan array 1 entri");
  assert.ok(Array.isArray(dok.items), "items array");
});

test("buatPermintaan: penerima tersimpan di permintaan.tujuan[0]", async () => {
  const hasil = await buat();
  const t = hasil.permintaan.tujuan[0];
  assert.equal(t.user_penerima_id, "222");
  assert.equal(t.user_penerima_nama, "Penerima");
  assert.equal(t.status_kirim, "menunggu");
  assert.equal(t.tipe, "gudang");
});

test("kirimPermintaan: hasil juga berbentuk { ok, permintaan: {...} }", async () => {
  const hasil = await buat();
  const id = hasil.permintaan.permintaan_id;
  await m.setujuiTujuan(id, 0, "222");
  const kirim = await m.kirimPermintaan(id, 0, "222");
  assert.equal(kirim.ok, true);
  assert.ok(kirim.permintaan, "ada permintaan");
  assert.equal(kirim.tujuan, undefined, "tidak ada tujuan di level atas");
  assert.equal(kirim.permintaan.status, "dikirim");
});

test("selesaiPermintaan: hasil berbentuk { ok, permintaan: {...} }", async () => {
  const hasil = await buat();
  const id = hasil.permintaan.permintaan_id;
  await m.setujuiTujuan(id, 0, "222");
  await m.kirimPermintaan(id, 0, "222");
  await m.terimaPermintaan(id, 0, "111");
  const selesai = await m.selesaiPermintaan(id, "111");
  assert.equal(selesai.ok, true);
  assert.ok(selesai.permintaan, "ada permintaan");
  assert.equal(selesai.permintaan.status, "selesai");
});

test("route permintaan-gudang membalas { ok, permintaan } (bukan level atas)", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "app", "api", "permintaan-gudang", "route.ts"),
    "utf8"
  );
  const kode = src
    .split("\n")
    .filter((b) => !b.trim().startsWith("//"))
    .join("\n");
  assert.ok(/permintaan:\s*h\.transfer/.test(kode), "route membalas { permintaan: hasil.transfer }");
  assert.ok(
    !/Array\.isArray\(hasil\.tujuan\)/.test(kode),
    "route TIDAK boleh membaca hasil.tujuan di level atas (bug lama)"
  );
});
