// lib/d1/picklistGabungPdf.ts — Picklist gabungan: order + advance dalam SATU lembar.
//
// TAMPILAN SENGAJA SAMA dengan mode "pisah": satu tabel datar
// `No | Nama Produk | SKU | Lokasi Gudang | Qty | Cek`, tanpa daftar order per produk.
// Daftar asal-usul per baris dibuang karena picker tidak memakainya saat mengambil barang,
// dan daftarnya bisa puluhan baris sehingga justru menutupi barangnya sendiri.
//
// Di bawah tabel utama ada tabel KEDUA khusus produk bermasalah (tanpa SKU / SKU tidak ada
// di master yang sudah dicentang "belum di MP"). Dipisah supaya picker tetap bisa mengambil
// barang normal lebih dulu dan tidak tertukar saat menghitung.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type JenisBarisPick = "order" | "advance";

/** Satu baris sebelum digabung. */
export type BarisPickGabung = {
  jenis: JenisBarisPick;
  sku: string;
  /** Nama produk dari master (`products.nama_accurate`). Satu sumber nama untuk semua jalur. */
  nama: string;
  /** Gudang tempat stok barang ini berada. Kosong = tidak ada stok di gudang mana pun. */
  lokasi: string;
  /** Gudang lain yang juga menyimpan barang ini (bila ada), untuk peringatan picker. */
  lokasiLain: string;
  qty: number;
  kunci: string;
  kirimKe: string;
  /**
   * SKU bermasalah: belum ada / tidak ada di master, dan user sudah menandai "belum di MP".
   * Baris begini TIDAK digabung ke tabel utama — dipisah ke tabel kedua supaya picker tidak
   * menghitungnya tercampur dengan barang yang jelas.
   */
  perluSku: boolean;
  /** SKU yang tertulis di file, bila ada tapi tidak dikenal master. */
  skuAsal: string;
};

/** Baris hasil gabungan. */
export type BarisGabung = {
  nama: string;
  sku: string;
  lokasi: string;
  lokasiLain: string;
  qty: number;
  perluSku: boolean;
  skuAsal: string;
  rincian: { jenis: JenisBarisPick; kunci: string; kirimKe: string; qty: number }[];
};

const LEBAR = 595.28; // A4 portrait
const TINGGI = 841.89;
const MARGIN = 40;
const JUDUL_FS = 15;
const ISI_FS = 10;
const BARIS_H = 20;
const LEBAR_TABEL = 515;
// Sama dengan mode pisah, hanya ditambah kolom Lokasi Gudang.
const KOLOM = [30, 196, 92, 105, 44, 48];
const HEADER = ["No", "Nama Produk", "SKU", "Lokasi Gudang", "Qty", "Cek"];

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

/**
 * Gabungkan baris per (SKU + lokasi) — HANYA yang benar-benar setara.
 *
 * SKU berbeda atau lokasi berbeda TIDAK digabung: kalau dipaksa jadi satu baris, picker
 * mengira barangnya satu tumpukan padahal harus diambil dari dua tempat.
 * Baris bermasalah (perluSku) selalu berdiri sendiri supaya tidak menyatu dengan barang jelas.
 */
export function gabungPerSku(baris: BarisPickGabung[]): BarisGabung[] {
  const peta = new Map<string, BarisGabung>();
  for (const b of baris) {
    const kunci = b.perluSku ? `PERLU|${b.nama}|${b.skuAsal}` : `${b.sku}|${b.lokasi}`;
    let g = peta.get(kunci);
    if (!g) {
      g = {
        nama: b.nama, sku: b.sku, lokasi: b.lokasi, lokasiLain: b.lokasiLain,
        qty: 0, perluSku: b.perluSku, skuAsal: b.skuAsal, rincian: [],
      };
      peta.set(kunci, g);
    }
    g.qty += b.qty;
    g.rincian.push({ jenis: b.jenis, kunci: b.kunci, kirimKe: b.kirimKe, qty: b.qty });
  }
  // Urutan: lokasi dulu supaya picker menyisir rak satu per satu, lalu nama.
  return [...peta.values()].sort((a, b) => a.lokasi.localeCompare(b.lokasi, "id") || a.nama.localeCompare(b.nama, "id"));
}

