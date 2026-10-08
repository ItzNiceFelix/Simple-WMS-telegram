import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alokasiLabaSku, hitungLaba } from "./order";

describe("hitungLaba", () => {
  it("omzet-hpp-biaya-pph-ppn benar", () => {
    const r = hitungLaba(
      [{ sku: "A", qty: 2, harga_satuan: 100000, hpp_snapshot: 60000 }],
      [{ jenis: "admin", basis: "persen", nilai: 4 }],
      true, 0
    );
    assert.equal(r.omzet, 200000);
    assert.equal(r.hpp, 120000);
    assert.equal(r.biaya, 8000);
    assert.equal(r.pph, 1000);
    assert.equal(r.laba, 200000 - 120000 - 8000 - 1000);
  });
  it("tanpa pph + flat fee", () => {
    const r = hitungLaba(
      [{ sku: "A", qty: 1, harga_satuan: 50000, hpp_snapshot: 30000 }],
      [{ jenis: "ongkir", basis: "flat", nilai: 10000 }],
      false, 11
    );
    assert.equal(r.pph, 0);
    assert.equal(r.ppn, 5500);
    assert.equal(r.laba, 50000 - 30000 - 10000 - 5500);
  });
  it("alokasi per SKU jumlah = laba order", () => {
    const items = [
      { sku: "A", qty: 1, harga_satuan: 100000, hpp_snapshot: 60000 },
      { sku: "B", qty: 1, harga_satuan: 100000, hpp_snapshot: 50000 },
    ];
    const r = hitungLaba(items, [{ jenis: "admin", basis: "persen", nilai: 10 }], true, 0);
    const al = alokasiLabaSku(items, r);
    assert.ok(Math.abs(al["A"] + al["B"] - r.laba) < 1);
  });
});
