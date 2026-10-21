// lib/printing/penandaQty.ts — Baca kolom Qty dari teks PDF, lalu susun penanda qty. MURNI.
//
// KENAPA DIBACA DARI TEKS PDF, BUKAN DARI SISTEM: label yang dicetak bisa berasal dari
// marketplace mana pun dan halaman ini sengaja tidak butuh data order. Teks label adalah
// satu-satunya sumber yang selalu tersedia.
//
// DUA GAYA PENANDA:
//   "kotak"  — kotak hitam ×N menimpa angka asli (gaya lama, angka tidak terbaca)
//   "bentuk" — lingkaran / kotak / centang di sekitar angka asli (angka tetap terbaca)
import type { Bagian } from "./tataLetak";

/** Satu baris produk pada satu halaman resi. */
export type BarisQty = {
  v: number;
  /** Posisi dalam koordinat PDF (pt, y dari BAWAH). */
  x: number;
  y: number;
  w: number;
  fs: number;
  name: string;
  sku: string;
  vari: string;
};

export type QtyHalaman = { rows: BarisQty[]; total: number };

export type KolomQty = "name" | "sku" | "sell" | "var" | "qty" | "no" | "x";

/** Satu item teks PDF yang sudah dinormalkan (subset `TextItem` pdf.js). */
export type ItemTeks = { str: string; transform: number[]; width: number };

/**
 * Nama kolom dari teks header. Shopee: `SKU` = SKU, `Variasi` = variasi.
 * TikTok/Tokopedia: `SKU` = variasi, `Seller SKU` = SKU toko — dibedakan lewat `hasSell`.
 */
export function kolomDariHeader(t: string): KolomQty {
  if (/^(nama\s*produk|product\s*name|produk|product)$/i.test(t)) return "name";
  if (/^seller\s*sku$/i.test(t)) return "sell";
  if (/^sku$/i.test(t)) return "sku";
  if (/^(variasi|variation|varian)$/i.test(t)) return "var";
  if (/^qty$/i.test(t)) return "qty";
  return "x";
}

/** Ambang jarak vertikal untuk menganggap dua item satu baris. */
const BARIS_TOL = 1;

/**
 * Baca tabel qty satu halaman dari item teks pdf.js.
 *
 * `rotate` halaman bukan 0 → hasil kosong: koordinat teks pada halaman diputar tidak bisa
 * dipetakan ke kotak resi tanpa matriks tambahan, dan menebak lebih buruk daripada tidak.
 */
export function bacaQtyHalaman(items: ItemTeks[], rotate = 0): QtyHalaman {
  const kosong: QtyHalaman = { rows: [], total: 0 };
  if (rotate) return kosong;

  const it = items
    .filter((t) => t.str && t.str.trim())
    .map((t) => ({
      s: t.str.trim(),
      x: t.transform[4],
      y: t.transform[5],
      w: t.width,
      fs: Math.hypot(t.transform[2], t.transform[3]),
    }));

  const hd = it.filter((t) => t.s === "Qty").sort((a, b) => b.y - a.y)[0];
  if (!hd) return kosong;

  const hc = hd.x + hd.w / 2;
  const tol = Math.max(hd.w * 0.8, hd.fs);
  const st = it.filter((t) => t.y < hd.y - 1 && /^(Qty Total|Total|Pesan)/i.test(t.s)).map((t) => t.y);
  const stop = st.length ? Math.max(...st) : -1e9;

  const rows: BarisQty[] = it
    .filter((t) => /^\d{1,3}$/.test(t.s) && +t.s >= 1 && t.y < hd.y - 1 && t.y > stop + 2 && Math.abs(t.x + t.w / 2 - hc) <= tol)
    .sort((a, b) => b.y - a.y)
    .map((t) => ({ v: +t.s, x: t.x, y: t.y, w: t.w, fs: t.fs, name: "", sku: "", vari: "" }));

  const cols = it
    .filter((t) => Math.abs(t.y - hd.y) < hd.fs * 0.6)
    .map((t) => ({ x: t.x, k: t.s === "#" ? "no" : kolomDariHeader(t.s) }))
    .sort((a, b) => a.x - b.x);
  const hasSell = cols.some((c) => c.k === "sell");

  rows.forEach((r, j) => {
    const hi = r.y + r.fs * 0.6;
    const lo = j + 1 < rows.length ? rows[j + 1].y + rows[j + 1].fs * 0.6 : Math.max(stop + 2, r.y - 5 * r.fs);
    const cell: Record<string, string[]> = { name: [], sku: [], sell: [], var: [] };
    it
      .filter((t) => t.y <= hi && t.y > lo)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .forEach((t) => {
        let c: { k: KolomQty } | null = null;
        for (const q of cols) if (q.x <= t.x + 2.5) c = q;
        if (c && cell[c.k]) cell[c.k].push(t.s);
      });
    const J = (a: string[]) => a.join(" ").replace(/\s+/g, " ").trim();
    r.name = J(cell.name);
    if (hasSell) { r.sku = J(cell.sell); r.vari = J(cell.sku) || J(cell.var); }
    else { r.sku = J(cell.sku); r.vari = J(cell.var); }
  });

  return { rows, total: rows.reduce((a, r) => a + r.v, 0) };
}

