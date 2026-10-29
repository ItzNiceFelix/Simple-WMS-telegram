// lib/analisa/skenarioIklan.ts — Paket skenario iklan. FUNGSI MURNI, tanpa DB/fetch.
//
// Kenapa ada: pemilik toko tidak bertanya "berapa ROAS saya", ia bertanya "lalu saya
// harus apa?". Pertanyaan itu butuh rencana BERTAHAP untuk tiga keadaan yang mungkin
// terjadi pada hari ke-N — bukan satu jawaban generik.
//
// ATURAN YANG MENGIKAT:
//   * Seluruh ANGKA di paket ini dihitung di sini dari data nyata. AI menerima paket
//     INI apa adanya; ia TIDAK diberi izin mengarang angka. Kalau AI butuh angka yang
//     tidak ada di paket, ia harus menyatakan datanya belum ada — bukan menebak.
//   * Ambang diambil dari hitung.ts (AMBANG_CTR_SEHAT, AMBANG_DILIHAT_MIN), TIDAK
//     ditulis ulang di berkas ini. Satu sumber angka, satu tempat mengubahnya.
//   * Fungsi ini tidak mengakses DB dan tidak memanggil fetch: keputusan uang harus
//     bisa diuji tanpa jaringan.

import { AMBANG_CTR_SEHAT, AMBANG_DILIHAT_MIN, ambangCtrToko, keputusanIklan } from "./hitung";
import type { BarisSku } from "./tipe";

/** Satu skenario siap dibacakan AI: pemicu berangka + langkah berurutan. */
export type SkemaSkenario = {
  /** Kunci stabil untuk UI dan untuk AI merujuk skenario tertentu. */
  id: string;
  judul: string;
  /** Pemicu dengan ANGKA, mis. "saat ROAS < 3.1 selama 2 hari". */
  kapan: string;
  /** Angka pendukung skenario ini, sudah diformat rapi. */
  angka: string[];
  /** Langkah KONKRET dan berurutan; bukan imbauan umum. */
  langkah: string[];
};

/** Paket lengkap untuk AI: fakta terukur + tiga skenario bertahap. */
export type PaketSkenario = { fakta: string[]; skenario: SkemaSkenario[] };

/** Masukan paket skenario — semuanya eksplisit, tidak ada yang diambil diam-diam. */
export type MasukanSkenario = {
  /** Hari ke-N yang disebut user: "kalau hari ke-N ROAS anjlok, saya harus apa?". */
  hariKe: number;
  /** Baris SKU dari hitung.ts (bukan data mentah). */
  baris: BarisSku[];
  /** Total biaya iklan periode ini. */
  modalIklan: number;
  /** Target ROAS yang dikejar pemilik toko. */
  targetRoas: number;
};

/** Berapa hari sebuah keadaan harus bertahan sebelum dinilai; di bawah 1000 tayangan masih menebak. */
const HARI_TUNGGU = 2;

/** Batas SKU yang disebut per daftar supaya paket tidak membengkak. */
const MAKS_SEBUT = 5;

/** Ambang tayangan diformat sekali di sini: UI, AI, dan uji memakai bentuk angka yang sama. */
const TAYANGAN_MIN_RAPI = AMBANG_DILIHAT_MIN.toLocaleString("id-ID");

/**
 * Format rupiah dengan titik ribuan: 1234567 → "Rp 1.234.567".
 * Dibulatkan ke rupiah penuh karena sen tidak mengubah keputusan iklan.
 */
