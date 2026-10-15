// lib/d1/analisa.ts — Rakit masukan analisa dari D1.
//
// Pemisahan peran: `lib/analisa/hitung.ts` adalah fungsi MURNI (tanpa DB) yang menguji
// seluruh logika analisa; berkas INI satu-satunya yang menyentuh D1 dan menyiapkan
// masukannya. Jadi kalau ada salah angka, jelas mana yang harus diperiksa.
//
// Aturan yang mengikat: bila suatu data TIDAK ADA, diteruskan sebagai null/kosong —
// bukan diisi nol. Nol berarti "tidak ada biaya"; null berarti "tidak diketahui".
// Menyamakan keduanya membuat analisa mengklaim hal yang tidak ia ketahui.
import { listGudang } from "./gudang";
import { sekarang } from "./hasil";

/** Baris rincian seperti tersimpan di `laba_snapshot.rincian_json`. */
export type RincianSnapshot = {
  sku: string; nama: string | null; unit: number; hppSatuan: number;
  hargaJual: number; marginSatuan: number; marginPersen: number; kontribusi: number;
};

export type SnapshotAnalisa = {
  tanggal: string;
  jml_order: number;
  omzet: number;
  hpp: number;
  biaya: number;
  pajak: number;
  laba: number;
  rincian: RincianSnapshot[];
};

/** Daftar tanggal snapshot yang tersedia untuk satu preset, terbaru dulu. */
export async function daftarTanggalSnapshot(db: D1Database, presetId: number, batas = 60): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT tanggal FROM laba_snapshot WHERE preset_id = ? ORDER BY tanggal DESC LIMIT ?")
    .bind(presetId, Math.min(Math.max(batas, 1), 200))
    .all<{ tanggal: string }>();
  return (results ?? []).map((r) => r.tanggal);
}

/** Baca satu snapshot lengkap. null bila tidak ada. */
export async function ambilSnapshot(
  db: D1Database,
  presetId: number,
  tanggal: string
): Promise<SnapshotAnalisa | null> {
  const s = await db
    .prepare("SELECT * FROM laba_snapshot WHERE preset_id = ? AND tanggal = ?")
    .bind(presetId, tanggal)
    .first<Record<string, unknown>>();
  if (!s) return null;
  let rincian: RincianSnapshot[] = [];
  try {
    const arr = JSON.parse(String(s["rincian_json"] ?? "[]"));
    if (Array.isArray(arr)) rincian = arr as RincianSnapshot[];
  } catch {
    // rincian rusak = anggap kosong; analisa tetap jalan dan melaporkan SKU 0,
    // bukan gagal total dengan halaman kosong tanpa penjelasan.
    rincian = [];
  }
  return {
    tanggal: String(s["tanggal"] ?? tanggal),
    jml_order: Number(s["jml_order"] ?? 0),
    omzet: Number(s["omzet"] ?? 0),
    hpp: Number(s["hpp"] ?? 0),
    biaya: Number(s["biaya"] ?? 0),
    pajak: Number(s["pajak"] ?? 0),
    laba: Number(s["laba"] ?? 0),
    rincian,
  };
}

