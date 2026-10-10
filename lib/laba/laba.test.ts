// lib/laba/laba.test.ts — E1/E-R1/E-R2/E2/E-R3: resolver + hitung preset murni.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cocok, feePersen, feePlafonQty, pilihAturan, type Aturan } from "./aturanBiaya";
import { normalisasiPath, resolveTier, TIER_UNKNOWN } from "./kategori";
import { evaluasiSyarat } from "./syarat";
import { dasarBaris, hitungLabaPreset, type OpsiHitung } from "./hitungLabaPreset";

const A = (o: Partial<Aturan> = {}): Aturan => ({
  id: 1, jenis: "admin", kategori: "*", status_toko: null, basis: "persen",
  unit: "per_baris", nilai: 10, plafon: null, plafon_per_qty: null, priority: 0,
  valid_from: "2026-01-01", valid_to: null, aktif: 1, kode_program: null,
  ukuran: null, syarat_json: null, ...o,
});

describe("E1 pilihAturan", () => {
  it("kategori spesifik menang atas '*'", () => {
    const r = pilihAturan(
      [A({ id: 1, kategori: "*" }), A({ id: 2, kategori: "T10" })],
      { jenis: "admin", kategori: "T10", status_toko: "non_star", tanggal: "2026-06-01" }
    );
    assert.equal(r?.id, 2);
  });
  it("status_toko NULL berlaku semua; spesifik cocok status", () => {
    const r = pilihAturan(
      [A({ id: 1, status_toko: null }), A({ id: 2, status_toko: "star" })],
      { jenis: "admin", kategori: "*", status_toko: "star", tanggal: "2026-06-01" }
    );
    assert.equal(r?.id, 2);
    const r2 = pilihAturan(
      [A({ id: 1, status_toko: null }), A({ id: 2, status_toko: "star" })],
      { jenis: "admin", kategori: "*", status_toko: "non_star", tanggal: "2026-06-01" }
    );
    assert.equal(r2?.id, 1);
  });
  it("periode berlaku + priority + valid_from terbaru", () => {
    const r = pilihAturan(
      [
        A({ id: 1, kategori: "T10", priority: 0, valid_from: "2026-01-01" }),
        A({ id: 2, kategori: "T10", priority: 5, valid_from: "2026-01-01" }),
        A({ id: 3, kategori: "T10", priority: 5, valid_from: "2026-05-01" }),
      ],
      { jenis: "admin", kategori: "T10", status_toko: "non_star", tanggal: "2026-06-01" }
    );
    assert.equal(r?.id, 3);
    const kadaluarsa = pilihAturan(
      [A({ id: 1, kategori: "T10", valid_from: "2026-01-01", valid_to: "2026-01-31" })],
      { jenis: "admin", kategori: "T10", status_toko: "non_star", tanggal: "2026-06-01" }
    );
    assert.equal(kadaluarsa, null);
  });
  it("plafon per baris + plafon per qty", () => {
    assert.equal(feePersen(100000, 10, 4000), 4000);
    assert.equal(feePersen(100000, 10, null), 10000);
    assert.equal(feePlafonQty(1000000, 7.5, 40000, 1), 40000);
    assert.equal(feePlafonQty(100000, 7.5, 40000, 2), 7500);
  });
});

describe("E-R1 resolveTier", () => {
  const tabel = new Map([
    ["Perlengkapan Rumah > Peralatan Makan", "T10"],
    ["Perlengkapan Rumah", "T9"],
  ]);
  it("override menang", () => {
    assert.equal(resolveTier("X", "T6_5", tabel).tier, "T6_5");
  });
  it("path persis", () => {
    const r = resolveTier("Perlengkapan Rumah > Peralatan Makan", null, tabel);
    assert.equal(r.tier, "T10");
  });
  it("prefix induk terpanjang", () => {
    const r = resolveTier("Perlengkapan Rumah > Peralatan Makan > Piring", null, tabel);
    assert.equal(r.tier, "T10");
    assert.equal(r.pathCocok, "Perlengkapan Rumah > Peralatan Makan");
    const r2 = resolveTier("Perlengkapan Rumah > Taman", null, tabel);
    assert.equal(r2.tier, "T9");
  });
  it("belum terpetakan + kosong", () => {
    assert.equal(resolveTier("Kategori Aneh", null, tabel).tier, TIER_UNKNOWN);
    assert.equal(resolveTier("", null, tabel).tier, TIER_UNKNOWN);
    assert.equal(normalisasiPath("A  >  B "), "A > B");
  });
});

