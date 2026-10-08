// lib/d1/order.ts — Tipe + rumus laba + CRUD/transisi pesanan (Fase 3a).
import { gagal, sekarang, type Hasil } from "./db";
import { ambilProduk } from "./produk";
import { bacaQty, GUDANG_ONLINE } from "./stok";

/**
 * Porsi satu SKU dari laba order (untuk filter `sku`): omzet/HPP dihitung dari item SKU itu;
 * biaya+pajak dialokasikan proporsional subtotal/omzet. `biaya` di sini = porsi biaya+pph+ppn
 * supaya `omzet - hpp - biaya = laba` tetap konsisten dengan bentuk baris rekap.
 * ponytail: pembagian fee basis-persen per SKU diabaikan (fee dihitung level-order lalu
 * dialokasikan); cukup untuk rekap per-SKU, ganti bila perlu rincian fee per item.
 */

export type OrderItem = { sku: string; qty: number; harga_satuan: number; hpp_snapshot: number };
export type OrderFee = { jenis: string; basis: "flat" | "persen"; nilai: number };
export type RingkasanLaba = { omzet: number; hpp: number; biaya: number; pph: number; ppn: number; laba: number; margin: number };

export function hitungLaba(items: OrderItem[], fees: OrderFee[], pajakPph: boolean, pajakPpnPersen: number): RingkasanLaba {
  const omzet = items.reduce((a, i) => a + i.qty * i.harga_satuan, 0);
  const hpp = items.reduce((a, i) => a + i.qty * i.hpp_snapshot, 0);
  const biaya = fees.reduce((a, f) => a + (f.basis === "persen" ? Math.round((omzet * f.nilai) / 100) : f.nilai), 0);
  const pph = pajakPph ? Math.round((omzet * 5) / 1000) : 0;
  const ppn = pajakPpnPersen > 0 ? Math.round((omzet * pajakPpnPersen) / 100) : 0;
  const laba = omzet - hpp - biaya - pph - ppn;
  return { omzet, hpp, biaya, pph, ppn, laba, margin: omzet > 0 ? (laba / omzet) * 100 : 0 };
}

/** Alokasi biaya+pajak proporsional subtotal/omzet → laba per SKU. */
export function alokasiLabaSku(items: OrderItem[], r: RingkasanLaba): Record<string, number> {
  const keluar: Record<string, number> = {};
  if (r.omzet <= 0) return keluar;
  for (const i of items) {
    const sub = i.qty * i.harga_satuan;
    keluar[i.sku] = sub - i.qty * i.hpp_snapshot - ((r.biaya + r.pph + r.ppn) * sub) / r.omzet;
  }
  return keluar;
}

/** Porsi satu SKU dari laba order — bentuk field sama dengan baris rekap (omzet/hpp/biaya/pph/ppn/laba/margin). */
export type PorsiSku = { omzet: number; hpp: number; biaya: number; pph: number; ppn: number; laba: number; margin: number; porsi_sku: true };

export function porsiSku(items: OrderItem[], r: RingkasanLaba, sku: string): PorsiSku {
  const alokasi = alokasiLabaSku(items, r)[sku] ?? 0;
  let omzet = 0;
  let hpp = 0;
  for (const i of items) {
    if (i.sku !== sku) continue;
    omzet += i.qty * i.harga_satuan;
    hpp += i.qty * i.hpp_snapshot;
  }
  return {
    omzet, hpp,
    biaya: omzet - hpp - alokasi,
    pph: 0, ppn: 0,
    laba: alokasi,
    margin: omzet > 0 ? (alokasi / omzet) * 100 : 0,
    porsi_sku: true,
  };
}

export type BarisPesanan = {
  marketplace: string; no_pesanan: string; tanggal: number; buyer: string;
  sku: string; qty: number; harga_satuan: number;
  fee_jenis?: string; fee_basis?: "flat" | "persen"; fee_nilai?: number;
  pajak_pph?: boolean; pajak_ppn_persen?: number;
};

type ItemGrup = { sku: string; qty: number; harga: number; hpp: number };
type FeeGrup = { jenis: string; basis: "flat" | "persen"; nilai: number };
type GrupPesanan = {
  mp: string; no: string; tanggal: number; buyer: string; pph: boolean; ppn: number;
  items: ItemGrup[]; fees: FeeGrup[];
};

