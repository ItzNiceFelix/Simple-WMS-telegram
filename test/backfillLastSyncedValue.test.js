// test/backfillLastSyncedValue.test.js
// T5: uji fungsi MURNI pilihKodeBackfill (tanpa network).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { pilihKodeBackfill, cariIndexKolomStok } = require("../scripts/backfillLastSyncedValue");

function mapDari(entries) {
  return new Map(entries);
}

test("nilai paritas Firestore === Sheets -> alasan 'isi' (layak backfill)", () => {
  const sheet = mapDari([["K1", 7]]);
  const stok = mapDari([["K1", { qty_per_gudang: { ONLINE: 7 }, stok_gudang_online: 3 }]]);
  assert.deepEqual(pilihKodeBackfill(sheet, stok), [{ kode: "K1", nilai: 7, alasan: "isi" }]);
});

test("fallback dokumen lama (tanpa map) juga dipakai", () => {
  const sheet = mapDari([["K2", 5]]);
  const stok = mapDari([["K2", { stok_gudang_online: 5 }]]);
  assert.deepEqual(pilihKodeBackfill(sheet, stok), [{ kode: "K2", nilai: 5, alasan: "isi" }]);
});

test("nilai beda -> skip alasan 'beda'", () => {
  const sheet = mapDari([["K3", 4]]);
  const stok = mapDari([["K3", { qty_per_gudang: { ONLINE: 9 } }]]);
  assert.deepEqual(pilihKodeBackfill(sheet, stok), [{ kode: "K3", nilai: 4, alasan: "beda" }]);
});

test("sheet kosong (null) -> skip alasan 'sheet_kosong'", () => {
  const sheet = mapDari([["K4", null]]);
  const stok = mapDari([["K4", { qty_per_gudang: { ONLINE: 4 } }]]);
  assert.deepEqual(pilihKodeBackfill(sheet, stok), [{ kode: "K4", nilai: null, alasan: "sheet_kosong" }]);
});

test("stok tak ada di Firestore -> skip alasan 'stok_tak_ada'", () => {
  const sheet = mapDari([["K5", 3]]);
  const stok = mapDari([]);
  assert.deepEqual(pilihKodeBackfill(sheet, stok), [{ kode: "K5", nilai: null, alasan: "stok_tak_ada" }]);
});

test("cariIndexKolomStok menemukan 'Stok Online' case/space-insensitive", () => {
  assert.equal(cariIndexKolomStok(["No", "Kode", " stok online "]), 2);
  assert.equal(cariIndexKolomStok(["No", "Kode"]), -1);
});
