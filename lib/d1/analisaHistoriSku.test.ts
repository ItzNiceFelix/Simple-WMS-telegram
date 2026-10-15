// Uji `historiPerSku` — pembaca histori penjualan harian per SKU dari `laba_snapshot`.
//
// Yang dijaga di sini (bug yang mudah terjadi):
//   1. `rincian_json` rusak pada SATU tanggal tidak boleh menghapus histori tanggal lain.
//   2. Urutan tanggal harus MENAIK — `estimasiIklan` mengambil hari terburuk/terbaik dari
//      urutan ini; urutan kacau tetap benar untuk min/max tapi salah untuk "hari pertama".
//   3. SKU tanpa penjualan di suatu tanggal TIDAK mendapat baris bernilai nol; nol akan
//      terbaca sebagai "hari terburuk" dan membuat estimasi terlalu pesimis.
//   4. `omzet` tersimpan dipakai apa adanya; hanya baris LAMA tanpa `omzet` (atau omzet
//      0/bukan angka) yang direkonstruksi `hargaJual × unit` — dan rekonstruksi itu tidak
//      boleh menghasilkan 0/NaN.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { historiPerSku } from "./analisa";

type Row = Record<string, unknown>;

/** Mock D1: melayani satu query `laba_snapshot` dan menegakkan ORDER BY tanggal ASC. */
function dbPalsu(rows: Row[]) {
  return {
    prepare(sql: string) {
      assert.match(sql, /FROM laba_snapshot/, "pembaca harus menyentuh tabel laba_snapshot");
      const st = {
        bind() {
          return st;
        },
        async all() {
          return {
            results: [...rows].sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal))),
          };
        },
      };
      return st;
    },
  } as unknown as D1Database;
}

/**
 * Satu baris rincian seperti ditulis importer laba.
 * `omzet` sengaja OPSIONAL: baris lama (pra-kolom omzet) tidak punya.
 */
function rincian(sku: string, unit: number, hargaJual: number, marginSatuan: number, omzet?: unknown) {
  const b: Record<string, unknown> = { sku, nama: null, unit, hppSatuan: hargaJual - marginSatuan, hargaJual, marginSatuan, marginPersen: 0, kontribusi: 0 };
  if (omzet !== undefined) b.omzet = omzet;
  return b;
}

describe("historiPerSku", () => {
  it("menggabungkan semua tanggal per SKU, urut tanggal menaik; baris lama tanpa omzet direkonstruksi hargaJual × unit", async () => {
    const db = dbPalsu([
      { tanggal: "2026-09-02", rincian_json: JSON.stringify([rincian("A", 2, 10000, 3000)]) },
      { tanggal: "2026-09-01", rincian_json: JSON.stringify([rincian("A", 1, 10000, 3000)]) },
    ]);
    const peta = await historiPerSku(db, 2);
    const hari = peta.get("A") ?? [];
    assert.deepEqual(hari.map((h) => h.tanggal), ["2026-09-01", "2026-09-02"]);
    assert.deepEqual(hari.map((h) => h.omzet), [10000, 20000]);
    assert.deepEqual(hari.map((h) => h.unit), [1, 2]);
    assert.equal(hari[0].marginSatuan, 3000);
    assert.equal(hari[0].hargaJual, 10000);
  });

  it("melewati tanggal dengan rincian_json rusak, tapi menyimpan tanggal yang sehat", async () => {
    const db = dbPalsu([
      { tanggal: "2026-09-01", rincian_json: "{bukan json" },
      { tanggal: "2026-09-02", rincian_json: JSON.stringify([rincian("A", 3, 5000, 1000)]) },
      { tanggal: "2026-09-03", rincian_json: null },
    ]);
    const peta = await historiPerSku(db, 2);
    assert.deepEqual((peta.get("A") ?? []).map((h) => h.tanggal), ["2026-09-02"]);
  });

  it("tidak membuat baris nol untuk SKU yang tidak terjual di suatu tanggal", async () => {
    const db = dbPalsu([
      { tanggal: "2026-09-01", rincian_json: JSON.stringify([rincian("A", 2, 10000, 3000)]) },
      { tanggal: "2026-09-02", rincian_json: JSON.stringify([rincian("A", 0, 10000, 3000), rincian("B", 1, 7000, 2000)]) },
    ]);
    const peta = await historiPerSku(db, 2);
    assert.deepEqual((peta.get("A") ?? []).map((h) => h.tanggal), ["2026-09-01"]);
    assert.deepEqual((peta.get("B") ?? []).map((h) => h.tanggal), ["2026-09-02"]);
  });

  it("mengabaikan baris dengan SKU kosong atau angka bukan bilangan", async () => {
    const db = dbPalsu([
      {
        tanggal: "2026-09-01",
        rincian_json: JSON.stringify([
          rincian("", 1, 10000, 3000),
          { sku: "C", unit: "banyak", hargaJual: 1000, marginSatuan: 100 },
          rincian("D", 4, 2500, 500),
        ]),
      },
    ]);
    const peta = await historiPerSku(db, 2);
    assert.equal(peta.has(""), false);
    assert.equal(peta.has("C"), false);
    assert.deepEqual((peta.get("D") ?? []).map((h) => h.omzet), [10000]);
  });

  it("omzet tersimpan dipakai apa adanya, BUKAN hargaJual × unit", async () => {
    // hargaJual dibulatkan per unit, jadi 10000 × 2 = 20000 bukan omzet sebenarnya.
    const db = dbPalsu([
      { tanggal: "2026-09-01", rincian_json: JSON.stringify([rincian("A", 2, 10000, 3000, 19911)]) },
    ]);
    const peta = await historiPerSku(db, 2);
    const hari = peta.get("A") ?? [];
    assert.equal(hari.length, 1);
    assert.equal(hari[0].omzet, 19911);
    assert.equal(hari[0].unit, 2);
    assert.equal(hari[0].hargaJual, 10000);
  });

  it("campuran: baris punya omzet dipakai omzet, baris lama tetap fallback", async () => {
    const db = dbPalsu([
      {
        tanggal: "2026-09-01",
        rincian_json: JSON.stringify([
          rincian("A", 2, 10000, 3000, 19911),
          rincian("B", 3, 5000, 1000), // lama: tanpa omzet → 15000
        ]),
      },
    ]);
    const peta = await historiPerSku(db, 2);
    assert.deepEqual((peta.get("A") ?? []).map((h) => h.omzet), [19911]);
    assert.deepEqual((peta.get("B") ?? []).map((h) => h.omzet), [15000]);
  });

  it("omzet 0 atau bukan angka → fallback hargaJual × unit (bukan 0/NaN)", async () => {
    const db = dbPalsu([
      {
        tanggal: "2026-09-01",
        rincian_json: JSON.stringify([
          rincian("A", 2, 10000, 3000, 0),
          rincian("B", 3, 5000, 1000, "banyak"),
          rincian("C", 4, 2500, 500, null),
          rincian("D", 5, 1000, 100, NaN),
        ]),
      },
    ]);
    const peta = await historiPerSku(db, 2);
    assert.deepEqual((peta.get("A") ?? []).map((h) => h.omzet), [20000]);
    assert.deepEqual((peta.get("B") ?? []).map((h) => h.omzet), [15000]);
    assert.deepEqual((peta.get("C") ?? []).map((h) => h.omzet), [10000]);
    assert.deepEqual((peta.get("D") ?? []).map((h) => h.omzet), [5000]);
  });
});
