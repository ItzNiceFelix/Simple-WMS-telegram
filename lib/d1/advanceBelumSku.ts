// lib/d1/advanceBelumSku.ts — Fase C/D helper: booking advance, tebak SKU, sku_belum_mp, compare nama.
// Satu file per Fase C+D supaya diff pendek; tiap blok tetap fungsi murni/DB terpisah.
import { gagal, sekarang, type Hasil } from "./hasil";

// ---------- C1: advance_bookings ----------

export type BookingInput = {
  booking_sn: string;
  no_resi: string;
  sku: string;
  variasi: string;
  nama_produk: string;
  opsi_kirim: string;
  antar_ke: string;
  booking_at: string;
  batas_kirim: string;
};

export type BookingRow = BookingInput & { qty: number; status: string; batch_import: number | null; dikirim_at: number | null; dikirim_oleh: string | null; at: number };

/** Simpan booking (INSERT OR IGNORE → idempoten, aturan 3e). Kembalikan jumlah baris baru. */
export async function simpanBooking(db: D1Database, bookings: BookingInput[], batchImport: number | null): Promise<number> {
  if (bookings.length === 0) return 0;
  const at = sekarang();
  const stmts = bookings.map((b) =>
    db
      .prepare(
        "INSERT OR IGNORE INTO advance_bookings (booking_sn, no_resi, sku, variasi, nama_produk, opsi_kirim, antar_ke, booking_at, batas_kirim, qty, status, batch_import, at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'menunggu', ?, ?)",
      )
      .bind(b.booking_sn, b.no_resi, b.sku, b.variasi, b.nama_produk, b.opsi_kirim, b.antar_ke, b.booking_at, b.batas_kirim, batchImport, at),
  );
  let masuk = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const hasil = await db.batch(stmts.slice(i, i + 50));
    for (const h of hasil) masuk += h.meta.changes ?? 0;
  }
  return masuk;
}

/** Daftar booking, filter status opsional, terbaru dulu. */
export async function listBooking(db: D1Database, filter: { status?: string; limit?: number } = {}): Promise<BookingRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  const sql =
    "SELECT booking_sn, no_resi, sku, variasi, nama_produk, opsi_kirim, antar_ke, booking_at, batas_kirim, qty, status, batch_import, dikirim_at, dikirim_oleh, at " +
    "FROM advance_bookings" +
    (filter.status ? " WHERE status = ?" : "") +
    " ORDER BY at DESC, booking_sn DESC LIMIT ?";
  const stmt = db.prepare(sql);
  const { results } = await (filter.status ? stmt.bind(filter.status, limit) : stmt.bind(limit)).all<BookingRow>();
  return results;
}

/**
 * Kirim booking ke Gudang Shopee: CAS status menunggu→terkirim.
 *
 * STOK TIDAK DISENTUH. Sejak integrasi Kledo (2026-10-14) potong stok dilakukan admin
 * Kledo, dan sinkron Kledo menimpa penuh `stock_by_bin` gudang non-ONLINE. Menulis stok
 * di sini akan membuat nilai WMS dan Kledo saling membalik tiap sinkron.
 *
 * 409 bila sudah terkirim/batal.
 */
export async function kirimKeShopee(
  db: D1Database,
  bookingSn: string,
  oleh: string | null,
): Promise<Hasil<{ booking_sn: string; qty: number }>> {
  const b = await ambilBooking(db, bookingSn);
  if (!b) return gagal(404, "Booking tidak ditemukan.");
  if (b.status !== "menunggu") return gagal(409, `Booking sudah ${b.status}.`);
  const at = sekarang();
  const cas = await db
    .prepare("UPDATE advance_bookings SET status = 'terkirim', dikirim_at = ?, dikirim_oleh = ? WHERE booking_sn = ? AND status = 'menunggu'")
    .bind(at, oleh, bookingSn)
    .run();
  if ((cas.meta.changes ?? 0) !== 1) return gagal(409, "Booking sudah diproses.");
  return { ok: true, booking_sn: bookingSn, qty: b.qty };
}

