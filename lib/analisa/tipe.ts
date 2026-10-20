// lib/analisa/tipe.ts — Tipe temuan analisa (dipakai UI dan AI, SATU bentuk).
//
// Kenapa dipisah dari hitung.ts: UI dan prompt AI harus memakai bentuk yang SAMA.
// Kalau keduanya punya tipe sendiri-sendiri, cepat atau lambat angkanya berbeda —
// dan analisa yang angkanya berbeda antar tampilan tidak bisa dipercaya.
//
// PENTING: tipe di sini TIDAK mengimpor apa pun. Analisa adalah logika bisnis yang
// harus bisa diuji tanpa database.

/** Tingkat kepentingan temuan. Menentukan urutan tampil dan warna. */
export type Keparahan = "kritis" | "peringatan" | "catatan";

/**
 * Satu temuan analisa.
 *
 * Aturan yang mengikat: `angka` WAJIB ada untuk setiap temuan. Temuan tanpa angka
 * pendukung tidak boleh lolos — "margin rendah" tanpa nilai tidak bisa ditindaklanjuti
 * dan tidak bisa diaudit.
 */
export type Temuan = {
  /** Kunci stabil untuk UI (React key) dan untuk AI merujuk temuan tertentu. */
  kode: string;
  keparahan: Keparahan;
  judul: string;
  /** Penjelasan satu-dua kalimat, bahasa awam, tanpa istilah teknis. */
  penjelasan: string;
  /** Angka pendukung. WAJIB — inilah yang membuat temuan bisa diperiksa. */
  angka: {
    /** Nilai utama temuan (rupiah, jumlah, atau persen sesuai `satuan`). */
    nilai: number;
    satuan: "rupiah" | "jumlah" | "persen" | "rasio";
    /** Jumlah objek yang terkena (mis. 4 SKU merugi). 0 bila tidak relevan. */
    jumlahTerkena: number;
    /** Nilai pembanding bila ada (mis. total laba), untuk memberi konteks. */
    dariTotal?: number;
  };
  /** SKU terkait, sudah diurut paling penting, maks 10 agar UI tidak banjir. */
  contohSku: { sku: string; nama: string | null; nilai: number }[];
  /** Bila temuan bergantung data yang tidak ada, sebutkan di sini. */
  dataKurang?: string[];
};

/** Ringkasan angka utama, selalu ditampilkan paling atas. */
export type RingkasanAnalisa = {
  periode: string;
  presetId: number;
  jmlSku: number;
  jmlOrder: number;
  omzet: number;
  hpp: number;
  biaya: number;
  pajak: number;
  laba: number;
  marginPersen: number;
  /** Rata-rata margin per unit seluruh SKU (berbobot unit terjual). */
  marginSatuanRata: number;
  /** Median marginPersen — dipakai membandingkan dengan rata-rata (deteksi outlier). */
  marginPersenMedian: number;
  /** Rupiah laba yang disumbang 10 SKU teratas. */
  kontribusi10Teratas: number;
  /** Berapa persen laba dari 10 SKU teratas. >60% = risiko konsentrasi. */
  persen10Teratas: number;
};

