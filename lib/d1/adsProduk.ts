// lib/d1/adsProduk.ts — Impor biaya iklan Shopee Ads per produk per hari.
//
// Kenapa parser CSV ditulis sendiri: berkas ekspor Shopee Ads memuat nama iklan yang
// berisi KOMA di dalam tanda kutip (mis. "Rak Kosmetik 3 Susun, Mudah Dirapikan, 17x14x18 cm").
// `split(",")` akan memecah baris itu jadi kolom palsu dan seluruh kolom setelahnya bergeser —
// nomor kolom `Biaya` jadi menunjuk kolom lain, dan salahnya tidak kelihatan (angkanya tetap
// masuk akal). Karena itu parser di sini menghormati kutip ganda.
//
// Ditulis di `lib/d1/` (bukan `lib/analisa/`) karena hanya di sini yang menyentuh D1;
// parsing sendiri tetap murni sehingga bisa diuji tanpa DB (pola sama dengan lib/analisa/peta.ts).
//
// Jembatan ke SKU kita: kolom `Kode Produk` ekspor Ads = ID produk Shopee, sama persis
// dengan `Kode Produk` ekspor Performa Produk. Itu sebabnya pemetaan kode→SKU diterima
// sebagai PARAMETER (`petaSku`), bukan dibaca dari tabel di sini: pemanggil yang tahu
// sumbernya (tabel `shopee_produk`), dan fungsi ini tetap bisa diuji tanpa D1.
import { bacaAngka } from "@/lib/analisa/peta";
import { gagal, sekarang, type Hasil } from "./hasil";
import { getDb } from "./db";

/** Indeks kolom ekspor Ads SETELAH baris header ditemukan. Lihat catatan di bacaCsv. */
const KOL = {
  namaIklan: 1,
  status: 2,
  kodeProduk: 4,
  dilihat: 10,
  klik: 11,
  omzet: 23,
  biaya: 25,
} as const;

/** Satu baris iklan tingkat produk. `klik`/`dilihat` null = ekspor menulis "-" (tidak ada data). */
export type BarisIklan = {
  kodeProduk: string;
  namaIklan: string;
  biaya: number;
  klik: number | null;
  dilihat: number | null;
  omzetIklan: number;
  status: string;
};

export type PeriodeIklan = { dari: string; sampai: string };

export type HasilParseIklan = {
  baris: BarisIklan[];
  /** Iklan tingkat grup/toko (Kode Produk "-") — bukan produk, sengaja tidak diimpor. */
  dilewatiTanpaKode: number;
  periode: PeriodeIklan | null;
  barisHeader: number;
};

/**
 * Parser CSV: BOM dibuang, CRLF/CR/LF dinormalkan, kutip ganda dihormati.
 *
 * Aturan kutip mengikuti RFC 4180: `""` di dalam kutip = satu kutip harfiah, dan koma
 * di dalam kutip bukan pemisah kolom.
 */
export function bacaCsv(teks: string): string[][] {
  // BOM (U+FEFF) ikut terbaca sebagai karakter oleh String — kalau dibiarkan, kolom
  // pertama header jadi "\uFEFFUrutan" dan cariBarisHeader tidak pernah ketemu.
  const s = teks.charCodeAt(0) === 0xfeff ? teks.slice(1) : teks;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let dalamKutip = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (dalamKutip) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else dalamKutip = false;
      } else field += c;
      continue;
    }
    if (c === '"') { dalamKutip = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") { if (s[i + 1] === "\n") i++; row.push(field); field = ""; rows.push(row); row = []; continue; }
    if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; continue; }
    field += c;
  }
  // Baris terakhir tanpa newline penutup tetap dihitung; berkas yang berakhir newline
  // menghasilkan baris kosong sisa yang dibuang di sini.
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Indeks baris header: kolom 0-nya `Urutan`. `-1` bila tidak ada. */
export function cariBarisHeader(rows: string[][]): number {
  return rows.findIndex((r) => (r[0] ?? "").trim().toLowerCase() === "urutan");
}

