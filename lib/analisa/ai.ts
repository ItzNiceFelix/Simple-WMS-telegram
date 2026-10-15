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
import type { UpayaGagal } from "@/lib/d1/hasil";
import { keputusanIklan, organikCr } from "./hitung";
import type { PaketSkenario } from "./skenarioIklan";
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
  // Metrik ORGANIK ikut dikirim HANYA saat ada (null = jangan dikirim), supaya model
  // tidak membahas kunjungan dari ketiadaan data. Angka ini beda dari iklan — diberi
  // label "organik" agar tidak tertukar dengan Dilihat/Klik iklan di blok keputusan.
  const teratas = [...h.baris].sort((a, b) => b.kontribusi - a.kontribusi).slice(0, 20);
  if (teratas.length > 0) {
    baris.push("20 SKU PENYUMBANG TERBESAR:");
    for (const b of teratas) {
      baris.push(
        `- ${b.sku} ${b.nama ?? ""}: terjual ${b.unit}, harga Rp ${b.hargaJual}, ` +
          `HPP Rp ${b.hppSatuan}, margin Rp ${b.marginSatuan} (${b.marginPersen}%), ` +
          `kontribusi Rp ${b.kontribusi}, ROAS impas ${b.roasImpas ?? "tidak ada (margin ≤ 0)"}` +
          organikRingkas(b)
      );
    }
  }

  return baris.join("\n");
}

/**
 * Cuplikan metrik ORGANIK satu SKU untuk bahan prompt. String KOSONG bila tak ada data —
 * supaya SKU tanpa baris Performa Produk tidak menambah kalimat kosong ke bahan.
 * Label "organik" ditulis eksplisit: angka ini dari kunjungan tanpa iklan, dan mencampurnya
 * dengan Dilihat/Klik iklan akan membuat AI menyimpulkan sebab yang salah.
 */
