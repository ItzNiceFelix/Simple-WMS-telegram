// lib/analisa/iklanEstimasi.ts — Estimasi iklan untuk BANYAK SKU sekaligus.
// FUNGSI MURNI: tanpa DB, tanpa fetch, tanpa React. Semua angka berasal dari argumen.
//
// Prinsip repo: ANGKA SELALU dari lib murni, AI tidak pernah menghitung. Karena itu
// rumus impas dan median DIPINJAM dari ./hitung.ts, tidak disalin — kalau di sana
// berubah, di sini ikut berubah.
//
// TIGA ASUMSI (keputusan pemilik repo, jangan ditawar):
//   1 = KONSERVATIF = hari TERBURUK (omzet terendah)
//   2 = NETRAL      = MEDIAN omzet seluruh hari
//   3 = OPTIMIS     = hari TERBAIK (omzet tertinggi)
// Ini BUKAN "rata-rata dengan hari ekstrem dibuang". Tujuannya menunjukkan RENTANG,
// supaya terlihat SKU yang rapuh: aman di hari buruk tapi rugi di hari baik.
// Unit selalu diambil dari HARI YANG SAMA dengan omzetnya — memakai unit hari lain akan
// menghasilkan omzet campuran yang tidak pernah terjadi.
import { median, roasImpas } from "./hitung";

export type BarisHistori = {
  tanggal: string;
  omzet: number;
  unit: number;
  marginSatuan: number;
  hargaJual: number;
};

export type MasukanEstimasi = {
  sku: string;
  nama: string | null;
  /** Omzet & unit aktual per tanggal, urut tanggal menaik. Bisa 0..banyak hari. */
  histori: BarisHistori[];
  /** Modal iklan yang diisi user (rupiah). */
  modalIklan: number;
  /** Target ROAS yang diisi user. Boleh 0/kosong = tidak ditargetkan. */
  targetRoas: number;
  /** HPP master terbaru bila ada (untuk memberi tahu margin sudah tergerus). */
  hppMaster?: number | null;
};

export type StatusEstimasi = "aman" | "tipis" | "rugi" | "belum_cukup_data";

export type HasilEstimasi = {
  sku: string;
  nama: string | null;
  modalIklan: number;
  targetRoas: number;
  /** Titik impas dari ./hitung.ts; null bila harga/margin tidak sehat. */
  roasImpas: number | null;
  // null = TIDAK ADA DATA. BUKAN 0. 0 berarti "terjual nol", null berarti
  // "tidak ada datanya" — membedakannya mencegah kesimpulan palsu dari hari kosong.
  omzetRata1: number | null;
  omzetRata2: number | null;
  omzetRata3: number | null;
  unitRata1: number | null;
  unitRata2: number | null;
  unitRata3: number | null;
  profitRata1: number | null;
  profitRata2: number | null;
  profitRata3: number | null;
  /** ROAS nyata dengan modal itu = omzet NETRAL ÷ modalIklan. null bila modal ≤ 0. */
  roasRil: number | null;
  status: StatusEstimasi;
  alasan: string;
  /** Hanya ada bila targetRoas > 0. */
  targetTercapai?: boolean;
  selisihTarget?: number;
  /** Ada bila hppMaster diisi dan berbeda dari margin historis (margin tergerus). */
  hppTergerus?: boolean;
};

