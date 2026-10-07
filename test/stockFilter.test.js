// test/stockFilter.test.js
// Wave 3 v5 (F9): logika filter stok. Murni CJS (lib/dashboard/data/filterStok.js) -
// SATU sumber kebenaran yang dipakai real.ts DAN mock.ts. Cepat, tanpa network.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { terapkanFilter, bacaQtyPerGudang, nilaiUntukFilter } = require("../lib/dashboard/data/filterStok");

// Fixture: 3 produk - 2 online, 1 tidak. qty per gudang bervariasi.
const baris = [
  { kode_barang: "A", is_online_product: true, stok_gudang_online: 10, qty_per_gudang: { ONLINE: 10, D12: 4 } },
  { kode_barang: "B", is_online_product: true, stok_gudang_online: 5, qty_per_gudang: { ONLINE: 5 } },
  { kode_barang: "C", is_online_product: false, stok_gudang_online: 7, qty_per_gudang: { ONLINE: 7, D12: 2 } },
  { kode_barang: "D", is_online_product: true, stok_gudang_online: null, qty_per_gudang: {} },
];

test("default (tanpa filter) -> hanya online", () => {
  const out = terapkanFilter(baris, undefined);
  assert.deepEqual(out.map((r) => r.kode_barang), ["A", "B", "D"]);
});

test("is_online 'semua' -> semua produk", () => {
  const out = terapkanFilter(baris, { is_online: "semua" });
  assert.equal(out.length, 4);
});

test("is_online false -> hanya non-online", () => {
  const out = terapkanFilter(baris, { is_online: false });
  assert.deepEqual(out.map((r) => r.kode_barang), ["C"]);
});

test("filter gudang D12 -> hanya yang punya key D12", () => {
  const out = terapkanFilter(baris, { gudang_id: "D12", is_online: "semua" });
  assert.deepEqual(out.map((r) => r.kode_barang), ["A", "C"]);
});

test("filter gudang + default online -> hanya A (C non-online)", () => {
  const out = terapkanFilter(baris, { gudang_id: "D12" });
  assert.deepEqual(out.map((r) => r.kode_barang), ["A"]);
});

test("gudang tanpa key + sertakan_tanpa_gudang -> semua baris lolos", () => {
  const out = terapkanFilter(baris, { gudang_id: "G99", is_online: "semua", sertakan_tanpa_gudang: true });
  assert.equal(out.length, 4);
});

test("gudang tanpa key tanpa sertakan -> kosong", () => {
  const out = terapkanFilter(baris, { gudang_id: "G99", is_online: "semua" });
  assert.equal(out.length, 0);
});

test("bacaQtyPerGudang: fallback dokumen lama -> {ONLINE: stok_gudang_online}", () => {
  assert.deepEqual(bacaQtyPerGudang({ stok_gudang_online: 8 }), { ONLINE: 8 });
});

test("bacaQtyPerGudang: map dipakai apa adanya", () => {
  assert.deepEqual(bacaQtyPerGudang({ qty_per_gudang: { D12: 1, D13: 2 } }), { D12: 1, D13: 2 });
});

test("bacaQtyPerGudang: nilai non-angka dibuang", () => {
  assert.deepEqual(bacaQtyPerGudang({ qty_per_gudang: { D12: 1, D13: "x", D14: null } }), { D12: 1 });
});

test("bacaQtyPerGudang: input null -> {}", () => {
  assert.deepEqual(bacaQtyPerGudang(null), {});
  assert.deepEqual(bacaQtyPerGudang(undefined), {});
});

test("nilaiUntukFilter: tanpa gudang -> stok_gudang_online", () => {
  assert.equal(nilaiUntukFilter({ stok_gudang_online: 9, qty_per_gudang: { D12: 4 } }, null), 9);
});

test("nilaiUntukFilter: gudang -> map[key]", () => {
  assert.equal(nilaiUntukFilter({ stok_gudang_online: 9, qty_per_gudang: { D12: 4 } }, "D12"), 4);
});

test("nilaiUntukFilter: key absen -> null", () => {
  assert.equal(nilaiUntukFilter({ stok_gudang_online: 9, qty_per_gudang: { D12: 4 } }, "G99"), null);
});

test("nilaiUntukFilter: stok null -> null", () => {
  assert.equal(nilaiUntukFilter(null, "D12"), null);
});

test("filter deterministik & tidak memutasi input", () => {
  const sebelum = JSON.stringify(baris);
  terapkanFilter(baris, { gudang_id: "D12" });
  assert.equal(JSON.stringify(baris), sebelum, "input tidak berubah");
});
