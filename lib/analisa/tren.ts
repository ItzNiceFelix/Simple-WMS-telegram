// lib/analisa/tren.ts — Seri harian + delta periode untuk halaman Analisa.
//
// MURNI: tanpa D1 dan tanpa JS. Semua angka masuk dari snapshot yang SUDAH dihitung
// mesin laba (lib/laba). Berkas ini tidak menghitung ulang laba — kalau ia menghitung
// sendiri, halaman grafik dan tabel bisa menampilkan angka berbeda untuk periode sama.
//
// Aturan null/0 di sini SAMA dengan halaman Analisa: tidak ada data = null (bukan 0),
// terukur nol = 0. Delta hanya sah bila kedua periode punya data; kalau tidak, null.

export type TitikHarian = {
  tanggal: string;
  omzet: number;
  hpp: number;
  biaya: number;
  /** Bagian `biaya` yang berupa pajak (dasar PPh/PPN dari fee_rules). */
  pajak: number;
  /** Bagian `biaya` yang bukan pajak: admin/program/proses. */
  biayaOperasional: number;
  laba: number;
  /** laba ÷ omzet × 100, 2 desimal. null bila omzet 0 — persen dari nol tak bermakna. */
  marginPersen: number | null;
  jmlOrder: number;
};

export type Delta = {
  sekarang: number;
  sebelum: number;
  /** sekarang − sebelum. */
  selisih: number;
  /** selisih ÷ |sebelum| × 100, 1 desimal. null bila sebelum 0 — BUKAN Infinity. */
  persen: number | null;
};

export type DeltaNullabel = {
  sekarang: number | null;
  sebelum: number | null;
  selisih: number | null;
  persen: number | null;
};

/** Satu baris pembanding "periode sebelumnya" — bentuknya sama untuk periode & bulan. */
export type Pembanding = {
  /** Tanggal acuan pembanding, null bila tidak ada snapshot pembanding. */
  tanggal: string | null;
  /** Diameter jendela yang dibandingkan (hari). */
  hari: number;
  /** Ada snapshot, tetapi omzetnya 0 — rasio terhadapnya tidak bermakna. */
  omzetNol: boolean;
  omzet: Delta | null;
  laba: Delta | null;
  biaya: Delta | null;
  order: Delta | null;
  marginPersen: DeltaNullabel;
};

export type RingkasRentang = {
  hari: number;
  omzet: number;
  laba: number;
  biaya: number;
  hpp: number;
  pajak: number;
  jmlOrder: number;
  /** omzet ÷ order. null bila order 0. */
  aov: number | null;
  /** laba ÷ omzet × 100, 2 desimal. null bila omzet 0. */
  marginPersen: number | null;
};

/** Baris yang dibutuhkan dari `laba_snapshot`. */
export type SnapshotRinci = {
  tanggal: string;
  omzet: number;
  hpp: number;
  biaya: number;
  pajak: number;
  laba: number;
  jml_order: number;
};

