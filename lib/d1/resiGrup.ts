// lib/d1/resiGrup.ts — Peta 1 No. Resi → N No. Pesanan (F18, Pesanan Gabungan Shopee).
// Satu pass agregasi: resi dipakai >1 order → 'gabungan', sisanya 'tunggal'.
import { sekarang } from "./hasil";

export type ResiGrup = {
  no_resi: string;
  no_json: string;
  jumlah_order: number;
  tipe_pesanan: "gabungan" | "tunggal";
  jasa_kirim: string;
  tipe_layanan: string;
  cod: number;
  preorder: number;
  sesuai_kriteria: number;
  at: number;
};

type BarisOrder = { no_resi: string; no_pesanan: string; jasa_kirim: string; tipe_layanan: string; cod: number; preorder: number };

/** Hitung baris resi_grup dari orders batch (pure — diuji tanpa D1). */
export function hitungResiGrup(rows: BarisOrder[]): Omit<ResiGrup, "at">[] {
  const peta = new Map<string, BarisOrder[]>();
  for (const r of rows) {
    if (!r.no_resi) continue;
    const arr = peta.get(r.no_resi) ?? [];
    arr.push(r);
    peta.set(r.no_resi, arr);
  }
  const hasil: Omit<ResiGrup, "at">[] = [];
  for (const [no_resi, semua] of peta) {
    // `orders` PK (marketplace,no_pesanan) menjamin unik, tapi dedupe di sini melindungi
    // dari baris ganda saat pemanggil memberi snapshot mentah.
    const seen = new Set<string>();
    const list = semua.filter((x) => (seen.has(x.no_pesanan) ? false : (seen.add(x.no_pesanan), true)));
    const no_json = JSON.stringify(list.map((x) => x.no_pesanan).sort());
    const gabungan = list.length > 1;
    const jasaSet = new Set(list.map((x) => x.jasa_kirim));
    const layananSet = new Set(list.map((x) => x.tipe_layanan));
    const cod = list.some((x) => x.cod) ? 1 : 0;
    const preorder = list.some((x) => x.preorder) ? 1 : 0;
    const sesuai = !gabungan || (jasaSet.size === 1 && layananSet.size === 1 && !cod && !preorder);
    hasil.push({
      no_resi,
      no_json,
      jumlah_order: list.length,
      tipe_pesanan: gabungan ? "gabungan" : "tunggal",
      // Bila grup campur (di luar kriteria), simpan nilai terkecil agar deterministik
      // — kelompokkan sama walau urutan baris sumber berbeda.
      jasa_kirim: [...jasaSet].sort()[0] ?? "",
      tipe_layanan: [...layananSet].sort()[0] ?? "",
      cod,
      preorder,
      sesuai_kriteria: sesuai ? 1 : 0,
    });
  }
  return hasil;
}

/**
 * Satu pass agregasi atas `orders` batch → tulis ulang `resi_grup` (idempoten per batch).
 * Resi tunggal tetap ditulis (jumlah_order=1) supaya kode baca seragam.
 */
export async function isiResiGrup(db: D1Database, batchImport: number): Promise<number> {
  const { results } = await db
    .prepare("SELECT no_resi, no_pesanan, jasa_kirim, tipe_layanan, COALESCE(cod,0) AS cod, COALESCE(preorder,0) AS preorder FROM orders WHERE marketplace = 'shopee' AND no_resi <> '' AND batch_import = ?")
    .bind(batchImport)
    .all<BarisOrder>();
  const grup = hitungResiGrup(results);
  const at = sekarang();
  const stmts = grup.map((g) =>
    db
      .prepare(
        "INSERT INTO resi_grup (no_resi, no_json, jumlah_order, tipe_pesanan, jasa_kirim, tipe_layanan, cod, preorder, sesuai_kriteria, at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(no_resi) DO UPDATE SET no_json = excluded.no_json, jumlah_order = excluded.jumlah_order, " +
          "tipe_pesanan = excluded.tipe_pesanan, jasa_kirim = excluded.jasa_kirim, tipe_layanan = excluded.tipe_layanan, cod = excluded.cod, " +
          "preorder = excluded.preorder, sesuai_kriteria = excluded.sesuai_kriteria, at = excluded.at",
      )
      .bind(g.no_resi, g.no_json, g.jumlah_order, g.tipe_pesanan, g.jasa_kirim, g.tipe_layanan, g.cod, g.preorder, g.sesuai_kriteria, at),
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return grup.length;
}

/** Baris `resi_grup` untuk satu resi, atau null. */
export async function ambilResiGrup(db: D1Database, no_resi: string): Promise<ResiGrup | null> {
  return db
    .prepare("SELECT no_resi, no_json, jumlah_order, tipe_pesanan, jasa_kirim, tipe_layanan, cod, preorder, sesuai_kriteria, at FROM resi_grup WHERE no_resi = ?")
    .bind(no_resi)
    .first<ResiGrup>();
}
