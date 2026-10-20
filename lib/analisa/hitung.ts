// lib/analisa/hitung.ts — Inti analisa produk. FUNGSI MURNI, tanpa akses DB.
//
// Kenapa murni: seluruh angkanya harus bisa diuji tanpa database, dan masukannya harus
// eksplisit. Analisa yang butuh DB untuk diuji tidak akan diuji, dan analisa yang tidak
// diuji akan salah diam-diam — di data keuangan itu berbahaya.
//
// ATURAN YANG MENGIKAT:
//   * Setiap temuan WAJIB punya angka pendukung. Temuan tanpa angka tidak lolos.
//   * Data yang tidak ada DISEBUT, tidak diabaikan diam-diam. Kesimpulan yang dibuat
//     tanpa biaya iklan harus dinyatakan sebagai begitu.
//   * Angka yang dihitung di sini TIDAK boleh dihitung ulang oleh AI. AI menafsirkan
//     hasil ini, bukan menghitung dari data mentah.

import type {
  BarisSku, HasilAnalisa, RingkasanAnalisa, Temuan,
} from "./tipe";

/** Ambang margin tipis (%). Keputusan user 2026-10-14. */
export const AMBANG_MARGIN_TIPIS = 10;

/** Ambang konsentrasi: >60% laba dari 10 SKU teratas = risiko bergantung segelintir. */
export const AMBANG_KONSENTRASI = 60;

/** Bila selisih median vs rata-rata margin melebihi ini (poin persen), ada outlier ekstrem. */
export const AMBANG_OUTLIER = 10;

// ── Ambang iklan ─────────────────────────────────────────────────────────────
// PRAKTIK UMUM pemasaran marketplace, BUKAN aturan resmi Shopee. Tidak ada dokumen
// Shopee yang menetapkan angka-angka ini; dipakai hanya sebagai pemicu "layak ditinjau",
// bukan vonis. Kalau toko punya angka sendiri dari pengalaman, ganti di sini.

/** CTR (%) PRAKTIK UMUM, bukan aturan resmi Shopee. Di bawah ini iklan dianggap tidak menarik klik. */
export const AMBANG_CTR_SEHAT = 1.5;

/**
 * Jumlah tayangan minimum PRAKTIK UMUM, bukan aturan resmi Shopee —
 * di bawah ini sampelnya terlalu kecil untuk dinilai.
 * Shopee sendiri menganjurkan menunggu ±2 minggu sebelum menilai hasil iklan,
 * karena CTR/ROAS beberapa hari pertama belum mewakili.
 */
export const AMBANG_DILIHAT_MIN = 1000;

/** Masukan analisa — semuanya eksplisit, tidak ada yang diambil diam-diam dari DB. */
export type MasukanAnalisa = {
  presetId: number;
  periode: string;
  snapshot: {
    jml_order: number;
    omzet: number;
    hpp: number;
    biaya: number;
    pajak: number;
    laba: number;
    rincian: {
      sku: string; nama: string | null; unit: number; hppSatuan: number;
      hargaJual: number; marginSatuan: number; marginPersen: number; kontribusi: number;
    }[];
  };
  /** HPP master saat ini per SKU; dipakai deteksi HPP basi. */
  hppMaster: Map<string, number>;
  /** Stok total per SKU (gudang non-online); null bila tidak diambil. */
  stok: Map<string, number> | null;
  /** Biaya iklan periode ini. null = BELUM ADA data iklan (bukan nol). */
  biayaIklan: number | null;
  /**
   * Metrik iklan per SKU untuk periode ini; kosong bila belum diimpor.
   * Kunci = SKU. Isi: dilihat/klik/biaya/omzet dari `ads_produk` (agregat rentang).
   */
  // `pesanan` opsional: bila ekspor iklan memuat jumlah pesanan, CR dihitung dari pesanan
  // iklan itu sendiri — bukan dari unit snapshot (populasi order berbeda, CR jadi overstate).
  iklanPerSku?: Map<string, { dilihat: number; klik: number; biaya: number; omzet: number; pesanan?: number }>;
  /**
   * Metrik ORGANIK per SKU (kunjungan halaman produk TANPA iklan) dari `performa_produk`.
   * Kunci = SKU. Opsional supaya pemanggil lama tetap jalan; kosong = data belum ada.
   * JANGAN dicampur dengan `iklanPerSku` — keduanya menjawab pertanyaan berbeda.
   */
  performaPerSku?: Map<string, {
    dilihat: number; klik: number; kunjungan: number; keranjang: number;
    pesanan: number; omzet: number; tanpaBeli: number;
  }>;
  /** Jumlah snapshot tersedia — menentukan apakah tren bisa dihitung. */
  jmlSnapshot: number;
  /** Apakah ada data performa produk (kunjungan/konversi) untuk periode ini. */
  adaPerforma: boolean;
};