/** Tanggal ISO mundur n hari. Exported: dipakai server (rentang 7 hari) dan UI (pilihan rentang). */
export function geserHari(tanggal: string, hari: number): string {
  return new Date(new Date(`${tanggal}T00:00:00Z`).getTime() + hari * 86400000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Seri harian untuk grafik: SATU titik per tanggal dalam rentang, termasuk hari tanpa
 * snapshot (null), supaya garis tidak menyambung melewati hari bolong dan pembaca tidak
 * melihat tren yang tidak pernah terukur.
 */
export function seriHarian(snapshots: SnapshotRinci[], dari: string, sampai: string): (TitikHarian | null)[] {
  const peta = new Map(snapshots.map((s) => [s.tanggal, s]));
  const out: (TitikHarian | null)[] = [];
  for (let t = dari; t <= sampai; t = geserHari(t, 1)) {
    const s = peta.get(t);
    if (!s) { out.push(null); continue; }
    const pajak = s.pajak ?? 0;
    out.push({
      tanggal: s.tanggal,
      omzet: s.omzet,
      hpp: s.hpp,
      biaya: s.biaya,
      pajak,
      // `pajak` dihitung TERPISAH di mesin laba, tetapi nominalnya juga sudah masuk `biaya`.
      // Jadi biaya non-pajak = biaya − pajak (bukan biaya + pajak); menjumlahkannya dua kali
      // membuat komposisi biaya lebih besar daripada totalnya.
      biayaOperasional: s.biaya - pajak,
      laba: s.laba,
      marginPersen: s.omzet > 0 ? Math.round((s.laba / s.omzet) * 10000) / 100 : null,
      jmlOrder: s.jml_order,
    });
  }
  return out;
}

/** Total satu jendela tanggal dari array titik (hari kosong dilewati). */
export function ringkasRentang(titik: (TitikHarian | null)[]): RingkasRentang {
  const ada = titik.filter((t): t is TitikHarian => t !== null);
  const jumlah = (pilih: (t: TitikHarian) => number) => ada.reduce((a, t) => a + pilih(t), 0);
  const omzet = jumlah((t) => t.omzet);
  const laba = jumlah((t) => t.laba);
  const jmlOrder = jumlah((t) => t.jmlOrder);
  return {
    hari: ada.length,
    omzet,
    laba,
    biaya: jumlah((t) => t.biaya),
    hpp: jumlah((t) => t.hpp),
    pajak: jumlah((t) => t.pajak),
    jmlOrder,
    aov: jmlOrder > 0 ? Math.round(omzet / jmlOrder) : null,
    marginPersen: omzet > 0 ? Math.round((laba / omzet) * 10000) / 100 : null,
  };
}

/** Delta angka total. `persen` null bila pembanding 0 — BUKAN Infinity. */
export function delta(sekarang: number, sebelum: number): Delta {
  const selisih = sekarang - sebelum;
  return {
    sekarang,
    sebelum,
    selisih,
    persen: sebelum !== 0 ? Math.round((selisih / Math.abs(sebelum)) * 1000) / 10 : null,
  };
}

/**
 * Bandingkan jendela `[dari, sampai]` dengan jendela pembanding sepanjang `hari` hari
 * (default: tepat sebelumnya, sehingga dua jendela tidak pernah tumpang tindih).
 */
export function bandingkan(
  sekarang: (TitikHarian | null)[],
  sebelum: (TitikHarian | null)[],
  info: { tanggalAcuan: string | null; hari: number }
): Pembanding {
  const a = ringkasRentang(sekarang);
  const b = ringkasRentang(sebelum);
  const kosong: Pembanding = {
    tanggal: info.tanggalAcuan, hari: info.hari, omzetNol: false,
    omzet: null, laba: null, biaya: null, order: null,
    marginPersen: { sekarang: a.marginPersen, sebelum: null, selisih: null, persen: null },
  };
  if (b.hari === 0) return kosong;
  return {
    tanggal: info.tanggalAcuan,
    hari: info.hari,
    omzetNol: b.omzet === 0,
    omzet: delta(a.omzet, b.omzet),
    laba: delta(a.laba, b.laba),
    biaya: delta(a.biaya, b.biaya),
    order: delta(a.jmlOrder, b.jmlOrder),
    marginPersen:
      a.marginPersen === null || b.marginPersen === null
        ? { sekarang: a.marginPersen, sebelum: b.marginPersen, selisih: null, persen: null }
        : delta(a.marginPersen, b.marginPersen),
  };
}

/** Jendela pembanding "periode sebelumnya": tepat `hari` hari sebelum `dari`. */
export function jendelaSebelum(dari: string, hari: number): { dari: string; sampai: string } {
  return { dari: geserHari(dari, -hari), sampai: geserHari(dari, -1) };
}

/**
 * Komposisi biaya satu jendela, terbesar dulu supaya pembaca langsung melihat biaya mana
 * yang paling layak dibereskan.
 *
 * Hanya tiga kelompok yang BISA dipisah dari data yang ada: HPP, pajak, dan sisa biaya
 * (admin/program/proses sudah menyatu di `biaya` saat snapshot dibuat). Memecah lebih jauh
 * berarti menebak — dan tebakan biaya adalah tebakan yang paling mahal.
 */
export function komposisiBiaya(r: RingkasRentang): {
  label: string; nilai: number; persen: number | null;
}[] {
  const total = r.hpp + r.biaya;
  const biayaOperasional = r.biaya - r.pajak;
  const baris = [
    { label: "HPP", nilai: r.hpp },
    { label: "Biaya operasional", nilai: biayaOperasional },
    { label: "Pajak (PPh/PPN)", nilai: r.pajak },
  ].filter((b) => b.nilai > 0);
  return baris
    .map((b) => ({ ...b, persen: total > 0 ? Math.round((b.nilai / total) * 10000) / 100 : null }))
    .sort((a, b) => b.nilai - a.nilai);
}

/**
 * Satu baris klasifikasi produk (fast/slow/dead) dari `aksi=tren`.
 *
 * `lajuHarian` = qty ÷ hari berdata; `hariPersediaan` null bila stok ATAU laju tidak
 * diketahui — 0 akan terbaca "hari ini juga habis", padahal artinya sebaliknya.
 */
export type BarisProdukTren = {
  sku: string;
  nama: string | null;
  qty: number;
  lajuHarian: number;
  stok: number | null;
  hariPersediaan: number | null;
  kelas: "fast" | "slow" | "dead";
};

/**
 * Bahan teks untuk AI dari hasil `aksi=tren`. Ditempatkan di sini (bukan di route) supaya
 * format angka yang dibaca model IDENTIK dengan yang tampil di halaman — dua jalur yang
 * memformat sendiri cepat atau lambat menampilkan angka berbeda untuk periode yang sama.
 */
export function bahanTren(b: {
  seri: (TitikHarian | null)[];
  ringkas: RingkasRentang;
  bandingPeriode: Pembanding;
  perJam: { jam: number; omzet: number; laba: number }[];
  produk: BarisProdukTren[];
}): { trenHarian: string; perJam: string; fastSlowDead: string; komposisiBiaya: string } {
  const ada = b.seri.filter((t): t is TitikHarian => t !== null);
  const trenHarian = [
    `${b.ringkas.hari} hari berdata: omzet ${b.ringkas.omzet}, laba ${b.ringkas.laba}, ` +
      `biaya ${b.ringkas.biaya}, ${b.ringkas.jmlOrder} order, margin ${b.ringkas.marginPersen ?? "tak terhitung"}%.`,
    ...ada.map(
      (t) => `${t.tanggal}: omzet ${t.omzet}, laba ${t.laba}, ${t.jmlOrder} order, margin ${t.marginPersen ?? "-"}%`
    ),
    b.bandingPeriode.omzet
      ? `Pembanding ${b.bandingPeriode.hari} hari sebelumnya: omzet ${b.bandingPeriode.omzet.sebelum} ` +
        `(selisih ${b.bandingPeriode.omzet.selisih}, ${b.bandingPeriode.omzet.persen ?? "tak terhitung"}%), ` +
        `laba ${b.bandingPeriode.laba?.sebelum ?? "-"} (${b.bandingPeriode.laba?.persen ?? "tak terhitung"}%).`
      : "Pembanding periode sebelumnya: belum ada data.",
  ].join("\n");

  const ramai = b.perJam.filter((j) => j.omzet > 0).sort((x, y) => y.omzet - x.omzet).slice(0, 6);
  const perJam = ramai.length
    ? `Jam tersibuk (berdasarkan jam pesanan dibuat): ${ramai.map((j) => `${j.jam}:00 omzet ${j.omzet} laba ${j.laba}`).join(", ")}.`
    : "Per jam: belum ada data (order minimal 2 hari lalu).";

  const kelompok = { fast: 0, slow: 0, dead: 0 } as Record<BarisProdukTren["kelas"], number>;
  for (const p of b.produk) kelompok[p.kelas] += 1;
  const fastSlowDead = [
    `Fast ${kelompok.fast}, slow ${kelompok.slow}, dead ${kelompok.dead} dari ${b.produk.length} SKU.`,
    ...b.produk.slice(0, 15).map(
      (p) =>
        `${p.sku} ${p.nama ?? ""}: ${p.kelas}, terjual ${p.qty}, laju ${p.lajuHarian}/hari, ` +
        `stok ${p.stok ?? "tidak diketahui"}, hari persediaan ${p.hariPersediaan ?? "-"}`
    ),
  ].join("\n");

  // Nama variabel dibedakan dari fungsi `komposisiBiaya` di atas — kalau sama, nama lokal
  // menutupi fungsi dan TypeScript menolak inisialisasinya (dipakai sebelum dideklarasikan).
  const teksKomposisi = komposisiBiaya(b.ringkas)
    .map((k) => `${k.label} ${k.nilai} (${k.persen ?? "-"}%)`)
    .join(", ");
  return {
    trenHarian,
    perJam,
    fastSlowDead,
    komposisiBiaya: teksKomposisi || "Komposisi biaya: belum ada data.",
  };
}
