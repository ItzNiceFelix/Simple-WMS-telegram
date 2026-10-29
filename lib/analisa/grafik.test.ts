// lib/analisa/grafik.test.ts — Pembentuk data chart: kasus kosong, null, negatif, pembagi nol.
//
// KENAPA diuji sedetail ini: chart yang salah tidak pernah "error" — ia hanya menampilkan
// batang yang panjangnya beda dari tabel di bawahnya. Satu-satunya cara menangkapnya adalah
// mengunci angka dan labelnya di sini.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dataFunnel, dataPareto, dataPeluang, dataPenggerak, dataRoas, dataStokKontribusi,
  dataTren, dataWaterfall, AMBANG_HARI_STOK_KRITIS, MAKS_TITIK_PELUANG,
} from "./grafik";
import type { BarisSku, RingkasanAnalisa } from "./tipe";

function ringkas(ubah: Partial<RingkasanAnalisa> = {}): RingkasanAnalisa {
  return {
    periode: "2026-10-13", presetId: 1, jmlSku: 3, jmlOrder: 10,
    omzet: 1_000_000, hpp: 600_000, biaya: 100_000, pajak: 20_000, laba: 300_000,
    marginPersen: 30, marginSatuanRata: 1000, marginPersenMedian: 30,
    kontribusi10Teratas: 300_000, persen10Teratas: 100,
    ...ubah,
  };
}

/** Baris SKU minimal — hanya field yang dibaca grafik. */
function baris(sku: string, kontribusi: number): BarisSku {
  return {
    sku, nama: `Nama ${sku}`, unit: 10, hppSatuan: 1000, hargaJual: 2000,
    marginSatuan: 1000, marginPersen: 50, kontribusi,
    roasImpas: 2, hppMaster: null, hppNaik: 0, stok: null,
    dilihat: null, klik: null, ctr: null, cr: null, biayaIklan: null, roasAktual: null,
    organikDilihat: null, organikKunjungan: null, organikKeranjang: null,
    organikPesanan: null, organikOmzet: null,
  };
}

/** Baris SKU dengan override — dipakai chart yang membaca metrik organik/iklan. */
function sku(ubah: Partial<BarisSku> & { sku: string }): BarisSku {
  return { ...baris(ubah.sku, ubah.kontribusi ?? 0), ...ubah };
}

describe("dataWaterfall", () => {
  it("omzet digambar sebagai arus masuk, bukan batang total abu-abu", () => {
    const { batang } = dataWaterfall(ringkas(), null);
    assert.equal(batang[0].jenis, "masuk");
    assert.equal(batang.find((b) => b.kunci === "laba")?.jenis, "total");
  });

  it("batang menutup: omzet − hpp − biaya ops − pajak = laba", () => {
    const { batang } = dataWaterfall(ringkas(), null);
    const nilai = batang.map((b) => b.nilai);
    // omzet + hpp(-) + biaya ops(-) + pajak(-) harus sama dengan batang "laba".
    assert.equal(nilai[0] + nilai[1] + nilai[2] + nilai[3], nilai[4]);
    assert.equal(nilai[4], 300_000);
  });

  it("label sumbu pendek unik dan tidak kosong", () => {
    const { batang } = dataWaterfall(ringkas(), 50_000);
    const pendek = batang.map((b) => b.pendek);
    assert.ok(pendek.every((p) => p.length > 0));
    assert.equal(new Set(pendek).size, pendek.length);
    // Label panjang tetap utuh untuk tooltip/tabel.
    assert.equal(batang.find((b) => b.kunci === "biaya")?.label, "Biaya admin & program");
  });

  it("biaya admin tidak menghitung pajak dua kali", () => {
    const { batang } = dataWaterfall(ringkas(), null);
    // biaya 100.000 dengan pajak 20.000 → batang biaya ops 80.000, bukan 100.000.
    assert.equal(batang.find((b) => b.kunci === "biaya")?.panjang, 80_000);
    assert.equal(batang.find((b) => b.kunci === "pajak")?.panjang, 20_000);
  });

  it("biaya iklan null: batang kosong 'belum diimpor', bukan nol", () => {
    const d = dataWaterfall(ringkas(), null);
    const iklan = d.batang.find((b) => b.kunci === "iklan");
    assert.equal(iklan?.jenis, "tidak_ada");
    assert.equal(iklan?.panjang, 0);
    assert.equal(iklan?.catatan, "belum diimpor");
    // Laba setelah iklan TIDAK dibuat — tidak bisa dihitung, bukan sama dengan laba.
    assert.equal(d.batang.find((b) => b.kunci === "laba-setelah-iklan"), undefined);
    assert.ok(d.kurang.some((k) => k.includes("biaya iklan")));
  });

  it("biaya iklan diketahui: laba setelah iklan = laba − iklan", () => {
    const d = dataWaterfall(ringkas(), 50_000);
    assert.equal(d.batang.find((b) => b.kunci === "laba-setelah-iklan")?.nilai, 250_000);
    assert.equal(d.kurang.length, 0);
  });

  it("biaya iklan lebih besar dari laba: batang negatif tetap digambar", () => {
    const d = dataWaterfall(ringkas(), 500_000);
    const akhir = d.batang.find((b) => b.kunci === "laba-setelah-iklan");
    assert.equal(akhir?.nilai, -200_000);
    assert.equal(akhir?.panjang, 200_000);
    assert.equal(akhir?.dasar, -200_000);
  });

  it("omzet nol: judul netral, tanpa pembagian", () => {
    const d = dataWaterfall(ringkas({ omzet: 0, hpp: 0, biaya: 0, pajak: 0, laba: 0 }), 0);
    assert.match(d.judul, /Belum ada omzet/);
    assert.ok(d.kurang.some((k) => k.includes("omzet")));
    assert.ok(d.batang.every((b) => Number.isFinite(b.panjang) && Number.isFinite(b.dasar)));
  });

  it("laba negatif: batang total turun melewati nol, tidak dipotong", () => {
    const d = dataWaterfall(ringkas({ laba: -100_000 }), null);
    const laba = d.batang.find((b) => b.kunci === "laba");
    assert.equal(laba?.nilai, -100_000);
    assert.equal(laba?.dasar, -100_000);
  });
});

