// Uji `performaPerSku` — pembaca `performa_produk` yang selama ini hanya dihitung barisnya.
//
// Kenapa diuji dengan mock D1: bug yang dicegah di sini adalah bug yang SUDAH PERNAH terjadi
// di produksi — 264 baris tersimpan dengan `periode = ""` (importer `simpanPerforma(db, id, "",
// …)`), dan filter `periode = ?` yang ketat membuat pembacanya melihat nol baris. Mock di bawah
// meniru perilaku itu secara eksplisit supaya regresinya tertangkap tanpa database.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { performaPerSku } from "./analisa";

type Row = Record<string, unknown>;

/** Mock D1: hanya melayani satu query `performa_produk`, dan menegakkan ORDER BY at DESC. */
function dbPalsu(rows: Row[], gagal = false) {
  return {
    prepare(sql: string) {
      assert.match(sql, /FROM performa_produk/, "pembaca harus menyentuh tabel performa_produk");
      // Penjaga kontrak: JANGAN ada filter periode di SQL. Kalau seseorang menambahkannya
      // kelak, baris ber-periode "" hilang lagi dan uji ini gagal sebelum ke produksi.
      assert.ok(!/periode\s*=/.test(sql), "SQL tidak boleh menyaring periode (nilainya bisa '')");
      const st = {
        bind() {
          return st;
        },
        async all() {
          if (gagal) throw new Error("no such table: performa_produk");
          return { results: [...rows].sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0)) };
        },
      };
      return st;
    },
  } as unknown as D1Database;
}

function baris(sku: string, periode: string, nilai: Partial<Row> = {}): Row {
  return {
    sku, periode, dilihat: 100, klik: 5, kunjungan: 60, keranjang: 4, pesanan: 2,
    omzet: 200000, melihat_tanpa_beli: 58, at: 1000, ...nilai,
  };
}

describe("performaPerSku", () => {
  it("periode KOSONG tetap terbaca (bug lama: filter ketat -> kosong)", async () => {
    const db = dbPalsu([baris("A", ""), baris("B", "")]);
    const peta = await performaPerSku(db, 2, "2026-10-13");
    assert.equal(peta.size, 2, "dua SKU harus terbaca walau periode = ''");
    assert.equal(peta.get("A")?.kunjungan, 60);
    assert.equal(peta.get("A")?.pesanan, 2);
  });

  it("memetakan seluruh kolom termasuk tanpaBeli dan omzet", async () => {
    const db = dbPalsu([baris("A", "")]);
    const p = (await performaPerSku(db, 2, "x")).get("A");
    assert.deepEqual(p, {
      dilihat: 100, klik: 5, kunjungan: 60, keranjang: 4, pesanan: 2, omzet: 200000, tanpaBeli: 58,
    });
  });

  it("beberapa periode: yang terbaru (at terbesar) menang per SKU", async () => {
    const db = dbPalsu([
      baris("A", "", { at: 1000, kunjungan: 10 }),
      baris("A", "2026-09", { at: 5000, kunjungan: 999 }),
    ]);
    const peta = await performaPerSku(db, 2, "x");
    assert.equal(peta.size, 1, "satu SKU tidak boleh dihitung dua kali");
    assert.equal(peta.get("A")?.kunjungan, 999, "periode terbaru yang dipakai");
  });

  it("tabel gagal/kosong -> Map kosong, TIDAK melempar", async () => {
    assert.equal((await performaPerSku(dbPalsu([], true), 2, "x")).size, 0, "gagal tidak boleh melempar");
    assert.equal((await performaPerSku(dbPalsu([]), 2, "x")).size, 0);
  });

  it("SKU kosong dan baris rusak dilewati, bukan meracuni tabel", async () => {
    const db = dbPalsu([
      baris("", ""),
      baris("A", "", { omzet: Number.NaN }),
      baris("B", "", { kunjungan: 7, pesanan: 0 }),
    ]);
    const peta = await performaPerSku(db, 2, "x");
    assert.equal(peta.has(""), false, "SKU kosong dibuang");
    assert.equal(peta.has("A"), false, "baris NaN dibuang");
    assert.equal(peta.get("B")?.kunjungan, 7);
  });
});
