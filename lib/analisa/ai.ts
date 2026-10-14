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
import { panggilTeks, type Konteks } from "@/lib/ai/provider";
import type { HasilAnalisa } from "./tipe";

/** Prompt sistem: mengunci peran AI sebagai penafsir, bukan penghitung. */
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
6. Ringkas. Paling banyak 5 temuan, masing-masing 1-3 kalimat.
7. JANGAN membalik arah temuan. Setiap temuan sudah menyatakan sifatnya (rugi, tipis,
   terlalu bergantung, dst). Menyebut konsentrasi laba yang tinggi sebagai pencapaian
   BAIK adalah kesalahan — konsentrasi tinggi itu RISIKO. Bila ragu, kutip judul temuan
   apa adanya dan jangan menambahkan penilaian sendiri.

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

  if (h.kurang.length > 0) {
    baris.push(`DATA YANG BELUM TERSEDIA (wajib disebut di jawaban): ${h.kurang.join(" | ")}`);
  } else {
    baris.push("DATA YANG BELUM TERSEDIA: tidak ada.");
  }

  // 10 SKU teratas supaya AI bisa mengaitkan temuan dengan produk nyata.
  const teratas = [...h.baris].sort((a, b) => b.kontribusi - a.kontribusi).slice(0, 10);
  if (teratas.length > 0) {
    baris.push("10 SKU PENYUMBANG TERBESAR:");
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

export type HasilMendalam = {
  narasi: string;
  provider: string;
  model: string;
  /** Bahan yang dikirim ke AI — ditampilkan di UI supaya angka yang dipakai bisa diperiksa. */
  bahan: string;
};

/**
 * Jalankan analisa mendalam.
 * `reasoning` diambil dari pengaturan global (AiSettings.reasoningAnalisa); kosong =
 * pakai default model.
 */
export async function analisaMendalam(
  ctx: Konteks,
  h: HasilAnalisa,
  reasoning: string
): Promise<{ ok: true; data: HasilMendalam } | { ok: false; status: number; error: string }> {
  const bahan = susunBahan(h);

  const pesan = [
    { role: "system" as const, teks: PROMPT_SISTEM },
    {
      role: "user" as const,
      teks:
        `Berikut hasil analisa yang SUDAH DIHITUNG sistem. Tafsirkan untuk pemilik toko.\n\n` +
        `${bahan}\n\n` +
        `Ingat: jangan menghitung ulang apa pun, jangan mengarang angka, dan sebutkan data yang belum tersedia.`,
    },
  ];

  const hasil = await panggilTeks(ctx, { pesan, reasoning }, "teks");
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
