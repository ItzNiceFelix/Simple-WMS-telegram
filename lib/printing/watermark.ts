// lib/printing/watermark.ts — Bangun PDF resi ber-watermark. KLIEN saja.
//
// KENAPA DI KLIEN: PDF resi memuat nama, alamat, dan nomor HP pembeli. Mengunggahnya ke
// Worker berarti menyalin data pribadi ke server untuk pekerjaan yang bisa diselesaikan di
// browser. File TIDAK pernah dikirim; hanya nomor pesanan yang dikirim SETELAH dicetak.
//
// KENAPA PDF-LIB, BUKAN CANVAS → GAMBAR:
//   Label resi memuat barcode. Merender ke gambar lalu mencetak ulang menurunkan tepi barcode
//   dan bisa membuatnya tidak ter-scan. `pdf-lib` menempel halaman ASLI (embedPage) sehingga
//   barcode tetap vektor, dan hanya menambah lapisan watermark.
import { PDFDocument, StandardFonts, rgb, type PDFEmbeddedPage, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

const MM = 72 / 25.4;

export type PosisiWatermark = "bawah" | "atas" | "tengah";

export type OpsiCetak = {
  /** Tinggi halaman keluaran (mm). Lebar selalu 100 mm (label termal). */
  tinggiMm: number;
  /** Ukuran kertas lain (A4 dst) memakai lebar sendiri; null = 100 mm. */
  lebarMm?: number | null;
  /** Tinggi strip watermark (mm). */
  stripMm: number;
  posisi: PosisiWatermark;
  teks1: string;
  teks2: string;
  teks3: string;
  /** 0..1 — 1 = hitam penuh. */
  opacity: number;
  /** Derajat; hanya dipakai posisi "tengah". */
  rotasi: number;
  /** Potong bagian bawah halaman asli (mm) — untuk membuang ruang kosong. */
  cropBawahMm: number;
  /** Geser seluruh halaman asli (mm), ke kanan/atas. */
  geserXMm: number;
  geserYMm: number;
  /** Logo PNG (sudah hitam-putih) + rasio lebar/tinggi. */
  logo?: { png: Uint8Array; rasio: number } | null;
};

export type HalamanSumber = {
  /** Halaman asli yang akan ditempel. */
  halaman: PDFJsPageLike;
  /** Halaman ini ikut dicetak? false = dilewati (halaman kosong yang dihapus user). */
  cetak: boolean;
};

/** Bagian API pdf.js yang dipakai — cukup sempit untuk diuji tanpa memuat pdf.js. */
export type PDFJsPageLike = { getSize: () => { width: number; height: number } };

/**
 * Satu berkas sumber. `halaman[i] === null` berarti halaman itu DILEWATI (user menandai
 * kosong dan menghapusnya). Indeks harus sejajar dengan halaman asli di dalam `bytes`.
 */
type SumberPdf = { bytes: Uint8Array; halaman: (PDFJsPageLike | null)[] };

/**
 * Susun PDF keluaran.
 *
 * Setiap halaman sumber menjadi SATU halaman keluaran berukuran `lebarMm × tinggiMm`.
 * Halaman asli diperkecil agar muat di area di atas strip (atau di bawahnya untuk posisi
 * "atas"), lalu strip digambar. Ringkasan hasil dikembalikan agar pemanggil bisa memberi
 * tahu user berapa halaman benar-benar tercetak.
 */
export async function bangunPdf(
  sumber: SumberPdf[],
  opsi: OpsiCetak,
  hanyaPratinjauHalamanPertama = false
): Promise<{ bytes: Uint8Array; halaman: number; dilewati: number }> {
  const out = await PDFDocument.create();
  const tebal = await out.embedFont(StandardFonts.HelveticaBold);
  const biasa = await out.embedFont(StandardFonts.Helvetica);
  const logo = opsi.logo ? await out.embedPng(opsi.logo.png) : null;

  const lebarMm = opsi.lebarMm ?? 100;
  const W = lebarMm * MM;
  const H = opsi.tinggiMm * MM;
  const strip = Math.max(10, Math.min(45, opsi.stripMm)) * MM;
  // Area untuk halaman asli: sisa setelah strip. Posisi "tengah" memakai seluruh tinggi
  // (strip menimpa konten seperti cap, bukan mengambil ruang) — itu pilihan sadar: label
  // yang sudah penuh tidak boleh dipaksa mengecil hanya untuk menyediakan ruang watermark.
  const tinggiArea = opsi.posisi === "tengah" ? H : H - strip;

  let halaman = 0;
  let dilewati = 0;

  for (const s of sumber) {
    const src = await PDFDocument.load(s.bytes.slice(0), { ignoreEncryption: true });
    const halamanAsli = src.getPages();
    for (let i = 0; i < halamanAsli.length; i++) {
      // `null` = halaman yang ditandai kosong lalu dihapus user. Yang tidak ada di
      // `s.halaman` (mis. informasi halaman gagal dibaca) TETAP dicetak: lebih baik
      // mencetak satu halaman berlebih daripada label pelanggan hilang.
      if (s.halaman[i] === null) { dilewati += 1; continue; }
      if (hanyaPratinjauHalamanPertama && halaman >= 1) break;

      const sp = halamanAsli[i];
      const { width: w, height: h } = sp.getSize();
      const crop = Math.max(0, Math.min(opsi.cropBawahMm * MM, h - 40));
      const emb: PDFEmbeddedPage = await out.embedPage(sp, { left: 0, bottom: crop, right: w, top: h });
      const ch = h - crop;
      const skala = Math.min(W / w, tinggiArea / ch);
      const dw = w * skala;
      const dh = ch * skala;
      const x = (W - dw) / 2 + opsi.geserXMm * MM;
      const yArea = opsi.posisi === "bawah" ? strip : 0;
      const y = yArea + (tinggiArea - dh) / 2 + opsi.geserYMm * MM;

      const p = out.addPage([W, H]);
      p.drawPage(emb, { x, y, width: dw, height: dh });

      if (opsi.posisi === "tengah") gambarTengah(p, W, H, opsi, tebal);
      else gambarStrip(p, W, strip, opsi.posisi === "atas", opsi, tebal, biasa, logo);
      halaman += 1;
    }
    if (hanyaPratinjauHalamanPertama && halaman >= 1) break;
  }

  return { bytes: await out.save(), halaman, dilewati };
}

/** Kecilkan font sampai muat; berhenti di 4 pt (lebih kecil dari itu tidak terbaca). */
function ukuranMuat(teks: string, font: PDFFont, maks: number, mulai: number): number {
  let s = mulai;
  while (s > 4 && font.widthOfTextAtSize(teks, s) > maks) s -= 0.5;
  return s;
}

/**
 * Strip kotak seperti referensi: kotak kiri terisi hitam (teks putih), kotak kanan bergaris,
 * teks kecil di bawahnya. Strip ditempel di tepi halaman, bukan di tengah konten, supaya
 * alamat penerima dan barcode tidak tertutup.
 */
function gambarStrip(
  p: PDFPage,
  W: number,
  strip: number,
  diAtas: boolean,
  opsi: OpsiCetak,
  tebal: PDFFont,
  biasa: PDFFont,
  logo: PDFImage | null
): void {
  const H = p.getHeight();
  const dasar = diAtas ? H - strip : 0;
  const pad = 1.5 * MM;
  const kiri = rgb(0, 0, 0);
  const putih = rgb(1, 1, 1);
  const alfa = Math.max(0.1, Math.min(1, opsi.opacity));

  // Latar putih supaya teks di bawah tidak tembus (label termal, tanpa warna).
  p.drawRectangle({ x: 0, y: dasar, width: W, height: strip, color: putih, opacity: 1 });

  const barisY = dasar + 5 * MM;
  const bh = strip - 5 * MM - pad;
  const bw = (W - 3 * pad) / 2;

  // Kotak kiri: isi hitam, teks putih. Kotak kanan: putih, teks hitam.
  p.drawRectangle({ x: pad, y: barisY, width: bw, height: bh, color: kiri, opacity: alfa });
  p.drawRectangle({ x: 2 * pad + bw, y: barisY, width: bw, height: bh, borderColor: kiri, borderWidth: 1.2, opacity: alfa });

  const t1 = (opsi.teks1 || " ").slice(0, 24);
  const t2 = (opsi.teks2 || " ").slice(0, 28);
  const s1 = ukuranMuat(t1, tebal, bw - 2 * pad, bh * 0.6);
  const s2 = ukuranMuat(t2, tebal, bw - 2 * pad, bh * 0.6);
  p.drawText(t1, { x: pad + (bw - tebal.widthOfTextAtSize(t1, s1)) / 2, y: barisY + (bh - s1 * 0.72) / 2, size: s1, font: tebal, color: putih, opacity: alfa });
  p.drawText(t2, { x: 2 * pad + bw + (bw - tebal.widthOfTextAtSize(t2, s2)) / 2, y: barisY + (bh - s2 * 0.72) / 2, size: s2, font: tebal, color: kiri, opacity: alfa });

  let x0 = pad;
  if (logo) {
    const lh = 4.4 * MM;
    const lw = Math.min(lh * opsi.logo!.rasio, W / 3);
    p.drawImage(logo, { x: pad, y: dasar + 0.7 * MM, width: lw, height: lh, opacity: alfa });
    x0 = pad + lw + pad;
  }
  const t3 = (opsi.teks3 || " ").slice(0, 70);
  const maksTeks3 = W - pad - x0;
  const s3 = ukuranMuat(t3, biasa, maksTeks3, 7);
  p.drawText(t3, {
    x: x0 + (maksTeks3 - biasa.widthOfTextAtSize(t3, s3)) / 2,
    y: dasar + 1.8 * MM,
    size: s3,
    font: biasa,
    color: kiri,
    opacity: alfa,
  });
}

/** Cap miring di tengah halaman — untuk label yang tidak diberi strip. */
function gambarTengah(p: PDFPage, W: number, H: number, opsi: OpsiCetak, tebal: PDFFont): void {
  const teks = (opsi.teks1 || " ").slice(0, 30);
  const alfa = Math.max(0.05, Math.min(1, opsi.opacity));
  const sudut = (opsi.rotasi * Math.PI) / 180;
  const maks = Math.hypot(W, H) * 0.75;
  const s = ukuranMuat(teks, tebal, maks, opsi.stripMm * MM * 1.6);
  const tw = tebal.widthOfTextAtSize(teks, s);
  p.drawText(teks, {
    x: (W - tw * Math.cos(sudut)) / 2,
    y: (H - s * 0.72) / 2,
    size: s,
    font: tebal,
    color: rgb(0, 0, 0),
    opacity: alfa,
    rotate: { type: "degrees", angle: opsi.rotasi } as never,
  });
}
