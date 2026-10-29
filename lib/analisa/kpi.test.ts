// lib/analisa/kpi.test.ts — kartu angka utama: TACOS, ROAS, delta, dan arti `null`.
//
// KENAPA: kartu KPI adalah bagian yang paling mungkin dihitung ulang di komponen, dan setiap
// hitung ulang membuka celah angka kartu berbeda dari angka tabel. Uji ini mengunci rumus
// turunan (TACOS/ROAS), satuan delta (persen vs POIN), dan perilaku saat data tidak ada.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { angkaDariRingkasan, dataKpi, roasKeseluruhan, tacos, type AngkaKpi } from "./kpi";
import type { RingkasanAnalisa } from "./tipe";

function angka(ubah: Partial<AngkaKpi> = {}): AngkaKpi {
  return {
    omzet: 1_000_000, laba: 300_000, marginPersen: 30, jmlOrder: 10,
    biayaIklan: 100_000, omzetIklan: 500_000,
    ...ubah,
  };
}

describe("tacos", () => {
  it("biaya iklan ÷ omzet × 100", () => assert.equal(tacos(100_000, 1_000_000), 10));
  it("biaya null: null, bukan 0", () => assert.equal(tacos(null, 1_000_000), null));
  it("omzet nol: null, bukan Infinity", () => assert.equal(tacos(1000, 0), null));
  it("omzet negatif: null", () => assert.equal(tacos(1000, -5), null));
});

describe("roasKeseluruhan", () => {
  it("omzet iklan ÷ biaya iklan", () => assert.equal(roasKeseluruhan(500_000, 100_000), 5));
  it("biaya nol: null, bukan Infinity", () => assert.equal(roasKeseluruhan(500_000, 0), null));
  it("omzet iklan null: null", () => assert.equal(roasKeseluruhan(null, 100_000), null));
});

