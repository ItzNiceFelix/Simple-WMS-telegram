// lib/d1/orderImportShopee.ts — Normalisasi export Shopee (sheet orders + Advance Fulfilment).
// A2: advance[] dipisah (F6), peta SKU Referensi→Induk (F1), qty bersih retur (F13),
// normalisasi status via tabel peta (F14), variasi dipertahankan per baris (F16).
import { angkaShopee } from "./angkaShopee";

export type ShopeeOrderRow = Record<string, unknown>;
export type ShopeeAdvanceRow = Record<string, unknown>;

/** Status file (kolom "Status Pesanan") hasil normalisasi. '' = status di luar allowlist. */
export type StatusFile = "" | "perlu_dikirim" | "sedang_dikirim" | "telah_dikirim" | "selesai" | "batal" | "belum_bayar" | "pembatalan_diajukan";

export type ShopeeItem = {
  sku: string;
  variasi: string;
  nama_shopee: string;
  qty: number;
  harga_satuan: number;
  subtotal: number;
};

export type GabunganOrder = {
  marketplace: "shopee";
  no_pesanan: string;
  tanggal: number;
  buyer: string;
  noResi: string;
  statusAwal: "pending" | "kirim";
  statusFile: StatusFile;
  statusMp: string;
  opsiKirim: string;
  antarKe: string;
  jasaKirim: string;
  tipeLayanan: string;
  cod: boolean;
  preorder: boolean;
  batasKirim: string;
  items: ShopeeItem[];
};

export type ShopeeBooking = {
  booking_sn: string;
  no_resi: string;
  sku: string;
  variasi: string;
  nama_produk: string;
  opsi_kirim: string;
  antar_ke: string;
  booking_at: string;
  batas_kirim: string;
  qty: 1;
};

export type GagalShopee = { no_pesanan: string; sku?: string; pesan: string };

/** Tombol "Belum ada SKU di MP" (sku_belum_mp) — diteruskan ke hasil untuk tagging UI. */
export type BarisBelumSku = { order_ref: string; nama_shopee: string; variasi: string };