describe("E-R2 evaluasiSyarat", () => {
  const ctx = {
    iklanPersen: 3.5, pesananKumulatif: 100, bergabungSejak: "2026-03-01",
    uploadPertama: "2026-01-15", tanggal: "2026-06-01",
  };
  it("setiap kunci lolos", () => {
    assert.ok(evaluasiSyarat({ min_iklan_bersih_persen: 3 }, ctx).ok);
    assert.ok(evaluasiSyarat({ kuota_pesanan_gratis: 500 }, ctx).ok);
    assert.ok(evaluasiSyarat({ bergabung_sebelum: "2026-08-01" }, ctx).ok);
    assert.ok(evaluasiSyarat({ bergabung_antara: ["2026-01-01", "2026-06-30"] }, ctx).ok);
    assert.ok(evaluasiSyarat({ min_pesanan_terselesaikan: 50 }, ctx).ok);
    assert.ok(evaluasiSyarat({ atau_bulan_sejak_upload_pertama: 4 }, ctx).ok);
  });
  it("data kosong → tak dihitung + gagal syarat", () => {
    const kosong = { ...ctx, iklanPersen: null, pesananKumulatif: null, bergabungSejak: null, uploadPertama: null };
    const h = evaluasiSyarat({ min_iklan_bersih_persen: 3 }, kosong);
    assert.equal(h.ok, false);
    if (!h.ok) assert.match(h.alasan, /tidak dapat dihitung/);
    assert.equal(evaluasiSyarat({ kuota_pesanan_gratis: 500 }, { ...ctx, pesananKumulatif: 600 }).ok, false);
    assert.equal(evaluasiSyarat({ min_iklan_bersih_persen: 4 }, ctx).ok, false);
    assert.equal(evaluasiSyarat({ kunci_aneh: 1 }, ctx).ok, false);
  });
});

