// lib/printing/urutanCetak.ts — Urutan cetak bertahap. MURNI: tanpa DOM, tanpa PDF.
//
// Empat urutan, sama dengan alat referensi:
//   "off"  — sesuai berkas & halaman
//   "sku"  — SKU → Nama Produk → Variasi
//   "nama" — Nama Produk → Variasi → SKU
//   "qty"  — qty 1 dulu, qty 2, 3, …, multi-item paling akhir (dalam grup: SKU → nama → variasi)
//   "qtyNama" — sama, tetapi dalam grup: nama → variasi → SKU
//
// Resi yang tabel produknya tidak terbaca ditaruh paling akhir dengan urutan asli: lebih baik
// menyisipkan satu resi di tempat yang salah daripada menukar urutan seluruh tumpukan.
import type { QtyHalaman } from "./penandaQty";

export type Urutan = "off" | "sku" | "nama" | "qty" | "qtyNama";

/** Satu halaman yang ikut disortir. `n` = posisi asli (pemecah seri yang stabil). */
export type HalamanUrut = { n: number; qty: QtyHalaman };

const NC = new Intl.Collator("id", { numeric: true, sensitivity: "base" });

/** Bandingkan string: kosong selalu di belakang. */
export function cmpS(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return NC.compare(a, b);
}

const KUNCI_SKU = ["sku", "name", "vari"] as const;
const KUNCI_NAMA = ["name", "vari", "sku"] as const;

/** Bandingkan daftar baris produk dua halaman (baris demi baris). */
export function cmpRows(A: QtyHalaman["rows"], B: QtyHalaman["rows"], pakaiNama: boolean): number {
  const k = pakaiNama ? KUNCI_NAMA : KUNCI_SKU;
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    for (const x of k) {
      const c = cmpS(A[i][x], B[i][x]);
      if (c) return c;
    }
  }
  return A.length - B.length;
}

/** Nilai grup qty: 1, 2, 3, … ; multi-item = besar sekali; tak terbaca = paling besar. */
export const GRUP_MULTI = 1e6;
export const GRUP_TIDAK_TERBACA = 1e9;

export function grupQty(q: QtyHalaman): number {
  if (!q.rows.length) return GRUP_TIDAK_TERBACA;
  if (q.rows.length > 1) return GRUP_MULTI;
  return q.rows[0].v;
}

export function namaGrup(g: number): string {
  if (g === GRUP_TIDAK_TERBACA) return "Tidak terbaca / kosong (urutan asli)";
  if (g === GRUP_MULTI) return "Multi item";
  return `Qty ${g}`;
}

/** Urutkan daftar halaman; mengembalikan larik BARU. */
export function urutkanHalaman<T extends HalamanUrut>(daftar: T[], urutan: Urutan): T[] {
  if (urutan === "off") return [...daftar];
  const pakaiNama = urutan === "nama" || urutan === "qtyNama";
  const pakaiGrup = urutan === "qty" || urutan === "qtyNama";
  return [...daftar].sort((a, b) => {
    if (pakaiGrup) {
      const d = grupQty(a.qty) - grupQty(b.qty);
      if (d) return d;
    }
    const A = a.qty.rows;
    const B = b.qty.rows;
    if (!A.length || !B.length) {
      if (A.length !== B.length) return A.length ? -1 : 1;
      return a.n - b.n;
    }
    return cmpRows(A, B, pakaiNama) || a.n - b.n;
  });
}
