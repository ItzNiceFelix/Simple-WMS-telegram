// lib/analisa/ai.ts — Analisa mendalam: AI MENAFSIRKAN, bukan menghitung.
//
// PEMISAHAN YANG WAJIB DIPATUHI:
//   * Seluruh angka datang dari lib/analisa/hitung.ts yang sudah diuji dan bisa diaudit.
//   * AI menerima angka itu sebagai FAKTA dan dilarang menghitung ulang dari data mentah.
//     Kalau AI yang menghitung, hasilnya tidak bisa diperiksa, dan di data keuangan
//     angka yang tidak bisa diaudit tidak boleh jadi dasar keputusan.
//   * AI WAJIB menyebut data yang tidak ada. Kesimpulan yang dibuat tanpa biaya iklan
//     harus dinyatakan sebagai begitu, bukan disajikan seolah gambar utuh.
//
// BATAS KERAS SARAN IKLAN (dipatuhi prompt di bawah):
//   DILARANG menyebut target ROAS sebagai "yang terbaik", DILARANG mengklaim tahu
//   mekanisme GMV MAX / AUTO ROAS yang berlaku. Yang boleh: menjelaskan arti ROAS
//   TITIK IMPAS yang sudah dihitung dari biaya toko sendiri.
//
// DASAR PENAMBAHAN ATURAN (riset praktik instruksi model, bukan selera):
//   * "Wajib menyebut angka pemicu" — rekomendasi tanpa angka tidak bisa diaudit;
//     pembaca tidak bisa tahu ambang mana yang dipakai, sehingga tidak bisa membantah.
//   * "Larangan frasa lindung" — model cenderung menutup ketidakpastian dengan
//     "tergantung"/"bisa jadi". Di keputusan iklan, jawaban seperti itu sama saja
//     tidak menjawab; lebih baik menyatakan datanya kurang.
//   * "Batas temuan mengikuti kedalaman" — panjang jawaban adalah pilihan pengguna,
//     bukan angka yang dipaku di kode.
import { panggilTeks, type Konteks } from "@/lib/ai/provider";
import { keputusanIklan } from "./hitung";
import type { BarisSku, HasilAnalisa } from "./tipe";

/** Tingkat kedalaman jawaban yang boleh diminta pengguna. */
export type Kedalaman = "ringkas" | "sedang" | "panjang";

/**
 * Blok aturan yang BERUBAH menurut kedalaman. Ini INSTRUKSI, bukan pemotongan teks:
 * model tetap menerima seluruh bahan, yang dibatasi hanya panjang jawabannya.
 */
export const ATURAN_KEDALAMAN: Record<Kedalaman, string> = {
  ringkas:
    "KEDALAMAN = RINGKAS. Tulis maksimum 3 temuan dan satu paragraf ringkasan. " +
    "Pilih hanya yang dampak rupiahnya paling besar; setiap temuan tetap wajib menyebut " +
    "angkanya. Jangan menambah bagian lain.",
  sedang:
    "KEDALAMAN = SEDANG. Tulis maksimum 5 temuan, masing-masing 1-3 kalimat, dan setiap " +
    "temuan wajib menyebut angkanya. Cukup satu paragraf ringkasan di awal.",
  panjang:
    "KEDALAMAN = PANJANG. Tidak ada batas jumlah temuan — bahas seluruh temuan yang " +
    "dampak rupiahnya berarti, dan boleh menjelaskan per produk satu per satu. " +
    "Setiap klaim tetap wajib menyebut angkanya; menambah panjang tanpa angka dilarang.",
};

/**
 * Prompt sistem: mengunci peran AI sebagai penafsir, bukan penghitung.
 * Dipisah dari fungsi supaya bisa diuji apa adanya (tanpa memanggil model).
 */
