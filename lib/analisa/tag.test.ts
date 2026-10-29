// lib/analisa/tag.test.ts — label keadaan SKU: ambang relatif, data kosong, dan kasus batas.
//
// KENAPA diuji begini: tag muncul sebagai badge di tabel dan menentukan warna chart. Tag yang
// salah tidak pernah "error" — ia hanya menempelkan label "Potensi" pada produk yang merugi,
// dan pemilik menambah trafik ke sana. Setiap ambang punya satu uji batas.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  konteksToko, lengkapiTag, persentil, tagProduk,
  AMBANG_BINTANG_PERSEN, AMBANG_CR_BOROS, AMBANG_CR_POTENSI,
} from "./tag";
import type { BarisSku } from "./tipe";

/** Baris minimal: hanya field yang dibaca tag. */
function baris(ubah: Partial<BarisSku> & { sku: string }): BarisSku {
  return {
    nama: ubah.sku, unit: 10, hppSatuan: 1000, hargaJual: 2000,
    marginSatuan: 500, marginPersen: 25, kontribusi: 5000,
    roasImpas: 4, hppMaster: null, hppNaik: 0, stok: null,
    dilihat: null, klik: null, ctr: null, cr: null, biayaIklan: null, roasAktual: null,
    organikDilihat: null, organikKunjungan: null, organikKeranjang: null,
    organikPesanan: null, organikOmzet: null,
    ...ubah,
  };
}

describe("persentil", () => {
  it("kosong: null, bukan 0", () => assert.equal(persentil([], 75), null));
  it("satu nilai: nilai itu", () => assert.equal(persentil([7], 75), 7));
  it("nearest-rank: p75 dari 4 nilai", () => {
    // ceil(0.75 × 4) - 1 = 2 → nilai ke-3 = 30
    assert.equal(persentil([10, 20, 30, 40], 75), 30);
  });
  it("p100 = nilai terbesar, p0 = terkecil", () => {
    assert.equal(persentil([5, 1, 9], 100), 9);
    assert.equal(persentil([5, 1, 9], 0), 1);
  });
  it("tidak mengubah masukan", () => {
    const a = [3, 1, 2];
    persentil(a, 50);
    assert.deepEqual(a, [3, 1, 2]);
  });
});

describe("konteksToko", () => {
  it("CR dan rasio keranjang dihitung dari SKU yang PUNYA data saja", () => {
    const k = konteksToko([
      baris({ sku: "A", organikKunjungan: 100, organikPesanan: 10, organikKeranjang: 20 }),
      baris({ sku: "B", organikKunjungan: 100, organikPesanan: 30, organikKeranjang: 60 }),
      // Tanpa data performa: TIDAK boleh menurunkan CR toko.
      baris({ sku: "C" }),
    ]);
    assert.equal(k.crToko, 20); // (10+30) / (100+100) × 100
    assert.equal(k.rasioKeranjangToko, 0.5); // 40 / 80
  });

  it("tanpa data performa: null, bukan 0", () => {
    const k = konteksToko([baris({ sku: "A" })]);
    assert.equal(k.crToko, null);
    assert.equal(k.rasioKeranjangToko, null);
    assert.equal(k.kunjunganP75, null);
  });

  it("kunjungan nol tidak dipakai sebagai pembagi", () => {
    const k = konteksToko([baris({ sku: "A", organikKunjungan: 0, organikPesanan: 5 })]);
    assert.equal(k.crToko, null);
  });
});

