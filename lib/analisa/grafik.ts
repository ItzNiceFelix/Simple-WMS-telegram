// lib/analisa/grafik.ts — Pembentuk data chart. MURNI: tanpa DB, tanpa React, tanpa jam.
//
// KENAPA dipisah dari komponen: komponen React hanya boleh memformat dan menggambar.
// Begitu komponen ikut menjumlahkan/menghitung persen, angka di grafik bisa berbeda dari
// angka di tabel untuk periode yang sama — kelas bug yang justru ingin dihindari halaman
// analisa. Semua penjumlahan terjadi di sini dan bisa diuji tanpa browser.
//
// ATURAN yang dipegang berkas ini:
//   * `null` = data belum ada, TIDAK PERNAH diganti 0. Batang "belum diimpor" punya
//     `jenis: "tidak_ada"` dan panjang 0, supaya tidak terbaca sebagai "biayanya nol".
//   * Judul chart adalah KESIMPULAN, bukan label ("3 SKU menyumbang 64% laba").
//   * Setiap keluaran membawa `aria` berisi kalimat yang sama dengan judulnya, untuk
//     pembaca layar dan untuk tombol "Lihat sebagai tabel".

import type { BarisSku, RingkasanAnalisa } from "./tipe";
import { AMBANG_KONSENTRASI } from "./hitung";
import { formatPersen, formatRupiah, formatRupiahRingkas } from "../dashboard/format";

/** Peran satu batang di waterfall. Menentukan warna, bukan nilainya. */
export type JenisBatang = "masuk" | "keluar" | "total" | "tidak_ada";

/**
 * Satu batang waterfall.
 *
 * `dasar` + `panjang` adalah yang digambar (batang air butuh alas tak terlihat supaya
 * batang berikutnya mulai dari ujung batang sebelumnya). `nilai` adalah angka bertanda
 * yang dibaca manusia di tooltip dan tabel — satu-satunya sumber untuk teks.
 */
export type BatangAir = {
  kunci: string;
  label: string;
  /**
   * Label sumbu X. Dipisah dari `label` karena enam batang di layar 390px hanya menyisakan
   * ~44px per label: "Biaya admin & program" MUSTAHIL muat, dan memotongnya di komponen
   * menghasilkan singkatan yang berbeda-beda tiap kali. Singkatan ditentukan di sini, sekali.
   */
  pendek: string;
  /** Alas batang (tidak terlihat). Boleh negatif bila batang turun melewati nol. */
  dasar: number;
  /** Panjang yang terlihat; selalu >= 0 supaya arah dibawa oleh `dasar`. */
  panjang: number;
  /** Angka bertanda untuk tooltip/tabel: keluar = negatif. */
  nilai: number;
  jenis: JenisBatang;
  /** Keterangan tambahan, mis. "belum diimpor" atau "di luar laba tersimpan". */
  catatan?: string;
};

export type DataWaterfall = {
  batang: BatangAir[];
  judul: string;
  aria: string;
  /** Data yang tidak ada — disebut di layar, tidak diisi nol. */
  kurang: string[];
};

/**
 * Waterfall "ke mana omzet pergi": Omzet → HPP → biaya admin/program → pajak → laba,
 * lalu biaya iklan dan laba setelah iklan BILA biaya iklan diketahui.
 *
 * KENAPA dua batang terakhir dipisah: `laba` snapshot DIHITUNG `omzet − hpp − biaya`, dan
 * `biaya` itu belum memuat belanja iklan (iklan dibaca dari `ads_produk`). Menggambar
 * "biaya iklan" di tengah rantai akan membuat batang-batangnya tidak berjumlah laba —
 * waterfall yang tidak menutup adalah grafik yang berbohong. Karena itu laba snapshot
 * diberi label apa adanya, lalu iklan menjadi langkah berikutnya.
 *
 * `biayaIklan === null` berarti belum diimpor (BUKAN nol): batangnya digambar kosong
 * berjenis `tidak_ada`, dan "laba setelah iklan" tidak dibuat karena tidak bisa dihitung.
 */
