// lib/analisa/aksi.test.ts — daftar tindakan: dampak rupiah, urutan, dan kejujuran saat
// dampak tidak bisa dihitung.
//
// KENAPA: kartu "Keputusan hari ini" adalah satu-satunya bagian halaman yang menyuruh orang
// membelanjakan/menghentikan uang. Angka dampak yang salah di sana langsung jadi keputusan
// yang salah, dan tidak ada tabel di bawahnya yang bisa membantah.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alasanTanpaAksi, susunAksi } from "./aksi";
import type { BarisSku, RingkasanAnalisa, Temuan } from "./tipe";

function baris(ubah: Partial<BarisSku> & { sku: string }): BarisSku {
  return {
    nama: ubah.sku, unit: 10, hppSatuan: 1000, hargaJual: 10_000,
    marginSatuan: 2000, marginPersen: 20, kontribusi: 20_000,
    roasImpas: 5, hppMaster: null, hppNaik: 0, stok: null,
    dilihat: 5000, klik: 200, ctr: 4, cr: 5, biayaIklan: 100_000, roasAktual: 8,
    organikDilihat: null, organikKunjungan: null, organikKeranjang: null,
    organikPesanan: null, organikOmzet: null,
    ...ubah,
  };
}

function ringkas(ubah: Partial<RingkasanAnalisa> = {}): RingkasanAnalisa {
  return {
    periode: "2026-10-27", presetId: 1, jmlSku: 1, jmlOrder: 10,
    omzet: 1_000_000, hpp: 600_000, biaya: 100_000, pajak: 0, laba: 300_000,
    marginPersen: 30, marginSatuanRata: 1000, marginPersenMedian: 30,
    kontribusi10Teratas: 300_000, persen10Teratas: 100,
    ...ubah,
  };
}

