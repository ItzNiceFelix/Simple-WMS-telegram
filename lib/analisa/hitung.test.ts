// Uji analisa cepat. Fixture = snapshot NYATA dari produksi (lib/analisa/fixture-snapshot.json).
// Memakai data nyata, bukan karangan: ini yang membuat uji menangkap kesalahan yang
// hanya muncul pada bentuk data sebenarnya.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analisaCepat, bangunBaris, buatRingkasan, median, roasImpas,
  urutSaranIklan, janganDiiklankan, AMBANG_MARGIN_TIPIS,
  type MasukanAnalisa,
} from "./hitung";
import type { BarisSku } from "./tipe";

type Fixture = {
  tanggal: string; jml_order: number; omzet: number; hpp: number;
  biaya: number; pajak: number; laba: number;
  rincian: {
    sku: string; nama: string | null; unit: number; hppSatuan: number;
    hargaJual: number; marginSatuan: number; marginPersen: number; kontribusi: number;
  }[];
};

async function muatFixture(): Promise<Fixture> {
  const mod: unknown = await import("./fixture-snapshot.json", { with: { type: "json" } });
  assert.ok(mod && typeof mod === "object" && "default" in mod);
  return mod.default as Fixture;
}

function masukan(fx: Fixture, ubah: Partial<MasukanAnalisa> = {}): MasukanAnalisa {
  return {
    presetId: 1,
    periode: fx.tanggal,
    snapshot: {
      jml_order: fx.jml_order, omzet: fx.omzet, hpp: fx.hpp,
      biaya: fx.biaya, pajak: fx.pajak, laba: fx.laba, rincian: fx.rincian,
    },
    hppMaster: new Map(),
    stok: null,
    biayaIklan: null,
    jmlSnapshot: 3,
    adaPerforma: false,
    ...ubah,
  };
}

describe("median", () => {
  it("ganjil: ambil tengah", () => assert.equal(median([3, 1, 2]), 2));
  it("genap: rata-rata dua tengah", () => assert.equal(median([4, 1, 3, 2]), 2.5));
  it("kosong: 0", () => assert.equal(median([]), 0));
  it("tidak mengubah masukan", () => {
    const a = [3, 1, 2];
    median(a);
    assert.deepEqual(a, [3, 1, 2]);
  });
});

describe("roasImpas", () => {
  it("hitung dari data nyata (Pisau Set 3in1: 10879 / 2310)", () => {
    // Angka dari rincian produksi: hargaJual 10879, marginSatuan 2310.
    assert.equal(roasImpas(10879, 2310), 4.71);
  });

  it("margin <= 0 tidak punya titik impas", () => {
    assert.equal(roasImpas(10000, 0), null, "margin nol");
    assert.equal(roasImpas(10000, -500), null, "rugi");
  });

  it("harga jual nol tidak punya titik impas", () => {
    assert.equal(roasImpas(0, 100), null);
  });

  it("margin sama dengan harga jual -> ROAS impas 1 (titik terbaik)", () => {
    assert.equal(roasImpas(10000, 10000), 1);
  });
});

