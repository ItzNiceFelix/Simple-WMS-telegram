// lib/printing/strip.ts — Bangun "strip" (pita peringatan) sebagai PDF 1 halaman. KLIEN saja.
//
// MEKANISME SAMA dengan alat referensi pemilik toko: strip disusun jadi PDF tersendiri
// selebar/tinggi kotak S, lalu ditanam (`embedPdf`) ke setiap halaman keluaran. Dua jenis:
//   - "klasik": kotak teks + ikon garis digambar vektor (1 atau 2 kotak)
//   - "kartun": template SVG dirender ke PNG lalu ditanam
import { PDFDocument, StandardFonts, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import { SVG_KARTUN } from "./templateKartun";

const MM = 72 / 25.4;

/** Nomor kotak pada strip klasik: 1 = FRAGILE (hitam), 2 = VIDEO UNBOXING (bergaris). */
export type NomorKotak = 1 | 2;

export type TemplateStrip = {
  nama: string;
  /** Kotak klasik yang dipakai. Kosong = template kartun. */
  kotak?: NomorKotak[];
  /** SVG kartun; dirender ke PNG. */
  svg?: string;
  /** Rasio lebar/tinggi template kartun. */
  rasio?: number;
  /** Tinggi strip awal (mm). */
  tinggiMm: number;
};

/** Template bawaan, urutan sama dengan alat referensi. */
export const TEMPLATE: TemplateStrip[] = [
  { nama: "Klasik: FRAGILE + VIDEO UNBOXING", kotak: [1, 2], tinggiMm: 20 },
  { nama: "Klasik: FRAGILE saja", kotak: [1], tinggiMm: 20 },
  { nama: "Klasik: VIDEO UNBOXING saja", kotak: [2], tinggiMm: 20 },
  { nama: "Kartun: Awas Pecah + Wajib Unboxing", svg: SVG_KARTUN, rasio: 800 / 280, tinggiMm: 35 },
];

export type TeksStrip = { t1: string; t2: string; t3: string };
export type LogoStrip = { png: Uint8Array; rasio: number };

/** Garis bantu: satu polyline diskalakan ke kotak ikon. */
function garis(p: PDFPage, x: number, y: number, s: number, titik: [number, number][], c: Color, t: number): void {
  for (let i = 0; i < titik.length - 1; i++) {
    p.drawLine({
      start: { x: x + titik[i][0] * s, y: y + titik[i][1] * s },
      end: { x: x + titik[i + 1][0] * s, y: y + titik[i + 1][1] * s },
      thickness: t,
      color: c,
    });
  }
}

function ikonGelas(p: PDFPage, x: number, y: number, s: number, c: Color): void {
  const t = 1.3;
  garis(p, x, y, s, [[0.1, 1], [0.9, 1], [0.5, 0.4], [0.1, 1]], c, t);
  garis(p, x, y, s, [[0.5, 0.4], [0.5, 0.08]], c, t);
  garis(p, x, y, s, [[0.22, 0.06], [0.78, 0.06]], c, t);
  garis(p, x, y, s, [[0.5, 1], [0.42, 0.82], [0.58, 0.66], [0.5, 0.5]], c, t);
}

function ikonKamera(p: PDFPage, x: number, y: number, s: number, c: Color): void {
  const t = 1.3;
  p.drawRectangle({ x, y: y + 0.15 * s, width: 0.68 * s, height: 0.7 * s, borderColor: c, borderWidth: t });
  garis(p, x, y, s, [[0.68, 0.5], [1, 0.8], [1, 0.2], [0.68, 0.5]], c, t);
  p.drawCircle({ x: x + 0.17 * s, y: y + 0.66 * s, size: 0.07 * s, color: c });
}

/** Kecilkan font sampai muat; berhenti di 4 pt. */
function ukuranMuat(teks: string, font: PDFFont, maks: number, mulai: number): number {
  let s = mulai;
  while (s > 4 && font.widthOfTextAtSize(teks, s) > maks) s -= 0.5;
  return s;
}

/** Satu kotak strip: latar hitam/putih, ikon garis, lalu teks. */
function kotak(
  p: PDFPage,
  x: number,
  y: number,
  bw: number,
  bh: number,
  teks: string,
  font: PDFFont,
  isiHitam: boolean,
  ikon: (p: PDFPage, x: number, y: number, s: number, c: Color) => void
): void {
  const K = rgb(0, 0, 0);
  const Wt = rgb(1, 1, 1);
  const c = isiHitam ? Wt : K;
  const pad = 1.8 * MM;
  p.drawRectangle({ x, y, width: bw, height: bh, color: isiHitam ? K : Wt, borderColor: K, borderWidth: 1.5 });
  const sz = bh * 0.7;
  ikon(p, x + pad, y + (bh - sz) / 2, sz, c);
  const tx = x + pad + sz * 1.1 + pad;
  const mw = x + bw - pad - tx;
  const s = ukuranMuat(teks, font, mw, bh * 0.5);
  p.drawText(teks, { x: tx, y: y + (bh - s * 0.72) / 2, size: s, font, color: c });
}

/** Strip klasik: kotak kiri hitam, kotak kanan bergaris, baris kecil di bawah. */
function stripKlasik(
  p: PDFPage,
  W: number,
  B: number,
  tebal: PDFFont,
  biasa: PDFFont,
  logo: PDFImage | null,
  rasioLogo: number,
  teks: TeksStrip,
  kotakDipakai: NomorKotak[]
): void {
  const pad = 1.5 * MM;
  const K = rgb(0, 0, 0);
  const rowY = 6 * MM;
  const bh = B - rowY - pad;
  const n = kotakDipakai.length;
  const bw = (W - (n + 1) * pad) / n;
  kotakDipakai.forEach((k, i) => {
    const x = pad + i * (bw + pad);
    if (k === 1) kotak(p, x, rowY, bw, bh, teks.t1 || " ", tebal, true, ikonGelas);
    else kotak(p, x, rowY, bw, bh, teks.t2 || " ", tebal, false, ikonKamera);
  });
  let x0 = pad;
  if (logo) {
    const lh = 4.6 * MM;
    const lw = lh * rasioLogo;
    p.drawImage(logo, { x: pad, y: 0.7 * MM, width: lw, height: lh });
    x0 = pad + lw + pad;
  }
  const mw = W - pad - x0;
  const s = ukuranMuat(teks.t3, biasa, mw, 7);
  const tw = biasa.widthOfTextAtSize(teks.t3, s);
  p.drawText(teks.t3, { x: x0 + (mw - tw) / 2, y: 2 * MM, size: s, font: biasa, color: K });
}

/** Render SVG kartun ke PNG pada `px` piksel per mm. */
async function svgKePng(svg: string, lebarMm: number, tinggiMm: number): Promise<Uint8Array> {
  const pw = Math.round(lebarMm * 12);
  const ph = Math.round(tinggiMm * 12);
  const s = svg.replace('width="100%" height="100%"', `width="${pw}" height="${ph}"`);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = pw;
  c.height = ph;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, pw, ph);
  ctx.drawImage(img, 0, 0, pw, ph);
  const { promise: jadi, resolve: selesai } = Promise.withResolvers<Blob | null>();
  c.toBlob(selesai, "image/png");
  const blob = await jadi;
  if (!blob) throw new Error("Strip gagal dirender.");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Susun PDF strip 1 halaman `lebarMm × tinggiMm`.
 *
 * `logo` ditanam di sini (bukan dikirim sebagai bytes mentah) karena `drawImage` butuh
 * `PDFImage` milik dokumen ini.
 */
export async function buatStrip(
  template: TemplateStrip,
  ukuran: { lebarMm: number; tinggiMm: number },
  teks: TeksStrip,
  logo: LogoStrip | null
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const p = out.addPage([ukuran.lebarMm * MM, ukuran.tinggiMm * MM]);
  if (template.svg) {
    const png = await svgKePng(template.svg, ukuran.lebarMm, ukuran.tinggiMm);
    const img = await out.embedPng(png);
    p.drawImage(img, { x: 0, y: 0, width: ukuran.lebarMm * MM, height: ukuran.tinggiMm * MM });
  } else {
    const tebal = await out.embedFont(StandardFonts.HelveticaBold);
    const biasa = await out.embedFont(StandardFonts.Helvetica);
    const logoGambar = logo ? await out.embedPng(logo.png) : null;
    stripKlasik(p, ukuran.lebarMm * MM, ukuran.tinggiMm * MM, tebal, biasa, logoGambar, logo?.rasio ?? 1, teks, template.kotak ?? [1, 2]);
  }
  return out.save();
}