export type HasilImportShopee = {
  orders: GabunganOrder[];
  advance: ShopeeBooking[];
  gagal: GagalShopee[];
  belumSku: BarisBelumSku[];
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

function dateEpoch(v: unknown, fallback: unknown): number {
  const ms = Date.parse((text(v) || text(fallback)).replace(" ", "T"));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

/** Peta SKU: `Nomor Referensi SKU` dulu → fallback `SKU Induk` (F1/F2), uppercase. */
const skuOf = (row: ShopeeOrderRow): string => (text(row["Nomor Referensi SKU"]) || text(row["SKU Induk"])).toUpperCase();

/** Tabel peta status (F14) — jangan `includes` mentah. Kunci sudah lowercase. */
const PETA_STATUS: Record<string, StatusFile> = {
  "perlu dikirim": "perlu_dikirim",
  "telah dikirim": "telah_dikirim",
  "sedang dikirim": "sedang_dikirim",
  selesai: "selesai",
  batal: "batal",
  "belum bayar": "belum_bayar",
  "pembatalan diajukan": "pembatalan_diajukan",
};

/** Normalisasi status: tabel dulu, lalu pola "Pesanan diterima..." (status panjang pengembalian). */
export function normalisasiStatus(raw: unknown): StatusFile {
  const s = text(raw).toLowerCase();
  if (!s) return "";
  const tabel = PETA_STATUS[s];
  if (tabel) return tabel;
  if (s.startsWith("pesanan diterima")) return "selesai";
  return "";
}

/** Status yang dihitung sebagai order aktif yang diproses gudang. */
const STATUS_DIHITUNG: StatusFile[] = ["perlu_dikirim", "sedang_dikirim", "telah_dikirim", "selesai"];

/** `Opsi Pengiriman` → { jasa kirim, tipe layanan }.
 *  Format nyata: "<tipe layanan>-<jasa kirim>" (mis. "Hemat Kargo-SPX Hemat") atau
 *  "<jasa kirim>" saja tanpa pemisah (mis. "SPX Hemat", "SPX Standard"). */
function bacaOpsiPengiriman(v: unknown): { jasa: string; layanan: string } {
  const s = text(v);
  if (!s) return { jasa: "", layanan: "" };
  const pisah = s.lastIndexOf("-");
  if (pisah < 0) return { jasa: s, layanan: "" };
  return { jasa: s.slice(pisah + 1).trim(), layanan: s.slice(0, pisah).trim() };
}

/** Deteksi COD dari `Metode Pembayaran` (COD dikirim lewat kurir bayar di tempat). */
const isCod = (v: unknown): boolean => /cod|bayar di tempat/i.test(text(v));

/** Deteksi pre-order dari `Tipe Pesanan` bila ada; export nyata sering mengosongkan kolom ini. */
const isPreorder = (v: unknown): boolean => /pre[- ]?order/i.test(text(v));

function namaProdukTerisi(rows: ShopeeOrderRow[]): boolean {
  if (rows.length === 0) return true;
  let isi = 0;
  for (const r of rows) if (text(r["Nama Produk"])) isi++;
  return isi / rows.length > 0.1;
}

/**
 * Normalisasi satu file export Shopee. Memisahkan baris `orders` (order pelanggan) dari
 * `Advance Fulfilment` (booking pasokan — TIDAK digabung ke order, F6).
 * Tidak menghitung SKU master; pemanggil yang memutuskan baris gagal via `hasSku`.
 */
export function normalisasiSheetShopee(
  ordersRows: ShopeeOrderRow[],
  advanceRows: ShopeeAdvanceRow[],
  hasSku: (sku: string) => boolean = () => true,
): HasilImportShopee {
  const gagal: GagalShopee[] = [];
  const belumSku: BarisBelumSku[] = [];

  if (!namaProdukTerisi(ordersRows)) {
    return { orders: [], advance: [], belumSku: [], gagal: [{ no_pesanan: "", pesan: "File export tidak lengkap (kolom Nama Produk kosong >90%)." }] };
  }

  type Grup = { no: string; row: ShopeeOrderRow; items: Map<string, ShopeeItem>; statusMp: string };
  const groups = new Map<string, Grup>();

  for (const row of ordersRows) {
    const no = text(row["No. Pesanan"]);
    if (!no) continue;
    let g = groups.get(no);
    if (!g) {
      g = { no, row, items: new Map(), statusMp: text(row["Status Pesanan"]) };
      groups.set(no, g);
    }
    const sku = skuOf(row);
    const variasi = text(row["Nama Variasi"]);
    if (!sku) {
      belumSku.push({ order_ref: no, nama_shopee: text(row["Nama Produk"]), variasi });
      continue;
    }
    const jml = angkaShopee(row["Jumlah"]);
    const kembali = angkaShopee(row["Returned quantity"]);
    if (jml < 1) {
      gagal.push({ no_pesanan: no, sku, pesan: `Jumlah ${jml} tidak valid (minimal 1).` });
      continue;
    }
    // F13: qty bersih retur, minimal 1 (baris yang diretur penuh tetap dicatat agar alokasi tak bocor).
    const qty = Math.max(1, jml - kembali);
    const harga = angkaShopee(row["Harga Setelah Diskon"]);
    const kunci = `${sku}\u0000${variasi}`;
    const lama = g.items.get(kunci);
    g.items.set(kunci, {
      sku,
      variasi,
      nama_shopee: text(row["Nama Produk"]),
      qty: (lama?.qty ?? 0) + qty,
      harga_satuan: lama?.harga_satuan ?? harga,
      subtotal: (lama?.subtotal ?? 0) + angkaShopee(row["Subtotal Pesanan"]),
    });
  }

  const orders: GabunganOrder[] = [];
  for (const g of groups.values()) {
    const statusFile = normalisasiStatus(g.statusMp);
    if (!STATUS_DIHITUNG.includes(statusFile)) continue;
    if (g.items.size === 0) {
      gagal.push({ no_pesanan: g.no, pesan: "Tak ada baris dengan SKU (belum dipetakan)." });
      continue;
    }
    const hilang = [...g.items.values()].filter((it) => !hasSku(it.sku));
    for (const it of hilang) gagal.push({ no_pesanan: g.no, sku: it.sku, pesan: `SKU ${it.sku} tidak ditemukan di master stok.` });
    if (hilang.length) continue;
    const r = g.row;
    const opsi = bacaOpsiPengiriman(r["Opsi Pengiriman"]);
    const statusAwal: "pending" | "kirim" = statusFile === "perlu_dikirim" ? "pending" : "kirim";
    orders.push({
      marketplace: "shopee",
      no_pesanan: g.no,
      tanggal: dateEpoch(r["Waktu Pesanan Dibuat"], r["Waktu Pembayaran Dilakukan"]),
      buyer: text(r["Username (Pembeli)"]),
      noResi: text(r["No. Resi"]),
      statusAwal,
      statusFile,
      statusMp: g.statusMp,
      opsiKirim: text(r["Opsi Pengiriman"]),
      antarKe: text(r["Antar ke counter/ pick-up"]),
      jasaKirim: opsi.jasa,
      tipeLayanan: opsi.layanan,
      cod: isCod(r["Metode Pembayaran"]),
      preorder: isPreorder(r["Tipe Pesanan"]),
      batasKirim: text(r["Pesanan Harus Dikirimkan Sebelum (Menghindari keterlambatan)"]),
      items: [...g.items.values()],
    });
  }

  const advance: ShopeeBooking[] = [];
  for (const row of advanceRows) {
    const sn = text(row["Booking SN"]);
    if (!sn) continue;
    const sku = skuOf(row);
    if (!sku) {
      gagal.push({ no_pesanan: sn, pesan: "SKU kosong pada Advance Fulfilment." });
      continue;
    }
    if (!hasSku(sku)) {
      gagal.push({ no_pesanan: sn, sku, pesan: `SKU ${sku} tidak ditemukan di master stok.` });
      continue;
    }
    const opsi = bacaOpsiPengiriman(row["Opsi Pengiriman"]);
    advance.push({
      booking_sn: sn,
      no_resi: text(row["No. Resi"]),
      sku,
      variasi: text(row["Nama Variasi"]),
      nama_produk: text(row["Nama Produk"]),
      opsi_kirim: opsi.jasa || text(row["Opsi Pengiriman"]),
      antar_ke: text(row["Antar ke counter/ pick-up"]),
      booking_at: text(row["Booking Creation Date"]),
      batas_kirim: text(row["Pesanan Harus Dikirimkan Sebelum (Menghindari keterlambatan)"]),
      qty: 1,
    });
  }

  return { orders, advance, gagal, belumSku };
}
