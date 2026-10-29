// lib/analisa/kpi.ts — Kartu angka utama + pembandingnya. MURNI: tanpa DB, tanpa React.
//
// KENAPA dipisah: KPI adalah bagian yang paling mudah "dihitung ulang" di komponen, dan
// setiap hitung ulang adalah kesempatan angka di kartu berbeda dari angka di tabel. Di sini
// satu tempat: nilai, delta, arah, dan catatan.
//
// ATURAN:
//   * `null` = tidak ada data. TIDAK PERNAH ditampilkan sebagai 0.
//   * Metrik rasio (margin, TACOS, ROAS) dibandingkan dalam POIN, bukan persen. "Margin naik
//     2%" dan "margin naik 2 poin" adalah dua hal berbeda; yang kedua yang benar di sini.
//   * Metrik biaya dibalik: naik = buruk. Arah warna tidak boleh disamakan dengan omzet.
import type { RingkasanAnalisa } from "./tipe";

/** Angka yang dibutuhkan satu periode. Bentuknya sama untuk periode kini dan pembanding. */
export type AngkaKpi = {
  omzet: number;
  laba: number;
  marginPersen: number;
  jmlOrder: number;
  /** Total biaya iklan. null = belum diimpor (BUKAN nol). */
  biayaIklan: number | null;
  /** Omzet yang diatribusikan ke iklan. null = data iklan tidak ada. */
  omzetIklan: number | null;
};

export type DeltaKpi = {
  /** Selisih mentah: rupiah/jumlah untuk metrik aditif, POIN untuk metrik rasio. */
  selisih: number;
  /** Selisih relatif (%), hanya untuk metrik aditif. null bila pembanding 0. */
  persen: number | null;
  /** Satuan delta — menentukan apakah UI menulis "%" atau "poin". */
  satuan: "persen" | "poin";
};

export type KartuKpi = {
  kunci: "omzet" | "laba" | "margin" | "order" | "biaya_iklan" | "tacos" | "roas";
  label: string;
  nilai: number | null;
  satuan: "rupiah" | "persen" | "jumlah" | "rasio";
  /** Arah yang dianggap baik. Biaya: "turun". */
  arahBaik: "naik" | "turun";
  delta: DeltaKpi | null;
  /** Keterangan kecil di bawah nilai, mis. "3 SKU belum terpetakan". */
  catatan?: string;
  /** Jumlah desimal untuk metrik persen. Margin 1 (keputusan pemilik), rasio 2. */
  desimal?: number;
};

export type HasilKpi = {
  kartu: KartuKpi[];
  /** Periode ini memuat hari yang cakupannya tidak utuh. */
  parsial: boolean;
  /** Catatan tingkat baris (bukan per kartu), mis. pembanding tidak ada. */
  catatan: string[];
};

/** TACOS = biaya iklan ÷ omzet toko × 100. null bila salah satu tidak diketahui. */
export function tacos(biayaIklan: number | null, omzet: number): number | null {
  if (biayaIklan === null || omzet <= 0) return null;
  return Math.round((biayaIklan / omzet) * 10000) / 100;
}

/** ROAS keseluruhan = omzet iklan ÷ biaya iklan. null bila biaya 0/tidak diketahui. */
export function roasKeseluruhan(omzetIklan: number | null, biayaIklan: number | null): number | null {
  if (omzetIklan === null || biayaIklan === null || biayaIklan <= 0) return null;
  return Math.round((omzetIklan / biayaIklan) * 100) / 100;
}

function deltaAditif(sekarang: number, sebelum: number | null): DeltaKpi | null {
  if (sebelum === null) return null;
  const selisih = sekarang - sebelum;
  // Pembanding nol: persen tidak bermakna (bukan Infinity). Selisihnya tetap dilaporkan.
  const persen = sebelum === 0 ? null : Math.round((selisih / Math.abs(sebelum)) * 1000) / 10;
  return { selisih, persen, satuan: "persen" };
}

function deltaPoin(sekarang: number | null, sebelum: number | null): DeltaKpi | null {
  if (sekarang === null || sebelum === null) return null;
  return { selisih: Math.round((sekarang - sebelum) * 100) / 100, persen: null, satuan: "poin" };
}

