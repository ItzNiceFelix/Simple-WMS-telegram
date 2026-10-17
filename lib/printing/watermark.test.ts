// lib/printing/watermark.test.ts — uji PDF keluaran: ukuran kertas, halaman dilewati, ikon.
//
// Yang dijaga: halaman yang ditandai "tidak dicetak" BENAR-BENAR tidak ada di PDF, dan
// pratinjau TIDAK boleh mengecilkan hitungan halaman (dulu pratinjau hanya menyusun satu
// halaman sehingga "N halaman akan dicetak" melaporkan 1).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { bangunPdf, type OpsiCetak } from "./watermark";

/** PDF uji: satu halaman 100×150 mm berisi teks (halaman tanpa isi tidak bisa ditempel). */
async function pdfAsli(jumlah = 1): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < jumlah; i++) {
    const p = d.addPage([283.46, 425.2]);
    p.drawText(`Resi ${i + 1}`, { x: 20, y: 300, size: 14, font: f });
  }
  return d.save();
}

/** PNG 1×1 hitam — cukup untuk memastikan jalur embedPng berjalan. */
function pngHitam1px(): Uint8Array {
  const crc = (buf: Buffer): number => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (tipe: string, isi: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(isi.length);
    const td = Buffer.concat([Buffer.from(tipe), isi]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return new Uint8Array(png);
}

const OPSI: OpsiCetak = {
  tinggiMm: 150,
  posisi: "bawah",
  namaToko: "tokohanaa",
  opacity: 0.4,
  rotasi: 20,
  ikonMm: 14,
  jarakMm: 34,
  cropBawahMm: 0,
  geserXMm: 0,
  geserYMm: 0,
  ikon: null,
};

const UKURAN = { getSize: () => ({ width: 283.46, height: 425.2 }) };

describe("bangunPdf", () => {
  it("setiap halaman keluar 100×150 mm", async () => {
    const bytes = await pdfAsli(2);
    const h = await bangunPdf([{ bytes, halaman: [UKURAN, UKURAN] }], OPSI);
    const d = await PDFDocument.load(h.bytes);
    assert.equal(h.halaman, 2);
    for (const p of d.getPages()) {
      const { width, height } = p.getSize();
      assert.ok(Math.abs(width - 283.46) < 0.5, `lebar ${width}`);
      assert.ok(Math.abs(height - 425.2) < 0.5, `tinggi ${height}`);
    }
  });

  it("halaman bertanda null tidak ikut tercetak", async () => {
    const bytes = await pdfAsli(3);
    const h = await bangunPdf([{ bytes, halaman: [UKURAN, null, UKURAN] }], OPSI);
    const d = await PDFDocument.load(h.bytes);
    assert.equal(h.halaman, 2);
    assert.equal(h.dilewati, 1);
    assert.equal(d.getPageCount(), 2);
  });

  it("semua halaman dilewati → PDF kosong, bukan error", async () => {
    const bytes = await pdfAsli(2);
    const h = await bangunPdf([{ bytes, halaman: [null, null] }], OPSI);
    assert.equal(h.halaman, 0);
    assert.equal(h.dilewati, 2);
  });

  it("pratinjau tetap menghitung SEMUA halaman, hanya watermark yang digambar sekali", async () => {
    const bytes = await pdfAsli(3);
    const penuh = await bangunPdf([{ bytes, halaman: [UKURAN, UKURAN, UKURAN] }], OPSI);
    const pratinjau = await bangunPdf([{ bytes, halaman: [UKURAN, UKURAN, UKURAN] }], OPSI, true);
    assert.equal(pratinjau.halaman, 3);
    assert.equal(penuh.halaman, 3);
    // Watermark hanya sekali → PDF pratinjau harus lebih kecil dari versi cetak.
    assert.ok(pratinjau.bytes.length < penuh.bytes.length);
  });

  it("ikon benar-benar tertanam dan menambah isi PDF", async () => {
    const bytes = await pdfAsli(1);
    const tanpa = await bangunPdf([{ bytes, halaman: [UKURAN] }], OPSI);
    const dengan = await bangunPdf(
      [{ bytes, halaman: [UKURAN] }],
      { ...OPSI, ikon: { png: pngHitam1px(), rasio: 1 } }
    );
    assert.ok(dengan.bytes.length > tanpa.bytes.length);
  });

  it("posisi atas/bawah/tengah semuanya menghasilkan halaman sah", async () => {
    const bytes = await pdfAsli(1);
    for (const posisi of ["bawah", "atas", "tengah"] as const) {
      const h = await bangunPdf([{ bytes, halaman: [UKURAN] }], { ...OPSI, posisi });
      const d = await PDFDocument.load(h.bytes);
      assert.equal(d.getPageCount(), 1, posisi);
    }
  });
});