export function dataWaterfall(
  r: RingkasanAnalisa,
  biayaIklan: number | null,
  /**
   * Biaya iklan yang TIDAK bisa dilekatkan ke SKU (iklan grup/GMV Max). Tetap uang yang
   * keluar dari rekening, jadi ikut mengurangi laba — tetapi digambar sebagai batang
   * sendiri supaya jelas bagian mana yang tidak bisa ditelusuri per produk.
   */
  biayaTakTerpetakan: number | null = null
): DataWaterfall {
  const kurang: string[] = [];
  const batang: BatangAir[] = [];
  // `biaya` snapshot SUDAH memuat pajak (lihat hitungLabaPreset: laba = omzet − hpp − biaya).
  // Memisahkannya di sini mencegah pajak dihitung dua kali di waterfall.
  const biayaOps = r.biaya - r.pajak;

  const total = (kunci: string, label: string, pendek: string, nilai: number, jenis: JenisBatang = "total", catatan?: string): void => {
    batang.push({
      kunci, label, pendek, jenis, nilai,
      dasar: Math.min(0, nilai), panjang: Math.abs(nilai),
      ...(catatan ? { catatan } : {}),
    });
  };
  let jalan = r.omzet;
  const keluar = (kunci: string, label: string, pendek: string, nilai: number, catatan?: string): void => {
    const panjang = Math.abs(nilai);
    batang.push({
      kunci, label, pendek, jenis: "keluar", nilai: -panjang,
      dasar: jalan - panjang, panjang,
      ...(catatan ? { catatan } : {}),
    });
    jalan -= panjang;
  };

  total("omzet", "Omzet", "Omzet", r.omzet, "masuk");
  keluar("hpp", "HPP", "HPP", r.hpp);
  keluar("biaya", "Biaya admin & program", "Admin", biayaOps);
  keluar("pajak", "Pajak", "Pajak", r.pajak);
  total("laba", "Laba", "Laba", r.laba);

  let labaSetelahIklan: number | null = null;
  const grup = biayaTakTerpetakan ?? 0;
  if (biayaIklan === null && grup <= 0) {
    kurang.push("biaya iklan belum diimpor — laba setelah iklan belum bisa dihitung");
    batang.push({
      kunci: "iklan", label: "Biaya iklan", pendek: "Iklan", jenis: "tidak_ada",
      nilai: 0, dasar: 0, panjang: 0, catatan: "belum diimpor",
    });
  } else {
    const perSku = biayaIklan ?? 0;
    if (perSku > 0) keluar("iklan", "Biaya iklan per SKU", "Iklan", perSku, "di luar laba tersimpan");
    if (grup > 0) {
      keluar("iklan-grup", "Iklan tak terpetakan", "Grup", grup, "tanpa SKU");
      kurang.push(`biaya iklan grup/GMV Max ${formatRupiah(grup)} tidak bisa dilekatkan ke SKU — ikut mengurangi laba`);
    }
    labaSetelahIklan = r.laba - perSku - grup;
    total("laba-setelah-iklan", "Laba setelah iklan", "Bersih", labaSetelahIklan);
  }

  if (r.omzet <= 0) kurang.push("omzet periode ini nol — tidak ada yang bisa dibagi");

  const judul = r.omzet <= 0
    ? "Belum ada omzet pada periode ini"
    : labaSetelahIklan === null
      ? `Dari ${formatRupiahRingkas(r.omzet)} omzet, ${formatRupiahRingkas(r.laba)} jadi laba (biaya iklan belum diimpor)`
      : `Dari ${formatRupiahRingkas(r.omzet)} omzet, ${formatRupiahRingkas(labaSetelahIklan)} jadi laba setelah iklan`;

  return {
    batang,
    judul,
    aria: `${judul}. Rincian: omzet ${formatRupiah(r.omzet)}, HPP ${formatRupiah(r.hpp)}, biaya admin dan program ${formatRupiah(biayaOps)}, pajak ${formatRupiah(r.pajak)}, laba ${formatRupiah(r.laba)}${labaSetelahIklan === null ? ", biaya iklan belum diimpor" : `, biaya iklan ${formatRupiah(biayaIklan ?? 0)}, laba setelah iklan ${formatRupiah(labaSetelahIklan)}`}.`,
    kurang,
  };
}

/** Satu titik Pareto: kontribusi laba SKU dan persentase kumulatif sampai titik itu. */
export type TitikPareto = {
  sku: string;
  nama: string;
  kontribusi: number;
  /** Kumulatif ÷ total laba × 100, 1 desimal. */
  kumulatif: number;
};

export type DataPareto = {
  titik: TitikPareto[];
  /** Garis referensi konsentrasi (persen) — digambar sebagai garis putus-putus. */
  ambang: number;
  /** Jumlah SKU terkecil yang sudah melewati `ambang`; null bila tidak pernah tercapai. */
  jumlahMencapaiAmbang: number | null;
  judul: string;
  aria: string;
  kurang: string[];
};

