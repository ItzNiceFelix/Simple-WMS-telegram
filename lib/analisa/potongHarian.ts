// lib/analisa/potongHarian.ts — Potong satu export Order.all (rentang 7 hari) menjadi
// kumpulan baris PER TANGGAL penjualan. MURNI: tanpa D1, tanpa tanggal "sekarang".
//
// KENAPA DIPOTONG:
//   Satu file Shopee berisi rentang (mis. Order.all.20261013_20261014.xlsx), tetapi
//   snapshot laba disimpan per (preset, tanggal). Tanpa potongan, seluruh rentang masuk
//   ke SATU tanggal yang diketik user — itulah penyebab snapshot tumpang-tindih di D1
//   (1217 order di 2026-10-12 padahal file-nya 10-13 s/d 10-14). Akibat lanjutannya:
//   grafik harian tidak bisa dibuat dan delta "periode sebelumnya" tidak bermakna.
//
// ATURAN:
//   * Tanggal diambil dari kolom "Waktu Pesanan Dibuat" (zona WIB), BUKAN tanggal impor.
//   * Hari TEPI file diberi tanda `parsial`: hari pertama dan hari terakhir file hanya
//     memuat sebagian hari itu (export dimulai/diakhiri di tengah hari), sehingga totalnya
//     tidak bisa dibandingkan dengan hari penuh. Hari parsial tetap dihitung (angkanya
//     benar untuk order yang ada) tetapi tidak boleh dipakai delta/grafik tren.
//   * File satu hari: hari itu PENUH bila jam terakhirnya >= AMBANG_PENUH (lihat bawah).
//   * Baris tanpa tanggal valid TIDAK dibuang diam-diam: dikumpulkan di `tanpaTanggal`
//     agar pemanggil bisa melaporkannya.

/** Jam WIB minimum di hari terakhir agar hari itu dianggap tercakup penuh. */
const JAM_PENUH = 23;

/** Jam WIB maksimum di hari pertama agar hari itu dianggap tercakup penuh (mulai dari 00:00). */
const JAM_AWAL_PENUH = 0;

/** Format waktu Shopee: "2026-10-13 14:05" (kadang bersufiks detik). */
const POLA_WAKTU = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/;

export type HasilPotong = {
  /** Baris per tanggal, urut tanggal menaik. */
  perTanggal: { tanggal: string; baris: Record<string, unknown>[] }[];
  /** Tanggal yang tercakup PENUH di file ini (aman dipakai grafik/delta). */
  tanggalPenuh: string[];
  /** Tanggal di tepi file — angkanya benar untuk order yang ada, tapi harinya tidak utuh. */
  tanggalParsial: string[];
  /** Jumlah baris yang tanggalnya tidak terbaca (tidak masuk `perTanggal`). */
  tanpaTanggal: number;
};

/** Tanggal + jam WIB dari satu baris; null bila kolomnya kosong/rusak. */
export function waktuBaris(r: Record<string, unknown>): { tanggal: string; jam: number } | null {
  const mentah = r["Waktu Pesanan Dibuat"];
  const m = POLA_WAKTU.exec(typeof mentah === "string" ? mentah.trim() : "");
  if (!m) return null;
  return { tanggal: m[1], jam: Number(m[2]) };
}

/**
 * Potong baris Order.all per tanggal pesanan.
 *
 * @param baris baris mentah sheet `orders` (sudah dibaca di klien).
 * @param tanggalFile opsional, dari nama berkas `..._YYYYMMDD_YYYYMMDD` — hanya dipakai
 *        untuk MENYEMPITKAN himpunan tanggal bila data di dalamnya meleset (mis. satu
 *        baris bertanggal jauh di luar rentang). Tidak dipakai untuk menetapkan tanggal.
 */
export function potongPerTanggal(
  baris: Record<string, unknown>[],
  tanggalFile?: { dari: string; sampai: string } | null
): HasilPotong {
  const perTanggal = new Map<string, Record<string, unknown>[]>();
  let tanpaTanggal = 0;

  for (const r of baris) {
    const w = waktuBaris(r);
    if (!w) { tanpaTanggal += 1; continue; }
    // Baris di luar rentang berkas hampir pasti sisa/duplikat dari export lain. Dibuang
    // dari potongan ini agar tidak menulis snapshot untuk tanggal yang tidak diminta.
    if (tanggalFile && (w.tanggal < tanggalFile.dari || w.tanggal > tanggalFile.sampai)) continue;
    const daftar = perTanggal.get(w.tanggal);
    if (daftar) daftar.push(r); else perTanggal.set(w.tanggal, [r]);
  }

  const tanggalUrut = [...perTanggal.keys()].sort();
  const pertama = tanggalUrut[0];
  const terakhir = tanggalUrut[tanggalUrut.length - 1];

  const jamMin = (t: string) => {
    let min = 24;
    for (const r of perTanggal.get(t) ?? []) {
      const w = waktuBaris(r);
      if (w && w.jam < min) min = w.jam;
    }
    return min;
  };
  const jamMaks = (t: string) => {
    let maks = -1;
    for (const r of perTanggal.get(t) ?? []) {
      const w = waktuBaris(r);
      if (w && w.jam > maks) maks = w.jam;
    }
    return maks;
  };

  const tanggalPenuh: string[] = [];
  const tanggalParsial: string[] = [];
  for (const t of tanggalUrut) {
    // Hari di TENGAH rentang selalu utuh: file memuat seluruh hari itu.
    const diTengah = t !== pertama && t !== terakhir;
    // Hari tunggal (file 1 hari): penuh hanya bila mencakup jam awal DAN jam akhir hari.
    const tunggal = pertama === terakhir;
    const penuh = diTengah
      || (tunggal && jamMin(t) <= JAM_AWAL_PENUH && jamMaks(t) >= JAM_PENUH)
      || (t === pertama && jamMin(t) <= JAM_AWAL_PENUH)
      || (t === terakhir && jamMaks(t) >= JAM_PENUH);
    (penuh ? tanggalPenuh : tanggalParsial).push(t);
  }

  return {
    perTanggal: tanggalUrut.map((t) => ({ tanggal: t, baris: perTanggal.get(t) ?? [] })),
    tanggalPenuh,
    tanggalParsial,
    tanpaTanggal,
  };
}

/**
 * Rentang tanggal dari nama berkas Shopee: `Order.all.20261013_20261014.xlsx`
 * → { dari: "2026-10-13", sampai: "2026-10-14" }. null bila pola tidak ada.
 *
 * Dipakai sebagai PAGAR, bukan sumber tanggal: tanggal sebenarnya tetap dari isi baris.
 */
export function rentangDariNamaBerkas(nama: string): { dari: string; sampai: string } | null {
  const m = /(\d{8})_(\d{8})/.exec(nama);
  if (!m) return null;
  const ubah = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const dari = ubah(m[1]);
  const sampai = ubah(m[2]);
  return dari <= sampai ? { dari, sampai } : null;
}
