// lib/d1/picklistPaketPdf.ts — Picklist dalam bentuk "paket" (F18).
// per_paket: satu lembar per no_resi, daftar semua order di no_json, qty apa adanya (D4).
// gabung: satu tabel lintas paket (kolom No. Resi) untuk cetak hemat kertas.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PaketPicklist, PickRow } from "./picklist";

export type BarisPaket = PickRow & { variasi: string; no_resi: string };

const LEBAR = 595.28;
const TINGGI = 841.89;
const MARGIN = 40;
const ISI_FS = 10;
const JUDUL_FS = 15;
const BARIS_H = 20;
const LEBAR_TABEL = 515;
const KOLOM_PAKET = [26, 68, 230, 115, 40, 36];
const HEADER_PAKET = ["No", "SKU", "Nama Produk", "Variasi", "Qty", "Cek"];
const KOLOM_GABUNG = [30, 96, 66, 180, 90, 34, 19];
const HEADER_GABUNG = ["No", "No. Resi", "SKU", "Nama Produk", "Variasi", "Qty", "Cek"];

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

type OpsiPaket = { mode: "per_paket" | "gabung"; judul: string; subjudul: string; gudang: string };

/** Picklist paket: 1 lembar/no_resi (per_paket) atau 1 tabel gabung (gabung). */
export async function bangunPdfPicklistPaket(paket: PaketPicklist[] | BarisPaket[], opsi: OpsiPaket): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const biasa = await doc.embedFont(StandardFonts.Helvetica);
  const tebal = await doc.embedFont(StandardFonts.HelveticaBold);
  const potong = (t: string, maks: number, font: typeof biasa): string => {
    if (font.widthOfTextAtSize(t, ISI_FS) <= maks) return t;
    let s = t;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, ISI_FS) > maks) s = s.slice(0, -1);
    return `${s}…`;
  };

  if (opsi.mode === "gabung") {
    const rows = paket as BarisPaket[];
    const xKolom: number[] = [];
    let x = MARGIN;
    for (const w of KOLOM_GABUNG) {
      xKolom.push(x);
      x += w;
    }
    const totalUnit = rows.reduce((a, r) => a + r.qty, 0);
    let hal = doc.addPage([LEBAR, TINGGI]);
    let y = TINGGI - MARGIN;
    hal.drawText(opsi.judul, { x: MARGIN, y, size: JUDUL_FS, font: tebal });
    y -= 18;
    hal.drawText(`${opsi.gudang} — Dicetak ${waktuJakarta()}${opsi.subjudul ? ` — ${opsi.subjudul}` : ""}`, { x: MARGIN, y, size: ISI_FS, font: biasa });
    y -= 14;
    hal.drawText(`${rows.length} baris — ${totalUnit} unit     Picker: ______________________`, { x: MARGIN, y, size: ISI_FS, font: biasa });
    y -= 26;
    const tulisHeader = (): void => {
      HEADER_GABUNG.forEach((h, i) => {
        const w = tebal.widthOfTextAtSize(h, ISI_FS);
        hal.drawText(h, { x: i === 5 ? xKolom[i] + KOLOM_GABUNG[i] - w - 4 : xKolom[i] + 3, y, size: ISI_FS, font: tebal });
      });
      y -= 6;
      hal.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + LEBAR_TABEL, y }, thickness: 1 });
      y -= BARIS_H;
    };
    tulisHeader();
    rows.forEach((r, idx) => {
      if (y < MARGIN + BARIS_H * 3) {
        hal = doc.addPage([LEBAR, TINGGI]);
        y = TINGGI - MARGIN;
        tulisHeader();
      }
      const teks = [String(idx + 1), r.no_resi, r.sku, r.nama, r.variasi];
      teks.forEach((t, i) => hal.drawText(potong(t, KOLOM_GABUNG[i] - 6, biasa), { x: xKolom[i] + 3, y, size: ISI_FS, font: biasa }));
      const q = String(r.qty);
      hal.drawText(q, { x: xKolom[5] + KOLOM_GABUNG[5] - tebal.widthOfTextAtSize(q, ISI_FS) - 4, y, size: ISI_FS, font: tebal });
      hal.drawRectangle({ x: xKolom[6] + 4, y: y - 1, width: 11, height: 11, borderWidth: 0.8, borderColor: rgb(0.45, 0.45, 0.45) });
      y -= BARIS_H;
    });
    if (y < MARGIN + BARIS_H * 2) {
      hal = doc.addPage([LEBAR, TINGGI]);
      y = TINGGI - MARGIN;
    }
    hal.drawLine({ start: { x: MARGIN, y: y + 10 }, end: { x: MARGIN + LEBAR_TABEL, y: y + 10 }, thickness: 1 });
    hal.drawText("TOTAL", { x: xKolom[5] - 44, y, size: ISI_FS, font: tebal });
    hal.drawText(String(totalUnit), { x: xKolom[5] + KOLOM_GABUNG[5] - tebal.widthOfTextAtSize(String(totalUnit), ISI_FS) - 4, y, size: ISI_FS, font: tebal });
    hal.drawText(`Halaman ${doc.getPageCount()}`, { x: MARGIN, y: MARGIN - 16, size: 8, font: biasa });
    return doc.save();
  }

  const daftar = paket as PaketPicklist[];
  const xKolom: number[] = [];
  let x = MARGIN;
  for (const w of KOLOM_PAKET) {
    xKolom.push(x);
    x += w;
  }
  for (const p of daftar) {
    let hal = doc.addPage([LEBAR, TINGGI]);
    let y = TINGGI - MARGIN;
    hal.drawText(opsi.judul, { x: MARGIN, y, size: JUDUL_FS, font: tebal });
    y -= 18;
    hal.drawText(`No. Resi: ${p.no_resi}${p.jasa_kirim ? ` — ${p.jasa_kirim}` : ""}`, { x: MARGIN, y, size: ISI_FS, font: tebal });
    y -= 14;
    hal.drawText(`Order (${p.no_pesanan.length}): ${p.no_pesanan.join(", ")}`, { x: MARGIN, y, size: 9, font: biasa });
    y -= 14;
    hal.drawText(`${opsi.gudang} — Dicetak ${waktuJakarta()} — ${p.rows.length} SKU — ${p.units} unit`, { x: MARGIN, y, size: ISI_FS, font: biasa });
    y -= 14;
    hal.drawText("Picker: ______________________     Tgl: ____________", { x: MARGIN, y, size: ISI_FS, font: biasa });
    y -= 26;
    const tulisHeader = (): void => {
      HEADER_PAKET.forEach((h, i) => {
        const w = tebal.widthOfTextAtSize(h, ISI_FS);
        hal.drawText(h, { x: i === 4 ? xKolom[i] + KOLOM_PAKET[i] - w - 4 : xKolom[i] + 3, y, size: ISI_FS, font: tebal });
      });
      y -= 6;
      hal.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + LEBAR_TABEL, y }, thickness: 1 });
      y -= BARIS_H;
    };
    tulisHeader();
    p.rows.forEach((r, idx) => {
      if (y < MARGIN + BARIS_H * 3) {
        hal = doc.addPage([LEBAR, TINGGI]);
        y = TINGGI - MARGIN;
        tulisHeader();
      }
      hal.drawText(String(idx + 1), { x: xKolom[0] + 3, y, size: ISI_FS, font: biasa });
      hal.drawText(potong(r.sku, KOLOM_PAKET[1] - 6, biasa), { x: xKolom[1] + 3, y, size: ISI_FS, font: biasa });
      hal.drawText(potong(r.nama, KOLOM_PAKET[2] - 6, biasa), { x: xKolom[2] + 3, y, size: ISI_FS, font: biasa });
      hal.drawText(potong(r.variasi ?? "", KOLOM_PAKET[3] - 6, biasa), { x: xKolom[3] + 3, y, size: ISI_FS, font: biasa });
      const q = String(r.qty);
      hal.drawText(q, { x: xKolom[4] + KOLOM_PAKET[4] - tebal.widthOfTextAtSize(q, ISI_FS) - 4, y, size: ISI_FS, font: tebal });
      hal.drawRectangle({ x: xKolom[5] + 4, y: y - 1, width: 11, height: 11, borderWidth: 0.8, borderColor: rgb(0.45, 0.45, 0.45) });
      y -= BARIS_H;
    });
    if (y < MARGIN + BARIS_H * 2) {
      hal = doc.addPage([LEBAR, TINGGI]);
      y = TINGGI - MARGIN;
    }
    hal.drawLine({ start: { x: MARGIN, y: y + 10 }, end: { x: MARGIN + LEBAR_TABEL, y: y + 10 }, thickness: 1 });
    hal.drawText("TOTAL", { x: xKolom[4] - 30, y, size: ISI_FS, font: tebal });
    hal.drawText(String(p.units), { x: xKolom[4] + KOLOM_PAKET[4] - tebal.widthOfTextAtSize(String(p.units), ISI_FS) - 4, y, size: ISI_FS, font: tebal });
    y -= 8;
    hal.drawText("Total unit __/__    TTD picker __________    Catatan selisih: ______________", { x: MARGIN, y, size: 9, font: biasa });
  }
  return doc.save();
}
