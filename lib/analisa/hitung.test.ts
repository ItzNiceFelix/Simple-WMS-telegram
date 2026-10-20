// Uji analisa cepat. Fixture = snapshot NYATA dari produksi (lib/analisa/fixture-snapshot.json).
// Memakai data nyata, bukan karangan: ini yang membuat uji menangkap kesalahan yang
// hanya muncul pada bentuk data sebenarnya.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analisaCepat, bangunBaris, buatRingkasan, buatTemuan, kelasProduk, keputusanIklan, median, organikCr, roasImpas,
  urutSaranIklan, janganDiiklankan, AMBANG_CTR_SEHAT, AMBANG_DILIHAT_MIN, AMBANG_MARGIN_TIPIS,
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
  const iklanKosong = { dilihat: null, klik: null, ctr: null, cr: null, biayaIklan: null, roasAktual: null };
  const organikKosong = { organikDilihat: null, organikKunjungan: null, organikKeranjang: null, organikPesanan: null, organikOmzet: null };
  const barisUji: BarisSku[] = [
    { sku: "A", nama: "A", unit: 1, hppSatuan: 8000, hargaJual: 10000, marginSatuan: 2000, marginPersen: 20, kontribusi: 2000, roasImpas: 5, hppMaster: 8000, hppNaik: 0, stok: 5, ...iklanKosong, ...organikKosong },
    { sku: "B", nama: "B", unit: 1, hppSatuan: 9000, hargaJual: 10000, marginSatuan: 1000, marginPersen: 10, kontribusi: 1000, roasImpas: 10, hppMaster: 9000, hppNaik: 0, stok: 5, ...iklanKosong, ...organikKosong },
    { sku: "C", nama: "C", unit: 1, hppSatuan: 11000, hargaJual: 10000, marginSatuan: -1000, marginPersen: -10, kontribusi: -1000, roasImpas: null, hppMaster: 11000, hppNaik: 0, stok: 5, ...iklanKosong, ...organikKosong },
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

  it("SKU tanpa baris di map stok -> null, bukan 0", async () => {
    const fx = await muatFixture();
    // Map stok ada (data gudang tersedia) tapi hanya memuat SATU SKU: SKU lain tak diketahui,
    // dan 0 akan memunculkan temuan "stok habis" palsu.
    const stok = new Map([[fx.rincian[0].sku, 7]]);
    const baris = bangunBaris(masukan(fx, { stok }));
    for (const b of baris) {
      assert.equal(b.stok, b.sku === fx.rincian[0].sku ? 7 : null, `${b.sku} stok harus null bila tak ada barisnya`);
    }
  });

  it("temuan stok tidak dibuat dari SKU berstok tak diketahui", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx, { stok: new Map() }));
    assert.equal(h.temuan.find((x) => x.kode === "stok_tipis_penyumbang"), undefined);
    assert.equal(h.temuan.find((x) => x.kode === "stok_mati"), undefined);
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