describe("dataPareto", () => {
  it("kumulatif dihitung dari SELURUH kontribusi termasuk yang negatif", () => {
    // 60 + 30 + (-10) = 80 total. Dua SKU positif pertama = 90/80 = 112,5%.
    const d = dataPareto([baris("A", 60), baris("B", 30), baris("C", -10)]);
    assert.equal(d.titik.length, 2);
    assert.equal(d.titik[1].kumulatif, 112.5);
    assert.ok(d.kurang.some((k) => k.includes("negatif")));
  });

  it("SKU negatif tidak digambar sebagai batang", () => {
    const d = dataPareto([baris("A", 60), baris("B", -10)]);
    assert.deepEqual(d.titik.map((t) => t.sku), ["A"]);
  });

  it("judul menyebut jumlah SKU yang mencapai ambang", () => {
    const d = dataPareto([baris("A", 50), baris("B", 30), baris("C", 20)]);
    assert.equal(d.jumlahMencapaiAmbang, 2); // 50% lalu 80% ≥ 60%
    assert.match(d.judul, /2 SKU menyumbang 80,0%/);
  });

  it("ambang tidak tercapai karena batas n: jumlahMencapaiAmbang null, judul memakai jumlah titik", () => {
    // 10 SKU sama besar, hanya 2 yang digambar → 20% kumulatif, di bawah ambang 60%.
    const rata = Array.from({ length: 10 }, (_, i) => baris(`S${i}`, 10));
    const d = dataPareto(rata, 2);
    assert.equal(d.jumlahMencapaiAmbang, null);
    assert.match(d.judul, /2 SKU teratas menyumbang 20,0%/);
  });

  it("batas n memotong jumlah titik", () => {
    const banyak = Array.from({ length: 30 }, (_, i) => baris(`S${i}`, 30 - i));
    assert.equal(dataPareto(banyak, 15).titik.length, 15);
    assert.equal(dataPareto(banyak, 0).titik.length, 0);
  });

  it("daftar kosong: judul netral, tanpa NaN", () => {
    const d = dataPareto([]);
    assert.equal(d.titik.length, 0);
    assert.equal(d.jumlahMencapaiAmbang, null);
    assert.match(d.judul, /Belum ada SKU/);
    assert.ok(!d.aria.includes("NaN"));
  });

  it("semua kontribusi nol: tidak ada yang digambar, judul jujur", () => {
    const d = dataPareto([baris("A", 0), baris("B", 0)]);
    assert.equal(d.titik.length, 0);
    assert.match(d.judul, /tidak positif/);
  });

  it("satu SKU saja: kumulatif 100%", () => {
    const d = dataPareto([baris("A", 500)]);
    assert.equal(d.titik[0].kumulatif, 100);
    assert.equal(d.jumlahMencapaiAmbang, 1);
  });
});

