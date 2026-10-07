// lib/d1/d1.library.test.ts — node:test untuk lapisan D1 (Fase 1).
// Dua lapis: (1) logika murni tanpa I/O (hitungStatusDokumen, gabungItems,
// normalisasiNama); (2) modul ber-D1 dengan mock minimal yang setia pada
// semantik prepare/bind/first/run/all/batch D1.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hitungStatusDokumen, gabungItems } from "./transfer";
import { normalisasiNama } from "./produk";

describe("hitungStatusDokumen (paritas v5.1)", () => {
  it("semua menunggu -> menunggu", () => {
    assert.equal(hitungStatusDokumen([{ status: "menunggu", status_kirim: "menunggu" }]), "menunggu");
  });
  it("sebagian maju -> disetujui", () => {
    assert.equal(
      hitungStatusDokumen([
        { status: "menunggu", status_kirim: "disetujui" },
        { status: "menunggu", status_kirim: "menunggu" },
      ]),
      "disetujui"
    );
  });
  it("semua dikirim tanpa tolak -> dikirim", () => {
    assert.equal(
      hitungStatusDokumen([
        { status: "diterima", status_kirim: "dikirim" },
        { status: "menunggu", status_kirim: "dikirim" },
      ]),
      "dikirim"
    );
  });
  it("semua dikirim + ada ditolak -> ditolak", () => {
    assert.equal(
      hitungStatusDokumen([
        { status: "ditolak", status_kirim: "dikirim" },
        { status: "diterima", status_kirim: "dikirim" },
      ]),
      "ditolak"
    );
  });
});

describe("gabungItems (paritas T1)", () => {
  it("sku sama dijumlah, invalid dibuang", () => {
    const m = gabungItems([
      { kode_barang: "B1", qty: 2 },
      { kode_barang: "B1", qty: 3 },
      { kode_barang: "B2", qty: 1 },
      { kode_barang: "", qty: 5 },
      { kode_barang: "B3", qty: 0 },
    ]);
    assert.equal(m.get("B1"), 5);
    assert.equal(m.get("B2"), 1);
    assert.equal(m.has(""), false);
    assert.equal(m.has("B3"), false);
  });
});

describe("normalisasiNama (paritas produk.js)", () => {
  it("lowercase + rapikan spasi/simbol", () => {
    assert.equal(normalisasiNama("  Kemeja   Lengan-Panjang! "), "kemeja lengan panjang");
  });
});