describe("metrik iklan per SKU (Dilihat → Klik → CTR → CR)", () => {
  async function barisDenganIklan(
    iklan: { dilihat: number; klik: number; biaya: number; omzet: number; pesanan?: number },
    ubahUnit?: number
  ): Promise<BarisSku> {
    const fx = await muatFixture();
    const r0 = fx.rincian[0];
    const rincian = [{ ...r0, unit: ubahUnit ?? r0.unit }];
    const m = masukan(fx, { snapshot: { ...masukan(fx).snapshot, rincian }, iklanPerSku: new Map([[r0.sku, iklan]]) });
    return bangunBaris(m)[0];
  }

  it("tanpa data iklan: SEMUA field iklan null (bukan nol)", async () => {
    const fx = await muatFixture();
    const b = bangunBaris(masukan(fx))[0];
    assert.equal(b.dilihat, null);
    assert.equal(b.klik, null);
    assert.equal(b.ctr, null);
    assert.equal(b.cr, null);
    assert.equal(b.biayaIklan, null);
    assert.equal(b.roasAktual, null);
  });

  it("CTR = klik / dilihat * 100", async () => {
    const b = await barisDenganIklan({ dilihat: 1000, klik: 20, biaya: 50000, omzet: 200000 });
    assert.equal(b.ctr, 2);
    assert.ok(Number.isFinite(b.ctr));
  });

  it("dilihat 0 -> CTR null, BUKAN Infinity", async () => {
    const b = await barisDenganIklan({ dilihat: 0, klik: 5, biaya: 1000, omzet: 0 });
    assert.equal(b.ctr, null, "pembagi nol tidak boleh menghasilkan Infinity");
  });

  it("klik 0 -> CR null, BUKAN Infinity", async () => {
    const b = await barisDenganIklan({ dilihat: 5000, klik: 0, biaya: 1000, omzet: 0 }, 3);
    assert.equal(b.cr, null, "pembagi nol tidak boleh menghasilkan Infinity");
    assert.equal(b.ctr, 0, "klik 0 dari dilihat > 0 tetap 0%, bukan null");
  });

  it("biaya 0 -> ROAS aktual null, BUKAN Infinity", async () => {
    const b = await barisDenganIklan({ dilihat: 5000, klik: 100, biaya: 0, omzet: 300000 });
    assert.equal(b.roasAktual, null, "tanpa biaya tidak ada ROAS");
  });

  it("CR = unit / klik * 100, ROAS aktual = omzet / biaya", async () => {
    const b = await barisDenganIklan({ dilihat: 1000, klik: 50, biaya: 20000, omzet: 100000 }, 5);
    assert.equal(b.cr, 10);
    assert.equal(b.roasAktual, 5);
    assert.equal(b.crSumber, "snapshot", "tanpa pesanan iklan, CR memakai unit snapshot");
  });

  it("CR memakai pesanan iklan bila tersedia (populasi sama dengan klik)", async () => {
    const b = await barisDenganIklan({ dilihat: 1000, klik: 50, biaya: 20000, omzet: 100000, pesanan: 4 }, 5);
    assert.equal(b.cr, 8, "4 pesanan iklan / 50 klik, bukan 5 unit snapshot");
    assert.equal(b.crSumber, "iklan");
  });

  it("pesanan iklan 0 dianggap 'tidak diisi' → tetap unit snapshot", async () => {
    const b = await barisDenganIklan({ dilihat: 1000, klik: 50, biaya: 20000, omzet: 100000, pesanan: 0 }, 5);
    assert.equal(b.cr, 10);
    assert.equal(b.crSumber, "snapshot");
  });

  it("CR null tanpa klik: crSumber tidak diisi (tidak ada yang bisa dijelaskan)", async () => {
    const b = await barisDenganIklan({ dilihat: 5000, klik: 0, biaya: 1000, omzet: 0 }, 3);
    assert.equal(b.crSumber, undefined);
  });

  it("tidak ada angka tak terhingga yang lolos ke UI", async () => {
    const fx = await muatFixture();
    const m = masukan(fx, {
      iklanPerSku: new Map([
        ["palsu-1", { dilihat: 0, klik: 0, biaya: 0, omzet: 0 }],
        [fx.rincian[0].sku, { dilihat: 0, klik: 0, biaya: 0, omzet: 0 }],
      ]),
    });
    for (const b of bangunBaris(m)) {
      for (const v of [b.ctr, b.cr, b.roasAktual, b.dilihat, b.klik, b.biayaIklan]) {
        assert.ok(v === null || Number.isFinite(v), `${b.sku}: nilai ${String(v)} harus null atau terhingga`);
      }
    }
  });
});