describe("dataTren", () => {
  const hari = (tanggal: string, omzet: number, laba: number, parsial = false) => ({
    tanggal, omzet, laba, marginPersen: omzet > 0 ? Math.round((laba / omzet) * 10000) / 100 : null,
    jmlOrder: 5, parsial,
  });

  it("hari kosong jadi celah, bukan nol", () => {
    const d = dataTren([hari("2026-10-01", 100, 10), null, hari("2026-10-03", 300, 30)], "omzet");
    assert.deepEqual(d.titik.map((t) => t.nilai), [100, null, 300]);
    assert.ok(d.kurang.some((k) => k.includes("celah")));
  });

  it("hari parsial tidak dipakai menghitung delta", () => {
    // Hari terakhir parsial: 10 (jangan dipakai). Dua hari penuh: 100 → 300 = +200%.
    const d = dataTren([
      hari("2026-10-01", 100, 10), hari("2026-10-02", 300, 30), hari("2026-10-03", 10, 1, true),
    ], "omzet");
    assert.equal(d.deltaTerakhir?.selisih, 200);
    assert.equal(d.deltaTerakhir?.persen, 200);
    assert.ok(d.kurang.some((k) => k.includes("parsial")));
    assert.match(d.judul, /naik 200%/);
  });

  it("satu hari berdata: judul jujur, butuh lebih dari satu periode", () => {
    const d = dataTren([hari("2026-10-01", 100, 10)], "laba");
    assert.match(d.judul, /Baru satu hari/);
    assert.ok(d.kurang.some((k) => k.includes("lebih dari 1 periode")));
    assert.equal(d.deltaTerakhir, null);
  });

  it("tanpa data: judul netral, tanpa NaN", () => {
    const d = dataTren([null, null], "margin");
    assert.match(d.judul, /Belum ada data margin/);
    assert.ok(!d.aria.includes("NaN"));
    assert.equal(d.deltaTerakhir, null);
  });

  it("pembanding nol: persen null, selisih tetap ada", () => {
    const d = dataTren([hari("2026-10-01", 0, 0), hari("2026-10-02", 50, 5)], "omzet");
    assert.equal(d.deltaTerakhir?.persen, null);
    assert.equal(d.deltaTerakhir?.selisih, 50);
  });

  it("margin negatif tetap digambar apa adanya", () => {
    const d = dataTren([hari("2026-10-01", 100, -20), hari("2026-10-02", 100, -10)], "margin");
    assert.equal(d.titik[0].nilai, -20);
    assert.equal(d.deltaTerakhir?.selisih, 10);
  });

  it("hari parsial dipisah dari garis utama (tidak menyambung tren)", () => {
    const d = dataTren([
      hari("2026-10-01", 100, 10), hari("2026-10-02", 300, 30), hari("2026-10-03", 10, 1, true),
    ], "omzet");
    // Garis utama hanya punya dua titik penuh; hari parsial punya seri sendiri.
    assert.deepEqual(d.titik.map((t) => t.nilaiPenuh), [100, 300, null]);
    assert.deepEqual(d.titik.map((t) => t.nilaiParsial), [null, null, 10]);
    assert.deepEqual(d.titik.map((t) => t.nilai), [100, 300, 10]);
  });

  it("label hari dua digit untuk sumbu", () => {
    const d = dataTren([hari("2026-10-05", 1, 1)], "omzet");
    assert.equal(d.titik[0].hari, "05");
  });
});

describe("dataPenggerak", () => {
  const b = (sku: string, kontribusi: number): BarisSku => baris(sku, kontribusi);

  it("tanpa pembanding: penyumbang teratas, selisihTotal null", () => {
    const d = dataPenggerak([b("A", 100), b("B", 300)], null);
    assert.equal(d.selisihTotal, null);
    assert.equal(d.turun.length, 0);
    assert.deepEqual(d.naik.map((p) => p.sku), ["B", "A"]);
    assert.ok(d.kurang.some((k) => k.includes("pembanding")));
  });

  it("selisih per SKU: naik dan turun dipisah, urut dampak", () => {
    const d = dataPenggerak(
      [b("A", 500), b("B", 100), b("C", 400)],
      [b("A", 200), b("B", 400), b("C", 400)]
    );
    assert.deepEqual(d.naik.map((p) => [p.sku, p.selisih]), [["A", 300]]);
    assert.deepEqual(d.turun.map((p) => [p.sku, p.selisih]), [["B", -300]]);
    assert.equal(d.selisihTotal, 0); // 300 - 300 + 0
  });

  it("SKU yang hilang di periode kini dihitung sebagai penurunan", () => {
    const d = dataPenggerak([b("A", 100)], [b("A", 100), b("HILANG", 700)]);
    assert.equal(d.turun[0].sku, "HILANG");
    assert.equal(d.turun[0].selisih, -700);
    assert.ok(d.kurang.some((k) => k.includes("tidak muncul lagi")));
  });

  it("batas n per arah", () => {
    const kini = Array.from({ length: 20 }, (_, i) => b(`S${i}`, 100 + i));
    const lalu = Array.from({ length: 20 }, (_, i) => b(`S${i}`, 0));
    assert.equal(dataPenggerak(kini, lalu, 3).naik.length, 3);
  });

  it("tidak ada perubahan: judul jujur", () => {
    const d = dataPenggerak([b("A", 100)], [b("A", 100)]);
    assert.match(d.judul, /tidak berubah/);
    assert.equal(d.selisihTotal, 0);
  });
});