/**
 * Pareto laba: `n` SKU teratas + garis kumulatif.
 *
 * Penyebut kumulatif = SELURUH kontribusi (termasuk yang negatif), sama dengan
 * `persen10Teratas` di `buatRingkasan` — kalau penyebutnya beda, dua angka di halaman yang
 * sama akan saling bertentangan. SKU rugi tetap masuk penyebut tetapi tidak digambar
 * sebagai batang: batang negatif di Pareto membuat garis kumulatif turun dan menyesatkan.
 */
export function dataPareto(baris: BarisSku[], n = 15): DataPareto {
  const kurang: string[] = [];
  const total = baris.reduce((a, b) => a + b.kontribusi, 0);
  const positif = baris.filter((b) => b.kontribusi > 0).sort((a, b) => b.kontribusi - a.kontribusi);
  const rugi = baris.filter((b) => b.kontribusi < 0).length;
  if (rugi > 0) kurang.push(`${rugi} SKU kontribusinya negatif — tidak digambar, tetap masuk penyebut`);

  if (total <= 0 || positif.length === 0) {
    const judul = baris.length === 0
      ? "Belum ada SKU yang bisa diurutkan"
      : "Laba periode ini tidak positif — Pareto belum bisa dibaca";
    return { titik: [], ambang: AMBANG_KONSENTRASI, jumlahMencapaiAmbang: null, judul, aria: judul, kurang };
  }

  let jalan = 0;
  let mencapai: number | null = null;
  const titik: TitikPareto[] = positif.slice(0, n).map((b, i) => {
    jalan += b.kontribusi;
    const kumulatif = Math.round((jalan / total) * 1000) / 10;
    if (mencapai === null && kumulatif >= AMBANG_KONSENTRASI) mencapai = i + 1;
    return { sku: b.sku, nama: b.nama ?? b.sku, kontribusi: b.kontribusi, kumulatif };
  });

  const teratas = titik[0];
  // n=0 atau seluruh kontribusi nol: tidak ada titik, jadi tidak ada yang bisa diklaim.
  if (!teratas) {
    const judul = "Tidak ada SKU yang dipilih untuk digambar";
    return { titik, ambang: AMBANG_KONSENTRASI, jumlahMencapaiAmbang: mencapai, judul, aria: judul, kurang };
  }
  const judul = mencapai !== null
    ? `${mencapai} SKU menyumbang ${formatPersen(titik[mencapai - 1].kumulatif, 1)} laba`
    : `${titik.length} SKU teratas menyumbang ${formatPersen(titik[titik.length - 1].kumulatif, 1)} laba`;

  return {
    titik,
    ambang: AMBANG_KONSENTRASI,
    jumlahMencapaiAmbang: mencapai,
    judul,
    aria: `${judul}. SKU teratas ${teratas.nama} menyumbang ${formatRupiah(teratas.kontribusi)}, dan ${titik.length} SKU yang digambar bersama-sama menyumbang ${formatPersen(titik[titik.length - 1].kumulatif, 1)} dari total laba.`,
    kurang,
  };
}

// ── Chart 2: tren harian ────────────────────────────────────────────────────

/** Metrik yang bisa dipilih di grafik tren. Rasio tidak boleh dicampur dengan rupiah. */
export type MetrikTren = "omzet" | "laba" | "margin" | "order";

export type TitikTren = {
  tanggal: string;
  /** Dua digit hari untuk sumbu X — label penuh tetap di tooltip. */
  hari: string;
  /** null = hari itu tidak punya snapshot. BUKAN nol. */
  nilai: number | null;
  /**
   * Nilai untuk garis UTAMA: null bila hari itu parsial. Hari setengah jadi yang
   * disambungkan ke garis penuh akan terbaca sebagai penurunan penjualan yang tidak
   * pernah terjadi — persis kesalahan yang ingin dicegah penanda parsial.
   */
  nilaiPenuh: number | null;
  /** Nilai untuk seri terpisah bergaya putus-putus + titik berlubang. */
  nilaiParsial: number | null;
  /** Hari tidak utuh: digambar berbeda dan dikecualikan dari delta. */
  parsial: boolean;
};

export type DataTren = {
  titik: TitikTren[];
  metrik: MetrikTren;
  judul: string;
  aria: string;
  kurang: string[];
  /** Perubahan antar dua hari PENUH terakhir. null bila belum ada dua hari penuh. */
  deltaTerakhir: { selisih: number; persen: number | null } | null;
};

const LABEL_METRIK: Record<MetrikTren, string> = {
  omzet: "Omzet",
  laba: "Laba",
  margin: "Margin",
  order: "Pesanan",
};

function nilaiMetrik(t: { omzet: number; laba: number; marginPersen: number | null; jmlOrder: number }, m: MetrikTren): number | null {
  if (m === "omzet") return t.omzet;
  if (m === "laba") return t.laba;
  if (m === "order") return t.jmlOrder;
  return t.marginPersen;
}

