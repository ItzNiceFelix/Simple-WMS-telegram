// lib/d1/picklistGabungPdf.ts — Picklist mode ketiga: order + advance dalam SATU lembar.
//
// KENAPA mode ini ada: picker sudah mencetak dua dokumen berbeda untuk barang yang diambil
// pada saat yang sama, hanya karena asalnya beda (order vs advance fulfilment). Dia harus
// menyisir rak dua kali. Mode ini menyatukan keduanya jadi satu tabel, tapi TETAP memisahkan
// baris kembali per jenis saat checker memakainya — dokumen checker memang harus berbeda.
//
// Kolom mengikuti kebiasaan lapangan: No | Nama Produk | SKU | Lokasi Gudang | Qty | Cek,
// dengan nama produk diambil dari `products.nama_accurate` (nama D1/Kledo), BUKAN nama dari
// berkas marketplace — nama marketplace sering dipendekkan dan bikin picker salah ambil.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type JenisBarisPick = "order" | "advance";

/** Satu baris mentah sebelum digabung. */
export type BarisPickGabung = {
  jenis: JenisBarisPick;
  sku: string;
  nama: string;
  /** Gudang asal barang diambil. Kosong = belum ditentukan (ditampilkan "-"). */
  lokasi: string;
  qty: number;
  /** Order: no_resi. Advance: booking_sn. Dipakai untuk memilah kembali per dokumen. */
  kunci: string;
  /** Order: no_pesanan. Advance: tujuan kirim (`antar_ke`). */
  kirimKe: string;
};

/** Baris hasil gabungan. `rincian` menyimpan asal-usulnya supaya bisa dipilah lagi. */
export type BarisGabung = {
  nama: string;
  sku: string;
  lokasi: string;
  qty: number;
  rincian: { jenis: JenisBarisPick; kunci: string; kirimKe: string; qty: number }[];
};

const LEBAR = 595.28; // A4 portrait
const TINGGI = 841.89;
const MARGIN = 40;
const JUDUL_FS = 15;
const ISI_FS = 10;
const KECIL_FS = 7.5;
const BARIS_H = 20;
const LEBAR_TABEL = 515;
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
 * mengira barangnya satu tumpukan padahal harus diambil dari dua tempat. Yang digabung
 * hanya pengulangan barang yang sama dari beberapa order/booking.
 */
export function gabungPerSku(baris: BarisPickGabung[]): BarisGabung[] {
  const peta = new Map<string, BarisGabung>();
  for (const b of baris) {
    const kunci = `${b.sku}|${b.lokasi}`;
    let g = peta.get(kunci);
    if (!g) {
      g = { nama: b.nama, sku: b.sku, lokasi: b.lokasi, qty: 0, rincian: [] };
      peta.set(kunci, g);
    }
    g.qty += b.qty;
    g.rincian.push({ jenis: b.jenis, kunci: b.kunci, kirimKe: b.kirimKe, qty: b.qty });
  }
  // Urutan: lokasi dulu, lalu nama — supaya picker menyisir rak satu per satu, bukan
  // bolak-balik antar gudang.
  return [...peta.values()].sort((a, b) => a.lokasi.localeCompare(b.lokasi, "id") || a.nama.localeCompare(b.nama, "id"));
}

type OpsiGabung = { gudangDefault?: string; judul?: string };

/** Picklist gabungan A4: satu tabel, dua kotak tanda tangan (picker & checker). */
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

  const gabung = gabungPerSku(baris);
  const xKolom: number[] = [];
  let x = MARGIN;
  for (const w of KOLOM) {
    xKolom.push(x);
    x += w;
  }

  const totalUnit = gabung.reduce((a, r) => a + r.qty, 0);
  const jmlOrder = baris.filter((b) => b.jenis === "order").length;
  const jmlAdvance = baris.filter((b) => b.jenis === "advance").length;

  let hal = doc.addPage([LEBAR, TINGGI]);
  let y = TINGGI - MARGIN;

  hal.drawText(opsi.judul ?? "PICKLIST - ORDER + ADVANCE", { x: MARGIN, y, size: JUDUL_FS, font: tebal });
  y -= 15;
  hal.drawText("Admin Toko", { x: MARGIN, y, size: ISI_FS, font: tebal });
  y -= 13;
  // Waktu cetak tepat di bawah judul (kebiasaan lapangan: subheader berisi tanggal & jam).
  hal.drawText(`Dicetak ${waktuJakarta()}`, { x: MARGIN, y, size: ISI_FS, font: biasa });
  y -= 13;
  hal.drawText(
    `${opsi.gudangDefault ?? "-"} - ${gabung.length} SKU - ${totalUnit} unit - ${jmlOrder} baris order, ${jmlAdvance} baris advance`,
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

  tulisHeader();
  gabung.forEach((r, idx) => {
    // Rincian dicetak sebagai subbaris kecil; butuh 1 baris utama + n subbaris.
    const tinggiButuh = BARIS_H + r.rincian.length * 9;
    if (y - tinggiButuh < MARGIN + BARIS_H * 3) halamanBaru();

    hal.drawText(String(idx + 1), { x: xKolom[0] + 4, y, size: ISI_FS, font: biasa });
    hal.drawText(potong(r.nama, KOLOM[1] - 8, biasa), { x: xKolom[1] + 4, y, size: ISI_FS, font: biasa });
    hal.drawText(potong(r.sku, KOLOM[2] - 8, biasa), { x: xKolom[2] + 4, y, size: ISI_FS, font: biasa });
    hal.drawText(potong(r.lokasi, KOLOM[3] - 8, biasa), { x: xKolom[3] + 4, y, size: ISI_FS, font: biasa });
    const q = String(r.qty);
    hal.drawText(q, { x: xKolom[4] + KOLOM[4] - tebal.widthOfTextAtSize(q, ISI_FS) - 6, y, size: ISI_FS, font: tebal });
    hal.drawRectangle({
      x: xKolom[5] + 14,
      y: y - 1,
      width: 11,
      height: 11,
      borderWidth: 0.8,
      borderColor: rgb(0.45, 0.45, 0.45),
    });
    y -= 5;

    // Subbaris asal-usul: WAJIB dicetak. Inilah satu-satunya cara checker memisahkan
    // kembali mana yang milik order dan mana yang milik advance dari satu lembar ini.
    for (const d of r.rincian) {
      y -= 9;
      // Hanya ASCII: StandardFonts (WinAnsi) TIDAK bisa meng-encode "→" dan melempar
      // saat mencetak. Pakai "ke" supaya advance tetap terbaca tanpa risiko gagal cetak.
      const label = d.jenis === "order" ? `Order ${d.kunci}${d.kirimKe ? ` / ${d.kirimKe}` : ""}` : `Advance ${d.kunci}${d.kirimKe ? ` ke ${d.kirimKe}` : ""}`;
      hal.drawText(potong(`• ${label} — ${d.qty} unit`, KOLOM[1] + KOLOM[2] + KOLOM[3] - 20, biasa, KECIL_FS), {
        x: xKolom[1] + 10,
        y,
        size: KECIL_FS,
        font: biasa,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
    y -= BARIS_H - 5;
  });

  if (y < MARGIN + BARIS_H * 4) halamanBaru();
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
    hal.drawText("(nama & tanda tangan)", { x: xK, y: y - 52, size: KECIL_FS, font: biasa, color: rgb(0.45, 0.45, 0.45) });
  }

  hal.drawText(`Halaman ${doc.getPageCount()}`, { x: MARGIN, y: MARGIN - 16, size: 8, font: biasa });
  return doc.save();
}