/** Median dari daftar angka; 0 bila kosong. */
export function median(angka: number[]): number {
  if (angka.length === 0) return 0;
  const urut = [...angka].sort((a, b) => a - b);
  const t = Math.floor(urut.length / 2);
  return urut.length % 2 === 0 ? (urut[t - 1] + urut[t]) / 2 : urut[t];
}

/**
 * ROAS titik impas = hargaJual ÷ marginSatuan.
 *
 * Artinya: setiap Rp 1 belanja iklan harus menghasilkan minimal sekian rupiah penjualan
 * HANYA supaya tidak rugi. Ini dihitung dari biaya toko sendiri, sehingga bisa diaudit —
 * berbeda dari "target ROAS" yang mengklaim tahu perilaku platform.
 *
 * null bila margin ≤ 0: produk yang sudah rugi sebelum iklan tidak punya titik impas.
 */
export function roasImpas(hargaJual: number, marginSatuan: number): number | null {
  if (!(marginSatuan > 0) || !(hargaJual > 0)) return null;
  return Math.round((hargaJual / marginSatuan) * 100) / 100;
}

/** Bangun baris SKU lengkap dari rincian snapshot + data master. */
export function bangunBaris(m: MasukanAnalisa): BarisSku[] {
  return m.snapshot.rincian.map((r) => {
    const hppMaster = m.hppMaster.get(r.sku) ?? null;
    const iklan = m.iklanPerSku?.get(r.sku) ?? null;
    const organik = m.performaPerSku?.get(r.sku) ?? null;
    // Pembagi nol → null, BUKAN Infinity/NaN. Angka tak terhingga yang lolos ke UI
    // akan tampil sebagai "∞%" dan merusak kepercayaan pada seluruh halaman.
    const ctr = iklan && iklan.dilihat > 0 ? bulat2((iklan.klik / iklan.dilihat) * 100) : null;
    // CR: pembilang & penyebut harus dari populasi yang SAMA. `unit` berasal dari SEMUA order
    // (organik + iklan), jadi membaginya dengan klik iklan saja melebih-lebihkan konversi.
    // Bila ekspor iklan memuat `pesanan`, pakai itu. `> 0` (bukan `!= null`) karena ekspor lama
    // mengisi kolom pesanan dengan 0 saat tidak dilaporkan — 0 itu "tidak diisi", bukan "nol".
    const pesananIklan = iklan?.pesanan;
    const adaPesananIklan = typeof pesananIklan === "number" && Number.isFinite(pesananIklan) && pesananIklan > 0;
    const cr = iklan && iklan.klik > 0
      ? bulat2(((adaPesananIklan && pesananIklan !== undefined ? pesananIklan : r.unit) / iklan.klik) * 100)
      : null;
    // Ditandai supaya UI bisa menyebut sumbernya saat CR masih memakai unit snapshot.
    const crSumber: "iklan" | "snapshot" | undefined = cr === null ? undefined : (adaPesananIklan ? "iklan" : "snapshot");
    const roasAktual = iklan && iklan.biaya > 0 ? bulat2(iklan.omzet / iklan.biaya) : null;
    return {
      sku: r.sku,
      nama: r.nama,
      unit: r.unit,
      hppSatuan: r.hppSatuan,
      hargaJual: r.hargaJual,
      marginSatuan: r.marginSatuan,
      marginPersen: r.marginPersen,
      kontribusi: r.kontribusi,
      roasImpas: roasImpas(r.hargaJual, r.marginSatuan),
      hppMaster,
      // HPP naik SETELAH snapshot dibuat = margin sebenarnya kini lebih jelek.
      hppNaik: hppMaster !== null && hppMaster > r.hppSatuan ? hppMaster - r.hppSatuan : 0,
      // SKU tanpa baris stok = TIDAK DIKETAHUI (null), bukan 0. `0` berarti "habis" dan
      // memunculkan temuan stok mati/tipis palsu untuk SKU yang tak punya catatan gudang.
      stok: m.stok ? (m.stok.get(r.sku) ?? null) : null,
      dilihat: iklan ? iklan.dilihat : null,
      klik: iklan ? iklan.klik : null,
      ctr,
      cr,
      crSumber,
      biayaIklan: iklan ? iklan.biaya : null,
      roasAktual,
      // Organik: null bila SKU tidak ada di impor Performa Produk — bukan nol.
      organikDilihat: organik ? organik.dilihat : null,
      organikKunjungan: organik ? organik.kunjungan : null,
      organikKeranjang: organik ? organik.keranjang : null,
      organikPesanan: organik ? organik.pesanan : null,
      organikOmzet: organik ? organik.omzet : null,
    };
  });
}

