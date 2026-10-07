// test/opnameGudang.test.js
// Wave v5 F7: opname gudang dengan approval owner (CAS T9).
// Fokus LOGIKA fungsi via mock Firestore. Ringan, tanpa network.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { installMockFirestore } = require("./helpers/mockFirestore");
const mock = installMockFirestore();
const db = mock.db;

const m = require("../lib/models/opnameGudang");

const ADMIN = "111";
const OWNER = "900001";
const GUDANG = "D12";

function kosongkan() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
}
beforeEach(kosongkan);

/** Fixture dasar: gudang aktif, admin scope D12, owner, satu stok B1 di D12. */
async function siapkan() {
  await db.collection("gudang").doc(GUDANG).set({ nama: "D12", aktif: true });
  await db.collection("admins").doc(ADMIN).set({ name: "Admin", role: "admin", gudang_id: GUDANG });
  await db.collection("admins").doc(OWNER).set({ name: "Owner", role: "owner" });
  await db.collection("stock").doc("B1").set({
    stok_gudang_online: 10,
    qty_per_gudang: { ONLINE: 10, D12: 10 },
  });
}

async function qtyD12(kode = "B1") {
  const doc = await db.collection("stock").doc(kode).get();
  return doc.data().qty_per_gudang[GUDANG];
}

// 1. selisih 0 -> langsung disetujui + qty ditulis
test("buat selisih 0 -> disetujui + qty_per_gudang[D12] = qty_fisik", async () => {
  await siapkan();
  const hasil = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "B1", qty_fisik: 10 }], oleh: ADMIN });
  assert.equal(hasil.ok, true);
  assert.equal(hasil.status, "disetujui");
  assert.equal(hasil.langsung, true);
  assert.equal(hasil.opname.status, "disetujui");
  assert.equal(await qtyD12(), 10);
});

// 2. ada selisih -> menunggu_approval, qty TIDAK berubah
test("buat ada selisih -> menunggu_approval, qty_per_gudang TIDAK berubah", async () => {
  await siapkan();
  const hasil = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "B1", qty_fisik: 7 }], oleh: ADMIN });
  assert.equal(hasil.ok, true);
  assert.equal(hasil.status, "menunggu_approval");
  assert.equal(hasil.langsung, false);
  const item = hasil.opname.items[0];
  assert.equal(item.qty_sistem, 10);
  assert.equal(item.selisih, -3);
  assert.equal(await qtyD12(), 10, "qty sistem tidak boleh berubah sebelum approval");
});

// 3. item tanpa key gudang -> belum_terdaftar, selisih 0, tidak picu approval
test("item belum_terdaftar -> belum_terdaftar:true, selisih:0, langsung disetujui, qty tidak ditulis", async () => {
  await siapkan();
  await db.collection("stock").doc("B2").set({ stok_gudang_online: 5, qty_per_gudang: { ONLINE: 5 } });
  const hasil = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "B2", qty_fisik: 99 }], oleh: ADMIN });
  assert.equal(hasil.status, "disetujui");
  const item = hasil.opname.items[0];
  assert.equal(item.belum_terdaftar, true);
  assert.equal(item.qty_sistem, null);
  assert.equal(item.selisih, 0);
  const doc = (await db.collection("stock").doc("B2").get()).data();
  assert.equal(doc.qty_per_gudang.D12, undefined, "key gudang baru TIDAK boleh ditulis untuk item belum_terdaftar");
});

// 4. kode_barang tanpa dokumen stock -> 404
test("buat kode_barang tanpa dokumen stock -> 404", async () => {
  await siapkan();
  const hasil = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "TIDAK-ADA", qty_fisik: 1 }], oleh: ADMIN });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 404);
  assert.equal(hasil.error, "Stok produk tidak ditemukan.");
});

// 5. qty_fisik negatif -> 400
test("buat qty_fisik negatif -> 400", async () => {
  await siapkan();
  const hasil = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "B1", qty_fisik: -1 }], oleh: ADMIN });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 400);
});

// 6. items kosong -> 400
test("buat items kosong -> 400 Opname belum berisi item.", async () => {
  await siapkan();
  const hasil = await m.buatOpname({ gudang_id: GUDANG, items: [], oleh: ADMIN });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 400);
  assert.equal(hasil.error, "Opname belum berisi item.");
});

// 7. item duplikat -> 400
test("buat item duplikat -> 400 Item duplikat dalam opname.", async () => {
  await siapkan();
  const hasil = await m.buatOpname({
    gudang_id: GUDANG,
    items: [{ kode_barang: "B1", qty_fisik: 10 }, { kode_barang: "B1", qty_fisik: 9 }],
    oleh: ADMIN,
  });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 400);
  assert.equal(hasil.error, "Item duplikat dalam opname.");
});