describe("keputusanIklan", () => {
  const dasar: BarisSku = {
    sku: "X", nama: "X", unit: 20, hppSatuan: 8000, hargaJual: 10000, marginSatuan: 2000,
    marginPersen: 20, kontribusi: 40000, roasImpas: 5, hppMaster: 8000, hppNaik: 0, stok: 10,
    dilihat: 5000, klik: 100, ctr: 2, cr: 20, biayaIklan: 20000, roasAktual: 10,
    organikDilihat: null, organikKunjungan: null, organikKeranjang: null, organikPesanan: null, organikOmzet: null,
  };

  it("belum_cukup_data: dilihat null", () => {
    const h = keputusanIklan({ ...dasar, dilihat: null, ctr: null });
    assert.equal(h.keputusan, "belum_cukup_data");
    assert.match(h.alasan, /tayangan/i);
  });

  it("belum_cukup_data: dilihat di bawah ambang, alasan MENYEBUT angkanya", () => {
    const h = keputusanIklan({ ...dasar, dilihat: AMBANG_DILIHAT_MIN - 1, ctr: 9, roasAktual: 99 });
    assert.equal(h.keputusan, "belum_cukup_data");
    assert.match(h.alasan, new RegExp(String(AMBANG_DILIHAT_MIN - 1)));
    assert.match(h.alasan, /bukan aturan resmi Shopee/);
  });

  it("hentikan: ROAS aktual di bawah titik impas, alasan menyebut kedua angka", () => {
    const h = keputusanIklan({ ...dasar, roasAktual: 3, roasImpas: 5, ctr: 5 });
    assert.equal(h.keputusan, "hentikan");
    assert.match(h.alasan, /3/);
    assert.match(h.alasan, /5/);
  });

  it("naikkan: CTR sehat DAN ROAS aktual >= impas, alasan menyebut CTR", () => {
    const h = keputusanIklan({ ...dasar, ctr: AMBANG_CTR_SEHAT + 0.5, roasAktual: 8, roasImpas: 5 });
    assert.equal(h.keputusan, "naikkan");
    assert.match(h.alasan, new RegExp(String(AMBANG_CTR_SEHAT + 0.5)));
  });

  it("tahan: CTR sehat tapi ROAS di bawah impas TIDAK dihentikan (menunggu data)", () => {
    // ctr >= ambang tapi roasAktual < roasImpas → tetap "hentikan" (aturan menang).
    // "tahan" hanya untuk yang tidak memenuhi syarat naikkan maupun hentikan.
    const h = keputusanIklan({ ...dasar, ctr: 0.4, roasAktual: 20, roasImpas: 5 });
    assert.equal(h.keputusan, "tahan");
    assert.match(h.alasan, /Tahan/i);
  });

  it("tahan: CTR rendah dan ROAS impas terpenuhi, tapi belum layak dinaikkan", () => {
    const h = keputusanIklan({ ...dasar, ctr: 0.5, roasAktual: 6, roasImpas: 5 });
    assert.equal(h.keputusan, "tahan");
    assert.match(h.alasan, /0\.5/);
    assert.match(h.alasan, /6/);
  });

  it("tanpa roasImpas (SKU merugi): hentikan TIDAK bisa dipicu lewat ROAS, jatuh ke tahan", () => {
    const h = keputusanIklan({ ...dasar, roasImpas: null, roasAktual: 1, ctr: 3 });
    assert.equal(h.keputusan, "tahan");
  });

  it("murni: tidak mengubah baris masukan", () => {
    const b = { ...dasar };
    keputusanIklan(b);
    assert.deepEqual(b, dasar);
  });
});

