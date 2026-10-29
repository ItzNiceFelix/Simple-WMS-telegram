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
  /** Tanggal mulai tayang per baris iklan (`DD/MM/YYYY HH:MM:SS`). */
  tanggalMulai: 8,
  tanggalSelesai: 9,
  dilihat: 10,
  klik: 11,
  omzet: 23,
  /** `Penjualan Langsung (GMV Langsung)` — hanya pembelian yang berasal dari iklan itu. */
  omzetLangsung: 24,
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
  /** Omzet langsung; null bila kolomnya tidak ada/tidak terbaca di ekspor ini. */
  omzetLangsung: number | null;
  status: string;
  /**
   * Tanggal mulai tayang kampanye (`YYYY-MM-DD`), dari kolom `Tanggal Mulai`.
   *
   * BUKAN tanggal belanja: diverifikasi pada ekspor nyata — laporan periode 09–15 Okt
   * memuat baris dengan `Tanggal Mulai` 18 Sep. Kolom ini hanya jejak kapan kampanye dibuat,
   * jadi TIDAK dipakai sebagai tanggal `ads_produk`.
   */
  tanggalMulaiKampanye: string | null;
};

export type PeriodeIklan = { dari: string; sampai: string };

/**
 * Satu baris iklan yang TIDAK punya `Kode Produk` (iklan grup/GMV Max).
 *
 * KENAPA DISIMPAN, BUKAN DIBUANG: biaya baris ini benar-benar keluar dari rekening toko.
 * Sebelumnya baris seperti ini dibuang diam-diam, sehingga total biaya iklan di halaman
 * Analisa lebih kecil daripada kenyataan (pada berkas contoh 22–28 Okt 2026: 7,73%).
 * Tidak bisa dilekatkan ke SKU, jadi disimpan terpisah dan DITAMPILKAN sebagai peringatan.
 */
export type BarisIklanTanpaKode = { namaIklan: string; biaya: number; dilihat: number | null; klik: number | null; omzetIklan: number };

