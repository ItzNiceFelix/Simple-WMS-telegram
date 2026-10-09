// lib/d1/labaShopee.test.ts — Rumus Order.all: allowlist status, qty bersih retur, rincian SKU.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hitungLabaShopee } from "./labaShopee";

const hpp: Record<string, number> = { A: 4000, B: 10000 };
const ambilHpp = async (sku: string) => hpp[sku] ?? null;

const baris = (o: Record<string, unknown> = {}) => ({
  "No. Pesanan": "X",
  "Status Pesanan": "Telah Dikirim",
  "Nomor Referensi SKU": "A",
  "SKU Induk": "",
  "Harga Setelah Diskon": "10000",
  Jumlah: "2",
  "Returned quantity": "0",
  "Subtotal Pesanan": "20000",
  "Voucher Ditanggung Penjual": "0",
  "Diskon Dari Penjual": "0",
  "Paket Diskon (Diskon dari Penjual)": "0",
  ...o,
});

describe("hitungLabaShopee (Order.all)", () => {
  it("allowlist: Batal + Belum Bayar + Perlu Dikirim dibuang", async () => {
    const rows = [
      baris({ "No. Pesanan": "B1", "Status Pesanan": "Batal" }),
      baris({ "No. Pesanan": "B2", "Status Pesanan": "Belum Bayar" }),
      baris({ "No. Pesanan": "B3", "Status Pesanan": "Perlu Dikirim" }),
      baris({ "No. Pesanan": "OK", "Status Pesanan": "Sedang Dikirim" }),
    ];
    const a = await hitungLabaShopee(rows, ambilHpp, []);
    assert.equal(a.jml_order, 1);
    assert.equal(a.omzet, 20000);
  });

  it("retur parsial kurangi qty; retur penuh lewati baris", async () => {
    const rows = [
      baris({ "No. Pesanan": "R1", "Returned quantity": "1" }), // bersih 1
      baris({ "No. Pesanan": "R2", "Returned quantity": "2" }), // penuh: lewati
    ];
    const a = await hitungLabaShopee(rows, ambilHpp, []);
    assert.equal(a.jml_order, 1);
    assert.equal(a.hpp, 4000); // 1 × 4000
    assert.equal(a.rincian[0].unit, 1);
  });

  it("rincian SKU: agregat + margin + sort kontribusi", async () => {
    const rows = [
      baris({ "No. Pesanan": "O1", "Nomor Referensi SKU": "A" }),
      baris({ "No. Pesanan": "O2", "Nomor Referensi SKU": "B", "Harga Setelah Diskon": "30000", Jumlah: "1", "Subtotal Pesanan": "30000" }),
    ];
    const a = await hitungLabaShopee(rows, ambilHpp, []);
    assert.equal(a.rincian.length, 2);
    // B: 30000 − 10000 = 20000; A: 20000 − 8000 = 12000 → B dulu
    assert.equal(a.rincian[0].sku, "B");
    assert.equal(a.rincian[0].kontribusi, 20000);
    assert.equal(a.rincian[0].marginSatuan, 20000);
    assert.equal(a.rincian[1].sku, "A");
    assert.equal(a.rincian[1].marginSatuan, 6000);
    assert.equal(a.rincian[1].hargaJual, 10000);
  });

  it("SKU kosong tolak seorder; tak cocok master tolak", async () => {
    const rows = [
      baris({ "No. Pesanan": "K1", "Nomor Referensi SKU": "", "SKU Induk": "" }),
      baris({ "No. Pesanan": "K2", "Nomor Referensi SKU": "Z" }),
    ];
    const a = await hitungLabaShopee(rows, ambilHpp, []);
    assert.equal(a.jml_order, 0);
    assert.equal(a.tolak.length, 2);
  });
});