/** Pembulatan rupiah/desimal supaya UI, AI, dan uji melihat angka yang sama. */
function bulat2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Angka rupiah utuh bergaya Indonesia ("1.500.000") untuk kalimat alasan. */
function rp(n: number): string {
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

/** Tiga hari acuan: terburuk, netral (median), terbaik. null bila histori kosong. */
function hariAcuan(histori: BarisHistori[]): {
  buruk: BarisHistori | null; netral: BarisHistori | null; baik: BarisHistori | null;
} {
  if (histori.length === 0) return { buruk: null, netral: null, baik: null };
  let buruk = histori[0];
  let baik = histori[0];
  for (const h of histori) {
    if (h.omzet < buruk.omzet) buruk = h;
    if (h.omzet > baik.omzet) baik = h;
  }
  // Median omzet dari hitung.ts; hari netral = hari yang omzetnya persis median.
  // Bila tidak ada omzet yang persis sama median (jumlah hari genap), ambil hari
  // dengan selisih terkecil — unit dan omzet tetap dari hari yang sama.
  const med = median(histori.map((h) => h.omzet));
  let netral = histori[0];
  for (const h of histori) {
    if (Math.abs(h.omzet - med) < Math.abs(netral.omzet - med)) netral = h;
  }
  return { buruk, netral, baik };
}

/** Hitung estimasi iklan untuk satu SKU. Murni. */
export function estimasiIklan(m: MasukanEstimasi): HasilEstimasi {
  const { buruk, netral, baik } = hariAcuan(m.histori);

  const omzetRata1 = buruk ? buruk.omzet : null;
  const omzetRata2 = netral ? netral.omzet : null;
  const omzetRata3 = baik ? baik.omzet : null;
  const unitRata1 = buruk ? buruk.unit : null;
  const unitRata2 = netral ? netral.unit : null;
  const unitRata3 = baik ? baik.unit : null;

  // Margin & harga dari hari netral; bila histori kosong pakai 0 → roasImpas null.
  const acuan = netral ?? buruk ?? baik;
  const marginSatuan = acuan ? acuan.marginSatuan : 0;
  const hargaJual = acuan ? acuan.hargaJual : 0;
  const impas = roasImpas(hargaJual, marginSatuan);

  const profitRata1 = unitRata1 === null ? null : bulat2(unitRata1 * marginSatuan - m.modalIklan);
  const profitRata2 = unitRata2 === null ? null : bulat2(unitRata2 * marginSatuan - m.modalIklan);
  const profitRata3 = unitRata3 === null ? null : bulat2(unitRata3 * marginSatuan - m.modalIklan);

  const roasRil = m.modalIklan > 0 && omzetRata2 !== null
    ? bulat2(omzetRata2 / m.modalIklan)
    : null;

  const { status, alasan } = nilaiStatus(m, impas, omzetRata1, omzetRata3, profitRata1, profitRata2, profitRata3);

  const hasil: HasilEstimasi = {
    sku: m.sku,
    nama: m.nama,
    modalIklan: m.modalIklan,
    targetRoas: m.targetRoas,
    roasImpas: impas,
    omzetRata1, omzetRata2, omzetRata3,
    unitRata1, unitRata2, unitRata3,
    profitRata1, profitRata2, profitRata3,
    roasRil,
    status,
    alasan,
  };

  if (m.targetRoas > 0 && roasRil !== null) {
    hasil.targetTercapai = roasRil >= m.targetRoas;
    hasil.selisihTarget = bulat2(roasRil - m.targetRoas);
  }

  // HPP master lebih tinggi dari HPP historis → margin di data sudah tergerus,
  // estimasi pakai margin lama jadi terlalu optimis. Diberitahu, bukan dihitung ulang.
  if (typeof m.hppMaster === "number" && acuan) {
    const hppHistoris = hargaJual - marginSatuan;
    if (m.hppMaster > hppHistoris) hasil.hppTergerus = true;
  }

  return hasil;
}

/** Tentukan status + kalimat alasan yang menyebut angka. */
function nilaiStatus(
  m: MasukanEstimasi,
  impas: number | null,
  omzet1: number | null,
  omzet3: number | null,
  profit1: number | null,
  profit2: number | null,
  profit3: number | null,
): { status: StatusEstimasi; alasan: string } {
  const modal = `modal ${rp(m.modalIklan)}`;
  if (m.histori.length === 0 || m.modalIklan <= 0) {
    return {
      status: "belum_cukup_data",
      alasan: m.histori.length === 0
        ? "Belum ada data penjualan harian per SKU ini, estimasi tidak bisa dihitung."
        : "Modal iklan belum diisi (0), jadi laba setelah iklan tidak bisa dihitung.",
    };
  }
  if (impas === null) {
    return {
      status: "rugi",
      alasan: `Margin per unit ${rp(m.histori[0].marginSatuan)} (≤ 0), jadi tidak ada titik impas: `
        + "produk ini rugi sebelum iklan berjalan. Perbaiki harga atau HPP dulu.",
    };
  }
  if (profit1 !== null && profit1 < 0) {
    return {
      status: "rugi",
      alasan: `Skenario terburuk (omzet ${rp(omzet1 ?? 0)}/hari) sudah rugi `
        + `${rp(Math.abs(profit1))} dengan ${modal}.`,
    };
  }
  if (profit1 !== null && profit3 !== null && profit3 < 0) {
    return {
      status: "tipis",
      alasan: `Di skenario terburuk (omzet ${rp(omzet1 ?? 0)}/hari) ${modal} masih untung `
        + `${rp(profit1)}; tapi di skenario terbaik (omzet ${rp(omzet3 ?? 0)}/hari) malah rugi `
        + `${rp(Math.abs(profit3))}. Munculnya kerugian di hari ramai = rapuh.`,
    };
  }
  return {
    status: "aman",
    alasan: `Ketiga skenario untung: terburuk ${rp(profit1 ?? 0)}, netral `
      + `${rp(profit2 ?? 0)}, terbaik ${rp(profit3 ?? 0)} dengan ${modal}.`,
  };
}

export type RingkasEstimasi = {
  jumlahSku: number;
  totalModal: number;
  totalProfit1: number;
  totalProfit2: number;
  totalProfit3: number;
  jumlahAman: number;
  jumlahTipis: number;
  jumlahRugi: number;
  jumlahBelumCukupData: number;
};

/** Ringkas semua baris untuk baris ringkasan di atas tabel. Murni. */
export function ringkasEstimasi(baris: HasilEstimasi[]): RingkasEstimasi {
  return {
    jumlahSku: baris.length,
    totalModal: bulat2(baris.reduce((a, b) => a + b.modalIklan, 0)),
    totalProfit1: bulat2(baris.reduce((a, b) => a + (b.profitRata1 ?? 0), 0)),
    totalProfit2: bulat2(baris.reduce((a, b) => a + (b.profitRata2 ?? 0), 0)),
    totalProfit3: bulat2(baris.reduce((a, b) => a + (b.profitRata3 ?? 0), 0)),
    jumlahAman: baris.filter((b) => b.status === "aman").length,
    jumlahTipis: baris.filter((b) => b.status === "tipis").length,
    jumlahRugi: baris.filter((b) => b.status === "rugi").length,
    jumlahBelumCukupData: baris.filter((b) => b.status === "belum_cukup_data").length,
  };
}
