// lib/d1/shopeePeta.ts — Baca/tulis peta produk Shopee (migrasi 0027) ke D1.
//
// Kenapa dipisah dari lib/analisa/peta.ts: file itu MURNI (tanpa DB) supaya aturan
// pemetaan bisa diuji tanpa database. Di sini hanya soal simpan/ambil apa adanya.
//
// ATURAN YANG MENGIKAT: keputusan manusia (`diputuskan_sku/at/oleh`) TIDAK BOLEH
// tertimpa oleh impor berikutnya. Karena itu upsert di bawah sengaja TIDAK menyentuh
// ketiga kolom itu — kalau tertimpa, produk yang sudah dijawab "bukan produk kita"
// akan kembali muncul sebagai pertanyaan dan omzetnya salah tempel.
import { sekarang, type Hasil } from "./hasil";
import type { BarisPeta, PertanyaanPeta } from "@/lib/analisa/peta";

/** Satu pertanyaan dari `peta_putusan` — kandidat sudah di-parse. */
export type PertanyaanDb = {
  jenis: PertanyaanPeta["jenis"];
  acuan: string;
  nama_shopee: string;
  pesanan: number;
  omzet: number;
  kandidat_json: PertanyaanPeta["kandidat"];
  /**
   * Hasil keputusan manusia. `null` = belum diputuskan; `""` = "bukan produk kita";
   * selain itu = SKU yang dipilih. Dipakai UI untuk memisahkan daftar yang masih
   * menunggu jawaban dari yang sudah selesai.
   */
  diputuskanSku: string | null;
};

/** Jawaban manusia untuk satu pertanyaan. `sku` = "" berarti "bukan produk kita". */
export type JawabanSku = { jenis: PertanyaanPeta["jenis"]; acuan: string; sku: string };

const KOLOM_PERTANYAAN = "jenis, acuan, nama_shopee, pesanan, omzet, kandidat_json, diputuskan_sku";

/** Batas per `db.batch()` — D1 menolak batch besar; 50 sama dengan pola repo lain. */
const POTONG = 50;
/** Batas parameter per query: D1 mentok 100; 90 menyisakan ruang untuk klausa lain. */
const POTONG_SKU = 90;

/**
 * Kandidat disimpan sebagai teks JSON. Kalau rusak (impor versi lama, tangan manusia),
 * peta TIDAK boleh gagal tampil — pertanyaan tanpa kandidat masih berguna, kandidat
 * kosong hanya berarti kolom saran tampil kosong.
 */
function keBaris(
  r: Omit<PertanyaanDb, "kandidat_json" | "diputuskanSku"> & { kandidat_json: unknown; diputuskan_sku?: unknown },
): PertanyaanDb {
  let kandidat: PertanyaanPeta["kandidat"] = [];
  if (typeof r.kandidat_json === "string") {
    try {
      const v = JSON.parse(r.kandidat_json);
      if (Array.isArray(v)) kandidat = v;
    } catch {
      kandidat = [];
    }
  }
  // diputuskan_sku null = belum diputuskan. String kosong SENGAJA dipertahankan sebagai
  // "" (artinya "bukan produk kita"), bukan diubah jadi null — keduanya beda arti.
  const mentah = r.diputuskan_sku;
  const diputuskanSku = mentah === null || mentah === undefined ? null : String(mentah);
  return { jenis: r.jenis, acuan: r.acuan, nama_shopee: r.nama_shopee, pesanan: r.pesanan, omzet: r.omzet, kandidat_json: kandidat, diputuskanSku };
}

/** Pertanyaan yang belum dijawab manusia, terbesar dulu (yang menentukan omzet lebih dulu). */
export async function daftarPertanyaanBelum(db: D1Database, batas = 200): Promise<PertanyaanDb[]> {
  const { results } = await db
    .prepare(
      `SELECT ${KOLOM_PERTANYAAN} FROM peta_putusan WHERE diputuskan_at IS NULL ` +
        "ORDER BY pesanan DESC, omzet DESC LIMIT ?",
    )
    .bind(batas)
    .all<Omit<PertanyaanDb, "kandidat_json"> & { kandidat_json: unknown }>();
  return results.map(keBaris);
}

/** Semua pertanyaan termasuk yang sudah dijawab (untuk audit "siapa memutuskan apa"). */
export async function daftarPertanyaanSemua(db: D1Database, batas = 500): Promise<PertanyaanDb[]> {
  const { results } = await db
    .prepare(`SELECT ${KOLOM_PERTANYAAN} FROM peta_putusan ORDER BY pesanan DESC, omzet DESC LIMIT ?`)
    .bind(batas)
    .all<Omit<PertanyaanDb, "kandidat_json"> & { kandidat_json: unknown }>();
  return results.map(keBaris);
}

