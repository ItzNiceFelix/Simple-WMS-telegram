// lib/printing/ekstraksi.ts — Ambil nomor pesanan & nomor resi dari TEKS label pengiriman.
// MURNI: menerima teks, mengembalikan nomor. Tanpa pdf.js, tanpa DOM, tanpa jaringan.
//
// KENAPA BERJENJANG:
//   Hasil uji pada sampel nyata (SPX, JNE, Anteraja, Instant, TikTok) menunjukkan tidak ada
//   satu pola yang berlaku untuk semua:
//     - SPX      : "Resi: SPXID06668320437A"
//     - JNE      : "No. Resi: CM03230749348"
//     - Anteraja : "No. Resi: 11004533974115"
//     - Instant  : TIDAK menulis "No. Resi" sama sekali (resi ada di barcode)
//     - TikTok   : PDF-nya gambar murni (tidak ada teks)
//   Karena itu jalur utamanya bukan nomor resi, melainkan **No. Pesanan** yang tertulis di
//   SEMUA label ("No. Pesanan: 261017T83MDDK4") dan sudah menjadi kunci di sistem kita.
//
// PRINSIP: keluaran adalah SARAN, bukan keputusan. Halaman Printing tetap boleh mencetak
// label yang nomornya tidak terbaca; hanya pencatatan "sudah dicetak" yang dilewati.

/** Satu nomor yang berhasil dibaca dari teks label. */
export type NomorLabel = {
  noPesanan: string | null;
  noResi: string | null;
  /** Marketplace yang dikenali dari pola nomor; null bila tidak yakin. */
  marketplace: "shopee" | "tiktok" | "lain" | null;
};

/**
 * Pola nomor resi yang TERVERIFIKASI dari sampel. Urut dari paling spesifik ke paling umum:
 * pola longgar didahulukan akan menangkap potongan lain (nomor HP, kode pos) lebih dulu.
 */
const POLA_RESI: { pola: RegExp; mp: NomorLabel["marketplace"] }[] = [
  // SPX / Shopee Express: "SPXID" + 10-17 alfanumerik.
  { pola: /\bSPX(?:ID|ID[A-Z0-9]*)?[A-Z0-9]{8,20}\b/, mp: "shopee" },
  // JNE: "CM" + 10-12 digit (format resi JNE yang lazim).
  { pola: /\bCM\d{9,14}\b/, mp: "lain" },
  // J&T: "JP" + 10-13 digit.
  { pola: /\bJP\d{10,14}\b/, mp: "lain" },
  // Anteraja: 14 digit polos (harus setelah label "No. Resi").
  { pola: /\b\d{14}\b/, mp: "lain" },
];

/** Nomor pesanan Shopee: 6 digit tanggal + "T" + alfanumerik (mis. 261017T83MDDK4). */
const POLA_PESANAN = /\b\d{6}T[A-Z0-9]{6,12}\b/;

/** Nomor pesanan TikTok/Tokopedia umumnya digit panjang; dipakai hanya bila label eksplisit. */
const POLA_PESANAN_UMUM = /\b\d{10,20}\b/;

/** Ambil kata setelah sebuah label, mis. "No. Resi: ABC" → "ABC". */
function setelahLabel(teks: string, label: RegExp): string | null {
  const m = label.exec(teks);
  if (!m) return null;
  // Ambil 40 karakter setelah label, lalu potong di pemisah pertama.
  const ekor = teks.slice(m.index + m[0].length, m.index + m[0].length + 40);
  const kandidat = ekor.replace(/^[\s:.]*/, "").split(/[\s,;|]/)[0] ?? "";
  return kandidat.length >= 6 ? kandidat : null;
}

/**
 * Baca nomor dari teks satu halaman label.
 *
 * Teks input biasanya hasil ekstraksi PDF yang menyisipkan spasi aneh ("T ap" untuk "Tap"),
 * jadi semua pencocokan memakai teks yang spasinya sudah dinormalkan.
 */
export function bacaNomorLabel(teks: string): NomorLabel {
  const t = teks.replace(/\s+/g, " ");

  // 1. Nomor pesanan — jalur utama. Label Shopee menulis "No.Pesanan:" tanpa spasi.
  let noPesanan = setelahLabel(t, /No\.?\s*Pesanan\s*:?/i);
  if (!noPesanan || !/^\d{6}T[A-Z0-9]{6,12}$/i.test(noPesanan)) {
    const umum = POLA_PESANAN.exec(t) ?? POLA_PESANAN_UMUM.exec(t);
    noPesanan = umum ? umum[0] : noPesanan;
  }
  if (noPesanan && !/^[A-Z0-9-]{6,24}$/i.test(noPesanan)) noPesanan = null;

  // 2. Nomor resi — dicari PERTAMA di sekitar label "Resi", baru pola global.
  //    Urutan ini penting: angka 14 digit juga muncul sebagai nomor telepon/kode pos.
  let noResi = setelahLabel(t, /No\.?\s*Resi\s*:?/i) ?? setelahLabel(t, /\bResi\s*:?/i);
  if (noResi && !/^[A-Z]{0,4}[A-Z0-9-]{8,24}$/i.test(noResi)) noResi = null;
  if (!noResi) {
    for (const p of POLA_RESI) {
      const m = p.pola.exec(t);
      if (m) { noResi = m[0]; break; }
    }
  }

  let marketplace: NomorLabel["marketplace"] = null;
  if (noResi?.startsWith("SPX") || (noPesanan ?? "").match(POLA_PESANAN)) marketplace = "shopee";
  else if (noResi) marketplace = "lain";
  // TikTok: label biasanya menyebut "TikTok" tanpa pola resi yang seragam.
  if (/\btiktok\b/i.test(t)) marketplace = "tiktok";

  return { noPesanan: noPesanan ?? null, noResi: noResi ?? null, marketplace };
}

/**
 * Gabungkan teks SEMUA halaman satu resi menjadi satu hasil.
 *
 * Halaman pertama label memuat nomor; halaman lanjutan (resume item) biasanya tidak.
 * Mengambil halaman pertama yang menghasilkan nomor menghindari halaman lanjutan
 * menimpa hasil yang sudah benar.
 */
export function bacaNomorDariHalaman(teksHalaman: string[]): NomorLabel {
  let hasil: NomorLabel = { noPesanan: null, noResi: null, marketplace: null };
  for (const teks of teksHalaman) {
    const n = bacaNomorLabel(teks);
    hasil = {
      noPesanan: hasil.noPesanan ?? n.noPesanan,
      noResi: hasil.noResi ?? n.noResi,
      marketplace: hasil.marketplace ?? n.marketplace,
    };
    if (hasil.noPesanan && hasil.noResi) break;
  }
  return hasil;
}