describe("analisaCepat dengan snapshot NYATA", () => {
  it("ringkasan cocok dengan angka snapshot (tidak mengarang)", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx));
    assert.equal(h.ringkasan.omzet, fx.omzet, "omzet sama dengan snapshot");
    assert.equal(h.ringkasan.laba, fx.laba, "laba sama dengan snapshot");
    assert.equal(h.ringkasan.jmlSku, fx.rincian.length);
    assert.equal(h.ringkasan.jmlOrder, fx.jml_order);
  });

  it("margin persen dihitung dari laba/omzet, bukan dikarang", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx));
    const harap = Math.round((fx.laba / fx.omzet) * 1000) / 10;
    assert.equal(h.ringkasan.marginPersen, harap);
  });

  it("konsentrasi = porsi 10 SKU teratas dari total kontribusi", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx));
    const diurut = [...fx.rincian].sort((a, b) => b.kontribusi - a.kontribusi);
    const sepuluh = diurut.slice(0, 10).reduce((a, x) => a + x.kontribusi, 0);
    const total = fx.rincian.reduce((a, x) => a + x.kontribusi, 0);
    assert.equal(h.ringkasan.kontribusi10Teratas, sepuluh);
    assert.equal(h.ringkasan.persen10Teratas, Math.round((sepuluh / total) * 1000) / 10);
  });

  it("setiap temuan PUNYA angka pendukung (aturan mengikat)", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx));
    for (const t of h.temuan) {
      assert.ok(t.kode.length > 0, "kode temuan ada");
      assert.ok(t.judul.length > 0, `judul ada untuk ${t.kode}`);
      assert.ok(t.penjelasan.length > 0, `penjelasan ada untuk ${t.kode}`);
      assert.equal(typeof t.angka.nilai, "number", `angka.nilai numerik untuk ${t.kode}`);
      assert.ok(Number.isFinite(t.angka.nilai), `angka.nilai terhingga untuk ${t.kode}`);
      assert.ok(["rupiah", "jumlah", "persen", "rasio"].includes(t.angka.satuan));
    }
  });

  it("temuan konsentrasi muncul bila 10 SKU teratas >60%", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx));
    const t = h.temuan.find((x) => x.kode === "konsentrasi");
    if (h.ringkasan.persen10Teratas > 60) {
      assert.ok(t, "konsentrasi >60% harus memunculkan temuan");
      assert.ok(t.angka.jumlahTerkena === 10);
    } else {
      assert.equal(t, undefined, "di bawah ambang tidak boleh muncul");
    }
  });
});

describe("data yang tidak ada DISEBUT, bukan diabaikan", () => {
  it("biaya iklan null -> temuan iklan dan daftar kurang memuatnya", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx, { biayaIklan: null }));
    assert.ok(h.kurang.some((k) => /iklan/i.test(k)), "kurang menyebut iklan");
  });

  it("biaya iklan ADA -> tidak lagi disebut kurang", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx, { biayaIklan: 500000 }));
    assert.ok(!h.kurang.some((k) => /belum diimpor/i.test(k)), "iklan sudah ada");
  });

  it("snapshot < 2 -> tren disebut belum bisa dihitung", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx, { jmlSnapshot: 1 }));
    assert.ok(h.kurang.some((k) => /tren/i.test(k)));
  });

  it("stok tidak diambil -> disebut, dan temuan stok tidak dibuat", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx, { stok: null }));
    assert.ok(h.kurang.some((k) => /stok/i.test(k)));
    assert.ok(!h.temuan.some((t) => t.kode === "stok_tipis_penyumbang"));
    assert.ok(!h.temuan.some((t) => t.kode === "stok_mati"));
  });
});

describe("HPP basi (master lebih baru dari snapshot)", () => {
  it("HPP naik -> temuan muncul dengan dampak rupiah = selisih x unit", async () => {
    const fx = await muatFixture();
    const baris = fx.rincian.filter((r) => r.unit > 0).slice(0, 3);
    assert.ok(baris.length > 0, "butuh SKU berunit");
    // Naikkan HPP master 1000 dari snapshot untuk 3 SKU pertama.
    const hppMaster = new Map(baris.map((b) => [b.sku, b.hppSatuan + 1000]));
    const h = analisaCepat(masukan(fx, { hppMaster }));

    const t = h.temuan.find((x) => x.kode === "hpp_naik");
    assert.ok(t, "temuan hpp_naik muncul");
    const harap = baris.reduce((a, b) => a + 1000 * b.unit, 0);
    assert.equal(t.angka.nilai, harap, "dampak = selisih x unit");
    assert.equal(t.angka.jumlahTerkena, baris.length);
  });

  it("HPP sama -> tidak ada temuan hpp_naik", async () => {
    const fx = await muatFixture();
    const hppMaster = new Map(fx.rincian.map((r) => [r.sku, r.hppSatuan]));
    const h = analisaCepat(masukan(fx, { hppMaster }));
    assert.equal(h.temuan.find((x) => x.kode === "hpp_naik"), undefined);
  });

  it("HPP TURUN tidak dianggap basi (margin justru membaik)", async () => {
    const fx = await muatFixture();
    const r0 = fx.rincian[0];
    const hppMaster = new Map([[r0.sku, r0.hppSatuan - 500]]);
    const h = analisaCepat(masukan(fx, { hppMaster }));
    assert.equal(h.temuan.find((x) => x.kode === "hpp_naik"), undefined);
  });
});

