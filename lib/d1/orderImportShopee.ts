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

/**
 * Tombol "Belum ada SKU di MP" (sku_belum_mp) — diteruskan ke hasil untuk tagging UI.
 *
 * Dikelompokkan per (nama_shopee, variasi) IDENTIK: satu baris preview mewakili
 * semua order yang memuat produk sama, supaya SKU dipetakan sekali saja.
 * `order_refs` = seluruh No. Pesanan yang terkena; `order_ref` = yang pertama (kompat).
 */
export type BarisBelumSku = {
  order_ref: string;
  order_refs: string[];
  jumlah_order: number;
  nama_shopee: string;
  variasi: string;
  qty_total: number;
  /**
   * SKU yang tertulis di file tapi tidak ada di master. Diisi = kasus "SKU bermasalah",
   * kosong = baris memang tanpa SKU. Pembeda ini dipakai UI dan picklist.
   */
  sku_asal: string;
  /** Dari jalur mana baris ini datang: pesanan biasa atau advance fulfilment. */
  sumber: "order" | "advance";
};

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
  // Kumpulan mentah baris tanpa SKU; dikelompokkan di akhir per (nama, variasi).
  const belumSkuMentah: {
    order_ref: string; nama_shopee: string; variasi: string; qty: number;
    sku_asal?: string; sumber?: "order" | "advance";
  }[] = [];

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
    const namaShopee = text(row["Nama Produk"]);
    const jml = angkaShopee(row["Jumlah"]);
    const kembali = angkaShopee(row["Returned quantity"]);
    if (jml < 1) {
      gagal.push({ no_pesanan: no, sku, pesan: `Jumlah ${jml} tidak valid (minimal 1).` });
      continue;
    }
    // F13: qty bersih retur. Retur PENUH menghasilkan 0, bukan 1 — qty 1 membuat barang yang
    // dikembalikan terhitung terjual. Baris qty 0 TETAP disimpan (tidak `continue`): biaya
    // per-order dialokasikan lewat baris order, jadi membuang barisnya membuat alokasi bocor
    // dan omzet order tidak lagi cocok dengan rincian per SKU.
    const qty = Math.max(0, jml - kembali);
    const harga = angkaShopee(row["Harga Setelah Diskon"]);
    if (!sku) {
      // Baris tanpa SKU: order TETAP dibuat (jangan hilang), item disimpan dengan sku ""
      // agar bisa dipetakan manual saat konfirmasi. Tanpa ini, order yang seluruh barisnya
      // tanpa SKU hilang total padahal barangnya ada di file.
      belumSkuMentah.push({ order_ref: no, nama_shopee: namaShopee, variasi, qty, sumber: "order" });
      const kunciKosong = `\u0000${namaShopee}\u0000${variasi}`;
      const lamaKosong = g.items.get(kunciKosong);
      g.items.set(kunciKosong, {
        sku: "",
        variasi,
        nama_shopee: namaShopee,
        qty: (lamaKosong?.qty ?? 0) + qty,
        harga_satuan: lamaKosong?.harga_satuan ?? harga,
        subtotal: (lamaKosong?.subtotal ?? 0) + angkaShopee(row["Subtotal Pesanan"]),
      });
      continue;
    }
    const kunci = `${sku}\u0000${variasi}`;
    const lama = g.items.get(kunci);
    g.items.set(kunci, {
      sku,
      variasi,
      nama_shopee: namaShopee,
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
      gagal.push({ no_pesanan: g.no, pesan: "Tak ada baris barang pada pesanan ini." });
      continue;
    }
    // Item dianggap "hilang" bila SKU-nya tidak ada di master. Item TANPA SKU (sku "")
    // bukan hilang — order tetap dibuat, SKU diisi saat konfirmasi manual.
    //
    // Baris ber-SKU-tak-dikenal TIDAK lagi membuang ordernya. Dulu `continue` di sini
    // melempar seluruh order padahal masalahnya cuma SKU belum masuk master — lebih mudah
    // diperbaiki daripada baris kosong, tapi justru dihukum lebih berat. Sekarang barisnya
    // diperlakukan sama dengan baris tanpa SKU: masuk daftar "Perlu SKU" untuk dipetakan.
    const hilang = [...g.items.values()].filter((it) => it.sku && !hasSku(it.sku));
    for (const it of hilang) {
      belumSkuMentah.push({ order_ref: g.no, nama_shopee: it.nama_shopee, variasi: it.variasi, qty: it.qty, sku_asal: it.sku, sumber: "order" });
    }
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
    // Advance juga TIDAK lagi membuang baris. Dulu barisnya hilang di sini dan pesan
    // gagalnya tidak dirender di dialog mana pun — jadi barangnya raib tanpa jejak.
    // Sekarang masuk daftar "Perlu SKU" yang sama dengan jalur order.
    if (!sku || !hasSku(sku)) {
      belumSkuMentah.push({
        order_ref: sn,
        nama_shopee: text(row["Nama Produk"]),
        variasi: text(row["Nama Variasi"]),
        qty: 1,
        sku_asal: sku,
        sumber: "advance",
      });
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

  return { orders, advance, gagal, belumSku: kelompokkanBelumSku(belumSkuMentah) };
}

/**
 * Kelompokkan baris tanpa SKU per (nama_shopee, variasi) IDENTIK.
 * Satu produk yang muncul di banyak order jadi SATU baris preview: pemetaan SKU
 * cukup sekali, lalu diterapkan ke semua order anggotanya.
 * Urut dari yang paling banyak order (paling menghemat) lalu nama.
 */
function kelompokkanBelumSku(mentah: {
  order_ref: string; nama_shopee: string; variasi: string; qty: number;
  sku_asal?: string; sumber?: "order" | "advance";
}[]): BarisBelumSku[] {
  const peta = new Map<string, { nama: string; variasi: string; refs: string[]; qty: number; sku: string; sumber: "order" | "advance" }>();
  for (const b of mentah) {
    const k = `${b.nama_shopee}\u0000${b.variasi}`;
    let e = peta.get(k);
    if (!e) {
      e = { nama: b.nama_shopee, variasi: b.variasi, refs: [], qty: 0, sku: b.sku_asal ?? "", sumber: b.sumber ?? "order" };
      peta.set(k, e);
    }
    // SKU bermasalah menang atas "kosong": kalau satu produk muncul sebagai baris kosong
    // dan baris ber-SKU-salah, yang ditampilkan adalah SKU salahnya supaya user bisa
    // melihat apa yang tertulis di file.
    if (!e.sku && b.sku_asal) e.sku = b.sku_asal;
    if (!e.refs.includes(b.order_ref)) e.refs.push(b.order_ref);
    e.qty += b.qty;
  }
  return [...peta.values()]
    .map((e) => ({
      order_ref: e.refs[0] ?? "",
      order_refs: e.refs,
      jumlah_order: e.refs.length,
      sku_asal: e.sku,
      sumber: e.sumber,
      nama_shopee: e.nama,
      variasi: e.variasi,
      qty_total: e.qty,
    }))
    .sort((a, b) => b.jumlah_order - a.jumlah_order || a.nama_shopee.localeCompare(b.nama_shopee) || a.variasi.localeCompare(b.variasi));
}
