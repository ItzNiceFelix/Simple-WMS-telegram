// test/editProduk.test.js
// PRD §2.7 — edit HPP / HPP baru. Menguji validasi murni (validasiTulisV2) dan
// primitif model (updateProduk, catatPerubahanProduk, cache) yang dipakai route.
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

const produk = require("../lib/models/produk");
const { catatPerubahanProduk } = require("../lib/models/productChanges");
const { validasiHpp } = require("../lib/dashboard/validasiTulisV2");

// Helper: jalankan alur route di level model memakai helper validasi yang sama.
// Mirror urutan route: validasi -> owner-only -> ambil produk -> idempotent -> tulis -> audit.
async function jalankanEditHpp({ body, role, changedBy = "1" }) {
  const valid = validasiHpp(body);
  if (!valid.ok) return { status: 400, error: valid.error, tulis: false };
  if (role !== "owner") return { status: 403, error: "Hanya owner yang dapat mengubah HPP.", tulis: false };

  const lama = await produk.ambilProdukByKode(valid.kodeBarang);
  if (!lama) return { status: 404, error: "Produk tidak ditemukan.", tulis: false };

  const hppSama = !valid.adaHpp || lama.hpp === valid.hpp;
  const hppBaruSama = !valid.adaHppBaru || (lama.hpp_baru ?? null) === (valid.hppBaru ?? null);
  if (hppSama && hppBaruSama) return { status: 200, produk: lama, tulis: false, audit: 0 };

  const partial = {};
  if (valid.adaHpp) partial.hpp = valid.hpp;
  if (valid.adaHppBaru) partial.hpp_baru = valid.hppBaru;
  const baru = await produk.updateProduk(valid.kodeBarang, partial);

  let audit = 0;
  if (valid.adaHpp && lama.hpp !== valid.hpp) {
    await catatPerubahanProduk({
      kodeBarang: valid.kodeBarang,
      field: "hpp",
      nilaiLama: lama.hpp ?? null,
      nilaiBaru: valid.hpp ?? null,
      changedBy,
    });
    audit += 1;
  }
  if (valid.adaHppBaru && (lama.hpp_baru ?? null) !== (valid.hppBaru ?? null)) {
    await catatPerubahanProduk({
      kodeBarang: valid.kodeBarang,
      field: "hpp_baru",
      nilaiLama: lama.hpp_baru ?? null,
      nilaiBaru: valid.hppBaru ?? null,
      changedBy,
    });
    audit += 1;
  }
  return { status: 200, produk: baru, tulis: true, audit };
}

function resetStore() {
  for (const key of mock.collections.keys()) mock.collections.get(key).clear();
  produk.invalidasiCacheProduk();
}

async function seedProduk(kode, data) {
  await db.collection("products").doc(kode).set({ nama_accurate: `Produk ${kode}`, ...data });
}

beforeEach(() => resetStore());

test("1. owner ubah hpp 85000->90000, hpp_baru tetap", async () => {
  await seedProduk("K1", { hpp: 85000, hpp_baru: 80000 });
  const hasil = await jalankanEditHpp({ body: { kode_barang: "K1", hpp: 90000 }, role: "owner" });
  assert.equal(hasil.status, 200);
  const doc = (await db.collection("products").doc("K1").get()).data();
  assert.equal(doc.hpp, 90000);
  assert.equal(doc.hpp_baru, 80000);
});

test("2. owner ubah hpp_baru -> null, doc simpan hpp_baru null", async () => {
  await seedProduk("K2", { hpp: 85000, hpp_baru: 80000 });
  const hasil = await jalankanEditHpp({ body: { kode_barang: "K2", hpp_baru: null }, role: "owner" });
  assert.equal(hasil.status, 200);
  const doc = (await db.collection("products").doc("K2").get()).data();
  assert.equal(doc.hpp_baru, null);
  assert.equal(doc.hpp, 85000);
});

