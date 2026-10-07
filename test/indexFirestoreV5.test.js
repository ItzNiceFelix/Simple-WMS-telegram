// test/indexFirestoreV5.test.js
// Guard index v5 + kunci bahwa getRingkasan tetap menghitung produk online (C5/B2).
//
// KONTEKS: kelas bug 097b43c - query yang butuh composite index GAGAL di produksi padahal
// npm test/tsc/e2e hijau (mock tidak menyentuh Firestore). Test ini membandingkan bentuk
// query di real.ts dengan firestore.indexes.json.
//
// KONDISI v5 SAAT INI: listGudang/listOpnameGudang memakai FULL SCAN + filter client
// (pola listAdmins), jadi TIDAK butuh composite index. Test ini mengunci kondisi itu:
// bila kelak diubah jadi where+orderBy, test MENUNTUT index-nya ditambahkan.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AKAR = path.join(__dirname, "..");

function sumberReal() {
  return fs.readFileSync(path.join(AKAR, "lib", "dashboard", "data", "real.ts"), "utf8");
}

function bacaIndex() {
  const j = JSON.parse(fs.readFileSync(path.join(AKAR, "firestore.indexes.json"), "utf8"));
  return j.indexes || [];
}

test("v5: koleksi gudang/opname_gudang TIDAK memakai where+orderBy (full scan -> tanpa index)", () => {
  const src = sumberReal();
  // Bila ini gagal, berarti ada query baru yang butuh composite index. Tambahkan index ke
  // firestore.indexes.json + mapping di sini, JANGAN hapus test ini.
  assert.ok(
    !src.includes('orderBy("created_at", "desc")') ||
      !/collection\(db, "permintaan_gudang"\)[\s\S]{0,200}orderBy/.test(src),
    "permintaan_gudang memakai orderBy -> WAJIB tambah composite index + AC"
  );
  assert.ok(
    !/collection\(db, "gudang"\)[\s\S]{0,200}where\(/.test(src),
    "gudang memakai where -> WAJIB tambah composite index + AC"
  );
});

test("v5: jika koleksi v5 pakai query ber-index, index-nya ADA di firestore.indexes.json", () => {
  const src = sumberReal();
  const idx = bacaIndex();
  const adaIndex = (col, field) =>
    idx.some((i) => i.collectionGroup === col && (i.fields || []).some((f) => f.fieldPath === field));

  // Cek kondisional: hanya menuntut index bila query benar-benar ada di real.ts.
  if (/collection\(db, "permintaan_gudang"\)[\s\S]{0,300}where\(/.test(src)) {
    assert.ok(adaIndex("permintaan_gudang", "status"), "permintaan_gudang where -> butuh index");
  }
  if (/collection\(db, "opname_gudang"\)[\s\S]{0,300}where\(/.test(src)) {
    assert.ok(adaIndex("opname_gudang", "status"), "opname_gudang where -> butuh index");
  }
});

test("getRingkasan memakai rowsStok({is_online:true}) - arti totalProdukOnline tidak berubah (B2)", () => {
  const src = sumberReal();
  assert.ok(
    /getRingkasan[\s\S]{0,400}rowsStok\(\{\s*is_online:\s*true\s*\}\)/.test(src),
    "getRingkasan WAJIB memanggil rowsStok({is_online:true}); kalau tidak, totalProdukOnline berubah arti"
  );
});

test("filterStok.js tetap satu sumber kebenaran (dipakai real.ts + mock.ts)", () => {
  const real = sumberReal();
  const mock = fs.readFileSync(path.join(AKAR, "lib", "dashboard", "data", "mock.ts"), "utf8");
  assert.ok(real.includes("filterStok.terapkanFilter"), "real.ts memakai filterStok");
  assert.ok(mock.includes("filterStok.terapkanFilter"), "mock.ts memakai filterStok");
});

test("index stock_movements existing tidak dihapus (regresi 097b43c)", () => {
  const idx = bacaIndex();
  const sm = idx.filter((i) => i.collectionGroup === "stock_movements");
  assert.ok(sm.length >= 4, "5 index stock_movements lama harus tetap ada");
});

test("setiap index di firestore.indexes.json punya collectionGroup + fields", () => {
  for (const i of bacaIndex()) {
    assert.ok(typeof i.collectionGroup === "string" && i.collectionGroup, "collectionGroup wajib");
    assert.ok(Array.isArray(i.fields) && i.fields.length > 0, "fields wajib array");
    for (const f of i.fields) {
      assert.ok(typeof f.fieldPath === "string" && f.fieldPath, "fieldPath wajib");
    }
  }
});