describe("susunAksi", () => {
  it("iklan di bawah titik impas: dampak = bagian biaya yang tidak tertutup", () => {
    // ROAS 2,5 vs impas 5 → separuh biaya tidak kembali → 50.000 dari 100.000.
    const aksi = susunAksi({
      baris: [baris({ sku: "A", roasAktual: 2.5, roasImpas: 5, biayaIklan: 100_000 })],
      temuan: [], ringkasan: ringkas(), biayaIklan: 100_000,
    });
    const henti = aksi.find((a) => a.kode.startsWith("hentikan-iklan"));
    assert.ok(henti);
    assert.equal(henti?.dampak, 50_000);
    assert.equal(henti?.dampakBerupa, "rugi");
  });

  it("iklan tidak dinilai bila tayangan di bawah ambang sampel", () => {
    const aksi = susunAksi({
      baris: [baris({ sku: "A", dilihat: 10, roasAktual: 0.1, roasImpas: 5 })],
      temuan: [], ringkasan: ringkas(), biayaIklan: 100_000,
    });
    assert.equal(aksi.some((a) => a.kode.startsWith("hentikan-iklan")), false);
  });

  it("iklan yang layak didorong: dampak null DISEBUT alasannya", () => {
    const aksi = susunAksi({
      baris: [baris({ sku: "A", roasAktual: 9, roasImpas: 5, ctr: 4 })],
      temuan: [], ringkasan: ringkas(), biayaIklan: 100_000,
    });
    const naik = aksi.find((a) => a.kode.startsWith("naikkan-iklan"));
    assert.ok(naik);
    assert.equal(naik?.dampak, null);
    assert.ok((naik?.dampakAlasan ?? "").length > 10);
  });

  it("SKU merugi: dampak = total kerugian yang sudah terjadi", () => {
    const aksi = susunAksi({
      baris: [
        baris({ sku: "A", marginSatuan: -500, marginPersen: -5, kontribusi: -30_000 }),
        baris({ sku: "B", marginSatuan: -100, marginPersen: -1, kontribusi: -20_000 }),
      ],
      temuan: [], ringkasan: ringkas(), biayaIklan: null,
    });
    const merugi = aksi.find((a) => a.kode === "sku-merugi");
    assert.equal(merugi?.dampak, 50_000);
    assert.match(merugi?.objek ?? "", /2 SKU/);
  });

  it("hpp naik: dampak = selisih HPP × unit terjual", () => {
    const aksi = susunAksi({
      baris: [baris({ sku: "A", hppNaik: 300, unit: 10 })],
      temuan: [], ringkasan: ringkas(), biayaIklan: null,
    });
    assert.equal(aksi.find((a) => a.kode === "hpp-naik")?.dampak, 3000);
  });

  it("stok kritis: dampak tidak dikarang, alasannya disebut", () => {
    const aksi = susunAksi({
      baris: [baris({ sku: "A", stok: 2, unit: 10, kontribusi: 50_000 })],
      temuan: [], ringkasan: ringkas(), biayaIklan: null,
    });
    const stok = aksi.find((a) => a.kode === "stok-kritis");
    assert.equal(stok?.dampak, null);
    assert.match(stok?.dampakAlasan ?? "", /proyeksi/);
    // Tab tujuannya Stok: di sanalah proyeksi hari tersisa bisa diperiksa.
    assert.equal(stok?.tujuanTab, "stok");
  });

  it("stok nol bukan stok kritis (tidak diketahui ≠ habis)", () => {
    const aksi = susunAksi({
      baris: [baris({ sku: "A", stok: null, unit: 10 })],
      temuan: [], ringkasan: ringkas(), biayaIklan: null,
    });
    assert.equal(aksi.some((a) => a.kode === "stok-kritis"), false);
  });

  it("diurut dampak terbesar dulu, yang null paling belakang", () => {
    const aksi = susunAksi({
      baris: [
        baris({ sku: "A", marginSatuan: -10, kontribusi: -1000 }),
        baris({ sku: "B", hppNaik: 100, unit: 10 }),
        baris({ sku: "C", stok: 1, unit: 10, kontribusi: 9000 }),
      ],
      temuan: [], ringkasan: ringkas(), biayaIklan: null,
    });
    const dampak = aksi.map((a) => a.dampak);
    const berangka = dampak.filter((d): d is number => d !== null);
    assert.deepEqual(berangka, [...berangka].sort((x, y) => y - x));
    // Semua yang null harus berada setelah yang berangka.
    const iNull = dampak.indexOf(null);
    if (iNull >= 0) assert.ok(dampak.slice(iNull).every((d) => d === null));
  });

  it("maksimum lima aksi", () => {
    const banyak = Array.from({ length: 12 }, (_, i) =>
      baris({ sku: `S${i}`, marginSatuan: -1, kontribusi: -1000 * (i + 1) })
    );
    assert.equal(susunAksi({ baris: banyak, temuan: [], ringkasan: ringkas(), biayaIklan: null }).length, 5);
  });

  it("temuan kritis yang belum terwakili ikut jadi aksi", () => {
    const t: Temuan = {
      kode: "organik_dilihat_tanpa_beli", keparahan: "kritis",
      judul: "3 produk dilihat tapi tidak dibeli", penjelasan: "Masalah halaman, bukan iklan.",
      angka: { nilai: 900, satuan: "jumlah", jumlahTerkena: 3 },
      contohSku: [],
    };
    const aksi = susunAksi({ baris: [baris({ sku: "A" })], temuan: [t], ringkasan: ringkas(), biayaIklan: null });
    const kartu = aksi.find((a) => a.kode === "temuan:organik_dilihat_tanpa_beli");
    assert.ok(kartu);
    assert.equal(kartu?.dampak, null);
    assert.match(kartu?.dampakAlasan ?? "", /jumlah/);
  });

  it("temuan yang sudah terwakili aksi lain tidak diduplikasi", () => {
    const t: Temuan = {
      kode: "sku_merugi", keparahan: "kritis", judul: "1 SKU merugi", penjelasan: "x",
      angka: { nilai: 1000, satuan: "rupiah", jumlahTerkena: 1 }, contohSku: [],
    };
    const aksi = susunAksi({
      baris: [baris({ sku: "A", marginSatuan: -1, kontribusi: -1000 })],
      temuan: [t], ringkasan: ringkas(), biayaIklan: null,
    });
    assert.equal(aksi.filter((a) => a.kode.includes("sku-merugi") || a.kode.includes("sku_merugi")).length, 1);
  });

  it("tanpa masalah: daftar kosong", () => {
    const aksi = susunAksi({
      baris: [baris({ sku: "A", marginPersen: 25, marginSatuan: 2000, roasAktual: 9, roasImpas: 5 })],
      temuan: [], ringkasan: ringkas(), biayaIklan: 100_000,
    });
    // Satu-satunya yang tersisa adalah "naikkan iklan", yang memang bukan masalah.
    assert.equal(aksi.every((a) => a.kode.startsWith("naikkan-iklan")), true);
  });
});

describe("alasanTanpaAksi", () => {
  it("menyebut alasan, bukan kalimat kosong", () => {
    const teks = alasanTanpaAksi({
      baris: [baris({ sku: "A" })], biayaIklan: null, ringkasan: ringkas(),
    });
    assert.match(teks, /Tidak ada aksi mendesak/);
    assert.match(teks, /biaya iklan belum diimpor/);
    assert.match(teks, /data stok tidak tersedia/);
  });

  it("tanpa SKU: menyebut itu", () => {
    assert.match(alasanTanpaAksi({ baris: [], biayaIklan: null, ringkasan: ringkas() }), /Belum ada SKU/);
  });
});
