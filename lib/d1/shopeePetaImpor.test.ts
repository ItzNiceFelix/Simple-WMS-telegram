// lib/d1/shopeePetaImpor.test.ts — uji dedup baris peta sebelum upsert.
//
// Kenapa diuji: satu kode produk bisa punya banyak variasi dengan SKU yang SAMA. Upsert per
// (kode_produk, sku) tidak idempoten untuk kasus itu — D1 menjalankan pernyataan yang sama
// dua kali dan impor gagal (dilihat sebagai Error 1102 di produksi).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";

import { imporPerforma } from "./shopeePetaImpor";

/** DB tiruan: mencatat batch, dan MENOLAK pernyataan duplikat seperti UNIQUE nyata. */
function dbTiruan(skuMaster: string[]) {
  const dikirim: { sql: string; nilai: unknown[] }[] = [];
  const jalankan = (sql: string, nilai: unknown[]) => ({ sql, nilai });
  return {
    dikirim,
    prepare(sql: string) {
      let nilai: unknown[] = [];
      const stmt = {
        sql,
        bind(...v: unknown[]) { nilai = v; return stmt; },
        run: async () => ({ success: true }),
        first: async () => null,
        all: async () => ({ results: skuMaster.map((sku) => ({ sku })) }),
      };
      return stmt;
    },
    async batch(daftar: { sql: string; nilai: unknown[] }[]) {
      const kunci = new Set<string>();
      for (const p of daftar) {
        const k = `${p.sql}|${JSON.stringify(p.nilai)}`;
        if (kunci.has(k)) throw new Error("UNIQUE constraint failed");
        kunci.add(k);
        dikirim.push(p);
      }
      return daftar.map(() => ({ meta: { changes: 1 } }));
    },
  } as unknown as D1Database & { dikirim: { sql: string; nilai: unknown[] }[] };
}

const HEADER = [
  "Kode Produk", "Produk", "Kode Variasi", "Nama Variasi", "SKU Induk", "Kode Variasi",
  "Pesanan Dibuat", "Total Penjualan (Pesanan Dibuat)", "Jumlah Produk Dilihat", "Produk Diklik",
  "Pengunjung Produk (Kunjungan)", "Pengunjung Melihat Tanpa Membeli", "Dimasukkan ke Keranjang (Produk)",
];

/** Bangun workbook XLSX nyata dari baris-baris apa adanya. */
function xlsx(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("imporPerforma", () => {
  it("variasi dengan SKU sama dalam satu produk tidak membenturkan UNIQUE", async () => {
    const rows = [
      HEADER,
      ["P1", "Produk 1", "V1", "Merah", "IND-1", "001056", 2, 30000, 10, 1, 1, 0, 0],
      ["P1", "Produk 1", "V2", "Biru", "IND-1", "001056", 3, 45000, 12, 2, 1, 0, 0],
    ];
    const db = dbTiruan(["001056"]);
    const h = await imporPerforma(db, xlsx(rows), null, 2);
    assert.equal(h.ok, true);
    assert.equal(h.jumlahBaris, 2, "kedua baris tetap dilaporkan");
    // Hanya SATU baris peta yang dikirim untuk kunci (P1, 001056).
    const peta = db.dikirim.filter((p) => p.sql.includes("shopee_produk"));
    assert.equal(peta.length, 1, `dikirim ${peta.length} baris peta`);
  });

  it("impor ulang berkas yang sama idempoten", async () => {
    const rows = [
      HEADER,
      ["P1", "Produk 1", "V1", "Merah", "IND-1", "001056", 2, 30000, 10, 1, 1, 0, 0],
    ];
    const dbA = dbTiruan(["001056"]);
    const dbB = dbTiruan(["001056"]);
    const buf = xlsx(rows);
    await imporPerforma(dbA, buf.slice(0), null, 2);
    await imporPerforma(dbB, buf.slice(0), null, 2);
    assert.equal(dbA.dikirim.length, dbB.dikirim.length);
  });
});