/**
 * Data grafik tren untuk satu metrik.
 *
 * Hari parsial TETAP digambar (angkanya benar untuk order yang ada) tetapi diberi tanda dan
 * TIDAK dipakai menghitung delta: membandingkan hari setengah jadi dengan hari penuh
 * menghasilkan "penjualan turun 60%" yang tidak pernah terjadi.
 */
export function dataTren(seri: ({ tanggal: string; omzet: number; laba: number; marginPersen: number | null; jmlOrder: number; parsial?: boolean | null } | null)[], metrik: MetrikTren): DataTren {
  const kurang: string[] = [];
  const titik: TitikTren[] = seri.map((t) => {
    const nilai = t ? nilaiMetrik(t, metrik) : null;
    const parsial = t?.parsial === true;
    return {
      tanggal: t?.tanggal ?? "",
      hari: (t?.tanggal ?? "").slice(8, 10),
      nilai,
      nilaiPenuh: parsial ? null : nilai,
      nilaiParsial: parsial ? nilai : null,
      parsial,
    };
  });
  const berisi = titik.filter((t) => t.nilai !== null);
  const parsial = titik.filter((t) => t.parsial).length;
  if (parsial > 0) kurang.push(`${parsial} hari bertanda parsial — digambar, tetapi tidak dipakai menghitung perubahan`);
  const bolong = titik.length - berisi.length;
  if (bolong > 0) kurang.push(`${bolong} hari tanpa snapshot digambar sebagai celah, bukan nol`);

  const label = LABEL_METRIK[metrik];
  const penuh = titik.filter((t) => t.nilai !== null && !t.parsial);

  let deltaTerakhir: DataTren["deltaTerakhir"] = null;
  if (penuh.length >= 2) {
    const kini = penuh[penuh.length - 1].nilai as number;
    const lalu = penuh[penuh.length - 2].nilai as number;
    const selisih = Math.round((kini - lalu) * 100) / 100;
    const persen = lalu === 0 ? null : Math.round((selisih / Math.abs(lalu)) * 1000) / 10;
    deltaTerakhir = { selisih, persen };
  }

  let judul: string;
  if (berisi.length === 0) {
    judul = `Belum ada data ${label.toLowerCase()} pada rentang ini`;
  } else if (berisi.length === 1) {
    judul = `Baru satu hari berdata — ${label.toLowerCase()} belum bisa dibandingkan`;
    kurang.push("Butuh lebih dari 1 periode untuk melihat tren");
  } else if (deltaTerakhir === null) {
    judul = `Tren ${label.toLowerCase()} pada ${berisi.length} hari berdata`;
    kurang.push("Belum ada dua hari penuh yang bisa dibandingkan");
  } else if (deltaTerakhir.selisih === 0) {
    judul = `${label} terakhir sama dengan hari sebelumnya`;
  } else {
    const arah = deltaTerakhir.selisih > 0 ? "naik" : "turun";
    const besaran = deltaTerakhir.persen === null
      ? `${Math.abs(deltaTerakhir.selisih)}`
      : `${Math.abs(deltaTerakhir.persen)}%`;
    judul = `${label} ${arah} ${besaran} dibanding hari penuh sebelumnya`;
  }

  const aria = berisi.length === 0
    ? `${judul}. Tidak ada titik yang bisa dibacakan.`
    : `${judul}. ${berisi.length} hari berdata dari ${titik.length} hari pada rentang; ${parsial} hari parsial.`;

  return { titik, metrik, judul, aria, kurang, deltaTerakhir };
}

// ── Chart 3: penggerak delta laba ───────────────────────────────────────────

export type Penggerak = {
  sku: string;
  nama: string;
  /** Selisih kontribusi laba (sekarang − pembanding). Boleh negatif. */
  selisih: number;
  /** Kontribusi pada periode kini, untuk konteks. */
  sekarang: number;
  /** Kontribusi pada periode pembanding. */
  sebelum: number;
};

export type DataPenggerak = {
  naik: Penggerak[];
  turun: Penggerak[];
  /** Selisih laba total antar dua periode. null bila pembanding tidak ada. */
  selisihTotal: number | null;
  judul: string;
  aria: string;
  kurang: string[];
};

/**
 * Siapa yang menggerakkan perubahan laba antar dua periode.
 *
 * KENAPA berdasarkan LABa, bukan omzet: SKU bisa menaikkan omzet sambil menurunkan laba
 * (diskon besar). Mengurut berdasarkan omzet akan menyorot produk yang justru merugikan.
 *
 * Tanpa pembanding (`sebelum` kosong), yang ditampilkan adalah penyumbang laba teratas —
 * bukan daftar kosong: pembaca tetap butuh tahu siapa penopang labanya.
 */
