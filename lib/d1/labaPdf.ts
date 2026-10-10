// lib/d1/labaPdf.ts — Laporan estimasi laba A4 (ringkas + rincian SKU + nama).
// Pure: snapshot jadi -> bytes PDF. Dipakai GET /api/laba?aksi=pdf.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type LabaPdfRincian = {
  sku: string; nama: string | null; unit: number; hppSatuan: number;
  hargaJual: number; marginSatuan: number; marginPersen: number; kontribusi: number;
};

export type LabaPdfData = {
  presetNama: string; statusToko: string; tanggal: string; file: string;
  jml_order: number; jml_baris: number; omzet: number; hpp: number;
  biaya: number; pajak: number; laba: number; margin: number;
  tolak: { no_pesanan: string; alasan: string }[];
  peringatan: string[];
  rincian: LabaPdfRincian[];
};

const LEBAR = 595.28;
const TINGGI = 841.89;
const MARGIN = 40;
const ISI_FS = 10;
const BARIS_H = 18;
const TABEL_W = 515;

function rupiah(n: number): string {
  return "Rp" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function waktuJakarta(d = new Date()): string {
  const t = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return `${t} WIB`;
}

/** Laporan laba A4: kartu agregat + rincian SKU + tolak + peringatan. */
export async function bangunPdfLaba(d: LabaPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const biasa = await doc.embedFont(StandardFonts.Helvetica);
  const tebal = await doc.embedFont(StandardFonts.HelveticaBold);
  let hal = doc.addPage([LEBAR, TINGGI]);
  let y = TINGGI - MARGIN;

  const judul = (t: string): void => {
    hal.drawText(t, { x: MARGIN, y, size: 16, font: tebal });
    y -= 22;
  };
  const baris = (t: string, bold = false): void => {
    if (y < MARGIN + 20) { hal = doc.addPage([LEBAR, TINGGI]); y = TINGGI - MARGIN; }
    hal.drawText(t, { x: MARGIN, y, size: ISI_FS, font: bold ? tebal : biasa });
    y -= 14;
  };
  const potong = (t: string, maks: number): string => {
    if (biasa.widthOfTextAtSize(t, ISI_FS) <= maks) return t;
    let s = t;
    while (s.length > 1 && biasa.widthOfTextAtSize(`${s}…`, ISI_FS) > maks) s = s.slice(0, -1);
    return `${s}…`;
  };

  judul(`Estimasi Laba — ${d.presetNama}`);
  baris(`${d.tanggal} · ${d.statusToko} · ${d.jml_order} order · ${d.jml_baris} baris · ${d.file || "tanpa file"}`);
  baris(`Dicetak ${waktuJakarta()}`);
  y -= 6;
  for (const [label, nilai] of [
    ["Omzet", d.omzet], ["HPP", d.hpp], ["Biaya", d.biaya],
    ["Estimasi PPh terbayarkan", d.pajak], ["Estimasi Laba", d.laba],
  ] as const) {
    baris(`${label}: ${rupiah(nilai)}`, label === "Estimasi Laba");
  }
  baris(`Margin: ${Math.round(d.margin * 10) / 10}%`);

  if (d.peringatan.length > 0) {
    y -= 4;
    baris("Peringatan hitung:", true);
    for (const w of d.peringatan) baris(`- ${potong(w, TABEL_W)}`);
  }

  // Rincian SKU
  y -= 4;
  baris("Rincian SKU Terjual (urut kontribusi):", true);
  const KOL = [30, 150, 40, 75, 85, 85, 50];
  const xK: number[] = [];
  let x = MARGIN;
  for (const w of KOL) { xK.push(x); x += w; }
  const tulisHeader = (): void => {
    ["No", "SKU / Nama", "Unit", "HPP", "Jual", "Margin", "Kontribusi"].forEach((h, i) => {
      hal.drawText(h, { x: xK[i] + 3, y, size: 9, font: tebal });
    });
    y -= 5;
    hal.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + TABEL_W, y }, thickness: 1, color: rgb(0.4, 0.4, 0.4) });
    y -= BARIS_H;
  };
  const halBaru = (): void => {
    hal = doc.addPage([LEBAR, TINGGI]);
    y = TINGGI - MARGIN;
    tulisHeader();
  };
  tulisHeader();
  d.rincian.forEach((r, idx) => {
    if (y < MARGIN + BARIS_H * 4) halBaru();
    hal.drawText(String(idx + 1), { x: xK[0] + 3, y, size: 9, font: biasa });
    hal.drawText(potong(r.sku, KOL[1] - 6), { x: xK[1] + 3, y, size: 9, font: biasa });
    hal.drawText(potong(r.nama ?? "—", KOL[1] - 6), { x: xK[1] + 3, y: y - 10, size: 8, font: biasa, color: rgb(0.35, 0.35, 0.35) });
    hal.drawText(String(r.unit), { x: xK[2] + 3, y, size: 9, font: biasa });
    hal.drawText(rupiah(r.hppSatuan), { x: xK[3] + 3, y, size: 8, font: biasa });
    hal.drawText(r.hargaJual > 0 ? rupiah(r.hargaJual) : "—", { x: xK[4] + 3, y, size: 8, font: biasa });
    hal.drawText(`${rupiah(r.marginSatuan)}`, { x: xK[5] + 3, y, size: 8, font: biasa });
    hal.drawText(rupiah(r.kontribusi), { x: xK[6] + 3, y, size: 8, font: tebal });
    y -= BARIS_H + 8;
  });

  if (d.tolak.length > 0) {
    if (y < MARGIN + 40) { hal = doc.addPage([LEBAR, TINGGI]); y = TINGGI - MARGIN; }
    y -= 4;
    baris(`Ditolak hitung (${d.tolak.length} order):`, true);
    for (const t of d.tolak.slice(0, 60)) baris(`- ${t.no_pesanan}: ${potong(t.alasan, TABEL_W - 20)}`);
    if (d.tolak.length > 60) baris(`… +${d.tolak.length - 60} lainnya`);
  }
  hal.drawText(`Halaman ${doc.getPageCount()}`, { x: MARGIN, y: MARGIN - 16, size: 8, font: biasa });
  return doc.save();
}