type OpsiGabung = { gudangDefault?: string; judul?: string; adaBermasalah?: number };

/** Picklist gabungan A4: tabel utama + tabel produk bermasalah + dua tanda tangan. */
export async function bangunPdfPicklistGabung(
  baris: BarisPickGabung[],
  opsi: OpsiGabung = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const biasa = await doc.embedFont(StandardFonts.Helvetica);
  const tebal = await doc.embedFont(StandardFonts.HelveticaBold);
  const potong = (t: string, maks: number, font: typeof biasa, ukuran = ISI_FS): string => {
    if (font.widthOfTextAtSize(t, ukuran) <= maks) return t;
    let s = t;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, ukuran) > maks) s = s.slice(0, -1);
    return `${s}…`;
  };

  const semua = gabungPerSku(baris);
  const normal = semua.filter((r) => !r.perluSku);
  const bermasalah = semua.filter((r) => r.perluSku);

  const xKolom: number[] = [];
  let x = MARGIN;
  for (const w of KOLOM) {
    xKolom.push(x);
    x += w;
  }

  const totalUnit = normal.reduce((a, r) => a + r.qty, 0);
  const jmlOrder = baris.filter((b) => b.jenis === "order").length;
  const jmlAdvance = baris.filter((b) => b.jenis === "advance").length;

  let hal = doc.addPage([LEBAR, TINGGI]);
  let y = TINGGI - MARGIN;

  hal.drawText(opsi.judul ?? "PICKLIST - ORDER + ADVANCE", { x: MARGIN, y, size: JUDUL_FS, font: tebal });
  y -= 15;
  hal.drawText("Admin Toko", { x: MARGIN, y, size: ISI_FS, font: tebal });
  y -= 13;
  hal.drawText(`Dicetak ${waktuJakarta()}`, { x: MARGIN, y, size: ISI_FS, font: biasa });
  y -= 13;
  const bagian = [`${normal.length} SKU`, `${totalUnit} unit`, `${jmlOrder} baris order, ${jmlAdvance} baris advance`];
  hal.drawText(
    opsi.gudangDefault ? `${opsi.gudangDefault} - ${bagian.join(" - ")}` : bagian.join(" - "),
    { x: MARGIN, y, size: ISI_FS, font: biasa }
  );
  y -= 22;

  const tulisHeader = (): void => {
    HEADER.forEach((h, i) => {
      const w = tebal.widthOfTextAtSize(h, ISI_FS);
      hal.drawText(h, { x: i >= 4 ? xKolom[i] + KOLOM[i] - w - 6 : xKolom[i] + 4, y, size: ISI_FS, font: tebal });
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

  /** Satu baris tabel: No | Nama | SKU | Lokasi | Qty | Cek. */
  const tulisBaris = (idx: number, nama: string, sku: string, lokasi: string, qty: number, redup: boolean): void => {
    const warna = redup ? rgb(0.6, 0.2, 0.2) : rgb(0, 0, 0);
    hal.drawText(String(idx), { x: xKolom[0] + 4, y, size: ISI_FS, font: biasa, color: warna });
    hal.drawText(potong(nama, KOLOM[1] - 8, biasa), { x: xKolom[1] + 4, y, size: ISI_FS, font: biasa, color: warna });
    hal.drawText(potong(sku, KOLOM[2] - 8, biasa), { x: xKolom[2] + 4, y, size: ISI_FS, font: biasa, color: warna });
    hal.drawText(potong(lokasi, KOLOM[3] - 8, biasa), { x: xKolom[3] + 4, y, size: ISI_FS, font: biasa, color: warna });
    const q = String(qty);
    hal.drawText(q, { x: xKolom[4] + KOLOM[4] - tebal.widthOfTextAtSize(q, ISI_FS) - 6, y, size: ISI_FS, font: tebal, color: warna });
    hal.drawRectangle({
      x: xKolom[5] + 14,
      y: y - 1,
      width: 11,
      height: 11,
      borderWidth: 0.8,
      borderColor: redup ? rgb(0.6, 0.2, 0.2) : rgb(0.45, 0.45, 0.45),
    });
    y -= BARIS_H;
  };

  tulisHeader();
  normal.forEach((r, i) => {
    if (y < MARGIN + BARIS_H * 3) halamanBaru();
    // Gudang lain ditandai di kolom yang sama ("D12 (+D19)") supaya picker tahu harus
    // memeriksa dua rak tanpa perlu kolom tambahan yang mempersempit tabel.
    const lokasi = r.lokasiLain ? `${r.lokasi} (${r.lokasiLain})` : r.lokasi;
    tulisBaris(i + 1, r.nama, r.sku, lokasi, r.qty, false);
  });

  if (normal.length === 0) {
    hal.drawText("(tidak ada baris normal)", { x: MARGIN + 4, y, size: ISI_FS, font: biasa, color: rgb(0.5, 0.5, 0.5) });
    y -= BARIS_H;
  }

  // Tabel kedua: produk bermasalah / dicentang "belum di MP".
  if (bermasalah.length > 0) {
    y -= 10;
    if (y < MARGIN + BARIS_H * 4) halamanBaru();
    else {
      hal.drawLine({ start: { x: MARGIN, y: y + 10 }, end: { x: MARGIN + LEBAR_TABEL, y: y + 10 }, thickness: 0.8 });
      y -= 6;
    }
    hal.drawText(`PERLU SKU - ${bermasalah.length} produk (belum ada SKU di master / belum di MP)`, {
      x: MARGIN, y, size: ISI_FS, font: tebal, color: rgb(0.6, 0.2, 0.2),
    });
    y -= 8;
    tulisHeader();
    bermasalah.forEach((r, i) => {
      if (y < MARGIN + BARIS_H * 3) halamanBaru();
      // SKU yang ditampilkan adalah SKU asal dari file (bila ada) — supaya user bisa
      // mencocokkan dengan berkas marketplace-nya.
      const skuTampil = r.skuAsal || "(tanpa SKU)";
      tulisBaris(i + 1, r.nama, skuTampil, "(belum dipetakan)", r.qty, true);
    });
  }

  if (y < MARGIN + BARIS_H * 6) halamanBaru();
  hal.drawLine({ start: { x: MARGIN, y: y + 10 }, end: { x: MARGIN + LEBAR_TABEL, y: y + 10 }, thickness: 1 });
  hal.drawText("TOTAL", { x: xKolom[3] + 4, y, size: ISI_FS, font: tebal });
  const totalTeks = String(totalUnit);
  hal.drawText(totalTeks, { x: xKolom[4] + KOLOM[4] - tebal.widthOfTextAtSize(totalTeks, ISI_FS) - 6, y, size: ISI_FS, font: tebal });
  y -= 34;

  // Dua kotak tanda tangan: picker mengisi daftar, checker memverifikasi hasilnya.
  const lebarKotak = (LEBAR_TABEL - 30) / 2;
  for (const [i, label] of ["Picker", "Checker"].entries()) {
    const xK = MARGIN + i * (lebarKotak + 30);
    hal.drawText(label, { x: xK, y, size: ISI_FS, font: tebal });
    hal.drawLine({ start: { x: xK, y: y - 40 }, end: { x: xK + lebarKotak, y: y - 40 }, thickness: 0.8 });
    hal.drawText("(nama & tanda tangan)", { x: xK, y: y - 52, size: 7.5, font: biasa, color: rgb(0.45, 0.45, 0.45) });
  }

  hal.drawText(`Halaman ${doc.getPageCount()}`, { x: MARGIN, y: MARGIN - 16, size: 8, font: biasa });
  return doc.save();
}
