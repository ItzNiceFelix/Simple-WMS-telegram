// lib/laba/hitungHargaJual.test.ts — Mesin harga jual (OPEX nominal, fee persen).
// Angka acuan dari data produksi: SKU 100331 (Pisau Set 3 in 1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hitungHargaJual, type InputHarga } from "./hitungHargaJual";

const FEE_100331 = [
  { nama: "Admin T10", jenis: "admin", persen: 10, flat: 0, sumber: "auto" as const },
  { nama: "GO Xtra D biasa", jenis: "program", persen: 5.5, flat: 0, sumber: "auto" as const },
  { nama: "Promo Xtra Plus", jenis: "program", persen: 6.5, flat: 0, sumber: "auto" as const },
  { nama: "Pajak PPh", jenis: "pajak_pph", persen: 0.5, flat: 0, sumber: "auto" as const },
];
const FLAT = [{ nama: "Biaya proses", jenis: "proses", persen: 0, flat: 1250, sumber: "auto" as const }];

/** Basa: SKU 100331, OPEX 33.450.515 bulanan / 11.577 unit, iklan 2,47%. */
function basa(over: Partial<InputHarga> = {}): InputHarga {
  return {
    hpp: 5000,
    feePersen: FEE_100331,
    feeFlat: FLAT,
    qtyPerOrder: 1,
    opexBulanan: 33_450_515,
    volumeBulanan: 11_577,
    iklanPersen: 2.47,
    marginTarget: 15,
    ...over,
  };
}

describe("hitungHargaJual", () => {
  it("fee total = jumlah komponen persen (22,5% untuk SKU 100331)", () => {
    const h = hitungHargaJual(basa());
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.feePersenTotal, 22.5);
    assert.equal(h.iklanPersen, 2.47);
  });

  it("OPEX jadi NOMINAL per unit, bukan persen", () => {
    const h = hitungHargaJual(basa());
    assert.equal(h.ok, true);
    if (!h.ok) return;
    // 33.450.515 / 11.577 = 2.889,39
    assert.equal(h.opexPerUnit, 2889);
  });

  it("harga naik saat margin target naik", () => {
    const h10 = hitungHargaJual(basa({ marginTarget: 10 }));
    const h15 = hitungHargaJual(basa({ marginTarget: 15 }));
    const h20 = hitungHargaJual(basa({ marginTarget: 20 }));
    assert.equal(h10.ok && h15.ok && h20.ok, true);
    if (!h10.ok || !h15.ok || !h20.ok) return;
    assert.ok(h10.harga < h15.harga, "m10 < m15");
    assert.ok(h15.harga < h20.harga, "m15 < m20");
    // margin 15% ≈ 15.225 (termasuk flat 1.250 & OPEX 2.889)
    assert.ok(Math.abs(h15.hargaSebelumBulat - 15225) < 60, `harga m15 = ${h15.hargaSebelumBulat}`);
  });

  it("margin aktual hasil verifikasi ≈ target (bukti rumus benar)", () => {
    const h = hitungHargaJual(basa({ marginTarget: 20 }));
    assert.equal(h.ok, true);
    if (!h.ok) return;
    // Harga x (1 - fee - iklan) - hpp - opex - flat harus ≈ margin target
    const sisa = h.harga * (1 - (22.5 + 2.47) / 100) - 5000 - h.opexPerUnit - 1250;
    assert.ok(Math.abs(sisa / h.harga * 100 - 20) < 1.5, `margin aktual ${(sisa / h.harga * 100).toFixed(2)}%`);
  });

  it("flat per order dibagi qtyPerOrder", () => {
    const h1 = hitungHargaJual(basa({ qtyPerOrder: 1 }));
    const h3 = hitungHargaJual(basa({ qtyPerOrder: 3 }));
    assert.equal(h1.ok && h3.ok, true);
    if (!h1.ok || !h3.ok) return;
    assert.equal(h3.flatPerUnit, Math.round(1250 / 3));
    assert.ok(h3.harga < h1.harga, "order isi 3 unit -> flat per unit lebih ringan");
  });

  it("tolak bila fee + iklan + margin >= 100%", () => {
    const h = hitungHargaJual(basa({ marginTarget: 80 }));
    assert.equal(h.ok, false);
    if (h.ok) return;
    assert.match(h.error, /tak terdefinisi/i);
  });

  it("OPEX & volume opsional: keduanya 0 tetap bisa dihitung", () => {
    const h = hitungHargaJual(basa({ opexBulanan: 0, volumeBulanan: 0 }));
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.opexPerUnit, 0);
    // harga hanya menutup HPP + fee + flat
    assert.ok(h.harga > 0);
    assert.ok(h.peringatan.some((p) => p.includes("hanya menutup HPP") || p.includes("volume 0")));
  });

  it("OPEX diisi tapi volume 0 -> peringatan biaya hilang (tidak blokir)", () => {
    const h = hitungHargaJual(basa({ opexBulanan: 33_450_515, volumeBulanan: 0 }));
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.opexPerUnit, 0);
    assert.ok(h.peringatan.some((p) => p.includes("TIDAK dibebankan")));
  });

  it("tolak volume negatif", () => {
    const h = hitungHargaJual(basa({ volumeBulanan: -1 }));
    assert.equal(h.ok, false);
  });

  it("tolak HPP negatif", () => {
    const h = hitungHargaJual(basa({ hpp: -1 }));
    assert.equal(h.ok, false);
  });

  it("pembulatan ke 500 diterapkan", () => {
    const h = hitungHargaJual(basa({ marginTarget: 20, pembulatan: 500 }));
    assert.equal(h.ok, true);
    if (!h.ok) return;
    assert.equal(h.harga % 500, 0);
  });

  it("rincian memuat semua komponen + jumlahnya mendekati harga", () => {
    const h = hitungHargaJual(basa());
    assert.equal(h.ok, true);
    if (!h.ok) return;
    const nama = h.rincian.map((r) => r.nama);
    for (const n of ["Admin T10", "GO Xtra D biasa", "Promo Xtra Plus", "Pajak PPh", "OPEX (tetap)", "HPP", "Biaya proses"]) {
      assert.ok(nama.includes(n), `rincian kurang ${n}`);
    }
    const total = h.rincian.reduce((a, r) => a + r.rupiah, 0);
    // total komponen ≈ harga (selisih dari pembulatan per baris)
    assert.ok(Math.abs(total - h.harga) < 20, `total rincian ${total} vs harga ${h.harga}`);
  });

  it("OPEX lebih besar -> harga lebih tinggi (bukti OPEX benar-benar dibebankan)", () => {
    const kecil = hitungHargaJual(basa({ opexBulanan: 10_000_000 }));
    const besar = hitungHargaJual(basa({ opexBulanan: 50_000_000 }));
    assert.equal(kecil.ok && besar.ok, true);
    if (!kecil.ok || !besar.ok) return;
    // Kenaikan OPEX 40jt / 11.577 unit = Rp3.455 modal tambahan; harga ikut naik
    assert.ok(besar.harga > kecil.harga + 3000, `kecil ${kecil.harga} besar ${besar.harga}`);
  });

  it("volume naik -> OPEX per unit turun -> harga turun", () => {
    const v1 = hitungHargaJual(basa({ volumeBulanan: 11_577 }));
    const v2 = hitungHargaJual(basa({ volumeBulanan: 23_154 }));
    assert.equal(v1.ok && v2.ok, true);
    if (!v1.ok || !v2.ok) return;
    assert.ok(v2.opexPerUnit < v1.opexPerUnit);
    assert.ok(v2.harga < v1.harga);
  });
});