/**
 * CR organik = pesanan ÷ kunjungan × 100 (persen).
 * Rumus SAMA dengan CR iklan: pembagi nol/tidak ada → null, BUKAN Infinity.
 * Dipakai menemukan halaman produk yang didatangi tapi tidak menghasilkan pesanan.
 */
export function organikCr(b: BarisSku): number | null {
  if (b.organikKunjungan === null || b.organikKunjungan <= 0 || b.organikPesanan === null) return null;
  return bulat2((b.organikPesanan / b.organikKunjungan) * 100);
}

/** Bulatkan ke 2 desimal; satu tempat supaya UI, AI, dan uji memakai angka yang sama. */
function bulat2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Keputusan yang disarankan untuk satu SKU yang diiklankan. */
export type KeputusanIklan = "naikkan" | "hentikan" | "tahan" | "belum_cukup_data";

/**
 * Putuskan tindakan iklan untuk satu SKU. FUNGSI MURNI — tanpa I/O, supaya bisa diuji.
 *
 * Dipisah dari AI dengan sengaja: keputusan "naikkan/hentikan" menyangkut uang nyata,
 * jadi harus berasal dari aturan terbaca, bukan dari kalimat model bahasa.
 */
export function keputusanIklan(b: BarisSku): { keputusan: KeputusanIklan; alasan: string } {
  // 1. Sampel terlalu kecil → jangan menilai. Menyimpulkan dari 50 tayangan sama saja menebak.
  if (b.dilihat === null || b.dilihat < AMBANG_DILIHAT_MIN) {
    const angka = b.dilihat === null ? "belum ada data tayangan" : `baru ${b.dilihat} tayangan`;
    return {
      keputusan: "belum_cukup_data",
      alasan: `Belum bisa dinilai: ${angka}, di bawah batas ${AMBANG_DILIHAT_MIN} tayangan (praktik umum, bukan aturan resmi Shopee).`,
    };
  }

  // 2. ROAS aktual di bawah titik impas → setiap rupiah iklan berubah jadi kerugian.
  if (b.roasAktual !== null && b.roasImpas !== null && b.roasAktual < b.roasImpas) {
    return {
      keputusan: "hentikan",
      alasan: `Hentikan: ROAS aktual ${b.roasAktual} di bawah titik impas ${b.roasImpas} — iklan menghasilkan lebih sedikit daripada yang dikeluarkan.`,
    };
  }

  // 3. CTR sehat DAN sudah melewati titik impas → layak didorong lebih besar.
  if (
    b.ctr !== null && b.ctr >= AMBANG_CTR_SEHAT &&
    b.roasAktual !== null && b.roasImpas !== null && b.roasAktual >= b.roasImpas
  ) {
    return {
      keputusan: "naikkan",
      alasan: `Naikkan: CTR ${b.ctr}% sudah di atas ambang ${AMBANG_CTR_SEHAT}% dan ROAS aktual ${b.roasAktual} sudah melewati titik impas ${b.roasImpas}.`,
    };
  }

  // 4. Selain itu: data ada tapi belum meyakinkan ke salah satu arah.
  const bagian: string[] = [];
  if (b.ctr !== null) bagian.push(`CTR ${b.ctr}%`);
  if (b.roasAktual !== null && b.roasImpas !== null) bagian.push(`ROAS aktual ${b.roasAktual} vs titik impas ${b.roasImpas}`);
  return {
    keputusan: "tahan",
    alasan: `Tahan dulu: ${bagian.length > 0 ? bagian.join(", ") : "metrik iklan belum meyakinkan"} — belum cukup kuat untuk menaikkan maupun menghentikan.`,
  };
}