export function dataPenggerak(sekarang: BarisSku[], sebelum: BarisSku[] | null, n = 8): DataPenggerak {
  const kurang: string[] = [];
  const petaSebelum = new Map(sebelum?.map((b) => [b.sku, b]) ?? []);
  const semua = new Map<string, Penggerak>();
  for (const b of sekarang) {
    const lama = petaSebelum.get(b.sku);
    semua.set(b.sku, {
      sku: b.sku,
      nama: b.nama ?? b.sku,
      selisih: lama ? b.kontribusi - lama.kontribusi : b.kontribusi,
      sekarang: b.kontribusi,
      sebelum: lama?.kontribusi ?? 0,
    });
  }
  // SKU yang HILANG dari periode kini tetapi punya kontribusi sebelumnya = penurunan.
  // Tanpa ini, produk yang berhenti terjual tidak muncul di daftar "turun" sama sekali.
  for (const b of sebelum ?? []) {
    if (semua.has(b.sku)) continue;
    semua.set(b.sku, {
      sku: b.sku, nama: b.nama ?? b.sku,
      selisih: -b.kontribusi, sekarang: 0, sebelum: b.kontribusi,
    });
  }

  const daftar = [...semua.values()];
  if (sebelum === null) {
    kurang.push("Belum ada periode pembanding — yang ditampilkan adalah penyumbang laba teratas, bukan perubahan");
    const atas = daftar.filter((p) => p.sekarang > 0).sort((a, b) => b.sekarang - a.sekarang).slice(0, Math.max(n, 12));
    return {
      naik: atas, turun: [], selisihTotal: null,
      judul: atas.length === 0 ? "Belum ada SKU yang menyumbang laba" : `${atas.length} SKU penyumbang laba teratas`,
      aria: atas.length === 0
        ? "Belum ada SKU yang menyumbang laba pada periode ini."
        : `${atas.length} SKU penyumbang laba teratas, terbesar ${atas[0].nama} dengan ${formatRupiah(atas[0].sekarang)}.`,
      kurang,
    };
  }

  const naik = daftar.filter((p) => p.selisih > 0).sort((a, b) => b.selisih - a.selisih).slice(0, n);
  const turun = daftar.filter((p) => p.selisih < 0).sort((a, b) => a.selisih - b.selisih).slice(0, n);
  const selisihTotal = daftar.reduce((a, p) => a + p.selisih, 0);
  const hilang = daftar.filter((p) => p.sekarang === 0 && p.sebelum !== 0).length;
  if (hilang > 0) kurang.push(`${hilang} SKU tidak muncul lagi di periode ini — dihitung sebagai penurunan`);

  const teratas = naik[0];
  const judul = teratas
    ? `${teratas.nama} menaikkan laba ${formatRupiahRingkas(teratas.selisih)}; ${turun.length} SKU menurunkan`
    : turun.length > 0
      ? `Tidak ada SKU yang menaikkan laba; ${turun.length} SKU menurunkan`
      : "Laba per SKU tidak berubah antar dua periode";

  return {
    naik, turun, selisihTotal, judul,
    aria: `${judul}. Total selisih laba ${formatRupiah(selisihTotal)}.`,
    kurang,
  };
}

// ── Chart 5: funnel organik ─────────────────────────────────────────────────

export type TahapFunnel = {
  kunci: "dilihat" | "kunjungan" | "keranjang" | "pesanan";
  label: string;
  /** null = data tahap ini tidak ada; BUKAN nol. */
  nilai: number | null;
  /** Persentase terhadap tahap sebelumnya. null bila tahap sebelumnya 0/tidak ada. */
  persenDariSebelum: number | null;
};

export type DataFunnel = {
  tahap: TahapFunnel[];
  judul: string;
  aria: string;
  kurang: string[];
};

/**
 * Funnel organik: dilihat → kunjungan → keranjang → pesanan.
 *
 * Sumbernya `organik*` (halaman produk TANPA iklan). Mencampurnya dengan `dilihat`/`klik`
 * iklan akan menuduh iklan atas masalah halaman, atau sebaliknya.
 *
 * `baris` boleh satu SKU (level SKU) atau seluruh daftar (level toko): penjumlahannya
 * dilakukan di sini, bukan di komponen.
 */