export const PROMPT_SISTEM =
  `Anda menafsirkan hasil analisa penjualan untuk pemilik toko online Indonesia.

ATURAN YANG TIDAK BOLEH DILANGGAR:
1. SEMUA angka sudah dihitung sistem. Anda DILARANG menghitung ulang, menjumlahkan,
   mengalikan, atau mengubah angka apa pun. Kutip apa adanya.
2. Anda DILARANG mengarang angka yang tidak ada di data. Bila perlu angka yang tidak
   tersedia, tulis terus terang bahwa datanya belum ada.
3. Bila daftar "data yang belum tersedia" tidak kosong, SEBUTKAN di jawaban bahwa
   kesimpulan ini belum memperhitungkan hal tersebut.
4. Tentang iklan: sistem HANYA menghitung TITIK IMPAS dari biaya toko sendiri
   (HPP, admin, program, pajak). Anda DILARANG menyebut suatu target ROAS sebagai
   "yang terbaik", DILARANG mengklaim tahu cara kerja setelan iklan Shopee
   (GMV MAX, AUTO ROAS), dan DILARANG menyarankan angka setelan tertentu.
5. Bahasa Indonesia sederhana, tanpa istilah teknis. Pemilik toko bukan programmer.
6. JANGAN membalik arah temuan. Setiap temuan sudah menyatakan sifatnya (rugi, tipis,
   terlalu bergantung, dst). Menyebut konsentrasi laba yang tinggi sebagai pencapaian
   BAIK adalah kesalahan — konsentrasi tinggi itu RISIKO. Bila ragu, kutip judul temuan
   apa adanya dan jangan menambahkan penilaian sendiri.
7. SETIAP rekomendasi WAJIB menyebut angka pemicunya: ambang atau nilai yang membuat
   Anda menyarankan hal itu (mis. "ROAS impas 2,3 sementara ROAS aktual 14,3").
   Rekomendasi tanpa angka pemicu harus dicabut, bukan ditulis lebih halus.
8. DILARANG memakai frasa lindung saat memberi rekomendasi: "tergantung",
   "perlu dipertimbangkan", "bisa jadi", "salah satu opsi". Bila datanya belum cukup
   untuk memutuskan, KATAKAN datanya kurang dan sebutkan data apa yang kurang —
   jangan berputar-putar memakai frasa di atas.

Bentuk jawaban:
- Satu paragraf ringkasan keadaan toko periode ini.
- Daftar prioritas tindakan, yang paling besar dampak rupiahnya lebih dulu.
- Satu bagian "Yang belum bisa dinilai" berisi data yang tidak tersedia.`;

/**
 * Susun bahan untuk AI dari hasil analisa cepat. Sengaja hanya mengirim ANGKA YANG
 * SUDAH DIHITUNG plus konteks minimum — bukan data mentah, supaya AI tidak punya
 * kesempatan menghitung ulang.
 */
export function susunBahan(h: HasilAnalisa): string {
  const r = h.ringkasan;
  const baris: string[] = [];

  baris.push(`PERIODE: ${r.periode} (preset #${r.presetId})`);
  baris.push(
    `RINGKASAN: omzet Rp ${r.omzet}, laba Rp ${r.laba}, margin ${r.marginPersen}%, ` +
      `${r.jmlOrder} pesanan, ${r.jmlSku} SKU terjual.`
  );
  baris.push(
    `KONSENTRASI: 10 SKU teratas menyumbang ${r.persen10Teratas}% dari total kontribusi ` +
      `(Rp ${r.kontribusi10Teratas}). Margin rata-rata per unit Rp ${r.marginSatuanRata}; ` +
      `nilai tengah margin produk ${r.marginPersenMedian}%.`
  );

  if (h.temuan.length === 0) {
    baris.push("TEMUAN: tidak ada temuan yang perlu ditindaklanjuti.");
  } else {
    baris.push("TEMUAN (sudah dihitung, kutip apa adanya):");
    for (const t of h.temuan) {
      // Arah temuan dinyatakan EKSPLISIT supaya model tidak bisa membalik artinya
      // (mis. menyebut konsentrasi laba tinggi sebagai pencapaian baik).
      const arah = t.keparahan === "kritis" ? "masalah serius" : t.keparahan === "peringatan" ? "perlu diperhatikan" : "catatan";
      baris.push(`- [${arah}] ${t.judul}: ${t.penjelasan}`);
      baris.push(`    angka: ${t.angka.nilai} ${t.angka.satuan}; ${t.angka.jumlahTerkena} SKU terkena`);
      if (t.contohSku.length > 0) {
        const contoh = t.contohSku.slice(0, 5).map((s) => `${s.sku}=${s.nilai}`).join(", ");
        baris.push(`    contoh: ${contoh}`);
      }
    }
  }

  // KEPUTUSAN IKLAN: dikirim supaya AI membahas kelayakan iklan dari angka yang
  // dihitung sistem, bukan mengarang mekanisme iklan. Hanya muncul bila ada jejaknya.
  const iklan = keputusanPerSku(h.baris);
  if (iklan.length > 0) {
    baris.push("KEPUTUSAN IKLAN (sudah dihitung sistem, kutip apa adanya):");
    for (const k of iklan) {
      baris.push(`- ${k.sku} ${k.nama ?? ""}: keputusan ${k.keputusan}`);
      baris.push(`    alasan: ${k.alasan}`);
    }
  }

  if (h.kurang.length > 0) {
    baris.push(`DATA YANG BELUM TERSEDIA (wajib disebut di jawaban): ${h.kurang.join(" | ")}`);
  } else {
    baris.push("DATA YANG BELUM TERSEDIA: tidak ada.");
  }

  // 20 SKU teratas supaya AI bisa mengaitkan temuan dengan produk nyata tanpa
  // bahan membengkak (batas token provider tetap harus dihormati).
  const teratas = [...h.baris].sort((a, b) => b.kontribusi - a.kontribusi).slice(0, 20);
  if (teratas.length > 0) {
    baris.push("20 SKU PENYUMBANG TERBESAR:");
    for (const b of teratas) {
      baris.push(
        `- ${b.sku} ${b.nama ?? ""}: terjual ${b.unit}, harga Rp ${b.hargaJual}, ` +
          `HPP Rp ${b.hppSatuan}, margin Rp ${b.marginSatuan} (${b.marginPersen}%), ` +
          `kontribusi Rp ${b.kontribusi}, ROAS impas ${b.roasImpas ?? "tidak ada (margin ≤ 0)"}`
      );
    }
  }

  return baris.join("\n");
}

