// lib/printing/deteksiResi.ts — Cari kotak resi di dalam satu halaman. MURNI: menerima
// piksel RGBA, mengembalikan kotak ternormalisasi 0..1. Tanpa canvas, tanpa pdf.js.
//
// KENAPA DETEKSI: label Shopee/TikTok tidak selalu menaruh resi di posisi yang sama.
// Tanpa deteksi, resi panjang mengecil (atau terpotong) dan strip bisa menutup barcode.
//
// TIGA KOTAK:
//   U = seluruh isi halaman (yang terlihat bertinta)
//   H = kotak resi utama — frame tebal berisi alamat, barcode, QR
//   T = bagian di bawah frame (daftar produk, footer), atau null
//
// Frame dikenali dari garis VERTIKAL terpanjang; ujung bawahnya memisahkan H dan T.
// Abu-abu terang (watermark "COD") sengaja diabaikan agar tidak dianggap isi.

/** Kotak ternormalisasi 0..1 dari halaman, y dihitung dari ATAS. */
export type KotakTernormal = { x0: number; y0: number; x1: number; y1: number };

export type InfoResi = { U: KotakTernormal; H: KotakTernormal; T: KotakTernormal | null };

export type HasilDeteksi = { ink: number; info: InfoResi };

export const KOTAK_PENUH: KotakTernormal = { x0: 0, y0: 0, x1: 1, y1: 1 };
export const INFO_PENUH: InfoResi = { U: KOTAK_PENUH, H: KOTAK_PENUH, T: null };

/** Ambang piksel gelap: di bawah ini halaman dianggap kosong (sama dengan `AMBANG_KOSONG`). */
export const AMBANG_KOSONG = 0.002;

/**
 * Fraksi piksel gelap (luminansi < 200).
 *
 * HARUS diukur pada lebar render yang sama dengan kalibrasi ambang (150 px). Pada 300 px,
 * garis teks jadi lebih tajam sehingga porsi piksel abu-abu tepi mengecil dan halaman
 * berisi teks tipis (mis. satu baris "Penerima: Budi") terbaca kosong — regresi nyata.
 */
export function fraksiTinta(d: Uint8ClampedArray, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 0;
  let gelap = 0;
  for (let k = 0; k < d.length; k += 4) {
    if (d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11 < 200) gelap += 1;
  }
  return gelap / (w * h);
}

type KotakPiksel = { l: number; r: number; t: number; b: number };

/**
 * Deteksi kotak dari piksel RGBA (panjang `w*h*4`).
 *
 * `ink` = fraksi piksel gelap (`fraksiTinta`), dipakai pemanggil untuk menandai halaman kosong.
 * Ukur pada lebar render yang SAMA dengan kalibrasi ambang (150 px), lihat `fraksiTinta`.
 */
export function deteksiKotakTinta(d: Uint8ClampedArray, w: number, h: number): HasilDeteksi {
  if (w <= 0 || h <= 0) return { ink: 0, info: INFO_PENUH };
  const dk = new Uint8Array(w * h);
  const run = new Uint16Array(w);
  const best = new Uint16Array(w);
  const end = new Uint16Array(w);

  for (let y = 0, k = 0; y < h; y++) {
    for (let x = 0; x < w; x++, k += 4) {
      const g = d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11;
      if (g < 160) dk[y * w + x] = 1;
      if (g < 190) {
        const v = ++run[x];
        if (v > best[x]) { best[x] = v; end[x] = y; }
      } else run[x] = 0;
    }
  }

  const reg = (ya: number, yb: number): KotakPiksel | null => {
    const cc = new Uint16Array(w);
    let t = -1;
    let b = -1;
    for (let y = ya; y < yb; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) if (dk[y * w + x]) { n += 1; cc[x] += 1; }
      if (n >= 2) { if (t < 0) t = y; b = y; }
    }
    if (t < 0) return null;
    let l = 0;
    while (l < w && cc[l] < 2) l++;
    let r = w - 1;
    while (r > l && cc[r] < 2) r--;
    return l >= r ? null : { l, r: r + 1, t, b: b + 1 };
  };

  const fr = (o: KotakPiksel): KotakTernormal => ({
    x0: Math.max(0, o.l - 2) / w,
    y0: Math.max(0, o.t - 2) / h,
    x1: Math.min(w, o.r + 2) / w,
    y1: Math.min(h, o.b + 2) / h,
  });

  const u = reg(0, h);
  if (!u) return { ink: fraksiTinta(d, w, h), info: INFO_PENUH };

  const U = fr(u);
  let fx = 0;
  for (let x = 1; x < w; x++) if (best[x] > best[fx]) fx = x;

  let H = U;
  let T: KotakTernormal | null = null;
  // Frame hanya dipercaya bila garis vertikalnya cukup panjang — kalau tidak, halaman
  // (mis. label tanpa frame) tetap diperlakukan sebagai satu kotak.
  if (best[fx] >= 0.5 * (u.r - u.l)) {
    const fb = Math.min(h, end[fx] + 2);
    const hh = reg(u.t, fb);
    const tt = reg(fb, h);
    if (hh && tt) {
      H = fr(hh);
      T = fr(tt);
      T.y0 = Math.max(fb, tt.t - 1) / h;
    }
  }

  return { ink: fraksiTinta(d, w, h), info: { U, H, T } };
}
