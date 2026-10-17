// lib/analisa/potongHarian.test.ts — uji potong-per-tanggal.
// Fixture memakai bentuk baris NYATA: kolom "Waktu Pesanan Dibuat" berisi "YYYY-MM-DD HH:MM".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { potongPerTanggal, rentangDariNamaBerkas, waktuBaris } from "./potongHarian";

const baris = (waktu: string, no: string) => ({ "Waktu Pesanan Dibuat": waktu, "No. Pesanan": no });

describe("waktuBaris", () => {
  it("membaca tanggal + jam, menolak kolom kosong", () => {
    assert.deepEqual(waktuBaris({ "Waktu Pesanan Dibuat": "2026-10-13 14:05" }), { tanggal: "2026-10-13", jam: 14 });
    assert.equal(waktuBaris({ "Waktu Pesanan Dibuat": "" }), null);
    assert.equal(waktuBaris({}), null);
  });
});

describe("potongPerTanggal", () => {
  it("memisahkan baris per tanggal pesanan, bukan per rentang file", () => {
    const h = potongPerTanggal([
      baris("2026-10-12 09:00", "A"),
      baris("2026-10-13 10:00", "B"),
      baris("2026-10-13 21:30", "C"),
    ]);
    assert.deepEqual(h.perTanggal.map((x) => [x.tanggal, x.baris.length]), [["2026-10-12", 1], ["2026-10-13", 2]]);
  });

  it("hari di tengah rentang PENUH; hari tepi parsial kecuali mencakup jam 00 dan 23", () => {
    const h = potongPerTanggal([
      baris("2026-10-13 15:00", "A"), // hari pertama, mulai siang -> parsial
      baris("2026-10-14 08:00", "B"), // tengah -> penuh
      baris("2026-10-14 20:00", "C"),
      baris("2026-10-15 11:00", "D"), // hari terakhir, berhenti siang -> parsial
    ]);
    assert.deepEqual(h.tanggalPenuh, ["2026-10-14"]);
    assert.deepEqual(h.tanggalParsial, ["2026-10-13", "2026-10-15"]);
  });

  it("file satu hari penuh bila jam 00 sampai 23 tercakup", () => {
    const h = potongPerTanggal([baris("2026-10-13 00:05", "A"), baris("2026-10-13 23:40", "B")]);
    assert.deepEqual(h.tanggalPenuh, ["2026-10-13"]);
    assert.deepEqual(h.tanggalParsial, []);
  });

  it("file satu hari yang berhenti tengah hari ditandai parsial", () => {
    const h = potongPerTanggal([baris("2026-10-13 09:00", "A"), baris("2026-10-13 12:00", "B")]);
    assert.deepEqual(h.tanggalPenuh, []);
    assert.deepEqual(h.tanggalParsial, ["2026-10-13"]);
  });

  it("baris di luar rentang berkas dibuang; baris tanpa tanggal dihitung terpisah", () => {
    const h = potongPerTanggal(
      [baris("2026-10-01 09:00", "LAMA"), baris("", "TANPA"), baris("2026-10-13 09:00", "A")],
      { dari: "2026-10-13", sampai: "2026-10-14" }
    );
    assert.deepEqual(h.perTanggal.map((x) => x.tanggal), ["2026-10-13"]);
    assert.equal(h.tanpaTanggal, 1);
  });
});

describe("rentangDariNamaBerkas", () => {
  it("membaca pola Shopee dan mengabaikan berkas tanpa pola", () => {
    assert.deepEqual(rentangDariNamaBerkas("Order.all.20261013_20261014.xlsx"), { dari: "2026-10-13", sampai: "2026-10-14" });
    assert.equal(rentangDariNamaBerkas("F1.xlsx"), null);
  });
});
