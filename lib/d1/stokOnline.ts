// lib/d1/stokOnline.ts — Potong stok gudang ONLINE saat picklist dicetak.
//
// KENAPA di sini dan bukan di transisi status order: stok ONLINE tidak ada di Kledo, jadi
// tidak ada sync yang memotongnya untuk kita. Pilihan momennya cuma dua — saat order
// ditandai pack, atau saat picklist dicetak. Yang kedua dipilih karena:
//   1. Saat itulah barang benar-benar diambil fisik dari rak.
//   2. Saat itulah kita tahu apa yang diambil (order mana saja, SKU apa, berapa).
//   3. Cetak ulang tetap aman karena kita bisa menandai "sudah dipotong" per order.
// Kalau dipotong saat `pack`, mencetak ulang picklist jadi tebak-tebakan: tidak ada cara
// membedakan "belum dipotong" dari "sudah, ini cetakan kedua".
//
// PENTING: potong = kurangi MAKSIMAL sampai 0, sisanya dicatat sebagai kekurangan.
// Stok ONLINE boleh nol tapi tidak boleh negatif dari jalur ini — angka negatif membuat
// layar stok menampilkan "minus" yang tidak bisa dibedakan dari salah input manual.
import { gagal, sekarang, type Hasil } from "./hasil";

export const GUDANG_ONLINE = "ONLINE";

/** Satu SKU yang stoknya di gudang ONLINE dan perlu ikut dipotong saat cetak. */
export type BarisPotong = { sku: string; qty: number };

export type Kekurangan = { sku: string; nama: string; kurang: number };

export type HasilPotong = {
  /** Jumlah unit yang benar-benar terpotong dari stok ONLINE. */
  dipotong: number;
  /** Unit yang tidak tertutup stok — inilah bahan dialog permintaan gudang. */
  kurang: Kekurangan[];
  /** SKU yang stok ONLINE-nya ikut terpotong (untuk ditampilkan di picklist). */
  sku_online: string[];
};

/**
 * Produk yang stoknya dipegang gudang ONLINE.
 *
 * Hanya yang `is_online_product = 1` — sisa katalog dipotong Kledo lewat sync, dan
 * memotongnya di sini akan membuat nilai WMS dan Kledo saling membalik tiap sinkron
 * (peringatan yang sama tertulis di lib/d1/orderTransisi.ts).
 */
export async function ambilSkuOnline(db: D1Database, daftar: string[]): Promise<Set<string>> {
  const unik = [...new Set(daftar)].filter((s) => s.length > 0);
  if (unik.length === 0) return new Set();
  const cocok = new Set<string>();
  // D1 batas 100 parameter per prepared statement; potong supaya picklist besar tetap aman.
  for (let i = 0; i < unik.length; i += 90) {
    const potong = unik.slice(i, i + 90);
    const { results } = await db
      .prepare(
        `SELECT sku FROM products WHERE is_online_product = 1 AND sku IN (${potong.map(() => "?").join(",")})`
      )
      .bind(...potong)
      .all<{ sku: string }>();
    for (const r of results) cocok.add(r.sku);
  }
  return cocok;
}

/**
 * Potong stok ONLINE untuk sekumpulan order, sekali saja per order.
 *
 * Idempotensi memakai `orders.stok_dikurangi`: satu order dipotong tepat sekali, berapa
 * kali pun picklist-nya dicetak. Order yang sudah ditandai dilewati tanpa menyentuh stok.
 *
 * `targets` = daftar (marketplace, no_pesanan) seperti kontrak picklist yang sudah ada.
 */