describe("dataFunnel", () => {
  it("persen antar tahap dan tahap terburuk", () => {
    const d = dataFunnel([sku({
      sku: "A", organikDilihat: 1000, organikKunjungan: 500,
      organikKeranjang: 50, organikPesanan: 5,
    })]);
    assert.deepEqual(d.tahap.map((t) => t.nilai), [1000, 500, 50, 5]);
    assert.deepEqual(d.tahap.map((t) => t.persenDariSebelum), [null, 50, 10, 10]);
    assert.match(d.judul, /Keranjang|Pesanan/);
  });

  it("tanpa data performa: semua null, disebut", () => {
    const d = dataFunnel([sku({ sku: "A" })]);
    assert.ok(d.tahap.every((t) => t.nilai === null));
    assert.ok(d.kurang.some((k) => k.includes("Performa Produk")));
    assert.match(d.judul, /belum bisa dihitung/);
  });

  it("tahap nol: 0% bila terukur, null bila pembaginya nol", () => {
    const d = dataFunnel([sku({ sku: "A", organikDilihat: 100, organikKunjungan: 0, organikPesanan: 0 })]);
    // 0 dari 100 = nol TERUKUR, jadi 0% — bukan null.
    assert.equal(d.tahap[1].persenDariSebelum, 0);
    // 0 dari 0 tidak punya rasio: null, bukan Infinity/NaN.
    assert.equal(d.tahap[2].persenDariSebelum, null);
    assert.ok(d.tahap.every((t) => t.persenDariSebelum === null || Number.isFinite(t.persenDariSebelum)));
  });

  it("penjumlahan lintas SKU", () => {
    const d = dataFunnel([
      sku({ sku: "A", organikDilihat: 10, organikKunjungan: 5, organikKeranjang: 2, organikPesanan: 1 }),
      sku({ sku: "B", organikDilihat: 20, organikKunjungan: 15, organikKeranjang: 3, organikPesanan: 2 }),
    ]);
    assert.equal(d.tahap[0].nilai, 30);
    assert.equal(d.tahap[3].nilai, 3);
  });
});

describe("dataPeluang", () => {
  it("hanya SKU dengan kunjungan dan pesanan yang digambar", () => {
    const d = dataPeluang([
      sku({ sku: "A", organikKunjungan: 100, organikPesanan: 10, organikOmzet: 500 }),
      sku({ sku: "B", organikKunjungan: null, organikPesanan: 5 }),
      sku({ sku: "C", organikKunjungan: 0, organikPesanan: 0 }),
    ]);
    assert.deepEqual(d.titik.map((t) => t.sku), ["A"]);
    assert.equal(d.titik[0].y, 10);
  });

  it("garis rata-rata memakai SEMUA SKU berdata, bukan hanya yang digambar", () => {
    const banyak = Array.from({ length: 100 }, (_, i) =>
      sku({ sku: `S${i}`, organikKunjungan: 1000 - i, organikPesanan: 100 })
    );
    const d = dataPeluang(banyak);
    assert.equal(d.titik.length, MAKS_TITIK_PELUANG);
    assert.ok(d.kurang.some((k) => k.includes("tidak digambar")));
    assert.ok(d.crRata !== null && Number.isFinite(d.crRata));
  });

  it("kuadran ramai-tapi-tidak-laku dihitung", () => {
    const d = dataPeluang([
      sku({ sku: "RAMAI", organikKunjungan: 1000, organikPesanan: 1 }),
      sku({ sku: "SEPI", organikKunjungan: 10, organikPesanan: 5 }),
    ]);
    assert.equal(d.titik.find((t) => t.sku === "RAMAI")?.y, 0.1);
    assert.match(d.judul, /ramai dikunjungi/);
  });

  it("tanpa data: judul netral", () => {
    const d = dataPeluang([sku({ sku: "A" })]);
    assert.equal(d.titik.length, 0);
    assert.equal(d.crRata, null);
    assert.match(d.judul, /Belum ada titik/);
  });
});

