// lib/analisa/aksi.ts — "Keputusan hari ini": maksimal lima tindakan berurutan dampak.
//
// KENAPA ADA: temuan menjawab "apa yang salah", tetapi pemilik toko membuka halaman ini
// dengan pertanyaan "lalu saya harus apa?". Tanpa satu daftar tindakan, jawabannya tersebar
// di enam tab dan harus dirakit sendiri — itulah keluhan keterbacaan yang jadi alasan
// halaman ini ditulis ulang.
//
// ATURAN YANG MENGIKAT:
//   * Setiap aksi punya ANGKA. Bila dampak rupiah tidak bisa dihitung, aksi tetap
//     ditampilkan tetapi menyebut DATA APA yang kurang — tidak dikarang.
//   * Aksi berasal dari aturan terbaca (`keputusanIklan`, temuan, stok). Tidak ada AI.
//   * Fungsi ini MURNI: tanpa DB, tanpa React, tanpa jam.
import type { BarisSku, RingkasanAnalisa, Temuan } from "./tipe";
import { ambangCtrToko, keputusanIklan, AMBANG_MARGIN_TIPIS } from "./hitung";

/** Ke mana tombol "lihat detail" mengarah — nama tab yang ada di halaman Analisa. */
export type TujuanTab = "produk" | "iklan" | "temuan" | "stok";

export type Aksi = {
  /** Kunci stabil untuk React dan untuk merujuk aksi dari laporan. */
  kode: string;
  /** Kata kerja yang harus dilakukan, sudah final ("Hentikan", "Naikkan harga"). */
  kata: string;
  /** Objek tindakan: nama produk, atau "3 SKU" bila menyangkut banyak. */
  objek: string;
  /** Satu kalimat: sebab + angka. Bahasa awam, tanpa istilah teknis. */
  alasan: string;
  /** Dampak rupiah pada periode ini. null = tidak bisa dihitung (lihat `dampakAlasan`). */
  dampak: number | null;
  /** Kenapa dampak tidak bisa dihitung. Wajib ada bila `dampak` null. */
  dampakAlasan?: string;
  /** Apakah `dampak` adalah uang yang HILANG bila tidak dilakukan (bukan penghematan). */
  dampakBerupa: "hemat" | "rugi" | "modal";
  /** Angka pendukung yang bisa diperiksa sendiri (kode temuan atau SKU). */
  bukti: string;
  tujuanTab: TujuanTab;
};

/** Peringkat keparahan untuk pengurutan sekunder. */
const PERINGKAT: Record<Temuan["keparahan"], number> = { kritis: 0, peringatan: 1, catatan: 2 };

export type MasukanAksi = {
  baris: BarisSku[];
  temuan: Temuan[];
  ringkasan: RingkasanAnalisa;
  /** Total biaya iklan periode ini. null = belum diimpor. */
  biayaIklan: number | null;
  /** Maksimum aksi yang ditampilkan. Bawaan 5: daftar lebih panjang tidak lagi "hari ini". */
  maks?: number;
};

/**
 * Susun daftar tindakan, terpenting dulu.
 *
 * Dampak aksi iklan dihitung dari rumus titik impas: pada ROAS = impas, margin penjualan
 * persis menutup biaya iklan. Jadi bagian biaya yang TIDAK tertutup adalah
 * `biaya × (1 − ROAS aktual ÷ ROAS impas)`. Ini kerugian yang benar-benar terjadi pada
 * periode yang sudah lewat, bukan proyeksi.
 */