/** Batalkan booking (hanya yang masih menunggu). */
export async function batalkanBooking(db: D1Database, bookingSn: string, oleh: string | null): Promise<Hasil<{ booking_sn: string }>> {
  const b = await ambilBooking(db, bookingSn);
  if (!b) return gagal(404, "Booking tidak ditemukan.");
  if (b.status !== "menunggu") return gagal(409, `Booking sudah ${b.status}.`);
  const r = await db
    .prepare("UPDATE advance_bookings SET status = 'batal', dikirim_at = ?, dikirim_oleh = ? WHERE booking_sn = ? AND status = 'menunggu'")
    .bind(sekarang(), oleh, bookingSn)
    .run();
  if ((r.meta.changes ?? 0) !== 1) return gagal(409, "Booking sudah diproses.");
  return { ok: true, booking_sn: bookingSn };
}

/** Satu booking by SN; null bila tak ada. */
export async function ambilBooking(db: D1Database, bookingSn: string): Promise<BookingRow | null> {
  return db
    .prepare(
      "SELECT booking_sn, no_resi, sku, variasi, nama_produk, opsi_kirim, antar_ke, booking_at, batas_kirim, qty, status, batch_import, dikirim_at, dikirim_oleh, at FROM advance_bookings WHERE booking_sn = ?",
    )
    .bind(bookingSn)
    .first<BookingRow>();
}

// ---------- D1: tebak SKU ----------

export type KandidatSku = { sku: string; nama: string; skor: number };
export type TebakanSku = { sku: string; perlu_pilih_manual: boolean; kandidat: KandidatSku[] };

/** Normalisasi KETAT: uppercase, buang semua non-alfanumerik, rapatkan spasi. */
export function normalisasiKata(s: string): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Skor 0..1: 1 = persis; selain itu kemiripan token (kandidat saja, TIDAK auto-isi). */
export function skorMirip(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sa = new Set(a.split(" "));
  const sb = new Set(b.split(" "));
  let irisan = 0;
  for (const t of sa) if (sb.has(t)) irisan++;
  return irisan / new Set([...sa, ...sb]).size;
}

type SumberSku = { sku: string; nama: string };

/**
 * Tebak SKU dari `Nama Produk Shopee` + `Nama Variasi`. Auto-isi HANYA bila salah satu
 * sumber (products.nama_accurate_normalized / product_search_keywords / mp_products.nama_mp)
 * cocok PERSIS setelah normalisasi ketat. Selain itu kandidat + skor, wajib pilih manual.
 */
export async function tebakSku(db: D1Database, namaShopee: string, variasi: string): Promise<TebakanSku> {
  const target = normalisasiKata(`${namaShopee} ${variasi}`);
  const kandidat: KandidatSku[] = [];
  const lihat = async (sql: string, args: unknown[]): Promise<void> => {
    const { results } = await db.prepare(sql).bind(...args).all<SumberSku>();
    for (const r of results) {
      const n = normalisasiKata(r.nama);
      if (!n) continue;
      const s = skorMirip(target, n);
      if (s <= 0) continue;
      const lama = kandidat.find((k) => k.sku === r.sku);
      if (!lama) kandidat.push({ sku: r.sku, nama: r.nama, skor: s });
      else if (s > lama.skor) lama.skor = s;
    }
  };
  await lihat("SELECT sku, nama_accurate AS nama FROM products WHERE nama_accurate_normalized = ? LIMIT 20", [target]);
  await lihat("SELECT sku, nama_accurate AS nama FROM products WHERE UPPER(REPLACE(REPLACE(nama_accurate_normalized, '-', ''), ' ', '')) = ? LIMIT 20", [target.replace(/ /g, "")]);
  await lihat("SELECT p.sku AS sku, p.nama_accurate AS nama FROM product_search_keywords k JOIN products p ON p.sku = k.sku WHERE k.keyword = ? LIMIT 20", [target]);
  await lihat("SELECT sku, nama_mp AS nama FROM mp_products WHERE UPPER(REPLACE(REPLACE(nama_mp, '-', ''), ' ', '')) = ? LIMIT 20", [target.replace(/ /g, "")]);
  kandidat.sort((a, b) => b.skor - a.skor || a.sku.localeCompare(b.sku));
  const persis = kandidat.find((k) => skorMirip(target, normalisasiKata(k.nama)) === 1);
  if (persis) return { sku: persis.sku, perlu_pilih_manual: false, kandidat };
  return { sku: "", perlu_pilih_manual: true, kandidat: kandidat.slice(0, 10) };
}

