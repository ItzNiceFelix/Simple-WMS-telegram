// lib/d1/labaShopee.ts — Estimasi laba dari export shipping Shopee (standalone, tak sentuh stok).
// Rumus disepakati: omzet = Σ Subtotal Pesanan per order; hpp = Σ qty × HPP master
// (SKU = Nomor Referensi SKU → SKU Induk → tolak bila kosong/tak cocok);
// biaya = preset MP % × omzet + Σ(voucher_penjual + diskon_penjual + paket_diskon_penjual);
// laba = omzet − hpp − biaya. Filter: kecuali batal / retur penuh.
import { gagal, sekarang, type Hasil } from "./db";
import { ambilProduk } from "./produk";

export type BarisShopee = Record<string, unknown>;

export type TolakLaba = { no_pesanan: string; alasan: string };

export type RincianSku = {
  sku: string;
  unit: number;
  hppSatuan: number;
  hargaJual: number;
  marginSatuan: number;
  marginPersen: number;
  kontribusi: number;
};

export type AgregatLaba = {
  jml_order: number;
  jml_baris: number;
  omzet: number;
  hpp: number;
  biaya: number;
  laba: number;
  tolak: TolakLaba[];
  rincian: RincianSku[];
};

export type SnapshotLaba = AgregatLaba & {
  tanggal: string;
  marketplace: string;
  file: string;
  at: number;
  by: string | null;
};

