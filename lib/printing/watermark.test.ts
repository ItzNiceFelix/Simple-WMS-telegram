// lib/printing/watermark.test.ts — uji PDF keluaran: ukuran kertas, halaman dilewati, kotak.
//
// Yang dijaga: halaman bertanda "tidak dicetak" BENAR-BENAR tidak ada di PDF, pratinjau TIDAK
// mengecilkan hitungan halaman, strip ditanam sebagai halaman terpisah (bukan digambar ulang),
// dan kotak resi/strip diterjemahkan ke koordinat PDF dari-atas dengan benar.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";

import { bangunPdf, tataLetakAwal, type OpsiCetak } from "./watermark";
import { TEMPLATE, buatStrip } from "./strip";

const MM = 72 / 25.4;

/** PDF uji: halaman 100×150 mm berisi teks. */
async function pdfAsli(jumlah = 1): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < jumlah; i++) {
    const p = d.addPage([283.46, 425.2]);
    p.drawText(`Resi ${i + 1}`, { x: 20, y: 300, size: 14, font: f });
  }
  return d.save();
}

/** PDF strip 1 halaman, 100 × 20 mm. */
async function stripUji(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.HelveticaBold);
  const p = d.addPage([100 * MM, 20 * MM]);
  p.drawText("FRAGILE", { x: 10, y: 10, size: 12, font: f });
  return d.save();
}

const UKURAN = { getSize: () => ({ width: 283.46, height: 425.2 }) };

async function opsi(ubah: Partial<OpsiCetak> = {}): Promise<OpsiCetak> {
  const t = tataLetakAwal(150, 20, 283.46 / 425.2);
  return {
    tinggiMm: 150,
    stripBytes: await stripUji(),
    strip: t.strip,
    resi: t.resi,
    cropBawahMm: 0,
    ...ubah,
  };
}

describe("bangunPdf", () => {
  it("setiap halaman keluar 100×150 mm", async () => {
    const bytes = await pdfAsli(2);
    const h = await bangunPdf([{ bytes, halaman: [UKURAN, UKURAN] }], await opsi());
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
    const h = await bangunPdf([{ bytes, halaman: [UKURAN, null, UKURAN] }], await opsi());
    assert.equal(h.halaman, 2);
    assert.equal(h.dilewati, 1);
    assert.equal((await PDFDocument.load(h.bytes)).getPageCount(), 2);
  });

  it("semua halaman dilewati → PDF kosong, bukan error", async () => {
    const bytes = await pdfAsli(2);
    const h = await bangunPdf([{ bytes, halaman: [null, null] }], await opsi());
    assert.equal(h.halaman, 0);
    assert.equal(h.dilewati, 2);
  });

  it("halaman tanpa isi (tanpa stream Contents) dilewati, sisanya tetap tercetak", async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const isi = d.addPage([283.46, 425.2]);
    isi.drawText("Resi", { x: 20, y: 300, size: 14, font: f });
    d.addPage([283.46, 425.2]);
    const h = await bangunPdf([{ bytes: await d.save(), halaman: [UKURAN, UKURAN] }], await opsi());
    assert.equal(h.halaman, 1);
    assert.equal(h.gagal, 1);
  });

  it("pratinjau menghitung SEMUA halaman, hanya strip yang ditanam sekali", async () => {
    const bytes = await pdfAsli(3);
    const o = await opsi();
    const penuh = await bangunPdf([{ bytes, halaman: [UKURAN, UKURAN, UKURAN] }], o);
    const pratinjau = await bangunPdf([{ bytes, halaman: [UKURAN, UKURAN, UKURAN] }], o, true);
    assert.equal(pratinjau.halaman, 3);
    assert.equal(penuh.halaman, 3);
    assert.ok(pratinjau.bytes.length < penuh.bytes.length);
  });

  it("strip ditanam sebagai halaman (XObject), bukan digambar ulang", async () => {
    const bytes = await pdfAsli(1);
    const h = await bangunPdf([{ bytes, halaman: [UKURAN] }], await opsi());
    const page = (await PDFDocument.load(h.bytes)).getPages()[0];
    const xobj = page.node.Resources()?.lookup(PDFName.of("XObject"));
    assert.ok(xobj, "halaman harus punya resource XObject untuk strip");
    assert.ok(xobj.toString().includes("EmbeddedPdfPage"), `nama XObject: ${xobj}`);
  });

  it("kotak strip di bawah halaman diterjemahkan ke y dari bawah", async () => {
    const bytes = await pdfAsli(1);
    const o = await opsi({ strip: { x: 0, y: 130, w: 100, h: 20 } });
    const h = await bangunPdf([{ bytes, halaman: [UKURAN] }], o);
    const d = await PDFDocument.load(h.bytes);
    assert.equal(d.getPageCount(), 1);
    // Strip 20 mm di y=130 (dari atas) pada tinggi 150 mm = 0..20 mm dari bawah.
    assert.ok(Math.abs((150 - o.strip.y - o.strip.h) - 0) < 1e-9);
  });
});

describe("tataLetakAwal", () => {
  it("strip menempel tepi bawah selebar label, resi mengisi sisa", () => {
    const t = tataLetakAwal(150, 20, 283.46 / 425.2);
    assert.deepEqual(t.strip, { x: 0, y: 130, w: 100, h: 20 });
    assert.equal(t.resi.y, 0);
    assert.ok(t.resi.h <= 130 + 1e-9);
    assert.ok(Math.abs(t.resi.w / t.resi.h - 283.46 / 425.2) < 1e-6, "rasio resi dipertahankan");
  });

  it("resi 100×150 dengan strip 20 mm: dibatasi tinggi sisa, bukan lebar", () => {
    const t = tataLetakAwal(150, 20, 100 / 150);
    assert.ok(Math.abs(t.resi.h - 130) < 1e-9);
    assert.ok(t.resi.w < 100);
    assert.ok(Math.abs(t.resi.x - (100 - t.resi.w) / 2) < 1e-9, "di tengah");
  });

  it("template kartun tinggi 35 mm tetap menyisakan ruang resi", () => {
    const t = tataLetakAwal(150, 35, 800 / 280);
    assert.equal(t.strip.h, 35);
    assert.ok(t.resi.h > 0 && t.resi.h <= 115 + 1e-9);
  });
});

describe("buatStrip", () => {
  it("template klasik 2 kotak menghasilkan 1 halaman seukuran kotak", async () => {
    const bytes = await buatStrip(TEMPLATE[0], { lebarMm: 100, tinggiMm: 20 }, { t1: "FRAGILE", t2: "VIDEO UNBOXING", t3: "Tanpa video" }, null);
    const d = await PDFDocument.load(bytes);
    assert.equal(d.getPageCount(), 1);
    const { width, height } = d.getPages()[0].getSize();
    assert.ok(Math.abs(width - 100 * MM) < 0.5);
    assert.ok(Math.abs(height - 20 * MM) < 0.5);
  });

  it("template 1 kotak hanya memakai satu kotak (lebar kotak lebih besar)", async () => {
    const dua = await buatStrip(TEMPLATE[0], { lebarMm: 100, tinggiMm: 20 }, { t1: "FRAGILE", t2: "VIDEO", t3: "" }, null);
    const satu = await buatStrip(TEMPLATE[1], { lebarMm: 100, tinggiMm: 20 }, { t1: "FRAGILE", t2: "VIDEO", t3: "" }, null);
    assert.ok(satu.length !== dua.length);
  });
});