/** HPP master saat ini untuk sekumpulan SKU. Dipakai deteksi HPP basi. */
export async function petaHppMaster(db: D1Database, sku: string[]): Promise<Map<string, number>> {
  const peta = new Map<string, number>();
  if (sku.length === 0) return peta;
  // D1 membatasi jumlah parameter per query; potong agar aman.
  const UKURAN = 90;
  for (let i = 0; i < sku.length; i += UKURAN) {
    const bagian = sku.slice(i, i + UKURAN);
    const tanda = bagian.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT sku, hpp FROM products WHERE sku IN (${tanda})`)
      .bind(...bagian)
      .all<{ sku: string; hpp: number | null }>();
    for (const r of results ?? []) {
      // HPP null = tidak diketahui, BUKAN nol. Jangan masukkan supaya tidak dianggap basi.
      if (r.hpp !== null && Number.isFinite(Number(r.hpp)) && Number(r.hpp) > 0) peta.set(String(r.sku), Number(r.hpp));
    }
  }
  return peta;
}

/**
 * Stok total per SKU dari gudang NYATA (gudang online dikecualikan — itu gudang virtual
 * milik WMS, bukan stok fisik).
 * null (bukan Map kosong) bila tidak ada gudang nyata sama sekali — supaya analisa
 * tahu bahwa data stok memang tidak tersedia, bukan bahwa stoknya nol.
 */
export async function petaStok(db: D1Database): Promise<Map<string, number> | null> {
  const gudang = await listGudang(db);
  const nyata = gudang.filter((g) => g.is_online === 0);
  if (nyata.length === 0) return null;
  const tanda = nyata.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT sku, SUM(qty) AS qty FROM stock_by_bin WHERE warehouse_id IN (${tanda}) GROUP BY sku`)
    .bind(...nyata.map((g) => g.id))
    .all<{ sku: string; qty: number }>();
  const peta = new Map<string, number>();
  for (const r of results ?? []) peta.set(String(r.sku), Number(r.qty ?? 0));
  return peta;
}

/**
 * Total biaya iklan per SKU untuk satu rentang tanggal.
 * null bila tabel `ads_produk` belum ada isinya — itu BUKAN nol; artinya data belum diimpor.
 */
export async function totalIklanPeriode(
  db: D1Database,
  presetId: number,
  dari: string,
  sampai: string
): Promise<number | null> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(biaya), 0) AS total FROM ads_produk WHERE preset_id = ? AND tanggal BETWEEN ? AND ?")
    .bind(presetId, dari, sampai)
    .first<{ n: number; total: number }>()
    .catch(() => null);
  // Tabel belum ada / query gagal → null (belum ada data), bukan 0 (tidak ada biaya).
  if (!r) return null;
  return Number(r.n) > 0 ? Number(r.total) : null;
}

/**
 * Metrik iklan per SKU untuk satu rentang tanggal.
 *
 * Kosong (Map tanpa isi) bila tabel `ads_produk` belum ada / belum diimpor — sengaja
 * TIDAK melempar, karena halaman analisa harus tetap tampil walau importer belum jalan.
 * Gaya sama dengan `totalIklanPeriode`: null/kosong berarti "belum diketahui", bukan nol.
 */
export async function metrikIklanPerSku(
  db: D1Database,
  presetId: number,
  dari: string,
  sampai: string
): Promise<Map<string, { dilihat: number; klik: number; biaya: number; omzet: number }>> {
  const peta = new Map<string, { dilihat: number; klik: number; biaya: number; omzet: number }>();
  const r = await db
    .prepare(
      "SELECT sku, COALESCE(SUM(dilihat), 0) AS dilihat, COALESCE(SUM(klik), 0) AS klik, " +
        "COALESCE(SUM(biaya), 0) AS biaya, COALESCE(SUM(omzet_iklan), 0) AS omzet " +
        "FROM ads_produk WHERE preset_id = ? AND tanggal BETWEEN ? AND ? GROUP BY sku"
    )
    .bind(presetId, dari, sampai)
    .all<{ sku: string; dilihat: number; klik: number; biaya: number; omzet: number }>()
    .catch(() => null);
  for (const x of r?.results ?? []) {
    const angka = [Number(x.dilihat ?? 0), Number(x.klik ?? 0), Number(x.biaya ?? 0), Number(x.omzet ?? 0)];
    if (!angka.every(Number.isFinite)) continue; // baris rusak dilewati, bukan meracuni seluruh tabel
    peta.set(String(x.sku), { dilihat: angka[0], klik: angka[1], biaya: angka[2], omzet: angka[3] });
  }
  return peta;
}