export function dataFunnel(baris: BarisSku[]): DataFunnel {
  const kurang: string[] = [];
  const jumlah = (pilih: (b: BarisSku) => number | null): number | null => {
    let total = 0;
    let ada = false;
    for (const b of baris) {
      const v = pilih(b);
      if (v === null) continue;
      total += v;
      ada = true;
    }
    return ada ? total : null;
  };
  const dilihat = jumlah((b) => b.organikDilihat);
  const kunjungan = jumlah((b) => b.organikKunjungan);
  const keranjang = jumlah((b) => b.organikKeranjang);
  const pesanan = jumlah((b) => b.organikPesanan);

  const tahap: TahapFunnel[] = [
    { kunci: "dilihat", label: "Dilihat", nilai: dilihat, persenDariSebelum: null },
    { kunci: "kunjungan", label: "Kunjungan", nilai: kunjungan, persenDariSebelum: null },
    { kunci: "keranjang", label: "Keranjang", nilai: keranjang, persenDariSebelum: null },
    { kunci: "pesanan", label: "Pesanan", nilai: pesanan, persenDariSebelum: null },
  ];
  for (let i = 1; i < tahap.length; i++) {
    const kini = tahap[i].nilai;
    const lalu = tahap[i - 1].nilai;
    // Pembagi nol → null, bukan Infinity. Tahap kosong tidak bisa dihitung rasionya.
    tahap[i].persenDariSebelum = kini === null || lalu === null || lalu <= 0
      ? null
      : Math.round((kini / lalu) * 1000) / 10;
  }

  if (dilihat === null && kunjungan === null) {
    kurang.push("Data Performa Produk belum diimpor — funnel organik belum bisa dihitung");
  } else {
    // Tahap yang paling banyak kehilangan pembeli adalah kesimpulan funnel-nya.
    const putus = tahap.slice(1).filter((t) => t.persenDariSebelum !== null);
    if (putus.length === 0) kurang.push("Belum ada dua tahap berurutan yang punya data");
  }

  const putus = tahap.slice(1).filter((t) => t.persenDariSebelum !== null);
  const terburuk = putus.length > 0
    ? putus.reduce((a, b) => ((a.persenDariSebelum ?? 100) <= (b.persenDariSebelum ?? 100) ? a : b))
    : null;

  const judul = terburuk === null
    ? "Funnel organik belum bisa dihitung"
    : `Pembeli paling banyak hilang di tahap ${terburuk.label} (${formatPersen(terburuk.persenDariSebelum, 1)} lanjut)`;

  return {
    tahap, judul,
    aria: terburuk === null
      ? `${judul}. Data tahap organik belum lengkap.`
      : `${judul}. Dilihat ${dilihat ?? 0}, kunjungan ${kunjungan ?? 0}, keranjang ${keranjang ?? 0}, pesanan ${pesanan ?? 0}.`,
    kurang,
  };
}

// ── Chart 6: peta peluang ───────────────────────────────────────────────────

export type TitikPeluang = {
  sku: string;
  nama: string;
  /** Kunjungan organik (sumbu X, skala log). */
  x: number;
  /** CR organik % (sumbu Y). */
  y: number;
  /** Omzet (ukuran titik). */
  ukuran: number;
  tag: string[];
};

export type DataPeluang = {
  titik: TitikPeluang[];
  /** Rata-rata CR toko, digambar sebagai garis mendatar. null bila tidak ada data. */
  crRata: number | null;
  /** Rata-rata kunjungan, digambar sebagai garis tegak. null bila tidak ada data. */
  kunjunganRata: number | null;
  judul: string;
  aria: string;
  kurang: string[];
};

/** Batas titik: 90 teratas menurut kunjungan. Di atas itu titik saling menutupi. */
export const MAKS_TITIK_PELUANG = 90;

/**
 * Peta peluang: x = kunjungan organik (log), y = CR organik, ukuran = omzet.
 *
 * Garis rata-rata membagi peta menjadi empat kuadran yang bisa dibaca tanpa legenda:
 * kanan-bawah = banyak yang datang, sedikit yang beli (perbaiki halaman);
 * kiri-atas = sedikit yang datang, banyak yang beli (layak didorong).
 *
 * Hanya SKU yang punya KEDUA angka yang digambar: titik dengan x atau y null akan jatuh di
 * sumbu dan terbaca sebagai "kunjungan nol", yang tidak benar.
 */
