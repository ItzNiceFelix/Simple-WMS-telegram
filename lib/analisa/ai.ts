// lib/analisa/ai.ts — Analisa mendalam: AI MENAFSIRKAN, bukan menghitung.
//
// PEMBATASAN KINI HANYA PADA ANGKA, BUKAN PADA TAFSIR:
//   * Seluruh angka datang dari lib/analisa/hitung.ts yang sudah diuji dan bisa diaudit.
//     AI menerima angka itu sebagai FAKTA; ia DILARANG menghitung ulang, menjumlahkan,
//     menaksir, atau mengarang angka. Kalau AI yang menghitung, hasilnya tidak bisa
//     diperiksa — dan di data keuangan angka yang tidak bisa diaudit tidak boleh jadi
//     dasar keputusan.
//   * Selain angka, AI BEBAS berhipotesis, menyusun prioritas, mengaitkan sebab-akibat
//     antar angka, dan mengkritik pola penjualan. Tafsir tidak perlu diaudit angka demi
//     angka; yang harus bisa ditelusuri adalah angka yang dirujuknya.
//   * Bila data tidak cukup menjawab pertanyaan pemilik toko, AI WAJIB menyebut data
//     apa yang kurang. Kesimpulan tanpa biaya iklan harus dinyatakan sebagai begitu,
//     bukan disajikan seolah gambar utuh.
//   * Bentuk jawaban TIDAK dipaku. Prompt lama memaksa struktur (paragraf ringkasan,
//     daftar prioritas, bagian "Yang belum bisa dinilai") dan menyuruh mengutip judul
//     temuan apa adanya tanpa penilaian sendiri; hasilnya terasa diatur dan tidak
//     menjawab pertanyaan yang diajukan. Yang dipertahankan hanya batas yang memang
//     tak bisa diaudit: DILARANG mengklaim tahu mekanisme internal iklan Shopee
//     (GMV MAX / AUTO ROAS), DILARANG menyebut target ROAS sebagai "yang terbaik".
//
// BATAS PANJANG: kedalaman (ATURAN_KEDALAMAN) hanya mengatur panjang jawaban, karena
// panjang adalah pilihan pengguna — bukan angka yang dipaku di kode, dan bukan cetakan
// struktur.
import { panggilTeks, type Konteks } from "@/lib/ai/provider";
import type { UpayaGagal } from "@/lib/d1/hasil";
import { keputusanIklan, organikCr } from "./hitung";
import type { PaketSkenario } from "./skenarioIklan";
import type { BarisSku, HasilAnalisa } from "./tipe";

/** Tingkat kedalaman jawaban yang boleh diminta pengguna. */
export type Kedalaman = "ringkas" | "sedang" | "panjang";

/**
 * Blok aturan yang BERUBAH menurut kedalaman. Ini INSTRUKSI, bukan pemotongan teks:
 * model tetap menerima seluruh bahan. Isinya HANYA panjang jawaban — bentuk jawaban
 * ditentukan model sendiri menurut pertanyaan yang diajukan.
 */
export const ATURAN_KEDALAMAN: Record<Kedalaman, string> = {
  ringkas: "PANJANG JAWABAN: RINGKAS, maksimal sekitar 150 kata.",
  sedang: "PANJANG JAWABAN: SEDANG, maksimal sekitar 350 kata.",
  panjang:
    "PANJANG JAWABAN: PANJANG, tanpa batas praktis — pakai sepanjang yang benar-benar " +
    "dibutuhkan untuk menjawab, jangan mengulang.",
};

/**
 * Prompt sistem: AI penafsir, bukan penghitung. Yang dikunci hanya soal ANGKA; tafsir
 * dibebaskan supaya jawaban berguna. Dipisah dari fungsi supaya bisa diuji apa adanya
 * (tanpa memanggil model).
 */
export const PROMPT_SISTEM =
  `Anda menafsirkan hasil analisa penjualan untuk pemilik toko online Indonesia.

DUA ATURAN KERAS:
1. Seluruh angka sudah dihitung sistem. DILARANG menghitung ulang, menjumlahkan,
   menaksir, atau mengarang angka. Kutip angka dari bahan apa adanya. Bila butuh angka
   yang tidak ada di bahan, nyatakan datanya belum ada — jangan menebaknya.
2. Bila data tidak cukup untuk menjawab pertanyaan pemilik toko, sebutkan data apa
   yang kurang.

SELAIN ITU ANDA BEBAS: boleh berhipotesis, menyusun prioritas, mengaitkan sebab-akibat
antar angka, dan mengkritik pola penjualan — asalkan setiap klaim merujuk angka di bahan.

BATAS YANG TIDAK BISA DIAUDIT:
- DILARANG mengklaim tahu mekanisme internal iklan Shopee (GMV MAX, AUTO ROAS).
- DILARANG menyebut suatu target ROAS sebagai "yang terbaik". Yang boleh dijelaskan:
  arti ROAS TITIK IMPAS yang dihitung dari biaya toko sendiri.

BENTUK JAWABAN: bebas. Jawab pertanyaan yang diajukan bila ada — jangan sekadar
merangkum bahan. Pakai bahasa Indonesia sederhana, tanpa istilah teknis.`;

/** Konteks tambahan yang boleh menyertai bahan; semua opsional agar pemanggil lama tetap bekerja. */
export type KonteksBahan = {
  trenHarian?: string;
  perJam?: string;
  fastSlowDead?: string;
  komposisiBiaya?: string;
  pertanyaan?: string;
};

/**
 * Susun bahan untuk AI dari hasil analisa cepat. Sengaja hanya mengirim ANGKA YANG
 * SUDAH DIHITUNG plus konteks minimum — bukan data mentah, supaya AI tidak punya
 * kesempatan menghitung ulang.
 *
 * `konteks` opsional: blok tambahan hanya ditambahkan BILA diisi, sehingga bahan lama
 * tetap identik untuk pemanggil yang hanya mengirim hasil analisa.
 */
