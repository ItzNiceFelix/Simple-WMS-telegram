// lib/printing/watermark.test.ts — uji PDF keluaran: ukuran kertas, halaman dilewati, tata letak.
//
// Yang dijaga: halaman yang ditandai "tidak dicetak" BENAR-BENAR tidak ada di PDF, pratinjau
// TIDAK mengecilkan hitungan halaman, dan pita bawah tidak pernah menimpa isi resi.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { bangunPdf, hitungTataLetak, type OpsiCetak } from "./watermark";

const MM = 72 / 25.4;

/** PDF uji: satu halaman 100×150 mm berisi teks. */
async function pdfAsli(jumlah = 1): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < jumlah; i++) {
    const p = d.addPage([283.46, 425.2]);
    p.drawText(`Resi ${i + 1}`, { x: 20, y: 300, size: 14, font: f });
  }
  return d.save();
}

const OPSI: OpsiCetak = {
  tinggiMm: 150,
  teks1: "FRAGILE",
  teks2: "VIDEO UNBOXING",
  teksBawah: "Tanpa video unboxing, komplain tidak diproses",
  ikonKiri: "gelas",
  ikonKanan: "kamera",
  stripMm: 20,
  cropBawahMm: 0,
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

  it("halaman tanpa isi (tanpa stream Contents) dilewati, sisa berkas tetap tercetak", async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const isi = d.addPage([283.46, 425.2]);
    isi.drawText("Resi", { x: 20, y: 300, size: 14, font: f });
    d.addPage([283.46, 425.2]); // benar-benar kosong: embedPage menolak ("missing Contents")
    const h = await bangunPdf([{ bytes: await d.save(), halaman: [UKURAN, UKURAN] }], OPSI);
    assert.equal(h.halaman, 1);
    assert.equal(h.gagal, 1);
  });

  it("semua halaman dilewati → PDF kosong, bukan error", async () => {
    const bytes = await pdfAsli(2);
    const h = await bangunPdf([{ bytes, halaman: [null, null] }], OPSI);
    assert.equal(h.halaman, 0);
    assert.equal(h.dilewati, 2);
  });

  it("pratinjau tetap menghitung SEMUA halaman, hanya pita yang digambar sekali", async () => {
    const bytes = await pdfAsli(3);
    const penuh = await bangunPdf([{ bytes, halaman: [UKURAN, UKURAN, UKURAN] }], OPSI);
    const pratinjau = await bangunPdf([{ bytes, halaman: [UKURAN, UKURAN, UKURAN] }], OPSI, true);
    assert.equal(pratinjau.halaman, 3);
    assert.equal(penuh.halaman, 3);
    assert.ok(pratinjau.bytes.length < penuh.bytes.length);
  });

  it("pita benar-benar digambar (output lebih besar dari tanpa pita)", async () => {
    const bytes = await pdfAsli(1);
    const tanpa = await bangunPdf([{ bytes, halaman: [UKURAN] }], { ...OPSI, stripMm: 0 });
    const dengan = await bangunPdf([{ bytes, halaman: [UKURAN] }], OPSI);
    assert.equal((await PDFDocument.load(tanpa.bytes)).getPageCount(), 1);
    assert.ok(dengan.bytes.length > tanpa.bytes.length);
  });
});

describe("hitungTataLetak", () => {
  const W = 100 * MM;
  const H = 150 * MM;
  const strip = 20 * MM;

  it("resi 100×150 mm tidak tertimpa pita: bawah resi tepat di atas band", () => {
    const t = hitungTataLetak({ width: W, height: H }, W, H, strip);
    assert.ok(Math.abs(t.skala - (H - strip) / H) < 1e-6);
    assert.ok(Math.abs(t.width - W * ((H - strip) / H)) < 1e-6, "lebar mengikuti skala");
    assert.ok(Math.abs(t.height - (H - strip)) < 1e-6, "tinggi = area di atas pita");
    assert.ok(t.y >= strip - 1e-6, `y ${t.y} tidak boleh masuk band`);
    assert.ok(t.y + t.height <= H + 1e-6, "tidak melewati tepi atas");
  });

  it("tanpa pita, resi memenuhi halaman 100×150", () => {
    const t = hitungTataLetak({ width: W, height: H }, W, H, 0);
    assert.ok(Math.abs(t.skala - 1) < 1e-6);
    assert.ok(Math.abs(t.y) < 1e-6);
    assert.ok(Math.abs(t.height - H) < 1e-6);
  });

  it("resi lebih pendek (100×120) tetap di tengah area isi, tidak masuk band", () => {
    const t = hitungTataLetak({ width: W, height: 120 * MM }, W, H, strip);
    assert.ok(Math.abs(t.skala - 1) < 1e-6, "tidak perlu diskalakan");
    assert.ok(t.y >= strip - 1e-6);
    assert.ok(Math.abs(t.y + t.height - (strip + (H - strip + 120 * MM) / 2)) < 1e-6);
  });
});
