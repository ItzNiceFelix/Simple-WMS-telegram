// lib/d1/rekapPdf.ts — Bangun PDF rekap laba (Fase 3a, Task 8).
// Pure: terima baris jadi → bytes PDF. Dipakai route GET /api/order?aksi=pdf.
// Diuji unit via esbuild (lib/ di-exclude tsconfig; ikut pola test:worker).
import { PDFDocument, StandardFonts } from "pdf-lib";

export type BarisRekapPdf = {
  no_pesanan: string; marketplace: string;
  omzet: number; hpp: number; biaya: number; pph: number; ppn: number; laba: number;
};
export type AgregatRekapPdf = {
  order: number; omzet: number; hpp: number; biaya: number; pph: number; ppn: number; laba: number;
};

const LEBAR = 595.28; // A4 portrait
const TINGGI = 841.89;
const MARGIN = 40;
const JUDUL_FS = 14;
const ISI_FS = 8.5;
const BARIS_H = 14;

// NoPesanan|MP|Omzet|HPP|Biaya|Pajak|Laba — jumlah = lebar pakai (515).
const KOLOM = [125, 70, 68, 62, 58, 58, 64];
const HEADER = ["NoPesanan", "MP", "Omzet", "HPP", "Biaya", "Pajak", "Laba"];

function rp(n: number): string {
  return Math.round(n).toLocaleString("id-ID");
}

/** Tabel rekap satu/lebih halaman + baris total. `catatan` = anotasi judul (mis. "porsi SKU X"). */
export async function bangunPdfRekap(baris: BarisRekapPdf[], agregat: AgregatRekapPdf, catatan?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const biasa = await doc.embedFont(StandardFonts.Helvetica);
  const tebal = await doc.embedFont(StandardFonts.HelveticaBold);
  const x0 = MARGIN;
  const xKolom: number[] = [];
  let x = x0;
  for (const w of KOLOM) { xKolom.push(x); x += w; }
  const kanan = (i: number) => xKolom[i] + KOLOM[i] - 4;

  let hal = doc.addPage([LEBAR, TINGGI]);
  let y = TINGGI - MARGIN;
  hal.drawText(catatan ? `Rekap Laba Pesanan (${catatan})` : "Rekap Laba Pesanan", { x: x0, y, size: JUDUL_FS, font: tebal });
  y -= 18;
  hal.drawText(`Dicetak ${new Date().toISOString().slice(0, 10)} — ${agregat.order} order`, { x: x0, y, size: ISI_FS, font: biasa });
  y -= 20;

  const tulisHeader = () => {
    HEADER.forEach((h, i) => {
      const t = h;
      const w = tebal.widthOfTextAtSize(t, ISI_FS);
      hal.drawText(t, { x: i < 2 ? xKolom[i] : kanan(i) - w, y, size: ISI_FS, font: tebal });
    });
    y -= 4;
    hal.drawLine({ start: { x: x0, y }, end: { x: x0 + 505, y }, thickness: 1 });
    y -= BARIS_H;
  };
  const butuhHal = () => {
    if (y > MARGIN + BARIS_H * 2) return;
    hal = doc.addPage([LEBAR, TINGGI]);
    y = TINGGI - MARGIN;
    tulisHeader();
  };
  const tulisNilai = (teks: string, i: number, font = biasa) => {
    const t = teks.length > 22 && i < 2 ? teks.slice(0, 21) + "…" : teks;
    const w = font.widthOfTextAtSize(t, ISI_FS);
    hal.drawText(t, { x: i < 2 ? xKolom[i] : kanan(i) - w, y, size: ISI_FS, font });
  };

  tulisHeader();
  for (const b of baris) {
    butuhHal();
    tulisNilai(b.no_pesanan, 0);
    tulisNilai(b.marketplace, 1);
    tulisNilai(rp(b.omzet), 2);
    tulisNilai(rp(b.hpp), 3);
    tulisNilai(rp(b.biaya), 4);
    tulisNilai(rp(b.pph + b.ppn), 5);
    tulisNilai(rp(b.laba), 6);
    y -= BARIS_H;
  }
  butuhHal();
  hal.drawLine({ start: { x: x0, y: y + 8 }, end: { x: x0 + 505, y: y + 8 }, thickness: 1 });
  tulisNilai("TOTAL", 0, tebal);
  tulisNilai(rp(agregat.omzet), 2, tebal);
  tulisNilai(rp(agregat.hpp), 3, tebal);
  tulisNilai(rp(agregat.biaya), 4, tebal);
  tulisNilai(rp(agregat.pph + agregat.ppn), 5, tebal);
  tulisNilai(rp(agregat.laba), 6, tebal);
  y -= BARIS_H + 10;
  hal.drawText(`Halaman ${doc.getPageCount()}`, { x: x0, y: MARGIN - 16, size: 8, font: biasa });
  return doc.save();
}
