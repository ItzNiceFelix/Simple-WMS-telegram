// lib/printing/watermark.ts — Bangun PDF resi ber-pita FRAGILE + VIDEO UNBOXING. KLIEN saja.
//
// KENAPA DI KLIEN: PDF resi memuat nama, alamat, dan nomor HP pembeli. File TIDAK pernah
// dikirim; hanya nomor pesanan yang dikirim SETELAH dicetak.
//
// KENAPA PDF-LIB: label resi memuat barcode. Merender ke gambar lalu mencetak ulang
// menurunkan tepi barcode dan bisa membuatnya tidak ter-scan. `embedPage` menempel halaman
// ASLI (barcode tetap vektor); pita digambar sebagai vektor di band-nya sendiri.
//
// TATA LETAK (sama dengan alat referensi yang sudah terbukti):
//   halaman keluar 100 × tinggiMm
//   band pita = stripMm di tepi bawah
//   resi asli diskalakan ke area (tinggi − band), TIDAK pernah tertimpa pita
import { PDFDocument, StandardFonts, rgb, type Color, type PDFEmbeddedPage, type PDFFont, type PDFPage } from "pdf-lib";

const MM = 72 / 25.4;

/** Ikon garis di kotak pita. */
export type IkonGaris = "gelas" | "kamera";

export type OpsiCetak = {
  /** Tinggi halaman keluaran (mm). Lebar selalu 100 mm (label termal). */
  tinggiMm: number;
  /** Teks kotak HITAM (kiri) pada pita. */
  teks1: string;
  /** Teks kotak BERGARIS (kanan) pada pita. */
  teks2: string;
  /** Baris kecil di bawah kotak pita. */
  teksBawah: string;
  ikonKiri: IkonGaris;
  ikonKanan: IkonGaris;
  /** Tinggi band pita di tepi bawah (mm). 0 = tanpa pita. */
  stripMm: number;
  /** Potong bagian bawah halaman asli (mm) — untuk membuang ruang kosong. */
  cropBawahMm: number;
};

/** Bagian API pdf.js yang dipakai — cukup sempit untuk diuji tanpa memuat pdf.js. */
export type PDFJsPageLike = { getSize: () => { width: number; height: number } };

/** Posisi & ukuran resi di dalam halaman keluaran (pt). */
export type TataLetak = { skala: number; width: number; height: number; x: number; y: number };

/**
 * Tata letak resi: diskalakan ke area DI ATAS pita lalu diletakkan di tengah area itu.
 * Diekspor agar "pita tidak menimpa isi resi" bisa diuji sebagai angka.
 */
export function hitungTataLetak(
  halaman: { width: number; height: number },
  lebarHalamanPt: number,
  tinggiHalamanPt: number,
  stripPt: number
): TataLetak {
  const areaIsi = tinggiHalamanPt - stripPt;
  const skala = Math.min(lebarHalamanPt / halaman.width, areaIsi / halaman.height);
  const width = halaman.width * skala;
  const height = halaman.height * skala;
  return {
    skala,
    width,
    height,
    x: (lebarHalamanPt - width) / 2,
    y: stripPt + (areaIsi - height) / 2,
  };
}


/**
 * Satu berkas sumber. `halaman[i] === null` berarti halaman itu DILEWATI (user menandai
 * kosong dan menghapusnya). Indeks harus sejajar dengan halaman asli di dalam `bytes`.
 */
type SumberPdf = { bytes: Uint8Array; halaman: (PDFJsPageLike | null)[] };

/**
 * Susun PDF keluaran. Setiap halaman sumber menjadi SATU halaman 100 × tinggiMm: resi
 * diskalakan ke area di atas pita, pita menempati band bawah.
 *
 * `hanyaHalamanPertamaDigambar`: untuk pratinjau. SEMUA halaman tetap disusun dan dihitung,
 * hanya watermark yang digambar sekali — menggambar pita 300 kali membekukan tab.
 */
export async function bangunPdf(
  sumber: SumberPdf[],
  opsi: OpsiCetak,
  hanyaHalamanPertamaDigambar = false
): Promise<{ bytes: Uint8Array; halaman: number; dilewati: number; gagal: number }> {
  const out = await PDFDocument.create();
  const tebal = await out.embedFont(StandardFonts.HelveticaBold);
  const biasa = await out.embedFont(StandardFonts.Helvetica);

  const W = 100 * MM;
  const H = opsi.tinggiMm * MM;
  const strip = Math.max(0, Math.min(45, opsi.stripMm)) * MM;

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
      // "Can't embed page with missing Contents" saat SAVE, bukan saat embedPage — jadi
      // diperiksa lebih dulu. Satu halaman kosong tidak boleh membatalkan 50 resi lain.
      if (!sp.node.Contents()) { gagal += 1; continue; }
      const emb: PDFEmbeddedPage = await out.embedPage(sp, { left: 0, bottom: crop, right: w, top: h });
      const ch = h - crop;
      // Resi mengisi area DI ATAS pita. Pita tidak pernah menimpa isi resi.
      const tata = hitungTataLetak({ width: w, height: ch }, W, H, strip);
      const p = out.addPage([W, H]);
      p.drawPage(emb, { x: tata.x, y: tata.y, width: tata.width, height: tata.height });

      if (strip > 0 && (!hanyaHalamanPertamaDigambar || halaman === 0)) {
        gambarPita(p, W, strip, opsi, tebal, biasa);
      }
      halaman += 1;
    }
  }

  return { bytes: await out.save(), halaman, dilewati, gagal };
}

