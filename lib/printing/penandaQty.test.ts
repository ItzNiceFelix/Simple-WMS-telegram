// lib/printing/penandaQty.test.ts — baca qty dari teks PDF + proyeksi penanda ke lembar.
//
// Yang dijaga: angka qty hanya diambil dari kolom Qty (bukan nomor lain), SKU/variasi
// dipetakan berbeda untuk Shopee vs TikTok, penanda tidak pernah digambar di luar kotak
// resi, dan qty 1 hanya ditandai pada mode yang memintanya.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bentukPenanda, bacaQtyHalaman, kolomDariHeader, kotakTeks, penandaQty, type ItemTeks } from "./penandaQty";
import type { Bagian } from "./tataLetak";

/** Item teks pada satu baris; `y` dari bawah seperti pdf.js. */
const item = (str: string, x: number, y: number, width = str.length * 5): ItemTeks => ({
  str,
  width,
  transform: [8, 0, 0, 8, x, y],
});

describe("kolomDariHeader", () => {
  it("membedakan SKU Shopee vs Seller SKU TikTok", () => {
    assert.equal(kolomDariHeader("SKU"), "sku");
    assert.equal(kolomDariHeader("Seller SKU"), "sell");
    assert.equal(kolomDariHeader("Variasi"), "var");
    assert.equal(kolomDariHeader("Nama Produk"), "name");
    assert.equal(kolomDariHeader("Qty"), "qty");
    assert.equal(kolomDariHeader("Harga"), "x");
  });
});

describe("bacaQtyHalaman", () => {
  const header = (y: number): ItemTeks[] => [
    item("Nama Produk", 10, y),
    item("SKU", 120, y),
    item("Variasi", 170, y),
    item("Qty", 230, y),
  ];

  it("membaca qty per baris dan total, mengabaikan angka di luar kolom", () => {
    const items: ItemTeks[] = [
      ...header(700),
      item("Kaos", 10, 680), item("SKU-A", 120, 680), item("Merah", 170, 680), item("2", 233, 680),
      item("Tas", 10, 660), item("SKU-B", 120, 660), item("Hitam", 170, 660), item("1", 233, 660),
      // Angka di kolom lain (mis. harga) tidak boleh terbaca sebagai qty.
      item("999", 60, 640),
      item("Qty Total", 10, 620), item("3", 233, 620),
    ];
    const r = bacaQtyHalaman(items);
    assert.deepEqual(r.rows.map((x) => x.v), [2, 1]);
    assert.equal(r.total, 3);
    assert.equal(r.rows[0].name, "Kaos");
    assert.equal(r.rows[0].sku, "SKU-A");
    assert.equal(r.rows[0].vari, "Merah");
  });

  it("TikTok: kolom SKU = variasi, Seller SKU = SKU toko", () => {
    const items: ItemTeks[] = [
      item("Nama Produk", 10, 700), item("Seller SKU", 120, 700), item("SKU", 180, 700), item("Qty", 240, 700),
      item("Kaos", 10, 680), item("TOKO-1", 120, 680), item("Merah L", 180, 680), item("3", 243, 680),
    ];
    const r = bacaQtyHalaman(items);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].sku, "TOKO-1");
    assert.equal(r.rows[0].vari, "Merah L");
    assert.equal(r.rows[0].v, 3);
  });

  it("tanpa header Qty: kosong, bukan menebak", () => {
    const r = bacaQtyHalaman([item("Kaos", 10, 700), item("2", 233, 680)]);
    assert.deepEqual(r.rows, []);
    assert.equal(r.total, 0);
  });

  it("halaman diputar: kosong", () => {
    const r = bacaQtyHalaman([...header(700), item("2", 233, 680)], 90);
    assert.deepEqual(r.rows, []);
  });

  it("baris setelah Qty Total diabaikan", () => {
    const items: ItemTeks[] = [
      ...header(700),
      item("Kaos", 10, 680), item("2", 233, 680),
      item("Qty Total", 10, 660), item("2", 233, 660),
      item("7", 233, 640),
    ];
    const r = bacaQtyHalaman(items);
    assert.deepEqual(r.rows.map((x) => x.v), [2]);
  });
});

