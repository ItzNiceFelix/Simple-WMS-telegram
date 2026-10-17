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
import type { SnapshotRinci } from "@/lib/analisa/tren";

/** Baris rincian seperti tersimpan di `laba_snapshot.rincian_json`. */
export type RincianSnapshot = {
  sku: string; nama: string | null; unit: number; hppSatuan: number;
  hargaJual: number; marginSatuan: number; marginPersen: number; kontribusi: number;
  /**
   * Omzet apa adanya dari penghitungan snapshot. OPSIONAL: snapshot lama (pra-perubahan)
   * tidak menyimpannya, jadi pembaca wajib fallback `hargaJual × unit`.
   */
  omzet?: number;
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

/**
 * Daftar periode impor Performa Produk yang tersedia, terbaru dulu.
 *
 * `legacy`/`''` dibuang: baris lama tidak punya rentang tanggal, jadi tidak bisa dibandingkan
 * dengan periode mana pun. Memasukkannya ke pilihan hanya menghasilkan kartu penuh "—".
 *
 * `at DESC` sebagai pengurut kedua karena teks ISO tidak selalu mencerminkan urutan impor
 * (impor ulang periode lama yang sama harus tetap dianggap baru).
 */
export async function daftarPeriodePerforma(db: D1Database, presetId: number): Promise<string[]> {
  const r = await db
    .prepare(
      "SELECT periode, MAX(at) AS at FROM performa_produk " +
        "WHERE preset_id = ? AND periode <> '' AND periode <> 'legacy' GROUP BY periode " +
        "ORDER BY periode DESC, at DESC"
    )
    .bind(presetId)
    .all<{ periode: string }>()
    .catch(() => null);
  return (r?.results ?? []).map((x) => String(x.periode)).filter((p) => p !== "");
}

/**
 * Performa seluruh SKU untuk SATU periode — versi `performaPerSku` yang benar-benar
 * menyaring `periode = ?`.
 *
 * `performaPerSku` sengaja tidak menyaring (lihat catatannya: importer lama menulis '').
 * Untuk tab Detail Produk filter itu WAJIB: tanpa filter, memilih periode lama tetap
 * menampilkan angka impor terbaru, dan delta antar periode menjadi nol/salah.
 * Kosong = data periode itu belum diimpor, bukan "semua nol".
 */
export async function performaSemuaSku(
  db: D1Database,
  presetId: number,
  periode: string
): Promise<Map<string, { dilihat: number; klik: number; kunjungan: number; keranjang: number; pesanan: number; omzet: number; tanpaBeli: number }>> {
  const peta = new Map<string, { dilihat: number; klik: number; kunjungan: number; keranjang: number; pesanan: number; omzet: number; tanpaBeli: number }>();
  if (periode === "" || periode === "legacy") return peta;
  const r = await db
    .prepare(
      "SELECT sku, dilihat, klik, kunjungan, keranjang, pesanan, omzet, melihat_tanpa_beli " +
        "FROM performa_produk WHERE preset_id = ? AND periode = ?"
    )
    .bind(presetId, periode)
    .all<{
      sku: string; dilihat: number; klik: number; kunjungan: number;
      keranjang: number; pesanan: number; omzet: number; melihat_tanpa_beli: number;
    }>()
    .catch(() => null);
  for (const x of r?.results ?? []) {
    const sku = String(x.sku ?? "");
    if (sku === "") continue;
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

/** Satu hari biaya iklan sebuah SKU — titik grafik di dialog detail. */
export type BarisIklanHarian = {
  tanggal: string; biaya: number; klik: number; dilihat: number; omzetIklan: number;
};

/**
 * Riwayat iklan HARIAN satu SKU, urut tanggal menaik. Kosong bila SKU itu tidak diiklankan
 * pada rentang tersebut — grafik dialog menampilkannya sebagai "tidak ada data", bukan nol.
 */
export async function iklanHarianPerSku(
  db: D1Database,
  presetId: number,
  sku: string,
  dari: string,
  sampai: string
): Promise<BarisIklanHarian[]> {
  const r = await db
    .prepare(
      "SELECT tanggal, COALESCE(biaya, 0) AS biaya, COALESCE(klik, 0) AS klik, " +
        "COALESCE(dilihat, 0) AS dilihat, COALESCE(omzet_iklan, 0) AS omzet " +
        "FROM ads_produk WHERE preset_id = ? AND sku = ? AND tanggal BETWEEN ? AND ? ORDER BY tanggal ASC"
    )
    .bind(presetId, sku, dari, sampai)
    .all<{ tanggal: string; biaya: number; klik: number; dilihat: number; omzet: number }>()
    .catch(() => null);
  const baris: BarisIklanHarian[] = [];
  for (const x of r?.results ?? []) {
    const angka = [Number(x.biaya ?? 0), Number(x.klik ?? 0), Number(x.dilihat ?? 0), Number(x.omzet ?? 0)];
    if (!angka.every(Number.isFinite)) continue;
    baris.push({
      tanggal: String(x.tanggal ?? ""), biaya: angka[0], klik: angka[1],
      dilihat: angka[2], omzetIklan: angka[3],
    });
  }
  return baris;
}

/** Satu hari historis penjualan sebuah SKU, seperti dipakai `estimasiIklan`. */
export type BarisHistoriSku = {
  tanggal: string; omzet: number; unit: number; marginSatuan: number; hargaJual: number;
};

/**
 * Histori penjualan per SKU dari SEMUA snapshot preset ini, urut tanggal MENAIK.
 *
 * Sumber angkanya `rincian_json` per tanggal. `omzet` dipakai APA ADANYA bila ada —
 * itulah omzet yang benar-benar dihitung saat snapshot dibuat.
 *
 * Fallback `hargaJual × unit` HANYA untuk baris lama pra-perubahan (rincian_json belum
 * punya `omzet`) dan boleh dihapus setelah semua snapshot dihitung ulang; tanpa fallback
 * ini estimasi untuk data lama langsung rusak. Perlu dicatat fallback itu tidak persis:
 * `hargaJual` dibulatkan per unit (pada data nyata selisihnya ~0,8%).
 *
 * Rusak → DILEWATI, bukan melempar: satu tanggal dengan JSON cacat tidak boleh
 * menghapus histori tanggal lain (gaya sama dengan `performaPerSku`/`ambilSnapshot`).
 */
export async function historiPerSku(
  db: D1Database,
  presetId: number
): Promise<Map<string, BarisHistoriSku[]>> {
  const peta = new Map<string, BarisHistoriSku[]>();
  const { results } = await db
    .prepare("SELECT tanggal, rincian_json FROM laba_snapshot WHERE preset_id = ? ORDER BY tanggal ASC")
    .bind(presetId)
    .all<{ tanggal: string; rincian_json: string | null }>();
  for (const s of results ?? []) {
    const tanggal = String(s.tanggal ?? "");
    if (tanggal === "") continue;
    let arr: unknown;
    try {
      arr = JSON.parse(String(s.rincian_json ?? "[]"));
    } catch {
      continue; // rincian_json rusak pada tanggal ini → lewati tanggal itu saja
    }
    if (!Array.isArray(arr)) continue;
    for (const r of arr as RincianSnapshot[]) {
      const sku = String(r?.sku ?? "");
      const unit = Number(r?.unit ?? 0);
      const hargaJual = Number(r?.hargaJual ?? 0);
      const marginSatuan = Number(r?.marginSatuan ?? 0);
      if (sku === "" || !Number.isFinite(unit) || !Number.isFinite(hargaJual) || !Number.isFinite(marginSatuan)) continue;
      // SKU tidak dijual di tanggal ini = tidak ada baris. Jangan tambahkan hari bernilai
      // nol; itu akan dihitung sebagai "hari terburuk" dan membuat estimasi terlalu pesimis.
      if (unit <= 0) continue;
      // Omzet tersimpan diutamakan; 0/bukan angka (termasuk `undefined` di baris lama)
      // jatuh ke rekonstruksi `hargaJual × unit` — nol di sini berarti "tidak diketahui",
      // bukan "omzet nol", dan menghasilkan 0/NaN akan merusak estimasi iklan.
      const omzetTersimpan = Number(r?.omzet);
      const omzet = Number.isFinite(omzetTersimpan) && omzetTersimpan > 0 ? omzetTersimpan : hargaJual * unit;
      const daftar = peta.get(sku) ?? [];
      daftar.push({ tanggal, omzet, unit, marginSatuan, hargaJual });
      peta.set(sku, daftar);
    }
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

// ── Masukan grafik tren (halaman Ringkasan Analisa) ──
// Rentang di sini SELALU inklusif dua ujungnya, sama seperti `seriHarian`.

/**
 * Snapshot beberapa hari sekaligus untuk grafik tren.
 *
 * `pajak` SELALU ikut lewat COALESCE 0: kolomnya baru ditambahkan setelah snapshot lama
 * tersimpan, dan di D1 lama itu NULL. Tanpa COALESCE, `biaya - pajak` jadi NaN dan seluruh
 * komposisi biaya hilang hanya karena satu baris lama — nol di sini jujur: snapshot lama
 * memang tidak mencatat pajak terpisah.
 */
export async function snapshotRentang(
  db: D1Database,
  presetId: number,
  dari: string,
  sampai: string
): Promise<SnapshotRinci[]> {
  const hasil = await db
    .prepare(
      "SELECT tanggal, omzet, hpp, biaya, COALESCE(pajak, 0) AS pajak, laba, jml_order " +
        "FROM laba_snapshot WHERE preset_id = ? AND tanggal >= ? AND tanggal <= ? ORDER BY tanggal"
    )
    .bind(presetId, dari, sampai)
    // Tabel/kolom belum ada (DB lama) → daftar kosong: grafik tampil "data belum ada",
    // bukan halaman error. Gaya sama dengan `metrikIklanPerSku`.
    .all<Record<string, unknown>>()
    .catch(() => null);
  const out: SnapshotRinci[] = [];
  for (const r of hasil?.results ?? []) {
    const tanggal = String(r["tanggal"] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) continue; // baris rusak dilewati, bukan meracuni seri
    const angka = [
      Number(r["omzet"] ?? 0), Number(r["hpp"] ?? 0), Number(r["biaya"] ?? 0),
      Number(r["pajak"] ?? 0), Number(r["laba"] ?? 0), Number(r["jml_order"] ?? 0),
    ];
    if (!angka.every(Number.isFinite)) continue;
    out.push({
      tanggal,
      omzet: angka[0], hpp: angka[1], biaya: angka[2],
      pajak: angka[3], laba: angka[4], jml_order: angka[5],
    });
  }
  return out;
}

/**
 * Omzet & laba per JAM pesanan dibuat, dijumlah dari `laba_order` untuk tanggal snapshot
 * yang dipilih. Selalu 24 elemen (jam 0–23), termasuk jam tanpa pesanan (omzet 0) —
 * grafik per jam butuh sumbu 24 jam yang utuh, bukan hanya jam yang kebetulan ada isinya.
 *
 * Jam diambil dari `substr(tanggal_pesanan, 12, 2)`: format kolomnya `YYYY-MM-DD HH:MM`
 * (WIB), jadi posisi 12–13 adalah jam. Baris tanpa jam valid dilewati.
 */
export async function orderPerJam(
  db: D1Database,
  presetId: number,
  tanggal: string[]
): Promise<{ jam: number; omzet: number; laba: number }[]> {
  const out = Array.from({ length: 24 }, (_, jam) => ({ jam, omzet: 0, laba: 0 }));
  const unik = [...new Set(tanggal)].filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
  if (unik.length === 0) return out;
  // D1 membatasi jumlah parameter per query; potong agar aman (gaya sama dengan petaHppMaster).
  const UKURAN = 90;
  for (let i = 0; i < unik.length; i += UKURAN) {
    const bagian = unik.slice(i, i + UKURAN);
    const tanda = bagian.map(() => "?").join(",");
    const bagianHasil = await db
      .prepare(
        "SELECT substr(tanggal_pesanan, 12, 2) AS jam, COALESCE(SUM(omzet), 0) AS omzet, " +
          "COALESCE(SUM(laba), 0) AS laba FROM laba_order " +
          `WHERE preset_id = ? AND tanggal_snapshot IN (${tanda}) GROUP BY jam`
      )
      .bind(presetId, ...bagian)
      .all<{ jam: string | null; omzet: number; laba: number }>()
      .catch(() => null);
    for (const r of bagianHasil?.results ?? []) {
      const jam = Number(r.jam);
      // Jam rusak/kosong (mis. baris tanpa Waktu Pesanan Dibuat) tidak bisa ditaruh di
      // sumbu 24 jam; membuangnya lebih jujur daripada menaruhnya di jam tertentu.
      if (!Number.isInteger(jam) || jam < 0 || jam > 23) continue;
      out[jam].omzet += Number(r.omzet ?? 0) || 0;
      out[jam].laba += Number(r.laba ?? 0) || 0;
    }
  }
  return out;
}

/**
 * Qty terjual per SKU dalam satu rentang tanggal, dari order NYATA (`orders` ⋈ `order_items`).
 *
 * Sumber berbeda dari snapshot disengaja: snapshot hanya memuat SKU yang menghasilkan laba,
 * sedangkan klasifikasi fast/slow/dead butuh qty nol pun (dead stock). Order batal
 * dikecualikan karena barangnya belum tentu keluar gudang — menghitungnya membuat SKU mati
 * terlihat laku, justru kesalahan yang mau dicegah panel ini.
 */
export async function volumeSkuRentang(
  db: D1Database,
  presetId: number,
  dari: string,
  sampai: string
): Promise<Map<string, { qty: number }>> {
  // `orders.tanggal` adalah epoch detik (lihat migrasi 0006), bukan teks tanggal. Batas
  // akhir memakai 23:59:59 di hari `sampai` supaya order siang hari terakhir ikut.
  const epochDari = Math.floor(Date.parse(`${dari}T00:00:00Z`) / 1000);
  const epochSampai = Math.floor(Date.parse(`${sampai}T23:59:59Z`) / 1000);
  const peta = new Map<string, { qty: number }>();
  if (!Number.isFinite(epochDari) || !Number.isFinite(epochSampai)) return peta;
  const hasil = await db
    .prepare(
      "SELECT i.sku AS sku, COALESCE(SUM(i.qty), 0) AS qty " +
        "FROM orders o JOIN order_items i ON i.marketplace = o.marketplace AND i.no_pesanan = o.no_pesanan " +
        "WHERE o.preset_id = ? AND o.tanggal >= ? AND o.tanggal <= ? AND o.status_fulfill <> 'batal' " +
        "GROUP BY i.sku"
    )
    .bind(presetId, epochDari, epochSampai)
    .all<{ sku: string; qty: number }>()
    .catch(() => null);
  for (const r of hasil?.results ?? []) {
    const sku = String(r.sku ?? "");
    if (sku === "") continue;
    const qty = Number(r.qty ?? 0);
    if (!Number.isFinite(qty)) continue;
    peta.set(sku, { qty });
  }
  return peta;
}