export function dataPeluang(baris: BarisSku[], tagPeta?: Map<string, string[]>): DataPeluang {
  const kurang: string[] = [];
  const calon = baris
    .filter((b) => b.organikKunjungan !== null && b.organikKunjungan > 0 && b.organikPesanan !== null)
    .map((b) => {
      const cr = Math.round(((b.organikPesanan as number) / (b.organikKunjungan as number)) * 10000) / 100;
      return {
        sku: b.sku,
        nama: b.nama ?? b.sku,
        x: b.organikKunjungan as number,
        y: cr,
        ukuran: b.organikOmzet ?? 0,
        tag: tagPeta?.get(b.sku) ?? [],
      };
    })
    .sort((a, b) => b.x - a.x);

  const dibuang = calon.length - Math.min(calon.length, MAKS_TITIK_PELUANG);
  const titik = calon.slice(0, MAKS_TITIK_PELUANG);
  if (dibuang > 0) kurang.push(`${dibuang} SKU berkunjungan terkecil tidak digambar agar titik tidak bertumpuk`);
  if (titik.length === 0) kurang.push("Belum ada SKU dengan kunjungan dan pesanan organik — impor Performa Produk dulu");

  // Rata-rata memakai SELURUH SKU berdata, bukan hanya yang digambar: garis pembagi harus
  // mewakili toko, bukan subset yang kebetulan muat di layar.
  const semuaCr = calon.map((t) => t.y);
  const crRata = semuaCr.length > 0 ? Math.round((semuaCr.reduce((a, v) => a + v, 0) / semuaCr.length) * 100) / 100 : null;
  const kunjunganRata = calon.length > 0
    ? Math.round(calon.reduce((a, t) => a + t.x, 0) / calon.length)
    : null;

  const kananBawah = titik.filter((t) => crRata !== null && kunjunganRata !== null && t.x >= kunjunganRata && t.y < crRata).length;
  const judul = titik.length === 0
    ? "Belum ada titik yang bisa dipetakan"
    : kananBawah > 0
      ? `${kananBawah} SKU ramai dikunjungi tetapi konversinya di bawah rata-rata toko`
      : `${titik.length} SKU dipetakan; tidak ada yang ramai-tapi-tidak-laku`;

  return {
    titik, crRata, kunjunganRata, judul,
    aria: `${judul}. Sumbu mendatar kunjungan organik (skala log), sumbu tegak CR organik persen.`,
    kurang,
  };
}

// ── Chart 7: ROAS vs impas per SKU ──────────────────────────────────────────

export type BarisRoas = {
  sku: string;
  nama: string;
  roasAktual: number | null;
  roasLangsung: number | null;
  roasImpas: number | null;
  /** "aman" = ≥ impas, "rugi" = < impas, "tidak_dinilai" = data kurang. */
  status: "aman" | "rugi" | "tidak_dinilai";
};

export type DataRoas = {
  baris: BarisRoas[];
  judul: string;
  aria: string;
  kurang: string[];
};

/**
 * ROAS aktual vs titik impas PER SKU.
 *
 * Titik impas dihitung dari margin SKU itu sendiri (`roasImpas`), bukan satu margin toko:
 * produk bermargin 40% dan 5% tidak punya titik impas yang sama, dan memakai rata-rata
 * toko akan menyebut produk bermargin tipis "aman" padahal ia rugi.
 *
 * Status `tidak_dinilai` dipakai saat impas null (margin ≤ 0) atau ROAS null — bukan
 * dianggap aman.
 */
export function dataRoas(baris: BarisSku[]): DataRoas {
  const kurang: string[] = [];
  const beriklan = baris.filter((b) => b.biayaIklan !== null && b.biayaIklan > 0);
  if (beriklan.length === 0) {
    kurang.push("Belum ada SKU yang punya biaya iklan pada periode ini");
  }
  const hasil: BarisRoas[] = beriklan
    .map((b) => {
      const status: BarisRoas["status"] =
        b.roasAktual === null || b.roasImpas === null
          ? "tidak_dinilai"
          : b.roasAktual >= b.roasImpas ? "aman" : "rugi";
      return {
        sku: b.sku, nama: b.nama ?? b.sku,
        roasAktual: b.roasAktual, roasLangsung: b.roasLangsung ?? null,
        roasImpas: b.roasImpas, status,
      };
    })
    // Yang rugi lebih dulu: chart ini dibaca untuk mencari masalah, bukan pujian.
    .sort((a, b) => {
      const urut = { rugi: 0, tidak_dinilai: 1, aman: 2 } as const;
      if (urut[a.status] !== urut[b.status]) return urut[a.status] - urut[b.status];
      return (a.roasAktual ?? 0) - (b.roasAktual ?? 0);
    });

  const rugi = hasil.filter((r) => r.status === "rugi").length;
  const tidakDinilai = hasil.filter((r) => r.status === "tidak_dinilai").length;
  if (tidakDinilai > 0) kurang.push(`${tidakDinilai} SKU tidak bisa dinilai (margin ≤ 0 atau biaya iklan nol)`);

  const judul = hasil.length === 0
    ? "Belum ada iklan yang bisa dibandingkan dengan titik impas"
    : rugi > 0
      ? `${rugi} dari ${hasil.length} SKU beriklan masih di bawah titik impas`
      : `Semua ${hasil.length} SKU beriklan sudah melewati titik impas`;

  return {
    baris: hasil, judul,
    aria: `${judul}. Titik impas dihitung dari margin masing-masing SKU.`,
    kurang,
  };
}