describe("E2/E-R3 hitungLabaPreset", () => {
  const baris = (o: Record<string, unknown> = {}) => ({
    "No. Pesanan": "X", "Status Pesanan": "Telah Dikirim",
    "Nomor Referensi SKU": "A", "SKU Induk": "",
    "Harga Awal": "18000", "Harga Setelah Diskon": "16000",
    Jumlah: "7", "Returned quantity": "0", "Subtotal Pesanan": "112000",
    "Diskon Dari Penjual": "14000", "Voucher Ditanggung Penjual": "0",
    "Paket Diskon (Diskon dari Penjual)": "0",
    ...o,
  });
  const skuDB: Record<string, { hpp: number; nama: string; kategori: string }> = {
    A: { hpp: 4000, nama: "Produk A", kategori: "Perlengkapan Rumah > Peralatan Makan" },
    B: { hpp: 10000, nama: "Produk B", kategori: "Perlengkapan Rumah > Peralatan Makan" },
  };
  const opsi = (rules: Aturan[]): OpsiHitung => ({
    preset: { id: 1, status_toko: "non_star" },
    tanggal: "2026-06-01",
    rules,
    tierAdmin: new Map([["T10", 10]]),
    kategoriTabel: new Map([["Perlengkapan Rumah > Peralatan Makan", "T10"]]),
    ambilSku: async (sku) => {
      const s = skuDB[sku];
      return s ? { hpp: s.hpp, nama: s.nama, kategori: s.kategori, tierOverride: null, preOrder: false, ukuranKhusus: false, goOverride: null } : null;
    },
    konteks: { iklanPersen: null, pesananKumulatif: null, bergabungSejak: null, uploadPertama: null },
  });

  it("dasar resmi: Harga Awal − diskon (bukan Subtotal + biaya file)", () => {
    const d = dasarBaris(baris());
    assert.equal(d.qty, 7);
    assert.equal(d.dasar, 112000); // 7 × 16000
  });

  it("Perlu Dikirim dihitung; Batal + Belum Bayar dibuang", async () => {
    const rows = [
      baris({ "No. Pesanan": "B1", "Status Pesanan": "Batal" }),
      baris({ "No. Pesanan": "B2", "Status Pesanan": "Belum Bayar" }),
      baris({ "No. Pesanan": "P1", "Status Pesanan": "Perlu Dikirim" }),
      baris({ "No. Pesanan": "OK", "Status Pesanan": "Sedang Dikirim" }),
    ];
    const a = await hitungLabaPreset(rows, opsi([]));
    assert.equal(a.jml_order, 2);
  });

  it("admin tier + proses per_order + pph configurable", async () => {
    const a = await hitungLabaPreset([baris()], opsi([
      A({ id: 1, jenis: "pajak_pph", kategori: "*", nilai: 0.5 }),
    ]));
    // dasar 112000, admin 10% = 11200, pph 0.5% = 560, hpp 28000
    assert.equal(a.omzet, 112000);
    assert.equal(a.hpp, 28000);
    assert.equal(a.biaya, 11200 + 560);
    assert.equal(a.pajak, 560);
    assert.equal(a.laba, 112000 - 28000 - 11200 - 560);
    assert.equal(a.rincian[0]?.nama, "Produk A");
    const tanpaPajak = await hitungLabaPreset([baris()], opsi([]));
    assert.equal(tanpaPajak.biaya, 11200);
    assert.equal(tanpaPajak.pajak, 0);
  });
  it("proses per_order sekali per order multi-item; retur parsial", async () => {
    const rows = [
      baris({ "No. Pesanan": "M", "Nomor Referensi SKU": "A", Jumlah: "1", "Harga Awal": "23547", "Harga Setelah Diskon": "23547", "Subtotal Pesanan": "23547", "Diskon Dari Penjual": "0" }),
      baris({ "No. Pesanan": "M", "Nomor Referensi SKU": "B", Jumlah: "2", "Harga Awal": "3499", "Harga Setelah Diskon": "3499", "Subtotal Pesanan": "6998", "Diskon Dari Penjual": "0" }),
      baris({ "No. Pesanan": "R", "Returned quantity": "1", Jumlah: "2", "Harga Awal": "10000", "Harga Setelah Diskon": "10000", "Subtotal Pesanan": "20000", "Diskon Dari Penjual": "0" }),
    ];
    const a = await hitungLabaPreset(rows, opsi([
      A({ id: 9, jenis: "proses", kategori: "*", basis: "flat", unit: "per_order", nilai: 1250 }),
    ]));
    assert.equal(a.jml_order, 2);
    assert.equal(a.jml_baris, 3);
    const m = a.rincian.find((r) => r.sku === "B");
    assert.equal(m?.unit, 2);
  });

  it("belum terpetakan: peringatan bukan tolak", async () => {
    const a = await hitungLabaPreset(
      [baris({ "No. Pesanan": "U" })],
      {
        ...opsi([]),
        ambilSku: async () => ({ hpp: 4000, nama: "Produk Aneh", kategori: "Kategori Aneh", tierOverride: null, preOrder: false, ukuranKhusus: false, goOverride: null }),
      }
    );
    assert.equal(a.jml_order, 1);
    assert.equal(a.jml_baris_belum_terpetakan, 1);
    assert.ok(a.peringatan.some((p) => p.includes("tanpa kategori")));
  });

  it("program GO plafon per qty + syarat gagal → peringatan", async () => {
    const go = A({
      id: 5, jenis: "program", kode_program: "gratis_ongkir_xtra", kategori: "D",
      nilai: 5.5, plafon_per_qty: 40000, syarat: undefined,
    });
    go.syarat_json = JSON.stringify({ min_iklan_bersih_persen: 3 });
    const a = await hitungLabaPreset([baris()], {
      ...opsi([go]),
      grupGo: new Map([["Perlengkapan Rumah > Peralatan Makan", "D"]]),
    });
    assert.ok(a.peringatan.some((p) => p.includes("tidak dapat dihitung")));
  });
  it("go_override menang atas grup kategori; ukuran biasa vs khusus eksklusif", async () => {
    const goD = (ukuran: string | null, nilai: number) => A({
      id: 6, jenis: "program", kode_program: "gratis_ongkir_xtra", kategori: "D",
      ukuran, nilai, plafon_per_qty: 40000,
    });
    const goH = A({
      id: 7, jenis: "program", kode_program: "gratis_ongkir_xtra", kategori: "H",
      ukuran: "khusus", nilai: 9.5, plafon_per_qty: 60000,
    });
    const o = (over: string | null, khusus: boolean) => ({
      ...opsi([goD("biasa", 5.5), goD("khusus", 7), goH]),
      grupGo: new Map([["Perlengkapan Rumah > Peralatan Makan", "D"]]),
      ambilSku: async () => ({ hpp: 4000, kategori: "Perlengkapan Rumah > Peralatan Makan", tierOverride: null, preOrder: false, ukuranKhusus: khusus, goOverride: over }),
    });
    const b = await hitungLabaPreset([baris()], o(null, false));
    assert.ok(b.biaya > 0 && b.peringatan.length === 0);
    const k = await hitungLabaPreset([baris()], o(null, true));
    assert.ok(k.biaya > b.biaya);
    const h = await hitungLabaPreset([baris()], o("H", true));
    assert.ok(h.biaya > k.biaya);
  });

  it("SKU tak cocok master → tolak seorder", async () => {
    const a = await hitungLabaPreset([baris({ "No. Pesanan": "Z", "Nomor Referensi SKU": "ZZZ" })], opsi([]));
    assert.equal(a.jml_order, 0);
    assert.equal(a.tolak.length, 1);
  });

  it("cocok tak aktif / jenis beda → null", () => {
    assert.equal(cocok(A({ aktif: 0 }), { jenis: "admin", kategori: "*", status_toko: "x", tanggal: "2026-01-01" }), false);
    assert.equal(
      pilihAturan([A({ jenis: "komisi" })], { jenis: "admin", kategori: "*", status_toko: "x", tanggal: "2026-01-01" }),
      null
    );
  });
});