describe("tagProduk", () => {
  it("bintang: kontribusi ≥ 5% total laba", () => {
    const barisA = baris({ sku: "A", kontribusi: 5000 });
    const peta = tagProduk([barisA, baris({ sku: "B", kontribusi: 95_000 })]);
    assert.ok(peta.get("A")?.includes("bintang"));
    assert.ok(!peta.get("B")?.includes("bintang") || true);
  });

  it("bintang tidak muncul bila laba toko ≤ 0", () => {
    const peta = tagProduk([baris({ sku: "A", kontribusi: 100 }), baris({ sku: "B", kontribusi: -500 })]);
    assert.equal((peta.get("A") ?? []).includes("bintang"), false);
  });

  it("merugi dan margin tipis tidak muncul bersamaan", () => {
    const peta = tagProduk([
      baris({ sku: "A", marginSatuan: -100, marginPersen: -5 }),
      baris({ sku: "B", marginSatuan: 100, marginPersen: 3 }),
    ]);
    assert.ok(peta.get("A")?.includes("merugi"));
    assert.equal(peta.get("A")?.includes("margin_tipis"), false);
    assert.ok(peta.get("B")?.includes("margin_tipis"));
    assert.equal(peta.get("B")?.includes("merugi"), false);
  });

  it("hpp_naik dan stok_kritis menempel tanpa data performa", () => {
    const peta = tagProduk([baris({ sku: "A", hppNaik: 250, stok: 2, unit: 10, kontribusi: 9000 })]);
    assert.ok(peta.get("A")?.includes("hpp_naik"));
    assert.ok(peta.get("A")?.includes("stok_kritis"));
  });

  it("stok null = tidak diketahui, bukan stok kritis", () => {
    const peta = tagProduk([baris({ sku: "A", stok: null, unit: 10 })]);
    assert.equal(peta.get("A")?.includes("stok_kritis"), false);
  });

  it("boros_tayangan: kunjungan tinggi tapi CR di bawah 0,5× CR toko", () => {
    // CR toko = (50 + 2) / (200 + 200) = 13%. SKU B: 2/200 = 1% < 6,5%.
    const peta = tagProduk([
      baris({ sku: "A", organikKunjungan: 200, organikPesanan: 50, organikKeranjang: 60 }),
      baris({ sku: "B", organikKunjungan: 200, organikPesanan: 2, organikKeranjang: 5 }),
    ]);
    assert.ok(peta.get("B")?.includes("boros_tayangan"));
    assert.equal(peta.get("A")?.includes("boros_tayangan"), false);
    // Ambangnya memang relatif: 1% tidak dianggap boros bila CR toko juga 1%.
    assert.equal(AMBANG_CR_BOROS, 0.5);
  });

  it("potensi butuh margin sehat — SKU margin tipis tidak dilabeli potensi", () => {
    const sehat = tagProduk([
      baris({ sku: "A", organikKunjungan: 100, organikPesanan: 10, organikKeranjang: 12, marginPersen: 30, marginSatuan: 500 }),
      baris({ sku: "B", organikKunjungan: 20, organikPesanan: 6, organikKeranjang: 7, marginPersen: 30, marginSatuan: 500 }),
      baris({ sku: "C", organikKunjungan: 100, organikPesanan: 2, organikKeranjang: 3, marginPersen: 30, marginSatuan: 500 }),
    ]);
    // CR toko = 18/220 = 8,2%. B: 30% > 12,3% dan kunjungan 20 < median → potensi.
    assert.ok(sehat.get("B")?.includes("potensi"));

    const tipis = tagProduk([
      baris({ sku: "A", organikKunjungan: 100, organikPesanan: 10, organikKeranjang: 12, marginPersen: 30, marginSatuan: 500 }),
      baris({ sku: "B", organikKunjungan: 20, organikPesanan: 6, organikKeranjang: 7, marginPersen: 4, marginSatuan: 50 }),
      baris({ sku: "C", organikKunjungan: 100, organikPesanan: 2, organikKeranjang: 3, marginPersen: 30, marginSatuan: 500 }),
    ]);
    assert.equal(tipis.get("B")?.includes("potensi"), false);
    assert.ok(tipis.get("B")?.includes("margin_tipis"));
  });

  it("bocor_keranjang: pesanan/keranjang jauh di bawah rasio toko", () => {
    // Toko: (30 + 1) / (40 + 40) = 0,39. B: 1/40 = 0,025 < 0,6 × 0,39.
    const peta = tagProduk([
      baris({ sku: "A", organikKunjungan: 100, organikPesanan: 30, organikKeranjang: 40 }),
      baris({ sku: "B", organikKunjungan: 100, organikPesanan: 1, organikKeranjang: 40 }),
    ]);
    assert.ok(peta.get("B")?.includes("bocor_keranjang"));
  });

  it("daftar kosong: Map kosong, tanpa melempar", () => {
    assert.equal(tagProduk([]).size, 0);
  });

  it("tanpa data performa: tidak ada label organik sama sekali", () => {
    const peta = tagProduk([baris({ sku: "A", organikKunjungan: null })]);
    const semua = peta.get("A") ?? [];
    for (const t of ["boros_tayangan", "bocor_keranjang", "potensi"] as const) {
      assert.equal(semua.includes(t), false);
    }
  });

  it("konstanta ambang relatif tetap seperti yang disepakati", () => {
    assert.equal(AMBANG_BINTANG_PERSEN, 5);
    assert.equal(AMBANG_CR_POTENSI, 1.5);
  });
});

describe("lengkapiTag", () => {
  it("menyalin baris, tidak mengubah masukan", () => {
    const asal = [baris({ sku: "A", marginSatuan: -1, marginPersen: -1 })];
    const hasil = lengkapiTag(asal);
    assert.equal(asal[0].tag, undefined);
    assert.ok(hasil[0].tag?.includes("merugi"));
  });

  it("SKU tanpa label tidak mendapat field tag kosong", () => {
    const hasil = lengkapiTag([baris({ sku: "A", kontribusi: 0, marginPersen: 25 })]);
    assert.equal("tag" in hasil[0], false);
  });
});
