// test/bacaStokOnlineFilter.test.js
// Regresi bug "produk Kledo tidak muncul di halaman stok".
//
// Penyebab: `/api/baca?scope=stok` memakai `url.searchParams.get("is_online") !== "false"`,
// sehingga param yang TIDAK dikirim dianggap `true`. Halaman stok sengaja berhenti mengirim
// is_online supaya semua produk tampil — tapi justru karena itu ia menerima subset
// online-saja: 692 dari 1174 produk (semua hasil sinkron Kledo) hilang, DAN pencarian gagal
// menemukannya karena `q` digabung AND dengan syarat `is_online_product = 1`.
//
// Aturan yang dikunci di sini: penyaringan online HARUS opt-in. Tidak mengirim param =
// TIDAK menyaring. Ini penting karena kegagalannya senyap — tidak ada error, hanya data
// yang hilang, dan itu terbaca seperti "sinkron gagal".
//
// Salinan murni dari baris keputusan di `app/api/baca/route.ts`. File itu route TypeScript
// dengan impor D1 sehingga tidak bisa di-require test CJS; menyalin satu ekspresi lebih
// murah daripada menambah bundler. Bila keputusan produksi berubah, test ini WAJIB ikut.
const { test } = require("node:test");
const assert = require("node:assert/strict");

/** Cermin: const onlineSaja = url.searchParams.get("is_online") === "true"; */
function onlineSaja(isOnlineParam) {
  return isOnlineParam === "true";
}

/** Cermin: syarat WHERE yang dibangun route. */
function syarat(sku, isOnlineParam) {
  const s = [];
  if (onlineSaja(isOnlineParam)) s.push("p.is_online_product = 1");
  if (sku) s.push("(lower(p.sku) LIKE ? OR lower(p.nama_accurate) LIKE ?)");
  return s;
}

test("param TIDAK dikirim -> tidak menyaring (halaman stok melihat semua produk)", () => {
  assert.equal(onlineSaja(null), false);
  assert.deepEqual(syarat("100052", null), ["(lower(p.sku) LIKE ? OR lower(p.nama_accurate) LIKE ?)"]);
});

test("is_online=true -> hanya produk online (perilaku opt-in tetap ada)", () => {
  assert.equal(onlineSaja("true"), true);
  assert.deepEqual(syarat(null, "true"), ["p.is_online_product = 1"]);
});

test("is_online=false -> tidak menyaring (bukan berarti 'hanya non-online')", () => {
  assert.equal(onlineSaja("false"), false);
  assert.deepEqual(syarat(null, "false"), []);
});

test("nilai lain tidak menyaring — hanya 'true' yang mengaktifkan", () => {
  for (const v of ["semua", "", "1", "TRUE", "ya"]) {
    assert.equal(onlineSaja(v), false, `nilai ${JSON.stringify(v)} tidak boleh menyaring`);
  }
});

test("mencari SKU non-online TIDAK ikut menyaring online", () => {
  // Inilah yang dulu membuat "search sku tidak muncul": q dan is_online_product=1
  // digabung AND, jadi SKU yang ada pun tak ditemukan.
  const s = syarat("100052", null);
  assert.equal(s.length, 1);
  assert.ok(!s.some((x) => x.includes("is_online_product")), "syarat pencarian tidak boleh memaksa online");
});
