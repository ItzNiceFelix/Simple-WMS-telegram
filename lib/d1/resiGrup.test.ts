import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ambilResiGrup, hitungResiGrup, isiResiGrup } from "./resiGrup";

type Row = Record<string, unknown>;

function buatDb(orders: Row[]) {
  const grup: Row[] = [];
  const db = {
    prepare(sql: string) {
      const st = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...a: unknown[]) { st._args = a; return st; },
        async first(): Promise<unknown> {
          if (sql.includes("FROM resi_grup")) return grup.find((g) => g["no_resi"] === st._args[0]) ?? null;
          return null;
        },
        async all() {
          if (st._sql.includes("FROM orders")) return { results: orders.filter((o) => o["batch_import"] === st._args[0]) };
          return { results: [] };
        },
      };
      return st;
    },
    async batch(stmts: { _args: unknown[] }[]) {
      for (const s of stmts) {
        const a = s._args;
        const row = { no_resi: a[0], no_json: a[1], jumlah_order: a[2], tipe_pesanan: a[3], jasa_kirim: a[4], tipe_layanan: a[5], cod: a[6], preorder: a[7], sesuai_kriteria: a[8], at: a[9] };
        const i = grup.findIndex((g) => g["no_resi"] === a[0]);
        if (i >= 0) grup[i] = row;
        else grup.push(row);
      }
      return [];
    },
  };
  return { db: db as unknown as D1Database, grup };
}

describe("hitungResiGrup", () => {
  it("resi tunggal tetap ditulis dengan jumlah_order 1", () => {
    const g = hitungResiGrup([{ no_resi: "R1", no_pesanan: "A", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0 }]);
    assert.equal(g.length, 1);
    assert.equal(g[0].jumlah_order, 1);
    assert.equal(g[0].tipe_pesanan, "tunggal");
    assert.equal(g[0].no_json, '["A"]');
  });

  it("resi >1 order → gabungan, no_json urut naik", () => {
    const g = hitungResiGrup([
      { no_resi: "R1", no_pesanan: "B", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0 },
      { no_resi: "R1", no_pesanan: "A", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0 },
    ]);
    assert.equal(g[0].jumlah_order, 2);
    assert.equal(g[0].tipe_pesanan, "gabungan");
    assert.equal(g[0].no_json, '["A","B"]');
    assert.equal(g[0].sesuai_kriteria, 1);
  });

  it("gabungan beda jasa kirim / COD / pre-order → sesuai_kriteria 0", () => {
    const bedaJasa = hitungResiGrup([
      { no_resi: "R1", no_pesanan: "A", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0 },
      { no_resi: "R1", no_pesanan: "B", jasa_kirim: "JNE", tipe_layanan: "Hemat", cod: 0, preorder: 0 },
    ]);
    assert.equal(bedaJasa[0].sesuai_kriteria, 0);
    const cod = hitungResiGrup([
      { no_resi: "R2", no_pesanan: "A", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 1, preorder: 0 },
      { no_resi: "R2", no_pesanan: "B", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0 },
    ]);
    assert.equal(cod[0].cod, 1);
    assert.equal(cod[0].sesuai_kriteria, 0);
  });

  it("resi kosong dilewati", () => {
    assert.equal(hitungResiGrup([{ no_resi: "", no_pesanan: "A", jasa_kirim: "", tipe_layanan: "", cod: 0, preorder: 0 }]).length, 0);
  });

  it("No. Pesanan ganda pada resi sama tidak dihitung dua kali", () => {
    const g = hitungResiGrup([
      { no_resi: "R1", no_pesanan: "A", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0 },
      { no_resi: "R1", no_pesanan: "A", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0 },
    ]);
    assert.equal(g[0].jumlah_order, 1);
    assert.equal(g[0].tipe_pesanan, "tunggal");
    assert.equal(g[0].no_json, '["A"]');
  });

  it("grup campur: jasa/layanan yang disimpan deterministik (tak bergantung urutan sumber)", () => {
    const a = hitungResiGrup([
      { no_resi: "R1", no_pesanan: "A", jasa_kirim: "JNE", tipe_layanan: "Reguler", cod: 0, preorder: 0 },
      { no_resi: "R1", no_pesanan: "B", jasa_kirim: "Anteraja", tipe_layanan: "Hemat", cod: 0, preorder: 0 },
    ]);
    const b = hitungResiGrup([
      { no_resi: "R1", no_pesanan: "B", jasa_kirim: "Anteraja", tipe_layanan: "Hemat", cod: 0, preorder: 0 },
      { no_resi: "R1", no_pesanan: "A", jasa_kirim: "JNE", tipe_layanan: "Reguler", cod: 0, preorder: 0 },
    ]);
    assert.deepEqual(a, b);
    assert.equal(a[0].jasa_kirim, "Anteraja");
    assert.equal(a[0].sesuai_kriteria, 0);
  });
});

describe("isiResiGrup / ambilResiGrup", () => {
  it("tulis ulang idempoten per batch", async () => {
    const { db, grup } = buatDb([
      { no_resi: "R1", no_pesanan: "A", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0, batch_import: 7 },
      { no_resi: "R1", no_pesanan: "B", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0, batch_import: 7 },
    ]);
    const n = await isiResiGrup(db, 7);
    assert.equal(n, 1);
    await isiResiGrup(db, 7);
    assert.equal(grup.length, 1);
    const ambil = await ambilResiGrup(db, "R1");
    assert.equal(ambil?.jumlah_order, 2);
    assert.equal(ambil?.tipe_pesanan, "gabungan");
  });

  it("batch lain tidak tercampur", async () => {
    const { db, grup } = buatDb([
      { no_resi: "R1", no_pesanan: "A", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0, batch_import: 7 },
      { no_resi: "R9", no_pesanan: "Z", jasa_kirim: "SPX", tipe_layanan: "Hemat", cod: 0, preorder: 0, batch_import: 8 },
    ]);
    await isiResiGrup(db, 7);
    assert.equal(grup.length, 1);
    assert.equal(grup[0]["no_resi"], "R1");
  });
});