/** Ringkasan angka utama. */
export function buatRingkasan(m: MasukanAnalisa, baris: BarisSku[]): RingkasanAnalisa {
  const s = m.snapshot;
  const diurut = [...baris].sort((a, b) => b.kontribusi - a.kontribusi);
  const sepuluh = diurut.slice(0, 10);
  const kontribusi10 = sepuluh.reduce((a, x) => a + x.kontribusi, 0);
  const totalUnit = baris.reduce((a, x) => a + x.unit, 0);
  const totalKontribusi = baris.reduce((a, x) => a + x.kontribusi, 0);
  return {
    periode: m.periode,
    presetId: m.presetId,
    jmlSku: baris.length,
    jmlOrder: s.jml_order,
    omzet: s.omzet,
    hpp: s.hpp,
    biaya: s.biaya,
    pajak: s.pajak,
    laba: s.laba,
    marginPersen: s.omzet > 0 ? Math.round((s.laba / s.omzet) * 1000) / 10 : 0,
    marginSatuanRata: totalUnit > 0 ? Math.round(totalKontribusi / totalUnit) : 0,
    marginPersenMedian: Math.round(median(baris.map((b) => b.marginPersen)) * 10) / 10,
    kontribusi10Teratas: kontribusi10,
    persen10Teratas: totalKontribusi > 0 ? Math.round((kontribusi10 / totalKontribusi) * 1000) / 10 : 0,
  };
}

/**
 * Hasilkan seluruh temuan. Urutan hasil = urutan prioritas (kritis dulu).
 * Setiap temuan punya angka; temuan yang tidak bisa diberi angka tidak dibuat.
 */
