// lib/printing/tataLetak.ts — Rencana tata letak satu halaman resi → 1 atau 2 lembar. MURNI.
//
// SATU LEMBAR: seluruh isi halaman diskalakan ke kotak resi.
// DUA LEMBAR (resi panjang / multi item): kotak resi utama (H) dicetak ukuran standar di
// lembar 1, bagian bawahnya (T = daftar produk) dipindah ke lembar 2. Hanya dipakai bila
// pengecilan satu-lembar melewati ambang (default 85%) — di bawah itu barcode tidak ter-scan.
//
// Semua angka keluaran dalam MILIMETER halaman cetak, y dari ATAS; `x0..y1` tetap dalam
// satuan halaman PDF asli karena dipakai langsung oleh `embedPage`.
import type { InfoResi } from "./deteksiResi";

/** Satu potongan halaman sumber yang ditempel ke satu lembar cetak. */
export type Bagian = {
  /** Lembar ke berapa di dalam satu resi: 0 = lembar utama (dapat strip), 1 = sambungan. */
  pg: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Ukuran & posisi tempel (mm, dari kiri-atas). */
  dw: number;
  dh: number;
  dx: number;
  dy: number;
};

export type Rencana = { pecah: boolean; parts: Bagian[] };

export type OpsiRencana = {
  /** Tinggi lembar cetak (mm). */
  tinggiMm: number;
  /** Potong bawah halaman asli (mm). */
  cropMm: number;
  /** Kotak resi di lembar cetak (mm). */
  resi: { x: number; y: number; w: number; h: number };
  /** `auto` = pecah bila perlu; `kecil` = selalu satu lembar. */
  mode: "auto" | "kecil";
  /** Ambang pecah: rasio pengecilan satu-lembar terhadap skala kotak resi. */
  ambangPecah: number;
};

/** Sisa ruang minimum di bawah kotak resi agar sambungan masih terbaca. */
const SISA_MIN_MM = 3;

/** Potongan halaman sumber dalam satuan PDF asli (pt), sudah dipotong bawahnya. */
export type Segmen = { x0: number; x1: number; y0: number; y1: number; cw: number; ch: number };

export function rencanaHalaman(info: InfoResi | null, w: number, h: number, o: OpsiRencana): Rencana {
  const cut = Math.max(0, Math.min(o.cropMm, h - 40));
  const bw = o.resi.w;
  const bh = o.resi.h;

  const seg = (b: { x0: number; y0: number; x1: number; y1: number }, potong: number): Segmen => {
    const y0 = b.y0 * h;
    const y1 = Math.max(y0 + 20, b.y1 * h - potong);
    const x0 = b.x0 * w;
    const x1 = b.x1 * w;
    return { x0, x1, y0, y1, cw: Math.max(1, x1 - x0), ch: Math.max(1, y1 - y0) };
  };
  const place = (q: Segmen, k: number, pg: number, atas: number): Bagian => ({
    pg,
    x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1,
    dw: q.cw * k, dh: q.ch * k,
    dx: o.resi.x + (bw - q.cw * k) / 2,
    dy: atas,
  });

  const u = seg(info?.U ?? { x0: 0, y0: 0, x1: 1, y1: 1 }, cut);
  const kU = Math.min(bw / u.cw, bh / u.ch);
  const satu: Rencana = { pecah: false, parts: [place(u, kU, 0, o.resi.y)] };

  if (!info || !info.T || o.mode !== "auto") return satu;

  const hd = seg(info.H, 0);
  const kH = Math.min(bw / hd.cw, bh / hd.ch);
  if (kU / kH >= o.ambangPecah) return satu;

  const tl = seg(info.T, cut);
  const sisa = o.tinggiMm - o.resi.y - SISA_MIN_MM;
  if (sisa <= 0) return satu;
  const kT = Math.min(kH, bw / tl.cw, sisa / tl.ch);
  return { pecah: true, parts: [place(hd, kH, 0, o.resi.y), place(tl, kT, 1, o.resi.y)] };
}
