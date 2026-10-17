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
//
// WATERMARK = IKON/MOTIF + NAMA TOKO, bukan kotak teks. Kotak strip lama menghabiskan 20 mm
// tepi label; label termal 100×150 mm tidak punya ruang untuk itu. Ikon dan tulisan ditaruh
// sebagai lapisan transparan di atas kiriman, sehingga resi tetap terbaca utuh.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFEmbeddedPage, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

const MM = 72 / 25.4;

/** Posisi lapisan watermark. `tengah` = cap besar sekali; `atas`/`bawah` = motif berulang. */
export type PosisiWatermark = "bawah" | "atas" | "tengah";

export type OpsiCetak = {
  /** Tinggi halaman keluaran (mm). Lebar selalu 100 mm (label termal). */
  tinggiMm: number;
  /** Ukuran kertas lain (A4 dst) memakai lebar sendiri; null = 100 mm. */
  lebarMm?: number | null;
  posisi: PosisiWatermark;
  /** Nama toko yang dicetak di bawah ikon. Kosong = tanpa teks. */
  namaToko: string;
  /** 0..1 — 1 = hitam penuh. Berpengaruh ke ikon DAN teks. */
  opacity: number;
  /** Derajat miring. Negatif membalik arah. */
  rotasi: number;
  /** Ukuran ikon/tulisan (mm). */
  ikonMm: number;
  /** Jarak antar-titik motif (mm). Diabaikan untuk cap tengah. */
  jarakMm: number;
  /** Potong bagian bawah halaman asli (mm) — untuk membuang ruang kosong. */
  cropBawahMm: number;
  /** Geser seluruh halaman asli (mm), ke kanan/atas. */
  geserXMm: number;
  geserYMm: number;
  /**
   * PNG hitam-putih (dikonversi pemanggil). Logo toko dan gambar watermark unggahan user
   * memakai jalur render yang sama — hanya sumber berkasnya yang berbeda.
   */
  ikon?: { png: Uint8Array; rasio: number } | null;
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
 * Halaman asli memenuhi kertas, lalu watermark digambar di atasnya. Ringkasan hasil
 * dikembalikan agar pemanggil bisa memberi tahu user berapa halaman benar-benar tercetak.
 *
 * `hanyaHalamanPertamaDigambar`: untuk pratinjau. SEMUA halaman tetap disusun dan dihitung
 * (supaya "N halaman akan dicetak" benar), hanya watermark yang digambar sekali — menggambar
 * motif 300 kali untuk pratinjau satu halaman membekukan tab.
 */
export async function bangunPdf(
  sumber: SumberPdf[],
  opsi: OpsiCetak,
  hanyaHalamanPertamaDigambar = false
): Promise<{ bytes: Uint8Array; halaman: number; dilewati: number }> {
  const out = await PDFDocument.create();
  const tebal = await out.embedFont(StandardFonts.HelveticaBold);
  const ikon = opsi.ikon ? await out.embedPng(opsi.ikon.png) : null;
  // Rasio diambil dari gambar yang BENAR-BENAR tertanam: `rasio` kiriman klien hanya
  // perkiraan dari canvas, dan gambar cacat akan menghasilkan tinggi 0 (tidak tampil).
  const rasio = ikon ? ikon.width / Math.max(1, ikon.height) : 1;

  const lebarMm = opsi.lebarMm ?? 100;
  const W = lebarMm * MM;
  const H = opsi.tinggiMm * MM;
  const alfa = Math.max(0.03, Math.min(1, opsi.opacity));
  const nama = opsi.namaToko.trim().slice(0, 28);
  const sudut = Math.max(-90, Math.min(90, opsi.rotasi));

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

      const sp = halamanAsli[i];
      const { width: w, height: h } = sp.getSize();
      const crop = Math.max(0, Math.min(opsi.cropBawahMm * MM, h - 40));
      const emb: PDFEmbeddedPage = await out.embedPage(sp, { left: 0, bottom: crop, right: w, top: h });
      const ch = h - crop;
      // Halaman asli memenuhi kertas. Watermark adalah lapisan, bukan pengambil ruang —
      // tidak ada isi resi yang dipotong atau mengecil karena watermark.
      const skala = Math.min(W / w, H / ch);
      const dw = w * skala;
      const dh = ch * skala;
      const x = (W - dw) / 2 + opsi.geserXMm * MM;
      const y = (H - dh) / 2 + opsi.geserYMm * MM;

      const p = out.addPage([W, H]);
      p.drawPage(emb, { x, y, width: dw, height: dh });

      if (!hanyaHalamanPertamaDigambar || halaman === 0) {
        if (opsi.posisi === "tengah") cap(p, W, H, { ikon, rasio, nama, alfa, ikonMm: opsi.ikonMm, sudut, tebal });
        else motif(p, W, H, { ikon, rasio, nama, alfa, ikonMm: opsi.ikonMm, jarakMm: opsi.jarakMm, sudut, tebal });
      }
      halaman += 1;
    }
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
 * Satu motif = ikon di atas, nama toko di bawahnya, keduanya miring `sudut` derajat.
 * Digambar mengelilingi titik (cx, cy) dengan pensil pusat.
 *
 * pdf-lib memutar di sekitar pojok kiri-bawah, jadi setiap bentuk digeser setengah ukurannya
 * lebih dulu lalu diputar di sekitar (cx, cy) — hasilnya benar tanpa matriks manual.
 */
function gambarMotifDi(
  p: PDFPage,
  cx: number,
  cy: number,
  ikon: PDFImage | null,
  rasio: number,
  nama: string,
  ukuran: number,
  fontTeks: number,
  sudut: number,
  alfa: number,
  tebal: PDFFont
): void {
  const tinggiIkon = ikon ? ukuran / Math.max(0.05, rasio) : 0;
  const ruangTeks = nama ? fontTeks * 1.2 : 0;
  const total = tinggiIkon + ruangTeks;

  if (ikon) {
    const x0 = cx - ukuran / 2;
    const y0 = cy + total / 2 - tinggiIkon;
    // Putar titik pusat ikon mengelilingi (cx, cy):
    const t = sudut * (Math.PI / 180);
    const px = cx + (x0 + ukuran / 2 - cx) * Math.cos(t) - (y0 + tinggiIkon / 2 - cy) * Math.sin(t);
    const py = cy + (x0 + ukuran / 2 - cx) * Math.sin(t) + (y0 + tinggiIkon / 2 - cy) * Math.cos(t);
    p.drawImage(ikon, {
      x: px - ukuran / 2,
      y: py - tinggiIkon / 2,
      width: ukuran,
      height: tinggiIkon,
      opacity: alfa,
      rotate: degrees(sudut),
    });
  }
  if (nama) {
    const lebarTeks = tebal.widthOfTextAtSize(nama, fontTeks);
    const x0 = cx - lebarTeks / 2;
    const y0 = cy - total / 2;
    const t = sudut * (Math.PI / 180);
    const px = cx + (x0 - cx) * Math.cos(t) - (y0 - cy) * Math.sin(t);
    const py = cy + (x0 - cx) * Math.sin(t) + (y0 - cy) * Math.cos(t);
    p.drawText(nama, {
      x: px,
      y: py,
      size: fontTeks,
      font: tebal,
      color: rgb(0, 0, 0),
      opacity: alfa,
      rotate: degrees(sudut),
    });
  }
}

/** Motif berulang menutupi halaman; baris ganjil digeser setengah jarak agar tidak bergaris. */
function motif(
  p: PDFPage,
  W: number,
  H: number,
  o: { ikon: PDFImage | null; rasio: number; nama: string; alfa: number; ikonMm: number; jarakMm: number; sudut: number; tebal: PDFFont }
): void {
  const ukuran = Math.max(5, Math.min(40, o.ikonMm)) * MM;
  const jarak = Math.max(10, Math.min(90, o.jarakMm)) * MM;
  const fontTeks = o.nama ? Math.min(ukuran * 0.3, Math.max(4, ukuran * 0.22)) : 0;
  const lebarMotif = Math.max(ukuran, o.nama ? o.tebal.widthOfTextAtSize(o.nama, fontTeks) : 0);
  const tinggiMotif = (o.ikon ? ukuran / Math.max(0.05, o.rasio) : 0) + (o.nama ? fontTeks * 1.2 : 0);

  // Sel motif miring punya kotak pembungkus lebih besar; jarak minimum mengikuti pembungkus
  // itu supaya motif tidak bertumpuk saat rotasi besar.
  const t = Math.abs(Math.sin((o.sudut * Math.PI) / 180));
  const c = Math.abs(Math.cos((o.sudut * Math.PI) / 180));
  const langkahX = Math.max(jarak, lebarMotif * c + tinggiMotif * t + 4);
  const langkahY = Math.max(jarak, lebarMotif * t + tinggiMotif * c + 4);
  const kolom = Math.max(1, Math.ceil(W / langkahX) + 1);
  const baris = Math.max(1, Math.ceil(H / langkahY) + 1);

  for (let b = 0; b < baris; b++) {
    for (let k = 0; k < kolom; k++) {
      const cx = k * langkahX + (b % 2 === 0 ? langkahX / 2 : langkahX);
      const cy = b * langkahY + langkahY / 2;
      gambarMotifDi(p, cx, cy, o.ikon, o.rasio, o.nama, ukuran, fontTeks, o.sudut, o.alfa, o.tebal);
    }
  }
}

/** Satu cap besar di tengah halaman. */
function cap(
  p: PDFPage,
  W: number,
  H: number,
  o: { ikon: PDFImage | null; rasio: number; nama: string; alfa: number; ikonMm: number; sudut: number; tebal: PDFFont }
): void {
  const ukuran = Math.max(10, Math.min(70, o.ikonMm * 2.2)) * MM;
  const fontTeks = o.nama
    ? ukuranMuat(o.nama, o.tebal, Math.hypot(W, H) * 0.7, ukuran * 0.32)
    : 0;
  gambarMotifDi(p, W / 2, H / 2, o.ikon, o.rasio, o.nama, ukuran, fontTeks, o.sudut, o.alfa, o.tebal);
}
