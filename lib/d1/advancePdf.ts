// lib/d1/advancePdf.ts — Dokumen picklist Advance (A4, 1 baris = 1 booking SN).
// Pure: baris jadi → bytes PDF. Dipakai GET /api/advance?aksi=picklist-pdf.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type BarisAdvancePick = { booking_sn: string; sku: string; nama: string; variasi: string; qty: number; lokasi: string };

const LEBAR = 595.28; // A4 portrait
const TINGGI = 841.89;
const MARGIN = 40;
const JUDUL_FS = 16;
const ISI_FS = 10;
const BARIS_H = 20;
const LEBAR_TABEL = 515;
// 7 kolom: No | Booking SN | SKU | Nama Produk | Variasi | Qty | Lokasi | Cek
const KOLOM = [26, 100, 70, 150, 75, 34, 40, 20];
const HEADER = ["No", "Booking SN", "SKU", "Nama Produk", "Variasi", "Qty", "Bin", "Cek"];

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

/** Picklist Advance A4: satu baris per booking SN, kolom centang untuk picker. */
export async function bangunPdfAdvance(
  rows: BarisAdvancePick[],
  opsi: { gudang: string; batchImport: number | null },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const biasa = await doc.embedFont(StandardFonts.Helvetica);
  const tebal = await doc.embedFont(StandardFonts.HelveticaBold);

  const xKolom: number[] = [];
  let x = MARGIN;
  for (const w of KOLOM) {
    xKolom.push(x);
    x += w;
  }

  const totalUnit = rows.reduce((a, r) => a + r.qty, 0);
  let hal = doc.addPage([LEBAR, TINGGI]);
  let y = TINGGI - MARGIN;

  hal.drawText("PICKLIST ADVANCE", { x: MARGIN, y, size: JUDUL_FS, font: tebal });
  y -= 20;
  hal.drawText(`${opsi.gudang || "ONLINE"} — Dicetak ${waktuJakarta()}`, { x: MARGIN, y, size: ISI_FS, font: biasa });
  y -= 14;
  hal.drawText(`Batch ${opsi.batchImport == null ? "-" : `#${opsi.batchImport}`} — ${rows.length} booking — ${totalUnit} unit`, { x: MARGIN, y, size: ISI_FS, font: biasa });
  y -= 14;
  hal.drawText("Picker: ______________________     Tgl: ____________", { x: MARGIN, y, size: ISI_FS, font: biasa });
  y -= 26;

  const tulisHeader = (): void => {
    HEADER.forEach((h, i) => {
      const w = tebal.widthOfTextAtSize(h, ISI_FS);
      hal.drawText(h, { x: i >= 5 ? xKolom[i] + KOLOM[i] - w - 4 : xKolom[i] + 3, y, size: ISI_FS, font: tebal });
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
  rows.forEach((r, idx) => {
    if (y < MARGIN + BARIS_H * 3) halamanBaru();
    hal.drawText(String(idx + 1), { x: xKolom[0] + 3, y, size: ISI_FS, font: biasa });
    hal.drawText(potong(r.booking_sn, KOLOM[1] - 6, biasa), { x: xKolom[1] + 3, y, size: ISI_FS, font: biasa });
    hal.drawText(potong(r.sku, KOLOM[2] - 6, biasa), { x: xKolom[2] + 3, y, size: ISI_FS, font: biasa });
    hal.drawText(potong(r.nama, KOLOM[3] - 6, biasa), { x: xKolom[3] + 3, y, size: ISI_FS, font: biasa });
    hal.drawText(potong(r.variasi, KOLOM[4] - 6, biasa), { x: xKolom[4] + 3, y, size: ISI_FS, font: biasa });
    const q = String(r.qty);
    hal.drawText(q, { x: xKolom[5] + KOLOM[5] - tebal.widthOfTextAtSize(q, ISI_FS) - 4, y, size: ISI_FS, font: tebal });
    hal.drawText(potong(r.lokasi, KOLOM[6] - 6, biasa), { x: xKolom[6] + 3, y, size: ISI_FS, font: biasa });
    hal.drawRectangle({
      x: xKolom[7] + 4,
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
  hal.drawText("TOTAL", { x: xKolom[5] - 30, y, size: ISI_FS, font: tebal });
  const totalTeks = String(totalUnit);
  hal.drawText(totalTeks, { x: xKolom[5] + KOLOM[5] - tebal.widthOfTextAtSize(totalTeks, ISI_FS) - 4, y, size: ISI_FS, font: tebal });
  y -= 8;
  hal.drawText("Total unit __/__    TTD picker __________    Catatan selisih: ______________", { x: MARGIN, y, size: 9, font: biasa });
  hal.drawText(`Halaman ${doc.getPageCount()}`, { x: MARGIN, y: MARGIN - 16, size: 8, font: biasa });
  return doc.save();
}
