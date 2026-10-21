// lib/printing/urutanCetak.test.ts — urutan cetak bertahap.
//
// Yang dijaga: urutan asli dipertahankan pada mode off, qty 1 tidak pernah jatuh setelah
// qty 2, multi-item selalu paling akhir di antara yang terbaca, dan halaman tanpa tabel
// produk tidak mengacak sisanya.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { BarisQty } from "./penandaQty";
import { GRUP_MULTI, GRUP_TIDAK_TERBACA, grupQty, namaGrup, urutkanHalaman } from "./urutanCetak";

const row = (v: number, sku: string, name = "Produk", vari = "Merah"): BarisQty => ({
  v, x: 0, y: 0, w: 5, fs: 8, name, sku, vari,
});

const hal = (n: number, rows: BarisQty[]) => ({ n, qty: { rows, total: rows.reduce((a, r) => a + r.v, 0) } });

describe("grupQty", () => {
  it("qty tunggal, multi item, dan tak terbaca", () => {
    assert.equal(grupQty({ rows: [row(2, "A")], total: 2 }), 2);
    assert.equal(grupQty({ rows: [row(1, "A"), row(1, "B")], total: 2 }), GRUP_MULTI);
    assert.equal(grupQty({ rows: [], total: 0 }), GRUP_TIDAK_TERBACA);
  });

  it("label grup", () => {
    assert.equal(namaGrup(2), "Qty 2");
    assert.equal(namaGrup(GRUP_MULTI), "Multi item");
    assert.match(namaGrup(GRUP_TIDAK_TERBACA), /Tidak terbaca/);
  });
});

describe("urutkanHalaman", () => {
  const a = hal(1, [row(1, "SKU-B")]);
  const b = hal(2, [row(1, "SKU-A")]);
  const c = hal(3, [row(2, "SKU-C")]);
  const d = hal(4, [row(1, "SKU-D"), row(1, "SKU-E")]);

  it("off: urutan asli", () => {
    assert.deepEqual(urutkanHalaman([c, a, d, b], "off").map((x) => x.n), [3, 1, 4, 2]);
  });

  it("sku: alfabetis SKU", () => {
    assert.deepEqual(urutkanHalaman([c, a, d, b], "sku").map((x) => x.n), [2, 1, 3, 4]);
  });

  it("qty: qty 1 dulu, lalu 2, multi item terakhir", () => {
    assert.deepEqual(urutkanHalaman([d, c, a, b], "qty").map((x) => x.n), [2, 1, 3, 4]);
  });

  it("nama: urut nama produk lebih dulu", () => {
    const x = hal(1, [row(1, "SKU-Z", "Baju")]);
    const y = hal(2, [row(1, "SKU-A", "Celana")]);
    assert.deepEqual(urutkanHalaman([x, y], "nama").map((h) => h.n), [1, 2]);
  });

  it("halaman tanpa tabel produk: paling akhir, tidak mengacak sisanya", () => {
    const kosong = hal(9, []);
    assert.deepEqual(urutkanHalaman([kosong, c, a], "sku").map((x) => x.n), [1, 3, 9]);
    assert.deepEqual(urutkanHalaman([kosong, c, a], "qty").map((x) => x.n), [1, 3, 9]);
  });

  it("dua halaman tanpa tabel: urutan asli dipertahankan", () => {
    assert.deepEqual(urutkanHalaman([hal(5, []), hal(6, [])], "sku").map((x) => x.n), [5, 6]);
  });

  it("tidak mengubah larik masukan", () => {
    const asli = [c, a, b];
    urutkanHalaman(asli, "sku");
    assert.deepEqual(asli.map((x) => x.n), [3, 1, 2]);
  });

  it("seri sempurna: urutan asli sebagai pemecah", () => {
    const p = hal(1, [row(1, "SAMA")]);
    const q = hal(2, [row(1, "SAMA")]);
    assert.deepEqual(urutkanHalaman([q, p], "sku").map((x) => x.n), [1, 2]);
  });
});