export type MasukanKpi = {
  sekarang: AngkaKpi;
  /** Angka periode pembanding. null = tidak ada snapshot pembanding. */
  pembanding: AngkaKpi | null;
  /** Periode ini memuat hari parsial — deltanya tidak boleh dibaca sebagai tren. */
  parsial?: boolean;
  /** Jumlah SKU yang biaya iklannya tidak bisa dilekatkan (dari impor iklan). */
  jmlIklanTakTerpetakan?: number;
};

/** Susun tujuh kartu KPI, urutan tetap supaya posisi tidak berpindah antar periode. */
export function dataKpi(m: MasukanKpi): HasilKpi {
  const s = m.sekarang;
  const p = m.pembanding;
  const catatan: string[] = [];
  if (p === null) catatan.push("Belum ada periode pembanding — delta tidak ditampilkan, bukan nol.");

  const tSekarang = tacos(s.biayaIklan, s.omzet);
  const tSebelum = p ? tacos(p.biayaIklan, p.omzet) : null;
  const rSekarang = roasKeseluruhan(s.omzetIklan, s.biayaIklan);
  const rSebelum = p ? roasKeseluruhan(p.omzetIklan, p.biayaIklan) : null;

  const kartu: KartuKpi[] = [
    {
      kunci: "omzet", label: "Omzet", nilai: s.omzet, satuan: "rupiah", arahBaik: "naik",
      delta: p ? deltaAditif(s.omzet, p.omzet) : null,
    },
    {
      kunci: "laba", label: "Laba", nilai: s.laba, satuan: "rupiah", arahBaik: "naik",
      delta: p ? deltaAditif(s.laba, p.laba) : null,
      // Laba snapshot BELUM memotong biaya iklan. Menyebutnya di kartu mencegah pemilik
      // mengira angka ini sudah bersih.
      catatan: s.biayaIklan === null ? "belum memotong biaya iklan" : "sebelum biaya iklan",
    },
    {
      kunci: "margin", label: "Margin", nilai: s.marginPersen, satuan: "persen", arahBaik: "naik", desimal: 1,
      delta: p ? deltaPoin(s.marginPersen, p.marginPersen) : null,
    },
    {
      kunci: "order", label: "Pesanan", nilai: s.jmlOrder, satuan: "jumlah", arahBaik: "naik",
      delta: p ? deltaAditif(s.jmlOrder, p.jmlOrder) : null,
    },
    {
      kunci: "biaya_iklan", label: "Biaya iklan", nilai: s.biayaIklan, satuan: "rupiah", arahBaik: "turun",
      delta: p ? deltaAditif(s.biayaIklan ?? 0, p.biayaIklan) : null,
      catatan: s.biayaIklan === null
        ? "belum diimpor"
        : m.jmlIklanTakTerpetakan
          ? `${m.jmlIklanTakTerpetakan} iklan belum terpetakan`
          : undefined,
    },
    {
      kunci: "tacos", label: "TACOS", nilai: tSekarang, satuan: "persen", arahBaik: "turun", desimal: 2,
      delta: deltaPoin(tSekarang, tSebelum),
      catatan: "biaya iklan ÷ omzet toko",
    },
    {
      kunci: "roas", label: "ROAS", nilai: rSekarang, satuan: "rasio", arahBaik: "naik",
      delta: deltaPoin(rSekarang, rSebelum),
      catatan: "omzet iklan ÷ biaya iklan",
    },
  ];

  return { kartu, parsial: m.parsial === true, catatan };
}

/** Ambil `AngkaKpi` dari ringkasan + angka iklan. Satu tempat, supaya bentuknya tidak beda. */
export function angkaDariRingkasan(
  r: RingkasanAnalisa,
  biayaIklan: number | null,
  omzetIklan: number | null
): AngkaKpi {
  return {
    omzet: r.omzet,
    laba: r.laba,
    marginPersen: r.marginPersen,
    jmlOrder: r.jmlOrder,
    biayaIklan,
    omzetIklan,
  };
}
