// lib/laba/aturanBiaya.ts — Resolver aturan biaya murni (E1, tanpa D1).
// Pencocokan §5.3 v1: jenis + tanggal + status_toko (NULL = semua) + kategori
// (spesifik menang atas '*'); beberapa cocok → priority tertinggi, lalu valid_from terbaru.

export type Aturan = {
  id: number; jenis: string; kategori: string; status_toko: string | null;
  basis: "persen" | "flat"; unit: "per_baris" | "per_order"; nilai: number;
  plafon: number | null; plafon_per_qty: number | null;
  priority: number; valid_from: string; valid_to: string | null; aktif: number;
  kode_program: string | null; ukuran: string | null; syarat_json: string | null;
};

export type KriteriaAturan = {
  jenis: string; kategori: string; status_toko: string; tanggal: string;
};

/** Aturan cocok untuk satu baris? */
export function cocok(
  r: Aturan, k: KriteriaAturan
): boolean {
  if (!r.aktif) return false;
  if (r.jenis !== k.jenis) return false;
  if (r.status_toko && r.status_toko !== k.status_toko) return false;
  if (r.valid_from > k.tanggal) return false;
  if (r.valid_to && r.valid_to < k.tanggal) return false;
  if (r.kategori !== "*" && r.kategori !== k.kategori) return false;
  return true;
}

function banding(a: Aturan, b: Aturan): number {
  const ka = a.kategori === "*" ? 0 : 1;
  const kb = b.kategori === "*" ? 0 : 1;
  if (ka !== kb) return kb - ka;
  const sa = a.status_toko ? 1 : 0;
  const sb = b.status_toko ? 1 : 0;
  if (sa !== sb) return sb - sa;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.valid_from !== b.valid_from) return a.valid_from < b.valid_from ? 1 : -1;
  return a.id - b.id;
}
/** Satu aturan terbaik untuk kriteria, atau null. */
export function pilihAturan(rules: Aturan[], k: KriteriaAturan): Aturan | null {
  let menang: Aturan | null = null;
  for (const r of rules) {
    if (!cocok(r, k)) continue;
    if (!menang || banding(r, menang) < 0) menang = r;
  }
  return menang;
}

/** Fee persen satu baris (plafon per baris bila ada). */
export function feePersen(dasar: number, persen: number, plafon: number | null): number {
  const fee = Math.round((dasar * persen) / 100);
  return plafon != null ? Math.min(fee, plafon) : fee;
}

/** Fee program dengan plafon per kuantitas (D-5): min(persen × dasar, plafon × qty). */
export function feePlafonQty(dasar: number, persen: number, plafonPerQty: number | null, qty: number): number {
  const fee = Math.round((dasar * persen) / 100);
  if (plafonPerQty == null) return fee;
  return Math.min(fee, plafonPerQty * qty);
}
