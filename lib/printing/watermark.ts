// lib/printing/watermark.ts — Susun PDF cetak: resi + strip + penanda qty. KLIEN saja.
//
// KENAPA PDF-LIB: label resi memuat barcode. Merender ke gambar lalu mencetak ulang
// menurunkan tepi barcode dan bisa membuatnya tidak ter-scan. `embedPage` menempel halaman
// ASLI (barcode tetap vektor).
//
// SATU HALAMAN SUMBER → SATU ATAU DUA LEMBAR:
//   `rencanaHalaman` memilih kotak mana yang ditempel. Resi panjang dipecah jadi dua lembar
//   (kotak resi + daftar produk), dan HANYA lembar pertama yang mendapat strip — supaya
//   sambungan tidak menutupi isi.
import { PDFDocument, LineCapStyle, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { InfoResi } from "./deteksiResi";
import { bentukPenanda, kotakTeks, penandaQty, type BarisQty, type GayaQty, type ModeQty, type PenandaQty } from "./penandaQty";
import { rencanaHalaman, type Bagian } from "./tataLetak";

const MM = 72 / 25.4;

/** Kotak dalam milimeter, titik (x, y) dari kiri-atas halaman. */
export type Kotak = { x: number; y: number; w: number; h: number };

/**
 * Satu halaman sumber. `null` = halaman DILEWATI (user menandai kosong).
 * Indeks harus sejajar dengan halaman asli di dalam `bytes`.
 */
export type HalamanSumber = { info: InfoResi | null; qty?: BarisQty[] } | null;

export type SumberPdf = { bytes: Uint8Array; halaman: HalamanSumber[] };

/** Satu lembar keluaran: sumber mana (indeks `sumber`), halaman sumber, dan lembar ke berapa. */
export type LembarKeluar = { sumber: number; halaman: number; pg: number };

export type OpsiCetak = {
  /** Tinggi halaman keluaran (mm). Lebar selalu 100 mm (label termal). */
  tinggiMm: number;
  /** PDF strip 1 halaman (hasil `buatStrip`). */
  stripBytes: Uint8Array;
  /** Kotak strip di halaman keluaran (mm). */
  strip: Kotak;
  /** Kotak area resi di halaman keluaran (mm). */
  resi: Kotak;
  /** Potong bagian bawah halaman asli (mm). */
  cropBawahMm: number;
  /** `auto` = pecah resi panjang; `kecil` = selalu satu lembar. Default `auto`. */
  modePecah?: "auto" | "kecil";
  /** Ambang pengecilan untuk memecah (0..1). Default 0,85. */
  ambangPecah?: number;
  /** Penandaan qty. Default `mati`. */
  penanda?: { mode: ModeQty; gaya: GayaQty };
  /** Batasi jumlah halaman keluaran (pratinjau cepat). Semua tetap dihitung. */
  batasHalaman?: number;
};

/**
 * Tata letak awal: strip menempel di tepi bawah selebar label, resi diskalakan ke sisa
 * ruang lalu diletakkan di tengah.
 */
export function tataLetakAwal(tinggiMm: number, tinggiStripMm: number, rasioResi: number): { resi: Kotak; strip: Kotak } {
  const strip: Kotak = { x: 0, y: tinggiMm - tinggiStripMm, w: 100, h: tinggiStripMm };
  let w = 100;
  let h = w / Math.max(0.05, rasioResi);
  const sisa = tinggiMm - tinggiStripMm;
  if (h > sisa) {
    h = sisa;
    w = h * Math.max(0.05, rasioResi);
  }
  return { resi: { x: (100 - w) / 2, y: 0, w, h }, strip };
}

/** Gambar penanda qty satu lembar ke halaman PDF (koordinat mm, y dari atas). */
function gambarPenanda(
  p: PDFPage,
  tinggiMm: number,
  bagian: Bagian,
  daftar: PenandaQty[],
  gaya: GayaQty,
  font: PDFFont
): void {
  const K = rgb(0, 0, 0);
  const Wt = rgb(1, 1, 1);
  for (const m of daftar) {
    if (m.pg !== bagian.pg) continue;
    if (gaya === "kotak") {
      const t = m.teks;
      if (!t) continue;
      const lebarPt = font.widthOfTextAtSize(t.txt, t.ts * MM) / MM;
      const b = kotakTeks({ ...m, teks: t }, lebarPt);
      p.drawRectangle({
        x: b.x * MM,
        y: (tinggiMm - b.y - b.h) * MM,
        width: b.w * MM,
        height: b.h * MM,
        color: t.isi ? K : Wt,
        borderColor: K,
        borderWidth: 1,
      });
      p.drawText(t.txt, {
        x: (m.cx - lebarPt / 2) * MM,
        y: (tinggiMm - m.cy - 0.36 * t.ts) * MM,
        size: t.ts * MM,
        font,
        color: t.isi ? Wt : K,
      });
      continue;
    }
    for (const o of bentukPenanda(m, gaya)) {
      const lw = o.lw * MM;
      if (o.t === "e" && o.cx !== undefined && o.cy !== undefined) {
        p.drawEllipse({
          x: o.cx * MM,
          y: (tinggiMm - o.cy) * MM,
          xScale: (o.rx ?? 0) * MM,
          yScale: (o.ry ?? 0) * MM,
          borderColor: K,
          borderWidth: lw,
        });
      } else if (o.t === "r" && o.x !== undefined && o.y !== undefined) {
        p.drawRectangle({
          x: o.x * MM,
          y: (tinggiMm - o.y - (o.h ?? 0)) * MM,
          width: (o.w ?? 0) * MM,
          height: (o.h ?? 0) * MM,
          borderColor: K,
          borderWidth: lw,
        });
      } else if (o.p) {
        for (let i = 0; i < o.p.length - 1; i++) {
          p.drawLine({
            start: { x: o.p[i][0] * MM, y: (tinggiMm - o.p[i][1]) * MM },
            end: { x: o.p[i + 1][0] * MM, y: (tinggiMm - o.p[i + 1][1]) * MM },
            thickness: lw,
            color: K,
            lineCap: LineCapStyle.Round,
          });
        }
      }
    }
  }
}

/**
 * Susun PDF keluaran. Setiap halaman sumber menjadi satu (atau dua) halaman 100 × tinggiMm.
 *
 * `batasHalaman` hanya memotong KELUARAN; hitungan `halaman` tetap utuh supaya pratinjau
 * dan tombol cetak tidak berbeda angka.
 */
export async function bangunPdf(
  sumber: SumberPdf[],
  opsi: OpsiCetak
): Promise<{
  bytes: Uint8Array;
  halaman: number;
  dilewati: number;
  gagal: number;
  pecah: number;
  /** Urutan lembar yang benar-benar ditulis — dipakai UI untuk melabeli pratinjau cetak. */
  lembar: LembarKeluar[];
}> {
  const out = await PDFDocument.create();
  const W = 100 * MM;
  const H = opsi.tinggiMm * MM;
  const [strip] = await out.embedPdf(opsi.stripBytes.slice(0));
  const font = await out.embedFont(StandardFonts.HelveticaBold);
  const penanda = opsi.penanda ?? { mode: "mati" as ModeQty, gaya: "kotak" as GayaQty };

  let halaman = 0;
  let dilewati = 0;
  let gagal = 0;
  let pecah = 0;
  const lembar: LembarKeluar[] = [];

  for (const [indeksSumber, s] of sumber.entries()) {
    const src = await PDFDocument.load(s.bytes.slice(0), { ignoreEncryption: true });
    const halamanAsli = src.getPages();
    for (let i = 0; i < halamanAsli.length; i++) {
      // Yang tidak ada di `s.halaman` TETAP dicetak: lebih baik mencetak satu halaman
      // berlebih daripada label pelanggan hilang.
      if (s.halaman[i] === null) { dilewati += 1; continue; }

      const sp = halamanAsli[i];
      const { width: w, height: h } = sp.getSize();
      // Halaman tanpa stream Contents membuat `drawPage` melempar "Can't embed page with
      // missing Contents" saat SAVE — diperiksa lebih dulu supaya satu halaman kosong tidak
      // membatalkan seluruh berkas.
      if (!sp.node.Contents()) { gagal += 1; continue; }

      const data = s.halaman[i];
      const rencana = rencanaHalaman(data?.info ?? null, w, h, {
        tinggiMm: opsi.tinggiMm,
        cropMm: opsi.cropBawahMm,
        resi: opsi.resi,
        mode: opsi.modePecah ?? "auto",
        ambangPecah: opsi.ambangPecah ?? 0.85,
      });
      if (rencana.pecah) pecah += 1;
      const tanda = penandaQty(data?.qty, w, h, rencana, penanda.mode, penanda.gaya);

      for (const q of rencana.parts) {
        if (opsi.batasHalaman !== undefined && halaman >= opsi.batasHalaman) {
          halaman += 1;
          continue;
        }
        lembar.push({ sumber: indeksSumber, halaman: i, pg: q.pg });
        const emb = await out.embedPage(sp, { left: q.x0, bottom: h - q.y1, right: q.x1, top: h - q.y0 });
        const p = out.addPage([W, H]);
        p.drawPage(emb, { x: q.dx * MM, y: (opsi.tinggiMm - q.dy - q.dh) * MM, width: q.dw * MM, height: q.dh * MM });
        gambarPenanda(p, opsi.tinggiMm, q, tanda, penanda.gaya, font);
        // Strip HANYA di lembar pertama tiap resi: lembar sambungan tidak boleh tertutup.
        if (q.pg === 0) {
          p.drawPage(strip, {
            x: opsi.strip.x * MM,
            y: (opsi.tinggiMm - opsi.strip.y - opsi.strip.h) * MM,
            width: opsi.strip.w * MM,
            height: opsi.strip.h * MM,
          });
        }
        halaman += 1;
      }
    }
  }

  return { bytes: await out.save(), halaman, dilewati, gagal, pecah, lembar };
}