describe("dataRoas", () => {
  it("status per SKU memakai impas SKU itu sendiri", () => {
    const d = dataRoas([
      sku({ sku: "RUGI", biayaIklan: 1000, roasAktual: 2, roasImpas: 5 }),
      sku({ sku: "AMAN", biayaIklan: 1000, roasAktual: 8, roasImpas: 5 }),
      sku({ sku: "TANPA", biayaIklan: 1000, roasAktual: 9, roasImpas: null }),
    ]);
    assert.deepEqual(d.baris.map((r) => [r.sku, r.status]), [
      ["RUGI", "rugi"], ["TANPA", "tidak_dinilai"], ["AMAN", "aman"],
    ]);
    assert.match(d.judul, /1 dari 3 SKU/);
  });

  it("SKU tanpa biaya iklan tidak masuk daftar", () => {
    const d = dataRoas([sku({ sku: "A", biayaIklan: null, roasAktual: 9, roasImpas: 5 })]);
    assert.equal(d.baris.length, 0);
    assert.ok(d.kurang.some((k) => k.includes("biaya iklan")));
  });

  it("semua aman: judul menyatakan itu", () => {
    const d = dataRoas([sku({ sku: "A", biayaIklan: 100, roasAktual: 9, roasImpas: 5 })]);
    assert.match(d.judul, /Semua 1 SKU/);
  });

  it("roasLangsung null tidak dianggap 0", () => {
    const d = dataRoas([sku({ sku: "A", biayaIklan: 100, roasAktual: 9, roasImpas: 5, roasLangsung: null })]);
    assert.equal(d.baris[0].roasLangsung, null);
  });
});

describe("dataStokKontribusi", () => {
  it("hari tersisa = stok ÷ unit; judul menghitung yang kritis", () => {
    const d = dataStokKontribusi([
      sku({ sku: "HABIS", stok: 3, unit: 10, kontribusi: 50_000 }),   // 0,3 hari
      sku({ sku: "AMAN", stok: 300, unit: 10, kontribusi: 40_000 }),  // 30 hari
    ]);
    assert.equal(d.titik[0].hariTersisa, 0.3);
    assert.equal(d.titik[1].hariTersisa, 30);
    assert.match(d.judul, /1 SKU penyumbang laba habis dalam 3 hari/);
  });

  it("diurut kontribusi terbesar, bukan hari tersisa", () => {
    const d = dataStokKontribusi([
      sku({ sku: "KECIL", stok: 1, unit: 10, kontribusi: 1_000 }),
      sku({ sku: "BESAR", stok: 100, unit: 10, kontribusi: 90_000 }),
    ]);
    assert.deepEqual(d.titik.map((t) => t.sku), ["BESAR", "KECIL"]);
  });

  it("tanpa data stok: daftar kosong, disebut", () => {
    const d = dataStokKontribusi([sku({ sku: "A", stok: null })]);
    assert.equal(d.titik.length, 0);
    assert.match(d.judul, /belum ada/);
    assert.ok(d.kurang.some((k) => k.includes("Data stok tidak tersedia")));
  });

  it("unit nol: tidak diproyeksikan, jumlahnya disebut", () => {
    const d = dataStokKontribusi([sku({ sku: "A", stok: 100, unit: 0, kontribusi: 5000 })]);
    assert.equal(d.titik.length, 0);
    assert.ok(d.kurang.some((k) => k.includes("tidak terjual")));
  });

  it("stok negatif ditampilkan apa adanya, tidak dipotong ke nol", () => {
    const d = dataStokKontribusi([sku({ sku: "MINUS", stok: -5, unit: 10, kontribusi: 5000 })]);
    assert.equal(d.titik[0].hariTersisa, -0.5);
  });

  it("SKU tanpa kontribusi positif tidak masuk daftar", () => {
    const d = dataStokKontribusi([
      sku({ sku: "RUGI", stok: 5, unit: 10, kontribusi: -1000 }),
      sku({ sku: "NOL", stok: 5, unit: 10, kontribusi: 0 }),
    ]);
    assert.equal(d.titik.length, 0);
  });

  it("semua aman: judul menyatakan itu", () => {
    const d = dataStokKontribusi([sku({ sku: "A", stok: 900, unit: 10, kontribusi: 5000 })]);
    assert.match(d.judul, /masih di atas 3 hari/);
  });
});
