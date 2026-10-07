// test/mutasiStok.test.js
// Uji integrasi tulis stok: transaksi atomik, stok negatif (fitur), audit 1 baris,
// normalisasi created_by string. Model NYATA + mock Firestore (PRD FR-WRITE-01/02/03, FR-DATA-01).
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
const mock = installMockFirestore();

const db = mock.db;
const stok = require("../lib/models/stok");
const movements = require("../lib/models/stockMovements");

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
});

test("tambahStok menaikkan saldo", async () => {
  await seedStok("A1", 10);
  const baru = await stok.tambahStok("A1", 5, "900001");
  assert.equal(baru, 15);
});

test("kurangiStok > saldo -> saldo NEGATIF (fitur, bukan error)", async () => {
  await seedStok("A2", 3);
  const baru = await stok.kurangiStok("A2", 5, "900001");
  assert.equal(baru, -2);
});

test("stok 3, delta -5 -> tersimpan -2 di dokumen", async () => {
  await seedStok("A3", 3);
  await stok.kurangiStok("A3", 5, "900001");
  const akhir = await db.collection("stock").doc("A3").get();
  assert.equal(akhir.data().stok_gudang_online, -2);
});

test("dua kurangi berturut -> hasil = jumlah delta (boleh negatif)", async () => {
  // CATATAN: mockFirestore tidak men-serialisasi runTransaction seperti Firestore nyata,
  // jadi test konkurensi paralel TIDAK dapat dibuktikan di sini. Yang diuji: setiap delta
  // diterapkan (tanpa clamping, tanpa error) dan akumulasi konsisten.
  // Verifikasi serialisasi transaksi nyata ada di Fase C4 (smoke manual / Firestore nyata).
  await seedStok("A4", 4);
  await stok.kurangiStok("A4", 3, "u1");
  const akhir = await stok.kurangiStok("A4", 3, "u2");
  assert.equal(akhir, -2);
  const doc = await db.collection("stock").doc("A4").get();
  assert.equal(doc.data().stok_gudang_online, -2);
});

test("hasil negatif TIDAK dilempar sebagai error (tanpa guard tolak-negatif)", async () => {
  await seedStok("A9", 1);
  const hasil = await stok.kurangiStok("A9", 10, "u1");
  assert.equal(hasil, -9);
});

test("timpaStokOpname menyetel nilai (termasuk 0)", async () => {
  await seedStok("A5", 7);
  const hasil = await stok.timpaStokOpname("A5", 0, "900001");
  assert.equal(hasil.stok_gudang_online, 0);
});

test("catatPergerakanStok: created_by numerik -> tersimpan STRING", async () => {
  await db.collection("admins").doc("900001").set({ name: "Budi", role: "owner" });
  const m = await movements.catatPergerakanStok({
    kode_barang: "A1",
    nama_terbaca: "Produk A1",
    qty: -3,
    type: "koreksi_manual",
    action_type: "kurangi_stok",
    source: "web_dashboard",
    created_by: 900001,
    requested_by: 900001,
    confirmed_by: 900001,
  });
  assert.equal(typeof m.created_by, "string");
  assert.equal(m.created_by, "900001");
  assert.equal(m.requested_by, "900001");
  assert.equal(m.confirmed_by, "900001");
});

test("catatPergerakanStok: created_by null tetap null", async () => {
  const m = await movements.catatPergerakanStok({
    kode_barang: "A1",
    nama_terbaca: "X",
    qty: 1,
    type: "restock",
    source: "manual_chat",
    created_by: null,
  });
  assert.equal(m.created_by, null);
});

test("audit baris tertulis 1 per aksi dengan source web_dashboard", async () => {
  await seedStok("A6", 5);
  await stok.kurangiStok("A6", 2, "900001");
  await movements.catatPergerakanStok({
    kode_barang: "A6",
    nama_terbaca: "Produk A6",
    qty: -2,
    type: "koreksi_manual",
    action_type: "kurangi_stok",
    source: "web_dashboard",
    created_by: "900001",
  });
  const snap = await db.collection("stock_movements").get();
  assert.equal(snap.docs.length, 1);
  const doc = snap.docs[0].data();
  assert.equal(doc.source, "web_dashboard");
  assert.equal(doc.action_type, "kurangi_stok");
  assert.equal(doc.qty, -2);
});

test("opname memakai type opname + action_type kurangi_stok (PRD A1)", async () => {
  await db.collection("admins").doc("900001").set({ name: "B", role: "owner" });
  const m = await movements.catatPergerakanStok({
    kode_barang: "A7",
    nama_terbaca: "Produk A7",
    qty: 0,
    type: "opname",
    action_type: "kurangi_stok",
    qty_sistem: 2,
    qty_fisik: 0,
    selisih: -2,
    source: "web_dashboard",
    created_by: "900001",
  });
  assert.equal(m.type, "opname");
  assert.equal(m.action_type, "kurangi_stok");
  assert.equal(m.selisih, -2);
});

test("jalur bot: catatPergerakanStok kurangi_stok menyimpan qty NEGATIF (kontrak delta bertanda)", async () => {
  // Regresi: jalur bot (manual_chat) dulu menulis magnitudo positif walau mengurangi stok,
  // merusak formatDelta UI & rata-rata pemakaian harian. store harus negatif.
  const m = await movements.catatPergerakanStok({
    kode_barang: "A8",
    nama_terbaca: "Produk A8",
    qty: -Math.abs(3),
    type: "koreksi_manual",
    action_type: "kurangi_stok",
    source: "manual_chat",
    created_by: "900001",
  });
  assert.equal(m.qty, -3);

  const snap = await db.collection("stock_movements").get();
  assert.equal(snap.docs[0].data().qty, -3);
});

test("jalur bot: catatPergerakanStok tambah_stok menyimpan qty POSITIF", async () => {
  const m = await movements.catatPergerakanStok({
    kode_barang: "A8",
    nama_terbaca: "Produk A8",
    qty: Math.abs(5),
    type: "koreksi_manual",
    action_type: "tambah_stok",
    source: "manual_chat",
    created_by: "900001",
  });
  assert.equal(m.qty, 5);
});

test("opname: qty movement = selisih (delta bertanda)", async () => {
  const m = await movements.catatPergerakanStok({
    kode_barang: "A7",
    nama_terbaca: "Produk A7",
    qty: -2, // selisih = qty_fisik - qty_sistem
    type: "opname",
    qty_sistem: 5,
    qty_fisik: 3,
    selisih: -2,
    action_type: "kurangi_stok",
    source: "manual_chat",
    created_by: "900001",
  });
  assert.equal(m.qty, -2);
  assert.equal(m.qty, m.selisih);
});