export async function potongOnlineUntukOrder(
  db: D1Database,
  targets: { mp: string; no: string }[],
  oleh: string | null
): Promise<Hasil<HasilPotong>> {
  if (targets.length === 0) return gagal(400, "Tidak ada order untuk dipotong.");

  const kunci = [...new Map(targets.map((t) => [`${t.mp}|${t.no}`, t])).values()];
  const belum: { mp: string; no: string }[] = [];
  for (let i = 0; i < kunci.length; i += 50) {
    const potong = kunci.slice(i, i + 50);
    const pasangan = potong.map(() => "(marketplace = ? AND no_pesanan = ?)").join(" OR ");
    const args = potong.flatMap((t) => [t.mp, t.no]);
    const { results } = await db
      .prepare(`SELECT marketplace, no_pesanan FROM orders WHERE (${pasangan}) AND stok_dikurangi = 0`)
      .bind(...args)
      .all<{ marketplace: string; no_pesanan: string }>();
    for (const r of results) belum.push({ mp: r.marketplace, no: r.no_pesanan });
  }
  if (belum.length === 0) return { ok: true, dipotong: 0, kurang: [], sku_online: [] };

  // Kumpulkan qty per SKU lintas semua order yang belum dipotong. Satu SKU yang muncul di
  // dua order berbeda harus dijumlahkan — kalau tidak, stok dipotong dua kali dari saldo
  // yang sama dan kekurangannya terhitung dua kali pula.
  const butuhSku: string[] = [];
  const qtyPerSku = new Map<string, number>();
  for (let i = 0; i < belum.length; i += 50) {
    const potong = belum.slice(i, i + 50);
    const pasangan = potong.map(() => "(marketplace = ? AND no_pesanan = ?)").join(" OR ");
    const args = potong.flatMap((t) => [t.mp, t.no]);
    const { results } = await db
      .prepare(`SELECT sku, SUM(qty) AS qty FROM order_items WHERE ${pasangan} GROUP BY sku`)
      .bind(...args)
      .all<{ sku: string; qty: number }>();
    for (const r of results) {
      butuhSku.push(r.sku);
      qtyPerSku.set(r.sku, (qtyPerSku.get(r.sku) ?? 0) + (r.qty ?? 0));
    }
  }
  if (qtyPerSku.size === 0) {
    await tandaiDipotong(db, belum);
    return { ok: true, dipotong: 0, kurang: [], sku_online: [] };
  }

  const skuOnline = await ambilSkuOnline(db, butuhSku);
  if (skuOnline.size === 0) {
    await tandaiDipotong(db, belum);
    return { ok: true, dipotong: 0, kurang: [], sku_online: [] };
  }

  const dipakai = [...skuOnline];
  const { results: saldo } = await db
    .prepare(
      `SELECT sku, qty FROM stock_by_bin WHERE warehouse_id = ? AND sku IN (${dipakai.map(() => "?").join(",")})`
    )
    .bind(GUDANG_ONLINE, ...dipakai)
    .all<{ sku: string; qty: number }>();
  const stokKini = new Map(saldo.map((r) => [r.sku, r.qty ?? 0]));

  const { results: nama } = await db
    .prepare(`SELECT sku, nama_accurate FROM products WHERE sku IN (${dipakai.map(() => "?").join(",")})`)
    .bind(...dipakai)
    .all<{ sku: string; nama_accurate: string }>();
  const namaSku = new Map(nama.map((r) => [r.sku, r.nama_accurate]));

  const at = sekarang();
  const statements: D1PreparedStatement[] = [];
  const kurang: Kekurangan[] = [];
  let totalPotong = 0;

  for (const sku of dipakai) {
    const butuh = qtyPerSku.get(sku) ?? 0;
    if (butuh <= 0) continue;
    const ada = stokKini.get(sku) ?? 0;
    const ambil = Math.min(Math.max(ada, 0), butuh);
    const sisa = butuh - ambil;
    if (ambil > 0) {
      statements.push(
        db
          .prepare("UPDATE stock_by_bin SET qty = ? WHERE sku = ? AND warehouse_id = ?")
          .bind(ada - ambil, sku, GUDANG_ONLINE),
        db
          .prepare(`INSERT INTO stock_moves (sku, qty, jenis, gudang_id, action_type, source, status, created_by, at, by)
            VALUES (?, ?, 'keluar_resi', ?, 'picklist_online', 'web_dashboard', 'processed', ?, ?, ?)`)
          .bind(sku, -ambil, GUDANG_ONLINE, oleh, at, oleh)
      );
      totalPotong += ambil;
    }
    if (sisa > 0) kurang.push({ sku, nama: namaSku.get(sku) ?? sku, kurang: sisa });
  }

  // Tandai SEMUA order sebagai sudah dipotong — termasuk yang stoknya tidak cukup. Kalau
  // hanya yang berhasil ditandai, cetak ulang akan memotong lagi sisa yang tadi kurang.
  for (const o of belum) {
    statements.push(
      db
        .prepare("UPDATE orders SET stok_dikurangi = 1 WHERE marketplace = ? AND no_pesanan = ?")
        .bind(o.mp, o.no)
    );
  }

  // Batch D1 dibatasi; pecah supaya picklist ratusan baris tidak gagal di tengah jalan.
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
  return { ok: true, dipotong: totalPotong, kurang, sku_online: dipakai };
}

async function tandaiDipotong(db: D1Database, order: { mp: string; no: string }[]): Promise<void> {
  const statements = order.map((o) =>
    db.prepare("UPDATE orders SET stok_dikurangi = 1 WHERE marketplace = ? AND no_pesanan = ?").bind(o.mp, o.no)
  );
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}