export function susunBahan(h: HasilAnalisa, konteks?: KonteksBahan): string {
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

  // Blok konteks tambahan: hanya ditambahkan bila pemanggil mengisinya, urut tetap.
  // Teksnya SUDAH dihitung pemanggil — di sini murni label + kutipan, tidak ada hitungan.
  if (konteks) {
    if (konteks.trenHarian) baris.push(`TREN HARIAN (sudah dihitung sistem):\n${konteks.trenHarian}`);
    if (konteks.perJam) baris.push(`PER JAM (sudah dihitung sistem):\n${konteks.perJam}`);
    if (konteks.fastSlowDead) baris.push(`KLASIFIKASI PRODUK:\n${konteks.fastSlowDead}`);
    if (konteks.komposisiBiaya) baris.push(`KOMPOSISI BIAYA:\n${konteks.komposisiBiaya}`);
    if (konteks.pertanyaan) baris.push(`PERTANYAAN PENGGUNA:\n${konteks.pertanyaan}`);
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
  /** Blok kondisi (tren harian, per jam, fast/slow/dead, komposisi) dari aksi `tren`. */
  konteks?: KonteksBahan;
};

/**
 * Pesan yang dikirim ke model: bahan dulu, instruksi terakhir (paling mudah diikuti).
 * `pertanyaan` opsional: bila ada, instruksinya menuntut jawaban langsung atas pertanyaan
 * itu, bukan rangkuman bahan.
 */
export function susunPesan(bahan: string, kedalaman: Kedalaman, pertanyaan?: string): { role: "user"; teks: string } {
  return {
    role: "user",
    teks:
      `Berikut hasil analisa yang SUDAH DIHITUNG sistem. Tafsirkan untuk pemilik toko.\n\n` +
      `${bahan}\n\n` +
      `${ATURAN_KEDALAMAN[kedalaman]}\n` +
      (pertanyaan
        ? `Jawab langsung pertanyaan pengguna berikut, bukan sekadar merangkum bahan: "${pertanyaan}"\n`
        : "") +
      `Ingat: jangan menghitung ulang apa pun, jangan mengarang angka, dan bila data ` +
      `kurang untuk menjawab, sebutkan data apa yang kurang.`,
  };
}

/**
 * Susun pasangan pesan (sistem + instruksi) untuk analisa mendalam — DIPAKAI BERSAMA
 * oleh jalur JSON (`analisaMendalam`) dan jalur streaming (`panggilTeksStream` di route).
 * Kalau tiap jalur menyusunnya sendiri, dua endpoint bisa mengirim instruksi berbeda
 * untuk angka yang sama dan hasilnya tidak lagi bisa dibandingkan.
 */
export function susunPesanMendalam(
  bahan: string,
  kedalaman: Kedalaman,
  pertanyaan?: string
): { role: "system" | "user"; teks: string }[] {
  return [{ role: "system" as const, teks: PROMPT_SISTEM }, susunPesan(bahan, kedalaman, pertanyaan)];
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
  const bahan = susunBahan(h, opsi.konteks);

  const pesan = susunPesanMendalam(bahan, opsi.kedalaman, opsi.konteks?.pertanyaan);

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
 * adanya (tanpa memanggil model) — yang diuji di sini adalah batas angkanya, bukan gaya
 * bahasanya: model yang mengarang angka pemicu membuat rencana tidak bisa diaudit.
 * Paket skenario tetap dikirim sebagai BAHAN, bukan template jawaban: model menilai
 * sendiri mana yang perlu dihentikan, dinaikkan, atau ditahan.
 */
export const PROMPT_SISTEM_SKENARIO =
  `Anda memberi saran iklan untuk pemilik toko online Indonesia. Paket data dan
skenario di bawah SUDAH DIHITUNG sistem.

DUA ATURAN KERAS:
1. Seluruh angka sudah dihitung sistem. DILARANG menghitung ulang, menjumlahkan,
   menaksir, atau mengarang angka. Kutip angka dari paket apa adanya. Bila butuh angka
   yang tidak ada di paket, nyatakan datanya belum ada.
2. Bila data tidak cukup untuk menjawab, sebutkan data apa yang kurang.

SELAIN ITU ANDA BEBAS menilai. Dari fakta paket, tentukan SENDIRI mana yang perlu
dihentikan, dinaikkan, atau ditahan — sertakan alasan berangka untuk setiap penilaian.
Skenario di paket adalah bahan pertimbangan, bukan urutan yang harus diikuti; boleh
setuju, menolak, menggabungkan, atau menambah prioritas lain bila angkanya mendukung.
Gunakan ambang pemicu dari paket apa adanya, jangan menggantinya dengan angka sendiri.

BATAS YANG TIDAK BISA DIAUDIT:
- DILARANG menyebut suatu target ROAS sebagai "yang terbaik".
- DILARANG mengklaim tahu mekanisme internal iklan Shopee (GMV MAX, AUTO ROAS).

BENTUK JAWABAN: bebas, selama menjawab pertanyaan pengguna dan setiap langkah yang
disarankan bisa ditelusuri ke angka di paket. Bahasa Indonesia sederhana, tanpa
istilah teknis.`;

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
        `Nilai sendiri dari paket berikut: apa yang perlu dihentikan, dinaikkan, atau ditahan ` +
        `pada hari ke-${hariKe}, beserta alasan berangkanya. ` +
        `Pakai angka paket apa adanya; jangan mengarang angka di luar paket.\n\n` +
        `${susunBahanSkenario(paket, hariKe)}`,
    },
  ];
}