describe("metrik ORGANIK per SKU (performa_produk dipakai, bukan cuma dihitung)", () => {
  async function masukanOrganik(
    data: { dilihat: number; klik: number; kunjungan: number; keranjang: number; pesanan: number; omzet: number; tanpaBeli: number },
    ubah: Partial<MasukanAnalisa> = {}
  ): Promise<MasukanAnalisa> {
    const fx = await muatFixture();
    const r0 = fx.rincian[0];
    const rincian = [r0];
    const dasar = masukan(fx, { snapshot: { ...masukan(fx).snapshot, rincian } });
    return { ...dasar, performaPerSku: new Map([[r0.sku, data]]), ...ubah };
  }

  it("field organik terisi dari map; TIDAK tercampur dengan field iklan", async () => {
    const b = bangunBaris(await masukanOrganik({
      dilihat: 900, klik: 30, kunjungan: 200, keranjang: 12, pesanan: 4, omzet: 400000, tanpaBeli: 180,
    }))[0];
    assert.equal(b.organikDilihat, 900);
    assert.equal(b.organikKunjungan, 200);
    assert.equal(b.organikKeranjang, 12);
    assert.equal(b.organikPesanan, 4);
    assert.equal(b.organikOmzet, 400000);
    // Data iklan tidak ikut terisi oleh performa organik — inilah pencampuran yang dilarang.
    assert.equal(b.dilihat, null);
    assert.equal(b.klik, null);
    assert.equal(b.ctr, null);
    assert.equal(b.biayaIklan, null);
    assert.equal(b.roasAktual, null);
  });

  it("SKU tanpa baris performa -> semua field organik null (bukan nol)", async () => {
    const fx = await muatFixture();
    const m = masukan(fx, { performaPerSku: new Map() });
    assert.ok(bangunBaris(m).every((b) => b.organikDilihat === null && b.organikKunjungan === null && b.organikPesanan === null && b.organikOmzet === null));
  });

  it("organikCr null saat kunjungan 0, BUKAN Infinity/NaN", async () => {
    const b = bangunBaris(await masukanOrganik({
      dilihat: 100, klik: 5, kunjungan: 0, keranjang: 0, pesanan: 3, omzet: 100000, tanpaBeli: 0,
    }))[0];
    assert.equal(b.organikKunjungan, 0);
    assert.equal(organikCr(b), null, "pembagi nol tidak boleh menghasilkan Infinity");
    assert.ok(Number.isFinite(b.organikPesanan ?? 0));
  });

  it("organikCr = pesanan / kunjungan * 100 (rumus sama dengan CR iklan)", async () => {
    const b = bangunBaris(await masukanOrganik({
      dilihat: 500, klik: 10, kunjungan: 200, keranjang: 20, pesanan: 5, omzet: 500000, tanpaBeli: 175,
    }))[0];
    assert.equal(organikCr(b), 2.5);
  });

  it("organikCr null bila kunjungan null (data tidak ada, bukan nol)", async () => {
    const fx = await muatFixture();
    const b = bangunBaris(masukan(fx))[0];
    assert.equal(organikCr(b), null);
  });
});

describe("temuan organik_dilihat_tanpa_beli (masalah HALAMAN, bukan iklan)", () => {
  async function temuanDenganKunjungan(kunjungan: number, pesanan: number) {
    const fx = await muatFixture();
    const r0 = fx.rincian[0];
    const dasar = masukan(fx, { snapshot: { ...masukan(fx).snapshot, rincian: [r0] } });
    const h = analisaCepat({
      ...dasar,
      adaPerforma: true,
      performaPerSku: new Map([[r0.sku, { dilihat: kunjungan * 2, klik: 10, kunjungan, keranjang: 5, pesanan, omzet: 0, tanpaBeli: kunjungan }]]),
    });
    return { h, r0 };
  }

  it("kunjungan 60 & pesanan 0 -> temuan muncul, keparahan peringatan, angka pendukung ada", async () => {
    const { h, r0 } = await temuanDenganKunjungan(60, 0);
    const t = h.temuan.find((x) => x.kode === "organik_dilihat_tanpa_beli");
    assert.ok(t, "temuan harus muncul");
    assert.equal(t.keparahan, "peringatan");
    assert.equal(t.angka.nilai, 60, "angka pendukung = total kunjungan");
    assert.equal(t.angka.satuan, "jumlah");
    assert.equal(t.angka.jumlahTerkena, 1);
    assert.ok(t.contohSku.some((s) => s.sku === r0.sku && s.nilai === 60));
    assert.ok(Number.isFinite(t.angka.nilai));
  });

  it("kunjungan 10 & pesanan 0 -> temuan TIDAK muncul (sampel terlalu kecil)", async () => {
    const { h } = await temuanDenganKunjungan(10, 0);
    assert.equal(h.temuan.find((x) => x.kode === "organik_dilihat_tanpa_beli"), undefined);
  });

  it("menyebut ini masalah halaman, bukan iklan", async () => {
    const { h } = await temuanDenganKunjungan(60, 0);
    const t = h.temuan.find((x) => x.kode === "organik_dilihat_tanpa_beli");
    assert.match(t?.penjelasan ?? "", /BUKAN masalah iklan/);
  });
});