/** Parse angka Shopee: "10.879" (titik ribuan) / 10879 / "10879" → 10879. */
export function angkaShopee(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v !== "string") return 0;
  const t = v.trim().replace(/\./g, "").replace(/,/g, ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function teks(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

const STATUS_HITUNG = ["telah dikirim", "sedang dikirim", "selesai"];

function statusDihitung(status: string): boolean {
  const s = status.toLowerCase();
  return STATUS_HITUNG.some((k) => s.includes(k));
}

/** Tanggal hari ini zona Jakarta (YYYY-MM-DD). */
export function tanggalJakarta(d = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

type PresetFee = { basis: string; nilai: number };

/**
 * Hitung agregat laba dari baris sheet Shopee.
 * @param ambilHpp resolver SKU → HPP (null bila tak dikenal); produksi = ambilProduk via db.
 * @param presets preset fee MP (dari mp_fee_presets); persen dihitung dari omzet order.
 */
export async function hitungLabaShopee(
  rows: BarisShopee[],
  ambilHpp: (sku: string) => Promise<number | null>,
  presets: PresetFee[] = []
): Promise<AgregatLaba> {
  // Kelompokkan per No. Pesanan (1 order boleh multi-baris).
  const grup = new Map<string, BarisShopee[]>();
  for (const r of rows) {
    const no = teks(r["No. Pesanan"]);
    if (!no) continue;
    const daftar = grup.get(no) ?? [];
    daftar.push(r);
    grup.set(no, daftar);
  }

  let jml_order = 0;
  let jml_baris = 0;
  let omzet = 0;
  let hpp = 0;
  let biaya = 0;
  const tolak: TolakLaba[] = [];
  const perSku = new Map<string, { sku: string; unit: number; hppSatuan: number; harga: number; omzetSku: number; hppSku: number; biayaSku: number; kontribusi: number }>();
  const cacheHpp = new Map<string, number | null>();
  const hppSku = async (sku: string): Promise<number | null> => {
    if (!cacheHpp.has(sku)) cacheHpp.set(sku, await ambilHpp(sku));
    return cacheHpp.get(sku) ?? null;
  };

  for (const [no, daftar] of grup) {
    const status = teks(daftar[0]["Status Pesanan"]);
    if (!statusDihitung(status)) continue;

    // SKU per baris: ref → induk; kosong = tolak seorder.
    // qty bersih = Jumlah − Returned quantity (retur parsial mengurangi unit terjual).
    const skuBaris: { sku: string; qty: number; subtotal: number; harga: number }[] = [];
    let alasanTolak: string | null = null;
    for (const r of daftar) {
      const sku = teks(r["Nomor Referensi SKU"]) || teks(r["SKU Induk"]);
      if (!sku) {
        alasanTolak = "SKU kosong (ref + induk kosong)";
        break;
      }
      const qty = Math.max(0, angkaShopee(r["Jumlah"]) - angkaShopee(r["Returned quantity"]));
      if (qty === 0) continue; // baris retur penuh: tak hitung, tak tolak
      skuBaris.push({
        sku: sku.toUpperCase(),
        qty,
        subtotal: angkaShopee(r["Subtotal Pesanan"]),
        harga: angkaShopee(r["Harga Setelah Diskon"]),
      });
    }
    if (alasanTolak) {
      tolak.push({ no_pesanan: no, alasan: alasanTolak });
      continue;
    }
    if (skuBaris.length === 0) continue; // order retur penuh

    // HPP master; tak cocok = tolak seorder.
    let hppOrder = 0;
    for (const b of skuBaris) {
      const h = await hppSku(b.sku);
      if (h == null) {
        alasanTolak = `SKU ${b.sku} tak cocok master stok`;
        break;
      }
      hppOrder += b.qty * h;
    }
    if (alasanTolak) {
      tolak.push({ no_pesanan: no, alasan: alasanTolak });
      continue;
    }

    const omzetOrder = skuBaris.reduce((a, b) => a + b.subtotal, 0);
    const persenPreset = presets
      .filter((p) => p.basis === "persen")
      .reduce((a, p) => a + Math.round((omzetOrder * p.nilai) / 100), 0);
    const flatPreset = presets.filter((p) => p.basis === "flat").reduce((a, p) => a + p.nilai, 0);
    const biayaFile = daftar.reduce(
      (a, r) =>
        a +
        angkaShopee(r["Voucher Ditanggung Penjual"]) +
        angkaShopee(r["Diskon Dari Penjual"]) +
        angkaShopee(r["Paket Diskon (Diskon dari Penjual)"]),
      0
    );
    const biayaOrder = persenPreset + flatPreset + biayaFile;

    jml_order += 1;
    jml_baris += skuBaris.length;
    omzet += omzetOrder;
    hpp += hppOrder;
    biaya += biayaOrder;

    // Agregat per SKU: biaya dialokasi proporsional ke subtotal baris.
    for (const b of skuBaris) {
      const h = (await hppSku(b.sku)) ?? 0;
      const porsi = omzetOrder > 0 ? b.subtotal / omzetOrder : 0;
      const biayaAlokasi = Math.round(biayaOrder * porsi);
      const ada = perSku.get(b.sku);
      if (ada) {
        ada.unit += b.qty;
        ada.omzetSku += b.subtotal;
        ada.hppSku += b.qty * h;
        ada.biayaSku += biayaAlokasi;
        ada.kontribusi += b.subtotal - b.qty * h - biayaAlokasi;
        if (b.harga > 0) ada.harga = b.harga;
      } else {
        perSku.set(b.sku, {
          sku: b.sku, unit: b.qty, hppSatuan: h, harga: b.harga,
          omzetSku: b.subtotal, hppSku: b.qty * h, biayaSku: biayaAlokasi,
          kontribusi: b.subtotal - b.qty * h - biayaAlokasi,
        });
      }
    }
  }

  const rincian: RincianSku[] = [...perSku.values()]
    .map((s) => {
      const marginSatuan = s.unit > 0 ? Math.round(s.kontribusi / s.unit) : 0;
      return {
        sku: s.sku,
        unit: s.unit,
        hppSatuan: s.hppSatuan,
        hargaJual: s.harga,
        marginSatuan,
        marginPersen: s.omzetSku > 0 ? Math.round(((s.kontribusi / s.omzetSku) * 100) * 10) / 10 : 0,
        kontribusi: s.kontribusi,
      };
    })
    .sort((a, b) => b.kontribusi - a.kontribusi);

  return { jml_order, jml_baris, omzet, hpp, biaya, laba: omzet - hpp - biaya, tolak, rincian };
}

/** Resolver HPP produksi via D1 products. */
export function ambilHppDb(db: D1Database): (sku: string) => Promise<number | null> {
  return async (sku: string) => {
    const p = await ambilProduk(db, sku);
    if (!p) return null;
    return p.hpp ?? p.hpp_baru ?? 0;
  };
}

/** Simpan snapshot agregat + rincian SKU (timpa per tanggal). */
export async function simpanLabaHarian(
  db: D1Database,
  tanggal: string,
  agregat: AgregatLaba,
  file: string,
  oleh: string | null,
  marketplace = "shopee"
): Promise<Hasil<{ tanggal: string }>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return gagal(400, "Tanggal harus YYYY-MM-DD.");
  // Kompatibel pra-migrasi 0010: coba tulis rincian_json, fallback tanpa kolom itu.
  try {
    await db
      .prepare(
        "INSERT OR REPLACE INTO laba_harian (tanggal, marketplace, jml_order, jml_baris, omzet, hpp, biaya, laba, tolak_json, rincian_json, file, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        tanggal,
        marketplace,
        agregat.jml_order,
        agregat.jml_baris,
        agregat.omzet,
        agregat.hpp,
        agregat.biaya,
        agregat.laba,
        JSON.stringify(agregat.tolak),
        JSON.stringify(agregat.rincian),
        file.slice(0, 120),
        sekarang(),
        oleh
      )
      .run();
  } catch {
    await db
      .prepare(
        "INSERT OR REPLACE INTO laba_harian (tanggal, marketplace, jml_order, jml_baris, omzet, hpp, biaya, laba, tolak_json, file, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        tanggal,
        marketplace,
        agregat.jml_order,
        agregat.jml_baris,
        agregat.omzet,
        agregat.hpp,
        agregat.biaya,
        agregat.laba,
        JSON.stringify(agregat.tolak),
        file.slice(0, 120),
        sekarang(),
        oleh
      )
      .run();
  }
  return { ok: true, tanggal };
}

/** Muat snapshot per tanggal; null bila belum ada. */
export async function muatLabaHarian(db: D1Database, tanggal: string): Promise<SnapshotLaba | null> {
  const row = await db
    .prepare("SELECT tanggal, marketplace, jml_order, jml_baris, omzet, hpp, biaya, laba, tolak_json, file, at, by FROM laba_harian WHERE tanggal = ?")
    .bind(tanggal)
    .first<{
      tanggal: string;
      marketplace: string;
      jml_order: number;
      jml_baris: number;
      omzet: number;
      hpp: number;
      biaya: number;
      laba: number;
      tolak_json: string;
      file: string;
      at: number;
      by: string | null;
    }>();
  if (!row) return null;
  let tolak: TolakLaba[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tolak_json);
    if (Array.isArray(parsed)) tolak = parsed as TolakLaba[];
  } catch {
    tolak = [];
  }
  // Rincian dibaca terpisah agar kompatibel pra-migrasi 0010.
  let rincian: RincianSku[] = [];
  try {
    const r2 = await db
      .prepare("SELECT rincian_json FROM laba_harian WHERE tanggal = ?")
      .bind(tanggal)
      .first<{ rincian_json: string }>();
    const parsed: unknown = JSON.parse(r2?.rincian_json ?? "[]");
    if (Array.isArray(parsed)) rincian = parsed as RincianSku[];
  } catch {
    rincian = [];
  }
  return {
    tanggal: row.tanggal,
    marketplace: row.marketplace,
    jml_order: row.jml_order,
    jml_baris: row.jml_baris,
    omzet: row.omzet,
    hpp: row.hpp,
    biaya: row.biaya,
    laba: row.laba,
    tolak,
    rincian,
    file: row.file,
    at: row.at,
    by: row.by,
  };
}

/** Daftar tanggal snapshot terbaru dulu (untuk load per tanggal). */
export async function listTanggalLaba(db: D1Database, limit = 30): Promise<{ tanggal: string; jml_order: number; laba: number }[]> {
  const { results } = await db
    .prepare("SELECT tanggal, jml_order, laba FROM laba_harian ORDER BY tanggal DESC LIMIT ?")
    .bind(limit)
    .all<{ tanggal: string; jml_order: number; laba: number }>();
  return results;
}