describe("stok (bila tersedia)", () => {
  it("penyumbang laba berstok tipis terdeteksi", async () => {
    const fx = await muatFixture();
    const teratas = [...fx.rincian].sort((a, b) => b.kontribusi - a.kontribusi)[0];
    // Stok sangat sedikit dibanding unit terjual -> harus masuk temuan.
    const stok = new Map([[teratas.sku, 1]]);
    const h = analisaCepat(masukan(fx, { stok }));
    const t = h.temuan.find((x) => x.kode === "stok_tipis_penyumbang");
    assert.ok(t, "temuan stok tipis muncul");
    assert.ok(t.contohSku.some((s) => s.sku === teratas.sku));
  });

  it("stok menumpuk tanpa penjualan -> modal tertahan dihitung", async () => {
    const fx = await muatFixture();
    // SKU dengan unit 0 (tidak terjual) + stok 10.
    const takTerjual = fx.rincian.find((r) => r.unit === 0);
    if (!takTerjual) return; // fixture tidak punya; uji dilewati wajar
    const stok = new Map([[takTerjual.sku, 10]]);
    const h = analisaCepat(masukan(fx, { stok }));
    const t = h.temuan.find((x) => x.kode === "stok_mati");
    assert.ok(t, "temuan stok mati muncul");
    assert.equal(t.angka.nilai, 10 * takTerjual.hppSatuan);
  });
});

describe("saran iklan", () => {
  const barisUji: BarisSku[] = [
    { sku: "A", nama: "A", unit: 1, hppSatuan: 8000, hargaJual: 10000, marginSatuan: 2000, marginPersen: 20, kontribusi: 2000, roasImpas: 5, hppMaster: 8000, hppNaik: 0, stok: 5 },
    { sku: "B", nama: "B", unit: 1, hppSatuan: 9000, hargaJual: 10000, marginSatuan: 1000, marginPersen: 10, kontribusi: 1000, roasImpas: 10, hppMaster: 9000, hppNaik: 0, stok: 5 },
    { sku: "C", nama: "C", unit: 1, hppSatuan: 11000, hargaJual: 10000, marginSatuan: -1000, marginPersen: -10, kontribusi: -1000, roasImpas: null, hppMaster: 11000, hppNaik: 0, stok: 5 },
  ];

  it("diurutkan ROAS impas terendah = paling aman diiklankan", () => {
    const h = urutSaranIklan(barisUji);
    assert.deepEqual(h.map((b) => b.sku), ["A", "B"], "C tersingkir karena merugi");
  });

  it("margin <= 0 masuk daftar JANGAN diiklankan", () => {
    const h = janganDiiklankan(barisUji);
    assert.deepEqual(h.map((b) => b.sku), ["C"]);
  });
});

describe("bangunBaris", () => {
  it("hppNaik 0 bila SKU tidak ada di master", async () => {
    const fx = await muatFixture();
    const baris = bangunBaris(masukan(fx));
    assert.ok(baris.every((b) => b.hppMaster === null && b.hppNaik === 0));
  });

  it("stok null bila stok tidak diambil", async () => {
    const fx = await muatFixture();
    const baris = bangunBaris(masukan(fx));
    assert.ok(baris.every((b) => b.stok === null));
  });

  it("roasImpas null untuk SKU merugi di data nyata", async () => {
    const fx = await muatFixture();
    const baris = bangunBaris(masukan(fx));
    for (const b of baris) {
      if (b.marginSatuan <= 0) assert.equal(b.roasImpas, null, `${b.sku} merugi harus null`);
      else assert.ok(b.roasImpas !== null, `${b.sku} untung harus punya nilai`);
    }
  });
});

describe("buatRingkasan", () => {
  it("median margin memakai median, bukan rata-rata", async () => {
    const fx = await muatFixture();
    const baris = bangunBaris(masukan(fx));
    const h = buatRingkasan(masukan(fx), baris);
    assert.equal(h.marginPersenMedian, Math.round(median(baris.map((b) => b.marginPersen)) * 10) / 10);
  });
});