export function rupiah(n: number): string {
  const bulat = Math.round(n);
  const tanda = bulat < 0 ? "-" : "";
  const digit = String(Math.abs(bulat)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${tanda}Rp ${digit}`;
}

/** Kelompokkan baris yang punya titik impas. Urutan diserahkan ke pemanggil. */
const denganImpas = (baris: BarisSku[]): BarisSku[] => baris.filter((b) => b.roasImpas !== null);

/**
 * Bangun paket skenario dari data nyata.
 * Selalu mengembalikan TIGA skenario (anjlok/bagus/stagnan), termasuk saat data kosong —
 * supaya AI tidak pernah menerima daftar kosong dan mulai mengarang keadaan sendiri.
 * Saat data kosong, `fakta` MENYATAKAN bahwa datanya belum ada dan langkahnya berisi
 * yang bisa dilakukan tanpa angka.
 */
export function bangunPaketSkenario(m: MasukanSkenario): PaketSkenario {
  const baris = m.baris ?? [];
  const hariKe = m.hariKe;
  const impas = denganImpas(baris);
  const nominal = impas.map((b) => b.roasImpas as number);
  const impasMin = nominal.length > 0 ? Math.min(...nominal) : null;
  const impasMaks = nominal.length > 0 ? Math.max(...nominal) : null;
  const impasRata =
    nominal.length > 0
      ? Math.round((nominal.reduce((a, b) => a + b, 0) / nominal.length) * 100) / 100
      : null;

  const teraman = [...impas].sort((a, b) => (a.roasImpas as number) - (b.roasImpas as number));
  const terboros = [...impas].sort((a, b) => (b.roasImpas as number) - (a.roasImpas as number));

  const fakta = susunFakta(m, impas, impasMin, impasMaks, impasRata, teraman, terboros);

  const patokan = impasRata ?? impasMin;
  const kapanTeks = (tanda: string, tambahan: string): string =>
    patokan === null
      ? `Belum bisa dipatok: titik impas belum bisa dihitung karena belum ada SKU bermargin positif di data impor — ambang di bawah ini baru contoh, jangan dipakai memutuskan. ${tambahan}`
      : `saat ROAS ${tanda} ${patokan} selama ${HARI_TUNGGU} hari berturut-turut (titik impas rata-rata dari ${nominal.length} SKU bermargin positif). ${tambahan}`;

  const skenario: SkemaSkenario[] = [
    {
      id: "roas_anjlok",
      judul: `ROAS anjlok di bawah titik impas pada hari ke-${hariKe}`,
      kapan: kapanTeks("<", "Berarti setiap rupiah iklan menghasilkan penjualan lebih sedikit daripada biaya yang dikeluarkan."),
      angka: [
        patokan === null
          ? "Titik impas belum bisa dihitung: belum ada SKU bermargin positif di data."
          : `Titik impas yang dipakai sebagai patokan: ${patokan} (rata-rata ${nominal.length} SKU bermargin positif; terendah ${impasMin}, tertinggi ${impasMaks}).`,
        `Target ROAS yang diisi user: ${m.targetRoas} (asumsi user, bukan hitungan sistem). Target di bawah titik impas berarti target itu sendiri sudah merugi.`,
        `Modal iklan yang diisi user: ${rupiah(m.modalIklan)} (asumsi user, bukan hitungan sistem).`,
        impasMin === null
          ? "SKU paling aman diiklankan: belum ada."
          : `SKU paling aman (titik impas terendah): ${sebutSku(teraman.slice(0, MAKS_SEBUT))}.`,
      ],
      langkah: [
        `Hari ke-${hariKe} (hari kejadian): berhenti menaikkan tawaran. Jangan tambah modal di atas ${rupiah(m.modalIklan)}.`,
        `Periksa satu per satu SKU yang titik impasnya di atas ROAS aktual, mulai dari ${impasMaks === null ? "SKU dengan titik impas tertinggi" : `yang titik impasnya ${impasMaks}`}.`,
        `Matikan iklan untuk SKU ber-CTR di bawah ${AMBANG_CTR_SEHAT}% — di bawah ambang ini iklan tidak menarik klik.`,
        `Alihkan sisa modal ke SKU yang titik impasnya paling rendah (${impasMin === null ? "belum ada" : impasMin}), dan hanya bila tayangannya sudah lewat ${TAYANGAN_MIN_RAPI}.`,
        `Hari ke-${hariKe + HARI_TUNGGU}: hitung ulang ROAS. Masih di bawah titik impas → hentikan seluruh iklan periode ini.`,
      ],
    },
    {
      id: "roas_bagus",
      judul: `ROAS jauh di atas titik impas pada hari ke-${hariKe}`,
      kapan: kapanTeks(">=", "Berarti iklan sudah menutup biayanya dan menyumbang margin."),
      angka: [
        patokan === null
          ? "Titik impas belum bisa dihitung: belum ada SKU bermargin positif di data."
          : `Batas aman: ROAS minimal ${patokan}; di atas itu iklan tidak merugi.`,
        `Target ROAS yang diisi user: ${m.targetRoas}; modal iklan yang diisi user ${rupiah(m.modalIklan)} (keduanya asumsi user, bukan hitungan sistem).`,
        patokan === null
          ? "SKU layak didorong: belum ada."
          : `SKU layak didorong lebih dulu (titik impas terendah): ${sebutSku(teraman.slice(0, MAKS_SEBUT))}.`,
      ],
      langkah: [
        `Hari ke-${hariKe}: naikkan modal secara bertahap, satu langkah per ${HARI_TUNGGU} hari, bukan sekaligus.`,
        `Dorong lebih dulu SKU dengan titik impas paling rendah (${impasMin === null ? "belum ada" : impasMin}), karena marginnya paling tahan terhadap kenaikan biaya.`,
        `Pertahankan tawaran SKU yang CTR-nya sudah di atas ${AMBANG_CTR_SEHAT}% dan tayangannya di atas ${TAYANGAN_MIN_RAPI}.`,
        `Setelah kenaikan modal, periksa apakah ROAS masih di atas ${patokan === null ? "titik impas" : patokan}. Turun di bawah → kembali ke langkah skenario anjlok.`,
        `Catat waktu dan besar kenaikannya supaya penyebab kenaikan atau penurunan bisa ditelusuri.`,
      ],
    },
    {
      id: "roas_stagnan",
      judul: `ROAS naik-turun tipis di sekitar titik impas pada hari ke-${hariKe}`,
      kapan: kapanTeks("≈", "Naik-turun tipis di sekitar titik impas: belum jelas untung, belum jelas rugi."),
      angka: [
        patokan === null
          ? "Titik impas belum bisa dihitung: belum ada SKU bermargin positif di data."
          : `Rentang titik impas SKU di data: ${impasMin} sampai ${impasMaks} (rata-rata ${patokan}).`,
        `Ambang sampel: tayangan di bawah ${TAYANGAN_MIN_RAPI} belum bisa dinilai; CTR sehat minimal ${AMBANG_CTR_SEHAT}%.`,
        `SKU paling boros (titik impas tertinggi, hindari menambah tawaran): ${sebutSku(terboros.slice(0, MAKS_SEBUT))}.`,
      ],
      langkah: [
        `Hari ke-${hariKe}: jangan menambah modal dan jangan mematikan iklan — keduanya tindakan untuk keadaan yang jelas, sedangkan datanya belum jelas.`,
        `Periksa tayangan tiap SKU: di bawah ${TAYANGAN_MIN_RAPI}, tunggu sampai sampelnya cukup sebelum menilai.`,
        `Bila tayangan sudah cukup, perbaiki yang paling murah diperbaiki dulu: foto/judul produk, bukan tawarannya.`,
        `Hentikan iklan SKU yang titik impasnya tertinggi (${impasMaks === null ? "belum ada" : impasMaks}) bila setelah ${HARI_TUNGGU} hari tidak ada perbaikan.`,
        `Hari ke-${hariKe + HARI_TUNGGU}: potuskan masuk skenario anjlok atau bagus menurut hasil hitung ulang, bukan menurut perasaan.`,
      ],
    },
  ];

  return { fakta, skenario };
}

/** Sebut SKU beserta titik impasnya; "belum ada" bila daftarnya kosong. */
function sebutSku(daftar: BarisSku[]): string {
  if (daftar.length === 0) return "belum ada";
  return daftar
    .map((b) => `${b.sku}${b.nama ? ` ${b.nama}` : ""} (titik impas ${b.roasImpas})`)
    .join(", ");
}

/** Susun daftar fakta terukur dari data nyata; saat data kosong, katakan apa adanya. */
function susunFakta(
  m: MasukanSkenario,
  impas: BarisSku[],
  impasMin: number | null,
  impasMaks: number | null,
  impasRata: number | null,
  teraman: BarisSku[],
  terboros: BarisSku[]
): string[] {
  const baris = m.baris ?? [];
  // hariKe berasal dari form, bukan dari data: ditulis sebagai asumsi user supaya model
  // tidak memperlakukannya sebagai angka yang dihitung sistem.
  const fakta: string[] = [
    `Hari ke-${m.hariKe} (asumsi yang diisi user) dipakai sebagai titik penilaian.`,
  ];

  if (baris.length === 0) {
    fakta.push(
      "Belum ada data SKU untuk periode ini, jadi titik impas dan SKU paling boros belum bisa dihitung. " +
        "Impor data iklan dan Performa Produk dulu supaya skenario ini memakai angka nyata."
    );
    fakta.push(
      `Asumsi yang diisi user (BUKAN hasil hitung sistem): modal iklan ${rupiah(m.modalIklan)}, ` +
        `target ROAS ${m.targetRoas}, hari ke-${m.hariKe}.`
    );
    return fakta;
  }

  fakta.push(
    `Ada ${baris.length} SKU di data periode ini; ${impas.length} di antaranya sudah punya titik impas (margin positif).`
  );

  if (impasMin === null) {
    fakta.push(
      "Tidak ada satu pun SKU bermargin positif, sehingga titik impas terendah, tertinggi, dan SKU paling boros belum bisa dihitung. " +
        "Selama margin tidak positif, berapa pun setelan iklannya tidak akan menghasilkan laba."
    );
  } else {
    fakta.push(`Titik impas terendah ${impasMin} dan tertinggi ${impasMaks}; rata-rata ${impasRata} dari ${impas.length} SKU.`);
    fakta.push(`SKU paling aman diiklankan (titik impas terendah): ${sebutSku(teraman.slice(0, MAKS_SEBUT))}.`);
    fakta.push(`SKU paling boros (titik impas tertinggi): ${sebutSku(terboros.slice(0, MAKS_SEBUT))}.`);
    const belumImpas = baris.filter((b) => b.roasImpas === null);
    if (belumImpas.length > 0) {
      fakta.push(
        `${belumImpas.length} SKU bermargin ≤ 0 sehingga tidak punya titik impas: ` +
          `${belumImpas.slice(0, MAKS_SEBUT).map((b) => b.sku).join(", ")}. SKU ini jangan diiklankan.`
      );
    }
    const beriklan = baris.filter((b) => b.dilihat !== null || b.biayaIklan !== null || b.roasAktual !== null);
    if (beriklan.length === 0) {
      fakta.push("Belum ada SKU yang menyentuh iklan (tayangan/biaya), jadi ROAS aktual belum bisa dibandingkan dengan titik impas.");
    } else {
      const ambangCtr = ambangCtrToko(beriklan) ?? undefined;
      const dinilai = beriklan.map((b) => ({ b, k: keputusanIklan(b, ambangCtr) }));
      const hitung = (keputusan: string): number => dinilai.filter((d) => d.k.keputusan === keputusan).length;
      fakta.push(
        `${beriklan.length} SKU yang menyentuh iklan: ${hitung("naikkan")} saran naikkan, ` +
          `${hitung("hentikan")} saran hentikan, ${hitung("tahan")} saran tahan, ` +
          `${hitung("belum_cukup_data")} belum cukup data (di bawah ${TAYANGAN_MIN_RAPI} tayangan).`
      );
      const sudahDiAtas = beriklan.filter(
        (b) => b.roasAktual !== null && b.roasImpas !== null && b.roasAktual >= b.roasImpas
      );
      fakta.push(
        `${sudahDiAtas.length} dari ${beriklan.length} SKU beriklan sudah melewati titik impasnya; ` +
          `ber-CTR di atas ambang ${AMBANG_CTR_SEHAT}%: ${beriklan.filter((b) => b.ctr !== null && b.ctr >= AMBANG_CTR_SEHAT).length} SKU.`
      );
    }
  }

  fakta.push(
    `Asumsi yang diisi user (BUKAN hasil hitung sistem): modal iklan ${rupiah(m.modalIklan)}, ` +
      `target ROAS ${m.targetRoas}, hari ke-${m.hariKe}.`
  );
  fakta.push(
    `Ambang yang dipakai berasal dari aturan sistem: CTR sehat minimal ${AMBANG_CTR_SEHAT}% dan tayangan minimal ` +
      `${TAYANGAN_MIN_RAPI} sebelum hasil dinilai (praktik umum, bukan aturan resmi Shopee).`
  );
  return fakta;
}