/**
 * Metrik performa ORGANIK per SKU (kunjungan/keranjang/pesanan dari halaman produk,
 * TANPA iklan) — inilah datanya yang selama ini hanya dihitung jumlah barisnya.
 *
 * KENAPA TIDAK MEMFILTER `periode = ?`: importer memanggil `simpanPerforma(db, presetId, "",
 * baris)` (lib/d1/shopeePetaImpor.ts) sehingga kolom `periode` di produksi berisi string
 * KOSONG. Filter ketat `periode = ?` akan menghasilkan nol baris dan mengembalikan bug lama
 * ("data belum ada" padahal 264 baris tersimpan). Jadi: ambil semua baris preset itu, lalu
 * bila ada beberapa periode berbeda pilih kelompok TERBARU lewat `at DESC` — satu periode
 * saja yang dipakai supaya angka dari rentang waktu berbeda tidak dijumlahkan diam-diam.
 *
 * Kosong (Map tanpa isi) bila tabel belum ada / belum diimpor — sengaja TIDAK melempar,
 * sama seperti `metrikIklanPerSku`: halaman analisa harus tetap tampil.
 */
export async function performaPerSku(
  db: D1Database,
  presetId: number,
  periode: string
): Promise<Map<string, { dilihat: number; klik: number; kunjungan: number; keranjang: number; pesanan: number; omzet: number; tanpaBeli: number }>> {
  void periode; // disengaja tidak dipakai menyaring — lihat catatan di atas.
  const peta = new Map<string, { dilihat: number; klik: number; kunjungan: number; keranjang: number; pesanan: number; omzet: number; tanpaBeli: number }>();
  const r = await db
    .prepare(
      "SELECT sku, dilihat, klik, kunjungan, keranjang, pesanan, omzet, melihat_tanpa_beli " +
        "FROM performa_produk WHERE preset_id = ? ORDER BY at DESC, sku"
    )
    .bind(presetId)
    .all<{
      sku: string; dilihat: number; klik: number; kunjungan: number;
      keranjang: number; pesanan: number; omzet: number; melihat_tanpa_beli: number;
    }>()
    .catch(() => null);
  // `sku` adalah kunci utama tabel, jadi satu SKU tidak mungkin muncul dua kali dalam
  // periode yang sama. Baris pertama per SKU karena itu sudah yang terbaru (`at DESC`).
  for (const x of r?.results ?? []) {
    const sku = String(x.sku ?? "");
    if (sku === "" || peta.has(sku)) continue;
    const angka = [
      Number(x.dilihat ?? 0), Number(x.klik ?? 0), Number(x.kunjungan ?? 0),
      Number(x.keranjang ?? 0), Number(x.pesanan ?? 0), Number(x.omzet ?? 0),
      Number(x.melihat_tanpa_beli ?? 0),
    ];
    if (!angka.every(Number.isFinite)) continue; // baris rusak dilewati, bukan meracuni tabel
    peta.set(sku, {
      dilihat: angka[0], klik: angka[1], kunjungan: angka[2],
      keranjang: angka[3], pesanan: angka[4], omzet: angka[5], tanpaBeli: angka[6],
    });
  }
  return peta;
}

/** Apakah ada data performa produk untuk rentang ini. */
export async function adaPerforma(db: D1Database, presetId: number): Promise<boolean> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM performa_produk WHERE preset_id = ?")
    .bind(presetId)
    .first<{ n: number }>()
    .catch(() => null);
  return Number(r?.n ?? 0) > 0;
}

/** Preset aktif untuk pemilih di halaman. */
export async function daftarPresetAnalisa(db: D1Database) {
  const { results } = await db
    .prepare("SELECT id, nama FROM seller_presets WHERE dihapus_at IS NULL ORDER BY id")
    .all<{ id: number; nama: string }>();
  return results ?? [];
}

/** Stempel waktu untuk keperluan jejak di respons API. */
export function waktuSekarang(): number {
  return sekarang();
}
