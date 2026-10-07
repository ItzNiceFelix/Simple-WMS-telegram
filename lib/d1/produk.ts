// lib/d1/produk.ts — Master produk di D1 (Fase 1, paritas lib/models/produk.js).
// Cache in-memory Firestore TIDAK dibawa (Workers terdistribusi); D1 query
// murah + row-read, bukan per-dokumen. normalisasiNama dipertahankan.
import { gagal, sekarang, type Hasil } from "./db";

export function normalisasiNama(nama: string): string {
  return nama.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF ]/gi, " ").replace(/\s+/g, " ").trim();
}

export type Produk = {
  sku: string;
  nama_accurate: string;
  hpp: number | null;
  hpp_baru: number | null;
  is_online_product: number;
  stok_min: number | null;
};

export async function ambilProduk(db: D1Database, sku: string): Promise<Produk | null> {
  return db
    .prepare("SELECT sku, nama_accurate, hpp, hpp_baru, is_online_product, stok_min FROM products WHERE sku = ?")
    .bind(sku)
    .first<Produk>();
}

export async function tambahProduk(
  db: D1Database,
  sku: string,
  nama: string,
  stokAwal: number,
  oleh: string | null,
  gudangId = "ONLINE"
): Promise<Hasil<{ sku: string }>> {
  const ada = await ambilProduk(db, sku);
  if (ada) return gagal(409, "Kode barang sudah ada.");
  const at = sekarang();
  await db.batch([
    db
      .prepare(`INSERT INTO products (sku, nama_accurate, nama_accurate_normalized, hpp, updated_at)
        VALUES (?, ?, ?, NULL, ?)`)
      .bind(sku, nama, normalisasiNama(nama), at),
    db
      .prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?)")
      .bind(sku, gudangId, stokAwal),
    db
      .prepare(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, created_by, at, by)
        VALUES (?, ?, 'OPENING', ?, 'web_dashboard', 'processed', ?, ?, ?)`)
      .bind(sku, stokAwal, gudangId, oleh, at, oleh),
  ]);
  return { ok: true, sku };
}

export async function ubahHpp(
  db: D1Database,
  sku: string,
  hppBaru: number,
  oleh: string | null
): Promise<Hasil<{ hpp: number }>> {
  if (!Number.isInteger(hppBaru) || hppBaru < 0) return gagal(400, "HPP harus bilangan bulat >= 0.");
  const p = await ambilProduk(db, sku);
  if (!p) return gagal(404, "Produk tidak ditemukan.");
  const at = sekarang();
  await db.batch([
    db.prepare("UPDATE products SET hpp = ?, updated_at = ? WHERE sku = ?").bind(hppBaru, at, sku),
    db
      .prepare("INSERT INTO product_changes (sku, field, lama, baru, oleh, at) VALUES (?, 'hpp', ?, ?, ?, ?)")
      .bind(sku, p.hpp == null ? null : String(p.hpp), String(hppBaru), oleh, at),
  ]);
  return { ok: true, hpp: hppBaru };
}

export async function toggleOnline(
  db: D1Database,
  sku: string,
  isOnline: boolean,
  oleh: string | null
): Promise<Hasil<{ is_online_product: boolean }>> {
  const p = await ambilProduk(db, sku);
  if (!p) return gagal(404, "Produk tidak ditemukan.");
  await db
    .prepare("UPDATE products SET is_online_product = ?, online_updated_by = ?, updated_at = ? WHERE sku = ?")
    .bind(isOnline ? 1 : 0, oleh, sekarang(), sku);
  return { ok: true, is_online_product: isOnline };
}

export async function cariProduk(
  db: D1Database,
  kataKunci: string,
  maksHasil = 10
): Promise<{ sku: string; nama_accurate: string }[]> {
  const norm = `%${normalisasiNama(kataKunci)}%`;
  const { results } = await db
    .prepare(
      `SELECT sku, nama_accurate FROM products
       WHERE nama_accurate_normalized LIKE ?
       OR sku IN (SELECT sku FROM product_search_keywords WHERE keyword LIKE ?)
       LIMIT ?`
    )
    .bind(norm, norm, maksHasil)
    .all<{ sku: string; nama_accurate: string }>();
  return results;
}

export async function tambahKeyword(
  db: D1Database,
  sku: string,
  keyword: string
): Promise<void> {
  const norm = keyword.trim().toLowerCase();
  if (!norm) return;
  await db
    .prepare("INSERT OR IGNORE INTO product_search_keywords (sku, keyword) VALUES (?, ?)")
    .bind(sku, norm)
    .run();
}