// ── Chart 8: stok vs kontribusi ─────────────────────────────────────────────

export type TitikStok = {
  sku: string;
  nama: string;
  /** Stok fisik lintas gudang non-ONLINE. */
  stok: number;
  /** Unit terjual pada periode yang dipilih. */
  unit: number;
  /** Proyeksi hari sampai stok habis. null = tidak terjual, jadi tidak bisa diproyeksikan. */
  hariTersisa: number | null;
  kontribusi: number;
};

export type DataStok = {
  titik: TitikStok[];
  /** Ambang hari untuk penanda kritis — sama dengan badge `stok_kritis` (temuan). */
  ambangKritis: number;
  judul: string;
  aria: string;
  kurang: string[];
};

/** Ambang hari stok tersisa untuk disebut "kritis". */
export const AMBANG_HARI_STOK_KRITIS = 3;

/**
 * Chart 8: penyumbang laba mana yang stoknya paling cepat habis.
 *
 * KENAPA memakai HARI TERSISA, bukan jumlah stok: stok 50 unit berarti "aman" untuk produk
 * yang terjual 2/hari dan "habis besok" untuk yang terjual 40/hari. Angka stok mentah
 * memaksa pembaca membaginya sendiri, dan itulah yang membuat panel stok jarang dibaca.
 *
 * `hariTersisa` memakai `unit` periode sebagai laju harian. Untuk snapshot satu hari itu
 * tepat; untuk periode lebih panjang angkanya mewakili rata-rata periode, dan itu disebut
 * di judul agar tidak dibaca sebagai laju hari ini.
 */
export function dataStokKontribusi(baris: BarisSku[]): DataStok {
  const kurang: string[] = [];
  const adaStok = baris.filter((b) => b.stok !== null);
  if (adaStok.length === 0) {
    kurang.push("Data stok tidak tersedia — halaman ini tidak bisa memproyeksikan hari stok tersisa");
    return {
      titik: [], ambangKritis: AMBANG_HARI_STOK_KRITIS,
      judul: "Data stok belum ada",
      aria: "Data stok belum ada, jadi tidak ada yang bisa diproyeksikan.",
      kurang,
    };
  }

  const penyumbang = adaStok.filter((b) => b.kontribusi > 0);
  const tanpaPenjualan = penyumbang.filter((b) => b.unit <= 0).length;
  if (tanpaPenjualan > 0) {
    kurang.push(`${tanpaPenjualan} SKU penyumbang laba tidak terjual pada periode ini — hari tersisa tidak bisa diproyeksikan`);
  }

  const titik: TitikStok[] = penyumbang
    .filter((b) => b.unit > 0)
    .map((b) => ({
      sku: b.sku,
      nama: b.nama ?? b.sku,
      stok: b.stok as number,
      unit: b.unit,
      // Pembagi nol sudah disaring di atas; stok boleh negatif (catatan lebih kecil dari
      // penjualan) dan itu DITAMPILKAN apa adanya, bukan dipotong ke nol.
      hariTersisa: Math.round(((b.stok as number) / b.unit) * 10) / 10,
      kontribusi: b.kontribusi,
    }))
    .sort((a, b) => b.kontribusi - a.kontribusi);

  const kritis = titik.filter((t) => t.hariTersisa !== null && t.hariTersisa <= AMBANG_HARI_STOK_KRITIS);
  const judul = titik.length === 0
    ? "Tidak ada penyumbang laba yang bisa diproyeksikan stoknya"
    : kritis.length > 0
      ? `${kritis.length} SKU penyumbang laba habis dalam ${AMBANG_HARI_STOK_KRITIS} hari atau kurang`
      : `${titik.length} SKU penyumbang laba stoknya masih di atas ${AMBANG_HARI_STOK_KRITIS} hari`;

  return {
    titik, ambangKritis: AMBANG_HARI_STOK_KRITIS, judul,
    aria: `${judul}. Hari tersisa = stok dibagi unit terjual pada periode ini.`,
    kurang,
  };
}
