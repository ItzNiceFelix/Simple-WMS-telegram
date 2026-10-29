// lib/analisa/tag.ts — Label keadaan satu SKU. MURNI: tanpa DB, tanpa React.
//
// KENAPA dipisah dari `hitung.ts`: `hitung` menjawab "berapa angkanya", `tag` menjawab
// "apa artinya bagi saya". Dua pertanyaan berbeda, dan mencampurnya membuat setiap
// penyesuaian ambang menyentuh rumus uang.
//
// SEMUA AMBANG RELATIF TERHADAP TOKO SENDIRI. Toko kecil dan toko besar tidak bisa dinilai
// dengan angka mutlak yang sama: kunjungan 500/hari bisa "banyak" di satu toko dan "sepi"
// di toko lain. Satu-satunya ambang mutlak di sini adalah `AMBANG_MARGIN_TIPIS`, yang
// memang sudah diputuskan pemilik (10%) dan dipakai juga oleh `buatTemuan`.
import type { BarisSku, Tag } from "./tipe";
import { ambangCtrToko, keputusanIklan, AMBANG_MARGIN_TIPIS } from "./hitung";

/** Kontribusi laba ≥ 5% dari total laba = penopang toko. */
export const AMBANG_BINTANG_PERSEN = 5;

/** Kunjungan ≥ persentil-75 dianggap "banyak" — seperempat produk teratas toko ini. */
export const AMBANG_PERSENTIL_KUNJUNGAN = 75;

/** CR organik di bawah 0,5× CR toko = pengunjung datang tapi tidak jadi beli. */
export const AMBANG_CR_BOROS = 0.5;

/** CR organik di atas 1,5× CR toko = halaman ini menjual lebih baik daripada rata-rata. */
export const AMBANG_CR_POTENSI = 1.5;

/** Pesanan ÷ keranjang di bawah 0,6× rasio toko = pembeli berhenti di checkout. */
export const AMBANG_KERANJANG_BOCOR = 0.6;

/**
 * Persentil dengan metode nearest-rank: nilai terkecil yang ≥ p% data.
 * Kosong → null (bukan 0): "tidak ada data" dan "nilainya nol" adalah dua hal berbeda.
 */
export function persentil(nilai: number[], p: number): number | null {
  if (nilai.length === 0) return null;
  const urut = [...nilai].sort((a, b) => a - b);
  const pangkat = Math.min(100, Math.max(0, p));
  // nearest-rank: ceil(p/100 × n) - 1, dijepit ke indeks sah.
  const idx = Math.min(urut.length - 1, Math.max(0, Math.ceil((pangkat / 100) * urut.length) - 1));
  return urut[idx];
}

/**
 * Konteks toko yang dipakai sebagai pembanding. Dihitung dari SKU yang PUNYA data saja —
 * memasukkan SKU tanpa data Performa Produk ke penyebut akan menurunkan CR toko dan membuat
 * hampir semua produk tampak "berpotensi".
 */
export type KonteksToko = {
  /** Σ kontribusi seluruh SKU (boleh negatif bila toko rugi). */
  totalLaba: number;
  /** Σ pesanan organik ÷ Σ kunjungan organik × 100. null bila tidak ada kunjungan. */
  crToko: number | null;
  /** Σ pesanan organik ÷ Σ keranjang organik. null bila tidak ada keranjang. */
  rasioKeranjangToko: number | null;
  /** Persentil-75 kunjungan organik antar SKU yang punya data. null bila tidak ada. */
  kunjunganP75: number | null;
  /** Median kunjungan organik. null bila tidak ada. */
  kunjunganMedian: number | null;
};

export function konteksToko(baris: BarisSku[]): KonteksToko {
  const totalLaba = baris.reduce((a, b) => a + b.kontribusi, 0);
  const adaKunjungan = baris.filter(
    (b): b is BarisSku & { organikKunjungan: number } => b.organikKunjungan !== null && b.organikKunjungan > 0
  );
  const kunjungan = adaKunjungan.map((b) => b.organikKunjungan);
  const kunjunganTotal = kunjungan.reduce((a, n) => a + n, 0);
  const pesananTotal = adaKunjungan.reduce((a, b) => a + (b.organikPesanan ?? 0), 0);
  const keranjangTotal = adaKunjungan.reduce((a, b) => a + (b.organikKeranjang ?? 0), 0);
  return {
    totalLaba,
    crToko: kunjunganTotal > 0 ? Math.round((pesananTotal / kunjunganTotal) * 10000) / 100 : null,
    rasioKeranjangToko: keranjangTotal > 0 ? Math.round((pesananTotal / keranjangTotal) * 100) / 100 : null,
    kunjunganP75: persentil(kunjungan, AMBANG_PERSENTIL_KUNJUNGAN),
    kunjunganMedian: persentil(kunjungan, 50),
  };
}

/**
 * Label untuk SEMUA SKU, dalam satu Map. Satu SKU boleh punya beberapa label; urutannya
 * tetap (bintang dulu) supaya badge tidak berpindah posisi antar render.
 *
 * Ambang "stok kritis" SENGAJA sama dengan temuan `stok_tipis_penyumbang`: dua definisi
 * "stok tipis" di satu halaman akan membuat badge bilang aman sementara temuan bilang kritis.
 */