/** Impor batch baris pesanan: kelompok per order, beku hpp_snapshot, fee baris/preset. Idempoten. */
export async function imporPesanan(db: D1Database, daftar: BarisPesanan[], oleh: string | null): Promise<Hasil<{ order: number; item: number }>> {
  void oleh;
  // Ruling Task 3→4: validasi lib-level → gagal(400) sebelum CHECK DB melempar.
  const FEE_VALID = ["admin", "service", "komisi", "ongkir", "voucher", "affiliate", "iklan", "lain"];
  for (const b of daftar) {
    if (!Number.isInteger(b.qty) || b.qty < 1) return gagal(400, `Qty ${b.sku} harus bilangan bulat ≥ 1 (order ${b.no_pesanan}).`);
    if (!Number.isInteger(b.harga_satuan) || b.harga_satuan < 0) return gagal(400, `Harga ${b.sku} harus bilangan bulat ≥ 0 (order ${b.no_pesanan}).`);
    if (b.fee_jenis !== undefined && !FEE_VALID.includes(b.fee_jenis)) return gagal(400, `Fee ${b.fee_jenis} tak dikenal (order ${b.no_pesanan}).`);
    if (b.fee_basis !== undefined && b.fee_basis !== "flat" && b.fee_basis !== "persen") return gagal(400, `FeeBasis harus flat/persen (order ${b.no_pesanan}).`);
    if (b.fee_nilai !== undefined && (!Number.isInteger(b.fee_nilai) || b.fee_nilai < 0)) return gagal(400, `FeeNilai harus ≥ 0 (order ${b.no_pesanan}).`);
  }
  const grup: Record<string, GrupPesanan> = {};
  const urutan: string[] = [];
  for (const b of daftar) {
    const k = `${b.marketplace} ${b.no_pesanan}`;
    let g = grup[k];
    if (!g) {
      g = grup[k] = { mp: b.marketplace, no: b.no_pesanan, tanggal: b.tanggal, buyer: b.buyer ?? "", pph: b.pajak_pph ?? true, ppn: b.pajak_ppn_persen ?? 0, items: [], fees: [] };
      urutan.push(k);
    }
    g.items.push({ sku: b.sku, qty: b.qty, harga: b.harga_satuan, hpp: 0 });
    if (b.fee_jenis) g.fees.push({ jenis: b.fee_jenis, basis: b.fee_basis ?? "flat", nilai: b.fee_nilai ?? 0 });
  }
  for (const k of urutan) {
    const g = grup[k];
    for (const it of g.items) {
      const p = await ambilProduk(db, it.sku);
      if (!p) return gagal(400, `SKU ${it.sku} tidak dikenal (order ${g.no}).`);
      it.hpp = p.hpp ?? 0;
    }
  }
  const presetPerMp: Record<string, FeeGrup[]> = {};
  for (const k of urutan) {
    const g = grup[k];
    if (g.fees.length > 0) continue;
    let ps = presetPerMp[g.mp];
    if (!ps) {
      const { results } = await db.prepare("SELECT jenis, basis, nilai FROM mp_fee_presets WHERE marketplace = ?").bind(g.mp).all<FeeGrup>();
      ps = presetPerMp[g.mp] = results;
    }
    for (const p of ps) g.fees.push({ jenis: p.jenis, basis: p.basis, nilai: p.nilai });
  }
  const stmts: D1PreparedStatement[] = [];
  let nItem = 0;
  for (const k of urutan) {
    const g = grup[k];
    const omzet = g.items.reduce((a, it) => a + it.qty * it.harga, 0);
    stmts.push(db.prepare("INSERT OR IGNORE INTO orders (marketplace, no_pesanan, tanggal, buyer, pajak_pph, pajak_ppn_persen) VALUES (?, ?, ?, ?, ?, ?)").bind(g.mp, g.no, g.tanggal, g.buyer, g.pph ? 1 : 0, g.ppn));
    // Ruling Task 3→4: reimport UPDATE header KECUALI status_fulfill (first-wins ditolak).
    stmts.push(db.prepare("UPDATE orders SET tanggal = ?, buyer = ?, pajak_pph = ?, pajak_ppn_persen = ? WHERE marketplace = ? AND no_pesanan = ?").bind(g.tanggal, g.buyer, g.pph ? 1 : 0, g.ppn, g.mp, g.no));
    for (const it of g.items) {
      stmts.push(db.prepare("INSERT OR REPLACE INTO order_items (marketplace, no_pesanan, sku, qty, harga_satuan, hpp_snapshot, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(g.mp, g.no, it.sku, it.qty, it.harga, it.hpp, it.qty * it.harga));
      nItem++;
    }
    stmts.push(db.prepare("DELETE FROM order_fees WHERE marketplace = ? AND no_pesanan = ?").bind(g.mp, g.no));
    for (const f of g.fees) {
      stmts.push(db.prepare("INSERT INTO order_fees (marketplace, no_pesanan, jenis, basis, nilai, amount) VALUES (?, ?, ?, ?, ?, ?)").bind(g.mp, g.no, f.jenis, f.basis, f.nilai, f.basis === "persen" ? Math.round((omzet * f.nilai) / 100) : f.nilai));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { ok: true, order: urutan.length, item: nItem };
}

const PETA_TRANSISI: Record<string, string[]> = {
  pending: ["pack", "batal"],
  pack: ["kirim", "batal"],
  kirim: ["selesai", "batal"],
  selesai: [],
  batal: [],
};

export async function transisiFulfill(db: D1Database, mp: string, no: string, ke: "pack" | "kirim" | "selesai" | "batal", oleh: string | null): Promise<Hasil<{ status: string }>> {
  const order = await db.prepare("SELECT status_fulfill FROM orders WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).first<{ status_fulfill: string }>();
  if (!order) return gagal(404, "Pesanan tidak ditemukan.");
  if (!PETA_TRANSISI[order.status_fulfill]?.includes(ke)) return gagal(409, `Transisi ${order.status_fulfill} → ${ke} tidak diizinkan.`);
  if (ke === "pack") {
    const { results: items } = await db.prepare("SELECT sku, qty FROM order_items WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).all<{ sku: string; qty: number }>();
    for (const it of items) {
      const stok = await bacaQty(db, it.sku, GUDANG_ONLINE);
      if (stok < it.qty) return gagal(400, `Stok ${it.sku} tidak cukup (${stok} < ${it.qty}).`);
    }
    const stmts: D1PreparedStatement[] = [];
    const at = sekarang();
    for (const it of items) {
      const lama = await bacaQty(db, it.sku, GUDANG_ONLINE);
      stmts.push(
        db.prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty").bind(it.sku, GUDANG_ONLINE, lama - it.qty),
        db.prepare("INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, created_by, at, by) VALUES (?, ?, 'jual_mp', ?, 'web_dashboard', 'processed', ?, ?, ?)").bind(it.sku, -it.qty, GUDANG_ONLINE, oleh, at, oleh)
      );
    }
    await db.batch(stmts);
  }
  if (ke === "batal") {
    const { results: items } = await db.prepare("SELECT sku, qty FROM order_items WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).all<{ sku: string; qty: number }>();
    if (order.status_fulfill === "pack" || order.status_fulfill === "kirim") {
      const stmts: D1PreparedStatement[] = [];
      const at = sekarang();
      for (const it of items) {
        const lama = await bacaQty(db, it.sku, GUDANG_ONLINE);
        stmts.push(
          db.prepare("INSERT INTO stock_by_bin (sku, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(sku, warehouse_id) DO UPDATE SET qty = excluded.qty").bind(it.sku, GUDANG_ONLINE, lama + it.qty),
          db.prepare("INSERT INTO stock_moves (sku, qty, jenis, gudang_id, source, status, created_by, at, by) VALUES (?, ?, 'retur_mp', ?, 'web_dashboard', 'processed', ?, ?, ?)").bind(it.sku, it.qty, GUDANG_ONLINE, oleh, at, oleh)
        );
      }
      await db.batch(stmts);
    }
  }
  await db.prepare("UPDATE orders SET status_fulfill = ? WHERE marketplace = ? AND no_pesanan = ?").bind(ke, mp, no).run();
  return { ok: true, status: ke };
}

export type OrderDetail = {
  marketplace: string; no_pesanan: string; tanggal: number; buyer: string;
  status_fulfill: string; pajak_pph: boolean; pajak_ppn_persen: number;
  items: (OrderItem & { subtotal: number })[];
  fees: (OrderFee & { amount: number })[];
};

/** Header + item + fee satu pesanan; null bila tak ada. */
export async function ambilOrder(db: D1Database, mp: string, no: string): Promise<OrderDetail | null> {
  const h = await db.prepare("SELECT marketplace, no_pesanan, tanggal, buyer, status_fulfill, pajak_pph, pajak_ppn_persen FROM orders WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).first<{ marketplace: string; no_pesanan: string; tanggal: number; buyer: string; status_fulfill: string; pajak_pph: number; pajak_ppn_persen: number }>();
  if (!h) return null;
  const { results: items } = await db.prepare("SELECT sku, qty, harga_satuan, hpp_snapshot, subtotal FROM order_items WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).all<OrderItem & { subtotal: number }>();
  const { results: fees } = await db.prepare("SELECT jenis, basis, nilai, amount FROM order_fees WHERE marketplace = ? AND no_pesanan = ?").bind(mp, no).all<OrderFee & { amount: number }>();
  return { marketplace: h.marketplace, no_pesanan: h.no_pesanan, tanggal: h.tanggal, buyer: h.buyer, status_fulfill: h.status_fulfill, pajak_pph: h.pajak_pph === 1, pajak_ppn_persen: h.pajak_ppn_persen, items, fees };
}

export type FilterOrder = { mp?: string; status?: string; dari?: number; sampai?: number; limit?: number };
export type RingkasOrder = { marketplace: string; no_pesanan: string; tanggal: number; buyer: string; status_fulfill: string };

/** Daftar header order terbaru dulu; filter mp/status/periode opsional. */
export async function listOrder(db: D1Database, filter: FilterOrder): Promise<RingkasOrder[]> {
  const syarat: string[] = [];
  const args: unknown[] = [];
  if (filter.mp) { syarat.push("marketplace = ?"); args.push(filter.mp); }
  if (filter.status) { syarat.push("status_fulfill = ?"); args.push(filter.status); }
  if (filter.dari !== undefined) { syarat.push("tanggal >= ?"); args.push(filter.dari); }
  if (filter.sampai !== undefined) { syarat.push("tanggal <= ?"); args.push(filter.sampai); }
  const sql = "SELECT marketplace, no_pesanan, tanggal, buyer, status_fulfill FROM orders" + (syarat.length > 0 ? ` WHERE ${syarat.join(" AND ")}` : "") + " ORDER BY tanggal DESC LIMIT ?";
  const { results } = await db.prepare(sql).bind(...args, Math.min(filter.limit ?? 100, 500)).all<RingkasOrder>();
  return results;
}