test('3. hpp: "90000" (string) ditolak, tidak ada tulis', async () => {
  await seedProduk("K3", { hpp: 85000 });
  const valid = validasiHpp({ kode_barang: "K3", hpp: "90000" });
  assert.equal(valid.ok, false);
  assert.equal(valid.error, "HPP harus bilangan bulat >= 0.");

  const hasil = await jalankanEditHpp({ body: { kode_barang: "K3", hpp: "90000" }, role: "owner" });
  assert.equal(hasil.status, 400);
  assert.equal(hasil.tulis, false);
  assert.equal((await db.collection("products").doc("K3").get()).data().hpp, 85000);
});

test("4. non-owner (admin) -> 403, tidak ada tulis", async () => {
  await seedProduk("K4", { hpp: 85000 });
  const valid = validasiHpp({ kode_barang: "K4", hpp: 90000 });
  assert.equal(valid.ok, true, "validasi payload owner-only tetap OK");

  const hasil = await jalankanEditHpp({ body: { kode_barang: "K4", hpp: 90000 }, role: "admin" });
  assert.equal(hasil.status, 403);
  assert.equal(hasil.error, "Hanya owner yang dapat mengubah HPP.");
  assert.equal(hasil.tulis, false);
  assert.equal((await db.collection("products").doc("K4").get()).data().hpp, 85000);
});

test("5. produk tidak ada -> 404, tidak ada tulis", async () => {
  const hasil = await jalankanEditHpp({ body: { kode_barang: "GHOST", hpp: 90000 }, role: "owner" });
  assert.equal(hasil.status, 404);
  assert.equal(hasil.error, "Produk tidak ditemukan.");
  assert.equal(hasil.tulis, false);
  assert.equal((await db.collection("products").doc("GHOST").get()).exists, false);
});

test("6. sukses -> tepat 1 baris audit field hpp", async () => {
  await seedProduk("K6", { hpp: 85000 });
  const hasil = await jalankanEditHpp({ body: { kode_barang: "K6", hpp: 90000 }, role: "owner", changedBy: "777" });
  assert.equal(hasil.audit, 1);
  const snap = await db.collection("product_changes").get();
  assert.equal(snap.docs.length, 1);
  const row = snap.docs[0].data();
  assert.equal(row.field, "hpp");
  assert.equal(row.nilai_lama, 85000);
  assert.equal(row.nilai_baru, 90000);
  assert.equal(row.changed_by, "777");
});

test("7. dua field berubah -> tepat 2 baris audit", async () => {
  await seedProduk("K7", { hpp: 85000, hpp_baru: 80000 });
  const hasil = await jalankanEditHpp({
    body: { kode_barang: "K7", hpp: 90000, hpp_baru: 95000 },
    role: "owner",
  });
  assert.equal(hasil.audit, 2);
  const snap = await db.collection("product_changes").get();
  assert.equal(snap.docs.length, 2);
  const fields = snap.docs.map((d) => d.data().field).sort();
  assert.deepEqual(fields, ["hpp", "hpp_baru"]);
});

test("8. tidak ada perubahan -> 0 audit, model tidak ditulis", async () => {
  await seedProduk("K8", { hpp: 85000, hpp_baru: 80000 });
  const hasil = await jalankanEditHpp({ body: { kode_barang: "K8", hpp: 85000 }, role: "owner" });
  assert.equal(hasil.status, 200);
  assert.equal(hasil.tulis, false);
  assert.equal(hasil.audit, 0);
  assert.equal((await db.collection("product_changes").get()).docs.length, 0);
});

test("9. updateProduk menginvalidasi cache produk (observable)", async () => {
  await seedProduk("K9", { hpp: 85000 });
  // Isi cache.
  await produk.listSemuaProduk();
  await produk.listSemuaProduk();
  // Ubah dokumen langsung di mock (bypass model) -> cache masih basi.
  await db.collection("products").doc("K9").update({ hpp: 99000 });
  const cached = await produk.listSemuaProduk();
  assert.equal(cached.find((p) => p.kode_barang === "K9").hpp, 85000, "cache masih basi sebelum updateProduk");

  await produk.updateProduk("K9", { hpp: 90000 });
  const segar = await produk.listSemuaProduk();
  assert.equal(segar.find((p) => p.kode_barang === "K9").hpp, 90000, "cache terinvalidasi -> nilai baru terbaca");
});
