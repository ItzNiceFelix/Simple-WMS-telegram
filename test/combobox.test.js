// test/combobox.test.js
// Uji logika murni lib/dashboard/comboboxFilter.js (sumber kebenaran pencarian
// untuk components/ui/combobox.tsx). Cepat, tanpa DOM.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { filterItems, labelTerpilih } = require("../lib/dashboard/comboboxFilter");

const items = [
  { value: "d12", label: "Gudang D12" },
  { value: "online", label: "Gudang Online" },
  { value: "pusat", label: "Gudang Pusat" },
];

test("query kosong -> semua item", () => {
  assert.equal(filterItems(items, "").length, 3);
  assert.equal(filterItems(items, "   ").length, 3);
  assert.equal(filterItems(items, null).length, 3);
});

test("match label case-insensitive", () => {
  const out = filterItems(items, "d12");
  assert.deepEqual(out.map((i) => i.value), ["d12"]);
});

test("match value case-insensitive", () => {
  const out = filterItems(items, "ONLINE");
  assert.deepEqual(out.map((i) => i.value), ["online"]);
});

test("substring cocok di tengah label", () => {
  const out = filterItems(items, "ng");
  assert.deepEqual(out.map((i) => i.value), ["d12", "online", "pusat"]);
});

test("tanpa hasil -> array kosong", () => {
  assert.deepEqual(filterItems(items, "zzz"), []);
});

test("input tidak valid tidak melempar", () => {
  assert.deepEqual(filterItems(undefined, "x"), []);
  assert.deepEqual(filterItems([null, { value: "a", label: "A" }], "a"), [
    { value: "a", label: "A" },
  ]);
});

test("labelTerpilih mengembalikan label dari value", () => {
  assert.equal(labelTerpilih(items, "online"), "Gudang Online");
});

test("labelTerpilih fallback ke value bila tidak ketemu, null bila kosong", () => {
  assert.equal(labelTerpilih(items, "hilang"), "hilang");
  assert.equal(labelTerpilih(items, null), null);
  assert.equal(labelTerpilih(items, ""), null);
});
