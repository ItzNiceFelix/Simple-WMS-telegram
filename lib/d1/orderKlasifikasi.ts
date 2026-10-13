// lib/d1/orderKlasifikasi.ts — Klasifikasi impor vs data WMS (B2, tabel T3 + T3b).
// Semua keputusan blokir/peringatan dihitung di sini BEFORE tulis; UI memakai hasil ini.
import type { StatusFile } from "./orderImportShopee";

/** Status file yang dihitung gudang (aktif diproses). */
const FILE_AKTIF = new Set<StatusFile>(["perlu_dikirim", "sedang_dikirim", "telah_dikirim", "selesai"]);

/** Tahap WMS (angka lebih besar = lebih maju). `batal` di luar urutan normal. */
const TAHAP_WMS: Record<string, number> = { pending: 0, pack: 1, kirim: 2, selesai: 3 };

/** Tahap setara dari sisi file. perlu_dikirim (-1) < pending (0) agar order yang belum
 *  pernah masuk WMS tetap dapat update (masuk picklist), sedangkan kirim/selesai setara skip. */
const TAHAP_FILE: Record<string, number> = { perlu_dikirim: -1, sedang_dikirim: 2, telah_dikirim: 2, selesai: 3 };

export type AksiKlasifikasi = "baru" | "update" | "skip" | "mundur" | "abaikan";

/**
 * Keputusan per order (tabel T3, F10). Murni — diuji tanpa D1.
 *   WMS pending + perlu_dikirim        → update (masuk picklist)
 *   WMS pack/kirim + sedang/telah      → update (tak masuk picklist lagi; alur hilir)
 *   WMS kirim/selesai + perlu_dikirim  → mundur (F10: status belum update di MP)
 *   tahap setara                       → skip
 *   WMS batal                          → abaikan (final; import tak menghidupkan order batal)
 *   file batal/belum bayar/…           → abaikan (tidak dihitung gudang)
 */
export function aksiOrder(wmsAda: boolean, wms: string, file: StatusFile): AksiKlasifikasi {
  if (!FILE_AKTIF.has(file)) return "abaikan";
  if (!wmsAda) return "baru";
  if (wms === "batal") return "abaikan";
  const tw = TAHAP_WMS[wms] ?? 0;
  const tf = TAHAP_FILE[file] ?? 0;
  if (tw >= 2 && file === "perlu_dikirim") return "mundur";
  if (wms === "selesai") return "skip"; // final: import tak menurunkan status order yang sudah selesai
  return tw === tf ? "skip" : "update";
}

export type OrderBaru = { no_pesanan: string; no_resi: string; statusFile: StatusFile; jasaKirim: string; tipeLayanan: string; cod: boolean; preorder: boolean };
export type AdvBaru = { booking_sn: string; no_resi: string };

export type OrderMundur = { no_pesanan: string; no_resi: string; wms: string; file: string };
export type ResiMultiOrder = { no_resi: string; no_pesanan: string[]; jumlah_order: number };
export type GandaDalamFile = { no_pesanan: string; jumlah: number };
export type KriteriaGabungan = { no_resi: string; no_pesanan: string[]; alasan: string[] };

export type HasilKlasifikasi = {
  baru: OrderBaru[];
  update: OrderBaru[];
  skip: OrderBaru[];
  mundur: OrderMundur[];
  resiMultiOrder: ResiMultiOrder[];
  gandaDalamFile: GandaDalamFile[];
  kriteriaGabungan: KriteriaGabungan[];
  advanceBaru: AdvBaru[];
  advanceSkip: string[];
};

type BarisWms = { no_pesanan: string; status_fulfill: string; no_resi: string };

