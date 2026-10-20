// lib/printing/watermark.ts — Susun PDF resi + strip. KLIEN saja.
//
// MEKANISME SAMA dengan alat referensi pemilik toko: strip dibuat sebagai PDF tersendiri
// (lihat `strip.ts`), lalu ditanam apa adanya ke setiap halaman keluaran. Dua kotak persegi
// (`S` = strip, `R` = area resi) dihitung dalam milimeter dari atas halaman, sama seperti
// editor posisi di layar — jadi yang terlihat di pratinjau identik dengan hasil cetak.
//
// KENAPA PDF-LIB: label resi memuat barcode. Merender ke gambar lalu mencetak ulang
// menurunkan tepi barcode dan bisa membuatnya tidak ter-scan. `embedPage` menempel halaman
// ASLI (barcode tetap vektor).
import { PDFDocument, type PDFEmbeddedPage } from "pdf-lib";

const MM = 72 / 25.4;

/** Kotak dalam milimeter, titik (x, y) dari kiri-atas halaman. */
export type Kotak = { x: number; y: number; w: number; h: number };

/** Bagian API pdf.js yang dipakai — cukup sempit untuk diuji tanpa memuat pdf.js. */
export type PDFJsPageLike = { getSize: () => { width: number; height: number } };

/**
 * Satu berkas sumber. `halaman[i] === null` berarti halaman itu DILEWATI (user menandai
 * kosong dan menghapusnya). Indeks harus sejajar dengan halaman asli di dalam `bytes`.
 */
type SumberPdf = { bytes: Uint8Array; halaman: (PDFJsPageLike | null)[] };

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
};

/**
 * Tata letak awal: strip menempel di tepi bawah selebar label, resi diskalakan ke sisa
 * ruang lalu diletakkan di tengah. Angka ini sama dengan `auto()` di alat referensi.
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

/**
 * Susun PDF keluaran. Setiap halaman sumber menjadi SATU halaman 100 × tinggiMm: resi
 * ditempel ke kotak `resi`, strip ditempel ke kotak `strip`.
 *
 * `hanyaHalamanPertamaDigambar`: untuk pratinjau. SEMUA halaman tetap disusun dan dihitung.
 */
export async function bangunPdf(
  sumber: SumberPdf[],
  opsi: OpsiCetak,
  hanyaHalamanPertamaDigambar = false
): Promise<{ bytes: Uint8Array; halaman: number; dilewati: number; gagal: number }> {
  const out = await PDFDocument.create();
  const W = 100 * MM;
  const H = opsi.tinggiMm * MM;
  const [strip] = await out.embedPdf(opsi.stripBytes.slice(0));

  let halaman = 0;
  let dilewati = 0;
  let gagal = 0;

  for (const s of sumber) {
    const src = await PDFDocument.load(s.bytes.slice(0), { ignoreEncryption: true });
    const halamanAsli = src.getPages();
    for (let i = 0; i < halamanAsli.length; i++) {
      // `null` = halaman yang dilewati user. Yang tidak ada di `s.halaman` TETAP dicetak:
      // lebih baik mencetak satu halaman berlebih daripada label pelanggan hilang.
      if (s.halaman[i] === null) { dilewati += 1; continue; }

      const sp = halamanAsli[i];
      const { width: w, height: h } = sp.getSize();
      const crop = Math.max(0, Math.min(opsi.cropBawahMm * MM, h - 40));
      // Halaman tanpa stream Contents (benar-benar kosong) membuat `drawPage` melempar
      // "Can't embed page with missing Contents" saat SAVE — diperiksa lebih dulu supaya
      // satu halaman kosong tidak membatalkan seluruh berkas.
      if (!sp.node.Contents()) { gagal += 1; continue; }
      const emb: PDFEmbeddedPage = await out.embedPage(sp, { left: 0, bottom: crop, right: w, top: h });
      const ch = h - crop;

      // Skala resi agar muat kotak `resi` (mm → pt), lalu pusatkan di dalam kotak itu.
      const bw = opsi.resi.w * MM;
      const bh = opsi.resi.h * MM;
      const skala = Math.min(bw / w, bh / ch);
      const dw = w * skala;
      const dh = ch * skala;

      const p = out.addPage([W, H]);
      p.drawPage(emb, {
        x: opsi.resi.x * MM + (bw - dw) / 2,
        // y PDF dihitung dari bawah; `resi.y` dihitung dari atas.
        y: (opsi.tinggiMm - opsi.resi.y) * MM - bh + (bh - dh) / 2,
        width: dw,
        height: dh,
      });
      if (!hanyaHalamanPertamaDigambar || halaman === 0) {
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

  return { bytes: await out.save(), halaman, dilewati, gagal };
}