/**
 * Simpan pertanyaan hasil pemetaan (upsert per jenis+acuan, idempoten).
 * Kolom keputusan manusia sengaja DIKOSONGKAN dari DO UPDATE.
 */
export async function simpanPertanyaan(db: D1Database, daftar: PertanyaanPeta[]): Promise<void> {
  if (daftar.length === 0) return;
  const at = sekarang();
  const stmts = daftar.map((p) =>
    db
      .prepare(
        "INSERT INTO peta_putusan (jenis, acuan, nama_shopee, pesanan, omzet, kandidat_json, at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(jenis, acuan) DO UPDATE SET pesanan = excluded.pesanan, omzet = excluded.omzet, " +
          "nama_shopee = excluded.nama_shopee, kandidat_json = excluded.kandidat_json",
      )
      .bind(p.jenis, p.kodeProduk, p.namaShopee, p.pesanan, p.omzet, JSON.stringify(p.kandidat), at),
  );
  for (let i = 0; i < stmts.length; i += POTONG) await db.batch(stmts.slice(i, i + POTONG));
}

/** Simpan baris peta produk (upsert per kode_produk+sku) — impor ulang harus idempoten. */
export async function simpanPetaProduk(db: D1Database, baris: BarisPeta[]): Promise<void> {
  if (baris.length === 0) return;
  const at = sekarang();
  const stmts = baris.map((b) =>
    db
      .prepare(
        "INSERT INTO shopee_produk (kode_produk, sku, tingkat, variasi, kode_variasi_shopee, nama_shopee, at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(kode_produk, sku) DO UPDATE SET tingkat = excluded.tingkat, variasi = excluded.variasi, " +
          "kode_variasi_shopee = excluded.kode_variasi_shopee, nama_shopee = excluded.nama_shopee, at = excluded.at",
      )
      .bind(b.kodeProduk, b.sku, b.tingkat, b.variasi, b.kodeVariasiShopee, b.namaShopee, at),
  );
  for (let i = 0; i < stmts.length; i += POTONG) await db.batch(stmts.slice(i, i + POTONG));
}

/**
 * Jawab pertanyaan: simpan SKU yang dipilih manusia (`""` = bukan produk kita).
 *
 * TIGA KEADAAN yang berbeda — jangan dicampur:
 *   diputuskan_at IS NULL                     → belum dijawab, `daftarPertanyaanBelum` tetap menampilkannya
 *   diputuskan_sku = "" + diputuskan_at terisi → SENGAJA DIABAIKAN ("bukan produk kita"), tidak tampil lagi
 *   diputuskan_sku = "SKU-XYZ"                → dipetakan, tidak tampil lagi
 * Karena `""` ditulis bersama `diputuskan_at`, baris "diabaikan" otomatis hilang dari daftar pertanyaan
 * (filternya `diputuskan_at IS NULL`). Tidak perlu migrasi: skema sudah punya kedua kolom + UNIQUE (jenis, acuan).
 *
 * `diabaikan` = baris yang sudah tidak ada lagi (perubahan 0) — bukan error, karena
 * halaman bisa saja masih memegang daftar lama sementara impor berikutnya menghapusnya.
 */
export async function jawabPertanyaan(
  db: D1Database,
  jawaban: JawabanSku[],
  oleh: string,
): Promise<Hasil<{ tersimpan: number; diabaikan: number }>> {
  if (jawaban.length === 0) return { ok: true, tersimpan: 0, diabaikan: 0 };
  const at = sekarang();
  const stmts = jawaban.map((j) =>
    db
      .prepare("UPDATE peta_putusan SET diputuskan_sku = ?, diputuskan_at = ?, diputuskan_oleh = ? WHERE jenis = ? AND acuan = ?")
      .bind(j.sku, at, oleh, j.jenis, j.acuan),
  );
  let tersimpan = 0;
  let diabaikan = 0;
  for (let i = 0; i < stmts.length; i += POTONG) {
    const hasil = await db.batch(stmts.slice(i, i + POTONG));
    for (const h of hasil) {
      if ((h.meta.changes ?? 0) > 0) tersimpan += 1;
      else diabaikan += 1;
    }
  }
  return { ok: true, tersimpan, diabaikan };
}

/** Nama produk untuk sekumpulan SKU — untuk menampilkan pilihan jawaban. */
export async function daftarSkuMaster(db: D1Database, sku: string[]): Promise<Map<string, string>> {
  const peta = new Map<string, string>();
  if (sku.length === 0) return peta;
  for (let i = 0; i < sku.length; i += POTONG_SKU) {
    const bagian = sku.slice(i, i + POTONG_SKU);
    const { results } = await db
      .prepare(`SELECT sku, nama_accurate FROM products WHERE sku IN (${bagian.map(() => "?").join(",")})`)
      .bind(...bagian)
      .all<{ sku: string; nama_accurate: string }>();
    for (const r of results) peta.set(r.sku, r.nama_accurate);
  }
  return peta;
}