/** Ambil status WMS untuk No. Pesanan di file, chunked IN 50 placeholder (aturan repo). */
async function ambilWms(db: D1Database, noList: string[]): Promise<Map<string, BarisWms>> {
  const peta = new Map<string, BarisWms>();
  for (let i = 0; i < noList.length; i += 50) {
    const potong = noList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT no_pesanan, status_fulfill, no_resi FROM orders WHERE marketplace = 'shopee' AND no_pesanan IN (${tanda})`)
      .bind(...potong)
      .all<BarisWms>();
    for (const r of results) peta.set(r.no_pesanan, r);
  }
  return peta;
}

/** Booking SN yang sudah ada di `advance_bookings` (idempoten, aturan 3e). */
async function ambilAdvanceAda(db: D1Database, snList: string[]): Promise<Set<string>> {
  const ada = new Set<string>();
  for (let i = 0; i < snList.length; i += 50) {
    const potong = snList.slice(i, i + 50);
    const tanda = potong.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT booking_sn FROM advance_bookings WHERE booking_sn IN (${tanda})`)
      .bind(...potong)
      .all<{ booking_sn: string }>();
    for (const r of results) ada.add(r.booking_sn);
  }
  return ada;
}

/**
 * Klasifikasi import: mana order baru / update / skip / mundur (F10), plus temuan
 * paket gabungan (F18). TIDAK menulis apa pun.
 */
export async function klasifikasikanImport(db: D1Database, orderBaru: OrderBaru[], advanceBaru: AdvBaru[]): Promise<HasilKlasifikasi> {
  const baru: OrderBaru[] = [];
  const update: OrderBaru[] = [];
  const skip: OrderBaru[] = [];
  const mundur: OrderMundur[] = [];

  // 3c: No. Pesanan ganda dalam file → blokir.
  const hitungNo = new Map<string, number>();
  for (const o of orderBaru) hitungNo.set(o.no_pesanan, (hitungNo.get(o.no_pesanan) ?? 0) + 1);
  const gandaDalamFile: GandaDalamFile[] = [...hitungNo.entries()].filter(([, n]) => n > 1).map(([no_pesanan, jumlah]) => ({ no_pesanan, jumlah }));

  const wms = await ambilWms(db, [...hitungNo.keys()]);
  for (const o of orderBaru) {
    const lama = wms.get(o.no_pesanan);
    const aksi = aksiOrder(Boolean(lama), lama?.status_fulfill ?? "", o.statusFile);
    if (aksi === "baru") baru.push(o);
    else if (aksi === "update") update.push(o);
    else if (aksi === "skip") skip.push(o);
    else if (aksi === "mundur") mundur.push({ no_pesanan: o.no_pesanan, no_resi: o.no_resi, wms: lama?.status_fulfill ?? "", file: o.statusFile });
    // "abaikan" → tidak masuk kategori mana pun (batal/belum bayar/status final)
  }

  // 3d2: satu resi dipakai >1 No. Pesanan = SAH (Pesanan Gabungan, F18) → peringatan bila langgar kriteria.
  const petaResi = new Map<string, OrderBaru[]>();
  for (const o of orderBaru) {
    if (!o.no_resi) continue;
    const arr = petaResi.get(o.no_resi) ?? [];
    arr.push(o);
    petaResi.set(o.no_resi, arr);
  }
  const resiMultiOrder: ResiMultiOrder[] = [];
  const kriteriaGabungan: KriteriaGabungan[] = [];
  for (const [no_resi, list] of petaResi) {
    if (list.length < 2) continue;
    const no_pesanan = list.map((o) => o.no_pesanan).sort();
    resiMultiOrder.push({ no_resi, no_pesanan, jumlah_order: list.length });
    const alasan: string[] = [];
    if (new Set(list.map((o) => o.jasaKirim)).size > 1) alasan.push("jasa kirim beda");
    if (new Set(list.map((o) => o.tipeLayanan)).size > 1) alasan.push("tipe layanan beda");
    if (list.some((o) => o.cod)) alasan.push("ada COD");
    if (list.some((o) => o.preorder)) alasan.push("ada pre-order");
    if (alasan.length) kriteriaGabungan.push({ no_resi, no_pesanan, alasan });
  }

  const advAda = await ambilAdvanceAda(db, advanceBaru.map((a) => a.booking_sn));
  const advanceBaruFinal = advanceBaru.filter((a) => !advAda.has(a.booking_sn));
  const advanceSkip = advanceBaru.filter((a) => advAda.has(a.booking_sn)).map((a) => a.booking_sn);

  return { baru, update, skip, mundur, resiMultiOrder, gandaDalamFile, kriteriaGabungan, advanceBaru: advanceBaruFinal, advanceSkip };
}
