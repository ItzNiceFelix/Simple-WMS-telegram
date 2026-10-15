// Uji estimasi iklan per SKU. Fungsi murni, tanpa fixture DB — semua angka eksplisit
// supaya uji menangkap kesalahan aritmetika, bukan kesalahan query.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimasiIklan, ringkasEstimasi, type MasukanEstimasi } from "./iklanEstimasi";

function hari(tanggal: string, omzet: number, unit: number) {
  return { tanggal, omzet, unit, marginSatuan: 10_000, hargaJual: 25_000 };
}

function masukan(ubah: Partial<MasukanEstimasi> = {}): MasukanEstimasi {
  return {
    sku: "SKU-1",
    nama: "Produk Uji",
    histori: [
      hari("2026-10-10", 1_200_000, 40),
      hari("2026-10-12", 2_000_000, 70),
      hari("2026-10-13", 3_600_000, 120),
    ],
    modalIklan: 500_000,
    targetRoas: 0,
    ...ubah,
  };
}

describe("tiga asumsi konservatif/netral/optimis", () => {
  it("menghasilkan angka BERBEDA saat omzet naik-turun", () => {
    const h = estimasiIklan(masukan());
    assert.equal(h.omzetRata1, 1_200_000);
    assert.equal(h.omzetRata2, 2_000_000);
    assert.equal(h.omzetRata3, 3_600_000);
    assert.ok(h.omzetRata1! < h.omzetRata2! && h.omzetRata2! < h.omzetRata3!);
  });

  it("median dipakai saat jumlah hari genap", () => {
    const h = estimasiIklan(masukan({
      histori: [
        hari("a", 1_000_000, 10),
        hari("b", 2_000_000, 20),
        hari("c", 4_000_000, 40),
        hari("d", 9_000_000, 90),
      ],
    }));
    // median(1,2,4,9 jt) = 3jt → hari terdekat = 2jt (selisih 1jt) vs 4jt (selisih 1jt)?
    // |2-3|=1 dan |4-3|=1 → ambil yang pertama ditemukan, 2jt.
    assert.equal(h.omzetRata1, 1_000_000);
    assert.equal(h.omzetRata3, 9_000_000);
    assert.equal(h.omzetRata2, 2_000_000);
  });
});

describe("unit selalu dari hari yang SAMA dengan omzetnya", () => {
  it("hari terbaik unit kecil dan hari terburuk unit besar — tidak tertukar", () => {
    const h = estimasiIklan(masukan({
      histori: [
        hari("2026-10-10", 1_200_000, 300), // terburuk omzet, unit BESAR
        hari("2026-10-12", 2_000_000, 20),
        hari("2026-10-13", 3_600_000, 5), // terbaik omzet, unit KECIL
      ],
    }));
    assert.equal(h.omzetRata1, 1_200_000);
    assert.equal(h.unitRata1, 300);
    assert.equal(h.omzetRata3, 3_600_000);
    assert.equal(h.unitRata3, 5);
    // Laba ikut unit yang benar: 300×10.000 − 500.000 = 2.500.000.
    assert.equal(h.profitRata1, 2_500_000);
    assert.equal(h.profitRata3, 5 * 10_000 - 500_000);
  });
});

describe("data tidak ada ≠ terjual nol", () => {
  it("histori kosong → semua null dan status belum_cukup_data, BUKAN 0", () => {
    const h = estimasiIklan(masukan({ histori: [] }));
    for (const n of [h.omzetRata1, h.omzetRata2, h.omzetRata3, h.unitRata1, h.unitRata2, h.unitRata3,
      h.profitRata1, h.profitRata2, h.profitRata3, h.roasRil]) {
      assert.equal(n, null);
    }
    assert.equal(h.status, "belum_cukup_data");
    assert.match(h.alasan, /Belum ada data/i);
  });

  it("modalIklan 0 → roasRil null dan belum_cukup_data", () => {
    const h = estimasiIklan(masukan({ modalIklan: 0 }));
    assert.equal(h.roasRil, null);
    assert.equal(h.status, "belum_cukup_data");
    assert.match(h.alasan, /Modal iklan belum diisi/i);
  });

  it("omzet terjual nol pada satu hari tetap 0, bukan null", () => {
    const h = estimasiIklan(masukan({
      histori: [hari("a", 0, 0), hari("b", 2_000_000, 20)],
    }));
    assert.equal(h.omzetRata1, 0);
    assert.equal(h.unitRata1, 0);
    assert.equal(h.status, "rugi"); // terburuk nol omzet, modal tetap keluar
  });
});

describe("roasImpas diambil dari hitung.ts", () => {
  it("margin ≤ 0 → roasImpas null dan status rugi dengan alasan titik impas", () => {
    const h = estimasiIklan(masukan({
      histori: [{ tanggal: "a", omzet: 2_000_000, unit: 20, marginSatuan: 0, hargaJual: 25_000 }],
    }));
    assert.equal(h.roasImpas, null);
    assert.equal(h.status, "rugi");
    assert.match(h.alasan, /titik impas/i);
    assert.match(h.alasan, /tidak ada titik impas/i);
  });

  it("margin sehat → roasImpas 2.5 untuk harga 25rb / margin 10rb", () => {
    const h = estimasiIklan(masukan());
    assert.equal(h.roasImpas, 2.5);
  });
});

