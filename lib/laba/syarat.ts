// lib/laba/syarat.ts — Evaluasi syarat_json aturan murni (E-R2, tanpa D1).
// Kunci §4.4 v2. Data tak tersedia → 'tak_dihitung' (aturan TIDAK diterapkan + peringatan).

export type KonteksSyarat = {
  /** Biaya iklan bersih ÷ total penjualan × 100 (periode hitung), null bila tak ada data. */
  iklanPersen: number | null;
  /** Pesanan selesai kumulatif preset, null bila tak diketahui. */
  pesananKumulatif: number | null;
  /** Tanggal bergabung preset (YYYY-MM-DD), null bila tak diisi. */
  bergabungSejak: string | null;
  /** Tanggal upload produk pertama (YYYY-MM-DD), null bila tak diisi. */
  uploadPertama: string | null;
  /** Tanggal pesanan (YYYY-MM-DD) untuk syarat waktu. */
  tanggal: string;
};

export type HasilSyarat = { ok: true } | { ok: false; alasan: string };

function bulanSelisih(dari: string, sampai: string): number {
  const [y1, m1] = dari.split("-").map(Number);
  const [y2, m2] = sampai.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

function perlu<T>(v: T | null | undefined, kunci: string): v is T {
  void kunci;
  return v !== null && v !== undefined;
}

/** Evaluasi satu syarat_json (objek) terhadap konteks. */
export function evaluasiSyarat(
  syarat: Record<string, unknown>, ctx: KonteksSyarat
): HasilSyarat {
  for (const [kunci, nilai] of Object.entries(syarat)) {
    switch (kunci) {
      case "min_iklan_bersih_persen": {
        if (!perlu(ctx.iklanPersen, kunci)) return { ok: false, alasan: `syarat tidak dapat dihitung: ${kunci}` };
        if (ctx.iklanPersen < Number(nilai)) return { ok: false, alasan: `iklan ${ctx.iklanPersen}% < ${nilai}%` };
        break;
      }
      case "kuota_pesanan_gratis": {
        if (!perlu(ctx.pesananKumulatif, kunci)) return { ok: false, alasan: `syarat tidak dapat dihitung: ${kunci}` };
        if (ctx.pesananKumulatif > Number(nilai)) return { ok: false, alasan: `kumulatif ${ctx.pesananKumulatif} > kuota ${nilai}` };
        break;
      }
      case "bergabung_sebelum": {
        if (!perlu(ctx.bergabungSejak, kunci)) return { ok: false, alasan: `syarat tidak dapat dihitung: ${kunci}` };
        if (!(ctx.bergabungSejak < String(nilai))) return { ok: false, alasan: `bergabung ${ctx.bergabungSejak} tidak sebelum ${nilai}` };
        break;
      }
      case "bergabung_antara": {
        if (!perlu(ctx.bergabungSejak, kunci)) return { ok: false, alasan: `syarat tidak dapat dihitung: ${kunci}` };
        const [a, b] = nilai as [string, string];
        if (!(ctx.bergabungSejak >= a && ctx.bergabungSejak <= b)) {
          return { ok: false, alasan: `bergabung ${ctx.bergabungSejak} di luar ${a}..${b}` };
        }
        break;
      }
      case "min_pesanan_terselesaikan": {
        if (!perlu(ctx.pesananKumulatif, kunci)) return { ok: false, alasan: `syarat tidak dapat dihitung: ${kunci}` };
        if (ctx.pesananKumulatif < Number(nilai)) return { ok: false, alasan: `kumulatif ${ctx.pesananKumulatif} < ${nilai}` };
        break;
      }
      case "atau_bulan_sejak_upload_pertama": {
        if (!perlu(ctx.uploadPertama, kunci)) return { ok: false, alasan: `syarat tidak dapat dihitung: ${kunci}` };
        if (bulanSelisih(ctx.uploadPertama, ctx.tanggal) < Number(nilai)) {
          return { ok: false, alasan: `baru ${bulanSelisih(ctx.uploadPertama, ctx.tanggal)} bulan sejak upload` };
        }
        break;
      }
      case "tenor_bulan":
      case "kecuali_kategori":
        // Dievaluasi di lapisan hitung (perlu data baris/SKU), bukan di sini.
        break;
      case "berlaku_untuk_toko_dibuka_sejak":
        // Metadata ambang Non-Star, bukan syarat hitung.
        break;
      default:
        return { ok: false, alasan: `syarat tidak dikenal: ${kunci}` };
    }
  }
  return { ok: true };
}

/** Parse syarat_json (string|null) → objek. Null = tanpa syarat = selalu ok. */
export function parseSyarat(syaratJson: string | null): Record<string, unknown> | null {
  if (!syaratJson) return null;
  try {
    const o = JSON.parse(syaratJson) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}
