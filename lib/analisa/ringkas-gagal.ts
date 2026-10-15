// lib/analisa/ringkas-gagal.ts — Ubah daftar percobaan gagal jadi ringkasan yang bisa dibaca.
//
// Masalah nyata yang diperbaiki di sini: rantai `kenari` punya 23 model aktif. Saat anggaran
// total habis, SETIAP model sisa menulis satu baris "dilewati: anggaran total habis", sehingga
// user menerima ~30 baris yang isinya sama. Dua akibatnya: pesan tidak terbaca, dan penyebab
// sebenarnya (provider tanpa kredensial, atau model pertama yang timeout) tenggelam di dalamnya.
//
// Aturan:
// - percobaan NYATA (timeout/HTTP) = informatif → ditampilkan apa adanya;
// - percobaan `dilewati:` = tidak informatif dan berulang → dikelompokkan per provider + dihitung.
// Fungsi murni tanpa I/O supaya bisa diuji tanpa jaringan.

import type { UpayaGagal } from "@/lib/d1/hasil";

/** Satu percobaan NYATA (bukan "dilewati") — inilah yang menjelaskan kenapa gagal. */
export type PercobaanNyata = { provider: string; model: string; error: string };

/** Satu kelompok "dilewati" per provider. */
export type KelompokDilewati = { provider: string; jumlah: number; alasan: string };

/** Ringkasan lengkap untuk ditampilkan di UI. */
export type RingkasanGagal = {
  /** Percobaan nyata (timeout/HTTP), urut asli. */
  nyata: PercobaanNyata[];
  /** Percobaan yang dilewati, dikelompokkan per provider. */
  dilewati: KelompokDilewati[];
  /** Total percobaan yang dilewati (angka di balik pengelompokan). */
  jumlahDilewati: number;
  /** Nama provider yang TIDAK punya kredensial aktif — akar masalah paling sering. */
  tanpaKredensial: string[];
  /** True bila ada percobaan nyata dan SELURUHNYA timeout. */
  semuaTimeout: boolean;
};

/** Jumlah percobaan nyata yang ditampilkan apa adanya; sisanya masuk daftar lengkap. */
export const NYATA_TAMPIL = 3;

/** Provider yang tidak punya kredensial aktif — akar masalah paling sering. */
export function tanpaKredensialErr(error: string): boolean {
  return error.includes("tidak ada kredensial");
}

/** Percobaan yang tidak dijalankan karena anggaran/rantai sudah habis (tidak informatif). */
export function dilewatiErr(error: string): boolean {
  return error.startsWith("dilewati");
}

/** Model tidak menjawab dalam batas waktu. */
export function timeoutErr(error: string): boolean {
  return /timeout/i.test(error);
}

export function ringkasGagal(upaya: UpayaGagal[]): RingkasanGagal {
  const nyata: PercobaanNyata[] = [];
  const peta = new Map<string, string[]>();
  const tanpaKredensial: string[] = [];

  for (const u of upaya) {
    const provider = String(u.provider ?? "").trim() || "(tanpa provider)";
    const model = String(u.model ?? "").trim() || "—";
    const error = String(u.error ?? "").trim();

    if (tanpaKredensialErr(error)) {
      // Satu baris per provider sudah cukup; sisanya duplikat.
      if (!tanpaKredensial.includes(provider)) tanpaKredensial.push(provider);
      continue;
    }
    if (dilewatiErr(error)) {
      const daftar = peta.get(provider);
      if (daftar) daftar.push(error);
      else peta.set(provider, [error]);
      continue;
    }
    nyata.push({ provider, model, error });
  }

  const dilewati: KelompokDilewati[] = [];
  let jumlahDilewati = 0;
  for (const [provider, daftar] of peta) {
    jumlahDilewati += daftar.length;
    const badan = daftar[0].replace(/^dilewati:\s*/i, "");
    // Angka anggaran sama di semua baris → buang supaya ringkas. Kalau berbeda, baris pertama
    // saja yang dipakai (perbedaan itu justru informasi).
    const bersih = daftar.every((e) => /^dilewati:\s*anggaran total \d+ms habis$/i.test(e))
      ? badan.replace(/\s*\d+ms\b/, "")
      : badan;
    dilewati.push({ provider, jumlah: daftar.length, alasan: bersih });
  }

  return {
    nyata,
    dilewati,
    jumlahDilewati,
    tanpaKredensial,
    semuaTimeout: nyata.length > 0 && nyata.every((n) => timeoutErr(n.error)),
  };
}

/** Saran tindakan konkret dari ringkasan — tidak pernah memaksa nilai, hanya menyebut jalan keluar. */
export function saranGagal(r: RingkasanGagal): string[] {
  const saran: string[] = [];
  if (r.tanpaKredensial.length > 0) {
    saran.push(
      `Provider ${r.tanpaKredensial.join(", ")} belum punya API key aktif, sehingga seluruh modelnya ` +
        `dilewati. Isi kuncinya di Pengaturan AI → Kredensial Provider, atau keluarkan provider itu dari rantai fallback.`
    );
  }
  if (r.semuaTimeout) {
    saran.push(
      "Semua percobaan berakhir timeout. Turunkan Reasoning ke sedang atau low, dan pilih model tanpa " +
        "akhiran :free — model :free mengantre di sisi penyedia sehingga sering melewati batas waktu."
    );
  }
  if (r.jumlahDilewati > 0) {
    saran.push(
      `${r.jumlahDilewati} percobaan dilewati karena anggaran waktu seluruh rantai habis. Model pertama ` +
        `yang lambat membakar anggaran itu, sehingga provider cadangan tidak pernah dicoba — letakkan ` +
        `provider yang kredensialnya sehat di urutan pertama rantai.`
    );
  }
  return saran;
}