function organikRingkas(b: BarisSku): string {
  if (b.organikKunjungan === null && b.organikPesanan === null) return "";
  const cr = organikCr(b);
  return (
    `, ORGANIK (tanpa iklan): kunjungan ${b.organikKunjungan ?? "belum ada"}, ` +
    `keranjang ${b.organikKeranjang ?? "belum ada"}, pesanan ${b.organikPesanan ?? "belum ada"}, ` +
    `omzet Rp ${b.organikOmzet ?? "belum ada"}, CR organik ${cr === null ? "belum bisa dihitung" : `${cr}%`}`
  );
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
 * Susun pasangan pesan (sistem + instruksi) untuk analisa mendalam — DIPAKAI BERSAMA
 * oleh jalur JSON (`analisaMendalam`) dan jalur streaming (`panggilTeksStream` di route).
 * Kalau tiap jalur menyusunnya sendiri, dua endpoint bisa mengirim instruksi berbeda
 * untuk angka yang sama dan hasilnya tidak lagi bisa dibandingkan.
 */
export function susunPesanMendalam(bahan: string, kedalaman: Kedalaman): { role: "system" | "user"; teks: string }[] {
  return [{ role: "system" as const, teks: PROMPT_SISTEM }, susunPesan(bahan, kedalaman)];
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
): Promise<{ ok: true; data: HasilMendalam } | { ok: false; status: number; error: string; upaya?: UpayaGagal[] }> {
  const bahan = susunBahan(h);

  const pesan = susunPesanMendalam(bahan, opsi.kedalaman);

  const hasil = await panggilTeks(
    ctx,
    {
      pesan,
      reasoning: opsi.reasoning,
      ...(opsi.maksToken !== undefined ? { maksToken: opsi.maksToken } : {}),
      // Analisa memakai ANGKA KEUANGAN nyata dan berjalan otomatis di latar, jadi biaya per
      // panggilan harus bisa diprediksi user: model yang tidak dipilih user TIDAK boleh
      // dipakai tanpa persetujuan. Provider tanpa model terpilih dilewati (dengan catatan),
      // bukan ditambal dari katalog — katalog tidak menyimpan harga.
      hanyaModelDipilih: true,
    },
    "teks"
  );
  // `hasil` gagal sudah memuat `upaya` (provider/model/alasan) dari panggilTeks —
  // diteruskan apa adanya supaya endpoint bisa menampilkannya, bukan diringkas lagi.
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

/**
 * Prompt sistem untuk saran langkah iklan. Dipisah dan diekspor supaya bisa diuji apa
 * adanya (tanpa memanggil model) — yang diuji di sini adalah LARANGANNYA, bukan gaya
 * bahasanya: model yang mengarang angka pemicu membuat rencana tidak bisa diaudit.
 */
export const PROMPT_SISTEM_SKENARIO =
  `Anda menyusun rencana BERTAHAP per skenario untuk pemilik toko online Indonesia
yang sedang beriklan. Paket data di bawah SUDAH DIHITUNG sistem.

ATURAN YANG TIDAK BOLEH DILANGGAR:
1. Seluruh angka ada di paket data. Anda DILARANG mengarang, menaksir, atau menghitung
   ulang angka apa pun — termasuk perkiraan omzet, perkiraan biaya, dan angka setelan
   iklan. Bila perlu angka yang tidak ada di paket, tulis terus terang bahwa datanya
   belum ada, jangan menebaknya.
2. Anda DILARANG menyebut suatu target ROAS sebagai "yang terbaik" dan DILARANG
   mengklaim tahu cara kerja setelan iklan Shopee (GMV MAX, AUTO ROAS).
3. Ikuti TIGA skenario yang ada di paket dengan urutan sama, dan pakai ambang pemicu
   (angka "kapan") apa adanya. Jangan mengganti ambangnya dengan angka sendiri.
4. Tiap langkah WAJIB menyebut angka pemicunya; langkah tanpa angka harus dicabut.
5. DILARANG memakai frasa lindung: "tergantung", "bisa jadi", "perlu dipertimbangkan",
   "salah satu opsi". Bila data belum cukup untuk memutuskan, katakan datanya kurang
   dan sebutkan data apa yang kurang.
6. Bahasa Indonesia sederhana, tanpa istilah teknis.

Bentuk jawaban:
- Satu paragraf singkat keadaan iklan pada hari yang disebut pengguna.
- Untuk SETIAP skenario: judul, pemicunya (angka), lalu langkah-langkah bernomor
  berurutan yang bisa langsung dijalankan hari itu.
- Satu baris "Yang belum bisa dinilai" berisi data yang tidak tersedia di paket.`;

/** Bahan yang dikirim ke AI beserta hari yang disebut pengguna — ditampilkan di UI. */
export type HasilSaranIklan = {
  teks: string;
  provider: string;
  model: string;
};

/**
 * Jalankan saran langkah iklan dari paket skenario yang sudah dihitung murni.
 *
 * AI hanya menarasikan paket INI: seluruh angka berasal dari `bangunPaketSkenario()`,
 * bukan dari model. `opsi.reasoning` diteruskan ke `panggilTeks` sama seperti
 * `analisaMendalam`, sehingga setelan PER USER (`ai_analisa_setting.reasoning`) tetap
 * berlaku — jalur parameternya satu, tidak ada jalur kedua yang bisa menyimpang.
 */
export async function saranLangkahIklan(
  ctx: Konteks,
  paket: PaketSkenario,
  opsi: { reasoning: string; maksToken?: number; hariKe: number }
): Promise<{ ok: true; data: HasilSaranIklan & { bahan: string } } | { ok: false; status: number; error: string; upaya?: UpayaGagal[] }> {
  const bahan = susunBahanSkenario(paket, opsi.hariKe);

  const hasil = await panggilTeks(
    ctx,
    {
      pesan: susunPesanSkenario(paket, opsi.hariKe),
      reasoning: opsi.reasoning,
      ...(opsi.maksToken !== undefined ? { maksToken: opsi.maksToken } : {}),
      // Sama seperti `analisaMendalam`: angka keuangan nyata + biaya harus bisa diprediksi,
      // jadi HANYA model yang dipilih user yang boleh dipakai.
      hanyaModelDipilih: true,
    },
    "teks"
  );
  if (!hasil.ok) return hasil;

  return {
    ok: true,
    data: { teks: hasil.teks.trim(), provider: hasil.provider, model: hasil.model, bahan },
  };
}

/** Paket skenario jadi teks untuk prompt; angka ditulis apa adanya supaya bisa dikutip model. */
export function susunBahanSkenario(paket: PaketSkenario, hariKe: number): string {
  const baris: string[] = [`HARI KE-${hariKe} dinilai pada rencana ini.`, "FAKTA (sudah dihitung sistem):"];
  for (const f of paket.fakta) baris.push(`- ${f}`);
  baris.push("SKENARIO (sudah dihitung sistem, kutip angkanya apa adanya):");
  for (const s of paket.skenario) {
    baris.push(`[${s.id}] ${s.judul}`);
    baris.push(`  kapan: ${s.kapan}`);
    for (const a of s.angka) baris.push(`  angka: ${a}`);
    baris.push(`  langkah sistem: ${s.langkah.join(" | ")}`);
  }
  return baris.join("\n");
}

/**
 * Susun pasangan pesan (sistem + instruksi) untuk saran langkah iklan — DIPAKAI BERSAMA
 * jalur non-stream (`saranLangkahIklan`) dan jalur streaming (`aksi=saran-iklan-stream`
 * di app/api/analisa/route.ts). Alasannya sama dengan `susunPesanMendalam`: prompt
 * skenario iklan dan prompt analisa penjualan umum menjawab pertanyaan BERBEDA, jadi
 * penggantinya tidak boleh disusun ulang di route — kalau disusun ulang, cepat atau lambat
 * satu jalur memakai prompt yang salah dan jawabannya tidak nyambung dengan pertanyaan user.
 */
export function susunPesanSkenario(paket: PaketSkenario, hariKe: number): { role: "system" | "user"; teks: string }[] {
  return [
    { role: "system" as const, teks: PROMPT_SISTEM_SKENARIO },
    {
      role: "user" as const,
      teks:
        `Hari yang diminta pengguna: hari ke-${hariKe}.\n` +
        `Susun rencana bertahap untuk hari ke-${hariKe} berdasarkan paket berikut. ` +
        `Pakai angka paket apa adanya; jangan mengarang angka di luar paket.\n\n` +
        `${susunBahanSkenario(paket, hariKe)}`,
    },
  ];
}