export function buatTemuan(m: MasukanAnalisa, baris: BarisSku[], ringkas: RingkasanAnalisa): Temuan[] {
  const temuan: Temuan[] = [];

  // ── 1. SKU merugi (paling mendesak) ──
  const merugi = baris.filter((b) => b.marginSatuan < 0);
  if (merugi.length > 0) {
    const totalRugi = merugi.reduce((a, b) => a + b.kontribusi, 0);
    temuan.push({
      kode: "sku_merugi", keparahan: "kritis",
      judul: `${merugi.length} SKU merugi setiap kali terjual`,
      penjelasan: `Harga jual lebih rendah daripada biaya (HPP + biaya lain). Setiap penjualan menambah kerugian, bukan laba. Periksa harga jual atau hentikan produk ini.`,
      angka: { nilai: Math.abs(totalRugi), satuan: "rupiah", jumlahTerkena: merugi.length, dariTotal: Math.abs(ringkas.laba) || undefined },
      contohSku: [...merugi].sort((a, b) => a.kontribusi - b.kontribusi).slice(0, 10)
        .map((b) => ({ sku: b.sku, nama: b.nama, nilai: b.kontribusi })),
    });
  }

  // ── 2. Margin tipis ──
  const tipis = baris.filter((b) => b.marginSatuan >= 0 && b.marginPersen < AMBANG_MARGIN_TIPIS);
  if (tipis.length > 0) {
    temuan.push({
      kode: "margin_tipis", keparahan: "peringatan",
      judul: `${tipis.length} SKU bermargin di bawah ${AMBANG_MARGIN_TIPIS}%`,
      penjelasan: `Margin tipis rapuh: kenaikan HPP sedikit atau biaya iklan secuil bisa membuatnya merugi. Bandingkan dengan margin rata-rata toko untuk melihat mana yang perlu dinaikkan harganya.`,
      angka: { nilai: tipis.reduce((a, b) => a + b.kontribusi, 0), satuan: "rupiah", jumlahTerkena: tipis.length, dariTotal: ringkas.laba },
      contohSku: [...tipis].sort((a, b) => a.marginPersen - b.marginPersen).slice(0, 10)
        .map((b) => ({ sku: b.sku, nama: b.nama, nilai: b.marginPersen })),
    });
  }

  // ── 3. Konsentrasi laba ──
  if (baris.length >= 10 && ringkas.persen10Teratas > AMBANG_KONSENTRASI) {
    temuan.push({
      kode: "konsentrasi", keparahan: "peringatan",
      judul: `${ringkas.persen10Teratas}% laba datang dari 10 SKU saja`,
      penjelasan: `Laba toko sangat bergantung pada segelintir produk. Bila salah satunya kehabisan stok, kompetitor menurunkan harga, atau iklannya berhenti, laba bisa turun tajam. Sebaiknya ada produk pendukung yang ditumbuhkan.`,
      angka: { nilai: ringkas.persen10Teratas, satuan: "persen", jumlahTerkena: 10, dariTotal: ringkas.jmlSku },
      contohSku: [...baris].sort((a, b) => b.kontribusi - a.kontribusi).slice(0, 10)
        .map((b) => ({ sku: b.sku, nama: b.nama, nilai: b.kontribusi })),
    });
  }

  // ── 4. HPP naik setelah snapshot (margin sebenarnya lebih jelek) ──
  const basi = baris.filter((b) => b.hppNaik > 0);
  if (basi.length > 0) {
    // Dampak rupiah: selisih HPP × unit terjual = laba yang sesungguhnya sudah tergerus.
    const dampak = basi.reduce((a, b) => a + b.hppNaik * b.unit, 0);
    temuan.push({
      kode: "hpp_naik", keparahan: "peringatan",
      judul: `HPP ${basi.length} SKU sudah naik sejak data terakhir dihitung`,
      penjelasan: `Angka laba di halaman ini memakai HPP saat snapshot dibuat. HPP produk-produk ini sekarang lebih tinggi, jadi margin sebenarnya lebih tipis dari yang terlihat. Hitung ulang untuk angka terkini.`,
      angka: { nilai: dampak, satuan: "rupiah", jumlahTerkena: basi.length, dariTotal: ringkas.laba },
      contohSku: [...basi].sort((a, b) => b.hppNaik * b.unit - a.hppNaik * a.unit).slice(0, 10)
        .map((b) => ({ sku: b.sku, nama: b.nama, nilai: b.hppNaik * b.unit })),
      dataKurang: ["Perhitungan ulang dengan HPP terbaru belum dijalankan."],
    });
  }

  // ── 5. Sebaran margin tidak wajar (median jauh dari margin total toko) ──
  // Kenapa median vs margin-total: margin total bisa ditarik oleh segelintir produk
  // beromzet besar, sehingga tidak mewakili produk biasa. Bila keduanya berjauhan,
  // rata-rata menyesatkan untuk menilai satu produk.
  const selisih = Math.abs(ringkas.marginPersenMedian - ringkas.marginPersen);
  if (baris.length >= 5 && selisih > AMBANG_OUTLIER) {
    temuan.push({
      kode: "margin_timpang", keparahan: "catatan",
      judul: `Margin antar produk sangat timpang (selisih ${Math.round(selisih)} poin)`,
      penjelasan: `Margin toko ${ringkas.marginPersen}% sedangkan nilai tengah produk ${ringkas.marginPersenMedian}%. Artinya sebagian produk bermargin jauh di atas, sebagian jauh di bawah — margin rata-rata toko menyesatkan bila dipakai menilai satu produk. Nilailah per produk.`,
      angka: { nilai: Math.round(selisih * 10) / 10, satuan: "persen", jumlahTerkena: baris.length, dariTotal: ringkas.marginPersen },
      contohSku: [],
    });
  }

  // ── 6. Silang kontribusi vs stok (hanya bila stok tersedia) ──
  if (m.stok) {
    const kritis = baris
      .filter((b) => b.stok !== null && b.kontribusi > 0)
      .sort((a, b) => b.kontribusi - a.kontribusi)
      .slice(0, 20)
      .filter((b) => (b.stok ?? 0) < b.unit * 0.5);
    if (kritis.length > 0) {
      temuan.push({
        kode: "stok_tipis_penyumbang", keparahan: "kritis",
        judul: `${kritis.length} produk penyumbang laba terbesar berstok tipis`,
        penjelasan: `Produk-produk ini menyumbang laba besar, tapi stoknya lebih sedikit daripada jumlah yang terjual di periode ini. Bila habis, penjualan hilang dan pembeli bisa beralih ke toko lain.`,
        angka: { nilai: kritis.reduce((a, b) => a + b.kontribusi, 0), satuan: "rupiah", jumlahTerkena: kritis.length, dariTotal: ringkas.laba },
        contohSku: kritis.map((b) => ({ sku: b.sku, nama: b.nama, nilai: b.stok ?? 0 })),
      });
    }

    const mati = baris.filter((b) => b.stok !== null && (b.stok ?? 0) > 0 && b.unit === 0);
    if (mati.length > 0) {
      const nilaiMati = mati.reduce((a, b) => a + (b.stok ?? 0) * b.hppSatuan, 0);
      temuan.push({
        kode: "stok_mati", keparahan: "catatan",
        judul: `${mati.length} produk ada stok tapi tidak terjual periode ini`,
        penjelasan: `Modal tertahan di stok yang tidak bergerak. Nilainya dihitung dari HPP × jumlah stok. Perlu diputuskan: didorong penjualannya, didiskon, atau dihentikan pembeliannya.`,
        angka: { nilai: nilaiMati, satuan: "rupiah", jumlahTerkena: mati.length },
        contohSku: [...mati].sort((a, b) => (b.stok ?? 0) * b.hppSatuan - (a.stok ?? 0) * a.hppSatuan).slice(0, 10)
          .map((b) => ({ sku: b.sku, nama: b.nama, nilai: (b.stok ?? 0) * b.hppSatuan })),
      });
    }
  }

  // ── 7. Halaman produk dilihat tapi tidak dibeli (MASALAH HALAMAN, bukan iklan) ──
  // Kenapa temuan ini ada: dulu data kunjungan organik hanya dihitung jumlah barisnya,
  // sehingga tidak ada satu pun tempat yang bisa membedakan "produk tidak pernah dilihat"
  // (masalah iklan/pencarian) dari "produk dilihat banyak orang tapi tak seorang pun beli"
  // (masalah halaman: foto, judul, harga, ongkir). Dua masalah itu obatnya berbeda total.
  // Ambang kunjungan 50 = PRAKTIK UMUM sampel minimum, bukan aturan resmi Shopee.
  const TANPA_BELI_MIN = 50;
  const halamanBermasalah = baris.filter(
    (b) => b.organikKunjungan !== null && b.organikKunjungan >= TANPA_BELI_MIN && b.organikPesanan === 0
  );
  if (halamanBermasalah.length > 0) {
    const totalKunjungan = halamanBermasalah.reduce((a, b) => a + (b.organikKunjungan ?? 0), 0);
    temuan.push({
      kode: "organik_dilihat_tanpa_beli", keparahan: "peringatan",
      judul: `${halamanBermasalah.length} produk dilihat banyak orang tapi tidak ada yang membeli`,
      penjelasan: `Ini BUKAN masalah iklan: pengunjungnya sudah datang sendiri (tanpa iklan) dan tetap tidak ada pesanan. Berarti yang menghalangi ada di halaman produknya — foto, judul, harga, atau ongkir — bukan di setelan iklannya. Perbaiki halaman dulu sebelum membelanjakannya untuk iklan.`,
      angka: { nilai: totalKunjungan, satuan: "jumlah", jumlahTerkena: halamanBermasalah.length, dariTotal: baris.length },
      // Kunjungan 0 tetap ditulis apa adanya agar pembaca tahu angka pendukungnya.
      contohSku: [...halamanBermasalah].sort((a, b) => (b.organikKunjungan ?? 0) - (a.organikKunjungan ?? 0)).slice(0, 10)
        .map((b) => ({ sku: b.sku, nama: b.nama, nilai: b.organikKunjungan ?? 0 })),
      dataKurang: [`Ambang ${TANPA_BELI_MIN} kunjungan adalah praktik umum, bukan aturan resmi Shopee.`],
    });
  }

  return temuan;
}

