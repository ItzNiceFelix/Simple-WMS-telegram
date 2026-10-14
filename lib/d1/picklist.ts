// lib/d1/picklist.ts — Agregat read-only item order pending untuk picklist.
import { gagal, type Hasil } from "./hasil";

export type PickTarget = { mp: string; no: string };
export type PickRow = { sku: string; nama: string; qty: number; variasi?: string };
export type Picklist = { orders: number; units: number; rows: PickRow[] };
export type PaketPicklist = { no_resi: string; no_pesanan: string[]; jasa_kirim: string; rows: PickRow[]; units: number };

/**
 * Picklist PER PAKET (F18/D4): satu lembar per no_resi, daftar semua order di grup.
 * Qty per baris diambil APA ADANYA dari `order_items` (file gabungan sudah total paket)
 * — TIDAK ada agregasi ulang lintas order. Resi tanpa grup jadi paket satu-order.
 * Order TANPA resi tetap diekspor sebagai paket sendiri (no_resi = ""): resi bisa belum
 * terbit saat picklist dicetak, dan menggagalkan seluruh cetakan karena satu order
 * ber-resi kosong tidak dapat diterima.
 */
export async function buatPicklistPaket(db: D1Database, targets: PickTarget[]): Promise<Hasil<{ paket: PaketPicklist[] }>> {
  const unik = [...new Map(targets.map((t) => [`${t.mp}|${t.no}`, t])).values()];
  if (unik.length === 0) return gagal(400, "Pilih minimal satu order.");
  const noList = unik.map((t) => t.no);
  const grup = new Map<string, { resi: string; items: string[] }>();
  for (let i = 0; i < noList.length; i += 50) {
    const potong = noList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT no_pesanan, no_resi FROM orders WHERE marketplace = 'shopee' AND no_pesanan IN (${tanda})`)
      .bind(...potong)
      .all<{ no_pesanan: string; no_resi: string }>();
    for (const r of results) grup.set(r.no_pesanan, { resi: r.no_resi, items: [r.no_pesanan] });
  }
  const resiList = [...new Set([...grup.values()].map((g) => g.resi).filter(Boolean))];
  const isiGrup = new Map<string, { no_json: string; jasa_kirim: string }>();
  for (let i = 0; i < resiList.length; i += 50) {
    const potong = resiList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT no_resi, no_json, jasa_kirim FROM resi_grup WHERE no_resi IN (${tanda})`)
      .bind(...potong)
      .all<{ no_resi: string; no_json: string; jasa_kirim: string }>();
    for (const r of results) isiGrup.set(r.no_resi, { no_json: r.no_json, jasa_kirim: r.jasa_kirim });
  }
  const paketMap = new Map<string, PaketPicklist>();
  for (const t of unik) {
    const no = t.no;
    const resi = grup.get(no)?.resi ?? "";
    // Kunci per order bila resi kosong — pakai `""` akan menumpuk semua order tanpa
    // resi menjadi satu paket palsu.
    const kunci = resi || `NO-RESI:${no}`;
    let paket = paketMap.get(kunci);
    if (!paket) {
      let noPesanan: string[] = [no];
      const g = isiGrup.get(resi);
      if (g) {
        try {
          const parsed = JSON.parse(g.no_json) as unknown;
          if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string") && parsed.length > 0) noPesanan = parsed;
        } catch {
          noPesanan = [no];
        }
      }
      paket = { no_resi: resi, no_pesanan: noPesanan, jasa_kirim: g?.jasa_kirim ?? "", rows: [], units: 0 };
      paketMap.set(kunci, paket);
    }
    const items = await db
      .prepare("SELECT i.sku, p.nama_accurate AS nama, i.qty, i.variasi FROM order_items i JOIN products p ON p.sku = i.sku WHERE i.marketplace = 'shopee' AND i.no_pesanan = ?")
      .bind(no)
      .all<PickRow & { variasi: string }>();
    for (const item of items.results) {
      if (!item.nama) return gagal(409, `SKU ${item.sku} (order ${no}) tidak ada di master stok.`);
      // Variasi ditempel PER BARIS: SKU sama bisa punya varian beda antar order dalam satu
      // paket (mis. 001699 HIJAU di O-A, BIRU di O-B). Map per-SKU akan menimpa salah satunya.
      paket.rows.push({ sku: item.sku, nama: item.nama, qty: Number(item.qty), variasi: item.variasi || "" });
      paket.units += Number(item.qty);
    }
  }
  return { ok: true, paket: [...paketMap.values()] };
}

/** Kumpulkan item dari order pending terpilih, agregat per SKU master, urut SKU. */
export async function buatPicklist(db: D1Database, targets: PickTarget[]): Promise<Hasil<Picklist>> {
  const unik = [...new Map(targets.map((t) => [`${t.mp}|${t.no}`, t])).values()];
  if (unik.length === 0) return gagal(400, "Pilih minimal satu order.");
  const rows: PickRow[] = [];
  for (const target of unik) {
    const order = await db
      .prepare("SELECT status_fulfill FROM orders WHERE marketplace = ? AND no_pesanan = ?")
      .bind(target.mp, target.no)
      .first<{ status_fulfill: string }>();
    if (!order) return gagal(404, `Pesanan ${target.no} tidak ditemukan.`);
    if (order.status_fulfill !== "pending") return gagal(409, `Pesanan ${target.no} bukan pending.`);
    const items = await db
      .prepare("SELECT i.sku, p.nama_accurate AS nama, i.qty FROM order_items i JOIN products p ON p.sku = i.sku WHERE i.marketplace = ? AND i.no_pesanan = ?")
      .bind(target.mp, target.no)
      .all<PickRow>();
    for (const item of items.results) {
      if (!item.nama) return gagal(409, `SKU ${item.sku} (order ${target.no}) tidak ada di master stok.`);
      rows.push({ sku: item.sku, nama: item.nama, qty: Number(item.qty) });
    }
  }
  const bySku = new Map<string, PickRow>();
  for (const row of rows) {
    const lama = bySku.get(row.sku);
    bySku.set(row.sku, lama ? { ...lama, qty: lama.qty + row.qty } : row);
  }
  const hasil = [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  return { ok: true, orders: unik.length, units: hasil.reduce((sum, row) => sum + row.qty, 0), rows: hasil };
}