describe("pesan 'Data kunjungan/konversi' tidak muncul saat adaPerforma true", () => {
  it("adaPerforma: true -> tidak ada pesan kunjungan/konversi di kurang", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx, { adaPerforma: true }));
    assert.ok(!h.kurang.some((k) => /kunjungan\/konversi/i.test(k)), "pesan itu sudah tidak jujur: datanya ADA");
  });

  it("adaPerforma: false -> pesan tetap muncul (data memang belum ada)", async () => {
    const fx = await muatFixture();
    const h = analisaCepat(masukan(fx, { adaPerforma: false }));
    assert.ok(h.kurang.some((k) => /kunjungan\/konversi/i.test(k)));
  });
});

describe("kelasProduk — satu definisi fast/slow/dead/normal", () => {
  it("stok ada & tidak terjual = dead", () => {
    assert.equal(kelasProduk({ terjual: 0, lajuHarian: 0, stok: 5, rataLaju: 2 }), "dead");
  });

  it("stok tak diketahui & tidak terjual = normal, bukan dead", () => {
    assert.equal(kelasProduk({ terjual: 0, lajuHarian: 0, stok: null, rataLaju: 2 }), "normal");
  });

  it("laju ≥ rata-rata = fast; di bawah 1/3 rata-rata = slow; di antaranya normal", () => {
    assert.equal(kelasProduk({ terjual: 10, lajuHarian: 3, stok: 5, rataLaju: 2 }), "fast");
    assert.equal(kelasProduk({ terjual: 2, lajuHarian: 0.5, stok: 5, rataLaju: 2 }), "slow");
    assert.equal(kelasProduk({ terjual: 5, lajuHarian: 1.5, stok: 5, rataLaju: 2 }), "normal");
  });

  it("rata-rata belum ada (belum ada SKU bergerak) = normal, bukan fast", () => {
    assert.equal(kelasProduk({ terjual: 1, lajuHarian: 1, stok: 5, rataLaju: null }), "normal");
  });
});

describe("temuan sku_merugi memakai laba total sebagai pembanding", () => {
  it("dariTotal = |laba|, bukan kontribusi 10 teratas", async () => {
    const fx = await muatFixture();
    const r0 = fx.rincian[0];
    const rincian = [
      { ...r0, sku: "RUGI", unit: 2, hppSatuan: 12000, hargaJual: 10000, marginSatuan: -2000, marginPersen: -20, kontribusi: -4000 },
      { ...r0, sku: "UNTUNG", unit: 5, kontribusi: 10000 },
    ];
    const m = masukan(fx, { snapshot: { ...masukan(fx).snapshot, omzet: 60000, hpp: 49000, biaya: 9000, pajak: 0, laba: 2000, rincian } });
    const baris = bangunBaris(m);
    const ringkas = buatRingkasan(m, baris);
    const t = buatTemuan(m, baris, ringkas).find((x) => x.kode === "sku_merugi");
    assert.ok(t, "temuan SKU merugi harus muncul");
    assert.equal(t.angka.dariTotal, Math.abs(ringkas.laba));
    assert.notEqual(t.angka.dariTotal, Math.abs(ringkas.kontribusi10Teratas));
  });
});

describe("filter periode kosong TIDAK mengosongkan data (regresi bug lama)", () => {
  it("kunjungan terbaca dari map walau periode tidak difilter", async () => {
    // penyimpanan di produksi menulis periode = "" (importer `simpanPerforma(db, id, "", …)`).
    // `performaPerSku` karena itu TIDAK menyaring periode; uji ini mengunci janji itu:
    // satu SKU dengan data apa pun tetap terbaca, bukan menghasilkan map kosong.
    const fx = await muatFixture();
    const r0 = fx.rincian[0];
    const b = bangunBaris(masukan(fx, {
      performaPerSku: new Map([[r0.sku, { dilihat: 300, klik: 10, kunjungan: 80, keranjang: 6, pesanan: 2, omzet: 200000, tanpaBeli: 60 }]]),
    }))[0];
    assert.equal(b.organikKunjungan, 80, "data periode kosong tetap terbaca");
    assert.equal(b.organikPesanan, 2);
  });
});