export function tagProduk(baris: BarisSku[], konteks: KonteksToko = konteksToko(baris)): Map<string, Tag[]> {
  const hasil = new Map<string, Tag[]>();
  const crToko = konteks.crToko;
  const rasioKeranjang = konteks.rasioKeranjangToko;

  for (const b of baris) {
    const tag: Tag[] = [];

    // 1. Bintang: penyumbang laba besar. Dihitung terhadap TOTAL laba toko, jadi toko yang
    //    labanya tipis tidak tiba-tiba punya sepuluh "bintang" hanya karena angkanya kecil.
    if (konteks.totalLaba > 0 && b.kontribusi >= (AMBANG_BINTANG_PERSEN / 100) * konteks.totalLaba) {
      tag.push("bintang");
    }

    // 2. Merugi: margin per unit negatif. Tidak butuh konteks — rugi ya rugi.
    if (b.marginSatuan < 0) tag.push("merugi");
    // 3. Margin tipis: hanya untuk yang belum merugi, supaya satu SKU tidak diberi dua label
    //    yang saling bertentangan ("merugi" dan "margin tipis" sekaligus).
    else if (b.marginPersen < AMBANG_MARGIN_TIPIS) tag.push("margin_tipis");

    // 4. HPP naik sejak snapshot: margin sebenarnya lebih jelek dari yang terlihat.
    if (b.hppNaik > 0) tag.push("hpp_naik");

    // 5. Stok kritis: penyumbang laba yang stoknya lebih kecil dari setengah yang terjual.
    if (b.stok !== null && b.kontribusi > 0 && b.stok < b.unit * 0.5) tag.push("stok_kritis");

    // 6–8. Label organik. Semua butuh data Performa Produk; tanpa itu, tidak ada label —
    //      bukan label "aman". Menandai "aman" tanpa data adalah klaim yang tidak berdasar.
    const cr = b.organikKunjungan !== null && b.organikKunjungan > 0 && b.organikPesanan !== null
      ? (b.organikPesanan / b.organikKunjungan) * 100
      : null;

    if (cr !== null && crToko !== null && konteks.kunjunganP75 !== null) {
      // Boros tayangan: banyak yang datang, sedikit yang beli.
      if (b.organikKunjungan !== null && b.organikKunjungan >= konteks.kunjunganP75 && cr < AMBANG_CR_BOROS * crToko) {
        tag.push("boros_tayangan");
      }
      // Potensi: konversinya bagus, tapi trafiknya masih di bawah median — DAN marginnya
      // sehat. Menambah trafik ke SKU bermargin tipis hanya memperbesar kerugian, jadi
      // syarat margin ikut menentukan, bukan sekadar "CR bagus".
      const marginSehat = b.marginPersen >= AMBANG_MARGIN_TIPIS && b.marginSatuan > 0;
      const trafikRendah = konteks.kunjunganMedian !== null && b.organikKunjungan !== null
        && b.organikKunjungan < konteks.kunjunganMedian;
      if (cr > AMBANG_CR_POTENSI * crToko && trafikRendah && marginSehat) tag.push("potensi");
    }

    // Bocor keranjang: sudah masuk keranjang, tidak jadi pesanan.
    if (b.organikKeranjang !== null && b.organikKeranjang > 0 && b.organikPesanan !== null) {
      const rasioSku = b.organikPesanan / b.organikKeranjang;
      if (rasioKeranjang !== null && rasioSku < AMBANG_KERANJANG_BOCOR * rasioKeranjang) tag.push("bocor_keranjang");
    }

    if (tag.length > 0) hasil.set(b.sku, tag);
  }

  return hasil;
}

/**
 * Salinan baris dengan label DAN putusan iklan terpasang. Dipakai lapisan server supaya
 * `hitung.ts` tetap tidak tahu apa-apa soal tag, dan supaya halaman tidak pernah menghitung
 * ulang keputusan dengan ambang yang berbeda dari yang dipakai panel Keputusan.
 */
export function lengkapiTag(baris: BarisSku[]): BarisSku[] {
  const peta = tagProduk(baris);
  // Ambang dihitung SEKALI untuk seluruh toko: keputusan satu SKU bergantung pada median
  // toko, jadi menghitungnya per baris akan menghasilkan ambang yang berbeda-beda.
  const ambang = ambangCtrToko(baris) ?? undefined;
  return baris.map((b) => {
    const tag = peta.get(b.sku);
    const putusan = keputusanIklan(b, ambang);
    return { ...b, ...(tag ? { tag } : {}), keputusanIklan: putusan };
  });
}

/** Label manusia untuk satu tag — dipakai badge UI dan teks tombol. */
export const LABEL_TAG: Record<Tag, string> = {
  bintang: "Bintang",
  boros_tayangan: "Boros tayangan",
  bocor_keranjang: "Bocor keranjang",
  potensi: "Potensi",
  merugi: "Merugi",
  margin_tipis: "Margin tipis",
  hpp_naik: "HPP naik",
  stok_kritis: "Stok kritis",
};
