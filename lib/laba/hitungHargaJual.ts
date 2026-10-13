// lib/laba/hitungHargaJual.ts — Mesin hitung harga jual murni (tanpa D1).
// OPEX = biaya TETAP → masuk sebagai NOMINAL per unit (bukan persen).
// Iklan = biaya VARIABEL → masuk sebagai persen (proporsional harga jual).
//
//   opex_unit = opex_bulanan / volume_bulanan
//   harga     = (hpp + opex_unit + flat_unit) / (1 − fee_persen − iklan_persen − margin)
//
// fee_persen = admin + program + pajak (semua desimal, mis. 0.225).
// flat_unit  = biaya flat per order ÷ rata-rata qty per order.

export type KomponenFee = { nama: string; jenis: string; persen: number; flat: number; sumber: "auto" | "manual" };

export type InputHarga = {
  hpp: number;
  /** Fee persen per baris (admin, program, pajak) dalam PERSEN, mis. 10 bukan 0.1. */
  feePersen: KomponenFee[];
  /** Fee flat per ORDER (mis. biaya proses Rp1.250). */
  feeFlat: KomponenFee[];
  /** Rata-rata qty per order untuk mengalokasikan flat. Default 1. */
  qtyPerOrder?: number;
  /** OPEX non-iklan per BULAN (nominal rupiah). Opsional — 0/kosong = tidak dibebankan. */
  opexBulanan: number;
  /** Volume unit per BULAN. Opsional — 0 = OPEX tidak dibagi (peringatan bila OPEX diisi). */
  volumeBulanan: number;
  /** Iklan sebagai PERSEN dari harga jual (mis. 2.47). */
  iklanPersen: number;
  /**
   * Cara menetapkan margin:
   * - "persen"  : marginTarget = PERSEN dari harga jual (default).
   * - "nominal" : marginTarget = RUPIAH per unit (margin tetap, tidak terpengaruh harga).
   */
  marginMode?: "persen" | "nominal";
  /** Target margin: PERSEN dari harga jual bila mode "persen", RUPIAH/unit bila "nominal". */
  marginTarget: number;
  /** Pembulatan harga: 0 = tanpa pembulatan. */
  pembulatan?: number;
};

export type BarisRincian = { nama: string; jenis: string; persen: number; flat: number; rupiah: number; sumber: string };

export type HasilHarga = {
  ok: true;
  harga: number;
  hargaSebelumBulat: number;
  opexPerUnit: number;
  flatPerUnit: number;
  feePersenTotal: number;
  iklanPersen: number;
  marginMode: "persen" | "nominal";
  marginPersen: number;
  /** Margin aktual per unit (rupiah) — selalu ada, apa pun modenya. */
  marginRupiah: number;
  /** Target margin yang diminta user (persen atau rupiah, sesuai mode). */
  marginTarget: number;
  modalPerUnit: number;
  rincian: BarisRincian[];
  peringatan: string[];
} | { ok: false; error: string; peringatan: string[] };

function bulatkan(nilai: number, kelipatan: number): number {
  if (!kelipatan || kelipatan <= 0) return Math.round(nilai);
  return Math.round(nilai / kelipatan) * kelipatan;
}

/**
 * Hitung harga jual dari HPP + komponen biaya.
 * Mengembalikan {ok:false} bila input tidak masuk akal (pembagi ≤ 0) — bukan menebak.
 */