// 8. gudang tidak ada -> 400
test("buat gudang tidak ada -> 400", async () => {
  await siapkan();
  const hasil = await m.buatOpname({ gudang_id: "GHOST", items: [{ kode_barang: "B1", qty_fisik: 10 }], oleh: ADMIN });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 400);
});

// 9. setujui owner -> qty ditulis semua item, status disetujui, field approver terisi
test("setujui owner -> qty_per_gudang[D12] = qty_fisik + status disetujui", async () => {
  await siapkan();
  await db.collection("stock").doc("B2").set({ stok_gudang_online: 4, qty_per_gudang: { ONLINE: 4, D12: 4 } });
  const buat = await m.buatOpname({
    gudang_id: GUDANG,
    items: [{ kode_barang: "B1", qty_fisik: 7 }, { kode_barang: "B2", qty_fisik: 2 }],
    oleh: ADMIN,
  });
  assert.equal(buat.status, "menunggu_approval");
  const hasil = await m.setujuiOpname(buat.opname.opname_id, OWNER);
  assert.equal(hasil.ok, true);
  assert.equal(hasil.opname.status, "disetujui");
  assert.equal(hasil.opname.disetujui_oleh, OWNER);
  assert.ok(hasil.opname.disetujui_at, "disetujui_at harus terisi");
  assert.equal(await qtyD12("B1"), 7);
  assert.equal(await qtyD12("B2"), 2);
});

// 10. setujui non-owner -> 403
test("setujui non-owner -> 403", async () => {
  await siapkan();
  const buat = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "B1", qty_fisik: 7 }], oleh: ADMIN });
  const hasil = await m.setujuiOpname(buat.opname.opname_id, ADMIN);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 403);
  assert.equal(hasil.error, "Hanya owner yang dapat menyetujui opname.");
  assert.equal(await qtyD12(), 10, "qty tidak berubah saat ditolak otorisasi");
});

// 11. status bukan menunggu_approval -> 409
test("setujui status bukan menunggu_approval -> 409 Opname sudah diproses.", async () => {
  await siapkan();
  const buat = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "B1", qty_fisik: 10 }], oleh: ADMIN });
  assert.equal(buat.status, "disetujui", "selisih 0 -> langsung disetujui");
  const hasil = await m.setujuiOpname(buat.opname.opname_id, OWNER);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 409);
  assert.equal(hasil.error, "Opname sudah diproses.");
});

// 12. CAS T9: qty sistem berubah setelah opname dibuat -> 409 + qty TIDAK berubah
test("CAS T9: stok berubah sejak opname -> 409, qty tetap nilai hasil ubah lain", async () => {
  await siapkan();
  const buat = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "B1", qty_fisik: 7 }], oleh: ADMIN });
  assert.equal(buat.status, "menunggu_approval");
  // Jalur lain mengubah qty D12 -> 55.
  await db.collection("stock").doc("B1").set({ qty_per_gudang: { ONLINE: 10, D12: 55 } }, { merge: true });
  const hasil = await m.setujuiOpname(buat.opname.opname_id, OWNER);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 409);
  assert.equal(hasil.error, "Stok berubah sejak opname dibuat. Buat ulang.");
  assert.equal(await qtyD12(), 55, "qty tidak boleh ditimpa oleh setujui yang gagal CAS");
});

// 13. tolak owner -> ditolak, qty TIDAK berubah
test("tolak owner -> status ditolak, qty_per_gudang TIDAK berubah", async () => {
  await siapkan();
  const buat = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "B1", qty_fisik: 3 }], oleh: ADMIN });
  const hasil = await m.tolakOpname(buat.opname.opname_id, OWNER);
  assert.equal(hasil.ok, true);
  assert.equal(hasil.opname.status, "ditolak");
  assert.equal(await qtyD12(), 10);
});

// 14. setujui menulis stock_movements per item
test("setujui menulis stock_movements type opname per item", async () => {
  await siapkan();
  await db.collection("products").doc("B1").set({ nama_accurate: "Barang Satu" });
  const buat = await m.buatOpname({ gudang_id: GUDANG, items: [{ kode_barang: "B1", qty_fisik: 6 }], oleh: ADMIN });
  await m.setujuiOpname(buat.opname.opname_id, OWNER);
  const snap = await db.collection("stock_movements").get();
  const mv = snap.docs.map((d) => d.data()).filter((d) => d.type === "opname");
  assert.equal(mv.length, 1);
  assert.equal(mv[0].kode_barang, "B1");
  assert.equal(mv[0].type, "opname");
  assert.equal(mv[0].qty_sistem, 10);
  assert.equal(mv[0].qty_fisik, 6);
  assert.equal(mv[0].selisih, -4);
  assert.equal(mv[0].gudang_id, GUDANG);
});