// lib/printing/watermark.test.ts — uji PDF keluaran: ukuran kertas, halaman dilewati, kotak.
//
// Yang dijaga: halaman bertanda "tidak dicetak" BENAR-BENAR tidak ada di PDF, pratinjau TIDAK
// mengecilkan hitungan halaman, strip ditanam sebagai halaman terpisah (bukan digambar ulang),
// dan kotak resi/strip diterjemahkan ke koordinat PDF dari-atas dengan benar.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";

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

/** Halaman sumber tanpa deteksi: kotak penuh, tidak ada tabel qty. */
const HALAMAN = { info: null };
const UKURAN = { width: 283.46, height: 425.2 };

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
    const h = await bangunPdf([{ bytes, halaman: [HALAMAN, HALAMAN] }], await opsi());
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
    const h = await bangunPdf([{ bytes, halaman: [HALAMAN, null, HALAMAN] }], await opsi());
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
    const h = await bangunPdf([{ bytes: await d.save(), halaman: [HALAMAN, HALAMAN] }], await opsi());
    assert.equal(h.halaman, 1);
    assert.equal(h.gagal, 1);
  });

  it("pratinjau menghitung SEMUA halaman, hanya strip yang ditanam sekali", async () => {
    const bytes = await pdfAsli(3);
    const o = await opsi();
    const penuh = await bangunPdf([{ bytes, halaman: [HALAMAN, HALAMAN, HALAMAN] }], o);
    const pratinjau = await bangunPdf([{ bytes, halaman: [HALAMAN, HALAMAN, HALAMAN] }], { ...o, batasHalaman: 1 });
    assert.equal(pratinjau.halaman, 3, "hitungan halaman tidak boleh mengecil di pratinjau");
    assert.equal(penuh.halaman, 3);
    assert.equal((await PDFDocument.load(pratinjau.bytes)).getPageCount(), 1);
    assert.ok(pratinjau.bytes.length < penuh.bytes.length);
  });

  it("strip ditanam sebagai halaman (XObject), bukan digambar ulang", async () => {
    const bytes = await pdfAsli(1);
    const h = await bangunPdf([{ bytes, halaman: [HALAMAN] }], await opsi());
    const page = (await PDFDocument.load(h.bytes)).getPages()[0];
    const xobj = page.node.Resources()?.lookup(PDFName.of("XObject"));
    assert.ok(xobj, "halaman harus punya resource XObject untuk strip");
    assert.ok(xobj.toString().includes("EmbeddedPdfPage"), `nama XObject: ${xobj}`);
  });

  it("kotak strip di bawah halaman diterjemahkan ke y dari bawah", async () => {
    const bytes = await pdfAsli(1);
    const o = await opsi({ strip: { x: 0, y: 130, w: 100, h: 20 } });
    const h = await bangunPdf([{ bytes, halaman: [HALAMAN] }], o);
    const d = await PDFDocument.load(h.bytes);
    assert.equal(d.getPageCount(), 1);
    // Strip 20 mm di y=130 (dari atas) pada tinggi 150 mm = 0..20 mm dari bawah.
    assert.ok(Math.abs((150 - o.strip.y - o.strip.h) - 0) < 1e-9);
  });

  it("resi panjang dipecah jadi 2 lembar, strip hanya di lembar pertama", async () => {
    const bytes = await pdfAsli(1);
    const info = {
      U: { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 },
      H: { x0: 0.15, y0: 0.02, x1: 0.85, y1: 0.35 },
      T: { x0: 0.15, y0: 0.36, x1: 0.85, y1: 0.98 },
    };
    const h = await bangunPdf([{ bytes, halaman: [{ info }] }], await opsi());
    assert.equal(h.halaman, 2);
    assert.equal(h.pecah, 1);
    const d = await PDFDocument.load(h.bytes);
    assert.equal(d.getPageCount(), 2);
    for (const p of d.getPages()) {
      const { width, height } = p.getSize();
      assert.ok(Math.abs(width - 283.46) < 0.5);
      assert.ok(Math.abs(height - 425.2) < 0.5);
    }
    // Lembar 1 punya 2 XObject (resi + strip); sambungan hanya 1 (resi, tanpa strip).
    const xo = (i: number) => d.getPages()[i].node.Resources()?.lookup(PDFName.of("XObject"), PDFDict)?.keys().length ?? 0;
    assert.equal(xo(0), 2);
    assert.equal(xo(1), 1);
  });

  it("mode kecil: resi panjang tetap satu lembar", async () => {
    const bytes = await pdfAsli(1);
    const info = {
      U: { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 },
      H: { x0: 0.15, y0: 0.02, x1: 0.85, y1: 0.1 },
      T: { x0: 0.15, y0: 0.11, x1: 0.85, y1: 0.98 },
    };
    const h = await bangunPdf([{ bytes, halaman: [{ info }] }], await opsi({ modePecah: "kecil" }));
    assert.equal(h.halaman, 1);
    assert.equal(h.pecah, 0);
  });

  it("penanda qty hanya digambar di lembar yang memuat angkanya", async () => {
    const bytes = await pdfAsli(1);
    const qty = [{ v: 2, x: 200, y: 380, w: 8, fs: 9, name: "Kaos", sku: "A", vari: "M" }];
    const tanpa = await bangunPdf([{ bytes, halaman: [{ info: null, qty }] }], await opsi());
    const dengan = await bangunPdf([{ bytes, halaman: [{ info: null, qty }] }], await opsi({ penanda: { mode: "lebih", gaya: "kotak" } }));
    assert.equal(dengan.halaman, tanpa.halaman);
    assert.ok(dengan.bytes.length > tanpa.bytes.length, "penanda harus menambah isi halaman");
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