/** Satu SKU dalam tabel analisa, dengan kolom yang dipakai untuk mengurutkan. */
export type BarisSku = {
  sku: string;
  nama: string | null;
  unit: number;
  hppSatuan: number;
  hargaJual: number;
  marginSatuan: number;
  marginPersen: number;
  kontribusi: number;
  /** ROAS titik impas = hargaJual ÷ marginSatuan. null bila margin ≤ 0 (tak ada titik impas). */
  roasImpas: number | null;
  /** HPP master saat ini, null bila SKU tidak ada di master. */
  hppMaster: number | null;
  /** Selisih HPP master vs HPP snapshot; >0 = HPP naik, margin sebenarnya lebih jelek. */
  hppNaik: number;
  /** Stok total lintas gudang (kecuali ONLINE) — untuk silang kontribusi vs stok. */
  stok: number | null;
  /** Jumlah tayangan iklan (dilihat). null = data iklan SKU ini belum diimpor. */
  dilihat: number | null;
  /** Jumlah klik iklan. null = data iklan SKU ini belum diimpor. */
  klik: number | null;
  /** CTR = klik ÷ dilihat × 100 (persen). null bila dilihat 0/tidak ada — BUKAN Infinity. */
  ctr: number | null;
  /** CR = unit terjual dari iklan ÷ klik × 100 (persen). null bila klik 0/tidak ada. */
  cr: number | null;
  /**
   * Asal pembilang `cr`: "iklan" bila ekspor iklan memuat jumlah pesanan, "snapshot" bila
   * terpaksa memakai unit snapshot (populasi order berbeda → CR cenderung dilebih-lebihkan).
   * Kosong = CR null (tidak ada yang bisa dijelaskan).
   */
  crSumber?: "iklan" | "snapshot";
  /** Biaya iklan SKU ini pada periode. null = belum diimpor, bukan nol. */
  biayaIklan: number | null;
  /** ROAS aktual = omzet iklan ÷ biaya iklan. null bila biaya 0/tidak ada — BUKAN Infinity. */
  roasAktual: number | null;

  // ── Metrik ORGANIK (dari Performa Produk: kunjungan halaman, TANPA iklan) ──
  // PERINGATAN: JANGAN TERTUKAR dengan `dilihat`/`klik`/`biayaIklan` di atas.
  // `dilihat` & `klik` = TAYANGAN/KLIK IKLAN (uang keluar, dari `ads_produk`).
  // `organik*` = perilaku pengunjung halaman produk yang datang tanpa iklan
  // (`performa_produk`). Menukar keduanya membuat kesimpulan iklan salah total:
  // produk yang halamannya buruk akan dituduh iklannya buruk.
  // Semua null = tidak ada datanya (SKU tidak ada di impor Performa Produk), BUKAN nol.
  /** Jumlah dilihat organik (halaman produk dilihat tanpa iklan). */
  organikDilihat: number | null;
  /** Kunjungan organik ke halaman produk. */
  organikKunjungan: number | null;
  /** Masuk keranjang dari kunjungan organik. */
  organikKeranjang: number | null;
  /** Pesanan jadi dari kunjungan organik. */
  organikPesanan: number | null;
  /** Omzet dari pesanan organik. */
  organikOmzet: number | null;
};

/** Hasil lengkap analisa cepat. */
export type HasilAnalisa = {
  ringkasan: RingkasanAnalisa;
  temuan: Temuan[];
  baris: BarisSku[];
  /** Data yang TIDAK ada saat analisa dijalankan — wajib diteruskan ke AI. */
  kurang: string[];
  /** Berapa snapshot tersedia; dipakai menentukan apakah tren bisa dihitung. */
  jmlSnapshot: number;
};

/** Kandidat yang diusulkan saat bertanya SKU. Hanya tampilan — bukan keputusan. */
export type KandidatSku = {
  sku: string;
  nama: string | null;
  /** Skor kemiripan 0..1 dari mesin pencocokan yang sudah ada (lib/matching). */
  skor: number;
};

/** Satu pertanyaan yang menunggu jawaban manusia. */
export type PertanyaanSku = {
  jenis: "tanpa_sku" | "sku_tak_ada_master";
  /** Kode Produk Shopee yang dipertanyakan. */
  kodeProduk: string;
  namaShopee: string;
  variasi: string | null;
  pesanan: number;
  omzet: number;
  /** Kandidat terdekat, sudah diurut — HANYA untuk mempercepat mata manusia. */
  kandidat: KandidatSku[];
};

/** Jawaban satu baris dari UI dua kartu. */
export type JawabanSku = {
  kodeProduk: string;
  jenis: PertanyaanSku["jenis"];
  /** SKU yang dipilih/diketik; '' berarti "bukan produk kita". */
  sku: string;
};

/**
 * Nilai sah untuk kedalaman analisa AI.
 *
 * Ditaruh di modul ini (bukan di `lib/d1/aiAnalisaSetting.ts`) karena berkas ini NOL import
 * dan karenanya bisa dipakai komponen klien. `lib/d1/*` menarik `D1Database` yang hanya ada
 * di Cloudflare, jadi menyalin konstanta ke klien akan membuat dua sumber kebenaran — persis
 * kesalahan yang dulu terjadi pada tipe `BarisSku`.
 */
export const KEDALAMAN_SAH = ["ringkas", "sedang", "panjang"] as const;
export type Kedalaman = (typeof KEDALAMAN_SAH)[number];

/** Batas plafon token. Ini PELINDUNG, bukan target: analisa tetap boleh jauh lebih pendek. */
export const MAKS_TOKEN_MIN = 1000;
export const MAKS_TOKEN_MAKS = 32000;