/**
 * Pita di band bawah label: latar putih, kotak kiri HITAM berisi ikon + teks putih, kotak
 * kanan bergaris, lalu baris kecil di bawahnya.
 *
 * KENAPA IKON GARIS: printer label hanya 1 bit; SVG yang diraster lalu diperkecil jadi
 * titik-titik abu dan tercetak pudar. `drawLine` tetap tajam pada resolusi printer apa pun.
 */
function gambarPita(
  p: PDFPage,
  W: number,
  strip: number,
  opsi: OpsiCetak,
  tebal: PDFFont,
  biasa: PDFFont,
): void {
  const pad = 1.5 * MM;
  const kiri = rgb(0, 0, 0);
  const putih = rgb(1, 1, 1);

  // Latar putih: badan resi yang tembus pandang tidak boleh bercampur dengan teks pita.
  p.drawRectangle({ x: 0, y: 0, width: W, height: strip, color: putih });

  const barisY = 6 * MM;
  const bh = Math.max(6 * MM, strip - barisY - pad);
  const bw = (W - 3 * pad) / 2;

  const kotak = (x: number, teksMentah: string, isiHitam: boolean, ikon: IkonGaris) => {
    const warnaTeks = isiHitam ? putih : kiri;
    const ukuranIkon = Math.min(bh * 0.7, 7 * MM);
    const ix = x + pad;
    const iy = barisY + (bh - ukuranIkon) / 2;
    gambarIkonGaris(p, ikon, ix, iy, ukuranIkon, warnaTeks);

    const tx = ix + ukuranIkon * 1.15 + pad;
    const mw = x + bw - pad - tx;
    const teks = (teksMentah || " ").slice(0, 28);
    const s = ukuranMuat(teks, tebal, mw, Math.min(bh * 0.55, 11));
    p.drawText(teks, { x: tx, y: barisY + (bh - s * 0.72) / 2, size: s, font: tebal, color: warnaTeks });
  };
  kotak(pad, opsi.teks1, true, opsi.ikonKiri);
  kotak(2 * pad + bw, opsi.teks2, false, opsi.ikonKanan);

  const t3 = (opsi.teksBawah || "").slice(0, 70);
  if (t3) {
    const s3 = ukuranMuat(t3, biasa, W - 2 * pad, 7);
    p.drawText(t3, { x: pad, y: 2 * MM, size: s3, font: biasa, color: kiri });
  }
}

/** Ikon garis sederhana: gelas pecah (fragile) dan kamera (video unboxing). */
function gambarIkonGaris(p: PDFPage, jenis: IkonGaris, x: number, y: number, s: number, c: Color): void {
  const t = Math.max(0.6, s * 0.06);
  const garis = (ax: number, ay: number, bx: number, by: number) =>
    p.drawLine({ start: { x: x + ax * s, y: y + ay * s }, end: { x: x + bx * s, y: y + by * s }, thickness: t, color: c });
  if (jenis === "gelas") {
    garis(0.12, 0.9, 0.62, 0.9);
    garis(0.62, 0.9, 0.37, 0.45);
    garis(0.37, 0.45, 0.12, 0.9);
    garis(0.37, 0.45, 0.37, 0.12);
    garis(0.88, 0.55, 0.72, 0.3);
    garis(0.72, 0.3, 0.94, 0.28);
    return;
  }
  p.drawRectangle({ x, y: y + s * 0.12, width: s * 0.66, height: s * 0.62, borderColor: c, borderWidth: t });
  p.drawCircle({ x: x + s * 0.33, y: y + s * 0.43, size: s * 0.09, color: c });
  garis(0.66, 0.42, 0.98, 0.72);
  garis(0.98, 0.72, 0.98, 0.2);
  garis(0.98, 0.2, 0.66, 0.42);
}

/** Kecilkan font sampai muat; berhenti di 4 pt (lebih kecil dari itu tidak terbaca). */
function ukuranMuat(teks: string, font: PDFFont, maks: number, mulai: number): number {
  let s = mulai;
  while (s > 4 && font.widthOfTextAtSize(teks, s) > maks) s -= 0.5;
  return s;
}
