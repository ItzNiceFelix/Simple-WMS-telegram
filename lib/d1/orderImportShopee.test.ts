import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gabungkanSheetShopee } from "./orderImportShopee";
describe("gabungkanSheetShopee", () => {
  it("menjumlahkan orders.Jumlah dan baris Advance", async () => {
    const r = await gabungkanSheetShopee([{ "No. Pesanan": "O-1", "Nomor Referensi SKU": "A", Jumlah: "2", "Subtotal Pesanan": "20.000" }], [{ "Booking SN": "O-1", "Nomor Referensi SKU": "A" }, { "Booking SN": "O-1", "Nomor Referensi SKU": "A" }], async () => true);
    assert.equal(r.orders[0].items[0].qty, 4);
  });
  it("fallback SKU induk dan review resi", async () => {
    const r = await gabungkanSheetShopee([{ "No. Pesanan": "O-2", "SKU Induk": "INDUK", "No. Resi": "RESI-1", Jumlah: 1 }], [], async (sku) => sku === "INDUK", { "O-2": "belum_diserahkan" });
    assert.equal(r.review[0].no_resi, "RESI-1"); assert.equal(r.orders[0].statusAwal, "pending");
  });
  it("resi tanpa disposition tidak masuk hasil", async () => {
    const r = await gabungkanSheetShopee([{ "No. Pesanan": "O-3", "Nomor Referensi SKU": "A", "No. Resi": "R", Jumlah: 1 }], [], async () => true);
    assert.equal(r.orders.length, 0); assert.equal(r.review.length, 1);
  });
  it("SKU kosong masuk gagal", async () => {
    const r = await gabungkanSheetShopee([{ "No. Pesanan": "O-4", Jumlah: 1 }], [], async () => true);
    assert.equal(r.orders.length, 0); assert.match(r.gagal[0].pesan, /SKU kosong/);
  });
});