/** Semua SKU master — dipakai importer sebagai himpunan pencocokan. */
export async function semuaSkuMaster(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT sku FROM products").all<{ sku: string }>();
  return new Set(results.map((r) => r.sku));
}

/**
 * SKU kita per kode produk Shopee. SKU variasi DIDAULUKAN dalam tiap kode: satu kode
 * bisa punya baris variasi dan induk, dan variasi-lah yang menutup hampir seluruh omzet —
 * UI yang mengambil elemen pertama harus mendapat yang variasi.
 */
export async function petaSkuDariKodeProduk(
  db: D1Database,
  kodeProduk: string[],
): Promise<Map<string, { sku: string; tingkat: string }[]>> {
  const peta = new Map<string, { sku: string; tingkat: string }[]>();
  if (kodeProduk.length === 0) return peta;
  for (let i = 0; i < kodeProduk.length; i += POTONG_SKU) {
    const bagian = kodeProduk.slice(i, i + POTONG_SKU);
    const { results } = await db
      .prepare(
        `SELECT kode_produk, sku, tingkat FROM shopee_produk WHERE kode_produk IN (${bagian.map(() => "?").join(",")}) ` +
          "ORDER BY CASE tingkat WHEN 'variasi' THEN 0 ELSE 1 END, sku",
      )
      .bind(...bagian)
      .all<{ kode_produk: string; sku: string; tingkat: string }>();
    for (const r of results) {
      const daftar = peta.get(r.kode_produk);
      if (daftar) daftar.push({ sku: r.sku, tingkat: r.tingkat });
      else peta.set(r.kode_produk, [{ sku: r.sku, tingkat: r.tingkat }]);
    }
  }
  return peta;
}

/**
 * Simpan metrik performa per SKU (upsert per preset+periode+sku) — impor ulang idempoten.
 *
 * KENAPA `sku` KOSONG DIBUANG DI SINI: `performa_produk` berkunci SKU, jadi baris yang
 * belum terpetakan (pertanyaan yang menunggu jawaban manusia) TIDAK punya tempat di tabel
 * ini. Membuangnya di sini bukan kehilangan data: baris itu tetap tercatat di `peta_putusan`
 * dan `shopee_produk`. Menulisnya dengan sku = "" akan menabrak baris sah pada impor berikutnya.
 */
export async function simpanPerforma(
  db: D1Database,
  presetId: number,
  periode: string,
  baris: BarisPeta[],
): Promise<void> {
  // Satu SKU bisa muncul di BANYAK baris (beberapa variasi / kode produk memakai SKU yang
  // sama). Upsert per (preset, periode, sku) tidak idempoten untuk kasus itu: pernyataan
  // yang sama dikirim dua kali dalam satu batch → bentrok UNIQUE → impor gagal. Jumlahkan
  // metriknya per SKU, karena performa produk memang dilaporkan per SKU, bukan per variasi.
  const perSku = new Map<string, BarisPeta>();
  for (const b of baris) {
    if (b.sku === "") continue;
    const lama = perSku.get(b.sku);
    if (!lama) { perSku.set(b.sku, { ...b }); continue; }
    lama.dilihat += b.dilihat;
    lama.klik += b.klik;
    lama.kunjungan += b.kunjungan;
    lama.keranjang += b.keranjang;
    lama.pesanan += b.pesanan;
    lama.omzet += b.omzet;
    lama.tanpaBeli += b.tanpaBeli;
  }
  if (perSku.size === 0) return;
  const at = sekarang();
  // Kunci unik dijamin oleh Map: tidak ada pernyataan kembar dalam satu batch.
  const stmts = [...perSku.values()].map((b) =>
    db
      .prepare(
        "INSERT INTO performa_produk (preset_id, periode, sku, dilihat, klik, kunjungan, keranjang, pesanan, omzet, melihat_tanpa_beli, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(preset_id, periode, sku) DO UPDATE SET dilihat = excluded.dilihat, klik = excluded.klik, " +
          "kunjungan = excluded.kunjungan, keranjang = excluded.keranjang, pesanan = excluded.pesanan, " +
          "omzet = excluded.omzet, melihat_tanpa_beli = excluded.melihat_tanpa_beli, at = excluded.at",
      )
      .bind(presetId, periode, b.sku, b.dilihat, b.klik, b.kunjungan, b.keranjang, b.pesanan, b.omzet, b.tanpaBeli, at),
  );
  for (let i = 0; i < stmts.length; i += POTONG) await db.batch(stmts.slice(i, i + POTONG));
}
