// lib/analisa/golden.test.ts — Angka analisa TIDAK BOLEH berubah tanpa disadari.
//
// KENAPA: halaman analisa dipakai memutuskan uang (hentikan iklan, ubah harga). Perubahan
// rumus yang menggeser angka 1% pun harus terlihat di diff, bukan ditemukan berbulan-bulan
// kemudian dari keputusan yang sudah terlanjur diambil. Uji ini mengunci hasil `analisaCepat`
// untuk `fixture-snapshot.json` — snapshot NYATA dari produksi, bukan data karangan.
//
// Kalau uji ini merah: JANGAN perbarui angkanya begitu saja. Tentukan dulu apakah
// pergeserannya disengaja (rumus memang diubah, dan pemilik sudah menyetujui), baru tulis
// angka baru beserta alasannya di commit message.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analisaCepat, type MasukanAnalisa } from "./hitung";
import fixtureJson from "./fixture-snapshot.json" with { type: "json" };

type Fixture = {
  tanggal: string; jml_order: number; omzet: number; hpp: number;
  biaya: number; pajak: number; laba: number;
  rincian: {
    sku: string; nama: string | null; unit: number; hppSatuan: number;
    hargaJual: number; marginSatuan: number; marginPersen: number; kontribusi: number;
  }[];
};

const fx: Fixture = fixtureJson;

function masukan(): MasukanAnalisa {
  return {
    presetId: 1,
    periode: fx.tanggal,
    snapshot: {
      jml_order: fx.jml_order, omzet: fx.omzet, hpp: fx.hpp,
      biaya: fx.biaya, pajak: fx.pajak, laba: fx.laba, rincian: fx.rincian,
    },
    // Masukan minimal: tanpa HPP master, stok, iklan, performa. Golden test mengunci
    // jalur yang paling sering dipakai (halaman dibuka tanpa data tambahan).
    hppMaster: new Map(),
    stok: null,
    biayaIklan: null,
    jmlSnapshot: 3,
    adaPerforma: false,
  };
}

describe("golden: analisaCepat atas fixture produksi", () => {
  it("ringkasan tidak bergeser", () => {
    const { ringkasan } = analisaCepat(masukan());
    assert.deepEqual(ringkasan, {
      periode: "2026-10-13",
      presetId: 1,
      jmlSku: 65,
      jmlOrder: 598,
      omzet: 16065584,
      hpp: 9445788,
      biaya: 4530968,
      pajak: 80330,
      laba: 2088828,
      marginPersen: 13,
      marginSatuanRata: 2236,
      marginPersenMedian: 14,
      kontribusi10Teratas: 1368432,
      persen10Teratas: 65.5,
    });
  });

  it("temuan yang muncul dan urutannya tidak bergeser", () => {
    const { temuan } = analisaCepat(masukan());
    assert.deepEqual(temuan.map((t) => t.kode), ["sku_merugi", "margin_tipis", "konsentrasi"]);
  });

  it("lima SKU penyumbang teratas tidak bergeser", () => {
    const { baris } = analisaCepat(masukan());
    assert.deepEqual(
      baris.slice(0, 5).map((b) => [b.sku, b.kontribusi, b.marginPersen]),
      [
        ["100331", 358048, 21.1],
        ["001673", 279233, 14.3],
        ["001765", 244850, 14.3],
        ["001822", 132733, 7.6],
        ["001737", 96703, 23.7],
      ]
    );
  });

  it("jumlah SKU dan kekurangan data disebut", () => {
    const hasil = analisaCepat(masukan());
    assert.equal(hasil.baris.length, 65);
    assert.equal(hasil.kurang.length, 3);
  });
});