describe("status tipis (aman di hari buruk, rugi di hari ramai)", () => {
  it("menandai rapuh dengan angka di alasannya", () => {
    const h = estimasiIklan(masukan({
      // unit buruk 60 → laba 100rb; unit terbaik 30 → laba −200rb (margin 10rb, modal 500rb)
      histori: [hari("a", 1_200_000, 60), hari("b", 2_000_000, 45), hari("c", 3_600_000, 30)],
    }));
    assert.equal(h.profitRata1, 100_000);
    assert.ok(h.profitRata3! < 0);
    assert.equal(h.status, "tipis");
    assert.match(h.alasan, /terburuk/i);
    assert.match(h.alasan, /terbaik/i);
  });
});

describe("status aman", () => {
  it("ketiganya untung → aman", () => {
    const h = estimasiIklan(masukan({
      histori: [hari("a", 1_200_000, 60), hari("b", 2_000_000, 70), hari("c", 3_600_000, 90)],
    }));
    assert.ok(h.profitRata1! >= 0 && h.profitRata2! >= 0 && h.profitRata3! >= 0);
    assert.equal(h.status, "aman");
  });
});

describe("target ROAS", () => {
  it("targetTercapai true saat roasRil >= targetRoas", () => {
    // omzet netral 2jt, modal 500rb → roasRil 4.
    const h = estimasiIklan(masukan({ targetRoas: 3 }));
    assert.equal(h.roasRil, 4);
    assert.equal(h.targetTercapai, true);
    assert.equal(h.selisihTarget, 1);
  });

  it("targetTercapai false dan selisih negatif saat target terlalu tinggi", () => {
    const h = estimasiIklan(masukan({ targetRoas: 5 }));
    assert.equal(h.targetTercapai, false);
    assert.equal(h.selisihTarget, -1);
  });

  it("targetRoas 0 → tidak ada targetTercapai sama sekali", () => {
    const h = estimasiIklan(masukan({ targetRoas: 0 }));
    assert.equal("targetTercapai" in h, false);
    assert.equal("selisihTarget" in h, false);
  });
});

describe("satu hari saja", () => {
  it("ketiga asumsi sama nilainya", () => {
    const h = estimasiIklan(masukan({ histori: [hari("a", 1_500_000, 55)] }));
    assert.equal(h.omzetRata1, 1_500_000);
    assert.equal(h.omzetRata2, 1_500_000);
    assert.equal(h.omzetRata3, 1_500_000);
    assert.equal(h.unitRata1, 55);
    assert.equal(h.unitRata2, 55);
    assert.equal(h.unitRata3, 55);
    assert.equal(h.profitRata1, h.profitRata3);
  });
});

describe("HPP master tergerus", () => {
  it("hppMaster lebih tinggi dari HPP historis → hppTergerus true", () => {
    // HPP historis = 25.000 − 10.000 = 15.000.
    assert.equal(estimasiIklan(masukan({ hppMaster: 18_000 })).hppTergerus, true);
    assert.equal(estimasiIklan(masukan({ hppMaster: 12_000 })).hppTergerus, undefined);
    assert.equal(estimasiIklan(masukan({ hppMaster: null })).hppTergerus, undefined);
  });
});

describe("ringkasEstimasi", () => {
  it("menjumlahkan modal, laba tiap skenario, dan hitung per status", () => {
    const aman = estimasiIklan(masukan({
      sku: "A", histori: [hari("a", 1_200_000, 60), hari("b", 2_000_000, 70)],
    }));
    const rugi = estimasiIklan(masukan({
      sku: "B", modalIklan: 5_000_000, histori: [hari("a", 1_200_000, 20), hari("b", 2_000_000, 30)],
    }));
    const kosong = estimasiIklan(masukan({ sku: "C", histori: [] }));
    const r = ringkasEstimasi([aman, rugi, kosong]);
    assert.equal(r.jumlahSku, 3);
    assert.equal(r.totalModal, 500_000 + 5_000_000 + 500_000);
    assert.equal(r.jumlahAman, 1);
    assert.equal(r.jumlahRugi, 1);
    assert.equal(r.jumlahBelumCukupData, 1);
    assert.equal(r.jumlahTipis, 0);
    // SKU kosong menyumbang 0, bukan NaN.
    assert.equal(Number.isNaN(r.totalProfit1), false);
    assert.equal(r.totalProfit1, aman.profitRata1! + rugi.profitRata1!);
  });

  it("daftar kosong → semua nol tanpa NaN", () => {
    const r = ringkasEstimasi([]);
    assert.equal(r.jumlahSku, 0);
    assert.equal(r.totalModal, 0);
    assert.equal(r.totalProfit3, 0);
  });
});