/** `DD/MM/YYYY` → `YYYY-MM-DD`; null bila polanya tidak cocok. */
function tanggalIso(teks: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(teks.trim());
  if (!m) return null;
  const [, d, bln, thn] = m;
  return `${thn}-${bln.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * Periode laporan dari baris `Periode,14/10/2026 - 14/10/2026`.
 * Dipakai sebagai tanggal semua baris (ekspor Ads tidak punya kolom tanggal per baris).
 */
export function bacaPeriode(rows: string[][], idxHeader: number): PeriodeIklan | null {
  // Dibaca dari baris PEMBUKA (sebelum header) karena di situlah letaknya; batas idxHeader
  // hanya pengaman agar baris data tidak pernah disalahartikan sebagai periode.
  for (let i = 0; i < idxHeader && i < rows.length; i++) {
    const r = rows[i] ?? [];
    if ((r[0] ?? "").trim().toLowerCase() !== "periode") continue;
    const m = /(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(r[1] ?? "");
    if (!m) return null;
    const dari = tanggalIso(m[1]);
    const sampai = tanggalIso(m[2]);
    return dari && sampai ? { dari, sampai } : null;
  }
  return null;
}

/** Nilai kolom angka yang membedakan "-" (tidak ada data) dari nol. */
function angkaOpsional(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  if (t === "" || t === "-") return null;
  return bacaAngka(t);
}

/** Parse seluruh berkas ekspor Ads. Header dicari, bukan diasumsikan di baris ke-N. */
export function parseIklan(teks: string): HasilParseIklan {
  const rows = bacaCsv(teks);
  const barisHeader = cariBarisHeader(rows);
  if (barisHeader < 0) return { baris: [], dilewatiTanpaKode: 0, periode: null, barisHeader: -1 };
  const periode = bacaPeriode(rows, barisHeader);
  const baris: BarisIklan[] = [];
  let dilewatiTanpaKode = 0;
  for (const r of rows.slice(barisHeader + 1)) {
    const kodeProduk = (r[KOL.kodeProduk] ?? "").trim();
    // Baris kosong di ekor berkas dan iklan tingkat grup ("-") sama-sama dilewati.
    if (kodeProduk === "" || kodeProduk === "-") {
          if (r.some((c) => c.trim() !== "")) dilewatiTanpaKode++;
      continue;
    }
    baris.push({
      kodeProduk,
      namaIklan: (r[KOL.namaIklan] ?? "").trim(),
      biaya: bacaAngka(r[KOL.biaya]),
      klik: angkaOpsional(r[KOL.klik]),
      dilihat: angkaOpsional(r[KOL.dilihat]),
      omzetIklan: bacaAngka(r[KOL.omzet]),
      status: (r[KOL.status] ?? "").trim(),
    });
  }
  return { baris, dilewatiTanpaKode, periode, barisHeader };
}

/** Maksimum contoh kode tanpa peta yang dikembalikan — cukup untuk ditindaklanjuti manusia. */
const MAKS_TANPA_PETA = 20;

/** ukuranPotong: D1 menolak batch besar; 50 per kelompok aman dan tetap hemat pulang-pergi. */
const PER_BATCH = 50;

/**
 * Tulis baris iklan ke `ads_produk`, dikelompokkan per (tanggal, sku).
 *
 * Kenapa AKUMULASI (+=) dan bukan timpa: satu SKU bisa muncul di beberapa baris iklan pada
 * tanggal yang sama (varian berbeda yang dipetakan ke SKU sama, atau iklan diulang).
 * Menimpa akan membuang sebagian biaya dan membuat laba terlihat lebih besar dari kenyataan.
 *
 * `petaSku` = kode produk Shopee → SKU kita, dari tabel `shopee_produk`.
 */
export async function imporIklan(
  db: D1Database,
  teks: string,
  presetId: number,
  oleh: string | null,
  /**
   * Kode produk → SEMUA SKU kita untuk kode itu (satu kode bisa punya banyak variasi).
   * Bukan `Map<string, string>`: mengambil hanya SKU pertama membuang biaya variasi lain,
   * sehingga total iklan per SKU salah walau total toko benar.
   */
  petaSku: Map<string, string[]>
): Promise<Hasil<{ tersimpan: number; dilewatiTanpaKode: number; dilewatiTanpaPeta: number; kodeTanpaPeta: string[]; barisDibaca: number }>> {
  const hasil = parseIklan(teks);
  if (hasil.barisHeader < 0) return gagal(400, "Baris header 'Urutan' tidak ditemukan di berkas iklan");
  const tanggal = hasil.periode?.dari;
  if (!tanggal) return gagal(400, "Periode laporan tidak ditemukan di berkas iklan");

  const dilewatiTanpaPeta = new Set<string>();
  const kodeTanpaPeta: string[] = [];
  // Baris tanpa SKU dibuang SEBELUM dikirim ke D1: pemanggil hanya peduli jumlahnya.
  let dilewati = 0;
  for (const b of hasil.baris) {
    if (petaSku.has(b.kodeProduk)) continue;
    dilewati++;
    if (!dilewatiTanpaPeta.has(b.kodeProduk)) {
      dilewatiTanpaPeta.add(b.kodeProduk);
      if (kodeTanpaPeta.length < MAKS_TANPA_PETA) kodeTanpaPeta.push(b.kodeProduk);
    }
  }

  // Agregasi di memori sebelum menulis: satu baris iklan per kode produk, sedangkan tabel
  // menyimpan per SKU. Satu kode dengan N SKU: biaya dibagi rata ke semua SKU-nya supaya
  // total toko tetap benar dan tidak ada biaya yang hilang. (Dulu hanya SKU pertama yang
  // menerima seluruh biaya, sehingga ROAS per SKU melenceng jauh.)
  const perKunci = new Map<string, { sku: string; biaya: number; klik: number; dilihat: number; omzet: number }>();
  for (const b of hasil.baris) {
    const semua = petaSku.get(b.kodeProduk);
    if (!semua || semua.length === 0) continue;
    const n = semua.length;
    const biaya = Math.round(b.biaya / n);
    const klik = Math.round((b.klik ?? 0) / n);
    const dilihat = Math.round((b.dilihat ?? 0) / n);
    const omzet = Math.round(b.omzetIklan / n);
    for (const sku of semua) {
      const agg = perKunci.get(sku) ?? { sku, biaya: 0, klik: 0, dilihat: 0, omzet: 0 };
      agg.biaya += biaya;
      agg.klik += klik;
      agg.dilihat += dilihat;
      agg.omzet += omzet;
      perKunci.set(sku, agg);
    }
  }

  const at = sekarang();
  // TIMPA, BUKAN JUMLAH: satu impor sudah diagregasi per SKU di `perKunci` di atas, jadi
  // menjumlahkan lagi di ON CONFLICT berarti berkas yang sama diunggah dua kali menggandakan
  // biaya — dan ROAS/CR jatuh palsu tanpa ada yang menyadarinya. Mengimpor ulang berkas yang
  // sama sekarang idempoten. (Berkas berbeda untuk tanggal yang sama memang harus dijumlah;
  // itu ditangani pemanggil dengan menggabungkan berkas sebelum impor, bukan di sini.)
  const stmts = [...perKunci.values()].map((a) =>
    db
      .prepare(
        "INSERT INTO ads_produk (preset_id, tanggal, sku, biaya, klik, dilihat, omzet_iklan, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(preset_id, tanggal, sku) DO UPDATE SET " +
          "biaya = excluded.biaya, klik = excluded.klik, " +
          "dilihat = excluded.dilihat, omzet_iklan = excluded.omzet_iklan, at = excluded.at"
      )
      .bind(presetId, tanggal, a.sku, a.biaya, a.klik, a.dilihat, a.omzet, at)
  );
  for (let i = 0; i < stmts.length; i += PER_BATCH) await db.batch(stmts.slice(i, i + PER_BATCH));

  // `oleh` ikut dicatat supaya jelas siapa yang mengimpor saat angka iklan dipertanyakan.
  if (oleh) {
    for (const a of perKunci.values()) {
      await db
        .prepare("UPDATE ads_produk SET at = ? WHERE preset_id = ? AND tanggal = ? AND sku = ?")
        .bind(at, presetId, tanggal, a.sku)
        .run()
        .catch(() => null);
    }
  }

  return {
    ok: true,
    tersimpan: perKunci.size,
    dilewatiTanpaKode: hasil.dilewatiTanpaKode,
    dilewatiTanpaPeta: dilewati,
    kodeTanpaPeta,
    // Jumlah BARIS berkas (bukan SKU): halaman Sinkronisasi melaporkan "berapa baris dibaca",
    // dan SKU unik selalu lebih kecil dari baris sehingga terlihat seperti data hilang.
    barisDibaca: hasil.baris.length,
  };
}

/** Total baris + biaya iklan pada rentang tanggal. null = belum ada baris (belum diimpor), bukan nol. */
export async function totalIklan(db: D1Database, presetId: number, dari: string, sampai: string): Promise<{ baris: number; biaya: number } | null> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(biaya), 0) AS biaya FROM ads_produk WHERE preset_id = ? AND tanggal BETWEEN ? AND ?")
    .bind(presetId, dari, sampai)
    .first<{ n: number; biaya: number }>();
  if (!r || Number(r.n) === 0) return null;
  return { baris: Number(r.n), biaya: Number(r.biaya) };
}