export function susunAksi(m: MasukanAksi): Aksi[] {
  const daftar: Aksi[] = [];

  // ── 1. Iklan yang merugi: setiap rupiah yang dibelanjakan tidak kembali utuh ──
  // Ambang CTR dihitung SEKALI dari toko ini, bukan 1,5% tetap: lihat `ambangCtrToko`.
  const ambangCtr = ambangCtrToko(m.baris) ?? undefined;
  for (const b of m.baris) {
    if (b.biayaIklan === null || b.biayaIklan <= 0) continue;
    const putusan = keputusanIklan(b, ambangCtr);
    if (putusan.keputusan === "hentikan" && b.roasAktual !== null && b.roasImpas !== null) {
      // `roasImpas > 0` dijamin `roasImpas()`; pembagi nol tetap dijaga agar tidak ada NaN.
      const bagianTertutup = b.roasImpas > 0 ? b.roasAktual / b.roasImpas : 1;
      const bocor = Math.max(0, Math.round(b.biayaIklan * (1 - bagianTertutup)));
      daftar.push({
        kode: `hentikan-iklan:${b.sku}`,
        kata: "Hentikan iklan",
        objek: b.nama ?? b.sku,
        alasan: `ROAS ${b.roasAktual}× masih di bawah titik impas ${b.roasImpas}×, jadi sebagian biaya iklannya tidak kembali.`,
        dampak: bocor,
        dampakBerupa: "rugi",
        bukti: `SKU ${b.sku} · biaya iklan ${Math.round(b.biayaIklan)}`,
        tujuanTab: "iklan",
      });
    }
    if (putusan.keputusan === "naikkan") {
      daftar.push({
        kode: `naikkan-iklan:${b.sku}`,
        kata: "Naikkan iklan",
        objek: b.nama ?? b.sku,
        alasan: `ROAS ${b.roasAktual}× sudah melewati titik impas ${b.roasImpas}× dan CTR ${b.ctr}% sehat — iklan ini menghasilkan, bukan membakar.`,
        dampak: null,
        dampakAlasan: "tambahan penjualan dari kenaikan anggaran iklan tidak bisa diketahui dari data yang ada",
        dampakBerupa: "hemat",
        bukti: `SKU ${b.sku}`,
        tujuanTab: "iklan",
      });
    }
  }

  // ── 2. SKU yang merugi setiap kali terjual ──
  const merugi = m.baris.filter((b) => b.marginSatuan < 0);
  if (merugi.length > 0) {
    const totalRugi = Math.abs(merugi.reduce((a, b) => a + b.kontribusi, 0));
    const terburuk = [...merugi].sort((a, b) => a.kontribusi - b.kontribusi)[0];
    daftar.push({
      kode: "sku-merugi",
      kata: merugi.length === 1 ? "Naikkan harga atau hentikan" : "Naikkan harga atau hentikan",
      objek: merugi.length === 1 ? (terburuk.nama ?? terburuk.sku) : `${merugi.length} SKU`,
      alasan: `Harga jual lebih rendah daripada HPP + biaya, jadi setiap penjualan menambah kerugian. Terburuk: ${terburuk.nama ?? terburuk.sku} (margin ${terburuk.marginPersen}%).`,
      dampak: Math.round(totalRugi),
      dampakBerupa: "rugi",
      bukti: `SKU ${terburuk.sku} · ${merugi.length} SKU terdampak`,
      tujuanTab: "produk",
    });
  }

  // ── 3. HPP sudah naik sejak snapshot: laba di halaman ini lebih tinggi dari kenyataan ──
  const basi = m.baris.filter((b) => b.hppNaik > 0);
  if (basi.length > 0) {
    const dampak = Math.round(basi.reduce((a, b) => a + b.hppNaik * b.unit, 0));
    const terbesar = [...basi].sort((a, b) => b.hppNaik * b.unit - a.hppNaik * a.unit)[0];
    daftar.push({
      kode: "hpp-naik",
      kata: "Perbarui HPP lalu hitung ulang",
      objek: `${basi.length} SKU`,
      alasan: `HPP master sudah naik sejak data terakhir dihitung, jadi margin sebenarnya lebih tipis daripada yang terlihat di sini. Terbesar: ${terbesar.nama ?? terbesar.sku} (+${terbesar.hppNaik} per unit).`,
      dampak,
      dampakBerupa: "rugi",
      bukti: `SKU ${terbesar.sku} · ${basi.length} SKU`,
      tujuanTab: "produk",
    });
  }

  // ── 4. Penyumbang laba yang stoknya tipis ──
  const stokKritis = m.baris
    .filter((b) => b.stok !== null && b.kontribusi > 0 && b.stok < b.unit * 0.5)
    .sort((a, b) => b.kontribusi - a.kontribusi);
  if (stokKritis.length > 0) {
    const utama = stokKritis[0];
    daftar.push({
      kode: "stok-kritis",
      kata: "Restok",
      objek: stokKritis.length === 1 ? (utama.nama ?? utama.sku) : `${stokKritis.length} SKU penyumbang laba`,
      alasan: `Stok tersisa ${utama.stok} unit sementara ${utama.unit} unit terjual pada periode ini — lebih cepat habis daripada bisa diisi ulang.`,
      dampak: null,
      dampakAlasan: "penjualan yang hilang bila stok habis butuh proyeksi permintaan, dan data itu belum ada",
      dampakBerupa: "rugi",
      bukti: `SKU ${utama.sku} · sisa ${utama.stok} unit`,
      // Tab Stok memuat proyeksi hari tersisa — di situlah bukti aksi ini bisa diperiksa.
      tujuanTab: "stok",
    });
  }

  // ── 5. Modal tertahan di stok yang tidak bergerak ──
  const mati = m.baris.filter((b) => b.stok !== null && (b.stok ?? 0) > 0 && b.unit === 0);
  if (mati.length > 0) {
    const modal = Math.round(mati.reduce((a, b) => a + (b.stok ?? 0) * b.hppSatuan, 0));
    daftar.push({
      kode: "stok-mati",
      kata: "Dorong atau diskon",
      objek: `${mati.length} SKU tidak terjual`,
      alasan: `Ada stok tapi tidak satu pun terjual pada periode ini. Uang yang tertahan di stok ini dihitung dari HPP × jumlah.`,
      dampak: modal,
      dampakBerupa: "modal",
      bukti: `${mati.length} SKU · ${Math.round(mati.reduce((a, b) => a + (b.stok ?? 0), 0))} unit`,
      tujuanTab: "stok",
    });
  }

  // ── 6. Temuan yang tidak tercakup aturan di atas ──
  // Contoh: konsentrasi laba. Dampaknya tidak bisa dinyatakan rupiah tanpa asumsi tentang
  // apa yang terjadi bila SKU utama hilang, jadi aksi ini disebut tanpa angka dampak.
  const sudahAda = new Set(daftar.map((a) => a.kode));
  for (const t of m.temuan) {
    if (t.keparahan !== "kritis") continue;
    const kode = `temuan:${t.kode}`;
    if (sudahAda.has(kode)) continue;
    // Temuan yang sudah terwakili aksi lain dilewati: dua kartu untuk satu masalah membuat
    // daftar "lima tindakan" berisi tiga masalah.
    if (t.kode === "sku_merugi" && sudahAda.has("sku-merugi")) continue;
    if (t.kode === "hpp_naik" && sudahAda.has("hpp-naik")) continue;
    if (t.kode === "stok_tipis_penyumbang" && sudahAda.has("stok-kritis")) continue;
    daftar.push({
      kode,
      kata: "Periksa",
      objek: t.judul,
      alasan: t.penjelasan,
      dampak: t.angka.satuan === "rupiah" ? Math.round(t.angka.nilai) : null,
      ...(t.angka.satuan === "rupiah"
        ? {}
        : { dampakAlasan: `temuan ini diukur dalam ${t.angka.satuan}, bukan rupiah` }),
      dampakBerupa: "rugi",
      bukti: `temuan ${t.kode}`,
      tujuanTab: "temuan",
    });
  }

  // Urut: dampak terbesar dulu (yang tidak bisa dihitung paling belakang), lalu keparahan.
  const peringkat = new Map<string, number>();
  for (const t of m.temuan) peringkat.set(`temuan:${t.kode}`, PERINGKAT[t.keparahan]);
  daftar.sort((a, b) => {
    const da = a.dampak ?? -1;
    const db = b.dampak ?? -1;
    if (da !== db) return db - da;
    const pa = peringkat.get(a.kode) ?? (a.dampak === null ? 3 : 1);
    const pb = peringkat.get(b.kode) ?? (b.dampak === null ? 3 : 1);
    if (pa !== pb) return pa - pb;
    return a.kode.localeCompare(b.kode);
  });

  const maks = Math.max(1, m.maks ?? 5);
  return daftar.slice(0, maks);
}

/**
 * Satu kalimat untuk keadaan "tidak ada aksi". Wajib menyebut ALASANNYA — daftar kosong
 * tanpa penjelasan membuat pemilik toko mengira analisanya rusak.
 */
export function alasanTanpaAksi(m: {
  baris: BarisSku[];
  biayaIklan: number | null;
  ringkasan: RingkasanAnalisa;
}): string {
  if (m.baris.length === 0) return "Belum ada SKU yang bisa dianalisa pada periode ini.";
  const alasan: string[] = [];
  if (m.ringkasan.laba > 0) alasan.push("laba periode ini positif");
  if (m.biayaIklan === null) alasan.push("biaya iklan belum diimpor sehingga iklan tidak dinilai");
  if (m.baris.every((b) => b.stok === null)) alasan.push("data stok tidak tersedia");
  if (m.baris.every((b) => b.hppNaik === 0)) alasan.push("HPP master masih sama dengan snapshot");
  const ekor = alasan.length > 0 ? ` (${alasan.join("; ")})` : "";
  return `Tidak ada aksi mendesak pada periode ini: tidak ada SKU merugi, tidak ada iklan di bawah titik impas, dan tidak ada margin di bawah ${AMBANG_MARGIN_TIPIS}%${ekor}.`;
}