export type HasilParseIklan = {
  baris: BarisIklan[];
  /** Iklan tingkat grup/toko (Kode Produk "-") — tidak punya SKU, disimpan terpisah. */
  takTerpetakan: BarisIklanTanpaKode[];
  /** Jumlah baris yang dilewati karena tidak punya kode produk sama sekali. */
  dilewatiTanpaKode: number;
  periode: PeriodeIklan | null;
  barisHeader: number;
  /**
   * Diisi bila header tidak selebar yang dibutuhkan `KOL`. Ekspor Ads tidak punya tanggal
   * per baris dan kolomnya dibaca menurut nomor, jadi pergeseran satu kolom berarti angka
   * uang menunjuk kolom lain tanpa error — impor harus berhenti, bukan menebak.
   */
  galatLebar?: string;
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
  if (barisHeader < 0) return { baris: [], takTerpetakan: [], dilewatiTanpaKode: 0, periode: null, barisHeader: -1 };
  // VALIDASI LEBAR KOLOM. Kolom dibaca menurut NOMOR (KOL), jadi ekspor yang menyisipkan
  // satu kolom baru menggeser semuanya — biaya menunjuk kolom lain dan angkanya tetap
  // "masuk akal", sehingga salahnya tak terlihat. Berhenti dengan pesan jelas lebih baik.
  const lebar = rows[barisHeader]?.length ?? 0;
  if (lebar <= KOL.biaya) {
    return { baris: [], takTerpetakan: [], dilewatiTanpaKode: 0, periode: null, barisHeader: -1, galatLebar: `Header iklan hanya ${lebar} kolom; minimal ${KOL.biaya + 1}. Format ekspor Shopee Ads berubah — periksa berkasnya.` };
  }
  const periode = bacaPeriode(rows, barisHeader);
  const baris: BarisIklan[] = [];
  const takTerpetakan: BarisIklanTanpaKode[] = [];
  let dilewatiTanpaKode = 0;
  for (const r of rows.slice(barisHeader + 1)) {
    const kodeProduk = (r[KOL.kodeProduk] ?? "").trim();
    if (kodeProduk === "" || kodeProduk === "-") {
      // Baris kosong di ekor berkas = bukan data.
      if (!r.some((c) => c.trim() !== "")) continue;
      // Iklan grup: biayanya NYATA, hanya tidak bisa dilekatkan ke SKU.
      if (kodeProduk === "-") {
        takTerpetakan.push({
          namaIklan: (r[KOL.namaIklan] ?? "").trim() || "(tanpa nama)",
          biaya: bacaAngka(r[KOL.biaya]),
          dilihat: angkaOpsional(r[KOL.dilihat]),
          klik: angkaOpsional(r[KOL.klik]),
          omzetIklan: bacaAngka(r[KOL.omzet]),
        });
      } else {
        dilewatiTanpaKode++;
      }
      continue;
    }
    baris.push({
      kodeProduk,
      namaIklan: (r[KOL.namaIklan] ?? "").trim(),
      biaya: bacaAngka(r[KOL.biaya]),
      klik: angkaOpsional(r[KOL.klik]),
      dilihat: angkaOpsional(r[KOL.dilihat]),
      omzetIklan: bacaAngka(r[KOL.omzet]),
      omzetLangsung: angkaOpsional(r[KOL.omzetLangsung]),
      status: (r[KOL.status] ?? "").trim(),
      tanggalMulaiKampanye: tanggalIso((r[KOL.tanggalMulai] ?? "").trim().slice(0, 10)),
    });
  }
  return { baris, takTerpetakan, dilewatiTanpaKode, periode, barisHeader };
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
): Promise<Hasil<{ tersimpan: number; dilewatiTanpaKode: number; dilewatiTanpaPeta: number; kodeTanpaPeta: string[]; barisDibaca: number; periode: PeriodeIklan | null; biayaTakTerpetakan: number; jmlTakTerpetakan: number }>> {
  const hasil = parseIklan(teks);
  if (hasil.galatLebar) return gagal(400, hasil.galatLebar);
  if (hasil.barisHeader < 0) return gagal(400, "Baris header 'Urutan' tidak ditemukan di berkas iklan");
  // Tanggal simpan = AWAL periode laporan.
  //
  // Ekspor Ads tidak punya tanggal belanja per baris: kolom `Tanggal Mulai` adalah tanggal
  // kampanye dibuat (terbukti berisi 18 Sep di laporan 09–15 Okt), dan seluruh biaya satu
  // laporan memang satu angka agregat. Menyimpannya di awal periode membuat laporan mingguan
  // tetap masuk jendela `BETWEEN t-6 AND t` di sekitar tanggal laporan, dan TIDAK menggeser
  // baris lama saat berkas yang sama diimpor ulang — jadi tidak ada duplikat.
  const tanggalPeriode = hasil.periode?.dari;
  if (!tanggalPeriode) return gagal(400, "Periode laporan tidak ditemukan di berkas iklan");

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
  const perKunci = new Map<string, { tanggal: string; sku: string; biaya: number; klik: number; dilihat: number; omzet: number; omzetLangsung: number | null }>();
  for (const b of hasil.baris) {
    const semua = petaSku.get(b.kodeProduk);
    if (!semua || semua.length === 0) continue;
    const tanggal = tanggalPeriode;
    const n = semua.length;
    const biaya = Math.round(b.biaya / n);
    const klik = Math.round((b.klik ?? 0) / n);
    const dilihat = Math.round((b.dilihat ?? 0) / n);
    const omzet = Math.round(b.omzetIklan / n);
    // null tetap null: berkas tanpa kolom ini tidak boleh berubah menjadi "nol penjualan".
    const omzetLangsung = b.omzetLangsung === null ? null : Math.round(b.omzetLangsung / n);
    for (const sku of semua) {
      const kunci = `${tanggal}\u0000${sku}`;
      const agg = perKunci.get(kunci) ?? { tanggal, sku, biaya: 0, klik: 0, dilihat: 0, omzet: 0, omzetLangsung: null };
      agg.biaya += biaya;
      agg.klik += klik;
      agg.dilihat += dilihat;
      agg.omzet += omzet;
      if (omzetLangsung !== null) agg.omzetLangsung = (agg.omzetLangsung ?? 0) + omzetLangsung;
      perKunci.set(kunci, agg);
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
        "INSERT INTO ads_produk (preset_id, tanggal, sku, biaya, klik, dilihat, omzet_iklan, omzet_langsung, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(preset_id, tanggal, sku) DO UPDATE SET " +
          "biaya = excluded.biaya, klik = excluded.klik, " +
          "dilihat = excluded.dilihat, omzet_iklan = excluded.omzet_iklan, " +
          "omzet_langsung = excluded.omzet_langsung, at = excluded.at"
      )
      .bind(presetId, a.tanggal, a.sku, a.biaya, a.klik, a.dilihat, a.omzet, a.omzetLangsung, at)
  );
  for (let i = 0; i < stmts.length; i += PER_BATCH) await db.batch(stmts.slice(i, i + PER_BATCH));

  // Biaya iklan grup/GMV Max: TIDAK bisa dilekatkan ke SKU, tetapi tetap uang yang keluar.
  // Disimpan terpisah supaya total biaya iklan toko tidak lebih kecil dari kenyataan.
  // Tabel mungkin belum ada di lingkungan yang belum menjalankan migrasi 0047 — impor
  // tidak boleh gagal karenanya; biayanya tetap dilaporkan di hasil impor.
  const stmtsTanpa = hasil.takTerpetakan.map((t) =>
    db
      .prepare(
        "INSERT INTO ads_tak_terpetakan (preset_id, tanggal, nama_iklan, biaya, dilihat, klik, omzet_iklan, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(preset_id, tanggal, nama_iklan) DO UPDATE SET " +
          "biaya = excluded.biaya, dilihat = excluded.dilihat, klik = excluded.klik, " +
          "omzet_iklan = excluded.omzet_iklan, at = excluded.at"
      )
      .bind(presetId, tanggalPeriode, t.namaIklan, t.biaya, t.dilihat, t.klik, t.omzetIklan, at)
  );
  for (let i = 0; i < stmtsTanpa.length; i += PER_BATCH) {
    await db.batch(stmtsTanpa.slice(i, i + PER_BATCH)).catch(() => null);
  }

  // Rentang laporan yang SEBENARNYA. Tanpa ini, halaman hanya tahu "satu tanggal" (awal
  // periode) dan tidak bisa memperingatkan bahwa periode iklan ≠ periode produk.
  if (hasil.periode) {
    await db
      .prepare(
        "INSERT INTO ads_periode (preset_id, dari, sampai, baris, at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(preset_id, dari, sampai) DO UPDATE SET baris = excluded.baris, at = excluded.at"
      )
      .bind(presetId, hasil.periode.dari, hasil.periode.sampai, hasil.baris.length, at)
      // Tabel belum ada (migrasi 0049 belum jalan) → impor tetap berhasil.
      .run()
      .catch(() => null);
  }

  // `oleh` ikut dicatat supaya jelas siapa yang mengimpor saat angka iklan dipertanyakan.
  if (oleh) {
    for (const a of perKunci.values()) {
      await db
        .prepare("UPDATE ads_produk SET at = ? WHERE preset_id = ? AND tanggal = ? AND sku = ?")
        .bind(at, presetId, a.tanggal, a.sku)
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
    /** Periode laporan yang dipakai sebagai tanggal simpan (satu tanggal untuk semua baris). */
    periode: hasil.periode,
    biayaTakTerpetakan: hasil.takTerpetakan.reduce((a, t) => a + t.biaya, 0),
    jmlTakTerpetakan: hasil.takTerpetakan.length,
  };
}

/**
 * Biaya iklan yang tidak bisa dilekatkan ke SKU (iklan grup/GMV Max) pada satu rentang.
 *
 * null = belum ada baris sama sekali (belum diimpor), BUKAN nol. `baris` diurut biaya
 * terbesar supaya peringatan di UI menyebut yang paling berpengaruh lebih dulu.
 */
export async function iklanTakTerpetakan(
  db: D1Database,
  presetId: number,
  dari: string,
  sampai: string
): Promise<{ biaya: number; baris: { nama: string; biaya: number }[] } | null> {
  const r = await db
    .prepare(
      "SELECT nama_iklan, COALESCE(SUM(biaya), 0) AS biaya FROM ads_tak_terpetakan " +
        "WHERE preset_id = ? AND tanggal BETWEEN ? AND ? GROUP BY nama_iklan ORDER BY biaya DESC"
    )
    .bind(presetId, dari, sampai)
    .all<{ nama_iklan: string; biaya: number }>()
    .catch(() => null);
  // Tabel belum ada (migrasi 0047 belum jalan) → null: belum diketahui, bukan nol.
  if (!r) return null;
  const baris = (r.results ?? []).map((x) => ({ nama: String(x.nama_iklan), biaya: Number(x.biaya) }));
  if (baris.length === 0) return null;
  return { biaya: baris.reduce((a, b) => a + b.biaya, 0), baris };
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

/**
 * Periode laporan iklan yang paling baru diimpor untuk satu preset.
 *
 * Dipakai halaman untuk memperingatkan bahwa rentang iklan tidak sama dengan rentang produk
 * yang sedang dilihat. null = belum pernah ada impor iklan berperiode (atau migrasi 0049
 * belum jalan) — bukan "periodenya sama".
 */
export async function periodeIklanTerakhir(
  db: D1Database,
  presetId: number
): Promise<{ dari: string; sampai: string } | null> {
  const r = await db
    .prepare("SELECT dari, sampai FROM ads_periode WHERE preset_id = ? ORDER BY at DESC LIMIT 1")
    .bind(presetId)
    .first<{ dari: string; sampai: string }>()
    .catch(() => null);
  if (!r) return null;
  return { dari: String(r.dari), sampai: String(r.sampai) };
}