// ---------- D2: sku_belum_mp ----------

export type BelumMpRow = {
  nama_shopee: string; variasi: string; order_ref: string; sejak: string; at: number;
  by: string | null; sumber: string; sku_asal: string; qty_total: number;
};

/** UPSERT tag "belum ada SKU di MP" (PK nama_shopee+variasi). */
export async function tandaiBelumMp(
  db: D1Database,
  data: { namaShopee: string; variasi: string; orderRef: string; oleh: string | null; sumber?: string; skuAsal?: string; qtyTotal?: number }
): Promise<void> {
  const nama = data.namaShopee.trim();
  const variasi = data.variasi.trim();
  const sejak = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO sku_belum_mp (nama_shopee, variasi, order_ref, sejak, at, by, sumber, sku_asal, qty_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(nama_shopee, variasi) DO UPDATE SET order_ref = excluded.order_ref, sejak = excluded.sejak, at = excluded.at, by = excluded.by, " +
        "sumber = excluded.sumber, sku_asal = excluded.sku_asal, qty_total = excluded.qty_total",
    )
    .bind(nama, variasi, data.orderRef, sejak, sekarang(), data.oleh, data.sumber ?? "order", data.skuAsal ?? "", data.qtyTotal ?? 0)
    .run();
}

/** Semua tag belum-MP, terbaru dulu. */
export async function listBelumMp(db: D1Database): Promise<BelumMpRow[]> {
  const { results } = await db
    .prepare("SELECT nama_shopee, variasi, order_ref, sejak, at, by, sumber, sku_asal, qty_total FROM sku_belum_mp ORDER BY at DESC LIMIT 500")
    .all<BelumMpRow>();
  return results;
}

/** Hapus tag (1 bila terhapus). */
export async function hapusBelumMp(db: D1Database, namaShopee: string, variasi: string): Promise<number> {
  const r = await db.prepare("DELETE FROM sku_belum_mp WHERE nama_shopee = ? AND variasi = ?").bind(namaShopee.trim(), variasi.trim()).run();
  return r.meta.changes ?? 0;
}

// ---------- D3: compare nama ----------

export type BedaNama = { sku: string; nama_shopee: string; nama_d1: string; sama: boolean };

/** Normalisasi LONGGAR (untuk banding saja): lowercase, non-alfanumerik → spasi. */
export function normalisasiLonggar(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Banding `Nama Produk Shopee` vs `products.nama_accurate` untuk SKU yang sama.
 * PERINGATAN hanya; tidak pernah memblokir import.
 */
export async function compareNama(db: D1Database, pasangan: { sku: string; nama_shopee: string }[]): Promise<BedaNama[]> {
  const unik = new Map<string, { sku: string; nama_shopee: string }>();
  for (const p of pasangan) {
    const sku = p.sku.trim().toUpperCase();
    if (!sku || !p.nama_shopee.trim()) continue;
    if (!unik.has(sku)) unik.set(sku, { sku, nama_shopee: p.nama_shopee.trim() });
  }
  if (unik.size === 0) return [];
  const skuList = [...unik.keys()];
  const nama = new Map<string, string>();
  for (let i = 0; i < skuList.length; i += 50) {
    const potong = skuList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db.prepare(`SELECT sku, nama_accurate FROM products WHERE sku IN (${tanda})`).bind(...potong).all<{ sku: string; nama_accurate: string | null }>();
    for (const r of results) nama.set(r.sku, r.nama_accurate ?? "");
  }
  const keluar: BedaNama[] = [];
  for (const [sku, p] of unik) {
    const d1 = nama.get(sku);
    if (d1 === undefined) continue;
    keluar.push({ sku, nama_shopee: p.nama_shopee, nama_d1: d1, sama: normalisasiLonggar(p.nama_shopee) === normalisasiLonggar(d1) });
  }
  return keluar.sort((a, b) => Number(a.sama) - Number(b.sama) || a.sku.localeCompare(b.sku));
}