/** Mode penandaan qty. */
export type ModeQty = "lebih" | "multi" | "semua" | "mati";
/** Gaya penanda: kotak hitam lama, atau bentuk di sekitar angka asli. */
export type GayaQty = "kotak" | "lingkar" | "persegi" | "centang";

export type PenandaQty = {
  /** Lembar tujuan (0 = utama, 1 = sambungan). */
  pg: number;
  /** Pusat penanda di lembar cetak (mm). */
  cx: number;
  cy: number;
  /** Lebar angka asli (mm) — dipakai menghitung bentuk. */
  nw: number;
  /** Tinggi font angka (mm). */
  fs: number;
  /** Qty 1 yang ikut ditandai memakai garis lebih tipis. */
  tipis: boolean;
  /** Hanya untuk gaya kotak. */
  teks?: { txt: string; isi: boolean; ts: number };
};

/** Bentuk penanda dalam mm (y dari atas): elips, persegi, atau garis patah. */
export type Bentuk = {
  t: "e" | "r" | "l";
  lw: number;
  cx?: number; cy?: number; rx?: number; ry?: number;
  x?: number; y?: number; w?: number; h?: number;
  p?: [number, number][];
};

/**
 * Hitung penanda qty untuk satu halaman.
 *
 * Posisi diambil dari koordinat teks asli (pt, y dari bawah), lalu diproyeksikan ke kotak
 * yang menampungnya (`pl.parts`). Penanda yang jatuh di luar semua kotak dibuang: lebih
 * baik tidak menandai daripada menggambar garis di tempat yang salah.
 */
export function penandaQty(
  rows: BarisQty[] | undefined,
  w: number,
  h: number,
  pl: { parts: Bagian[] },
  mode: ModeQty,
  gaya: GayaQty
): PenandaQty[] {
  const out: PenandaQty[] = [];
  if (mode === "mati" || !rows || rows.length === 0) return out;
  const multi = rows.length > 1;

  for (const r of rows) {
    const besar = r.v > 1;
    if (!besar && !(mode === "semua" || (mode === "multi" && multi))) continue;
    const cy = h - r.y - 0.36 * r.fs;
    const cx = r.x + r.w / 2;
    const q = pl.parts.find((p) => cy >= p.y0 && cy <= p.y1 && cx >= p.x0 - 2 && cx <= p.x1 + 2);
    if (!q) continue;
    const k = q.dw / Math.max(1, q.x1 - q.x0);
    const dasar = {
      pg: q.pg,
      cx: q.dx + (cx - q.x0) * k,
      cy: q.dy + (cy - q.y0) * k,
      nw: r.w * k,
      fs: r.fs * k,
      tipis: !besar,
    };
    if (gaya === "kotak") {
      out.push({ ...dasar, teks: { txt: `×${r.v}`, isi: besar, ts: r.fs * 1.2 * k } });
    } else {
      out.push(dasar);
    }
  }
  return out;
}

/** Bentuk untuk penanda gaya "bentuk" (lingkar/persegi/centang). */
export function bentukPenanda(m: PenandaQty, gaya: Exclude<GayaQty, "kotak">): Bentuk[] {
  const f = m.fs;
  const lw = Math.max(0.25, 0.13 * f) * (m.tipis ? 0.55 : 1);
  if (gaya === "lingkar") {
    const ry = 0.78 * f;
    const rx = Math.max(ry, m.nw / 2 + 0.5 * f);
    return [{ t: "e", cx: m.cx, cy: m.cy, rx, ry, lw }];
  }
  if (gaya === "persegi") {
    const bh = 1.45 * f;
    const bw = Math.max(bh, m.nw + 0.8 * f);
    return [{ t: "r", x: m.cx - bw / 2, y: m.cy - bh / 2, w: bw, h: bh, lw }];
  }
  const s = 0.95 * f;
  const x0 = m.cx - m.nw / 2 - 0.5 * f - s;
  return [{ t: "l", p: [[x0, m.cy], [x0 + 0.4 * s, m.cy + 0.45 * f], [x0 + s, m.cy - 0.5 * f]], lw: lw * 1.4 }];
}

/** Kotak latar teks "×N" pada gaya lama. */
export function kotakTeks(m: PenandaQty & { teks: { txt: string; isi: boolean; ts: number } }, lebarTeks: number): { x: number; y: number; w: number; h: number } {
  const w = lebarTeks + 0.55 * m.teks.ts;
  const h = 1.15 * m.teks.ts;
  return { x: m.cx - w / 2, y: m.cy - h / 2, w, h };
}