/** Jalankan analisa cepat lengkap. */
export function analisaCepat(m: MasukanAnalisa): HasilAnalisa {
  const baris = bangunBaris(m);
  const ringkasan = buatRingkasan(m, baris);
  const temuan = buatTemuan(m, baris, ringkasan);
  const kurang: string[] = [];
  if (m.biayaIklan === null) kurang.push("Biaya iklan per produk belum diimpor — margin belum memperhitungkan iklan.");
  if (!m.adaPerforma) kurang.push("Data kunjungan/konversi produk belum ada.");
  if (m.jmlSnapshot < 2) kurang.push("Snapshot kurang dari 2 — tren antar periode belum bisa dihitung.");
  if (!m.stok) kurang.push("Data stok tidak diambil — silang kontribusi vs stok belum dihitung.");
  return { ringkasan, temuan, baris, kurang, jmlSnapshot: m.jmlSnapshot };
}

/** Kelas laju produk. Satu definisi untuk semua tab; `normal` = di antara fast dan slow. */
export type KelasProduk = "fast" | "slow" | "dead" | "normal";

/**
 * Klasifikasi fast/slow/dead SATU-SATUNYA. Dulu tab "tren" dan tab "detail" punya aturan
 * sendiri-sendiri (satu tanpa `normal`, satu dengan) sehingga SKU yang sama bisa berlabel
 * beda di dua tempat pada halaman yang sama.
 *
 * Aturan: terjual 0 + stok > 0 = dead (bukan slow — barangnya ada, tidak bergerak);
 * laju ≥ rata-rata SKU bergerak = fast; laju < 1/3 rata-rata = slow; sisanya normal.
 * `rataLaju` null (belum ada SKU bergerak) = tidak bisa membandingkan → normal, bukan fast.
 */
export function kelasProduk(p: {
  terjual: number;
  lajuHarian: number;
  stok: number | null;
  rataLaju: number | null;
}): KelasProduk {
  if (p.terjual === 0 && p.stok !== null && p.stok > 0) return "dead";
  if (p.rataLaju === null || !(p.rataLaju > 0) || !(p.terjual > 0)) return "normal";
  if (p.lajuHarian >= p.rataLaju) return "fast";
  if (p.lajuHarian < p.rataLaju / 3) return "slow";
  return "normal";
}

/**
 * SKU yang paling aman diiklankan: ROAS impas terendah.
 * Dipakai tab Saran Iklan. Hanya SKU bermargin positif — yang merugi tidak punya titik impas.
 */
export function urutSaranIklan(baris: BarisSku[]): BarisSku[] {
  return baris
    .filter((b) => b.roasImpas !== null)
    .sort((a, b) => (a.roasImpas ?? 0) - (b.roasImpas ?? 0));
}

/** SKU yang JANGAN diiklankan: margin ≤ 0, berapa pun setelan iklannya. */
export function janganDiiklankan(baris: BarisSku[]): BarisSku[] {
  return baris.filter((b) => b.roasImpas === null);
}