/** Angka iklan satu SKU dalam bentuk yang bisa dibaca model; "belum ada" bila null. */
function angkaIklan(b: BarisSku): string {
  const persen = (v: number | null): string => (v === null ? "belum ada" : `${v}%`);
  const angka = (v: number | null): string => (v === null ? "belum ada" : String(v));
  return (
    `dilihat ${angka(b.dilihat)}, klik ${angka(b.klik)}, CTR ${persen(b.ctr)}, CR ${persen(b.cr)}, ` +
    `ROAS aktual ${angka(b.roasAktual)}, ` +
    `ROAS impas ${b.roasImpas === null ? "tidak ada (margin ≤ 0)" : b.roasImpas}, ` +
    `biaya iklan Rp ${angka(b.biayaIklan)}`
  );
}

/** Batas SKU yang dibahas di blok keputusan iklan supaya bahan tidak membengkak. */
const MAKS_KEPUTUSAN_IKLAN = 20;

/**
 * Baris "KEPUTUSAN IKLAN" untuk bahan prompt.
 *
 * Hanya SKU yang benar-benar menyentuh iklan (ada tayangan atau biaya) yang dikeluarkan,
 * supaya blok ini tidak muncul saat data iklan belum diimpor — kalau muncul, AI akan
 * membahas iklan dari ketiadaan data. Keputusannya diambil dari `keputusanIklan()` di
 * hitung.ts: satu sumber aturan, bukan tebakan AI.
 */
export function keputusanPerSku(daftar: BarisSku[]): { sku: string; nama: string | null; keputusan: string; alasan: string }[] {
  const beriklan = daftar.filter((b) => b.dilihat !== null || b.biayaIklan !== null || b.roasAktual !== null);
  return beriklan.slice(0, MAKS_KEPUTUSAN_IKLAN).map((b) => {
    const k = keputusanIklan(b);
    return {
      sku: b.sku,
      nama: b.nama,
      keputusan: `${k.keputusan} (${angkaIklan(b)})`,
      alasan: k.alasan,
    };
  });
}

export type HasilMendalam = {
  narasi: string;
  provider: string;
  model: string;
  /** Bahan yang dikirim ke AI — ditampilkan di UI supaya angka yang dipakai bisa diperiksa. */
  bahan: string;
};

/** Opsi pemanggilan AI: parameter AI datang dari pengaturan/permintaan, bukan dipaku. */
export type OpsiMendalam = {
  /** Nilai reasoning model ('low','high',...). Kosong = default model. */
  reasoning: string;
  /** Batas token jawaban. Diteruskan sampai adapter provider. */
  maksToken?: number;
  /** Panjang jawaban yang diminta; menentukan blok instruksi, bukan pemotongan teks. */
  kedalaman: Kedalaman;
};

/** Pesan yang dikirim ke model: bahan dulu, instruksi terakhir (paling mudah diikuti). */
export function susunPesan(bahan: string, kedalaman: Kedalaman): { role: "user"; teks: string } {
  return {
    role: "user",
    teks:
      `Berikut hasil analisa yang SUDAH DIHITUNG sistem. Tafsirkan untuk pemilik toko.\n\n` +
      `${bahan}\n\n` +
      `${ATURAN_KEDALAMAN[kedalaman]}\n` +
      `Ingat: jangan menghitung ulang apa pun, jangan mengarang angka, setiap rekomendasi ` +
      `wajib menyebut angka pemicunya, dan sebutkan data yang belum tersedia.`,
  };
}

/**
 * Jalankan analisa mendalam.
 * `opsi.reasoning` diambil dari setting PER USER (`ai_analisa_setting.reasoning`,
 * lihat lib/d1/aiAnalisaSetting.ts); kosong =
 * pakai default model. `maksToken` diteruskan sampai adapter provider supaya panjang
 * jawaban benar-benar dibatasi, bukan hanya diminta lewat kalimat.
 */
export async function analisaMendalam(
  ctx: Konteks,
  h: HasilAnalisa,
  opsi: OpsiMendalam
): Promise<{ ok: true; data: HasilMendalam } | { ok: false; status: number; error: string }> {
  const bahan = susunBahan(h);

  const pesan = [
    { role: "system" as const, teks: PROMPT_SISTEM },
    susunPesan(bahan, opsi.kedalaman),
  ];

  const hasil = await panggilTeks(
    ctx,
    {
      pesan,
      reasoning: opsi.reasoning,
      ...(opsi.maksToken !== undefined ? { maksToken: opsi.maksToken } : {}),
    },
    "teks"
  );
  if (!hasil.ok) return hasil;

  return {
    ok: true,
    data: {
      narasi: hasil.teks.trim(),
      provider: hasil.provider,
      model: hasil.model,
      bahan,
    },
  };
}
