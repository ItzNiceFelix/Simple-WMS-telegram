// lib/d1/permintaanPdf.ts — Surat permintaan stok A4 (gudang ONLINE).
// Pure: data jadi → bytes PDF. Dipakai POST /api/permintaan-gudang {aksi:"pdf"}.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type BarisPermintaanPdf = { nama: string; sku: string; qty: number };

export type DataPermintaanPdf = {
  id: string;
  asal: string;
  pembuat: string;
  baris: BarisPermintaanPdf[];
};

const LEBAR = 595.28; // A4 portrait
const TINGGI = 841.89;
const MARGIN = 40;
const JUDUL_FS = 16;
const ISI_FS = 10;
const BARIS_H = 20;
const LEBAR_TABEL = 515;
const KOLOM = [34, 250, 133, 62, 36];
const HEADER = ["No", "Nama Produk", "SKU", "Qty", "Cek"];

/** Timestamp zona Jakarta: 09 Okt 2026, 14.35 WIB. */
function waktuJakarta(d = new Date()): string {
  const t = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${t} WIB`;
}

/** Surat permintaan stok A4: satu tabel, kolom centang checker, dua tanda tangan di kaki. */
export async function bangunPdfPermintaan(data: DataPermintaanPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const biasa = await doc.embedFont(StandardFonts.Helvetica);
  const tebal = await doc.embedFont(StandardFonts.HelveticaBold);

  const xKolom: number[] = [];
  let x = MARGIN;
  for (const w of KOLOM) {
    xKolom.push(x);
    x += w;
  }

  const totalUnit = data.baris.reduce((a, r) => a + r.qty, 0);
  let hal = doc.addPage([LEBAR, TINGGI]);
  let y = TINGGI - MARGIN;

  hal.drawText("SuPrapto Online", { x: MARGIN, y, size: JUDUL_FS, font: tebal });
  y -= 20;
  hal.drawText("PERMINTAAN STOK — GUDANG ONLINE", { x: MARGIN, y, size: ISI_FS, font: tebal });
  y -= 16;
  hal.drawText(`Gudang asal: ${data.asal || "-"}`, { x: MARGIN, y, size: ISI_FS, font: biasa });
  y -= 14;
  hal.drawText(`Pembuat: ${data.pembuat || "-"}`, { x: MARGIN, y, size: ISI_FS, font: biasa });
  y -= 14;
  hal.drawText(`Dicetak: ${waktuJakarta()}`, { x: MARGIN, y, size: ISI_FS, font: biasa });
  y -= 26;

  const tulisHeader = (): void => {
    HEADER.forEach((h, i) => {
      const w = tebal.widthOfTextAtSize(h, ISI_FS);
      hal.drawText(h, { x: i >= 3 ? xKolom[i] + KOLOM[i] - w - 6 : xKolom[i] + 4, y, size: ISI_FS, font: tebal });
    });
    y -= 6;
    hal.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + LEBAR_TABEL, y }, thickness: 1 });
    y -= BARIS_H;
  };

  const halamanBaru = (): void => {
    hal = doc.addPage([LEBAR, TINGGI]);
    y = TINGGI - MARGIN;
    tulisHeader();
  };

  const potong = (teks: string, maks: number, font: typeof biasa): string => {
    if (font.widthOfTextAtSize(teks, ISI_FS) <= maks) return teks;
    let t = teks;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, ISI_FS) > maks) t = t.slice(0, -1);
    return `${t}…`;
  };

  tulisHeader();
  data.baris.forEach((r, idx) => {
    if (y < MARGIN + BARIS_H * 3) halamanBaru();
    hal.drawText(String(idx + 1), { x: xKolom[0] + 4, y, size: ISI_FS, font: biasa });
    hal.drawText(potong(r.nama, KOLOM[1] - 8, biasa), { x: xKolom[1] + 4, y, size: ISI_FS, font: biasa });
    hal.drawText(potong(r.sku, KOLOM[2] - 8, biasa), { x: xKolom[2] + 4, y, size: ISI_FS, font: biasa });
    const q = String(r.qty);
    hal.drawText(q, { x: xKolom[3] + KOLOM[3] - tebal.widthOfTextAtSize(q, ISI_FS) - 6, y, size: ISI_FS, font: tebal });
    hal.drawRectangle({
      x: xKolom[4] + 8,
      y: y - 1,
      width: 11,
      height: 11,
      borderWidth: 0.8,
      borderColor: rgb(0.45, 0.45, 0.45),
    });
    y -= BARIS_H;
  });

  if (y < MARGIN + BARIS_H * 2) halamanBaru();
  hal.drawLine({ start: { x: MARGIN, y: y + 10 }, end: { x: MARGIN + LEBAR_TABEL, y: y + 10 }, thickness: 1 });
  hal.drawText("TOTAL", { x: xKolom[2] + 4, y, size: ISI_FS, font: tebal });
  const totalTeks = String(totalUnit);
  hal.drawText(totalTeks, { x: xKolom[3] + KOLOM[3] - tebal.widthOfTextAtSize(totalTeks, ISI_FS) - 6, y, size: ISI_FS, font: tebal });
  y -= 60;

  if (y < MARGIN + 80) halamanBaru();
  const kotakW = 200;
  const kotakPeran = ["Picker", "Checker"];
  kotakPeran.forEach((label, i) => {
    const kx = MARGIN + i * (kotakW + 40);
    hal.drawRectangle({ x: kx, y: y - 60, width: kotakW, height: 70, borderWidth: 0.8, borderColor: rgb(0.45, 0.45, 0.45) });
    hal.drawLine({ start: { x: kx + 16, y: y - 24 }, end: { x: kx + kotakW - 16, y: y - 24 }, thickness: 0.8 });
    hal.drawText(label, { x: kx + 16, y: y - 44, size: ISI_FS, font: tebal });
  });
  hal.drawText(`Halaman ${doc.getPageCount()}`, { x: MARGIN, y: MARGIN - 16, size: 8, font: biasa });
  return doc.save();
}
