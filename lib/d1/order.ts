// lib/d1/order.ts — Tipe + rumus laba per pesanan (Fase 3a).
// CRUD/transisi pesanan menyusul Task 3; file ini rumus murni saja.
import { gagal, sekarang, type Hasil } from "./db";

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
