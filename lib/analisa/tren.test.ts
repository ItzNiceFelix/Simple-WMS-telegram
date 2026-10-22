// Uji fungsi tren yang dipakai halaman Analisa: delta harian, komposisi biaya per jenis,
// dan agregasi per jenis. Semua murni — tanpa D1.
//
// Yang dijaga di sini adalah aturan yang paling mudah dilanggar saat menambah grafik:
// data yang tidak ada tetap `null`, dan hari tanpa snapshot tidak boleh menyumbang nol.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deltaHarian, jumlahBiayaJenis, komposisiBiayaJenis, seriHarian, ringkasRentang,
  type SnapshotRinci, type TitikHarian,
} from "./tren";

function titik(tanggal: string, omzet: number, laba: number, jmlOrder = 10, biayaJenis: Record<string, number> = {}): TitikHarian {
  return {
    tanggal, omzet, hpp: Math.round(omzet * 0.6), biaya: Math.round(omzet * 0.2), pajak: 0,
    biayaOperasional: Math.round(omzet * 0.2), laba, marginPersen: omzet > 0 ? Math.round((laba / omzet) * 10000) / 100 : null,
    jmlOrder, biayaJenis,
  };
}

describe("deltaHarian", () => {
  it("hari pertama tanpa pembanding: semua delta null, bukan nol", () => {
    const d = deltaHarian([titik("2026-10-01", 1000, 100)]);
    assert.equal(d[0].omzet, null);
    assert.equal(d[0].laba, null);
    assert.equal(d[0].order, null);
    assert.equal(d[0].marginPoin, null);
  });

  it("menghitung selisih terhadap hari SEBELUMNYA, bukan awal rentang", () => {
    const d = deltaHarian([
      titik("2026-10-01", 1000, 100),
      titik("2026-10-02", 1500, 150),
      titik("2026-10-03", 900, 90),
    ]);
    assert.equal(d[1].omzet?.selisih, 500);
    assert.equal(d[1].omzet?.persen, 50);
    assert.equal(d[2].omzet?.selisih, -600, "pembanding hari ke-3 adalah hari ke-2, bukan hari ke-1");
    assert.equal(d[2].omzet?.persen, -40);
  });

  it("hari tanpa snapshot dilewati sebagai pembanding, bukan dianggap nol", () => {
    const d = deltaHarian([titik("2026-10-01", 1000, 100), null, titik("2026-10-03", 1200, 120)]);
    assert.equal(d[1].omzet, null, "entri kosong tidak punya delta");
    assert.equal(d[2].omzet?.sebelum, 1000, "pembanding tetap hari berdata terakhir, bukan nol");
    assert.equal(d[2].omzet?.persen, 20);
  });

  it("margin dibaca dalam POIN persen", () => {
    // 10% -> 12% adalah +2 poin, bukan +20%.
    const d = deltaHarian([titik("2026-10-01", 1000, 100), titik("2026-10-02", 1000, 120)]);
    assert.equal(d[1].marginPoin, 2);
  });

  it("selisih tidak membawa artefak float ke UI", () => {
    // 13.83 − 12.38 di IEEE-754 = 1.4499999999999993; itu tampil apa adanya di layar.
    const d = deltaHarian([titik("2026-10-01", 1000, 123.8), titik("2026-10-02", 1000, 138.3)]);
    assert.equal(d[1].marginPoin, 1.45);
    assert.equal(String(d[1].marginPoin).includes("000000"), false);
  });

  it("omzet pembanding nol: persen null, bukan Infinity", () => {
    const d = deltaHarian([titik("2026-10-01", 0, 0), titik("2026-10-02", 500, 50)]);
    assert.equal(d[1].omzet?.selisih, 500);
    assert.equal(d[1].omzet?.persen, null);
  });
});

describe("jumlahBiayaJenis", () => {
  it("menjumlahkan label yang sama antar hari", () => {
    const j = jumlahBiayaJenis([
      titik("2026-10-01", 1000, 100, 10, { admin: 100, "program:gratis_ongkir_xtra": 55 }),
      titik("2026-10-02", 1000, 100, 10, { admin: 90 }),
    ]);
    assert.deepEqual(j, { admin: 190, "program:gratis_ongkir_xtra": 55 });
  });

  it("hari tanpa snapshot tidak menambah apa pun", () => {
    const j = jumlahBiayaJenis([titik("2026-10-01", 1000, 100, 10, { admin: 100 }), null]);
    assert.deepEqual(j, { admin: 100 });
  });

  it("label bernilai nol dibuang, bukan disimpan sebagai nol", () => {
    const j = jumlahBiayaJenis([titik("2026-10-01", 1000, 100, 10, { admin: 0, proses: 1250 })]);
    assert.deepEqual(j, { proses: 1250 });
  });
});

describe("komposisiBiayaJenis", () => {
  const ringkas = ringkasRentang([titik("2026-10-01", 10000, 2000)]);

  it("memakai pecahan per jenis bila tersedia, terbesar dulu", () => {
    const k = komposisiBiayaJenis({ admin: 1000, proses: 5000, "program:gratis_ongkir_xtra": 3000 }, ringkas);
    assert.deepEqual(k.map((x) => x.kunci), ["proses", "program:gratis_ongkir_xtra", "admin"]);
  });

  it("menerjemahkan kode program ke nama yang bisa dibaca", () => {
    const k = komposisiBiayaJenis({ "program:gratis_ongkir_xtra": 3000 }, ringkas);
    assert.equal(k[0].label, "Program Gratis Ongkir XTRA");
  });

  it("kode program tak dikenal ditampilkan apa adanya, bukan disembunyikan", () => {
    const k = komposisiBiayaJenis({ "program:baru_2027": 3000 }, ringkas);
    assert.equal(k[0].label, "Program baru_2027");
  });

  it("snapshot lama (tanpa pecahan) mengembalikan KOSONG, bukan tiga kelompok berlabel pecahan", () => {
    const k = komposisiBiayaJenis({}, ringkas);
    assert.deepEqual(k, [], "pemanggil harus jatuh ke komposisiBiaya dan menyatakan rincian belum ada");
  });

  it("persen dihitung dari HPP + biaya, bukan dari salah satunya", () => {
    // omzet 10000 -> hpp 6000, biaya 2000, total 8000; admin 2000 = 25%.
    const k = komposisiBiayaJenis({ admin: 2000 }, ringkas);
    assert.equal(k[0].persen, 25);
  });
});

describe("seriHarian + biayaJenis", () => {
  it("membawa pecahan biaya per tanggal ke titik grafik", () => {
    const snap: SnapshotRinci[] = [{
      tanggal: "2026-10-01", omzet: 1000, hpp: 600, biaya: 200, pajak: 0, laba: 200, jml_order: 5,
      biayaJenis: { admin: 150, proses: 50 },
    }];
    const seri = seriHarian(snap, "2026-10-01", "2026-10-01");
    assert.deepEqual(seri[0]?.biayaJenis, { admin: 150, proses: 50 });
  });

  it("snapshot tanpa pecahan menghasilkan objek kosong, bukan undefined", () => {
    const snap: SnapshotRinci[] = [{
      tanggal: "2026-10-01", omzet: 1000, hpp: 600, biaya: 200, pajak: 0, laba: 200, jml_order: 5,
    }];
    const seri = seriHarian(snap, "2026-10-01", "2026-10-01");
    assert.deepEqual(seri[0]?.biayaJenis, {});
  });
});