describe("dataKpi", () => {
  it("tujuh kartu dengan urutan tetap", () => {
    const h = dataKpi({ sekarang: angka(), pembanding: null });
    assert.deepEqual(h.kartu.map((k) => k.kunci), [
      "omzet", "laba", "margin", "order", "biaya_iklan", "tacos", "roas",
    ]);
  });

  it("tanpa pembanding: delta null dan alasannya disebut", () => {
    const h = dataKpi({ sekarang: angka(), pembanding: null });
    assert.ok(h.kartu.every((k) => k.delta === null));
    assert.ok(h.catatan.some((c) => c.includes("pembanding")));
  });

  it("metrik rupiah memakai delta persen", () => {
    const h = dataKpi({ sekarang: angka(), pembanding: angka({ omzet: 800_000 }) });
    const omzet = h.kartu.find((k) => k.kunci === "omzet");
    assert.equal(omzet?.delta?.selisih, 200_000);
    assert.equal(omzet?.delta?.persen, 25);
    assert.equal(omzet?.delta?.satuan, "persen");
  });

  it("metrik rasio memakai POIN, bukan persen", () => {
    const h = dataKpi({
      sekarang: angka({ marginPersen: 30 }),
      pembanding: angka({ marginPersen: 28 }),
    });
    const margin = h.kartu.find((k) => k.kunci === "margin");
    assert.equal(margin?.delta?.selisih, 2);
    assert.equal(margin?.delta?.satuan, "poin");
    assert.equal(margin?.delta?.persen, null);
  });

  it("TACOS dan ROAS dibandingkan dalam poin", () => {
    const h = dataKpi({
      sekarang: angka({ biayaIklan: 200_000 }),
      pembanding: angka({ biayaIklan: 100_000 }),
    });
    assert.equal(h.kartu.find((k) => k.kunci === "tacos")?.delta?.satuan, "poin");
    assert.equal(h.kartu.find((k) => k.kunci === "roas")?.delta?.satuan, "poin");
  });

  it("biaya iklan berarah TURUN (naik = buruk)", () => {
    const h = dataKpi({ sekarang: angka(), pembanding: null });
    assert.equal(h.kartu.find((k) => k.kunci === "biaya_iklan")?.arahBaik, "turun");
    assert.equal(h.kartu.find((k) => k.kunci === "tacos")?.arahBaik, "turun");
    assert.equal(h.kartu.find((k) => k.kunci === "omzet")?.arahBaik, "naik");
  });

  it("pembanding nol: persen null, selisih tetap dilaporkan", () => {
    const h = dataKpi({ sekarang: angka({ omzet: 500 }), pembanding: angka({ omzet: 0 }) });
    const omzet = h.kartu.find((k) => k.kunci === "omzet");
    assert.equal(omzet?.delta?.persen, null);
    assert.equal(omzet?.delta?.selisih, 500);
  });

  it("biaya iklan null: nilai dan delta null, catatan 'belum diimpor'", () => {
    const h = dataKpi({ sekarang: angka({ biayaIklan: null }), pembanding: null });
    const kartu = h.kartu.find((k) => k.kunci === "biaya_iklan");
    assert.equal(kartu?.nilai, null);
    assert.equal(kartu?.delta, null);
    assert.match(kartu?.catatan ?? "", /belum diimpor/);
    assert.equal(h.kartu.find((k) => k.kunci === "tacos")?.nilai, null);
  });

  it("biaya iklan null di salah satu periode: delta TACOS null, bukan 0", () => {
    const h = dataKpi({
      sekarang: angka({ biayaIklan: null }),
      pembanding: angka(),
    });
    assert.equal(h.kartu.find((k) => k.kunci === "tacos")?.delta, null);
  });

  it("iklan tak terpetakan disebut di kartu biaya iklan", () => {
    const h = dataKpi({ sekarang: angka(), pembanding: null, jmlIklanTakTerpetakan: 2 });
    assert.match(h.kartu.find((k) => k.kunci === "biaya_iklan")?.catatan ?? "", /2 iklan belum terpetakan/);
  });

  it("penanda parsial diteruskan, bukan disembunyikan", () => {
    assert.equal(dataKpi({ sekarang: angka(), pembanding: null, parsial: true }).parsial, true);
    assert.equal(dataKpi({ sekarang: angka(), pembanding: null }).parsial, false);
  });

  it("tidak ada NaN atau Infinity pada keluaran", () => {
    const h = dataKpi({
      sekarang: angka({ omzet: 0, laba: -50, marginPersen: 0, jmlOrder: 0, biayaIklan: 0, omzetIklan: 0 }),
      pembanding: angka({ omzet: 0, laba: 0, marginPersen: 0, jmlOrder: 0, biayaIklan: 0, omzetIklan: 0 }),
    });
    for (const k of h.kartu) {
      if (k.nilai !== null) assert.ok(Number.isFinite(k.nilai), `${k.kunci} nilai tidak hingga`);
      if (k.delta) {
        assert.ok(Number.isFinite(k.delta.selisih), `${k.kunci} selisih tidak hingga`);
        if (k.delta.persen !== null) assert.ok(Number.isFinite(k.delta.persen));
      }
    }
  });
});

describe("angkaDariRingkasan", () => {
  it("memetakan field ringkasan tanpa menghitung ulang", () => {
    const r: RingkasanAnalisa = {
      periode: "2026-10-27", presetId: 1, jmlSku: 2, jmlOrder: 7,
      omzet: 900, hpp: 500, biaya: 100, pajak: 0, laba: 300,
      marginPersen: 33.3, marginSatuanRata: 10, marginPersenMedian: 33,
      kontribusi10Teratas: 300, persen10Teratas: 100,
    };
    const a = angkaDariRingkasan(r, 50, 200);
    assert.deepEqual(a, {
      omzet: 900, laba: 300, marginPersen: 33.3, jmlOrder: 7, biayaIklan: 50, omzetIklan: 200,
    });
  });
});