export function hitungHargaJual(i: InputHarga): HasilHarga {
  const peringatan: string[] = [];
  const mode = i.marginMode ?? "persen";

  // ── Validasi keras: pembagi nol / negatif = mustahil, jangan dihitung ──
  const totalPersen = i.feePersen.reduce((a, x) => a + x.persen, 0);
  // Margin persen menambah pembagi; margin nominal TIDAK (ia konstanta, bukan porsi harga).
  const marginPersenTarget = mode === "persen" ? i.marginTarget : 0;
  const denom = 1 - (totalPersen + i.iklanPersen + marginPersenTarget) / 100;
  if (denom <= 0) {
    return {
      ok: false,
      error:
        `Total (fee ${totalPersen.toFixed(2)}% + iklan ${i.iklanPersen.toFixed(2)}%` +
        (mode === "persen" ? ` + margin ${i.marginTarget.toFixed(2)}%` : "") +
        `) = ${(100 - denom * 100).toFixed(2)}% ≥ 100% — harga jual tak terdefinisi. Turunkan margin atau periksa fee.`,
      peringatan,
    };
  }
  if (mode === "nominal" && i.marginTarget < 0) {
    return { ok: false, error: "Margin nominal tidak boleh negatif.", peringatan };
  }
  if (i.hpp < 0) return { ok: false, error: "HPP tidak boleh negatif.", peringatan };
  if (i.opexBulanan < 0) return { ok: false, error: "OPEX bulanan tidak boleh negatif.", peringatan };
  if (i.volumeBulanan < 0) return { ok: false, error: "Volume bulanan tidak boleh negatif.", peringatan };

  const qty = i.qtyPerOrder && i.qtyPerOrder > 0 ? i.qtyPerOrder : 1;
  // OPEX & volume opsional. OPEX hanya dibebankan bila volume > 0.
  const opexPerUnit = i.volumeBulanan > 0 ? i.opexBulanan / i.volumeBulanan : 0;
  if (opexPerUnit === 0) {
    peringatan.push(
      i.opexBulanan > 0
        ? "OPEX diisi tapi volume 0 — biaya operasional TIDAK dibebankan ke harga. Isi volume bila ingin OPEX ikut terhitung."
        : "OPEX tidak dibebankan — harga hanya menutup HPP dan fee Shopee, bukan biaya operasional."
    );
  }
  const flatPerUnit = i.feeFlat.reduce((a, x) => a + x.flat, 0) / qty;

  const modalPerUnit = i.hpp + opexPerUnit + flatPerUnit;
  // Persen: margin = porsi harga -> naikkan pembilang basis modal, bagi sisa persen.
  // Nominal: margin = rupiah tetap -> tambahkan ke modal, bagi sisa persen saja.
  const pembilang = mode === "nominal" ? modalPerUnit + i.marginTarget : modalPerUnit;
  const hargaSebelumBulat = pembilang / denom;
  const harga = bulatkan(hargaSebelumBulat, i.pembulatan ?? 0);

  // ── Margin aktual (setelah pembulatan bisa sedikit beda dari target) ──
  const feeRupiah = harga * (totalPersen / 100);
  const iklanRupiah = harga * (i.iklanPersen / 100);
  // Sisa setelah semua biaya — inilah laba bersih nyata per unit.
  const marginRupiah = harga - feeRupiah - iklanRupiah - i.hpp - opexPerUnit - flatPerUnit;
  const marginPersen = harga > 0 ? (marginRupiah / harga) * 100 : 0;

  // ── Peringatan (tidak memblokir) ──
  if (mode === "persen") {
    if (Math.abs(marginPersen - i.marginTarget) > 0.5) {
      peringatan.push(
        `Margin hasil ${marginPersen.toFixed(2)}% berbeda dari target ${i.marginTarget.toFixed(2)}% (efek pembulatan).`
      );
    }
  } else if (Math.abs(marginRupiah - i.marginTarget) > 1) {
    peringatan.push(
      `Margin hasil ${Math.round(marginRupiah).toLocaleString("id-ID")} berbeda dari target ` +
      `${Math.round(i.marginTarget).toLocaleString("id-ID")} (efek pembulatan).`
    );
  }
  if (marginPersen < 0) peringatan.push("Harga menghasilkan margin negatif — periksa HPP/fee.");
  if (i.iklanPersen > 0 && i.opexBulanan > 0) {
    peringatan.push("Pastikan iklan TIDAK ikut dihitung di OPEX (hindari dobel).");
  }

  const rincian: BarisRincian[] = [
    ...i.feePersen.map((f) => ({ nama: f.nama, jenis: f.jenis, persen: f.persen, flat: 0, rupiah: Math.round(harga * f.persen / 100), sumber: f.sumber })),
    ...(i.iklanPersen > 0 ? [{ nama: "Iklan", jenis: "iklan", persen: i.iklanPersen, flat: 0, rupiah: Math.round(harga * i.iklanPersen / 100), sumber: "manual" as const }] : []),
    ...i.feeFlat.map((f) => ({ nama: f.nama, jenis: f.jenis, persen: 0, flat: f.flat, rupiah: Math.round(f.flat / qty), sumber: f.sumber })),
    { nama: "OPEX (tetap)", jenis: "opex", persen: 0, flat: 0, rupiah: Math.round(opexPerUnit), sumber: "manual" },
    { nama: "HPP", jenis: "hpp", persen: 0, flat: 0, rupiah: i.hpp, sumber: "auto" },
    { nama: "Margin (sisa)", jenis: "margin", persen: marginPersen, flat: 0, rupiah: Math.round(marginRupiah), sumber: "manual" },
  ];

  return {
    ok: true,
    harga,
    hargaSebelumBulat: Math.round(hargaSebelumBulat),
    opexPerUnit: Math.round(opexPerUnit),
    flatPerUnit: Math.round(flatPerUnit),
    feePersenTotal: totalPersen,
    iklanPersen: i.iklanPersen,
    marginMode: mode,
    marginPersen: Math.round(marginPersen * 100) / 100,
    marginRupiah: Math.round(marginRupiah),
    marginTarget: i.marginTarget,
    modalPerUnit: Math.round(modalPerUnit),
    rincian,
    peringatan,
  };
}