describe("penandaQty", () => {
  const parts: Bagian[] = [
    { pg: 0, x0: 0, y0: 0, x1: 100, y1: 100, dw: 100, dh: 130, dx: 0, dy: 0 },
  ];
  const rows = (v: number[]) =>
    v.map((n, i) => ({ v: n, x: 10, y: 80 - i * 10, w: 5, fs: 8, name: "", sku: "", vari: "" }));

  it("mode mati: tidak ada penanda", () => {
    assert.deepEqual(penandaQty(rows([2]), 100, 100, { parts }, "mati", "kotak"), []);
  });

  it("mode lebih: hanya qty > 1", () => {
    const p = penandaQty(rows([1, 2]), 100, 100, { parts }, "lebih", "lingkar");
    assert.equal(p.length, 1);
    assert.equal(p[0].tipis, false);
  });

  it("mode semua: qty 1 ikut, bergaris tipis", () => {
    const p = penandaQty(rows([1, 2]), 100, 100, { parts }, "semua", "lingkar");
    assert.equal(p.length, 2);
    assert.equal(p.filter((x) => x.tipis).length, 1);
  });

  it("mode multi: qty 1 ikut hanya bila resi multi item", () => {
    assert.equal(penandaQty(rows([1]), 100, 100, { parts }, "multi", "lingkar").length, 0);
    assert.equal(penandaQty(rows([1, 1]), 100, 100, { parts }, "multi", "lingkar").length, 2);
  });

  it("baris di luar semua kotak dibuang", () => {
    const p = penandaQty(rows([2]), 100, 100, { parts: [{ ...parts[0], y0: 95, y1: 100 }] }, "lebih", "lingkar");
    assert.deepEqual(p, []);
  });

  it("gaya kotak menyertakan teks ×N", () => {
    const p = penandaQty(rows([3]), 100, 100, { parts }, "lebih", "kotak");
    assert.equal(p[0].teks?.txt, "×3");
    assert.equal(p[0].teks?.isi, true);
  });
});

describe("bentukPenanda", () => {
  const dasar = { pg: 0, cx: 50, cy: 40, nw: 4, fs: 3, tipis: false };

  it("lingkar: elips menutup angka", () => {
    const [b] = bentukPenanda(dasar, "lingkar");
    assert.equal(b.t, "e");
    assert.ok((b.rx ?? 0) >= (b.ry ?? 0));
  });

  it("persegi: lebar mengikuti lebar angka", () => {
    const [b] = bentukPenanda(dasar, "persegi");
    assert.equal(b.t, "r");
    assert.ok((b.w ?? 0) >= 1.45 * 3);
  });

  it("centang: garis patah di kiri angka", () => {
    const [b] = bentukPenanda(dasar, "centang");
    assert.equal(b.t, "l");
    assert.equal(b.p?.length, 3);
    assert.ok((b.p?.[0][0] ?? 0) < 50);
  });

  it("qty 1: garis lebih tipis", () => {
    const [tebal] = bentukPenanda(dasar, "lingkar");
    const [tipis] = bentukPenanda({ ...dasar, tipis: true }, "lingkar");
    assert.ok(tipis.lw < tebal.lw);
  });
});

describe("kotakTeks", () => {
  it("membungkus teks dengan padding", () => {
    const b = kotakTeks({ pg: 0, cx: 50, cy: 40, nw: 0, fs: 3, tipis: false, teks: { txt: "×2", isi: true, ts: 3 } }, 2);
    assert.ok(b.w > 2);
    assert.ok(Math.abs(b.x + b.w / 2 - 50) < 1e-9);
  });
});
